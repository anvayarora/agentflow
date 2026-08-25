import { getCommerceRepository } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { getCart } from "./catalog-service";
import { findAcceptedOffer } from "./offer-service";
import { getPaymentAdapter, type PaymentOrder } from "../payments/payment-adapter";
import { multiplyPaise } from "../domain/money";

export type TransactionPayload = { sessionId: string; offerId: string; policyVersionId: string; amountPaise: number; currency: string; cartHash: string; idempotencyKey: string; provider: string; providerOrderId?: string; status: "CREATED" | "PAID" | "FAILED"; createdAt: string };
export type PaymentPayload = { transactionId: string; provider: string; providerOrderId?: string; providerPaymentId?: string; status: string; amountPaise: number; currency: string; createdAt: string };

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export async function createCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string }) {
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, input.sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const offer = await findAcceptedOffer(context, session.id);
  if (!offer || offer.payload.status !== "ACCEPTED" || offer.payload.approvedPricePaise === undefined) throw new Error("A current accepted offer is required before checkout.");
  const cart = await getCart(context, session);
  if (cart.cartHash !== offer.payload.cartHash) throw new Error("The cart changed after the offer was accepted.");
  const store = getRuntimeStore();
  if (offer.payload.overrideId) {
    const override = await store.get<import("./offer-service").OverridePayload>(context, runtimeKinds.override, offer.payload.overrideId);
    if (!override || override.payload.sessionId !== session.id || override.payload.customerId !== session.customerId || override.payload.cartHash !== cart.cartHash || Date.parse(override.payload.expiresAt) <= Date.now()) throw new Error("The scoped offer authorization is no longer valid.");
    if (!await store.consume(context, runtimeKinds.override, override.id)) throw new Error("The scoped offer authorization has already been used.");
    await repository.recordAudit(context, { eventType: "SCOPED_OVERRIDE_CONSUMED", entityType: "scoped_override", entityId: override.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { offerId: offer.id } });
  }
  const existing = (await store.list<TransactionPayload>(context, runtimeKinds.transaction)).find((record) => record.payload.idempotencyKey === input.idempotencyKey && record.payload.sessionId === session.id);
  if (existing) return { transactionId: existing.id, status: existing.payload.status, provider: existing.payload.provider, providerOrderId: existing.payload.providerOrderId, amountPaise: existing.payload.amountPaise, currency: existing.payload.currency };
  const adapter = getPaymentAdapter();
  const order: PaymentOrder = await adapter.createOrder({ amountPaise: multiplyPaise(offer.payload.approvedPricePaise, offer.payload.quantity), currency: session.currency, receipt: `agentflow-${session.id}`, idempotencyKey: input.idempotencyKey });
  const transaction: RuntimeRecord<TransactionPayload> = { id: id("transaction"), organizationId: context.organizationId, kind: runtimeKinds.transaction, status: "CREATED", payload: { sessionId: session.id, offerId: offer.id, policyVersionId: offer.payload.policyVersionId, amountPaise: order.amountPaise, currency: order.currency, cartHash: cart.cartHash, idempotencyKey: input.idempotencyKey, provider: order.provider, providerOrderId: order.id, status: "CREATED", createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, transaction);
  const payment: RuntimeRecord<PaymentPayload> = { id: id("payment"), organizationId: context.organizationId, kind: runtimeKinds.payment, status: "CREATED", payload: { transactionId: transaction.id, provider: order.provider, providerOrderId: order.id, status: "CREATED", amountPaise: order.amountPaise, currency: order.currency, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, payment);
  await repository.recordAudit(context, { eventType: "CHECKOUT_CREATED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: order.provider, amountPaise: order.amountPaise } });
  return { transactionId: transaction.id, paymentId: payment.id, status: "CREATED" as const, provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise, currency: order.currency };
}

export async function getPaymentStatus(context: TrustedRequestContext, transactionId: string) {
  const transaction = await getRuntimeStore().get<TransactionPayload>(context, runtimeKinds.transaction, transactionId);
  if (!transaction) throw new Error("Transaction was not found.");
  const payment = (await getRuntimeStore().list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === transactionId);
  return { transactionId, status: transaction.payload.status, provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, payment: payment ? { paymentId: payment.id, status: payment.payload.status, providerPaymentId: payment.payload.providerPaymentId } : null };
}

export async function verifyPayment(context: TrustedRequestContext, input: { transactionId: string; paymentId: string; signature: string }) {
  const transaction = await getRuntimeStore().get<TransactionPayload>(context, runtimeKinds.transaction, input.transactionId);
  if (!transaction || !transaction.payload.providerOrderId) throw new Error("Transaction was not found.");
  const adapter = getPaymentAdapter();
  if (!adapter.verifyCheckoutSignature({ orderId: transaction.payload.providerOrderId, paymentId: input.paymentId, signature: input.signature })) throw new Error("Payment signature is invalid.");
  await getRuntimeStore().update(context, runtimeKinds.transaction, transaction.id, { status: "PAID", payload: { ...transaction.payload, status: "PAID" } });
  const payment = (await getRuntimeStore().list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === transaction.id);
  if (payment) await getRuntimeStore().update(context, runtimeKinds.payment, payment.id, { status: "PAID", payload: { ...payment.payload, providerPaymentId: input.paymentId, status: "PAID" } });
  await getCommerceRepository().recordAudit(context, { eventType: "PAYMENT_VERIFIED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { provider: transaction.payload.provider } });
  return getPaymentStatus(context, transaction.id);
}
