import { shopifyPreviewStore } from "../../../../lib/connectors";
import { NIM_MODEL_ID } from "../../../../lib/ai/providers/nim";
import { getShopifyUcpClient, ShopifyUcpError } from "../../../../lib/server/shopify/ucp";
import { getDb, isDatabaseConfigured } from "../../../../db";
import { organizations, policyVersions } from "../../../../db/schema";

const env = () => (typeof process === "undefined" ? undefined : process.env);

export async function GET() {
  const values = env();
  const paymentProvider = (values?.PAYMENT_PROVIDER || "").toLowerCase();
  const razorpayTestConfigured = paymentProvider === "razorpay" && Boolean(values?.RAZORPAY_KEY_ID && values?.RAZORPAY_KEY_SECRET && values.RAZORPAY_KEY_ID.startsWith("rzp_test_"));
  const database: { configured: boolean; reachable: boolean; schemaReady: boolean; seeded: boolean; provider: "aiven" | "postgres" | "unconfigured" } = {
    configured: isDatabaseConfigured(),
    reachable: false,
    schemaReady: false,
    seeded: false,
    provider: "unconfigured",
  };
  if (database.configured) {
    try {
      const host = new URL(values?.DATABASE_URL || "").hostname.toLowerCase();
      database.provider = host.endsWith(".aivencloud.com") ? "aiven" : "postgres";
      const db = getDb();
      await db.select({ id: organizations.id }).from(organizations).limit(1);
      database.reachable = true;
      database.schemaReady = true;
      database.seeded = (await db.select({ id: policyVersions.id }).from(policyVersions).limit(1)).length > 0;
    } catch {
      database.reachable = false;
    }
  }
  const databaseStatus = !database.configured || !database.reachable ? "PROVIDER_UNAVAILABLE" : database.schemaReady ? "HEALTHY" : "PROVIDER_DEGRADED";
  let shopifyUcp: { status: string; version?: string; endpoint?: string; capabilities?: string[]; tools?: string[]; reason?: string } = { status: "SHOPIFY_UCP_NOT_VERIFIED" };
  try {
    const client = getShopifyUcpClient();
    const business = await client.discoverBusiness();
    const tools = await client.listTools();
    shopifyUcp = { status: "SHOPIFY_UCP_CONNECTED", version: business.version, endpoint: business.endpoint, capabilities: Object.keys(business.capabilities), tools: tools.map((tool) => tool.name) };
  } catch (error) {
    shopifyUcp.reason = error instanceof ShopifyUcpError ? error.code : "SHOPIFY_UCP_NOT_VERIFIED";
  }
  const shopifyStatus = shopifyUcp.status === "SHOPIFY_UCP_CONNECTED" ? "HEALTHY" : "PROVIDER_DEGRADED";
  const nimConfigured = Boolean(values?.NIM_API_KEY);
  const sarvamConfigured = Boolean(values?.SARVAM_API_KEY);
  const paymentStatus = razorpayTestConfigured || paymentProvider === "mock" ? "HEALTHY" : "PROVIDER_DEGRADED";
  const providerStatuses = { database: databaseStatus, shopify: shopifyStatus, nim: nimConfigured ? "HEALTHY" : "PROVIDER_UNAVAILABLE", sarvam: sarvamConfigured ? "HEALTHY" : "PROVIDER_DEGRADED", payments: paymentStatus };
  const appStatus = database.reachable && nimConfigured && (shopifyUcp.status === "SHOPIFY_UCP_CONNECTED" || paymentProvider === "mock") ? "APP_HEALTHY" : "PROVIDER_DEGRADED";
  return Response.json({
    generatedAt: new Date().toISOString(),
    status: appStatus,
    providerStatuses,
    database,
    connectors: {
      nim: {
        configured: nimConfigured,
        model: values?.NIM_MODEL_ID || NIM_MODEL_ID,
        endpoint: values?.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
        mode: values?.NIM_API_KEY ? "live inference" : "provider unavailable",
      },
      sarvam: {
        configured: sarvamConfigured,
        sttModel: values?.SARVAM_STT_MODEL || "saaras:v3",
        ttsModel: values?.SARVAM_TTS_MODEL || "bulbul:v3",
        mode: values?.SARVAM_API_KEY ? "live voice" : "text-only",
      },
      shopify: {
        configured: shopifyUcp.status === "SHOPIFY_UCP_CONNECTED",
        storeDomain: values?.SHOPIFY_STORE_DOMAIN || shopifyPreviewStore.url.replace("https://", ""),
        mode: shopifyUcp.status,
        catalogEndpoint: "/api/shopify/ucp/catalog/search",
        ucp: shopifyUcp,
      },
      payments: { configured: razorpayTestConfigured, mode: razorpayTestConfigured ? "razorpay test mode" : paymentProvider === "mock" ? "mock test adapter" : "not configured" },
    },
  });
}
