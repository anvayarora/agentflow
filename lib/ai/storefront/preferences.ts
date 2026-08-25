import { z } from "zod";

export const shopperPreferencesSchema = z.object({
  budgetMaxPaise: z.number().int().nonnegative().optional(),
  widthMaxCm: z.number().positive().optional(),
  categories: z.array(z.string().max(50)).max(8),
  materials: z.array(z.string().max(50)).max(8),
  colors: z.array(z.string().max(50)).max(8),
  styles: z.array(z.string().max(50)).max(8),
  exclusions: z.array(z.string().max(50)).max(8),
}).strict();

export type ShopperPreferences = z.infer<typeof shopperPreferencesSchema>;
export const emptyShopperPreferences: ShopperPreferences = { categories: [], materials: [], colors: [], styles: [], exclusions: [] };

function unique(values: string[]) { return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, 8); }

export function updateShopperPreferences(message: string, previous: ShopperPreferences = emptyShopperPreferences): ShopperPreferences {
  const next = { ...previous };
  const budget = message.match(/(?:under|below|max(?:imum)?|budget(?:\s+of)?)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  if (budget) next.budgetMaxPaise = Math.round(Number(budget[1].replace(/,/g, "")) * 100);
  const width = message.match(/(?:under|up to|max(?:imum)?)\s*(\d+(?:\.\d+)?)\s*cm/i);
  if (width) next.widthMaxCm = Number(width[1]);
  const words = message.toLowerCase();
  const add = (values: string[], current: string[]) => unique([...current, ...values.filter((value) => words.includes(value))]);
  next.materials = add(["wood", "oak", "walnut", "metal", "marble", "linen", "cotton"], next.materials);
  next.colors = add(["black", "white", "blue", "green", "beige", "brown", "natural"], next.colors);
  next.styles = add(["minimal", "modern", "classic", "scandinavian", "contemporary", "rustic"], next.styles);
  next.categories = add(["desk", "chair", "table", "sofa", "lighting", "accessories", "storage"], next.categories);
  const excluding = message.match(/(?:no|without|avoid)\s+([a-z][a-z -]{1,30})/i);
  if (excluding) next.exclusions = unique([...next.exclusions, excluding[1]]);
  return shopperPreferencesSchema.parse(next);
}
