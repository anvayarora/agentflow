import { getPaymentAdapter } from "../../../../../lib/payments/payment-adapter";
import { createHash } from "node:crypto";
import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";
import { getTrustedRequestContext } from "../../../../../lib/server/context";
import { reconcilePaymentWebhook } from "../../../../../lib/commerce/checkout-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("x-razorpay-signature") || "";
  const rawBody = await request.text();
  try {
    const adapter = getPaymentAdapter();
    if (!adapter.verifyWebhook(rawBody, signature)) return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const eventId = typeof payload.id === "string" && payload.id.trim() ? payload.id : createHash("sha256").update(rawBody).digest("hex");
    const context = getTrustedRequestContext(request);
    const repository = getCommerceRepository();
    const rawBodyHash = createHash("sha256").update(rawBody).digest("hex");
    const firstReceipt = await repository.recordWebhookReceipt(context, { id: `webhook-${eventId}`, provider: "razorpay", providerEventId: eventId, rawBodyHash });
    if (!firstReceipt) {
      await getCommerceRepository().recordAudit(context, { eventType: "WEBHOOK_DUPLICATE", entityType: "payment_webhook", entityId: eventId, metadata: { provider: "razorpay" } });
      return Response.json({ received: true, duplicate: true });
    }
    await getCommerceRepository().recordAudit(context, { eventType: "WEBHOOK_RECEIVED", entityType: "payment_webhook", entityId: eventId, metadata: { provider: "razorpay" } });
    const event = typeof payload.event === "string" ? payload.event : "";
    const paymentEntity: Record<string, unknown> | null = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) && (payload.payload as Record<string, unknown>).payment && typeof (payload.payload as Record<string, unknown>).payment === "object" ? (((payload.payload as Record<string, unknown>).payment as Record<string, unknown>).entity as Record<string, unknown> | null) : null;
    try {
      const result = await reconcilePaymentWebhook(context, { event, orderId: paymentEntity && typeof paymentEntity.order_id === "string" ? paymentEntity.order_id : undefined, paymentId: paymentEntity && typeof paymentEntity.id === "string" ? paymentEntity.id : undefined, amountPaise: paymentEntity && typeof paymentEntity.amount === "number" ? paymentEntity.amount : undefined, currency: paymentEntity && typeof paymentEntity.currency === "string" ? paymentEntity.currency : undefined });
      await repository.updateWebhookReceipt(context, `webhook-${eventId}`, result.status === "FAILED" ? "FAILED" : "PROCESSED");
    } catch (error) {
      await repository.updateWebhookReceipt(context, `webhook-${eventId}`, "FAILED");
      return Response.json({ error: error instanceof Error ? error.message : "Webhook reconciliation failed." }, { status: 422 });
    }
    return Response.json({ received: true, duplicate: false });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Webhook processing is unavailable." }, { status: 503 }); }
}
