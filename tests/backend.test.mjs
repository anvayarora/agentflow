import assert from "node:assert/strict";
import test from "node:test";

const [{ compileDemoPolicyProposal }, money, evaluator, repositoryModule, sessionsRoute, evaluateRoute, proxyModule, profileRoute, shopifyProxyRoute] = await Promise.all([
  import("../lib/policy/compiler.ts"),
  import("../lib/domain/money.ts"),
  import("../lib/policy/evaluator.ts"),
  import("../lib/server/repositories/commerce.ts"),
  import("../app/api/commerce/sessions/route.ts"),
  import("../app/api/commerce/evaluate/route.ts"),
  import("../lib/server/shopify/proxy.ts"),
  import("../app/profiles/agentflow-ucp.json/route.ts"),
  import("../app/api/shopify/proxy/chat/route.ts"),
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

test("Shopify proxy verification binds shop and customer identity", () => {
  const secret = "proxy-test-secret";
  const timestamp = 1_787_570_000;
  const requestUrl = new URL(`https://agentflow.test/api/shopify/proxy/chat?shop=${encodeURIComponent("haven-home-k1gerlw9.myshopify.com")}&logged_in_customer_id=customer-123&path_prefix=%2Fapps%2Fagentflow&timestamp=${timestamp}`);
  requestUrl.searchParams.set("signature", proxyModule.calculateShopifyProxySignature(requestUrl, secret));
  const verified = proxyModule.verifyShopifyProxyRequest(new Request(requestUrl), { secret, nowSeconds: timestamp, expectedShopDomain: "haven-home-k1gerlw9.myshopify.com" });
  assert.equal(verified.shopDomain, "haven-home-k1gerlw9.myshopify.com");
  assert.equal(verified.loggedInCustomerId, "customer-123");
  assert.throws(() => proxyModule.verifyShopifyProxyRequest(new Request(requestUrl.toString().replace("customer-123", "spoofed-customer")), { secret, nowSeconds: timestamp, expectedShopDomain: "haven-home-k1gerlw9.myshopify.com" }), /invalid/i);
  assert.throws(() => proxyModule.verifyShopifyProxyRequest(new Request(requestUrl), { secret, nowSeconds: timestamp + 301, expectedShopDomain: "haven-home-k1gerlw9.myshopify.com" }), /replay window/i);
});

test("Shopify UCP profile advertises only AgentFlow catalog and cart capabilities", async () => {
  const response = await profileRoute.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ucp.version, "2026-04-08");
  assert.ok(body.ucp.capabilities["dev.ucp.shopping.cart"]);
  assert.ok(body.ucp.capabilities["dev.ucp.shopping.catalog.search"]);
  assert.deepEqual(body.ucp.payment_handlers, {});
});

test("Shopify sessions bind to the verified customer and never treat USD minor units as INR paise", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createShopifySession(context, { shopDomain: "haven-home-k1gerlw9.myshopify.com", shopifyCustomerId: "shopify-customer-123", currency: "USD", cart: { id: "gid://shopify/Cart/test", lineItems: [], totals: [{ type: "total", amount: 69995 }], messages: [], raw: {} } });
  assert.equal(session.shopifyShopDomain, "haven-home-k1gerlw9.myshopify.com");
  assert.equal(session.shopifyCustomerId, "shopify-customer-123");
  assert.equal(session.cartTotalPaise, 0);
});

test("direct Shopify proxy calls without a valid signature are rejected", async () => {
  process.env.SHOPIFY_API_SECRET = "proxy-test-secret";
  process.env.SHOPIFY_STORE_DOMAIN = "haven-home-k1gerlw9.myshopify.com";
  const response = await shopifyProxyRoute.POST(new Request("http://localhost/api/shopify/proxy/chat?shop=haven-home-k1gerlw9.myshopify.com&timestamp=1787570000", { method: "POST", body: JSON.stringify({ message: "hello" }), headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 401);
});

test("valid Shopify proxy request creates an anonymous server-owned session", async () => {
  process.env.SHOPIFY_API_SECRET = "proxy-test-secret";
  process.env.SHOPIFY_STORE_DOMAIN = "haven-home-k1gerlw9.myshopify.com";
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(`http://localhost/api/shopify/proxy/chat?shop=haven-home-k1gerlw9.myshopify.com&path_prefix=%2Fapps%2Fagentflow&timestamp=${timestamp}`);
  url.searchParams.set("signature", proxyModule.calculateShopifyProxySignature(url, "proxy-test-secret"));
  const response = await shopifyProxyRoute.POST(new Request(url, { method: "POST", body: JSON.stringify({ message: "Find a desk", storefrontContext: { pageType: "home", hintedProductId: "client-hint" } }), headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.sessionId);
  assert.equal(body.status, "AGENT_BACKEND_NOT_READY");
  assert.equal(body.connection.customerContext, "anonymous_shopify_customer");
});
