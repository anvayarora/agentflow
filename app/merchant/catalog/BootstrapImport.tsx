"use client";

import { useState } from "react";

type Preview = { importRunId: string; sourceType: string; rows: Array<{ sku: string; productName: string; costPaise: number | null }>; mappings: Record<string, string>; summary: Record<string, number>; warnings: string[]; errors: string[] };

function money(value: number | null) { return value === null ? "Missing" : `₹${(value / 100).toLocaleString("en-IN")}`; }

export default function BootstrapImport() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function previewFile(file: File) {
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/merchant/catalog/bootstrap", { method: "POST", body: form });
      const payload = await response.json() as Preview & { error?: string };
      if (!response.ok && !payload.importRunId) throw new Error(payload.error || "The file could not be previewed.");
      setPreview(payload); setMessage(payload.errors?.length ? "Resolve the highlighted rows before importing." : "Preview ready. Confirm when the mapping looks right.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The file could not be previewed."); }
    finally { setBusy(false); }
  }
  async function confirmImport() {
    if (!preview) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/merchant/catalog/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importRunId: preview.importRunId, confirm: true }) });
      const payload = await response.json() as { status?: string; error?: string }; if (!response.ok && response.status !== 207) throw new Error(payload.error || "Import could not be completed.");
      setMessage(payload.status === "COMPLETED" ? "Catalogue imported and mapped." : "Import finished with row-level warnings. Review the run before retrying.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import could not be completed."); }
    finally { setBusy(false); }
  }
  return <section className="workspace-card" style={{ marginTop: 24 }}><div className="card-heading"><div><span className="section-label">Store bootstrap</span><h3>Bring a catalogue into the connected store.</h3></div><span className="prompt-lock">Merchant review required</span></div><p className="card-lede">Upload a CSV or XLSX. AgentFlow detects the columns, keeps private economics server-side, and shows a preview before any Shopify write.</p><label className="button button-light" htmlFor="catalogue-upload">{busy ? "Working…" : "Choose CSV or XLSX"}</label><input id="catalogue-upload" type="file" accept=".csv,.xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewFile(file); }} />{message ? <p className="onboarding-message message-note">{message}</p> : null}{preview ? <div style={{ marginTop: 16 }}><div className="table-toolbar"><div><span className="section-label">{preview.sourceType} preview</span><h3>{preview.summary.productsFound} products found</h3></div><button className="button button-dark" type="button" onClick={() => void confirmImport()} disabled={busy || preview.errors.length > 0}>Import to Shopify <span>↗</span></button></div><div className="product-table"><div className="product-table-head"><span>SKU</span><span>Destination</span><span>Public price</span><span>Private cost</span><span>State</span></div>{preview.rows.slice(0, 8).map((row) => <div className="product-table-row" key={row.sku}><strong>{row.sku}</strong><span>{row.productName}</span><span>Mapped by SKU</span><span>{money(row.costPaise)}</span><span>{preview.errors.length ? "Review" : "Ready"}</span></div>)}</div>{preview.rows.length > 8 ? <small>Showing the first 8 rows. The full run remains available to the merchant.</small> : null}<p className="runtime-footnote">Columns are suggestions until you confirm. Shopify receives public catalogue fields only; cost and supplier data stay in AgentFlow.</p></div> : null}</section>;
}
