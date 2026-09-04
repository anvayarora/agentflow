import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentOrder = { id: string; amountPaise: number; currency: string; status: string; provider: "mock" | "razorpay" };
export type PaymentDetails = { id: string; status: string; orderId?: string; amountPaise?: number; currency?: string };
export type PaymentAdapter = { provider: "mock" | "razorpay"; createOrder(input: { amountPaise: number; currency: string; receipt: string; idempotencyKey: string }): Promise<PaymentOrder>; getOrder(id: string): Promise<PaymentOrder>; getPayment(id: string): Promise<PaymentDetails>; verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean; verifyWebhook(rawBody: string, signature: string): boolean };

export class PaymentConfigurationError extends Error { constructor(message: string) { super(message); this.name = "PaymentConfigurationError"; } }
export class PaymentProviderError extends Error { constructor(message: string) { super(message); this.name = "PaymentProviderError"; } }

let mockOrderCount = 0;
let paymentCreateOrderCalls = 0;
const mockOrders = new Map<string, PaymentOrder>();
export function mockPaymentCallCount() { return mockOrderCount; }
export function resetMockPaymentForTests() { mockOrderCount = 0; mockOrders.clear(); }
export function paymentCreateOrderCallCount() { return paymentCreateOrderCalls; }
export function resetPaymentInstrumentationForTests() { paymentCreateOrderCalls = 0; }

const safeEqual = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };

class MockPaymentAdapter implements PaymentAdapter {
  provider = "mock" as const;
  async createOrder(input: { amountPaise: number; currency: string; receipt: string; idempotencyKey: string }) { mockOrderCount += 1; paymentCreateOrderCalls += 1; const id = `mock-order-${crypto.randomUUID()}`; const order = { id, amountPaise: input.amountPaise, currency: input.currency, status: "created", provider: "mock" as const }; mockOrders.set(id, order); return order; }
  async getOrder(id: string) { const order = mockOrders.get(id); if (!order) throw new PaymentProviderError("Mock payment order was not found."); return order; }
  async getPayment(id: string) { return { id, status: "created", orderId: undefined, amountPaise: undefined, currency: undefined }; }
  verifyCheckoutSignature() { return true; }
  verifyWebhook() { return true; }
}

class RazorpayTestAdapter implements PaymentAdapter {
  provider = "razorpay" as const;
  private readonly keyId: string;
  private readonly secret: string;
  constructor(keyId: string, secret: string) {
    if (keyId.startsWith("rzp_live_")) throw new PaymentConfigurationError("RAZORPAY_LIVE_MODE_REFUSED");
    if (!keyId.startsWith("rzp_test_")) throw new PaymentConfigurationError("RAZORPAY_TEST_KEY_REQUIRED");
    this.keyId = keyId;
    this.secret = secret;
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://api.razorpay.com/v1${path}`, { ...init, headers: { authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString("base64")}`, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) }, signal: controller.signal });
      if (!response.ok) throw new PaymentProviderError(`Payment provider returned HTTP ${response.status}.`);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new PaymentProviderError("Payment provider request timed out.");
      throw new PaymentProviderError("Payment provider request failed.");
    } finally { clearTimeout(timeout); }
  }
  async createOrder(input: { amountPaise: number; currency: string; receipt: string; idempotencyKey: string }) { paymentCreateOrderCalls += 1; const result = await this.request<{ id: string; amount: number; currency: string; status: string }>("/orders", { method: "POST", body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt, notes: { idempotency_key: input.idempotencyKey } }) }); return { id: result.id, amountPaise: result.amount, currency: result.currency, status: result.status, provider: "razorpay" as const }; }
  async getOrder(id: string) { const result = await this.request<{ id: string; amount: number; currency: string; status: string }>(`/orders/${encodeURIComponent(id)}`); return { id: result.id, amountPaise: result.amount, currency: result.currency, status: result.status, provider: "razorpay" as const }; }
  async getPayment(id: string) { const result = await this.request<{ id: string; status: string; order_id?: string; amount?: number; currency?: string }>(`/payments/${encodeURIComponent(id)}`); return { id: result.id, status: result.status, orderId: result.order_id, amountPaise: result.amount, currency: result.currency }; }
  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }) { return safeEqual(createHmac("sha256", this.secret).update(`${input.orderId}|${input.paymentId}`).digest("hex"), input.signature); }
  verifyWebhook(rawBody: string, signature: string) { const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET; return Boolean(webhookSecret && safeEqual(createHmac("sha256", webhookSecret).update(rawBody).digest("hex"), signature)); }
}

export function getPaymentAdapter(): PaymentAdapter {
  const provider = (process.env.PAYMENT_PROVIDER || "").toLowerCase();
  if (provider === "mock") {
    if (process.env.NODE_ENV === "production") throw new PaymentConfigurationError("PRODUCTION_MOCK_PAYMENT_DISABLED");
    return new MockPaymentAdapter();
  }
  if (provider === "razorpay") {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !secret) throw new PaymentConfigurationError("Test payment credentials are not configured.");
    return new RazorpayTestAdapter(keyId, secret);
  }
  throw new PaymentConfigurationError("No payment provider is configured. Real payment execution is disabled.");
}
