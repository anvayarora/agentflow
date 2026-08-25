import { calculateDiscountBps } from "../domain/money";
import { evaluateCommerceAction, type CommerceEvaluation } from "../policy/evaluator";
import { getCommerceRepository, type SessionRecord } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { hashCart, type CanonicalCart } from "./cart";
import { getCart } from "./catalog-service";

export type OfferPayload = {
  sessionId: string;
  customerId: string;
  productId: string;
  variantId?: string;
  quantity: number;
  requestedUnitPricePaise: number;
  requestedDiscountBps: number;
  outcome: CommerceEvaluation["outcome"];
  approvedPricePaise?: number;
  counterPricePaise?: number;
  requiresApproval: boolean;
  policyVersionId: string;
  policyVersionNumber: number;
  cartHash: string;
  status: "OFFERED" | "PENDING_APPROVAL" | "APPROVED" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  overrideId?: string;
  createdAt: string;
  expiresAt: string;
};

export type ApprovalPayload = { offerId: string; sessionId: string; status: "PENDING" | "APPROVED" | "COUNTERED" | "REJECTED"; decision?: string; counterPricePaise?: number; decidedBy?: string; createdAt: string; decidedAt?: string };
export type OverridePayload = { offerId: string; sessionId: string; customerId: string; cartHash: string; approvedPricePaise: number; currency: string; quantity: number; variantId?: string; status: "AVAILABLE" | "CONSUMED" | "EXPIRED"; nonce: string; expiresAt: string; consumedAt?: string };

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const expiry = (minutes = 10) => new Date(Date.now() + minutes * 60_000).toISOString();

function safeOffer(record: RuntimeRecord<OfferPayload>) {
  const payload = record.payload;
  return { offerId: record.id, status: payload.status, outcome: payload.outcome, approvedPricePaise: payload.approvedPricePaise, counterPricePaise: payload.counterPricePaise, requiresApproval: payload.requiresApproval, expiresAt: payload.expiresAt };
}

async function sessionFor(context: TrustedRequestContext, sessionId: string) {
  const session = await getCommerceRepository().getSession(context, sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  return session;
}

async function currentCartHash(context: TrustedRequestContext, session: SessionRecord) {
  const cart = await getCart(context, session);
  return cart.cartHash || hashCart({ currency: session.currency, lines: [] } satisfies CanonicalCart);
}

export async function requestOffer(context: TrustedRequestContext, input: { sessionId: string; productId: string; variantId?: string; quantity: number; requestedUnitPricePaise?: number; requestedDiscountBps?: number }) {
  const repository = getCommerceRepository();
  const session = await sessionFor(context, input.sessionId);
  const [customer, policy, product] = await Promise.all([repository.getCustomer(context, session.customerId), repository.getCurrentPolicy(context), repository.getProduct(context, input.productId)]);
  if (!customer || !policy) throw new Error("Commerce policy context is unavailable.");
  if (!product) throw new Error("Negotiated pricing is unavailable for this catalogue item until it is linked to merchant economics.");
  const requestedPricePaise = input.requestedUnitPricePaise ?? Math.max(0, Math.round(product.listPricePaise * (1 - (input.requestedDiscountBps || 0) / 10_000)));
  const requestedDiscountBps = input.requestedDiscountBps ?? calculateDiscountBps(product.listPricePaise, requestedPricePaise);
  const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: input.quantity, requestedPricePaise, requestedDiscountBps } });
  const status = evaluation.outcome === "ESCALATE" ? "PENDING_APPROVAL" : "OFFERED";
  const offer: RuntimeRecord<OfferPayload> = { id: id("offer"), organizationId: context.organizationId, kind: runtimeKinds.offer, status, payload: { sessionId: session.id, customerId: customer.id, productId: product.id, variantId: input.variantId, quantity: input.quantity, requestedUnitPricePaise: evaluation.requestedPricePaise, requestedDiscountBps, outcome: evaluation.outcome, approvedPricePaise: evaluation.approvedPricePaise, counterPricePaise: evaluation.counterPricePaise, requiresApproval: evaluation.requiresApproval, policyVersionId: evaluation.policyVersionId, policyVersionNumber: evaluation.policyVersionNumber, cartHash: await currentCartHash(context, session), status, createdAt: new Date().toISOString(), expiresAt: expiry() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: expiry() };
  await getRuntimeStore().put(context, offer);
  await repository.recordAudit(context, { eventType: "OFFER_REQUESTED", entityType: "offer", entityId: offer.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { outcome: evaluation.outcome, quantity: input.quantity } });
  return safeOffer(offer);
}

async function getOffer(context: TrustedRequestContext, offerId: string) {
  const record = await getRuntimeStore().get<OfferPayload>(context, runtimeKinds.offer, offerId);
  if (!record) throw new Error("Offer was not found or has expired.");
  if (record.payload.expiresAt && Date.parse(record.payload.expiresAt) <= Date.now()) { await getRuntimeStore().update(context, runtimeKinds.offer, offerId, { status: "EXPIRED", payload: { ...record.payload, status: "EXPIRED" } }); throw new Error("Offer has expired."); }
  return record;
}

async function assertCustomerSession(context: TrustedRequestContext, offer: OfferPayload) {
  const session = await sessionFor(context, offer.sessionId);
  if (session.customerId !== offer.customerId) throw new Error("Offer customer binding is invalid.");
  if ((await currentCartHash(context, session)) !== offer.cartHash) throw new Error("The cart changed after this offer was issued. Request a new offer.");
  return session;
}

export async function acceptOffer(context: TrustedRequestContext, offerId: string) {
  const record = await getOffer(context, offerId);
  const session = await assertCustomerSession(context, record.payload);
  if (!["OFFERED", "APPROVED", "COUNTERED"].includes(record.payload.status)) throw new Error("This offer cannot be accepted in its current state.");
  if (record.payload.outcome === "ESCALATE" && record.payload.status !== "APPROVED" && record.payload.status !== "COUNTERED") throw new Error("Merchant approval is required before this offer can be accepted.");
  const acceptedPricePaise = record.payload.counterPricePaise ?? record.payload.approvedPricePaise;
  if (acceptedPricePaise === undefined) throw new Error("This offer has no executable price.");
  const updated = await getRuntimeStore().update(context, runtimeKinds.offer, offerId, { status: "ACCEPTED", payload: { ...record.payload, status: "ACCEPTED", approvedPricePaise: acceptedPricePaise } });
  await getCommerceRepository().recordAudit(context, { eventType: "OFFER_ACCEPTED", entityType: "offer", entityId: offerId, shoppingSessionId: session.id, policyVersionId: record.payload.policyVersionId, metadata: { pricePaise: acceptedPricePaise } });
  return updated ? safeOffer(updated as RuntimeRecord<OfferPayload>) : null;
}

export async function requestApproval(context: TrustedRequestContext, offerId: string) {
  const offer = await getOffer(context, offerId);
  await assertCustomerSession(context, offer.payload);
  if (!offer.payload.requiresApproval && offer.payload.outcome !== "ESCALATE") throw new Error("This offer does not require merchant approval.");
  const existing = (await getRuntimeStore().list<ApprovalPayload>(context, runtimeKinds.approval)).find((item) => item.payload.offerId === offerId && item.payload.status === "PENDING");
  if (existing) return { approvalId: existing.id, status: existing.payload.status };
  const approval: RuntimeRecord<ApprovalPayload> = { id: id("approval"), organizationId: context.organizationId, kind: runtimeKinds.approval, status: "PENDING", payload: { offerId, sessionId: offer.payload.sessionId, status: "PENDING", createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: offer.payload.expiresAt };
  await getRuntimeStore().put(context, approval);
  await getRuntimeStore().update(context, runtimeKinds.offer, offerId, { status: "PENDING_APPROVAL", payload: { ...offer.payload, status: "PENDING_APPROVAL" } });
  await getCommerceRepository().recordAudit(context, { eventType: "APPROVAL_REQUESTED", entityType: "approval", entityId: approval.id, shoppingSessionId: offer.payload.sessionId, policyVersionId: offer.payload.policyVersionId, metadata: { offerId } });
  return { approvalId: approval.id, status: "PENDING" as const };
}

export async function getApprovalStatus(context: TrustedRequestContext, approvalId: string) {
  const record = await getRuntimeStore().get<ApprovalPayload>(context, runtimeKinds.approval, approvalId);
  if (!record) throw new Error("Approval request was not found.");
  return { approvalId, status: record.payload.status, decision: record.payload.decision, counterPricePaise: record.payload.counterPricePaise };
}

export async function decideApproval(context: TrustedRequestContext, approvalId: string, decision: "APPROVE" | "COUNTER" | "REJECT", counterPricePaise?: number) {
  if (context.actorType === "customer" || context.actorId.startsWith("shopify:")) throw new Error("Only a merchant can decide an approval.");
  const store = getRuntimeStore();
  const approval = await store.get<ApprovalPayload>(context, runtimeKinds.approval, approvalId);
  if (!approval || approval.payload.status !== "PENDING") throw new Error("Approval is not pending.");
  const offer = await getOffer(context, approval.payload.offerId);
  const session = await sessionFor(context, offer.payload.sessionId);
  if (decision === "COUNTER" && (!Number.isSafeInteger(counterPricePaise) || counterPricePaise! < 0)) throw new Error("A safe counter price is required.");
  const decidedAt = new Date().toISOString();
  await store.update(context, runtimeKinds.approval, approvalId, { status: decision === "APPROVE" ? "APPROVED" : decision === "COUNTER" ? "COUNTERED" : "REJECTED", payload: { ...approval.payload, status: decision === "APPROVE" ? "APPROVED" : decision === "COUNTER" ? "COUNTERED" : "REJECTED", decision, counterPricePaise, decidedBy: context.actorId, decidedAt } });
  if (decision === "REJECT") await store.update(context, runtimeKinds.offer, offer.id, { status: "REJECTED", payload: { ...offer.payload, status: "REJECTED" } });
  else if (decision === "APPROVE") await store.update(context, runtimeKinds.offer, offer.id, { status: "APPROVED", payload: { ...offer.payload, status: "APPROVED", approvedPricePaise: offer.payload.counterPricePaise ?? offer.payload.approvedPricePaise } });
  else {
    const override: RuntimeRecord<OverridePayload> = { id: id("override"), organizationId: context.organizationId, kind: runtimeKinds.override, status: "AVAILABLE", payload: { offerId: offer.id, sessionId: session.id, customerId: offer.payload.customerId, cartHash: offer.payload.cartHash, approvedPricePaise: counterPricePaise!, currency: session.currency, quantity: offer.payload.quantity, variantId: offer.payload.variantId, status: "AVAILABLE", nonce: crypto.randomUUID(), expiresAt: expiry() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: expiry() };
    await store.put(context, override);
    await store.update(context, runtimeKinds.offer, offer.id, { status: "COUNTERED", payload: { ...offer.payload, status: "COUNTERED", counterPricePaise, overrideId: override.id } });
  }
  await getCommerceRepository().recordAudit(context, { eventType: "APPROVAL_DECIDED", entityType: "approval", entityId: approvalId, shoppingSessionId: session.id, metadata: { decision, offerId: offer.id } });
  return getApprovalStatus(context, approvalId);
}

export async function findAcceptedOffer(context: TrustedRequestContext, sessionId: string) {
  const offers = await getRuntimeStore().list<OfferPayload>(context, runtimeKinds.offer);
  return offers.find((offer) => offer.payload.sessionId === sessionId && offer.payload.status === "ACCEPTED");
}
