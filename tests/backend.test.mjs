import assert from "node:assert/strict";
import test from "node:test";

const [{ compileDemoPolicyProposal }, money, evaluator, repositoryModule, sessionsRoute, evaluateRoute, proxyModule, profileRoute, shopifyProxyRoute, runtimeModule, cartModule, catalogModule, offerModule, checkoutModule, simulationModule, redTeamModule, paymentModule, checkoutRoute, webhookRoute] = await Promise.all([
  import("../lib/policy/compiler.ts"),
  import("../lib/domain/money.ts"),
  import("../lib/policy/evaluator.ts"),
  import("../lib/server/repositories/commerce.ts"),
  import("../app/api/commerce/sessions/route.ts"),
  import("../app/api/commerce/evaluate/route.ts"),
  import("../lib/server/shopify/proxy.ts"),
  import("../app/profiles/agentflow-ucp.json/route.ts"),
  import("../app/api/shopify/proxy/chat/route.ts"),
  import("../lib/server/runtime/store.ts"),
  import("../lib/commerce/cart.ts"),
  import("../lib/commerce/catalog-service.ts"),
  import("../lib/commerce/offer-service.ts"),
  import("../lib/commerce/checkout-service.ts"),
  import("../lib/simulation/engine.ts"),
  import("../lib/security/red-team.ts"),
  import("../lib/payments/payment-adapter.ts"),
  import("../app/api/commerce/checkout/route.ts"),
  import("../app/api/shopify/webhooks/razorpay/route.ts"),
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
  const previousNimKey = process.env.NIM_API_KEY;
  delete process.env.NIM_API_KEY;
  const response = await shopifyProxyRoute.POST(new Request(url, { method: "POST", body: JSON.stringify({ message: "Find a desk", storefrontContext: { pageType: "home", hintedProductId: "client-hint" } }), headers: { "content-type": "application/json" } }));
  if (previousNimKey) process.env.NIM_API_KEY = previousNimKey;
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(body.sessionId);
  assert.equal(body.status, "PROVIDER_UNAVAILABLE");
  assert.notEqual(body.status, "AGENT_BACKEND_NOT_READY");
  assert.equal(body.connection.customerContext, "anonymous_shopify_customer");
});

test("runtime records persist across independent service instances with tenant scope", async () => {
  runtimeModule.resetRuntimeStoreForTests();
  const store = runtimeModule.getRuntimeStore();
  await store.put(context, { id: "persistent-pref", kind: runtimeModule.runtimeKinds.shopperPreferences, status: "ACTIVE", payload: { budgetMaxPaise: 500_000, categories: [] } });
  const reread = await new runtimeModule.RuntimeStore().get(context, runtimeModule.runtimeKinds.shopperPreferences, "persistent-pref");
  assert.equal(reread.payload.budgetMaxPaise, 500_000);
  assert.equal(await runtimeModule.getRuntimeStore().get({ ...context, organizationId: "other-org" }, runtimeModule.runtimeKinds.shopperPreferences, "persistent-pref"), null);
});

test("canonical cart hash binds accepted offers to the exact cart", async () => {
  const first = cartModule.hashCart({ currency: "INR", lines: [{ variantId: "v-1", quantity: 1, unitPricePaise: 100_00 }] });
  const reordered = cartModule.hashCart({ currency: "INR", lines: [{ variantId: "v-1", quantity: 1, unitPricePaise: 100_00 }] });
  const changed = cartModule.hashCart({ currency: "INR", lines: [{ variantId: "v-1", quantity: 2, unitPricePaise: 100_00 }] });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("offer acceptance and checkout are server-owned and idempotent", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  process.env.PAYMENT_PROVIDER = "mock";
  paymentModule.resetMockPaymentForTests();
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  await cartModule.hashCart({ currency: "INR", lines: [] });
  await catalogModule.updateCart(context, session, [{ variantId: "desk-032", quantity: 1 }]);
  const offer = await offerModule.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 500 });
  assert.equal(offer.outcome, "ALLOW");
  await offerModule.acceptOffer(context, offer.offerId);
  const checkout = await checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "idempotency-test-001" });
  const duplicate = await checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "idempotency-test-001" });
  assert.equal(duplicate.transactionId, checkout.transactionId);
  await runtimeModule.getRuntimeStore().update(context, runtimeModule.runtimeKinds.offer, offer.offerId, { expiresAt: new Date(0).toISOString() });
  const duplicateAfterOfferExpiry = await checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "idempotency-test-001" });
  assert.equal(duplicateAfterOfferExpiry.transactionId, checkout.transactionId);
  assert.equal(paymentModule.mockPaymentCallCount(), 1);
  assert.equal((await checkoutModule.getPaymentStatus(context, checkout.transactionId)).status, "CREATED");
});

test("checkout rejects client-supplied monetary authority", async () => {
  const response = await checkoutRoute.POST(new Request("http://localhost/api/commerce/checkout", { method: "POST", body: JSON.stringify({ sessionId: "session", idempotencyKey: "idempotency-001", amountPaise: 1, requestedPricePaise: 1 }), headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 400);
});

test("unauthorized and cart-unbound checkout paths make zero provider order calls", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  process.env.PAYMENT_PROVIDER = "mock";
  paymentModule.resetMockPaymentForTests();
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  await assert.rejects(() => checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "unauthorized-001" }));
  assert.equal(paymentModule.mockPaymentCallCount(), 0);
  const offer = await offerModule.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 0 });
  await offerModule.acceptOffer(context, offer.offerId);
  await assert.rejects(() => checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "unbound-offer-001" }), /not bound/i);
  assert.equal(paymentModule.mockPaymentCallCount(), 0);
});

test("Razorpay live keys are refused before any provider request", () => {
  const previous = { provider: process.env.PAYMENT_PROVIDER, key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  process.env.PAYMENT_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_live_refused";
  process.env.RAZORPAY_KEY_SECRET = "not-a-secret";
  assert.throws(() => paymentModule.getPaymentAdapter(), /RAZORPAY_LIVE_MODE_REFUSED/);
  if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = previous.provider;
  if (previous.key === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = previous.key;
  if (previous.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = previous.secret;
});

test("verified Razorpay callback requires provider order and payment state", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const previous = { provider: process.env.PAYMENT_PROVIDER, key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET, fetch: globalThis.fetch };
  process.env.PAYMENT_PROVIDER = "razorpay";
  process.env.RAZORPAY_KEY_ID = "rzp_test_unit";
  process.env.RAZORPAY_KEY_SECRET = "unit-secret";
  const providerOrder = { id: "order_unit", amount: 1_349_900, currency: "INR", status: "created" };
  globalThis.fetch = async (url) => {
    const path = String(url);
    const body = path.endsWith("/orders") ? providerOrder : path.endsWith("/orders/order_unit") ? providerOrder : { id: "pay_unit", status: "captured", order_id: "order_unit", amount: 1_349_900, currency: "INR" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const repository = repositoryModule.getCommerceRepository();
  const session = await repository.createSession(context, "customer-haven-repeat");
  await catalogModule.updateCart(context, session, [{ variantId: "desk-032", quantity: 1 }]);
  const offer = await offerModule.requestOffer(context, { sessionId: session.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 0 });
  await offerModule.acceptOffer(context, offer.offerId);
  const checkout = await checkoutModule.createCheckout(context, { sessionId: session.id, idempotencyKey: "razorpay-unit-001" });
  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha256", "unit-secret").update("order_unit|pay_unit").digest("hex");
  const verified = await checkoutModule.verifyPayment(context, { transactionId: checkout.transactionId, orderId: "order_unit", paymentId: "pay_unit", signature });
  assert.equal(verified.status, "PAID");
  globalThis.fetch = previous.fetch;
  if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = previous.provider;
  if (previous.key === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = previous.key;
  if (previous.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = previous.secret;
});

test("Razorpay webhook signature is idempotently persisted", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const previous = { provider: process.env.PAYMENT_PROVIDER, secret: process.env.RAZORPAY_WEBHOOK_SECRET };
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
  const raw = JSON.stringify({ id: "evt_unit_001", event: "payment.captured" });
  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");
  const request = () => new Request("http://localhost/api/shopify/webhooks/razorpay", { method: "POST", body: raw, headers: { "x-razorpay-signature": signature, "content-type": "application/json" } });
  assert.deepEqual(await (await webhookRoute.POST(request())).json(), { received: true, duplicate: false });
  assert.deepEqual(await (await webhookRoute.POST(request())).json(), { received: true, duplicate: true });
  if (previous.provider === undefined) delete process.env.PAYMENT_PROVIDER; else process.env.PAYMENT_PROVIDER = previous.provider;
  if (previous.secret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = previous.secret;
});

test("missing economics creates approval state and merchant counter is scoped", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const repository = repositoryModule.getCommerceRepository();
  const shopper = await repository.createSession(context, "customer-haven-repeat");
  const offer = await offerModule.requestOffer(context, { sessionId: shopper.id, productId: "desk-017", quantity: 1, requestedDiscountBps: 500 });
  assert.equal(offer.outcome, "ESCALATE");
  const approval = await offerModule.requestApproval(context, offer.offerId);
  const merchant = { ...context, actorType: "merchant", actorId: "merchant-qa" };
  const decision = await offerModule.decideApproval(merchant, approval.approvalId, "COUNTER", 100_00);
  assert.equal(decision.status, "COUNTERED");
  const storedOffer = await runtimeModule.getRuntimeStore().get(merchant, runtimeModule.runtimeKinds.offer, offer.offerId);
  assert.equal(storedOffer.payload.status, "COUNTERED");
  assert.ok(storedOffer.payload.overrideId);
});

test("simulation and red-team checks reuse the deterministic runtime", async () => {
  repositoryModule.resetCommerceRepositoryForTests();
  runtimeModule.resetRuntimeStoreForTests();
  const simulation = await simulationModule.runSimulation(context, [{ id: "case-1", productId: "desk-032", customerId: "customer-haven-repeat", quantity: 1, requestedDiscountBps: 8000 }]);
  assert.ok(["COUNTER", "ESCALATE"].includes(simulation.results[0].outcome));
  const redTeam = await redTeamModule.runRedTeamSuite(context);
  assert.equal(redTeam.passed, true);
});
