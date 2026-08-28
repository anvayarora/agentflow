import { z } from "zod";
import type { TrustedRequestContext } from "../../server/context";
import { getRuntimeStore, runtimeKinds } from "../../server/runtime/store";
import { getCommerceRepository, type SessionRecord } from "../../server/repositories/commerce";
import { getProduct } from "../../commerce/catalog-service";

const shortlistSchema = z.object({ productIds: z.array(z.string().min(1).max(255)).max(12) }).strict();
export const pageContextSchema = z.object({ pageType: z.enum(["home", "collection", "product", "search", "cart", "other"]).default("other"), currentProductId: z.string().max(255).optional(), currentCollection: z.string().max(120).optional(), url: z.string().url().max(2048).optional() }).strict();
export type ShopperPageContext = z.infer<typeof pageContextSchema>;

async function session(context: TrustedRequestContext, sessionId: string): Promise<SessionRecord> {
  const found = await getCommerceRepository().getSession(context, sessionId);
  if (!found) throw new Error("Commerce session was not found.");
  return found;
}

export async function getShortlist(context: TrustedRequestContext, sessionId: string) {
  await session(context, sessionId);
  const record = await getRuntimeStore().get<{ productIds: string[] }>(context, runtimeKinds.shortlist, sessionId);
  return shortlistSchema.parse(record?.payload || { productIds: [] });
}

export async function updateShortlist(context: TrustedRequestContext, sessionId: string, input: { add?: string[]; remove?: string[]; replace?: string[] }) {
  const current = await getShortlist(context, sessionId);
  const nextIds = input.replace ? [...input.replace] : [...current.productIds, ...(input.add || [])].filter((id) => !(input.remove || []).includes(id));
  const validIds: string[] = [];
  for (const productId of [...new Set(nextIds)].slice(0, 12)) if (await getProduct(context, await session(context, sessionId), productId)) validIds.push(productId);
  const next = shortlistSchema.parse({ productIds: validIds });
  await getRuntimeStore().put(context, { id: sessionId, kind: runtimeKinds.shortlist, status: "ACTIVE", payload: next });
  await getCommerceRepository().recordAudit(context, { eventType: "PRODUCT_SHORTLISTED", entityType: "shopper_shortlist", entityId: sessionId, shoppingSessionId: sessionId, metadata: { productCount: next.productIds.length } });
  return next;
}

export async function savePageContext(context: TrustedRequestContext, sessionId: string, input: ShopperPageContext) {
  const next = pageContextSchema.parse(input);
  await session(context, sessionId);
  await getRuntimeStore().put(context, { id: sessionId, kind: runtimeKinds.pageContext, status: "ACTIVE", payload: next });
  return next;
}

export async function getPageContext(context: TrustedRequestContext, sessionId: string) {
  await session(context, sessionId);
  const record = await getRuntimeStore().get<ShopperPageContext>(context, runtimeKinds.pageContext, sessionId);
  return record ? pageContextSchema.parse(record.payload) : pageContextSchema.parse({});
}

export async function appendConversation(context: TrustedRequestContext, sessionId: string, message: { role: "user" | "assistant"; text: string }) {
  await session(context, sessionId);
  const existing = await getRuntimeStore().get<{ messages: Array<{ role: "user" | "assistant"; text: string }> }>(context, runtimeKinds.conversation, sessionId);
  const messages = [...(existing?.payload.messages || []), { role: message.role, text: message.text }].slice(-40);
  await getRuntimeStore().put(context, { id: sessionId, kind: runtimeKinds.conversation, status: "ACTIVE", payload: { messages } });
  return messages;
}
