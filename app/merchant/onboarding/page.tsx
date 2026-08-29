"use client";

import { useMemo, useState } from "react";
import { Badge, MerchantShell, PageIntro } from "../merchant-ui";
import { onboardingFromProposal, type CompiledOnboarding, type PolicyBlock } from "../../../lib/onboarding";
import type { PolicyGraph } from "../../../lib/policy/graph-projection";

const starterPrompt = "Standard customers can receive up to 10%. Repeat customers can receive up to 15%. VIP customers may receive 20%. Never go below 25% gross margin. Do not discount products below 10 units in stock. Orders above ₹50,000 require merchant approval. Use the connected storefront and payment rail only after policy approval.";

export default function OnboardingPage() {
  const [prompt, setPrompt] = useState(starterPrompt);
  const [compiled, setCompiled] = useState<CompiledOnboarding | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [published, setPublished] = useState(false);

  const unresolved = useMemo(() => compiled?.discrepancies.filter((item) => !item.resolution) ?? [], [compiled]);

  const compile = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, catalogueSummary: "Haven Home development catalogue: product price, cost, inventory, category, and SKU are available. Four products are fully negotiable; low-stock products need review." }) });
      const result = await response.json() as CompiledOnboarding & { message?: string };
      if (!response.ok) throw new Error(result.message || "Compiler request failed");
      setCompiled(result);
      setPublished(false);
      setMessage(result.message || "Policy blocks generated. Review the highlighted discrepancy before publishing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to compile this prompt.");
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!compiled?.draftId) return;
    const response = await fetch(`/api/policy/drafts/${compiled.draftId}/publish`, { method: "POST" });
    const result = await response.json() as { error?: string };
    setPublished(response.ok);
    setMessage(response.ok ? "Policy published. The customer surface now uses this immutable version." : result.error || "The draft is not ready to publish.");
  };

  const resolve = async (id: string) => {
    if (!compiled?.draftId) return;
    const discrepancy = compiled.discrepancies.find((item) => item.id === id);
    if (!discrepancy) return;
    const choice = discrepancy.possibleResolutions[0];
    const response = await fetch(`/api/policy/drafts/${compiled.draftId}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discrepancyId: id, resolution: choice?.value ?? choice?.id ?? "keep-restrictive" }) });
    const result = await response.json() as { policy?: CompiledOnboarding["policy"]; discrepancies?: CompiledOnboarding["discrepancies"]; graph?: PolicyGraph; validation?: { valid: boolean } };
    if (!response.ok || !result.policy || !result.graph) return;
    setCompiled((current) => current ? onboardingFromProposal({ ...current, policy: result.policy!, graph: result.graph!, valid: result.validation?.valid ?? false }, current.draftId) : current);
  };

  return <MerchantShell active="onboarding" title="Setup Copilot" description="Turn merchant intent into inspectable policy blocks before a shopper ever sees them."><PageIntro eyebrow="Guided setup" title="Teach the system how your business works." text="Describe your rules, review the real structured proposal, resolve contradictions, and publish only when the backend validates the draft." action={<Badge tone="success">Human review required</Badge>} /><div className="onboarding-stepper"><div className="stepper-item active"><b>01</b><span>Describe intent</span></div><div className={compiled ? "stepper-item active" : "stepper-item"}><b>02</b><span>Review blocks</span></div><div className={compiled && unresolved.length === 0 ? "stepper-item active" : "stepper-item"}><b>03</b><span>Publish workflow</span></div></div><div className="onboarding-layout-new"><section className="workspace-card prompt-builder"><div className="card-heading"><div><span className="section-label">Merchant intent</span><h3>What should the agent be allowed to do?</h3></div><span className="prompt-lock">Server draft</span></div><p className="card-lede">Describe discount rules, margin floors, inventory boundaries, approval thresholds, and the connected systems the workflow may call.</p><textarea aria-label="Merchant policy prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><div className="prompt-footer"><span>{prompt.length.toLocaleString("en-IN")} characters · persisted as a merchant draft</span><button className="button button-dark" type="button" onClick={compile} disabled={loading}>{loading ? "Compiling…" : "Compile policy blocks"} <span>✦</span></button></div><div className="prompt-guidance"><span>✦</span><div><strong>Connected Setup Copilot</strong><p>Nemotron proposes a typed Policy IR. The server validates it, stores the draft, and keeps publishing in your hands.</p></div></div></section><section className="workspace-card compile-result">{compiled ? <CompiledResult compiled={compiled} unresolved={unresolved.length} onResolve={resolve} /> : <div className="compile-empty"><span className="compile-empty-mark">✦</span><span className="section-label">No draft yet</span><h3>Your policy graph will appear here.</h3><p>Compile a merchant prompt to create a persisted draft from the connected Setup Copilot.</p><div className="empty-flow"><span>Intent</span><i /><span>Blocks</span><i /><b>Review</b></div></div>}</section></div>{message ? <div className={`onboarding-message ${compiled && unresolved.length === 0 ? "message-success" : "message-note"}`}><i />{message}</div> : null}{compiled && unresolved.length === 0 ? <section className="publish-rail"><div><span className="section-label">{published ? "Published customer policy" : "Ready to publish"}</span><h3>Workflow v{compiled.policy.version} is internally consistent.</h3><p>{published ? "This version is immutable and is now active for the server evaluator." : "Publish the reviewed draft explicitly; the Shopify shopper surface will then use it."}</p></div><div className="workflow-actions"><button className="button button-dark" type="button" onClick={publish} disabled={published}>{published ? "Published ✓" : "Publish workflow"}</button><a className="button button-light" href="/merchant/storefront">Open Storefront <span>↗</span></a></div></section> : null}</MerchantShell>;
}

function CompiledResult({ compiled, unresolved, onResolve }: { compiled: CompiledOnboarding; unresolved: number; onResolve: (id: string) => void }) {
  return <div className="compiled-result-inner"><div className="compiled-heading"><div><span className="section-label">Compiled policy · v{compiled.policy.version}</span><h3>{compiled.workflowName}</h3></div><Badge tone="success">NIM · {compiled.model}</Badge></div><p className="compiled-summary">{compiled.summary}</p>{compiled.clarificationQuestions.length ? <div className="clarification-list"><div className="discrepancy-list-heading"><span>Clarification questions</span><strong>{compiled.clarificationQuestions.length} to confirm</strong></div>{compiled.clarificationQuestions.map((question) => <div className="clarification-question" key={question}><span>?</span><p>{question}</p></div>)}</div> : null}{compiled.discrepancies.length ? <div className="discrepancy-list"><div className="discrepancy-list-heading"><span>Logic review</span><strong>{unresolved ? `${unresolved} unresolved` : "All resolved"}</strong></div>{compiled.discrepancies.map((item) => <article className={`discrepancy-card ${item.resolution ? "resolved" : ""}`} key={item.id}><div className="discrepancy-top"><span className={`severity severity-${item.severity}`}>{item.severity}</span><strong>{item.title}</strong><button type="button" onClick={() => onResolve(item.id)} disabled={Boolean(item.resolution)}>{item.resolution ? "Resolved in draft" : "Apply recommended resolution"}</button></div><p>{item.detail}</p><small>Recommendation · {item.recommendation}</small></article>)}</div> : <div className="no-discrepancies"><span>✓</span><div><strong>No discrepancies found.</strong><p>The compiler found a coherent set of authority, safety, and connector rules.</p></div></div>}<div className="block-canvas-heading"><span className="section-label">Generated blocks</span><span>{compiled.blocks.length} blocks · {compiled.assumptions.length} assumptions</span></div><div className="block-canvas">{compiled.blocks.map((block) => <BlockCard block={block} key={block.id} />)}</div><div className="assumptions-list"><span className="section-label">Compiler assumptions</span>{compiled.assumptions.map((assumption) => <div key={assumption}><i />{assumption}</div>)}</div></div>;
}

function BlockCard({ block }: { block: PolicyBlock }) {
  return <article className={`policy-block block-${block.type} ${block.status === "needs-review" ? "block-review" : ""}`}><div className="policy-block-top"><span className="block-icon">{block.type === "context" ? "◌" : block.type === "constraint" ? "⌁" : block.type === "approval" ? "!" : block.type === "connector" ? "↗" : "✓"}</span><span>{block.type}</span></div><strong>{block.title}</strong><p>{block.detail}</p><small>{block.source}</small></article>;
}
