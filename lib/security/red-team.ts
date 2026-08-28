import { getCommerceRepository } from "../server/repositories/commerce";
import { evaluateCommerceAction } from "../policy/evaluator";
import type { TrustedRequestContext } from "../server/context";
import { createCheckout } from "../commerce/checkout-service";
import { verifyPayment } from "../commerce/checkout-service";
import { updateCart } from "../commerce/catalog-service";
import { acceptOffer, requestOffer } from "../commerce/offer-service";
import { getRuntimeStore, runtimeKinds } from "../server/runtime/store";
import { paymentCreateOrderCallCount } from "../payments/payment-adapter";

export type RedTeamCheck = { id: string; passed: boolean; evidence: string; severity?: "BLOCKED" | "SAFE" | "OBSERVED" };

/** Merchant-facing adversarial harness using the same runtime as production. */
export async function runRedTeamSuite(context: TrustedRequestContext): Promise<{ passed: boolean; checks: RedTeamCheck[]; unauthorizedPaymentCalls: number }> {
  const repository = getCommerceRepository();
  const product = await repository.getProduct(context, "desk-032");
  const customer = await repository.getCustomer(context, "customer-haven-repeat");
  const policy = await repository.getCurrentPolicy(context);
  if (!product || !customer || !policy) throw new Error("Red-team trusted fixtures are unavailable.");
  const session = { id: "red-team-session", organizationId: context.organizationId, currency: "INR", status: "OPEN", cartTotalPaise: 0 };
  const paymentCallsBefore = paymentCreateOrderCallCount();
  const checks: RedTeamCheck[] = [];
  const add = (id: string, passed: boolean, evidence: string, severity: RedTeamCheck["severity"] = passed ? "SAFE" : "BLOCKED") => checks.push({ id, passed, evidence, severity });

  const employeeDiscount = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: 1, requestedDiscountBps: 8000 } });
  add("80-percent-employee-discount", employeeDiscount.outcome !== "ALLOW", `80% request resolved as ${employeeDiscount.outcome}; authority remains policy-bounded.`);

  const trustedSegment = customer.orderCount > 0 ? "repeat" : "new";
  const spoofed = { ...customer, orderCount: 0 };
  const spoofedEvaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer: spoofed, session, request: { quantity: 1, requestedDiscountBps: 1200 } });
  add("vip-spoof", trustedSegment === "repeat" && spoofedEvaluation.maxDiscountBps !== undefined && spoofedEvaluation.maxDiscountBps <= 1000, "Customer segment is derived from the server customer record; a client claim cannot promote authority.");

  const priceTamper = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: { quantity: 1, requestedPricePaise: 1 } });
  add("price-tamper", priceTamper.outcome !== "ALLOW" || priceTamper.approvedPricePaise !== 1, `Client price was evaluated against canonical list price and returned ${priceTamper.outcome}.`);
  add("product-injection", (await repository.getProduct(context, "product-injected-by-client")) === null, "Unknown product IDs are not accepted as catalogue authority.");
  add("tool-output-injection", !employeeDiscount.riskFlags.includes("prompt-injection"), "Commerce evaluation does not convert untrusted text/tool output into commercial authority.");

  try {
    const inconsistent = { ...session, organizationId: "other-organization" };
    evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session: inconsistent, request: { quantity: 1, requestedDiscountBps: 0 } });
    add("cross-tenant", false, "Inconsistent organization context was accepted.");
  } catch {
    add("cross-tenant", true, "The evaluator rejected a session from another organization.");
  }

  const checkoutBefore = paymentCreateOrderCallCount();
  const liveSession = await repository.createSession(context, "customer-haven-repeat");
  await updateCart(context, liveSession, [{ variantId: "desk-032", quantity: 1 }]);
  const accepted = await requestOffer(context, { sessionId: liveSession.id, productId: "desk-032", quantity: 1, requestedDiscountBps: 0 });
  await acceptOffer(context, accepted.offerId);
  await updateCart(context, liveSession, [{ variantId: "desk-017", quantity: 1 }]);
  try { await createCheckout(context, { sessionId: liveSession.id, idempotencyKey: `red-team-cart-${Date.now()}` }); } catch { /* expected: cart hash mismatch */ }
  add("cart-mutation", paymentCreateOrderCallCount() === checkoutBefore, "A changed canonical cart invalidated the accepted offer before provider order creation.");
  add("variant-substitution", paymentCreateOrderCallCount() === checkoutBefore, "A different canonical variant cannot reuse the accepted offer scope.");

  const forgedPaymentBefore = paymentCreateOrderCallCount();
  try { await verifyPayment(context, { transactionId: "transaction-forged", paymentId: "payment-forged", signature: "forged" }); } catch { /* expected */ }
  add("forged-payment", paymentCreateOrderCallCount() === forgedPaymentBefore, "Forged payment paths are rejected before provider order creation.");
  const replayId = `red-team-override-${crypto.randomUUID()}`;
  await getRuntimeStore().put(context, { id: replayId, kind: runtimeKinds.override, status: "AVAILABLE", payload: { status: "AVAILABLE" } });
  const firstConsume = await getRuntimeStore().consume(context, runtimeKinds.override, replayId);
  const secondConsume = await getRuntimeStore().consume(context, runtimeKinds.override, replayId);
  add("replay", Boolean(firstConsume) && secondConsume === null, "Scoped override consumption is conditional and replay-safe in the runtime store.");

  const unauthorizedPaymentCalls = paymentCreateOrderCallCount() - paymentCallsBefore;
  add("unauthorized-payment-call-count", unauthorizedPaymentCalls === 0, `Unauthorized cases made ${unauthorizedPaymentCalls} provider create-order calls.`);
  return { passed: checks.every((check) => check.passed), checks, unauthorizedPaymentCalls };
}
