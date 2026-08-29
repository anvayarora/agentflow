"use client";

import { useEffect, useMemo, useState } from "react";
import { policyToLegacyView, type CommercePolicy } from "../../../lib/policy";
import type { PolicyVersionIR } from "../../../lib/policy/schema";

export const previewHref = () => "https://haven-home-k1gerlw9.myshopify.com";

const fields: Array<{ key: keyof Pick<CommercePolicy, "standardMaxDiscount" | "repeatMaxDiscount" | "minimumMargin" | "lowStockThreshold" | "approvalThreshold">; label: string; detail: string; suffix: string }> = [
  { key: "standardMaxDiscount", label: "Standard customer discount", detail: "Autonomous range for a new customer", suffix: "%" },
  { key: "repeatMaxDiscount", label: "Repeat customer discount", detail: "Autonomous range for a returning customer", suffix: "%" },
  { key: "minimumMargin", label: "Minimum gross margin", detail: "Hard floor before an offer can proceed", suffix: "%" },
  { key: "lowStockThreshold", label: "Low-stock threshold", detail: "Disable discounting below this quantity", suffix: "units" },
  { key: "approvalThreshold", label: "Approval threshold", detail: "Send larger orders to your team", suffix: "₹" },
];

function updatePolicyRule(policy: PolicyVersionIR, key: keyof CommercePolicy, value: number): PolicyVersionIR {
  const next = structuredClone(policy);
  const ruleMap: Record<string, string> = { standardMaxDiscount: "global-max-discount", repeatMaxDiscount: "repeat-customer-ceiling", minimumMargin: "minimum-margin-floor", lowStockThreshold: "low-stock-safety", approvalThreshold: "high-value-approval" };
  const rule = next.rules.find((item) => item.id === ruleMap[key]);
  if (!rule) return next;
  if (key === "standardMaxDiscount" && rule.effect.type === "SET_MAX_DISCOUNT_BPS") rule.effect.valueBps = Math.max(0, Math.min(10_000, Math.round(value * 100)));
  if (key === "repeatMaxDiscount" && rule.effect.type === "SET_MAX_DISCOUNT_BPS") rule.effect.valueBps = Math.max(0, Math.min(10_000, Math.round(value * 100)));
  if (key === "minimumMargin" && rule.effect.type === "SET_MIN_MARGIN_BPS") rule.effect.valueBps = Math.max(0, Math.min(10_000, Math.round(value * 100)));
  if (key === "lowStockThreshold") { const condition = rule.conditions.find((item) => item.field === "product.stock"); if (condition) condition.value = Math.max(0, Math.round(value)); }
  if (key === "approvalThreshold") { const condition = rule.conditions.find((item) => item.field === "cart.totalPaise"); if (condition) condition.value = Math.max(0, Math.round(value * 100)); }
  return next;
}

export default function WorkflowForm() {
  const [policy, setPolicy] = useState<PolicyVersionIR | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Haven Home · Everyday commerce");
  const [saved, setSaved] = useState(false);
  const view = useMemo(() => policy ? policyToLegacyView(policy) : null, [policy]);

  useEffect(() => {
    let active = true;
    fetch("/api/policy/current?surface=merchant").then((response) => response.json() as Promise<{ policy?: PolicyVersionIR }>).then((result) => { if (active && result.policy) setPolicy(result.policy); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const update = (key: keyof CommercePolicy, value: string) => {
    const number = Number(value);
    setPolicy((current) => current && updatePolicyRule(current, key, Number.isFinite(number) ? number : 0));
    setSaved(false);
  };

  const save = async () => {
    if (!policy) return;
    let next = policy;
    let id = draftId;
    if (!id) {
      const created = await fetch("/api/policy/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const result = await created.json() as { draft?: PolicyVersionIR };
      if (!created.ok || !result.draft) return;
      id = result.draft.id;
      next = { ...result.draft, rules: policy.rules };
      setDraftId(id);
    }
    const response = await fetch(`/api/policy/drafts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: next }) });
    if (response.ok) { setPolicy(next); setSaved(true); }
  };

  return <div className="workflow-studio"><section className="workspace-card workflow-builder"><div className="card-heading"><div><span className="section-label">Editable workflow</span><h3>Set your own commercial boundaries.</h3><p className="card-lede">These values create a persisted server draft. The customer surface can propose an offer, but only the published version can authorize it.</p></div><BadgeLabel>{draftId ? `Draft v${policy?.version ?? "—"}` : "Published baseline"}</BadgeLabel></div><label className="field-label">Workflow name<input className="text-input" value={workflowName} onChange={(event) => { setWorkflowName(event.target.value); setSaved(false); }} /></label><div className="policy-fields">{fields.map((field) => <label className="policy-field" key={field.key}><span><strong>{field.label}</strong><small>{field.detail}</small></span><div className="policy-input"><input aria-label={field.label} type="number" min="0" value={view?.[field.key] ?? ""} onChange={(event) => update(field.key, event.target.value)} disabled={!policy} /><b>{field.suffix}</b></div></label>)}</div><div className="workflow-actions"><button className="button button-dark" type="button" onClick={save} disabled={!policy}>{saved ? "Draft saved" : "Save workflow"} <span>✓</span></button><a className="button button-light" href={previewHref()}>Preview as customer <span>↗</span></a></div>{saved ? <p className="save-note"><i />{workflowName} is persisted as a server draft.</p> : null}</section><aside className="workflow-preview"><div className="preview-head"><span className="section-label">Live policy summary</span><span className="live-pill">{policy ? "READY" : "LOADING"}</span></div><h3>{workflowName}</h3><p>AI can suggest within these boundaries. The runtime checks the final request against the immutable published version.</p><div className="preview-rule-list"><div><span>New customer</span><strong>Up to {view?.standardMaxDiscount ?? "—"}%</strong></div><div><span>Repeat customer</span><strong>Up to {view?.repeatMaxDiscount ?? "—"}%</strong></div><div><span>Margin floor</span><strong>{view?.minimumMargin ?? "—"}% minimum</strong></div><div><span>Approval boundary</span><strong>Above ₹{view ? view.approvalThreshold.toLocaleString("en-IN") : "—"}</strong></div></div><div className="preview-flow"><span>Request</span><i /><span>Policy</span><i /><b>Safe outcome</b></div></aside></div>;
}

function BadgeLabel({ children }: { children: string }) {
  return <span className="badge badge-warning"><i />{children}</span>;
}
