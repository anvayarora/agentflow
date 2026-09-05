import { createHash } from "node:crypto";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z, type ZodType } from "zod";
import type { TrustedRequestContext } from "../../server/context";
import { getCommerceRepository } from "../../server/repositories/commerce";
import { getRuntimeStore, runtimeKinds } from "../../server/runtime/store";
import { STOREFRONT_AGENT_INSTRUCTIONS } from "./prompts";
import { emptyShopperPreferences, shopperPreferencesSchema, updateShopperPreferences, type ShopperPreferences } from "./preferences";
import { storefrontToolSchemas } from "./schemas";
import { getNimModel, NimConfigurationError, NIM_MODEL_ID } from "../providers/nim";
import { compareProducts, getCart, getInventory, getProduct, searchComplementaryProducts, searchProducts, updateCart } from "../../commerce/catalog-service";
import { acceptOffer, getApprovalStatus, requestApproval, requestOffer } from "../../commerce/offer-service";
import { createCheckout, getPaymentStatus } from "../../commerce/checkout-service";
import { appendConversation, getConversation, getPageContext, getResultSet, getShortlist, savePageContext, saveResultSet, updateShortlist } from "./shopper-state";
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
  navigation?: { type: "NAVIGATE_TO_PRODUCT"; productId: string } | null;
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

const internalCustomerText = /(?:organization[_-]?id|apiproxy(?:path)?|ucp(?:endpoint)?|shopify_[a-z_]+|drizzle|postgres(?:ql)?|sqlstate|stack\s*trace|(?:select|insert|update|delete)\s+[\s\S]{0,180}\s+from\s+|\/api\/|database\s+error|internal\s+server|gid:\/\/shopify\/|\b(?:desk|chair|lamp|accessory)-\d+\b|\bhh-[a-z0-9-]+\b)/i;

const discoveryIntent = (message: string) => /\b(show|find|looking|need|want|search|suggest|options?|recommend|dikhao|dikhaiye|chahiye|mujhe|work\s*from\s*home|sofa|desk|table|chair|bed|lamp|furniture|accessor(?:y|ies))\b/i.test(message);
const detailIntent = (message: string) => /\b(how\s+(?:wide|deep|tall)|width|dimensions?|storage|drawer|material|finish|colour|color|kitna\s+wide|isme\s+storage|iske\s+dimensions|this\s+one|current\s+one|ye|isko)\b/i.test(message);
const shortlistIntent = (message: string) => /\b(shortlist|saved|save|remove|unsave|first\s+and\s+(?:third|3)|pehla\s+aur\s+(?:teesra|third)|dono\s+save|dikhao)\b/i.test(message);
const compareIntent = (message: string) => /\b(compare|comparison|dono\s+compare|tulna)\b/i.test(message);
const accessoryIntent = (message: string) => /\b(accessor(?:y|ies)|goes?\s+with|pair(?:s|ing)?|saath|acha\s+lagega|go\s+with)\b/i.test(message);
const bundleIntent = (message: string) => /\b(bundle|together|saath\s+lene|combo|set\s+mein)\b/i.test(message);
const cartIntent = (message: string) => /\b(add|cart|bag|remove|quantity|qty|add\s+to|cart\s+mein|cart\s+me|badha|kam)\b/i.test(message);
const negotiationIntent = (message: string) => /\b(discount|offer|negotiate|negotiat(?:e|ion)|price|expensive|cheaper|special\s+price|ho\s+sakta|possible)\b/i.test(message) || /(?:₹|rs\.?\s*)[\d,]+/i.test(message);
const checkoutIntent = (message: string) => /\b(checkout|pay|payment|buy|purchase|order|charge)\b/i.test(message);
const explicitConfirmation = (message: string) => /^(?:yes|yeah|yep|haan|ha|hanji|continue|proceed|confirm|confirmed|go\s+ahead|kar\s+do|kardo|ठीक|हाँ)[.!\s]*$/iu.test(message.trim());
const authorityClaim = (message: string) => /\b(employee|admin|vip|special\s+permission|ignore\s+(?:seller|store|merchant)|rules?\s+ignore|policy\s+ignore|main\s+(?:admin|employee))\b/i.test(message);

function formatPaise(value: number | undefined) {
  return typeof value === "number" ? `₹${(value / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "the current price";
}

function parseRequestedPrice(message: string) {
  const match = message.match(/(?:₹|rs\.?\s*)([\d,]+(?:\.\d{1,2})?)/i);
  return match ? Math.round(Number(match[1].replace(/,/g, "")) * 100) : undefined;
}

function ordinalIds(message: string, ids: string[]) {
  const selected: string[] = [];
  if (/\b(first|1st|pehla|pehli)\b/i.test(message) && ids[0]) selected.push(ids[0]);
  if (/\b(second|2nd|doosra|dusra)\b/i.test(message) && ids[1]) selected.push(ids[1]);
  if (/\b(third|3rd|teesra|tisra)\b/i.test(message) && ids[2]) selected.push(ids[2]);
  return [...new Set(selected)];
}

export function safeCommerceClaim(input: { message: string; text: string; offer?: { outcome?: string; approvedPricePaise?: number; counterPricePaise?: number } | null; checkout?: unknown | null }) {
  const commercial = negotiationIntent(input.message) || checkoutIntent(input.message) || authorityClaim(input.message);
  if (!commercial) return input.text;
  const offer = input.offer;
  if (offer?.outcome === "COUNTER" && typeof offer.counterPricePaise === "number") return `That price is outside the store’s current authority. I can offer ${formatPaise(offer.counterPricePaise)} instead.`;
  if (offer?.outcome === "ALLOW" && typeof offer.approvedPricePaise === "number") return `That offer is available at ${formatPaise(offer.approvedPricePaise)} under the current store policy.`;
  if (offer?.outcome === "ESCALATE") return "That request needs merchant approval. I’ve sent it for review, and you can keep browsing while we wait.";
  if (input.checkout) return input.text;
  if (authorityClaim(input.message) || /\b(?:80|90|100)%\b/i.test(input.message)) return "I can’t verify employee, admin, VIP, or special pricing status from chat. I can check the offers available under the store’s current policy.";
  return input.text;
}

function productDetailMessage(message: string, product: Record<string, unknown>) {
  if (!product) return "That product detail is not available right now.";
  const attrs = product.attributes && typeof product.attributes === "object" ? product.attributes as Record<string, unknown> : {};
  const title = typeof product.title === "string" ? product.title : typeof product.name === "string" ? product.name : "That product";
  const description = typeof product.description === "string" ? product.description : "";
  const width = typeof attrs.width === "number" ? `${attrs.width} cm wide` : typeof attrs.widthCm === "number" ? `${attrs.widthCm} cm wide` : null;
  const storage = typeof attrs.storage === "boolean" ? (attrs.storage ? "it includes storage" : "it does not include storage") : /\b(drawer|drawers|storage|cabinet|shelf|shelves)\b/i.test(description) ? "it includes storage" : null;
  const asksStorage = /storage|drawer|isme|inside/i.test(message);
  const asksWidth = /width|wide|dimension|kitna/i.test(message);
  if (asksStorage || asksWidth) {
    const details: string[] = [];
    if (asksWidth) details.push(width ? `it is ${width}` : "that dimension is not available in the current product details");
    if (asksStorage) details.push(storage || "storage information is not available in the current product details");
    return `${title} ${details.join(", and ")}.`;
  }
  if (width || storage) return `${title}${width ? ` is ${width}` : ""}${width && storage ? ", and " : storage ? " " : ""}${storage || ""}.`;
  return `I can share the public details for ${title}, but that specification is not listed in the current product details.`;
}

export function customerFacingMessage(text: string, products: unknown[]) {
  if (internalCustomerText.test(text)) {
    const names = products
      .map((product) => product && typeof product === "object" && "name" in product && typeof product.name === "string" ? product.name : product && typeof product === "object" && "title" in product && typeof product.title === "string" ? product.title : null)
      .filter((name): name is string => Boolean(name))
      .slice(0, 3);
    if (names.length === 1) return `I found ${names[0]} — a strong fit for what you described.`;
    if (names.length > 1) return `I found a few good options: ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}.`;
    return safeMessage;
  }
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

function isProviderUnavailable(error: unknown) {
  if (error instanceof NimConfigurationError) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown; statusCode?: unknown };
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return typeof record.statusCode === "number" || name.includes("apicall") || name.includes("provider") || name.includes("shopifyucp") || name.includes("abort") || message.includes("nim request timed out") || message.includes("shopify ucp request timed out");
}

function isRetryableProviderError(error: unknown) {
  if (error instanceof z.ZodError) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown; statusCode?: unknown };
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  const statusCode = typeof record.statusCode === "number" ? record.statusCode : undefined;
  return statusCode === 408 || statusCode === 429 || (statusCode !== undefined && statusCode >= 500) || name.includes("abort") || message.includes("timed out") || message.includes("timeout") || message.includes("econnreset") || message.includes("connection reset");
}

export function sanitizeBudgetClaims(text: string, maxPricePaise: number | undefined) {
  if (maxPricePaise === undefined) return text;
  const money = /(?:₹|rs\.?\s*)([\d,]+(?:\.\d{1,2})?)\s*(lakh|lac|k|thousand|hazaar|हज़ार)?/giu;
  return text.replace(money, (match, raw: string, suffix?: string) => {
    const multiplier = /lakh|lac/i.test(suffix || "") ? 100_000 : /k|thousand|hazaar|हज़ार/i.test(suffix || "") ? 1_000 : 1;
    const amountPaise = Math.round(Number(raw.replace(/,/g, "")) * multiplier * 100);
    return amountPaise > maxPricePaise ? "the budget you shared" : match;
  }).replace(/within\s+your\s+the budget you shared\s+budget/giu, "within the budget you shared");
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
  const priorConversation = await getConversation(context, sessionId);
  const priorResultSet = await getResultSet(context, sessionId);
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
  let latestNavigation: { type: "NAVIGATE_TO_PRODUCT"; productId: string } | null = null;
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
      const preferredCategory = preferences.categories[0];
      const preferredMaterial = preferences.materials.find((item) => ["wood", "walnut", "oak", "linen", "metal"].includes(item));
      const requestedMaxPrice = value.maxPricePaise === undefined ? preferences.budgetMaxPaise : preferences.budgetMaxPaise === undefined ? value.maxPricePaise : Math.min(value.maxPricePaise, preferences.budgetMaxPaise);
      const requestedMaxWidth = value.maxWidthCm === undefined ? preferences.widthMaxCm : preferences.widthMaxCm === undefined ? value.maxWidthCm : Math.min(value.maxWidthCm, preferences.widthMaxCm);
      const result = await searchProducts(context, session, { ...value, category: value.category || preferredCategory, material: value.material || preferredMaterial, maxPricePaise: requestedMaxPrice, maxWidthCm: requestedMaxWidth, excludeFrameType: value.excludeFrameType || preferences.exclusions.join(" ") });
      products.push(...result);
      return { products: result };
    }),
    get_product: callTool("get_product", storefrontToolSchemas.get_product, async (value) => { const result = await getProduct(context, session, value.productId); if (result) products.push(result); return { product: result }; }),
    compare_products: callTool("compare_products", storefrontToolSchemas.compare_products, async (value) => { const compared = await compareProducts(context, session, value.productIds); products.push(...compared); return { products: compared, matrix: buildComparisonMatrix(compared) }; }),
    get_inventory: callTool("get_inventory", storefrontToolSchemas.get_inventory, async (value) => getInventory(context, session, value.productId, value.variantId)),
    get_cart: callTool("get_cart", storefrontToolSchemas.get_cart, async () => { latestCart = await getCart(context, session); return latestCart; }),
    update_cart: callTool("update_cart", storefrontToolSchemas.update_cart, async (value) => {
      const current = await getCart(context, session);
      const requested = new Map(value.lines.map((line) => [line.variantId, line.quantity]));
      const merged = current.lines.map((line) => ({ variantId: line.variantId, quantity: requested.has(line.variantId) ? requested.get(line.variantId)! : line.quantity }));
      for (const line of value.lines) if (!current.lines.some((existing) => existing.variantId === line.variantId)) merged.push(line);
      latestCart = await updateCart(context, session, merged);
      await repository.recordAudit(context, { eventType: "CART_UPDATED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { lineCount: merged.length } });
      return latestCart;
    }),
    request_offer: callTool("request_offer", storefrontToolSchemas.request_offer, async (value) => { latestOffer = await requestOffer(context, { sessionId, ...value }); return latestOffer; }),
    accept_offer: callTool("accept_offer", storefrontToolSchemas.accept_offer, async (value) => { latestOffer = await acceptOffer(context, value.offerId); return latestOffer; }),
    request_approval: callTool("request_approval", storefrontToolSchemas.request_approval, async (value) => { latestApproval = await requestApproval(context, value.offerId); return latestApproval; }),
    get_approval_status: callTool("get_approval_status", storefrontToolSchemas.get_approval_status, async (value) => { latestApproval = await getApprovalStatus(context, value.approvalId); return latestApproval; }),
    create_checkout: callTool("create_checkout", storefrontToolSchemas.create_checkout, async () => {
      if (!explicitConfirmation(message)) throw new Error("Please confirm the current total before checkout.");
      const idempotencyKey = createHash("sha256").update(`${context.correlationId}:${sessionId}`).digest("hex"); latestCheckout = await createCheckout(context, { sessionId, idempotencyKey }); return latestCheckout;
    }),
    get_payment_status: callTool("get_payment_status", storefrontToolSchemas.get_payment_status, async (value) => { latestCheckout = await getPaymentStatus(context, value.transactionId); return latestCheckout; }),
    add_to_shortlist: callTool("add_to_shortlist", storefrontToolSchemas.add_to_shortlist, async (value) => ({ shortlist: await updateShortlist(context, sessionId, { add: value.productIds }) })),
    remove_from_shortlist: callTool("remove_from_shortlist", storefrontToolSchemas.remove_from_shortlist, async (value) => ({ shortlist: await updateShortlist(context, sessionId, { remove: value.productIds }) })),
    open_shortlist: callTool("open_shortlist", storefrontToolSchemas.open_shortlist, async () => ({ shortlist: await getShortlist(context, sessionId) })),
    navigate_to_product: callTool("navigate_to_product", storefrontToolSchemas.navigate_to_product, async (value) => { latestNavigation = { type: "NAVIGATE_TO_PRODUCT", productId: value.productId }; return latestNavigation; }),
  };

  try {
    const agent = new ToolLoopAgent({ id: "agentflow-storefront", model: getNimModel(), instructions: `${STOREFRONT_AGENT_INSTRUCTIONS}\n${salesperson ? personaInstruction(salesperson, language) : "Use a concise customer-facing tone."}`, tools, providerOptions: { nvidiaNim: { chat_template_kwargs: { enable_thinking: true, force_nonempty_content: true } } }, stopWhen: isStepCount(4), temperature: 1, topP: 0.95, maxOutputTokens: 256 });
    const prompt = `Trusted storefront session context: currency=${session.currency}; language=${language}; preferences=${JSON.stringify(preferences)}; pageContext=${JSON.stringify(safePageContext)}; recentConversation=${JSON.stringify(priorConversation)}; latestResultProductIds=${JSON.stringify(priorResultSet.productIds)}.\nFor clear shopping intent you must use the appropriate typed tool. Follow-up ordinals refer to latestResultProductIds. Never invent a product or commercial result.\nCustomer request: ${message}`;
    const generationTimeout = { totalMs: Number(process.env.AGENT_TOTAL_TIMEOUT_MS || 45_000), stepMs: Number(process.env.AGENT_STEP_TIMEOUT_MS || 15_000), toolMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS || 8_000) };
    const repairPrompt = `${prompt}\nThis is a bounded same-provider retry. Complete the shopper's request using the appropriate typed AgentFlow tool now. For discovery, execute search_products with the hard constraints you can infer and return NO_RESULTS if none match. For detail, comparison, shortlist, accessory, cart, offer, or checkout requests, use the corresponding typed tool. Do not answer with unsupported commercial prose.`;
    let repaired = false;
    let result;
    try {
      result = await agent.generate({ prompt, timeout: generationTimeout });
    } catch (error) {
      // A malformed provider tool call is recoverable once. Keep the retry in
      // the same provider/tool boundary; never switch to a deterministic or
      // mock answer while claiming the model completed the turn.
      if (products.length === 0 && isRetryableProviderError(error)) {
        repaired = true;
        result = await agent.generate({ prompt: repairPrompt, timeout: { totalMs: Number(process.env.AGENT_REPAIR_TIMEOUT_MS || 20_000), stepMs: Number(process.env.AGENT_STEP_TIMEOUT_MS || 10_000), toolMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS || 8_000) } });
      } else {
        throw error;
      }
    }
    // Nemotron occasionally returns a helpful paragraph without completing a
    // discovery tool call. One bounded repair keeps the provider in the loop
    // while guaranteeing that the turn either produces a structured result or
    // reports an honest retry state.
    if (!repaired && discoveryIntent(message) && products.length === 0 && !detailIntent(message) && !bundleIntent(message) && !cartIntent(message)) {
      repaired = true;
      result = await agent.generate({ prompt: repairPrompt, timeout: { totalMs: Number(process.env.AGENT_REPAIR_TIMEOUT_MS || 20_000), stepMs: Number(process.env.AGENT_STEP_TIMEOUT_MS || 10_000), toolMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS || 8_000) } });
    }

    const currentProductId = safePageContext.currentProductId;
    if (detailIntent(message) && currentProductId && products.length === 0) {
      const currentProduct = await getProduct(context, session, currentProductId);
      if (currentProduct) products.push(currentProduct);
    }

    if (shortlistIntent(message)) {
      const selected = ordinalIds(message, priorResultSet.productIds);
      if (selected.length && /\b(save|add|rakh|kar\s+do)\b/i.test(message)) await updateShortlist(context, sessionId, { add: selected });
      const shouldOpen = /shortlist|saved|save\s+list|dikhao/i.test(message);
      if (shouldOpen && products.length === 0) {
        const saved = await getShortlist(context, sessionId);
        const savedProducts = (await Promise.all(saved.productIds.map((productId) => getProduct(context, session, productId)))).filter(Boolean);
        products.push(...savedProducts);
      }
    }

    if (compareIntent(message) && products.length < 2) {
      const saved = await getShortlist(context, sessionId);
      const ids = saved.productIds.length >= 2 ? saved.productIds : priorResultSet.productIds;
      const explicit = ordinalIds(message, ids);
      const compared = await compareProducts(context, session, explicit.length >= 2 ? explicit : ids.slice(0, 4));
      products.push(...compared);
    }

    if (accessoryIntent(message)) {
      const sourceId = currentProductId || priorResultSet.productIds[0];
      if (sourceId) {
        const source = await getProduct(context, session, sourceId);
        if (source) {
          const complementary = await searchComplementaryProducts(context, session, source);
          // Accessory intent is intentionally narrower than general discovery:
          // never let a broad model search replace the contextual, server-side
          // complementary set with unrelated primary furniture.
          products.splice(0, products.length, ...complementary);
        }
      }
    }

    if (bundleIntent(message)) {
      try { growthActions = (await getEligibleGrowthActions({ context, sessionId })).actions; } catch { growthActions = []; }
    }

    const actionableNegotiation = /\b(discount|offer|negotiate|expensive|cheaper|special\s+price|ho\s+sakta|possible)\b|(?:₹|rs\.?\s*)[\d,]+/i.test(message);
    if (actionableNegotiation && !latestOffer) {
      const sourceId = currentProductId || priorResultSet.productIds[0] || (products[0] && typeof products[0] === "object" && "id" in products[0] ? String((products[0] as { id: string }).id) : undefined);
      if (sourceId) {
        const requestedPricePaise = parseRequestedPrice(message);
        try { latestOffer = await requestOffer(context, { sessionId, productId: sourceId, quantity: 1, ...(requestedPricePaise !== undefined ? { requestedUnitPricePaise: requestedPricePaise } : { requestedDiscountBps: 0 }) }); } catch { /* the model/tool result remains authoritative when it exists */ }
      }
    }

    if (cartIntent(message) && !latestCart) {
      const requestedQuantity = Number(message.match(/(?:quantity|qty|make|set|kar(?:o|na)?)[^\d]{0,12}(\d+)/i)?.[1] || 1);
      let sourceId = ordinalIds(message, priorResultSet.productIds)[0] || currentProductId;
      if (!sourceId) {
        const search = await searchProducts(context, session, { query: message, limit: 3, availability: "in_stock" });
        products.push(...search);
        sourceId = search[0] && typeof search[0] === "object" && "id" in search[0] ? String((search[0] as { id: string }).id) : undefined;
      }
      if (sourceId) {
        const source = await getProduct(context, session, sourceId);
        const variantId = source && "variants" in source && Array.isArray(source.variants) ? source.variants.find((variant) => variant.available !== false)?.id || source.variants[0]?.id : sourceId;
        if (variantId) {
          const current = await getCart(context, session);
          const merged = current.lines.map((line) => ({ variantId: line.variantId, quantity: line.variantId === variantId ? requestedQuantity : line.quantity }));
          if (!current.lines.some((line) => line.variantId === variantId)) merged.push({ variantId, quantity: Math.max(1, requestedQuantity) });
          latestCart = await updateCart(context, session, merged);
        }
      }
    }

    try {
      if (!growthActions.length) {
        const eligible = await getEligibleGrowthActions({ context, sessionId });
        growthActions = eligible.actions;
      }
    } catch {
      growthActions = [];
    }
    const uniqueProducts = new Map<string, unknown>();
    for (const product of products) {
      const productId = product && typeof product === "object" && "id" in product && typeof product.id === "string" ? product.id : undefined;
      if (productId && !uniqueProducts.has(productId)) uniqueProducts.set(productId, product);
    }
    products.splice(0, products.length, ...uniqueProducts.values());
    const resultProductIds = products.flatMap((product) => product && typeof product === "object" && "id" in product && typeof product.id === "string" ? [product.id] : []);
    if (!/\b(shortlist|saved|save\s+list)\b/i.test(message)) await saveResultSet(context, sessionId, resultProductIds);
    let text = customerFacingMessage(stripReasoningMarkers(result.text.trim()) || "I can help you explore the catalogue and your cart.", products);
    if (discoveryIntent(message) && products.length > 0) text = sanitizeBudgetClaims(text, preferences.budgetMaxPaise);
    if (detailIntent(message) && currentProductId && products[0] && typeof products[0] === "object") text = productDetailMessage(message, products[0] as Record<string, unknown>);
    if (discoveryIntent(message) && products.length === 0 && !bundleIntent(message) && !shortlistIntent(message) && !cartIntent(message)) text = "I couldn’t find an exact match for those requirements. Would you like to relax one of them and see the closest alternatives?";
    if (bundleIntent(message) && growthActions.length === 0) text = "I don’t currently have an eligible bundle for those items. I can still suggest complementary pieces.";
    if (checkoutIntent(message) && !latestCheckout && !authorityClaim(message)) {
      const cart = latestCart || await getCart(context, session).catch(() => null);
      const total = cart && typeof cart === "object" && "totalMinorUnits" in cart && typeof cart.totalMinorUnits === "number" ? formatPaise((cart as { totalMinorUnits: number }).totalMinorUnits) : "the current total";
      text = explicitConfirmation(message) ? "I couldn’t create a verified checkout for this cart yet. Please try again once the current offer is accepted." : `Your current total is ${total}. Would you like to continue to secure checkout?`;
    }
    text = safeCommerceClaim({ message, text, offer: latestOffer && typeof latestOffer === "object" ? latestOffer as { outcome?: string; approvedPricePaise?: number; counterPricePaise?: number } : null, checkout: latestCheckout });
    await appendConversation(context, sessionId, { role: "assistant", text });
    const shortlist = await getShortlist(context, sessionId);
    if (products.length > 0) await repository.recordAudit(context, { eventType: "PRODUCTS_SHOWN", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { count: Math.min(products.length, 20), productIds: products.slice(0, 20).map((product) => product && typeof product === "object" && "id" in product ? product.id : null).filter((value): value is string => typeof value === "string") } });
    const ui = projectStorefrontUi({ message: text, products, cart: latestCart, offer: latestOffer && typeof latestOffer === "object" ? latestOffer as { offerId?: string; outcome?: string } : null, approval: latestApproval && typeof latestApproval === "object" ? latestApproval as { approvalId?: string } : null, checkout: latestCheckout, shortlistProductIds: shortlist.productIds });
    const latencyMs = Date.now() - turnStartedAt;
    await repository.recordAudit(context, { eventType: "AGENT_TURN_COMPLETED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { modelCalls: result.steps.length, toolSteps, responseLength: text.length, latencyMs, toolTimings } });
    return { sessionId, message: text, status: "COMPLETED", products: products.slice(0, 20), cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, navigation: latestNavigation, model: process.env.NIM_MODEL_ID || NIM_MODEL_ID, modelCalls: result.steps.length, toolSteps, ui, shortlist: shortlist.productIds, growthActions, latencyMs, timings: { totalMs: latencyMs, tools: toolTimings }, salesperson, language };
  } catch (error) {
    const configuration = error instanceof NimConfigurationError;
    const providerUnavailable = isProviderUnavailable(error);
    const validationIssues = error instanceof z.ZodError
      ? error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: issue.code, message: issue.message }))
      : undefined;
    const partialProductResult = products.length > 0;
    if (!partialProductResult) {
      console.error("[agentflow] storefront agent execution failed", {
        name: error instanceof Error ? error.name : typeof error,
        statusCode: typeof error === "object" && error !== null && "statusCode" in error ? String((error as { statusCode?: unknown }).statusCode ?? "") : undefined,
        validationIssues,
      });
    }
    await repository.recordAudit(context, { eventType: partialProductResult ? "AGENT_TURN_COMPLETED" : "TRANSACTION_FAILED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { reason: partialProductResult ? "partial_product_result_recovered" : configuration ? "nim_not_configured" : "agent_execution_failed", validationIssues: validationIssues || null } });
    const shortlist = await getShortlist(context, sessionId).catch(() => ({ productIds: [] }));
    const text = products.length > 0
      ? customerFacingMessage("I found a few options for you.", products)
      : configuration
        ? "The storefront assistant is not enabled for this environment yet."
        : providerUnavailable
          ? "The storefront assistant is temporarily unavailable. Please try again in a moment."
          : safeMessage;
    const latencyMs = Date.now() - turnStartedAt;
    return { sessionId, message: text, status: partialProductResult ? "COMPLETED" : providerUnavailable ? "PROVIDER_UNAVAILABLE" : "FAILED", products, cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, navigation: latestNavigation, model: process.env.NIM_MODEL_ID || NIM_MODEL_ID, modelCalls: 0, toolSteps, ui: projectStorefrontUi({ message: text, products, shortlistProductIds: shortlist.productIds }), shortlist: shortlist.productIds, growthActions: [], latencyMs, timings: { totalMs: latencyMs, tools: toolTimings }, salesperson, language };
  }
}
