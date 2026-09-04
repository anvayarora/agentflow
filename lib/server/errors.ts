export type AgentFlowErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "TENANT_MISMATCH"
  | "POLICY_DENIED"
  | "STALE_CART"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PAYMENT_VERIFICATION_FAILED"
  | "INSUFFICIENT_HISTORY"
  | "REQUEST_FAILED";

function codeFor(error: unknown, fallback: AgentFlowErrorCode): AgentFlowErrorCode {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code as AgentFlowErrorCode;
  }
  const message = error instanceof Error ? error.message : "";
  if (/provider|sarvam|nim|razorpay/i.test(message)) return "PROVIDER_UNAVAILABLE";
  if (/signature|payment/i.test(message)) return "PAYMENT_VERIFICATION_FAILED";
  if (/cart changed|stale cart|cart hash/i.test(message)) return "STALE_CART";
  if (/not owned|tenant|organization/i.test(message)) return "TENANT_MISMATCH";
  if (/not allowed|forbidden|merchant authentication/i.test(message)) return "FORBIDDEN";
  return fallback;
}

/** Normalize public API failures without leaking stack traces or provider internals. */
export function normalizedError(error: unknown, fallbackMessage: string, fallbackCode: AgentFlowErrorCode = "REQUEST_FAILED") {
  const code = codeFor(error, fallbackCode);
  const message = process.env.NODE_ENV === "production" ? fallbackMessage : error instanceof Error ? error.message : fallbackMessage;
  return { error: message, code };
}

export function errorResponse(error: unknown, fallbackMessage: string, status = 400, fallbackCode: AgentFlowErrorCode = "REQUEST_FAILED") {
  return Response.json(normalizedError(error, fallbackMessage, fallbackCode), { status });
}
