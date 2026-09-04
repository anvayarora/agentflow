import assert from "node:assert/strict";
import test from "node:test";

const [{ getCommerceRepository, resetCommerceRepositoryForTests }, runtime, catalogue, offers, checkout, payments] = await Promise.all([
  import("../lib/server/repositories/commerce.ts"),
  import("../lib/server/runtime/store.ts"),
  import("../lib/commerce/catalog-service.ts"),
  import("../lib/commerce/offer-service.ts"),
  import("../lib/commerce/checkout-service.ts"),
  import("../lib/payments/payment-adapter.ts"),
]);
const { transcribeAudio } = await import("../lib/ai/providers/sarvam.ts");

const context = { organizationId: "p1-hardening-org", actorType: "customer", actorId: "shopper:p1", correlationId: "p1-hardening" };

test("checkout reservation elects one provider call under concurrent retries", async () => {
  resetCommerceRepositoryForTests();
  runtime.resetRuntimeStoreForTests();
  process.env.PAYMENT_PROVIDER = "mock";
  payments.resetMockPaymentForTests();
  const repository = getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  await catalogue.updateCart(context, session, [{ variantId: "desk-032", quantity: 1 }]);
  const offer = await offers.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 0 });
  await offers.acceptOffer(context, offer.offerId);
  const results = await Promise.all([
    checkout.createCheckout(context, { sessionId: session.id, idempotencyKey: "p1-concurrent-001" }),
    checkout.createCheckout(context, { sessionId: session.id, idempotencyKey: "p1-concurrent-001" }),
  ]);
  assert.equal(results[0].transactionId, results[1].transactionId);
  assert.equal(payments.mockPaymentCallCount(), 1);
  const reservation = await repository.getCheckoutReservation(context, session.id, "p1-concurrent-001");
  assert.equal(reservation?.status, "CREATED");
  assert.equal((await repository.listVerifiedTransactionLines(context)).length, 0);
});

test("verified payment persists immutable lines and updates customer once", async () => {
  resetCommerceRepositoryForTests();
  runtime.resetRuntimeStoreForTests();
  process.env.PAYMENT_PROVIDER = "mock";
  payments.resetMockPaymentForTests();
  const repository = getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-new");
  await catalogue.updateCart(context, session, [{ variantId: "desk-032", quantity: 2 }]);
  const offer = await offers.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 2, requestedDiscountBps: 0 });
  await offers.acceptOffer(context, offer.offerId);
  const created = await checkout.createCheckout(context, { sessionId: session.id, idempotencyKey: "p1-paid-001" });
  const before = structuredClone(await repository.getCustomer(context, "customer-haven-new"));
  await checkout.verifyPayment(context, { transactionId: created.transactionId, paymentId: "mock-payment-001", signature: "mock" });
  await checkout.verifyPayment(context, { transactionId: created.transactionId, paymentId: "mock-payment-001", signature: "mock" });
  const after = await repository.getCustomer(context, "customer-haven-new");
  assert.equal(after.orderCount, before.orderCount + 1);
  assert.equal(after.lifetimeValuePaise, before.lifetimeValuePaise + created.amountPaise);
  const lines = await repository.listVerifiedTransactionLines(context);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].snapshotStatus, "IMMUTABLE");
});

test("post-retrieval catalogue constraints reject products that exceed shopper requirements", async () => {
  resetCommerceRepositoryForTests();
  const repository = getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-new");
  const result = await catalogue.searchProducts(context, session, { query: "desk", maxPricePaise: 1_500_000, maxWidthCm: 120, material: "wood" });
  assert.ok(result.every((product) => product.listPricePaise <= 1_500_000));
  assert.ok(result.every((product) => Number(product.attributes.width) <= 120));
});

test("voice input rejects unsupported formats and excessive duration before provider access", async () => {
  await assert.rejects(() => transcribeAudio({ bytes: new Uint8Array([1]), mimeType: "text/plain" }), (error) => error?.statusCode === 415);
  await assert.rejects(() => transcribeAudio({ bytes: new Uint8Array([1]), mimeType: "audio/webm", durationSeconds: 121 }), (error) => error?.statusCode === 413);
});

test("audit pagination filters server-side repository records by correlation and entity metadata", async () => {
  resetCommerceRepositoryForTests();
  const repository = getCommerceRepository();
  await repository.recordAudit(context, { eventType: "CHECKOUT_CREATED", entityType: "transaction", entityId: "tx-audit-1", metadata: { transactionId: "tx-audit-1" } });
  await repository.recordAudit(context, { eventType: "PAYMENT_VERIFIED", entityType: "transaction", entityId: "tx-audit-2", correlationId: "other-correlation", metadata: { transactionId: "tx-audit-2" } });
  const filtered = await repository.listAudit(context, { transactionId: "tx-audit-1", correlationId: context.correlationId, limit: 10 });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].entityId, "tx-audit-1");
});
