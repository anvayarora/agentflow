import { shopifyPreviewStore } from "../../../../lib/connectors";
import { getShopifyUcpClient, ShopifyUcpError } from "../../../../lib/server/shopify/ucp";

const env = () => (typeof process === "undefined" ? undefined : process.env);

export async function GET() {
  const values = env();
  const paymentProvider = (values?.PAYMENT_PROVIDER || "").toLowerCase();
  const razorpayTestConfigured = paymentProvider === "razorpay" && Boolean(values?.RAZORPAY_KEY_ID && values?.RAZORPAY_KEY_SECRET && values.RAZORPAY_KEY_ID.startsWith("rzp_test_"));
  let shopifyUcp: { status: string; version?: string; endpoint?: string; capabilities?: string[]; tools?: string[]; reason?: string } = { status: "SHOPIFY_UCP_NOT_VERIFIED" };
  try {
    const client = getShopifyUcpClient();
    const business = await client.discoverBusiness();
    const tools = await client.listTools();
    shopifyUcp = { status: "SHOPIFY_UCP_CONNECTED", version: business.version, endpoint: business.endpoint, capabilities: Object.keys(business.capabilities), tools: tools.map((tool) => tool.name) };
  } catch (error) {
    shopifyUcp.reason = error instanceof ShopifyUcpError ? error.code : "SHOPIFY_UCP_NOT_VERIFIED";
  }
  return Response.json({
    generatedAt: new Date().toISOString(),
    connectors: {
      nim: {
        configured: Boolean(values?.NIM_API_KEY),
        model: values?.NIM_MODEL_ID || "meta/llama-3.3-70b-instruct",
        endpoint: values?.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
        mode: values?.NIM_API_KEY ? "live inference" : "deterministic fallback",
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
