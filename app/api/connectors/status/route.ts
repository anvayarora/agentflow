import { shopifyPreviewStore } from "../../../../lib/connectors";

const env = () => (typeof process === "undefined" ? undefined : process.env);

export async function GET() {
  const values = env();
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
        configured: Boolean(values?.SHOPIFY_STOREFRONT_ACCESS_TOKEN || values?.SHOPIFY_ADMIN_ACCESS_TOKEN),
        storeDomain: values?.SHOPIFY_STORE_DOMAIN || shopifyPreviewStore.url.replace("https://", ""),
        mode: values?.SHOPIFY_STOREFRONT_ACCESS_TOKEN || values?.SHOPIFY_ADMIN_ACCESS_TOKEN ? "live catalogue sync" : "preview destination",
        catalogEndpoint: "/api/connectors/shopify/catalog",
      },
      payments: { configured: false, mode: "mock test adapter" },
    },
  });
}
