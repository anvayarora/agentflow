import { calculateDiscountBps } from "../domain/money";
import { evaluateCommerceAction, type CommerceEvaluation } from "../policy/evaluator";
import { getCommerceRepository, type SessionRecord } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { listProductMappings } from "../server/repositories/bootstrap";
import { hashCart, type CanonicalCart } from "./cart";
import { getCart, getProduct as getCatalogueProduct } from "./catalog-service";

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
  matchedRules: string[];
  evidence: string[];
  policyVersionId: string;
  policyVersionNumber: number;
  cartHash: string;
  status: "OFFERED" | "PENDING_APPROVAL" | "APPROVED" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  persistedOffer?: boolean;
  overrideId?: string;
  createdAt: string;
  expiresAt: string;
  growthPlayId?: string;
  baselineCartAmountPaise?: number;
  baselineCartHash?: string;
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

export async function requestOffer(context: TrustedRequestContext, input: { sessionId: string; productId: string; variantId?: string; quantity: number; requestedUnitPricePaise?: number; requestedDiscountBps?: number; growthPlayId?: string }) {
  const repository = getCommerceRepository();
  const session = await sessionFor(context, input.sessionId);
  const activeOffers = await getRuntimeStore().list<OfferPayload>(context, runtimeKinds.offer);
  const maxRequests = Math.min(10, Math.max(1, Number.parseInt(process.env.MAX_OFFER_REQUESTS_PER_SESSION || "3", 10) || 3));
  const cooldownSeconds = Math.min(86_400, Math.max(0, Number.parseInt(process.env.OFFER_COOLDOWN_SECONDS || "0", 10) || 0));
  const sessionOffers = activeOffers.filter((offer) => offer.payload.sessionId === session.id && offer.payload.status !== "REJECTED");
  if (sessionOffers.length >= maxRequests) throw new Error("This shopper session has reached its offer request limit.");
  if (cooldownSeconds > 0 && sessionOffers.some((offer) => Date.parse(offer.payload.createdAt) + cooldownSeconds * 1000 > Date.now())) throw new Error("Please wait before requesting another offer.");
  const [customer, policy] = await Promise.all([repository.getCustomer(context, session.customerId), repository.getCurrentPolicy(context)]);
  let product = await repository.getProduct(context, input.productId);
  const productIsPersisted = Boolean(product);
  // A live Shopify session addresses products by Shopify GID, while private
  // economics live on the canonical AgentFlow product. Resolve only an
  // organization-scoped, persisted mapping; never infer cost from storefront
  // data and never trust a browser-supplied price/cost.
  if (!product && session.shopifyShopDomain) {
    const mappings = await listProductMappings(context, session.shopifyShopDomain);
    const mapping = mappings.find((item) => item.shopifyProductGid === input.productId || item.shopifyVariantGid === input.productId || item.shopifyVariantGid === input.variantId);
    if (mapping) product = await repository.getProduct(context, mapping.productId);
  }
  if (!product && session.shopifyShopDomain) {
    const publicProduct = await getCatalogueProduct(context, session, input.productId);
    if (publicProduct && "title" in publicProduct) {
      const variant = "variants" in publicProduct && Array.isArray(publicProduct.variants) ? publicProduct.variants.find((entry) => !input.variantId || entry.id === input.variantId) || publicProduct.variants[0] : undefined;
      product = { id: publicProduct.id, organizationId: context.organizationId, externalId: publicProduct.id, sku: variant?.sku || publicProduct.id, name: publicProduct.title, description: publicProduct.description, category: publicProduct.collections[0]?.title || "Connected catalogue", brand: null, currency: publicProduct.currency, listPricePaise: Math.round((variant?.priceMinorUnits ?? publicProduct.priceMinorUnits) * (publicProduct.currency === "INR" ? 1 : 100)), costPaise: null, stock: variant?.available === false ? 0 : 1, attributes: {}, tags: publicProduct.tags, imageUrl: publicProduct.media[0] || null, source: "shopify-ucp", sourceUpdatedAt: new Date() };
    }
  }
  if (!customer || !policy) throw new Error("Commerce policy context is unavailable.");
  if (!product) throw new Error("Negotiated pricing is unavailable for this catalogue item until it is linked to merchant economics.");
  const requestedPricePaise = input.requestedUnitPricePaise ?? Math.max(0, Math.round(product.listPricePaise * (1 - (input.requestedDiscountBps || 0) / 10_000)));
  const requestedDiscountBps = input.requestedDiscountBps ?? calculateDiscountBps(product.listPricePaise, requestedPricePaise);
  const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: input.quantity, requestedPricePaise, requestedDiscountBps } });
  const status = evaluation.outcome === "ESCALATE" ? "PENDING_APPROVAL" : "OFFERED";
  const issuedCartHash = await currentCartHash(context, session);
  const offer: RuntimeRecord<OfferPayload> = { id: id("offer"), organizationId: context.organizationId, kind: runtimeKinds.offer, status, payload: { sessionId: session.id, customerId: customer.id, productId: product.id, variantId: input.variantId, quantity: input.quantity, requestedUnitPricePaise: evaluation.requestedPricePaise, requestedDiscountBps, outcome: evaluation.outcome, approvedPricePaise: evaluation.approvedPricePaise, counterPricePaise: evaluation.counterPricePaise, requiresApproval: evaluation.requiresApproval, matchedRules: evaluation.matchedRules, evidence: evaluation.evidence, policyVersionId: evaluation.policyVersionId, policyVersionNumber: evaluation.policyVersionNumber, cartHash: issuedCartHash, baselineCartHash: issuedCartHash, baselineCartAmountPaise: session.cartTotalPaise, growthPlayId: input.growthPlayId, status, persistedOffer: productIsPersisted, createdAt: new Date().toISOString(), expiresAt: expiry() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: expiry() };
  await getRuntimeStore().put(context, offer);
  if (productIsPersisted) {
    await repository.recordOffer(context, { id: offer.id, organizationId: context.organizationId, sessionId: session.id, productId: product.id, policyVersionId: evaluation.policyVersionId, evaluation, quantity: input.quantity, requestedDiscountBps, createdAt: offer.payload.createdAt });
  }
  await repository.recordAudit(context, { eventType: "OFFER_REQUESTED", entityType: "offer", entityId: offer.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { outcome: evaluation.outcome, quantity: input.quantity } });
  await repository.recordAudit(context, { eventType: evaluation.outcome === "ALLOW" ? "OFFER_ALLOWED" : evaluation.outcome === "COUNTER" ? "OFFER_COUNTERED" : evaluation.outcome === "ESCALATE" ? "OFFER_ESCALATED" : "OFFER_DENIED", entityType: "offer", entityId: offer.id, shoppingSessionId: session.id, policyVersionId: policy.id, metadata: { requestedDiscountBps, maxDiscountBps: evaluation.maxDiscountBps ?? null } });
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
  if (offer.payload.persistedOffer === true) {
    await getCommerceRepository().recordApproval(context, { id: approval.id, offerId: offer.id, status: "PENDING", createdAt: approval.createdAt });
  }
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
  const repository = getCommerceRepository();
  const [currentPolicy, product, customer] = await Promise.all([
    repository.getCurrentPolicy(context),
    repository.getProduct(context, offer.payload.productId),
    repository.getCustomer(context, session.customerId),
  ]);
  if (!currentPolicy || !product || !customer) throw new Error("Approval cannot be revalidated because canonical commerce context is unavailable.");
  const liveCartHash = await currentCartHash(context, session);
  if (liveCartHash !== offer.payload.cartHash) throw new Error("The cart changed after the approval request. Request a new offer.");
  if (Date.parse(offer.payload.expiresAt) <= Date.now()) throw new Error("Approval has expired.");
  const proposedPricePaise = decision === "COUNTER" ? counterPricePaise! : (offer.payload.counterPricePaise ?? offer.payload.approvedPricePaise ?? offer.payload.requestedUnitPricePaise);
  if (!Number.isSafeInteger(proposedPricePaise) || proposedPricePaise < 0 || proposedPricePaise > product.listPricePaise) throw new Error("The merchant decision contains an invalid price.");
  const revalidation = evaluateCommerceAction({ organizationId: context.organizationId, policy: currentPolicy, product, customer, session, request: { quantity: offer.payload.quantity, requestedPricePaise: proposedPricePaise, requestedDiscountBps: calculateDiscountBps(product.listPricePaise, proposedPricePaise) } });
  const hardRisk = revalidation.riskFlags.some((flag) => ["hard-deny", "margin-floor", "missing-cost", "insufficient-stock", "negotiation-disabled"].includes(flag));
  await repository.recordAudit(context, { eventType: "MERCHANT_APPROVAL_REVALIDATED", entityType: "approval", entityId: approvalId, shoppingSessionId: session.id, policyVersionId: currentPolicy.id, metadata: { decision, offerId: offer.id, outcome: revalidation.outcome, hardRisk, policyVersionNumber: currentPolicy.version } });
  // A missing private cost deliberately remains an ESCALATE (never an ALLOW).
  // A merchant may issue a scoped counter only after this fresh evaluation;
  // known hard denials and margin/inventory risks can never be bypassed.
  const counterHardRisk = revalidation.riskFlags.some((flag) => ["hard-deny", "margin-floor", "insufficient-stock", "negotiation-disabled"].includes(flag));
  if (decision === "COUNTER" && (revalidation.outcome !== "ALLOW" && !revalidation.riskFlags.includes("missing-cost") || counterHardRisk)) {
    await repository.recordAudit(context, { eventType: "MERCHANT_COUNTER_REJECTED_BY_POLICY", entityType: "approval", entityId: approvalId, shoppingSessionId: session.id, policyVersionId: currentPolicy.id, metadata: { offerId: offer.id, proposedPricePaise, outcome: revalidation.outcome, riskFlags: revalidation.riskFlags } });
    throw new Error("Counter price is outside the current published policy.");
  }
  if (decision === "APPROVE" && (revalidation.outcome === "DENY" || revalidation.outcome === "COUNTER" || hardRisk)) {
    throw new Error("Approval cannot bypass the current published policy.");
  }
  const decidedAt = new Date().toISOString();
  const nextStatus = decision === "APPROVE" ? "APPROVED" : decision === "COUNTER" ? "COUNTERED" : "REJECTED";
  const transitioned = await store.transition(context, runtimeKinds.approval, approvalId, "PENDING", nextStatus, { ...approval.payload, status: nextStatus, decision, counterPricePaise, decidedBy: context.actorId, decidedAt });
  if (!transitioned) throw new Error("Approval was already decided by another merchant.");
  if (offer.payload.persistedOffer !== false) await getCommerceRepository().updateApproval(context, approvalId, { status: nextStatus, decision, decidedBy: context.actorId, decidedAt });
  if (decision === "REJECT") await store.update(context, runtimeKinds.offer, offer.id, { status: "REJECTED", payload: { ...offer.payload, status: "REJECTED" } });
  else if (decision === "APPROVE") await store.update(context, runtimeKinds.offer, offer.id, { status: "APPROVED", payload: { ...offer.payload, status: "APPROVED", approvedPricePaise: proposedPricePaise, policyVersionId: currentPolicy.id, policyVersionNumber: currentPolicy.version } });
  else {
    const override: RuntimeRecord<OverridePayload> = { id: id("override"), organizationId: context.organizationId, kind: runtimeKinds.override, status: "AVAILABLE", payload: { offerId: offer.id, sessionId: session.id, customerId: offer.payload.customerId, cartHash: offer.payload.cartHash, approvedPricePaise: counterPricePaise!, currency: session.currency, quantity: offer.payload.quantity, variantId: offer.payload.variantId, status: "AVAILABLE", nonce: crypto.randomUUID(), expiresAt: expiry() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: expiry() };
    await store.put(context, override);
    await store.update(context, runtimeKinds.offer, offer.id, { status: "COUNTERED", payload: { ...offer.payload, status: "COUNTERED", counterPricePaise, overrideId: override.id } });
    await repository.recordAudit(context, { eventType: "SCOPED_OVERRIDE_ISSUED", entityType: "scoped_override", entityId: override.id, shoppingSessionId: session.id, policyVersionId: currentPolicy.id, metadata: { offerId: offer.id, approvedPricePaise: counterPricePaise } });
  }
  await getCommerceRepository().recordAudit(context, { eventType: "APPROVAL_DECIDED", entityType: "approval", entityId: approvalId, shoppingSessionId: session.id, metadata: { decision, offerId: offer.id } });
  return getApprovalStatus(context, approvalId);
}

export async function findAcceptedOffer(context: TrustedRequestContext, sessionId: string) {
  const offers = await getRuntimeStore().list<OfferPayload>(context, runtimeKinds.offer);
  return offers.find((offer) => offer.payload.sessionId === sessionId && offer.payload.status === "ACCEPTED");
}
