export type ProviderConfigHealth = { ok: boolean; code?: string; missing?: string[] };

/** Central production configuration gate. Values are never returned or logged. */
export function validateServerConfiguration(env: NodeJS.ProcessEnv = process.env): ProviderConfigHealth {
  if (env.NODE_ENV !== "production") return { ok: true };
  const missing: string[] = [];
  if (!env.DATABASE_URL || /\[sensitive\]/i.test(env.DATABASE_URL)) missing.push("DATABASE_URL");
  else {
    try {
      const url = new URL(env.DATABASE_URL);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") missing.push("DATABASE_URL (PostgreSQL URL)");
    } catch { missing.push("DATABASE_URL (PostgreSQL URL)"); }
  }
  if (!env.SHOPIFY_API_KEY && !env.SHOPIFY_CLIENT_ID) missing.push("SHOPIFY_API_KEY");
  if (!env.SHOPIFY_API_SECRET) missing.push("SHOPIFY_API_SECRET");
  if (!env.SHOPIFY_STORE_DOMAIN) missing.push("SHOPIFY_STORE_DOMAIN");
  if ((env.CATALOG_PROVIDER || "").toLowerCase() !== "shopify") missing.push("CATALOG_PROVIDER=shopify");
  if ((env.PAYMENT_PROVIDER || "").toLowerCase() !== "razorpay") missing.push("PAYMENT_PROVIDER=razorpay");
  if ((env.LLM_PROVIDER || "").toLowerCase() !== "nim") missing.push("LLM_PROVIDER=nim");
  if ((env.DEMO_MODE || "").toLowerCase() === "true") missing.push("DEMO_MODE=false");
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_ID.startsWith("rzp_test_")) missing.push("RAZORPAY_KEY_ID (test)");
  if (!env.RAZORPAY_KEY_SECRET) missing.push("RAZORPAY_KEY_SECRET");
  if (!env.NIM_API_KEY) missing.push("NIM_API_KEY");
  if (!env.NIM_MODEL_ID) missing.push("NIM_MODEL_ID");
  if (!env.AGENTFLOW_SESSION_SECRET) missing.push("AGENTFLOW_SESSION_SECRET");
  return missing.length ? { ok: false, code: "PRODUCTION_CONFIGURATION_INVALID", missing } : { ok: true };
}

export function assertProductionConfiguration() {
  const health = validateServerConfiguration();
  if (!health.ok) throw new Error(`${health.code}: ${health.missing?.join(", ")}`);
  return health;
}
