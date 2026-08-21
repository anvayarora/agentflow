import { compileDemoOnboarding, isCompiledOnboarding, type CompiledOnboarding } from "../../../../lib/onboarding";

const getEnv = (name: string) => (typeof process === "undefined" ? undefined : process.env[name]);

const extractJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object";

const normalizeNimResult = (value: unknown, fallback: CompiledOnboarding): CompiledOnboarding | null => {
  if (!isCompiledOnboarding(value)) return null;
  const policy = value.policy;
  const policyValues = [policy.standardMaxDiscount, policy.repeatMaxDiscount, policy.minimumMargin, policy.lowStockThreshold, policy.approvalThreshold];
  if (policy.version !== 19 || policyValues.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  const blocks = value.blocks as unknown[];
  const discrepanciesFromModel = value.discrepancies as unknown[];
  if (!blocks.length || blocks.some((block) => !isRecord(block) || typeof block.id !== "string" || !block.id || typeof block.title !== "string" || !block.title || typeof block.detail !== "string" || !block.detail || typeof block.source !== "string" || !block.source)) return null;
  if (discrepanciesFromModel.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title || typeof item.detail !== "string" || !item.detail || typeof item.recommendation !== "string" || !item.recommendation)) return null;
  const discrepancies = [...value.discrepancies];
  for (const baselineDiscrepancy of fallback.discrepancies) {
    if (!discrepancies.some((item) => item.id === baselineDiscrepancy.id)) discrepancies.push(baselineDiscrepancy);
  }
  return {
    ...value,
    source: "nim",
    model: typeof value.model === "string" && value.model ? value.model : getEnv("NIM_MODEL_ID") || "NIM",
    discrepancies,
  };
};

const compilerInstruction = `You are AgentFlow's policy compiler. Convert merchant intent into a typed, safe commerce workflow.

Return JSON only with this exact shape:
{
  "source": "nim",
  "model": "string",
  "workflowName": "string",
  "summary": "string",
  "policy": { "version": 19, "standardMaxDiscount": 10, "repeatMaxDiscount": 15, "minimumMargin": 25, "lowStockThreshold": 10, "approvalThreshold": 50000 },
  "blocks": [{ "id": "string", "type": "context|constraint|approval|connector|outcome", "title": "string", "detail": "string", "source": "string", "status": "ready|needs-review" }],
  "discrepancies": [{ "id": "string", "severity": "high|medium|low", "title": "string", "detail": "string", "recommendation": "string" }],
  "assumptions": ["string"]
}

Find contradictions, precedence conflicts, unsafe margin assumptions, missing data, and ambiguous approval boundaries. Never silently resolve a contradiction. Keep connectors capability-only; never grant a connector policy authority.`;

export async function POST(request: Request) {
  let body: { prompt?: string; catalogueSummary?: string };
  try {
    body = await request.json() as { prompt?: string; catalogueSummary?: string };
  } catch {
    return Response.json({ error: "Invalid onboarding request." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: "A merchant prompt is required." }, { status: 400 });

  const fallback = compileDemoOnboarding(prompt);
  const apiKey = getEnv("NIM_API_KEY");
  const baseUrl = (getEnv("NIM_BASE_URL") || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
  const model = getEnv("NIM_MODEL_ID") || "meta/llama-3.3-70b-instruct";

  if (!apiKey) {
    return Response.json({ ...fallback, mode: "demo-fallback", message: "NIM is not configured; deterministic compiler used." });
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1800,
        messages: [
          { role: "system", content: compilerInstruction },
          { role: "user", content: `Merchant intent:\n${prompt.slice(0, 6000)}\n\nCatalogue context:\n${(body.catalogueSummary || "Haven Home seeded catalogue with price, cost, inventory, and category fields.").slice(0, 2000)}` },
        ],
      }),
    });

    if (!response.ok) throw new Error(`NIM returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    const nimResult = content ? normalizeNimResult(extractJson(content), fallback) : null;
    if (!nimResult) throw new Error("NIM response did not match the compiler schema");
    return Response.json({ ...nimResult, mode: "nim" });
  } catch (error) {
    console.error("NIM onboarding compiler unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ...fallback, mode: "demo-fallback", message: "NIM was unavailable; deterministic compiler used." });
  }
}
