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
  const budget = message.match(/(?:under|below|max(?:imum)?|budget(?:\s+of)?|andar|ke\s+andar)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)(?:\s*(?:k|thousand|hazaar|हज़ार))?/i)
    || message.match(/(?:₹|rs\.?\s*)([\d,]+(?:\.\d{1,2})?)(?:\s*(?:k|thousand|hazaar|हज़ार))?/i);
  if (budget) {
    const raw = budget[1].replace(/,/g, "");
    const suffix = budget[0].toLowerCase();
    const multiplier = /(?:k|thousand|hazaar|हज़ार)/i.test(suffix) ? 1_000 : 1;
    next.budgetMaxPaise = Math.round(Number(raw) * multiplier * 100);
  }
  const width = message.match(/(?:under|up to|max(?:imum)?|not\s+more\s+than|no\s+more\s+than|se\s+zyada\s+nahi|tak)\s*(\d+(?:\.\d+)?)\s*cm/i)
    || message.match(/(\d+(?:\.\d+)?)\s*cm\s*(?:max|maximum|se\s+zyada\s+nahi)/i);
  if (width) next.widthMaxCm = Number(width[1]);
  const words = message.toLowerCase();
  const add = (values: string[], current: string[]) => unique([...current, ...values.filter((value) => words.includes(value))]);
  next.materials = add(["wood", "oak", "walnut", "metal", "marble", "linen", "cotton"], next.materials);
  next.colors = add(["black", "white", "blue", "green", "beige", "brown", "natural"], next.colors);
  next.styles = add(["minimal", "modern", "classic", "scandinavian", "contemporary", "rustic"], next.styles);
  next.categories = add(["desk", "chair", "table", "sofa", "lighting", "accessories", "storage"], next.categories);
  const excluding = message.match(/(?:no|without|avoid)\s+([^,.!?]+?)(?=\s+(?:and|but|under|below|max|$)|[,.!?]|$)/i);
  if (excluding) next.exclusions = unique([...next.exclusions, excluding[1].trim()]);
  return shopperPreferencesSchema.parse(next);
}
