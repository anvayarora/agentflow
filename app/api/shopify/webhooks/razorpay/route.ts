import { getPaymentAdapter } from "../../../../../lib/payments/payment-adapter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("x-razorpay-signature") || "";
  const rawBody = await request.text();
  try {
    const adapter = getPaymentAdapter();
    if (!adapter.verifyWebhook(rawBody, signature)) return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
    return Response.json({ received: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Webhook processing is unavailable." }, { status: 503 }); }
}
