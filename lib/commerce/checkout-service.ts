import { getCommerceRepository, type CheckoutReservationRecord, type TransactionLineSnapshot } from "../server/repositories/commerce";
import type { TrustedRequestContext } from "../server/context";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../server/runtime/store";
import { getCart } from "./catalog-service";
import { findAcceptedOffer } from "./offer-service";
import { getPaymentAdapter, type PaymentOrder } from "../payments/payment-adapter";
import { multiplyPaise } from "../domain/money";
import { getGrowthRepository } from "../server/repositories/growth";

export type TransactionPayload = { sessionId: string; offerId: string; policyVersionId: string; amountPaise: number; currency: string; cartHash: string; idempotencyKey: string; provider: string; providerOrderId?: string; lineItems?: Array<Omit<TransactionLineSnapshot, "id" | "transactionId">>; status: "CREATED" | "PAID" | "FAILED"; createdAt: string };
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

function checkoutResult(transaction: RuntimeRecord<TransactionPayload>, payment?: RuntimeRecord<PaymentPayload>) {
  return { transactionId: transaction.id, paymentId: payment?.id, status: transaction.payload.status, provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, amountPaise: transaction.payload.amountPaise, currency: transaction.payload.currency, publicKeyId: getPublicPaymentKey() };
}

async function waitForReservation(context: TrustedRequestContext, reservation: CheckoutReservationRecord, sessionId: string, idempotencyKey: string) {
  const store = getRuntimeStore();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const transaction = reservation.transactionId ? await store.get<TransactionPayload>(context, runtimeKinds.transaction, reservation.transactionId) : (await store.list<TransactionPayload>(context, runtimeKinds.transaction, 200)).find((record) => record.payload.sessionId === sessionId && record.payload.idempotencyKey === idempotencyKey);
    if (transaction) {
      const payment = (await store.list<PaymentPayload>(context, runtimeKinds.payment, 200)).find((record) => record.payload.transactionId === transaction.id);
      return checkoutResult(transaction, payment);
    }
    const latest = await getCommerceRepository().getCheckoutReservation(context, sessionId, idempotencyKey);
    if (latest?.status === "FAILED") throw new Error(latest.error || "Checkout creation failed; please retry.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Checkout creation is still in progress; please retry shortly.");
}

async function snapshotCartLines(context: TrustedRequestContext, cart: Awaited<ReturnType<typeof getCart>>, sessionId: string, offer: Awaited<ReturnType<typeof findAcceptedOffer>>, currency: string): Promise<Array<Omit<TransactionLineSnapshot, "id" | "transactionId">>> {
  const repository = getCommerceRepository();
  const snapshots: Array<Omit<TransactionLineSnapshot, "id" | "transactionId">> = [];
  for (const line of cart.lines) {
    const record = line as Record<string, unknown>;
    const variantId = typeof record.variantId === "string" ? record.variantId : undefined;
    const product = variantId ? await repository.getProduct(context, variantId) : null;
    const publicPrice = typeof line.unitPriceMinorUnits === "number" ? line.unitPriceMinorUnits : product?.listPricePaise || 0;
    const isOfferLine = Boolean(offer && (variantId === offer.payload.productId || variantId === offer.payload.variantId));
    const authorizedUnitPricePaise = isOfferLine && offer?.payload.approvedPricePaise !== undefined ? offer.payload.approvedPricePaise : publicPrice;
    const nestedItem = record.item && typeof record.item === "object" ? record.item as Record<string, unknown> : null;
    const productTitle = line.title || (nestedItem && typeof nestedItem.title === "string" ? nestedItem.title : undefined) || product?.name || variantId || "Catalogue item";
    snapshots.push({ productId: product?.id || null, shopifyProductGid: typeof record.shopifyProductGid === "string" ? record.shopifyProductGid : (typeof record.productId === "string" && record.productId.startsWith("gid://shopify/") ? record.productId : null), shopifyVariantGid: typeof record.shopifyVariantGid === "string" ? record.shopifyVariantGid : (variantId?.startsWith("gid://shopify/") ? variantId : null), sku: product?.sku || (typeof record.sku === "string" ? record.sku : null), productTitle, quantity: line.quantity, unitPublicPricePaise: publicPrice, authorizedUnitPricePaise, lineTotalPaise: authorizedUnitPricePaise * line.quantity, currency, growthPlayId: isOfferLine ? (offer?.payload.growthPlayId || null) : null, snapshotStatus: "IMMUTABLE" });
  }
  return snapshots;
}

async function securityAudit(context: TrustedRequestContext, input: { eventType: "CART_HASH_MISMATCH" | "OVERRIDE_EXPIRED" | "OVERRIDE_REPLAY_REJECTED" | "INVALID_PAYMENT_SIGNATURE" | "UNAUTHORIZED_CHECKOUT_REJECTED" | "PAYMENT_PROVIDER_VERIFICATION_FAILED"; entityType: string; entityId: string; sessionId?: string; policyVersionId?: string; metadata?: Record<string, unknown> }) {
  await getCommerceRepository().recordAudit(context, { eventType: input.eventType, entityType: input.entityType, entityId: input.entityId, shoppingSessionId: input.sessionId, policyVersionId: input.policyVersionId, metadata: input.metadata || {} });
}

export async function createCheckout(context: TrustedRequestContext, input: { sessionId: string; idempotencyKey: string }) {
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, input.sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const store = getRuntimeStore();
  const existing = (await store.list<TransactionPayload>(context, runtimeKinds.transaction)).find((record) => record.payload.idempotencyKey === input.idempotencyKey && record.payload.sessionId === session.id);
  if (existing) {
    const existingPayment = (await store.list<PaymentPayload>(context, runtimeKinds.payment)).find((record) => record.payload.transactionId === existing.id);
    return { transactionId: existing.id, paymentId: existingPayment?.id, status: existing.payload.status, provider: existing.payload.provider, providerOrderId: existing.payload.providerOrderId, amountPaise: existing.payload.amountPaise, currency: existing.payload.currency, publicKeyId: getPublicPaymentKey() };
  }
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
  const reservationResult = await repository.reserveCheckout(context, { sessionId: session.id, idempotencyKey: input.idempotencyKey, amountPaise: authorizedAmountPaise, currency: session.currency });
  if (!reservationResult.acquired) return waitForReservation(context, reservationResult.reservation, session.id, input.idempotencyKey);
  const reservation = reservationResult.reservation;
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
  let order: PaymentOrder;
  try {
    order = await adapter.createOrder({ amountPaise: authorizedAmountPaise, currency: session.currency, receipt: `agentflow-${session.id}`, idempotencyKey: input.idempotencyKey });
    if (order.amountPaise !== authorizedAmountPaise || order.currency !== session.currency) {
      await securityAudit(context, { eventType: "PAYMENT_PROVIDER_VERIFICATION_FAILED", entityType: "payment_provider_order", entityId: order.id, sessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { reason: "provider_order_amount_or_currency_mismatch" } });
      throw new Error("Payment provider order does not match the server-authorized amount.");
    }
  } catch (error) {
    await repository.updateCheckoutReservation(context, reservation.id, { status: "FAILED", error: error instanceof Error ? error.message : "Payment provider order creation failed." });
    throw error;
  }
  await repository.updateCheckoutReservation(context, reservation.id, { status: "CREATED", provider: order.provider, providerOrderId: order.id });
  const lineSnapshots = await snapshotCartLines(context, cart, session.id, offer, order.currency);
  const lineItems = lineSnapshots;
  const transaction: RuntimeRecord<TransactionPayload> = { id: id("transaction"), organizationId: context.organizationId, kind: runtimeKinds.transaction, status: "CREATED", payload: { sessionId: session.id, offerId: offer.id, policyVersionId: offer.payload.policyVersionId, amountPaise: order.amountPaise, currency: order.currency, cartHash: cart.cartHash, idempotencyKey: input.idempotencyKey, provider: order.provider, providerOrderId: order.id, lineItems, status: "CREATED", createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, transaction);
  await repository.recordTransaction(context, { id: transaction.id, sessionId: session.id, offerId: offer.payload.persistedOffer === true ? offer.id : null, policyVersionId: offer.payload.policyVersionId, status: "CREATED", totalPaise: order.amountPaise, currency: order.currency, provider: order.provider, providerOrderId: order.id, idempotencyKey: input.idempotencyKey, createdAt: transaction.payload.createdAt });
  await repository.recordTransactionLines(context, lineSnapshots.map((line) => ({ ...line, id: id("transaction-line"), transactionId: transaction.id })));
  const payment: RuntimeRecord<PaymentPayload> = { id: id("payment"), organizationId: context.organizationId, kind: runtimeKinds.payment, status: "CREATED", payload: { transactionId: transaction.id, provider: order.provider, providerOrderId: order.id, status: "CREATED", amountPaise: order.amountPaise, currency: order.currency, idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await store.put(context, payment);
  await repository.recordPayment(context, { id: payment.id, transactionId: transaction.id, provider: order.provider, status: "CREATED", amountPaise: order.amountPaise, currency: order.currency, createdAt: payment.payload.createdAt });
  await repository.recordAudit(context, { eventType: "PAYMENT_CREATED", entityType: "payment", entityId: payment.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise } });
  await repository.recordAudit(context, { eventType: "CHECKOUT_CREATED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: session.id, policyVersionId: offer.payload.policyVersionId, metadata: { provider: order.provider, providerOrderId: order.id, amountPaise: order.amountPaise } });
  await repository.updateCheckoutReservation(context, reservation.id, { status: "CREATED", provider: order.provider, providerOrderId: order.id, transactionId: transaction.id });
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
  if (transaction.payload.status === "PAID") return getPaymentStatus(context, transaction.id);
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
  const transitioned = await getRuntimeStore().transition(context, runtimeKinds.transaction, transaction.id, "CREATED", "PAID", { ...transaction.payload, status: "PAID" });
  if (!transitioned) return getPaymentStatus(context, transaction.id);
  const newlyPaid = await getCommerceRepository().markTransactionPaidOnce(context, transaction.id);
  await getRuntimeStore().update(context, runtimeKinds.payment, payment.id, { status: "PAID", payload: { ...payment.payload, providerPaymentId: input.paymentId, providerStatus: providerPayment.status, status: "PAID", verifiedAt: new Date().toISOString() } });
  await getCommerceRepository().updatePayment(context, payment.id, { status: "PAID", providerPaymentId: input.paymentId });
  if (newlyPaid) {
    const session = await getCommerceRepository().getSession(context, transaction.payload.sessionId);
    if (session) await getCommerceRepository().incrementCustomerAfterVerifiedPayment(context, session.customerId, transaction.payload.amountPaise);
  }
  const acceptedOffer = newlyPaid ? await findAcceptedOffer(context, transaction.payload.sessionId) : null;
  if (newlyPaid && acceptedOffer?.payload.growthPlayId) {
    const growth = getGrowthRepository();
    const session = await getCommerceRepository().getSession(context, transaction.payload.sessionId);
    const product = await getCommerceRepository().getProduct(context, acceptedOffer.payload.productId);
    const quantity = acceptedOffer.payload.quantity;
    await growth.createAttribution(context, {
      growthPlayId: acceptedOffer.payload.growthPlayId,
      transactionId: transaction.id,
      sessionId: transaction.payload.sessionId,
      shopDomain: session?.shopifyShopDomain || null,
      baselineCartHash: acceptedOffer.payload.baselineCartHash || acceptedOffer.payload.cartHash,
      postPlayCartHash: transaction.payload.cartHash,
      baselineCartAmountPaise: acceptedOffer.payload.baselineCartAmountPaise || 0,
      actualPaidAmountPaise: transaction.payload.amountPaise,
      incrementalAovPaise: Math.max(0, transaction.payload.amountPaise - (acceptedOffer.payload.baselineCartAmountPaise || 0)),
      attributableQuantity: quantity,
      status: "VERIFIED",
      verified: true,
      verifiedAt: new Date().toISOString(),
    });
    await getCommerceRepository().recordAudit(context, { eventType: "GROWTH_ATTRIBUTION_VERIFIED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { growthPlayId: acceptedOffer.payload.growthPlayId, attributableQuantity: quantity, productId: product?.id || null, amountPaise: transaction.payload.amountPaise } });
  }
  await getCommerceRepository().recordAudit(context, { eventType: "PAYMENT_VERIFIED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.payload.sessionId, policyVersionId: transaction.payload.policyVersionId, metadata: { provider: transaction.payload.provider, providerOrderId: transaction.payload.providerOrderId, providerPaymentId: input.paymentId, providerStatus: providerPayment.status, amountPaise: transaction.payload.amountPaise } });
  return getPaymentStatus(context, transaction.id);
}

/**
 * Reconcile provider webhooks against the server ledger. Webhook payloads are
 * hints only: the provider order/payment is fetched again and amount/currency
 * are matched to the immutable transaction before a payment can become PAID.
 */
export async function reconcilePaymentWebhook(context: TrustedRequestContext, input: { event: string; orderId?: string; paymentId?: string; amountPaise?: number; currency?: string }) {
  const event = input.event.toLowerCase();
  if (!event.startsWith("payment.")) return { status: "IGNORED", reason: "unsupported_event" };
  if (!input.orderId) return { status: "IGNORED", reason: "missing_order_id" };
  const repository = getCommerceRepository();
  const transaction = await repository.findTransactionByProviderOrder(context, input.orderId);
  if (!transaction) return { status: "IGNORED", reason: "transaction_not_found" };
  const store = getRuntimeStore();
  const runtimeTransaction = await store.get<TransactionPayload>(context, runtimeKinds.transaction, transaction.id);
  if (!runtimeTransaction) return { status: "IGNORED", reason: "runtime_transaction_not_found", transactionId: transaction.id };
  if (event === "payment.failed") {
    const failed = await store.transition(context, runtimeKinds.transaction, transaction.id, "CREATED", "FAILED", { ...runtimeTransaction.payload, status: "FAILED" });
    if (failed) {
      await repository.updateTransactionStatus(context, transaction.id, "FAILED");
      const payment = (await store.list<PaymentPayload>(context, runtimeKinds.payment, 200)).find((record) => record.payload.transactionId === transaction.id);
      if (payment) { await store.update(context, runtimeKinds.payment, payment.id, { status: "FAILED", payload: { ...payment.payload, status: "FAILED", providerPaymentId: input.paymentId } }); await repository.updatePayment(context, payment.id, { status: "FAILED", providerPaymentId: input.paymentId || null }); }
      await repository.recordAudit(context, { eventType: "PAYMENT_FAILED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.sessionId, policyVersionId: transaction.policyVersionId, metadata: { providerOrderId: input.orderId, providerPaymentId: input.paymentId || null, source: "webhook" } });
    }
    return { status: "FAILED", transactionId: transaction.id, changed: Boolean(failed) };
  }
  if (!(event === "payment.authorized" || event === "payment.captured")) return { status: "IGNORED", reason: "unsupported_event" };
  if (!input.paymentId) return { status: "IGNORED", reason: "missing_payment_id" };
  const adapter = getPaymentAdapter();
  const [order, providerPayment] = await Promise.all([adapter.getOrder(input.orderId), adapter.getPayment(input.paymentId)]);
  const stateAcceptable = adapter.provider === "mock" || ["authorized", "captured"].includes(providerPayment.status);
  const matches = order.id === transaction.providerOrderId && order.amountPaise === transaction.totalPaise && order.currency === transaction.currency && (!providerPayment.orderId || providerPayment.orderId === order.id) && (!providerPayment.amountPaise || providerPayment.amountPaise === transaction.totalPaise) && (!providerPayment.currency || providerPayment.currency === transaction.currency) && (!input.amountPaise || input.amountPaise === transaction.totalPaise) && (!input.currency || input.currency === transaction.currency) && stateAcceptable;
  if (!matches) {
    await repository.recordAudit(context, { eventType: "PAYMENT_PROVIDER_VERIFICATION_FAILED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.sessionId, policyVersionId: transaction.policyVersionId, metadata: { source: "webhook", providerOrderId: input.orderId, providerPaymentId: input.paymentId, providerStatus: providerPayment.status } });
    throw new Error("Payment webhook state does not match the server-authorized transaction.");
  }
  const transitioned = await store.transition(context, runtimeKinds.transaction, transaction.id, "CREATED", "PAID", { ...runtimeTransaction.payload, status: "PAID" });
  if (!transitioned) return { status: "PAID", transactionId: transaction.id, changed: false };
  const newlyPaid = await repository.markTransactionPaidOnce(context, transaction.id);
  const payment = (await store.list<PaymentPayload>(context, runtimeKinds.payment, 200)).find((record) => record.payload.transactionId === transaction.id);
  if (payment) { await store.update(context, runtimeKinds.payment, payment.id, { status: "PAID", payload: { ...payment.payload, status: "PAID", providerPaymentId: input.paymentId, providerStatus: providerPayment.status, verifiedAt: new Date().toISOString() } }); await repository.updatePayment(context, payment.id, { status: "PAID", providerPaymentId: input.paymentId }); }
  if (newlyPaid) {
    const session = await repository.getSession(context, transaction.sessionId);
    if (session) await repository.incrementCustomerAfterVerifiedPayment(context, session.customerId, transaction.totalPaise);
  }
  await repository.recordAudit(context, { eventType: "PAYMENT_WEBHOOK_RECONCILED", entityType: "transaction", entityId: transaction.id, shoppingSessionId: transaction.sessionId, policyVersionId: transaction.policyVersionId, metadata: { providerOrderId: input.orderId, providerPaymentId: input.paymentId, providerStatus: providerPayment.status, newlyPaid } });
  return { status: "PAID", transactionId: transaction.id, changed: newlyPaid };
}
