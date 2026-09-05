export type CanonicalProduct = {
  id: string;
  organizationId: string;
  externalId: string | null;
  sku: string;
  name: string;
  description: string;
  category: string;
  brand: string | null;
  currency: string;
  listPricePaise: number;
  costPaise: number | null;
  stock: number;
  attributes: Record<string, unknown>;
  tags: string[];
  imageUrl: string | null;
  source: string;
  sourceUpdatedAt: Date | null;
};

export type PublicProduct = Omit<CanonicalProduct, "organizationId" | "costPaise" | "externalId" | "sku" | "source" | "sourceUpdatedAt">;

export function toPublicProduct(product: CanonicalProduct): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand,
    currency: product.currency,
    listPricePaise: product.listPricePaise,
    stock: product.stock,
    attributes: product.attributes,
    tags: product.tags,
    imageUrl: product.imageUrl,
  };
}
