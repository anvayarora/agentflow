import { z } from "zod";
import { onboardingFromProposal } from "../../../../lib/onboarding";
import { compileDemoPolicyProposal } from "../../../../lib/policy/compiler";
import { policyToGraph } from "../../../../lib/policy/graph-projection";
import { policyVersionSchema, type PolicyVersionIR } from "../../../../lib/policy/schema";
import { validatePolicy } from "../../../../lib/policy/validator";
import { getTrustedRequestContext } from "../../../../lib/server/context";
import { getCommerceRepository } from "../../../../lib/server/repositories/commerce";

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
No JavaScript, expressions, eval, connector authority, or unknown fields. Use integer paise and basis points. Flag contradictions by leaving the rules explicit; a server validator will decide whether the draft is publishable.`;

function nimPolicy(value: unknown, organizationId: string, prompt: string): PolicyVersionIR | null {
  const parsed = policyVersionSchema.safeParse(value);
  if (!parsed.success) return null;
  return { ...parsed.data, id: `nim-proposal-${crypto.randomUUID()}`, organizationId, policyId: "policy-haven-home-commerce", version: 1, status: "DRAFT", source: "nim", sourcePrompt: prompt, currency: "INR" , rules: parsed.data.rules } satisfies PolicyVersionIR;
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
          const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.1, max_tokens: 1_600, response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false }, stream: false, messages: [{ role: "system", content: compilerInstruction }, { role: "user", content: `Merchant intent:\n${parsed.data.prompt}\n\nCatalogue context:\n${(parsed.data.catalogueSummary || "Haven Home catalogue with server-owned price, cost, stock, category, brand, and SKU.").slice(0, 2_000)}` }] }), signal: controller.signal });
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
