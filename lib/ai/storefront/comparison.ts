import { z } from "zod";

const productSchema = z.object({ id: z.string(), title: z.string().optional(), name: z.string().optional(), currency: z.string().optional(), priceMinorUnits: z.number().optional(), listPricePaise: z.number().optional(), attributes: z.record(z.string(), z.unknown()).optional(), stock: z.number().optional(), variants: z.array(z.object({ available: z.boolean().optional() }).passthrough()).optional() }).passthrough();

export type ComparisonRow = { productId: string; title: string; pricePaise: number | null; availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN"; attributes: Record<string, string | number | boolean> };

export function buildComparisonMatrix(products: unknown[]): { columns: string[]; rows: ComparisonRow[] } {
  const rows = products.flatMap((value) => {
    const product = productSchema.safeParse(value).success ? productSchema.parse(value) : null;
    if (!product) return [];
    const pricePaise = typeof product.listPricePaise === "number" ? product.listPricePaise : typeof product.priceMinorUnits === "number" ? Math.round(product.priceMinorUnits) : null;
    const availability: ComparisonRow["availability"] = typeof product.stock === "number" ? product.stock > 0 ? "IN_STOCK" : "OUT_OF_STOCK" : Array.isArray(product.variants) ? product.variants.some((variant) => variant.available === true) ? "IN_STOCK" : product.variants.some((variant) => variant.available === false) ? "OUT_OF_STOCK" : "UNKNOWN" : "UNKNOWN";
    const attributes = Object.fromEntries(Object.entries(product.attributes || {}).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item)) as Array<[string, string | number | boolean]>);
    return [{ productId: product.id, title: product.title || product.name || product.id, pricePaise, availability, attributes }];
  });
  const columns = ["title", "pricePaise", "availability", ...new Set(rows.flatMap((row) => Object.keys(row.attributes)))];
  return { columns, rows };
}
