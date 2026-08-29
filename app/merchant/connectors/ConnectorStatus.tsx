"use client";

import { useEffect, useState } from "react";
import { Badge } from "../merchant-ui";

type ConnectorStatusResponse = {
  connectors: {
    nim: { configured: boolean; model: string; mode: string };
    sarvam: { configured: boolean; sttModel: string; ttsModel: string; mode: string };
    shopify: { configured: boolean; storeDomain: string; mode: string };
    payments: { configured: boolean; mode: string };
  };
};

export default function ConnectorStatus() {
  const [status, setStatus] = useState<ConnectorStatusResponse | null>(null);

  useEffect(() => {
    fetch("/api/connectors/status").then((response) => response.json() as Promise<ConnectorStatusResponse>).then(setStatus).catch(() => setStatus(null));
  }, []);

  const entries = [
    { name: "NVIDIA NIM", detail: status?.connectors.nim.model || "Policy-aware compiler", configured: status?.connectors.nim.configured, mode: status?.connectors.nim.mode || "Checking" },
    { name: "Sarvam voice", detail: status?.connectors.sarvam.ttsModel || "Saaras + Bulbul", configured: status?.connectors.sarvam.configured, mode: status?.connectors.sarvam.mode || "Checking" },
    { name: "Shopify", detail: status?.connectors.shopify.storeDomain || "Haven Home Preview", configured: status?.connectors.shopify.configured, mode: status?.connectors.shopify.mode || "Checking" },
    { name: "Payment rail", detail: "Mock test adapter", configured: false, mode: status?.connectors.payments.mode || "Mock test adapter" },
  ];

  return <section className="connector-runtime-panel"><div className="connector-runtime-heading"><div><span className="section-label">Runtime status</span><h3>What is live behind this preview.</h3></div><span className="runtime-pulse"><i />Server checked</span></div><div className="connector-runtime-grid">{entries.map((entry) => <div className="runtime-row" key={entry.name}><span className={entry.configured ? "runtime-icon runtime-live" : "runtime-icon"}>{entry.configured ? "✓" : "·"}</span><div><strong>{entry.name}</strong><small>{entry.detail}</small></div><Badge tone={entry.configured ? "success" : "neutral"}>{entry.mode}</Badge></div>)}</div><p className="runtime-footnote">Secret values stay server-side. The browser receives status only, never credentials.</p></section>;
}
