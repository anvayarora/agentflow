"use client";

import { useMemo, useState } from "react";
import { Badge, MerchantShell, PageIntro } from "../merchant-ui";
import { previewHref } from "../workflow/WorkflowForm";
import { type CompiledOnboarding, type PolicyBlock } from "../../../lib/onboarding";

const starterPrompt = "Standard customers can receive up to 10%. Repeat customers can receive up to 15%. VIP customers may receive 20%. Never go below 25% gross margin. Do not discount products below 10 units in stock. Orders above ₹50,000 require merchant approval. Use the connected storefront and payment rail only after policy approval.";

export default function OnboardingPage() {
  const [prompt, setPrompt] = useState(starterPrompt);
  const [compiled, setCompiled] = useState<CompiledOnboarding | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const unresolved = useMemo(() => compiled?.discrepancies.filter((item) => !resolved.includes(item.id)) ?? [], [compiled, resolved]);

  const compile = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, catalogueSummary: "Haven Home development catalogue: product price, cost, inventory, category, and SKU are available. Four products are fully negotiable; low-stock products need review." }) });
      const result = await response.json() as CompiledOnboarding & { message?: string };
      if (!response.ok) throw new Error(result.message || "Compiler request failed");
      setCompiled(result);
      setResolved([]);
      setMessage(result.message || "Policy blocks generated. Review the highlighted discrepancy before publishing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to compile this prompt.");
    } finally {
      setLoading(false);
    }
  };

  const resolve = (id: string) => setResolved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <MerchantShell active="onboarding" title="Onboarding" description="Turn merchant intent into inspectable policy blocks before a customer ever sees them."><PageIntro eyebrow="Guided setup" title="Teach the system how your business works." text="Write the rules in plain language. The compiler proposes blocks, calls out contradictions, and keeps publishing in your hands." action={<Badge tone="success">Human review required</Badge>} /><div className="onboarding-stepper"><div className="stepper-item active"><b>01</b><span>Describe intent</span></div><div className={compiled ? "stepper-item active" : "stepper-item"}><b>02</b><span>Review blocks</span></div><div className={compiled && unresolved.length === 0 ? "stepper-item active" : "stepper-item"}><b>03</b><span>Publish workflow</span></div></div><div className="onboarding-layout-new"><section className="workspace-card prompt-builder"><div className="card-heading"><div><span className="section-label">Merchant intent</span><h3>What should the agent be allowed to do?</h3></div><span className="prompt-lock">Private draft</span></div><p className="card-lede">Describe discount rules, margin floors, inventory boundaries, approval thresholds, and the connected systems the workflow may call.</p><textarea aria-label="Merchant policy prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="prompt-footer"><span>{prompt.length.toLocaleString("en-IN")} characters · saved in this preview only</span><button className="button button-dark" type="button" onClick={compile} disabled={loading}>{loading ? "Compiling…" : "Compile policy blocks"} <span>✦</span></button></div><div className="prompt-guidance"><span>✦</span><div><strong>Compiler behavior</strong><p>It can suggest structure, but it cannot publish, change a connector, or authorize a customer action.</p></div></div></section><section className="workspace-card compile-result">{compiled ? <CompiledResult compiled={compiled} unresolved={unresolved.length} resolved={resolved} onResolve={resolve} /> : <div className="compile-empty"><span className="compile-empty-mark">✦</span><span className="section-label">No draft yet</span><h3>Your policy graph will appear here.</h3><p>Compile the starter prompt or replace it with your own operating rules. We’ll show the blocks, assumptions, and discrepancies side by side.</p><div className="empty-flow"><span>Intent</span><i /><span>Blocks</span><i /><b>Review</b></div></div>}</section></div>{message ? <div className={`onboarding-message ${compiled && unresolved.length === 0 ? "message-success" : "message-note"}`}><i />{message}</div> : null}{compiled && unresolved.length === 0 ? <section className="publish-rail"><div><span className="section-label">Ready for the customer preview</span><h3>Workflow v{compiled.policy.version} is internally consistent.</h3><p>Publish the reviewed draft, then test it from the separate customer surface.</p></div><a className="button button-dark" href={previewHref(compiled.policy)}>Preview customer journey <span>↗</span></a></section> : null}</MerchantShell>;
}

function CompiledResult({ compiled, unresolved, resolved, onResolve }: { compiled: CompiledOnboarding; unresolved: number; resolved: string[]; onResolve: (id: string) => void }) {
  return <div className="compiled-result-inner"><div className="compiled-heading"><div><span className="section-label">Compiled policy · v{compiled.policy.version}</span><h3>{compiled.workflowName}</h3></div><Badge tone={compiled.source === "nim" ? "success" : "neutral"}>{compiled.source === "nim" ? `NIM · ${compiled.model}` : "Deterministic fallback"}</Badge></div><p className="compiled-summary">{compiled.summary}</p>{compiled.discrepancies.length ? <div className="discrepancy-list"><div className="discrepancy-list-heading"><span>Logic review</span><strong>{unresolved ? `${unresolved} unresolved` : "All resolved"}</strong></div>{compiled.discrepancies.map((item) => <article className={`discrepancy-card ${resolved.includes(item.id) ? "resolved" : ""}`} key={item.id}><div className="discrepancy-top"><span className={`severity severity-${item.severity}`}>{item.severity}</span><strong>{item.title}</strong><button type="button" onClick={() => onResolve(item.id)}>{resolved.includes(item.id) ? "Reopen" : "Mark resolved"}</button></div><p>{item.detail}</p><small>Recommendation · {item.recommendation}</small></article>)}</div> : <div className="no-discrepancies"><span>✓</span><div><strong>No discrepancies found.</strong><p>The compiler found a coherent set of authority, safety, and connector rules.</p></div></div>}<div className="block-canvas-heading"><span className="section-label">Generated blocks</span><span>{compiled.blocks.length} blocks · {compiled.assumptions.length} assumptions</span></div><div className="block-canvas">{compiled.blocks.map((block) => <BlockCard block={block} key={block.id} />)}</div><div className="assumptions-list"><span className="section-label">Compiler assumptions</span>{compiled.assumptions.map((assumption) => <div key={assumption}><i />{assumption}</div>)}</div></div>;
}

function BlockCard({ block }: { block: PolicyBlock }) {
  return <article className={`policy-block block-${block.type} ${block.status === "needs-review" ? "block-review" : ""}`}><div className="policy-block-top"><span className="block-icon">{block.type === "context" ? "◌" : block.type === "constraint" ? "⌁" : block.type === "approval" ? "!" : block.type === "connector" ? "↗" : "✓"}</span><span>{block.type}</span></div><strong>{block.title}</strong><p>{block.detail}</p><small>{block.source}</small></article>;
}
