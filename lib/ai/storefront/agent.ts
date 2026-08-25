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

async function loadPreferences(context: TrustedRequestContext, sessionId: string) {
  const record = await getRuntimeStore().get<ShopperPreferences>(context, runtimeKinds.shopperPreferences, sessionId);
  return record ? shopperPreferencesSchema.parse(record.payload) : emptyShopperPreferences;
}

async function savePreferences(context: TrustedRequestContext, sessionId: string, preferences: ShopperPreferences) {
  const timestamp = new Date().toISOString();
  await getRuntimeStore().put(context, { id: sessionId, kind: runtimeKinds.shopperPreferences, status: "ACTIVE", payload: preferences, createdAt: timestamp, updatedAt: timestamp });
}

export async function runStorefrontAgent(input: { context: TrustedRequestContext; sessionId: string; message: string; storefrontContext?: Record<string, unknown> }): Promise<StorefrontAgentResult> {
  const { context, sessionId, message } = input;
  const repository = getCommerceRepository();
  const session = await repository.getSession(context, sessionId);
  if (!session) throw new Error("Commerce session was not found.");
  const preferences = updateShopperPreferences(message, await loadPreferences(context, sessionId));
  await savePreferences(context, sessionId, preferences);
  await repository.recordAudit(context, { eventType: "AGENT_TURN_STARTED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { messageLength: message.length, preferenceFields: Object.keys(preferences).filter((key) => (preferences as Record<string, unknown>)[key] !== undefined).length } });

  const products: unknown[] = [];
  let latestCart: unknown | null = null;
  let latestOffer: unknown | null = null;
  let latestApproval: unknown | null = null;
  let latestCheckout: unknown | null = null;
  let toolSteps = 0;
  const callTool = <S extends ZodType>(name: string, inputSchema: S, execute: (input: z.infer<S>) => Promise<unknown>) => tool({
    description: `AgentFlow server tool: ${name}.`,
    inputSchema,
    execute: async (toolInput: z.infer<S>) => {
      toolSteps += 1;
      if (toolSteps > 6) throw new Error("Storefront agent tool-step budget exceeded.");
      await repository.recordAudit(context, { eventType: "AGENT_TOOL_REQUESTED", entityType: "agent_tool", entityId: `${sessionId}:${toolSteps}`, shoppingSessionId: sessionId, metadata: { tool: name } });
      try {
        const result = await execute(toolInput);
        await repository.recordAudit(context, { eventType: "AGENT_TOOL_SUCCEEDED", entityType: "agent_tool", entityId: `${sessionId}:${toolSteps}`, shoppingSessionId: sessionId, metadata: { tool: name } });
        return result;
      } catch (error) {
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
    compare_products: callTool("compare_products", storefrontToolSchemas.compare_products, async (value) => ({ products: await compareProducts(context, session, value.productIds) })),
    get_inventory: callTool("get_inventory", storefrontToolSchemas.get_inventory, async (value) => getInventory(context, session, value.productId, value.variantId)),
    get_cart: callTool("get_cart", storefrontToolSchemas.get_cart, async () => { latestCart = await getCart(context, session); return latestCart; }),
    update_cart: callTool("update_cart", storefrontToolSchemas.update_cart, async (value) => { latestCart = await updateCart(context, session, value.lines); await repository.recordAudit(context, { eventType: "CART_UPDATED", entityType: "shopping_session", entityId: sessionId, shoppingSessionId: sessionId, metadata: { lineCount: value.lines.length } }); return latestCart; }),
    request_offer: callTool("request_offer", storefrontToolSchemas.request_offer, async (value) => { latestOffer = await requestOffer(context, { sessionId, ...value }); return latestOffer; }),
    accept_offer: callTool("accept_offer", storefrontToolSchemas.accept_offer, async (value) => { latestOffer = await acceptOffer(context, value.offerId); return latestOffer; }),
    request_approval: callTool("request_approval", storefrontToolSchemas.request_approval, async (value) => { latestApproval = await requestApproval(context, value.offerId); return latestApproval; }),
    get_approval_status: callTool("get_approval_status", storefrontToolSchemas.get_approval_status, async (value) => { latestApproval = await getApprovalStatus(context, value.approvalId); return latestApproval; }),
    create_checkout: callTool("create_checkout", storefrontToolSchemas.create_checkout, async () => { const idempotencyKey = createHash("sha256").update(`${context.correlationId}:${sessionId}`).digest("hex"); latestCheckout = await createCheckout(context, { sessionId, idempotencyKey }); return latestCheckout; }),
    get_payment_status: callTool("get_payment_status", storefrontToolSchemas.get_payment_status, async (value) => { latestCheckout = await getPaymentStatus(context, value.transactionId); return latestCheckout; }),
  };

  try {
    const agent = new ToolLoopAgent({ id: "agentflow-storefront", model: getNimModel(), instructions: STOREFRONT_AGENT_INSTRUCTIONS, tools, stopWhen: isStepCount(4), temperature: 0, maxOutputTokens: 512 });
    const result = await agent.generate({ prompt: `Trusted storefront session context: currency=${session.currency}; preferences=${JSON.stringify(preferences)}; page=${input.storefrontContext?.pageType || "unknown"}.\nCustomer request: ${message}`, timeout: { totalMs: Number(process.env.AGENT_TOTAL_TIMEOUT_MS || 25_000), stepMs: Number(process.env.AGENT_STEP_TIMEOUT_MS || 8_000), toolMs: Number(process.env.AGENT_TOOL_TIMEOUT_MS || 8_000) } });
    if (products.length === 0 && preferences.categories.length > 0) {
      const recoveryQuery = preferences.categories[0];
      await repository.recordAudit(context, { eventType: "AGENT_TOOL_REQUESTED", entityType: "agent_tool", entityId: `${sessionId}:discovery-recovery`, shoppingSessionId: sessionId, metadata: { tool: "search_products", source: "deterministic_discovery_recovery" } });
      const recovery = await searchProducts(context, session, { query: recoveryQuery, limit: 5, maxPricePaise: preferences.budgetMaxPaise });
      products.push(...recovery);
      await repository.recordAudit(context, { eventType: "AGENT_TOOL_SUCCEEDED", entityType: "agent_tool", entityId: `${sessionId}:discovery-recovery`, shoppingSessionId: sessionId, metadata: { tool: "search_products", source: "deterministic_discovery_recovery", resultCount: recovery.length } });
    }
    const text = customerFacingMessage(result.text.trim() || "I can help you explore the catalogue and your cart.", products);
    await repository.recordAudit(context, { eventType: "AGENT_TURN_COMPLETED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { modelCalls: result.steps.length, toolSteps, responseLength: text.length } });
    return { sessionId, message: text, status: "COMPLETED", products: products.slice(0, 20), cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, model: process.env.NIM_MODEL_ID || "meta/llama-3.1-8b-instruct", modelCalls: result.steps.length, toolSteps };
  } catch (error) {
    const configuration = error instanceof NimConfigurationError;
    await repository.recordAudit(context, { eventType: "TRANSACTION_FAILED", entityType: "agent_turn", entityId: id("turn"), shoppingSessionId: sessionId, metadata: { reason: configuration ? "nim_not_configured" : "agent_execution_failed" } });
    return { sessionId, message: configuration ? "The storefront assistant is not enabled for this environment yet." : safeMessage, status: configuration ? "PROVIDER_UNAVAILABLE" : "FAILED", products, cart: latestCart, offer: latestOffer, approval: latestApproval, checkout: latestCheckout, model: process.env.NIM_MODEL_ID || "meta/llama-3.1-8b-instruct", modelCalls: 0, toolSteps };
  }
}
