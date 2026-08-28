import assert from "node:assert/strict";
import test from "node:test";

const repositoryModule = await import("../lib/server/repositories/commerce.ts");
const runtimeModule = await import("../lib/server/runtime/store.ts");
const cart = await import("../lib/commerce/catalog-service.ts");
const offers = await import("../lib/commerce/offer-service.ts");
const checkout = await import("../lib/commerce/checkout-service.ts");
const payments = await import("../lib/payments/payment-adapter.ts");
const operations = await import("../lib/merchant/operations.ts");

const context = { organizationId: "prompt5-test-org", actorType: "merchant", actorId: "prompt5-merchant", correlationId: "prompt5-correlation" };

test("approval operations are persisted in the runtime, explainable, and concurrency-safe", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-new");
  await cart.updateCart(context, session, [{ variantId: "desk-017", quantity: 1 }]);
  const offer = await offers.requestOffer(context, { sessionId: session.id, productId: "desk-017", quantity: 1, requestedDiscountBps: 500 });
  assert.equal(offer.outcome, "ESCALATE");
  const approval = await offers.requestApproval(context, offer.offerId);
  const queue = await operations.listApprovalQueue(context, { status: "PENDING" });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].approvalId, approval.approvalId);
  assert.equal(queue[0].evidence.explanation.length > 0, true);
  const results = await Promise.allSettled([offers.decideApproval(context, approval.approvalId, "COUNTER", offer.counterPricePaise), offers.decideApproval(context, approval.approvalId, "REJECT")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const detail = await operations.getApprovalQueueDetail(context, approval.approvalId);
  assert.ok(["COUNTERED", "REJECTED"].includes(detail.status));
  assert.equal(detail.decidedBy, "prompt5-merchant");
});

test("transaction operations expose only server-created and payment-verified revenue states", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  process.env.PAYMENT_PROVIDER = "mock";
  payments.resetMockPaymentForTests();
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  await cart.updateCart(context, session, [{ variantId: "desk-032", quantity: 1 }]);
  const offer = await offers.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 500 });
  await offers.acceptOffer(context, offer.offerId);
  const transaction = await checkout.createCheckout(context, { sessionId: session.id, idempotencyKey: "prompt5-transaction-1" });
  const rows = await operations.listTransactionOperations(context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transactionId, transaction.transactionId);
  assert.equal(rows[0].revenueState, "NOT_REVENUE");
  assert.equal(rows[0].classification.negotiated, true);
  assert.equal(rows[0].payment.verified, false);
});

test("audit, growth results, and red-team views use honest labels", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const repository = repositoryModule.getCommerceRepository();
  await repository.recordAudit(context, { eventType: "POLICY_EVALUATED", entityType: "simulation_run", entityId: "sim-prompt5", metadata: { kind: "SIMULATED" } });
  const events = await operations.queryAuditTrail(context, { correlationId: "prompt5-correlation" });
  assert.equal(events.length, 1);
  assert.match(events[0].explanation, /deterministic/i);
  const results = await operations.getGrowthResults(context);
  assert.equal(results.labels.simulated, "SIMULATED");
  assert.equal(results.labels.realized, "INSUFFICIENT_HISTORY");
  const redTeam = await operations.runMerchantRedTeam(context);
  assert.equal(redTeam.passed, true);
  assert.equal(redTeam.unauthorizedPaymentCalls, 0);
  assert.ok(redTeam.checks.some((check) => check.id === "80-percent-employee-discount"));
});
