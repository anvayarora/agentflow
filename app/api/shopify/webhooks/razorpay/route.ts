import { getPaymentAdapter } from "../../../../../lib/payments/payment-adapter";
import { createHash } from "node:crypto";
import { getRuntimeStore, runtimeKinds, type RuntimeRecord } from "../../../../../lib/server/runtime/store";
import { getCommerceRepository } from "../../../../../lib/server/repositories/commerce";
import { getTrustedRequestContext } from "../../../../../lib/server/context";

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
    const store = getRuntimeStore();
    const existing = await store.get(context, runtimeKinds.webhook, eventId);
    if (existing) {
      await getCommerceRepository().recordAudit(context, { eventType: "WEBHOOK_DUPLICATE", entityType: "payment_webhook", entityId: eventId, metadata: { provider: "razorpay" } });
      return Response.json({ received: true, duplicate: true });
    }
    const record: RuntimeRecord<{ provider: string; event: Record<string, unknown>; rawBodyHash: string; receivedAt: string }> = { id: eventId, organizationId: context.organizationId, kind: runtimeKinds.webhook, status: "RECEIVED", payload: { provider: "razorpay", event: payload, rawBodyHash: createHash("sha256").update(rawBody).digest("hex"), receivedAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await store.put(context, record);
    await getCommerceRepository().recordAudit(context, { eventType: "WEBHOOK_RECEIVED", entityType: "payment_webhook", entityId: eventId, metadata: { provider: "razorpay" } });
    return Response.json({ received: true, duplicate: false });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Webhook processing is unavailable." }, { status: 503 }); }
}
