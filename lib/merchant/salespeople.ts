import type { TrustedRequestContext } from "../server/context";
import { getCommerceRepository } from "../server/repositories/commerce";
import { getSalespersonRepository } from "../server/repositories/salesperson";
import { getRuntimeStore, runtimeKinds } from "../server/runtime/store";
import type { TransactionPayload, PaymentPayload } from "../commerce/checkout-service";

export type SalespersonStats = {
  profile: Awaited<ReturnType<ReturnType<typeof getSalespersonRepository>["get"]>>;
  selectionCount: number;
  assistedSessions: number;
  voiceTurns: number;
  productsViewed: number;
  cartAdditions: number;
  growthPlaysPresented: number;
  growthPlaysAccepted: number;
  offersRequested: number;
  verifiedOrdersAssisted: number;
  verifiedUnitsAssisted: number;
  verifiedRevenueAssistedPaise: number;
  verifiedAovPaise: number;
  bundleAcceptanceBps: number | null;
  topLanguage: string | null;
  history: "OBSERVED" | "INSUFFICIENT_HISTORY";
};

export async function getSalespersonStats(context: TrustedRequestContext) {
  const profiles = (await getSalespersonRepository().ensureDefaults(context)).filter((profile) => profile.isActive);
  const events = await getCommerceRepository().listAudit(context, 500);
  const transactions = await getRuntimeStore().list<TransactionPayload>(context, runtimeKinds.transaction, 500);
  const payments = await getRuntimeStore().list<PaymentPayload>(context, runtimeKinds.payment, 500);
  const rows: SalespersonStats[] = [];
  for (const profile of profiles) {
    const selectedEvents = events.filter((event) => event.entityId === profile.id && ["SALESPERSON_SELECTED", "SALESPERSON_CHANGED"].includes(event.eventType));
    const sessionIds = new Set(selectedEvents.map((event) => event.shoppingSessionId).filter((id): id is string => Boolean(id)));
    const profileEvents = events.filter((event) => event.metadata?.salespersonProfileId === profile.id || event.entityId === profile.id);
    const completed = transactions.filter((transaction) => {
      const sessionId = transaction.payload.sessionId;
      return sessionIds.has(sessionId) && transaction.payload.status === "PAID" && payments.some((payment) => payment.payload.transactionId === transaction.id && payment.payload.status === "PAID");
    });
    const languageCounts = new Map<string, number>();
    for (const event of profileEvents) { const language = typeof event.metadata?.language === "string" ? event.metadata.language : null; if (language) languageCounts.set(language, (languageCounts.get(language) || 0) + 1); }
    const topLanguage = [...languageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const offers = profileEvents.filter((event) => event.eventType === "OFFER_REQUESTED").length;
    const bundlePresented = profileEvents.filter((event) => event.eventType === "GROWTH_PLAY_SHOWN").length;
    const bundleAccepted = profileEvents.filter((event) => event.eventType === "GROWTH_PLAY_ACCEPTED").length;
    const revenue = completed.reduce((sum, transaction) => sum + transaction.payload.amountPaise, 0);
    rows.push({ profile, selectionCount: selectedEvents.length, assistedSessions: sessionIds.size, voiceTurns: profileEvents.filter((event) => event.eventType === "AGENT_TURN_STARTED" && event.metadata?.inputMode === "voice").length, productsViewed: profileEvents.filter((event) => event.eventType === "PRODUCTS_SHOWN").reduce((sum, event) => sum + (typeof event.metadata?.count === "number" ? event.metadata.count : 1), 0), cartAdditions: profileEvents.filter((event) => event.eventType === "CART_UPDATED").length, growthPlaysPresented: bundlePresented, growthPlaysAccepted: bundleAccepted, offersRequested: offers, verifiedOrdersAssisted: completed.length, verifiedUnitsAssisted: completed.length, verifiedRevenueAssistedPaise: revenue, verifiedAovPaise: completed.length ? Math.round(revenue / completed.length) : 0, bundleAcceptanceBps: bundlePresented ? Math.round(bundleAccepted * 10_000 / bundlePresented) : null, topLanguage, history: sessionIds.size >= 20 ? "OBSERVED" : "INSUFFICIENT_HISTORY" });
  }
  const eligible = rows.filter((row) => row.assistedSessions >= 20);
  const recommendedDefault = eligible.sort((a, b) => b.verifiedOrdersAssisted - a.verifiedOrdersAssisted || (b.bundleAcceptanceBps || 0) - (a.bundleAcceptanceBps || 0) || b.selectionCount - a.selectionCount)[0] || null;
  return { profiles: rows, minimumEligibleSessions: 20, recommendedDefault: recommendedDefault ? { profileId: recommendedDefault.profile?.id, reason: "Highest verified assisted orders after the 20-session minimum; tie-breakers are bundle acceptance then shopper selection." } : null };
}
