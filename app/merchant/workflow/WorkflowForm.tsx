"use client";

import { useState } from "react";
import { demoPolicy, type CommercePolicy } from "../../../lib/policy";

export const previewHref = (policy: CommercePolicy) => {
  const params = new URLSearchParams({
    standard: String(policy.standardMaxDiscount),
    repeat: String(policy.repeatMaxDiscount),
    margin: String(policy.minimumMargin),
    lowStock: String(policy.lowStockThreshold),
    threshold: String(policy.approvalThreshold),
  });
  return `/customer?${params.toString()}`;
};

const fields: Array<{ key: keyof Pick<CommercePolicy, "standardMaxDiscount" | "repeatMaxDiscount" | "minimumMargin" | "lowStockThreshold" | "approvalThreshold">; label: string; detail: string; suffix: string }> = [
  { key: "standardMaxDiscount", label: "Standard customer discount", detail: "Autonomous range for a new customer", suffix: "%" },
  { key: "repeatMaxDiscount", label: "Repeat customer discount", detail: "Autonomous range for a returning customer", suffix: "%" },
  { key: "minimumMargin", label: "Minimum gross margin", detail: "Hard floor before an offer can proceed", suffix: "%" },
  { key: "lowStockThreshold", label: "Low-stock threshold", detail: "Disable discounting below this quantity", suffix: "units" },
  { key: "approvalThreshold", label: "Approval threshold", detail: "Send larger orders to your team", suffix: "₹" },
];

export default function WorkflowForm() {
  const [policy, setPolicy] = useState<CommercePolicy>(demoPolicy);
  const [workflowName, setWorkflowName] = useState("Haven Home · Everyday commerce");
  const [saved, setSaved] = useState(false);

  const update = (key: keyof CommercePolicy, value: string) => {
    const number = Number(value);
    setPolicy((current) => ({ ...current, [key]: Number.isFinite(number) ? number : 0 }));
    setSaved(false);
  };

  const save = () => setSaved(true);

  return <div className="workflow-studio"><section className="workspace-card workflow-builder"><div className="card-heading"><div><span className="section-label">Editable workflow</span><h3>Set your own commercial boundaries.</h3><p className="card-lede">These values drive the customer preview. You can change them, save a draft, and try the experience from the other side.</p></div><BadgeLabel>Draft v19</BadgeLabel></div><label className="field-label">Workflow name<input className="text-input" value={workflowName} onChange={(event) => { setWorkflowName(event.target.value); setSaved(false); }} /></label><div className="policy-fields">{fields.map((field) => <label className="policy-field" key={field.key}><span><strong>{field.label}</strong><small>{field.detail}</small></span><div className="policy-input"><input aria-label={field.label} type="number" min="0" value={policy[field.key]} onChange={(event) => update(field.key, event.target.value)} /><b>{field.suffix}</b></div></label>)}</div><div className="workflow-actions"><button className="button button-dark" type="button" onClick={save}>{saved ? "Draft saved" : "Save workflow"} <span>✓</span></button><a className="button button-light" href={previewHref(policy)}>Preview as customer <span>↗</span></a></div>{saved ? <p className="save-note"><i />{workflowName} is ready for a customer preview.</p> : null}</section><aside className="workflow-preview"><div className="preview-head"><span className="section-label">Live policy summary</span><span className="live-pill">READY</span></div><h3>{workflowName}</h3><p>AI can suggest within these boundaries. The runtime checks the final request before any connector action.</p><div className="preview-rule-list"><div><span>New customer</span><strong>Up to {policy.standardMaxDiscount}%</strong></div><div><span>Repeat customer</span><strong>Up to {policy.repeatMaxDiscount}%</strong></div><div><span>Margin floor</span><strong>{policy.minimumMargin}% minimum</strong></div><div><span>Approval boundary</span><strong>Above ₹{policy.approvalThreshold.toLocaleString("en-IN")}</strong></div></div><div className="preview-flow"><span>Request</span><i /><span>Policy</span><i /><b>Safe outcome</b></div></aside></div>;
}

function BadgeLabel({ children }: { children: string }) {
  return <span className="badge badge-warning"><i />{children}</span>;
}
