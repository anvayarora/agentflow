import { isDatabaseConfigured } from "../../../../db";
import { toPublicProduct } from "../../../../lib/domain/catalogue";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = getTrustedRequestContext(request);
    const products = await getCommerceRepository().listProducts(context);
    return Response.json({ source: isDatabaseConfigured() ? "database" : "demo", products: products.map(toPublicProduct) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Catalogue is unavailable." }, { status: 500 });
  }
}
