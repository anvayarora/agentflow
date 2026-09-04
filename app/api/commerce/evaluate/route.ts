import { z } from "zod";
import { evaluateCommerceAction } from "../../../../lib/policy/evaluator";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { assertSignedShopperBoundary } from "../../../../lib/server/route-guards";

export const runtime = "nodejs";

const commerceRequestSchema = z.object({
  sessionId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(1_000),
  requestedPricePaise: z.number().int().min(0).optional(),
  requestedDiscountBps: z.number().int().min(0).max(10_000).optional(),
}).strict().refine((value) => value.requestedPricePaise === undefined || value.requestedDiscountBps === undefined, { message: "Send requestedPricePaise or requestedDiscountBps, not both." });

export async function POST(request: Request) {
  const boundary = assertSignedShopperBoundary(request);
  if (boundary) return boundary;
  const context = getTrustedRequestContext(request);
  try {
    const parsed = commerceRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Invalid commerce request.", details: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
    const repository = getCommerceRepository();
    const session = await repository.getSession(context, parsed.data.sessionId);
    if (!session) return Response.json({ error: "Shopping session not found." }, { status: 404 });
    const product = await repository.getProduct(context, parsed.data.productId);
    if (!product) return Response.json({ error: "Product not found." }, { status: 404 });
    const customer = await repository.getCustomer(context, session.customerId);
    const policy = await repository.getCurrentPolicy(context);
    if (!customer || !policy) return Response.json({ error: "Trusted commerce context is incomplete." }, { status: 503 });
    await repository.recordAudit(context, { eventType: "COMMERCE_ACTION_REQUESTED", shoppingSessionId: session.id, policyVersionId: policy.id, entityType: "commerce_action", entityId: `${session.id}:${product.id}`, metadata: { productId: product.id, quantity: parsed.data.quantity, requestedPricePaise: parsed.data.requestedPricePaise, requestedDiscountBps: parsed.data.requestedDiscountBps } });
    const evaluation = evaluateCommerceAction({ organizationId: context.organizationId, policy, product, customer, session, request: parsed.data });
    const offerId = `offer-${crypto.randomUUID()}`;
    await repository.recordOffer(context, { id: offerId, organizationId: context.organizationId, sessionId: session.id, productId: product.id, policyVersionId: policy.id, evaluation, quantity: parsed.data.quantity, requestedDiscountBps: parsed.data.requestedDiscountBps ?? 0, createdAt: new Date().toISOString() });
    await repository.recordAudit(context, { eventType: "POLICY_EVALUATED", shoppingSessionId: session.id, policyVersionId: policy.id, entityType: "offer", entityId: offerId, metadata: { outcome: evaluation.outcome, matchedRules: evaluation.matchedRules } });
    const outcomeEvent = { ALLOW: "OFFER_ALLOWED", COUNTER: "OFFER_COUNTERED", ESCALATE: "OFFER_ESCALATED", DENY: "OFFER_DENIED" }[evaluation.outcome] as "OFFER_ALLOWED" | "OFFER_COUNTERED" | "OFFER_ESCALATED" | "OFFER_DENIED";
    await repository.recordAudit(context, { eventType: outcomeEvent, shoppingSessionId: session.id, policyVersionId: policy.id, entityType: "offer", entityId: offerId, metadata: { outcome: evaluation.outcome } });
    return Response.json({ ...evaluation, offerId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Commerce evaluation failed." }, { status: 400 });
  }
}
