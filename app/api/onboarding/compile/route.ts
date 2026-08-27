import { z } from "zod";
import { onboardingFromProposal } from "../../../../lib/onboarding";
import { compileDemoPolicyProposal } from "../../../../lib/policy/compiler";
import { policyToGraph } from "../../../../lib/policy/graph-projection";
import { conditionFields, conditionOperators, policyVersionSchema, type PolicyVersionIR } from "../../../../lib/policy/schema";
import { validatePolicy } from "../../../../lib/policy/validator";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";
import { nimFetch } from "../../../../lib/ai/providers/nim";

export const runtime = "nodejs";

const bodySchema = z.object({ prompt: z.string().trim().min(1).max(12_000), catalogueSummary: z.string().optional() }).strict();

const getEnv = (name: string) => (typeof process === "undefined" ? undefined : process.env[name]);
const NIM_REQUEST_TIMEOUT_MS = 90_000;
const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate) as unknown; } catch { return null; }
};

const compilerInstruction = `You are AgentFlow's policy compiler. Return JSON only as a proposed PolicyVersionIR. You may propose policy rules, but you may not publish them.
Use only these condition fields: customer.segment, cart.totalPaise, cart.quantity, product.sku, product.category, product.brand, product.stock, product.costPaise, product.listPricePaise, product.tags.
Use only these operators: equals, notEquals, greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, in, notIn, includes.
Use only these effects: SET_MAX_DISCOUNT_BPS, ADD_MAX_DISCOUNT_BPS, SET_MIN_MARGIN_BPS, REQUIRE_APPROVAL, DENY, ALLOW_BUNDLE, SET_QUANTITY_DISCOUNT, DISABLE_NEGOTIATION.
Return the compact shape {"version":1,"rules":[{"condition":{"customer.segment":"equals repeat"},"effect":"SET_MAX_DISCOUNT_BPS 1500"}]}. Use one valid condition field per rule; use an empty condition object for global rules. Effect arguments must be integers. No JavaScript, expressions, eval, connector authority, or unknown fields. Use integer paise and basis points. Flag contradictions by leaving the rules explicit; a server validator will decide whether the draft is publishable.`;

const genericOperators = new Set<string>(conditionOperators);
const genericFields = new Set<string>(conditionFields);
const parseGenericValue = (value: string): string | number | boolean => {
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
};

function normalizeNimProposal(value: unknown, organizationId: string, prompt: string): PolicyVersionIR | null {
  const direct = policyVersionSchema.safeParse(value);
  if (direct.success) return { ...direct.data, organizationId, source: "nim", sourcePrompt: prompt, status: "DRAFT", currency: "INR" };
  if (!value || typeof value !== "object" || !Array.isArray((value as { rules?: unknown }).rules)) return null;
  const rawRules = (value as { rules: unknown[] }).rules;
  const rules: PolicyVersionIR["rules"] = [];
  for (const [index, raw] of rawRules.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as { condition?: unknown; effect?: unknown };
    const conditions: PolicyVersionIR["rules"][number]["conditions"] = [];
    if (candidate.condition !== undefined) {
      if (!candidate.condition || typeof candidate.condition !== "object") return null;
      for (const [field, expression] of Object.entries(candidate.condition as Record<string, unknown>)) {
        if (!genericFields.has(field) || typeof expression !== "string") return null;
        const [operator, ...rest] = expression.trim().split(/\s+/);
        if (!genericOperators.has(operator) || rest.length === 0) return null;
        conditions.push({ field: field as PolicyVersionIR["rules"][number]["conditions"][number]["field"], operator: operator as PolicyVersionIR["rules"][number]["conditions"][number]["operator"], value: parseGenericValue(rest.join(" ")) });
      }
    }
    if (typeof candidate.effect !== "string") return null;
    const [effectName, ...effectArgs] = candidate.effect.trim().split(/\s+/);
    let effect: PolicyVersionIR["rules"][number]["effect"];
    if (effectName === "REQUIRE_APPROVAL") effect = { type: "REQUIRE_APPROVAL" };
    else if (effectName === "DENY") effect = { type: "DENY" };
    else if (effectName === "DISABLE_NEGOTIATION") effect = { type: "DISABLE_NEGOTIATION" };
    else if (effectName === "ALLOW_BUNDLE") effect = { type: "ALLOW_BUNDLE" };
    else if (["SET_MAX_DISCOUNT_BPS", "ADD_MAX_DISCOUNT_BPS", "SET_MIN_MARGIN_BPS"].includes(effectName) && /^-?\d+$/.test(effectArgs[0] || "")) {
      const valueBps = Number(effectArgs[0]);
      effect = effectName === "SET_MAX_DISCOUNT_BPS" ? { type: "SET_MAX_DISCOUNT_BPS", valueBps } : effectName === "ADD_MAX_DISCOUNT_BPS" ? { type: "ADD_MAX_DISCOUNT_BPS", valueBps } : { type: "SET_MIN_MARGIN_BPS", valueBps };
    } else if (effectName === "SET_QUANTITY_DISCOUNT" && /^\d+$/.test(effectArgs[0] || "") && /^\d+$/.test(effectArgs[1] || "")) effect = { type: "SET_QUANTITY_DISCOUNT", quantity: Number(effectArgs[0]), discountBps: Number(effectArgs[1]) };
    else return null;
    rules.push({ id: `nim-rule-${index + 1}`, name: `NIM proposed rule ${index + 1}`, description: `Proposed by NVIDIA from the merchant's stated intent.`, priority: (index + 1) * 100, hardConstraint: effect.type === "DENY" || effect.type === "DISABLE_NEGOTIATION", scope: {}, conditions, effect });
  }
  const normalized = { id: `nim-proposal-${crypto.randomUUID()}`, organizationId, policyId: "policy-haven-home-commerce", version: 1, status: "DRAFT" as const, sourcePrompt: prompt, source: "nim" as const, currency: "INR", rules } satisfies PolicyVersionIR;
  const parsed = policyVersionSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function nimPolicy(value: unknown, organizationId: string, prompt: string): PolicyVersionIR | null {
  return normalizeNimProposal(value, organizationId, prompt);
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A merchant prompt is required." }, { status: 400 });
    const context = getTrustedRequestContext(request);
    const fallback = compileDemoPolicyProposal(parsed.data.prompt, { organizationId: context.organizationId, policyId: "policy-haven-home-commerce", version: 1 });
    let proposal = fallback;
    const apiKey = getEnv("NIM_API_KEY");
    if (apiKey) {
      try {
        const baseUrl = (getEnv("NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
        const model = getEnv("NIM_MODEL_ID") || "nvidia/nemotron-3.5-lightning-30b-a3b";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), NIM_REQUEST_TIMEOUT_MS);
        try {
          const response = await nimFetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_tokens: 1_600, response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false }, stream: false, messages: [{ role: "system", content: compilerInstruction }, { role: "user", content: `Merchant intent:\n${parsed.data.prompt}\n\nCatalogue context:\n${(parsed.data.catalogueSummary || "Haven Home catalogue with server-owned price, cost, stock, category, brand, and SKU.").slice(0, 2_000)}` }] }), signal: controller.signal });
          if (!response.ok) throw new Error(`NIM returned ${response.status}`);
          const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = payload.choices?.[0]?.message?.content;
          const nim = content ? nimPolicy(extractJson(content), context.organizationId, parsed.data.prompt) : null;
          if (!nim) throw new Error("NIM proposal did not match the strict Policy IR schema.");
          const validation = validatePolicy(nim);
          proposal = { ...fallback, source: "nim", model, policy: nim, discrepancies: validation.discrepancies, valid: validation.valid, summary: validation.valid ? fallback.summary : "NIM proposal requires merchant review before publication." };
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        console.warn("NIM policy proposal unavailable", error instanceof Error ? error.message : "unknown error");
      }
    }
    const draft = await getCommerceRepository().createDraft(context, proposal.policy);
    const result = onboardingFromProposal({ ...proposal, policy: draft, graph: policyToGraph(draft) }, draft.id);
    return Response.json({ ...result, draftId: draft.id, mode: proposal.source, message: proposal.source === "nim" ? "NIM proposed a draft. Validate and publish explicitly." : apiKey ? "NIM is configured but unavailable; deterministic compiler used for this draft." : "NIM is not configured; deterministic compiler used for this draft." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to compile policy." }, { status: 400 });
  }
}
