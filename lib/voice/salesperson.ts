import { z } from "zod";

export const SALESPERSON_LANGUAGES = ["en-IN", "hi-IN", "hinglish"] as const;
export type SalespersonLanguage = (typeof SALESPERSON_LANGUAGES)[number];
export const SALESPERSON_TONES = ["WARM", "CONCISE", "EXPERT", "ENERGETIC", "PREMIUM", "MINIMAL"] as const;
export type SalespersonTone = (typeof SALESPERSON_TONES)[number];
export const SALESPERSON_PACES = ["RELAXED", "STANDARD", "QUICK"] as const;
export type SalespersonPace = (typeof SALESPERSON_PACES)[number];
export const BULBUL_V3_SPEAKERS = ["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani", "mohit", "kavitha", "rehan", "soham", "rupali"] as const;
export type BulbulV3Speaker = (typeof BULBUL_V3_SPEAKERS)[number];

export const salespersonProfileSchema = z.object({
  id: z.string().min(1).max(255),
  organizationId: z.string().min(1).max(255),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  speakerId: z.enum(BULBUL_V3_SPEAKERS),
  languageSupport: z.array(z.enum(SALESPERSON_LANGUAGES)).min(1).max(3),
  tonePreset: z.enum(SALESPERSON_TONES),
  pacePreset: z.enum(SALESPERSON_PACES),
  isActive: z.boolean(),
  isMerchantDefault: z.boolean(),
  avatarKey: z.string().max(80).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).strict();
export type SalespersonProfile = z.infer<typeof salespersonProfileSchema>;

export const salespersonCreateSchema = salespersonProfileSchema.pick({ displayName: true, description: true, speakerId: true, languageSupport: true, tonePreset: true, pacePreset: true, avatarKey: true }).strict();
export const salespersonUpdateSchema = salespersonCreateSchema.partial().extend({ isActive: z.boolean().optional(), isMerchantDefault: z.boolean().optional() }).strict();

export const paceToValue: Record<SalespersonPace, number> = { RELAXED: 0.82, STANDARD: 1, QUICK: 1.18 };
export const languageToCode: Record<SalespersonLanguage, string> = { "en-IN": "en-IN", "hi-IN": "hi-IN", hinglish: "hi-IN" };

export function personaInstruction(profile: SalespersonProfile, language: SalespersonLanguage = "en-IN") {
  const tone = profile.tonePreset.toLowerCase();
  const languageName = language === "hi-IN" ? "Hindi" : language === "hinglish" ? "natural Hinglish" : "English";
  return `Presentation persona only: ${profile.displayName}, a clearly identified AI salesperson. Tone ${tone}; respond in concise ${languageName}; pace ${profile.pacePreset.toLowerCase()}. This never changes catalogue truth, customer segment, policy, price, approval, checkout, or payment authority.`;
}

export function normalizeLanguage(value: unknown): SalespersonLanguage {
  if (value === "hi" || value === "hi-IN" || value === "hindi") return "hi-IN";
  if (value === "hinglish" || value === "hi-en" || value === "codemix") return "hinglish";
  return "en-IN";
}
