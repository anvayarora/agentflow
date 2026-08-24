import assert from "node:assert/strict";
import test from "node:test";

const [{ compileDemoPolicyProposal }, money, evaluator, repositoryModule, sessionsRoute, evaluateRoute] = await Promise.all([
  import("../lib/policy/compiler.ts"),
  import("../lib/domain/money.ts"),
  import("../lib/policy/evaluator.ts"),
  import("../lib/server/repositories/commerce.ts"),
  import("../app/api/commerce/sessions/route.ts"),
  import("../app/api/commerce/evaluate/route.ts"),
]);

const org = "org_haven_home_demo";
const context = { organizationId: org, actorType: "system", actorId: "backend-test", correlationId: "backend-test-correlation" };

const makeProduct = (overrides = {}) => ({ id: "qa-product", organizationId: org, externalId: "qa-product", sku: "QA-001", name: "QA product", description: "QA product", category: "Desks", brand: "Haven Home", currency: "INR", listPricePaise: 100_00, costPaise: 50_00, stock: 20, attributes: {}, tags: [], imageUrl: null, source: "test", sourceUpdatedAt: null, ...overrides });
const makeCustomer = (overrides = {}) => ({ id: "qa-customer", organizationId: org, externalCustomerId: null, emailHash: null, orderCount: 0, lifetimeValuePaise: 0, lastOrderAt: null, attributes: {}, ...overrides });
const makeSession = (overrides = {}) => ({ id: "qa-session", organizationId: org, currency: "INR", status: "OPEN", cartTotalPaise: 0, ...overrides });
const policy = compileDemoPolicyProposal("Standard customers can receive up to 10%. Repeat customers can receive up to 15%. Never go below 25% gross margin. Do not discount products below 10 units in stock. Orders above ₹50,000 require merchant approval.", { organizationId: org, version: 1 }).policy;

const evaluate = ({ product = makeProduct(), customer = makeCustomer(), request = { quantity: 1, requestedDiscountBps: 0 }, rules = policy.rules } = {}) => evaluator.evaluateCommerceAction({ organizationId: org, policy: { ...policy, rules }, product, customer, session: makeSession(), request });

test("money uses integer paise and basis points", () => {
  assert.equal(money.percentageToBps("25"), 2500);
  assert.equal(money.paiseFromRupees("13,499.00"), 1_349_900);
  const minimum = money.calculateMinimumAllowedPriceFromMargin(928_000, 2500);
  assert.ok(minimum > 928_000);
  assert.ok(money.calculateGrossMarginBps(minimum, 928_000) >= 2500);
  assert.equal(money.calculatePriceAfterDiscount(1_349_900, 1000), 1_214_910);
});

test("hard brand and inventory constraints override customer authority", () => {
  const aster = evaluate({ product: makeProduct({ brand: "Aster" }), request: { quantity: 1, requestedDiscountBps: 500 } });
  assert.notEqual(aster.outcome, "ALLOW");
  assert.equal(aster.maxDiscountBps, 0);
  const lowStock = evaluate({ product: makeProduct({ stock: 9 }), request: { quantity: 1, requestedDiscountBps: 100 } });
  assert.equal(lowStock.outcome, "DENY");
});

test("high-stock accessories add authority but remain bounded", () => {
  const accessory = evaluate({ product: makeProduct({ category: "Accessories", stock: 168, listPricePaise: 129_900, costPaise: 53_000 }), request: { quantity: 1, requestedDiscountBps: 1200 } });
  assert.equal(accessory.outcome, "ALLOW");
  assert.equal(accessory.maxDiscountBps, 1300);
});

test("missing cost and high-value requests fail safe", () => {
  const missingCost = evaluate({ product: makeProduct({ costPaise: null }), request: { quantity: 1, requestedDiscountBps: 100 } });
  assert.equal(missingCost.outcome, "ESCALATE");
  assert.ok(missingCost.riskFlags.includes("missing-cost"));
  const highValue = evaluate({ product: makeProduct({ listPricePaise: 1_349_900 }), request: { quantity: 4, requestedDiscountBps: 0 } });
  assert.equal(highValue.outcome, "ESCALATE");
  assert.ok(highValue.requiresApproval);
});

test("an extreme discount is a commercial request, not prompt injection", () => {
  const result = evaluate({ request: { quantity: 1, requestedDiscountBps: 8000 } });
  assert.ok(["COUNTER", "ESCALATE"].includes(result.outcome));
  assert.ok(!result.riskFlags.includes("prompt-injection"));
});

test("customer segment is derived from trusted order history", () => {
  const newCustomer = evaluate({ customer: makeCustomer({ orderCount: 0 }), request: { quantity: 1, requestedDiscountBps: 1200 } });
  const repeatCustomer = evaluate({ customer: makeCustomer({ orderCount: 2 }), request: { quantity: 1, requestedDiscountBps: 1200 } });
  assert.equal(newCustomer.outcome, "COUNTER");
  assert.equal(repeatCustomer.outcome, "ALLOW");
});

test("rule input order does not change a decision", () => {
  const baseline = evaluate({ request: { quantity: 1, requestedDiscountBps: 1200 } });
  for (let index = 0; index < 100; index += 1) {
    const shuffled = [...policy.rules].sort(() => Math.random() - 0.5);
    const result = evaluate({ request: { quantity: 1, requestedDiscountBps: 1200 }, rules: shuffled });
    assert.deepEqual({ outcome: result.outcome, maxDiscountBps: result.maxDiscountBps, matchedRules: result.matchedRules }, { outcome: baseline.outcome, maxDiscountBps: baseline.maxDiscountBps, matchedRules: baseline.matchedRules });
  }
});

test("published version remains immutable while a new draft is created", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  const repository = repositoryModule.getCommerceRepository();
  const published = await repository.getCurrentPolicy(context);
  assert.ok(published);
  const draft = await repository.createDraft(context);
  assert.equal(draft.status, "DRAFT");
  assert.ok(draft.version > published.version);
  const changed = { ...draft, rules: draft.rules.map((rule) => rule.id === "global-max-discount" && rule.effect.type === "SET_MAX_DISCOUNT_BPS" ? { ...rule, effect: { ...rule.effect, valueBps: 600 } } : rule) };
  await repository.updateDraft(context, draft.id, changed);
  const next = await repository.publishDraft(context, draft.id);
  assert.equal(next.status, "PUBLISHED");
  assert.notEqual(next.id, published.id);
  assert.equal((await repository.getPolicyVersion(context, published.id)).status, "ARCHIVED");
});

test("discrepancy resolution mutates the draft IR and clears validation", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  const repository = repositoryModule.getCommerceRepository();
  const proposal = compileDemoPolicyProposal("Standard customers can receive 10%. Repeat customers can receive 15%. VIP customers may receive 20%. Maintain 25% margin.", { organizationId: org, version: 1 });
  assert.ok(proposal.discrepancies.some((item) => item.id === "vip-precedence"));
  const draft = await repository.createDraft(context, proposal.policy);
  const before = await repository.validateDraft(context, draft.id);
  assert.ok(before.discrepancies.some((item) => item.id === "vip-precedence"));
  const after = await repository.resolveDraftDiscrepancy(context, draft.id, "vip-precedence", 1500);
  assert.equal(after.validation.discrepancies.length, 0);
  assert.match(after.policy.sourcePrompt || "", /VIP_RESOLUTION/);
});

test("HTTP routes ignore client identity and merchant authority", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  const sessionResponse = await sessionsRoute.POST(new Request("http://localhost/api/commerce/sessions", { method: "POST", body: JSON.stringify({ customerId: "customer-haven-new", customerSegment: "new", organizationId: "other-org", policy: { standardMaxDiscount: 99 } }), headers: { "content-type": "application/json" } }));
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.equal(session.customerSegment, "repeat");
  const rejected = await evaluateRoute.POST(new Request("http://localhost/api/commerce/evaluate", { method: "POST", body: JSON.stringify({ sessionId: session.sessionId, productId: "desk-032", quantity: 1, requestedDiscountBps: 500, policy: { standardMaxDiscount: 99 }, customerSegment: "repeat" }), headers: { "content-type": "application/json" } }));
  assert.equal(rejected.status, 400);
  const valid = await evaluateRoute.POST(new Request("http://localhost/api/commerce/evaluate", { method: "POST", body: JSON.stringify({ sessionId: session.sessionId, productId: "desk-032", quantity: 1, requestedDiscountBps: 500 }), headers: { "content-type": "application/json" } }));
  assert.equal(valid.status, 200);
  const result = await valid.json();
  assert.ok(result.policyVersionId);
  assert.ok(["ALLOW", "COUNTER", "ESCALATE", "DENY"].includes(result.outcome));
});
