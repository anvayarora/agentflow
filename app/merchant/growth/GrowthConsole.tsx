"use client";

import { useState } from "react";
import { Badge } from "../merchant-ui";

type Opportunity = { id: string; type: string; primaryProductId: string; secondaryProductIds: string[]; proposedAction: Record<string, unknown>; estimatedImpact: Record<string, unknown>; evidence: Record<string, unknown>; riskFlags: string[]; policyCompatibility: string; scoreBps: number; status: string };
type Play = { id: string; opportunityId: string; maxIncentiveBps: number; minimumMarginBps: number; status: string; primaryProductId: string; secondaryProductIds: string[] };

const money = (value: unknown) => typeof value === "number" ? `₹${(value / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";

export default function GrowthConsole() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [history, setHistory] = useState("INSUFFICIENT_HISTORY");
  const [message, setMessage] = useState("Scan observed catalogue signals to get started.");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [opportunityResponse, playResponse] = await Promise.all([fetch("/api/merchant/growth/opportunities"), fetch("/api/merchant/growth/plays")]);
    const opportunityBody = await opportunityResponse.json() as { opportunities?: Opportunity[] };
    const playBody = await playResponse.json() as { plays?: Play[] };
    setOpportunities(opportunityBody.opportunities || []);
    setPlays(playBody.plays || []);
  };

  const scan = async () => {
    setLoading(true);
    const response = await fetch("/api/merchant/growth/scan", { method: "POST" });
    const body = await response.json() as { opportunities?: Opportunity[]; salesHistory?: string; error?: string };
    setHistory(body.salesHistory || history);
    setMessage(response.ok ? `${body.opportunities?.length || 0} evidence-backed opportunities are ready for review.` : body.error || "Growth scan failed.");
    await load();
    setLoading(false);
  };

  const createPlay = async (opportunityId: string) => {
    const response = await fetch("/api/merchant/growth/plays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId }) });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? "Growth play created as a draft. Simulate it before activation." : body.error || "Unable to create play.");
    await load();
  };

  const playAction = async (playId: string, action: "simulate" | "activate") => {
    const response = await fetch(`/api/merchant/growth/plays/${playId}/${action}`, { method: "POST" });
    const body = await response.json() as { result?: { outcome?: string }; error?: string };
    setMessage(response.ok ? `${action === "simulate" ? "Simulation" : "Activation"} completed${body.result?.outcome ? ` · ${body.result.outcome}` : ""}.` : body.error || "Growth play action failed.");
    await load();
  };

  return <div className="growth-console"><div className="growth-console-head"><div><span className="section-label">Observed signals</span><h3>Opportunity review</h3><p>{message}</p></div><button className="button button-dark" type="button" onClick={scan} disabled={loading}>{loading ? "Scanning…" : "Scan catalogue"} <span>✦</span></button></div><div className="growth-meta"><Badge tone={history === "OBSERVED" ? "success" : "warning"}>{history === "OBSERVED" ? "Sales history observed" : "Insufficient history"}</Badge><span>Private economics stay server-side · simulated impact is never realized revenue</span></div><div className="growth-grid">{opportunities.length ? opportunities.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} onCreate={() => createPlay(opportunity.id)} />) : <div className="workspace-card growth-empty"><span className="compile-empty-mark">✦</span><h3>No opportunities yet.</h3><p>Run a scan to evaluate current stock, margin headroom, and deterministic category complements.</p></div>}</div>{plays.length ? <section className="workspace-card growth-plays"><div className="card-heading"><div><span className="section-label">Actionable strategies</span><h3>Growth plays</h3></div><span className="section-label">Policy-gated</span></div><div className="growth-play-list">{plays.map((play) => <article className="growth-play-row" key={play.id}><div><strong>{play.primaryProductId}{play.secondaryProductIds.length ? ` + ${play.secondaryProductIds.join(", ")}` : ""}</strong><small>Max incentive {(play.maxIncentiveBps / 100).toFixed(2)}% · margin floor {(play.minimumMarginBps / 100).toFixed(2)}%</small></div><Badge tone={play.status === "ACTIVE" ? "success" : "neutral"}>{play.status}</Badge><div className="growth-play-actions"><button className="button button-light" type="button" onClick={() => playAction(play.id, "simulate")}>Simulate</button><button className="button button-dark" type="button" onClick={() => playAction(play.id, "activate")} disabled={play.status === "ACTIVE"}>Activate</button></div></article>)}</div></section> : null}</div>;
}

function OpportunityCard({ opportunity, onCreate }: { opportunity: Opportunity; onCreate: () => void }) {
  const action = String(opportunity.proposedAction.action || opportunity.type).replaceAll("_", " ");
  return <article className="workspace-card growth-card"><div className="growth-card-top"><Badge tone={opportunity.policyCompatibility === "COMPATIBLE" ? "success" : "warning"}>{opportunity.policyCompatibility}</Badge><span>{(opportunity.scoreBps / 100).toFixed(0)} score</span></div><span className="section-label">{opportunity.type.replaceAll("_", " ")}</span><h3>{opportunity.primaryProductId}{opportunity.secondaryProductIds.length ? ` + ${opportunity.secondaryProductIds[0]}` : ""}</h3><p className="growth-action">Proposed · {action}</p><dl><div><dt>Observed stock</dt><dd>{String(opportunity.evidence.stock ?? "—")} units</dd></div><div><dt>Margin floor</dt><dd>{typeof opportunity.evidence.marginFloorBps === "number" ? `${(opportunity.evidence.marginFloorBps / 100).toFixed(2)}%` : "Protected"}</dd></div><div><dt>Potential impact</dt><dd>{money(opportunity.estimatedImpact.potentialIncrementalAovPaise)} <small>SIMULATED</small></dd></div></dl><div className="growth-card-footer"><span>{opportunity.riskFlags.length ? opportunity.riskFlags.join(" · ") : "No risk flags"}</span><button className="button button-light" type="button" onClick={onCreate} disabled={opportunity.status === "DISMISSED"}>Review play <span>↗</span></button></div></article>;
}
