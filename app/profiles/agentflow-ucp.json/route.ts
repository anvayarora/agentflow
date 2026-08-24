export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ucp: {
      version: "2026-04-08",
      services: {
        "dev.ucp.shopping": [{
          version: "2026-04-08",
          spec: "https://ucp.dev/2026-04-08/specification/overview",
          transport: "mcp",
          schema: "https://ucp.dev/2026-04-08/services/shopping/mcp.openrpc.json",
        }],
      },
      capabilities: {
        "dev.ucp.shopping.cart": [{ version: "2026-04-08", spec: "https://ucp.dev/2026-04-08/specification/cart" }],
        "dev.ucp.shopping.catalog.search": [{ version: "2026-04-08", spec: "https://ucp.dev/2026-04-08/specification/catalog/search" }],
        "dev.ucp.shopping.catalog.lookup": [{ version: "2026-04-08", spec: "https://ucp.dev/2026-04-08/specification/catalog/lookup" }],
      },
      payment_handlers: {},
    },
  }, { headers: { "cache-control": "public, max-age=300" } });
}
