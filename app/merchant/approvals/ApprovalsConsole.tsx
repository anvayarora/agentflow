"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "../merchant-ui";

type Tab = "approvals" | "transactions" | "audit" | "red-team";
type Approval = { approvalId: string; status: string; priority: number; createdAt: string; expiresAt: string | null; customer: { segment: string; orderCount: number } | null; product: { name?: string; sku?: string; listPricePaise?: number }; offer: { requestedUnitPricePaise: number; requestedDiscountBps: number; counterPricePaise?: number | null; outcome: string } | null; evidence?: { explanation: string } | null };
type Transaction = { transactionId: string; status: string; amountPaise: number; currency: string; provider: string; payment: { status: string; verified: boolean }; classification: { aiAssisted: boolean; negotiated: boolean; hitl: boolean; growthPlay: boolean }; revenueState: string };
type Audit = { id: string; eventType: string; entityType: string; entityId: string; actorType: string; createdAt: string; explanation: string };

const money = (paise?: number) => typeof paise === "number" ? `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";

export default function ApprovalsConsole() {
  const [tab, setTab] = useState<Tab>("approvals");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [message, setMessage] = useState("Loading merchant operations…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [approvalResponse, transactionResponse, auditResponse] = await Promise.all([fetch("/api/merchant/approvals"), fetch("/api/merchant/transactions"), fetch("/api/merchant/audit")]);
    const approvalBody = await approvalResponse.json() as { approvals?: Approval[]; error?: string };
    const transactionBody = await transactionResponse.json() as { transactions?: Transaction[] };
    const auditBody = await auditResponse.json() as { events?: Audit[] };
    setApprovals(approvalBody.approvals || []);
    setTransactions(transactionBody.transactions || []);
    setAudit(auditBody.events || []);
    setMessage(approvalResponse.ok ? "Server-authoritative operations are up to date." : approvalBody.error || "Merchant operations are unavailable.");
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const decide = async (approvalId: string, decision: "APPROVE" | "COUNTER" | "REJECT", counterPricePaise?: number) => {
    setBusy(true);
    const response = await fetch("/api/merchant/approvals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId, decision, ...(counterPricePaise === undefined ? {} : { counterPricePaise }) }) });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? `Approval ${decision.toLowerCase()}d and propagated to the shopper workflow.` : body.error || "Approval decision failed.");
    await load();
    setBusy(false);
  };

  const runRedTeam = async () => {
    setBusy(true);
    const response = await fetch("/api/merchant/red-team", { method: "POST" });
    const body = await response.json() as { passed?: boolean; checks?: Array<{ id: string; passed: boolean }>; unauthorizedPaymentCalls?: number; error?: string };
    setMessage(response.ok ? `Red-team run ${body.passed ? "passed" : "needs review"} · ${body.checks?.filter((check) => check.passed).length || 0}/${body.checks?.length || 0} checks · provider calls ${body.unauthorizedPaymentCalls ?? "—"}.` : body.error || "Red-team run failed.");
    setTab("red-team");
    setBusy(false);
  };

  return <section className="workspace-card operations-console"><div className="operations-tabs" role="tablist" aria-label="Merchant operations">{(["approvals", "transactions", "audit", "red-team"] as Tab[]).map((item) => <button className={tab === item ? "operations-tab active" : "operations-tab"} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} key={item}>{item === "red-team" ? "Red team" : item[0].toUpperCase() + item.slice(1)}{item === "approvals" && approvals.filter((approval) => approval.status === "PENDING").length ? <b>{approvals.filter((approval) => approval.status === "PENDING").length}</b> : null}</button>)}</div><p className="operations-message">{message}</p>{tab === "approvals" ? <ApprovalList approvals={approvals} busy={busy} onDecide={decide} /> : null}{tab === "transactions" ? <TransactionList transactions={transactions} /> : null}{tab === "audit" ? <AuditList audit={audit} /> : null}{tab === "red-team" ? <div className="operations-empty"><span className="compile-empty-mark">◌</span><h3>Adversarial controls</h3><p>Run the live harness against the same policy, cart, checkout, and tenant boundaries used by the customer experience.</p><button className="button button-dark" type="button" onClick={runRedTeam} disabled={busy}>{busy ? "Running…" : "Run red-team checks"}</button></div> : null}</section>;
}

function ApprovalList({ approvals, busy, onDecide }: { approvals: Approval[]; busy: boolean; onDecide: (id: string, decision: "APPROVE" | "COUNTER" | "REJECT", price?: number) => Promise<void> }) {
  const pending = approvals.filter((approval) => approval.status === "PENDING");
  if (!pending.length) return <div className="operations-empty"><span className="compile-empty-mark">✓</span><h3>No pending approvals.</h3><p>When the policy runtime escalates a request, the shopper and this queue will share the same status.</p></div>;
  return <div className="operations-list">{pending.map((approval) => <article className="operation-row" key={approval.approvalId}><div className="operation-main"><span className="section-label">Priority {approval.priority}</span><h3>{approval.product?.name || approval.product?.sku || "Commerce request"}</h3><p>{approval.customer?.segment === "repeat" ? "Returning customer" : "New customer"} · {approval.offer?.requestedDiscountBps ? `${(approval.offer.requestedDiscountBps / 100).toFixed(2)}% requested` : "Price review"}</p><small>{approval.evidence?.explanation || "Review the canonical product, customer, cart, and policy context."}</small></div><div className="operation-value"><span>Requested</span><strong>{money(approval.offer?.requestedUnitPricePaise)}</strong><small>Expires {approval.expiresAt ? new Date(approval.expiresAt).toLocaleTimeString() : "—"}</small></div><div className="operation-actions"><button className="button button-dark" type="button" disabled={busy} onClick={() => onDecide(approval.approvalId, "APPROVE")}>Approve</button><button className="button button-light" type="button" disabled={busy} onClick={() => onDecide(approval.approvalId, "COUNTER", approval.offer?.counterPricePaise || approval.offer?.requestedUnitPricePaise)}>Counter</button><button className="text-link" type="button" disabled={busy} onClick={() => onDecide(approval.approvalId, "REJECT")}>Reject</button></div></article>)}</div>;
}

function TransactionList({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <div className="operations-empty"><span className="compile-empty-mark">₹</span><h3>No transactions yet.</h3><p>Only server-created transactions and provider-verified payments appear here. Preview and simulated activity never becomes revenue.</p></div>;
  return <div className="operations-list">{transactions.map((transaction) => <article className="operation-row" key={transaction.transactionId}><div className="operation-main"><span className="section-label">{transaction.transactionId}</span><h3>{transaction.revenueState === "VERIFIED_REVENUE" ? "Verified revenue" : "Checkout record"}</h3><p>{transaction.classification.negotiated ? "Negotiated" : "Standard"}{transaction.classification.hitl ? " · HITL" : ""}{transaction.classification.growthPlay ? " · Growth play" : ""}</p></div><div className="operation-value"><span>{transaction.payment.verified ? "Provider verified" : transaction.payment.status}</span><strong>{money(transaction.amountPaise)}</strong><small>{transaction.provider} · {transaction.status}</small></div><Badge tone={transaction.payment.verified ? "success" : "neutral"}>{transaction.payment.verified ? "REALIZED" : "NOT REVENUE"}</Badge></article>)}</div>;
}

function AuditList({ audit }: { audit: Audit[] }) {
  if (!audit.length) return <div className="operations-empty"><span className="compile-empty-mark">⌁</span><h3>No audit events yet.</h3><p>Decision explanations will appear here once the runtime processes a commerce or merchant operation.</p></div>;
  return <div className="operations-list">{audit.map((event) => <article className="operation-row audit-row" key={event.id}><time>{new Date(event.createdAt).toLocaleString()}</time><div className="operation-main"><span className="section-label">{event.actorType} · {event.entityType}</span><h3>{event.eventType}</h3><p>{event.explanation}</p></div><code>{event.entityId}</code></article>)}</div>;
}
