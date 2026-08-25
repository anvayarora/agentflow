import { getCommerceRepository } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { getCart } from "./catalog-service";
import { findAcceptedOffer } from "./offer-service";
import { getPaymentAdapter, type PaymentOrder } from "../payments/payment-adapter";
import { multiplyPaise } from "../domain/money";

export type TransactionPayload = { sessionId: string; offerId: string; policyVersionId: string; amountPaise: number; currency: string; cartHash: string; idempotencyKey: string; provider: string; providerOrderId?: string; status: "CREATED" | "PAID" | "FAILED"; createdAt: string };
export type PaymentPayload = { transactionId: string; provider: string; providerOrderId?: string; providerPaymentId?: string; providerStatus?: string; status: string; amountPaise: number; currency: string; idempotencyKey: string; verifiedAt?: string; createdAt: string };

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function getPublicPaymentKey(): string | undefined {
  if ((process.env.PAYMENT_PROVIDER || "").toLowerCase() !== "razorpay") return undefined;
  const keyId = process.env.RAZORPAY_KEY_ID;
  return keyId && keyId.startsWith("rzp_test_") ? keyId : undefined;
}

function cartContainsOffer(cart: Awaited<ReturnType<typeof getCart>>, offer: { productId: string; variantId?: string; quantity: number }) {
  return cart.lines.some((line) => (line.variantId === offer.variantId || line.variantId === offer.productId) && line.quantity >= offer.quantity);
}

async function securityAudit(context: TrustedRequestContext, input: { eventType: "CART_HASH_MISMATCH" | "OVERRIDE_EXPIRED" | "OVERRIDE_REPLAY_REJECTED" | "INVALID_PAYMENT_SIGNATURE" | "UNAUTHORIZED_CHECKOUT_REJECTED" | "PAYMENT_PROVIDER_VERIFICATION_FAILED"; entityType: string; entityId: string; sessionId?: string; policyVersionId?: string; metadata?: Record<string, unknown> }) {
  await getCommerceRepository().recordAudit(context, { eventType: input.eventType, entityType: input.entityType, entityId: input.entityId, shoppingSessionId: input.sessionId, policyVersionId: input.policyVersionId, metadata: input.metadata || {} });
}

export async function createCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string }) {
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, input.sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const offer = await findAcceptedOffer(context, session.id);
  if (!offer || offer.payload.status !== "ACCEPTED" || offer.payload.approvedPricePaise === undefined) {
    await securityAudit(context, { eventType: "UNAUTHORIZED_CHECKOUT_REJECTED", entityType: "checkout", entityId: session.id, sessionId: session.id, metadata: { reason: "accepted_offer_required" } });
    throw new Error("A current accepted offer is required before checkout.");
  }
  const cart = await getCart(context, session);
  const authorizedAmountPaise = multiplyPaise(offer.payload.approvedPricePaise, offer.payload.quantity);
  if (cart.cartHash !== offer.payload.cartHash) {
    await securityAudit(context, { eventType: "CART_HASH_MISMATCH", entityType: "checkout", entityId: session.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { offerId: offer.id } });
    throw new Error("The cart changed after the offer was accepted.");
  }
  if (!cartContainsOffer(cart, offer.payload)) {
    await securityAudit(context, { eventType: "UNAUTHORIZED_CHECKOUT_REJECTED", entityType: "checkout", entityId: session.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { reason: "accepted_offer_product_not_in_canonical_cart", offerId: offer.id } });
    throw new Error("The accepted offer is not bound to an item in the current cart.");
  }
  const store = getRuntimeStore();
  const existing = (await store.list<TransactionPayload>(context, runtimeKinds.transaction)).find((record) => record.payload.idempotencyKey === input.idempotencyKey && record.payload.sessionId === session.id);
  if (existing) {
    if (existing.payload.cartHash !== cart.cartHash || existing.payload.offerId !== offer.id || existing.payload.amountPaise !== authorizedAmountPaise) {
      await securityAudit(context, { eventType: "UNAUTHORIZED_CHECKOUT_REJECTED", entityType: "transaction", entityId: existing.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { reason: "idempotency_key_bound_to_different_authority" } });
      throw new Error("This idempotency key is bound to a different authorized checkout.");
    }
    const existingPayment = (await store.list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === existing.id);
    return { transactionId: existing.id, paymentId: existingPayment?.id, status: existing.payload.status, provider: existing.payload.provider, providerOrderId: existing.payload.providerOrderId, amountPaise: existing.payload.amountPaise, currency: existing.payload.currency, publicKeyId: getPublicPaymentKey() };
  }
  if (offer.payload.overrideId) {
    const override = await store.get<import("./offer-service").OverridePayload>(context, runtimeKinds.override, offer.payload.overrideId);
    if (!override || Date.parse(override.payload.expiresAt) <= Date.now()) {
      await securityAudit(context, { eventType: "OVERRIDE_EXPIRED", entityType: "scoped_override", entityId: offer.payload.overrideId, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { offerId: offer.id } });
      throw new Error("The scoped offer authorization is no longer valid.");
    }
    if (override.payload.sessionId !== session.id || override.payload.customerId !== session.customerId || override.payload.cartHash !== cart.cartHash) {
      await securityAudit(context, { eventType: "UNAUTHORIZED_CHECKOUT_REJECTED", entityType: "scoped_override", entityId: override.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { reason: "override_scope_mismatch", offerId: offer.id } });
      throw new Error("The scoped offer authorization is no longer valid.");
    }
    if (!await store.consume(context, runtimeKinds.override, override.id)) {
      await securityAudit(context, { eventType: "OVERRIDE_REPLAY_REJECTED", entityType: "scoped_override", entityId: override.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { offerId: offer.id } });
      throw new Error("The scoped offer authorization has already been used.");
    }
    await repository.recordAudit(context, { eventType: "SCOPED_OVERRIDE_CONSUMED", entityType: "scoped_override", entityId: override.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { offerId: offer.id } });
  }
  const adapter = getPaymentAdapter();
  await repository.recordAudit(context, { eventType: "PAYMENT_PROVIDER_ORDER_REQUESTED", entityType: "payment_provider_order", entityId: `${session.id}:${input.idempotencyKey}`, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: adapter.provider, amountPaise: authorizedAmountPaise, currency: session.currency } });
  const order: PaymentOrder = await adapter.createOrder({ amountPaise: authorizedAmountPaise, currency: session.currency, receipt: `agentflow-${session.id}`, idempotencyKey: input.idempotencyKey });
  if (order.amountPaise !== authorizedAmountPaise || order.currency !== session.currency) {
    await securityAudit(context, { eventType: "PAYMENT_PROVIDER_VERIFICATION_FAILED", entityType: "payment_provider_order", entityId: order.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { reason: "provider_order_amount_or_currency_mismatch" } });
    throw new Error("Payment provider order does not match the server-authorized amount.");
  }
  const transaction: RuntimeRecord<TransactionPayload> = { id: id("transaction"), organizationId: context.organizationId, kind: runtimeKinds.transaction, status: "CREATED", payload: { sessionId: session.id, offerId: offer.id, policyVersionId: offer.payload.policyVersionId, amountPaise: order.amountPaise, currency: order.currency, cartHash: cart.cartHash, idempotencyKey: input.idempotencyKey, provider: order.provider, providerOrderId: order.id, status: "CREATED", createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, transaction);
  const payment: RuntimeRecord<PaymentPayload> = { id: id("payment"), organizationId: context.organizationId, kind: runtimeKinds.payment, status: "CREATED", payload: { transactionId: transaction.id, provider: order.provider, providerOrderId: order.id, status: "CREATED", amountPaise: order.amountPaise, currency: order.currency, idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, payment);
  await repository.recordAudit(context, { eventType: "PAYMENT_CREATED", entityType: "payment", entityId: payment.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise } });
  await repository.recordAudit(context, { eventType: "CHECKOUT_CREATED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise } });
  return { transactionId: transaction.id, paymentId: payment.id, status: "CREATED" as const, provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise, currency: order.currency, publicKeyId: getPublicPaymentKey() };
}

export async function getPaymentStatus(context: TrustedRequestContext, transactionId: string) {
  const transaction = await getRuntimeStore().get<TransactionPayload>(context, runtimeKinds.transaction, transactionId);
  if (!transaction) throw new Error("Transaction was not found.");
  const payment = (await getRuntimeStore().list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === transactionId);
  return { transactionId, status: transaction.payload.status, provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, payment: payment ? { paymentId: payment.id, status: payment.payload.status, providerPaymentId: payment.payload.providerPaymentId } : null };
}

export async function verifyPayment(context: TrustedRequestContext, input: { transactionId: string; orderId?: string; paymentId: string; signature: string }) {
  const transaction = await getRuntimeStore().get<TransactionPayload>(context, runtimeKinds.transaction, input.transactionId);
  if (!transaction || !transaction.payload.providerOrderId) throw new Error("Transaction was not found.");
  if (input.orderId && input.orderId !== transaction.payload.providerOrderId) {
    await securityAudit(context, { eventType: "UNAUTHORIZED_CHECKOUT_REJECTED", entityType: "transaction", entityId: transaction.id, sessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { reason: "callback_order_mismatch" } });
    throw new Error("Payment order does not match the authorized transaction.");
  }
  const payment = (await getRuntimeStore().list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === transaction.id);
  if (!payment) throw new Error("Payment record was not found.");
  if (payment.payload.providerPaymentId && payment.payload.providerPaymentId !== input.paymentId) throw new Error("A different payment is already bound to this transaction.");
  const adapter = getPaymentAdapter();
  if (!adapter.verifyCheckoutSignature({ orderId: transaction.payload.providerOrderId, paymentId: input.paymentId, signature: input.signature })) {
    await securityAudit(context, { eventType: "INVALID_PAYMENT_SIGNATURE", entityType: "transaction", entityId: transaction.id, sessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { provider: transaction.payload.provider } });
    throw new Error("Payment signature is invalid.");
  }
  const order = await adapter.getOrder(transaction.payload.providerOrderId);
  const providerPayment = await adapter.getPayment(input.paymentId);
  const providerStateAcceptable = adapter.provider === "mock" || ["authorized", "captured"].includes(providerPayment.status);
  const matches = order.id === transaction.payload.providerOrderId && order.amountPaise === transaction.payload.amountPaise && order.currency === transaction.payload.currency && (!providerPayment.orderId || providerPayment.orderId === order.id) && (!providerPayment.amountPaise || providerPayment.amountPaise === transaction.payload.amountPaise) && (!providerPayment.currency || providerPayment.currency === transaction.payload.currency) && providerStateAcceptable;
  if (!matches) {
    await securityAudit(context, { eventType: "PAYMENT_PROVIDER_VERIFICATION_FAILED", entityType: "transaction", entityId: transaction.id, sessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, providerPaymentId: input.paymentId, providerStatus: providerPayment.status } });
    throw new Error("Payment provider state does not match the server-authorized transaction.");
  }
  await getRuntimeStore().update(context, runtimeKinds.transaction, transaction.id, { status: "PAID", payload: { ...transaction.payload, status: "PAID" } });
  await getRuntimeStore().update(context, runtimeKinds.payment, payment.id, { status: "PAID", payload: { ...payment.payload, providerPaymentId: input.paymentId, providerStatus: providerPayment.status, status: "PAID", verifiedAt: new Date().toISOString() } });
  await getCommerceRepository().recordAudit(context, { eventType: "PAYMENT_VERIFIED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, providerPaymentId: input.paymentId, providerStatus: providerPayment.status, amountPaise: transaction.payload.amountPaise } });
  return getPaymentStatus(context, transaction.id);
}
