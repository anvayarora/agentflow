import { createHash } from "node:crypto";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { type ZodType, type z } from "zod";
import type { TrustedRequestContext } from "../../server/context";
import { getCommerceRepository } from "../../server/repositories/commerce";
import { getRuntimeStore, runtimeKinds } from "../../server/runtime/store";
import { STOREFRONT_AGENT_INSTRUCTIONS } from "./prompts";
import { emptyShopperPreferences, shopperPreferencesSchema, updateShopperPreferences, type ShopperPreferences } from "./preferences";
import { storefrontToolSchemas } from "./schemas";
import { getNimModel, NimConfigurationError } from "../providers/nim";
import { compareProducts, getCart, getInventory, getProduct, searchProducts, updateCart } from "../../commerce/catalog-service";
import { acceptOffer, getApprovalStatus, requestApproval, requestOffer } from "../../commerce/offer-service";
import { createCheckout, getPaymentStatus } from "../../commerce/checkout-service";
import { appendConversation, getPageContext, getShortlist, savePageContext, updateShortlist } from "./shopper-state";
import { projectStorefrontUi, type StorefrontUiSurface } from "./ui";
import { getEligibleGrowthActions } from "../../growth/engine";
import { buildComparisonMatrix } from "./comparison";
import { getSalespersonRepository } from "../../server/repositories/salesperson";
import { normalizeLanguage, personaInstruction, type SalespersonLanguage, type SalespersonProfile } from "../../voice/salesperson";

export type StorefrontAgentResult = {
  sessionId: string;
  message: string;
  status: "COMPLETED" | "PROVIDER_UNAVAILABLE" | "FAILED";
  products: unknown[];
  cart: unknown | null;
  offer: unknown | null;
  approval: unknown | null;
  checkout: unknown | null;
  model: string;
  modelCalls: number;
  toolSteps: number;
  ui: StorefrontUiSurface;
  shortlist: string[];
  growthActions: unknown[];
  latencyMs: number;
  timings: { totalMs: number; tools: Record<string, number[]> };
  salesperson?: SalespersonProfile;
  language?: SalespersonLanguage;
};

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const safeMessage = "I’m having trouble completing that request right now. Please try again in a moment.";

function customerFacingMessage(text: string, products: unknown[]) {
  const internalToolNarration = /function call|json object|search_products|tool call|tool result|schema|search result|search again/i.test(text);
  if (!internalToolNarration || products.length === 0) return text;
  const names = products
    .map((product) => product && typeof product === "object" && "name" in product && typeof product.name === "string" ? product.name : null)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  if (names.length === 0) return text;
  if (names.length === 1) return `I found ${names[0]} — a strong fit for what you described. I can also help you compare its size, finish, or price.`;
  const last = names[names.length - 1];
  const first = names.slice(0, -1).join(", ");
  return `I found a few good options: ${first}, and ${last}. I can compare them by size, finish, or price to help you choose.`;
}

function stripReasoningMarkers(text: string) {
  const closingMarker = text.lastIndexOf("</think>");
  const visible = closingMarker >= 0 ? text.slice(closingMarker + "</think>".length) : text;
  return visible.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function loadPreferences(context: TrustedRequestContext, sessionId: string) {
  const record = await getRuntimeStore().get<ShopperPreferences>(context, runtimeKinds.shopperPreferences, sessionId);
  return record ? shopperPreferencesSchema.parse(record.payload) : emptyShopperPreferences;
}

async function savePreferences(context: TrustedRequestContext, sessionId: string, preferences: ShopperPreferences) {
  const timestamp = new Date().toISOString();
  await getRuntimeStore().put(context, { id: sessionId, kind: runtimeKinds.shopperPreferences, status: "ACTIVE", payload: preferences, createdAt: timestamp, updatedAt: timestamp });
}

export async function runStorefrontAgent(input: { context: TrustedRequestContext; sessionId: string; message: string; storefrontContext?: Record<string, unknown>; salespersonProfileId?: string; language?: SalespersonLanguage; inputMode?: "text" | "voice" }): Promise<StorefrontAgentResult> {
  const { context, sessionId, message } = input;
  const turnStartedAt = Date.now();
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const salespersonProfiles = await getSalespersonRepository().ensureDefaults(context);
  const salesperson = input.salespersonProfileId ? await getSalespersonRepository().select(context, input.salespersonProfileId) : session.salespersonProfileId ? await getSalespersonRepository().select(context, session.salespersonProfileId) : salespersonProfiles.find((profile) => profile.isMerchantDefault && profile.isActive) || salespersonProfiles.find((profile) => profile.isActive);
  const language = normalizeLanguage(input.language || session.preferredLanguage || "en-IN");
  const safePageContext = input.storefrontContext ? await savePageContext(context, sessionId, { pageType: (input.storefrontContext.pageType as "home" | "collection" | "product" | "search" | "cart" | "other" | undefined) || "other", currentProductId: typeof input.storefrontContext.currentProductId === "string" ? input.storefrontContext.currentProductId : typeof input.storefrontContext.hintedProductId === "string" ? input.storefrontContext.hintedProductId : undefined, currentCollection: typeof input.storefrontContext.currentCollection === "string" ? input.storefrontContext.currentCollection : undefined, url: typeof input.storefrontContext.url === "string" ? input.storefrontContext.url : undefined }) : await getPageContext(context, sessionId);
  const preferences = updateShopperPreferences(message, await loadPreferences(context, sessionId));
  await savePreferences(context, sessionId, preferences);
  await appendConversation(context, sessionId, { role: "user", text: message });
  await repository.recordAudit(context, { eventType: "AGENT_TURN_STARTED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { messageLength: message.length, inputMode: input.inputMode || "text", preferenceFields: Object.keys(preferences).filter((key) => (preferences as Record<string, unknown>)[key] !== undefined).length, salespersonProfileId: salesperson?.id || null, salespersonDisplayName: salesperson?.displayName || null, speakerId: salesperson?.speakerId || null, language } });
  await repository.recordAudit(context, { eventType: "SHOPPER_QUERY", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { messageLength: message.length, pageType: safePageContext.pageType } });

  const products: unknown[] = [];
  let latestCart: unknown | null = null;
  let latestOffer: unknown | null = null;
  let latestApproval: unknown | null = null;
  let latestCheckout: unknown | null = null;
  let growthActions: unknown[] = [];
  const toolTimings: Record<string, number[]> = {};
  let toolSteps = 0;
  const callTool = <S extends ZodType>(name: string, inputSchema: S, execute: (input: z.infer<S>) => Promise<unknown>) => tool({
    description: `AgentFlow server tool: ${name}.`,
    inputSchema,
    execute: async (toolInput: z.infer<S>) => {
      toolSteps += 1;
      if (toolSteps > 6) throw new Error("Storefront agent tool-step budget exceeded.");
      await repository.recordAudit(context, { eventType: "AGENT_TOOL_REQUESTED", entityType: "agent_tool", entityId: `${sessionId}:${toolSteps}`, shoppingSessionId: sessionId, metadata: { tool: name } });
      const toolStartedAt = Date.now();
      try {
        const result = await execute(toolInput);
        (toolTimings[name] ||= []).push(Date.now() - toolStartedAt);
        await repository.recordAudit(context, { eventType: "AGENT_TOOL_SUCCEEDED", entityType: "agent_tool", entityId: `${sessionId}:${toolSteps}`, shoppingSessionId: sessionId, metadata: { tool: name } });
        return result;
      } catch (error) {
        (toolTimings[name] ||= []).push(Date.now() - toolStartedAt);
        await repository.recordAudit(context, { eventType: "AGENT_TOOL_REJECTED", entityType: "agent_tool", entityId: `${sessionId}:${toolSteps}`, shoppingSessionId: sessionId, metadata: { tool: name, error: error instanceof Error ? error.message : "tool failure" } });
        throw error;
      }
    },
  });

  const tools = {
    search_products: callTool("search_products", storefrontToolSchemas.search_products, async (value) => {
      const result = await searchProducts(context, session, { ...value, maxPricePaise: preferences.budgetMaxPaise });
      products.push(...result);
      return { products: result };
    }),
    get_product: callTool("get_product", storefrontToolSchemas.get_product, async (value) => { const result = await getProduct(context, session, value.productId); return { product: result }; }),
    compare_products: callTool("compare_products", storefrontToolSchemas.compare_products, async (value) => { const compared = await compareProducts(context, session, value.productIds); return { products: compared, matrix: buildComparisonMatrix(compared) }; }),
    get_inventory: callTool("get_inventory", storefrontToolSchemas.get_inventory, async (value) => getInventory(context, session, value.productId, value.variantId)),
    get_cart: callTool("get_cart", storefrontToolSchemas.get_cart, async () => { latestCart = await getCart(context, session); return latestCart; }),
    update_cart: callTool("update_cart", storefrontToolSchemas.update_cart, async (value) => { latestCart = await updateCart(context, session, value.lines); await repository.recordAudit(context, { eventType: "CART_UPDATED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { lineCount: value.lines.length } }); return latestCart; }),
    request_offer: callTool("request_offer", storefrontToolSchemas.request_offer, async (value) => { latestOffer = await requestOffer(context, { sessionId, ...value }); return latestOffer; }),
    accept_offer: callTool("accept_offer", storefrontToolSchemas.accept_offer, async (value) => { latestOffer = await acceptOffer(context, value.offerId); return latestOffer; }),
    request_approval: callTool("request_approval", storefrontToolSchemas.request_approval, async (value) => { latestApproval = await requestApproval(context, value.offerId); return latestApproval; }),
    get_approval_status: callTool("get_approval_status", storefrontToolSchemas.get_approval_status, async (value) => { latestApproval = await getApprovalStatus(context, value.approvalId); return latestApproval; }),
    create_checkout: callTool("create_checkout", storefrontToolSchemas.create_checkout, async () => { const idempotencyKey = createHash("sha256").update(`${context.correlationId}:${sessionId}`).digest("hex"); latestCheckout = await createCheckout(context, { sessionId, idempotencyKey }); return latestCheckout; }),
    get_payment_status: callTool("get_payment_status", storefrontToolSchemas.get_payment_status, async (value) => { latestCheckout = await getPaymentStatus(context, value.transactionId); return latestCheckout; }),
    add_to_shortlist: callTool("add_to_shortlist", storefrontToolSchemas.add_to_shortlist, async (value) => ({ shortlist: await updateShortlist(context, sessionId, { add: value.productIds }) })),
    remove_from_shortlist: callTool("remove_from_shortlist", storefrontToolSchemas.remove_from_shortlist, async (value) => ({ shortlist: await updateShortlist(context, sessionId, { remove: value.productIds }) })),
    open_shortlist: callTool("open_shortlist", storefrontToolSchemas.open_shortlist, async () => ({ shortlist: await getShortlist(context, sessionId) })),
    navigate_to_product: callTool("navigate_to_product", storefrontToolSchemas.navigate_to_product, async (value) => ({ type: "NAVIGATE_TO_PRODUCT", productId: value.productId })),
  };

  try {
    const agent = new ToolLoopAgent({ id: "agentflow-storefront", model: getNimModel(), instructions: `${STOREFRONT_AGENT_INSTRUCTIONS}\n${salesperson ? personaInstruction(salesperson, language) : "Use a concise customer-facing tone."}`, tools, providerOptions: { nvidiaNim: { chat_template_kwargs: { enable_thinking: true, force_nonempty_content: true } } }, stopWhen: isStepCount(4), temperature: 1, topP: 0.95, maxOutputTokens: 256 });
    const result = await agent.generate({ prompt: `Trusted storefront session context: currency=${session.currency}; language=${language}; preferences=${JSON.stringify(preferences)}; pageContext=${JSON.stringify(safePageContext)}.\nCustomer request: ${message}`, timeout: { totalMs: Number(process.env.AGENT_TOTAL_TIMEOUT_MS || 90_000), stepMs: Number(process.env.AGENT_STEP_TIMEOUT_MS || 30_000), toolMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS || 8_000) } });
    try {
      const eligible = await getEligibleGrowthActions({ context, sessionId });
      growthActions = eligible.actions;
    } catch {
      growthActions = [];
    }
    const text = customerFacingMessage(stripReasoningMarkers(result.text.trim()) || "I can help you explore the catalogue and your cart.", products);
    await appendConversation(context, sessionId, { role: "assistant", text });
    const shortlist = await getShortlist(context, sessionId);
    if (products.length > 0) await repository.recordAudit(context, { eventType: "PRODUCTS_SHOWN", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { count: Math.min(products.length, 20), productIds: products.slice(0, 20).map((product) => product && typeof product === "object" && "id" in product ? product.id : null).filter((value): value is string => typeof value === "string") } });
    const ui = projectStorefrontUi({ message: text, products, cart: latestCart, offer: latestOffer && typeof latestOffer === "object" ? latestOffer as { offerId?: string; outcome?: string } : null, approval: latestApproval && typeof latestApproval === "object" ? latestApproval as { approvalId?: string } : null, checkout: latestCheckout, shortlistProductIds: shortlist.productIds });
    const latencyMs = Date.now() - turnStartedAt;
    await repository.recordAudit(context, { eventType: "AGENT_TURN_COMPLETED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { modelCalls: result.steps.length, toolSteps, responseLength: text.length, latencyMs, toolTimings } });
    return { sessionId, message: text, status: "COMPLETED", products: products.slice(0, 20), cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, model: process.env.NIM_MODEL_ID || "nvidia/nemotron-3-ultra-550b-a55b", modelCalls: result.steps.length, toolSteps, ui, shortlist: shortlist.productIds, growthActions, latencyMs, timings: { totalMs: latencyMs, tools: toolTimings }, salesperson, language };
  } catch (error) {
    const configuration = error instanceof NimConfigurationError;
    console.error("[agentflow] storefront agent execution failed", {
      name: error instanceof Error ? error.name : typeof error,
      statusCode: typeof error === "object" && error !== null && "statusCode" in error ? String((error as { statusCode?: unknown }).statusCode ?? "") : undefined,
    });
    await repository.recordAudit(context, { eventType: "TRANSACTION_FAILED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { reason: configuration ? "nim_not_configured" : "agent_execution_failed" } });
    const shortlist = await getShortlist(context, sessionId).catch(() => ({ productIds: [] }));
    const text = configuration ? "The storefront assistant is not enabled for this environment yet." : safeMessage;
    const latencyMs = Date.now() - turnStartedAt;
    return { sessionId, message: text, status: configuration ? "PROVIDER_UNAVAILABLE" : "FAILED", products, cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, model: process.env.NIM_MODEL_ID || "nvidia/nemotron-3-ultra-550b-a55b", modelCalls: 0, toolSteps, ui: projectStorefrontUi({ message: text, products, shortlistProductIds: shortlist.productIds }), shortlist: shortlist.productIds, growthActions: [], latencyMs, timings: { totalMs: latencyMs, tools: toolTimings }, salesperson, language };
  }
}
