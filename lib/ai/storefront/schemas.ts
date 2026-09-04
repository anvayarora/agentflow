import { z } from "zod";

const id = z.string().trim().min(1).max(255);
const numeric = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}, schema);
const positiveQuantity = numeric(z.number().int().min(1).max(20));

export const storefrontToolSchemas = {
  search_products: z.object({ query: z.string().trim().min(1).max(120), category: z.string().trim().max(80).optional(), maxPricePaise: numeric(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).optional(), maxWidthCm: numeric(z.number().positive().max(10_000)).optional(), material: z.string().trim().max(80).optional(), finish: z.string().trim().max(80).optional(), excludeFrameType: z.string().trim().max(80).optional(), limit: numeric(z.number().int().min(1).max(10)).default(5) }).strict(),
  get_product: z.object({ productId: id }).strict(),
  compare_products: z.object({ productIds: z.array(id).min(2).max(4) }).strict(),
  get_inventory: z.object({ productId: id, variantId: id.optional() }).strict(),
  get_cart: z.object({}).strict(),
  update_cart: z.object({ lines: z.array(z.object({ variantId: id, quantity: positiveQuantity }).strict()).max(20) }).strict(),
  request_offer: z.object({ productId: id, variantId: id.optional(), quantity: positiveQuantity, requestedUnitPricePaise: numeric(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).optional(), requestedDiscountBps: numeric(z.number().int().min(0).max(10_000)).optional(), growthPlayId: id.optional() }).strict().refine((value) => value.requestedUnitPricePaise !== undefined || value.requestedDiscountBps !== undefined, "An offer request must include a price or discount."),
  accept_offer: z.object({ offerId: id }).strict(),
  request_approval: z.object({ offerId: id }).strict(),
  get_approval_status: z.object({ approvalId: id }).strict(),
  create_checkout: z.object({}).strict(),
  get_payment_status: z.object({ transactionId: id }).strict(),
  add_to_shortlist: z.object({ productIds: z.array(id).min(1).max(12) }).strict(),
  remove_from_shortlist: z.object({ productIds: z.array(id).min(1).max(12) }).strict(),
  open_shortlist: z.object({}).strict(),
  navigate_to_product: z.object({ productId: id }).strict(),
} as const;

export type StorefrontToolName = keyof typeof storefrontToolSchemas;
export type StorefrontToolInput<N extends StorefrontToolName = StorefrontToolName> = z.infer<(typeof storefrontToolSchemas)[N]>;

export const storefrontToolNames = Object.keys(storefrontToolSchemas) as StorefrontToolName[];
