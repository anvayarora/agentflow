"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { shopifyPreviewStore } from "../../lib/connectors";
import { money, products as demoProducts } from "../../lib/catalogue";
import type { CommerceEvaluation } from "../../lib/policy/evaluator";
import type { CommercePolicy, Product } from "../../lib/policy";
import VoiceSalesperson from "./VoiceSalesperson";

type ChatMessage = { role: "assistant" | "user"; text: string };
type PublicProduct = { id: string; sku: string; name: string; description: string; category: string; brand: string | null; currency: string; listPricePaise: number; stock: number; attributes: Record<string, unknown>; tags: string[] };

const toDisplayProduct = (product: PublicProduct): Product => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  category: product.category,
  price: product.listPricePaise / 100,
  cost: null,
  stock: product.stock,
  finish: typeof product.attributes.finish === "string" ? product.attributes.finish : "Connected product",
  material: typeof product.attributes.material === "string" ? product.attributes.material : "Commerce catalogue",
  width: typeof product.attributes.width === "number" ? product.attributes.width : 100,
  description: product.description,
  art: typeof product.attributes.art === "string" ? product.attributes.art : "walnut",
  tag: product.tags[0] || product.brand || "Catalogue",
});

const initialMessages: ChatMessage[] = [
  { role: "assistant", text: "Hi, I’m Haven. Tell me what you’re trying to make work and I’ll narrow the catalogue down with you." },
  { role: "user", text: "I need a warm wooden desk for a small room." },
  { role: "assistant", text: "The Walnut Compact Desk is the strongest fit: 110cm wide, warm finish, and enough room for a monitor plus a notebook." },
];

export default function CustomerPage() {
  const [policy, setPolicy] = useState<CommercePolicy | null>(null);
  const [catalogue, setCatalogue] = useState<Product[]>(demoProducts);
  const [catalogueSource, setCatalogueSource] = useState<"demo" | "shopify">("demo");
  const [selected, setSelected] = useState<Product>(demoProducts[0]);
  const [discount, setDiscount] = useState(7);
  const [quantity, setQuantity] = useState(1);
  const [segment, setSegment] = useState<"new" | "repeat">("repeat");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [decision, setDecision] = useState<CommerceEvaluation | null>(null);
  const [basket, setBasket] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/catalogue/products").then((response) => response.json() as Promise<{ products?: PublicProduct[]; source?: "demo" | "database" }>),
      fetch("/api/policy/current").then((response) => response.json() as Promise<{ policy?: { version: number }; policyView?: CommercePolicy }>),
      fetch("/api/commerce/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((response) => response.json() as Promise<{ sessionId?: string; customerSegment?: "new" | "repeat" }>),
    ])
      .then(([catalogueResult, policyResult, sessionResult]) => {
        if (!active) return;
        if (catalogueResult.products?.length) {
          const nextProducts = catalogueResult.products.map(toDisplayProduct);
          setCatalogue(nextProducts);
          setSelected(nextProducts[0]);
          setCatalogueSource(catalogueResult.source === "database" ? "shopify" : "demo");
        }
        if (policyResult.policyView) setPolicy(policyResult.policyView);
        if (sessionResult.sessionId) setSessionId(sessionResult.sessionId);
        if (sessionResult.customerSegment) setSegment(sessionResult.customerSegment);
      })
      .then((result) => {
        void result;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const testPrice = useMemo(() => selected.price * quantity * (1 - discount / 100), [discount, quantity, selected.price]);

  const evaluate = async () => {
    if (!sessionId) return;
    const response = await fetch("/api/commerce/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, productId: selected.id, quantity, requestedDiscountBps: Math.round(discount * 100) }) });
    const result = await response.json() as CommerceEvaluation;
    if (response.ok) setDecision(result);
  };

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setChatInput("");
    try {
      const response = await fetch("/api/commerce/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, message: text, storefrontContext: { pageType: "home", url: window.location.href } }) });
      const payload = await response.json() as { message?: string; error?: string };
      setMessages((current) => [...current, { role: "assistant", text: response.ok ? payload.message || "I can help you explore the catalogue." : payload.error || "The storefront assistant is unavailable." }]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", text: "The storefront assistant is unavailable right now." }]);
    }
  };

  return <main className="customer-page"><header className="customer-nav"><Link className="customer-brand" href="/"><span className="customer-brand-mark">H</span><span><strong>Haven Home</strong><small>Connected customer demo</small></span></Link><div className="customer-nav-links"><a href="#catalogue">Catalogue</a><a href="#conversation">Ask Haven</a><a href={shopifyPreviewStore.url} target="_blank" rel="noreferrer">Storefront ↗</a></div><div className="customer-nav-actions"><a className="merchant-link" href="/merchant">Merchant workspace ↗</a><button className="basket-button" type="button">Basket <span>{basket ? 1 : 0}</span></button></div></header>
    <section className="customer-hero"><div><span className="customer-kicker">Haven Home · Bengaluru</span><h1>Objects for a room that feels like <em>yours.</em></h1><p>Browse a considered catalogue, ask for a second opinion, and try a real offer without leaving the customer experience.</p><div className="customer-hero-actions"><a className="customer-button customer-button-dark" href="#catalogue">Explore the catalogue <span>↓</span></a><span className="customer-connection"><i />Connected to {shopifyPreviewStore.name}</span></div></div><div className="customer-hero-art"><div className="art-spotlight" /><div className="art-table" /><div className="art-lamp" /><div className="art-plant" /><span>01 / Haven Home Preview</span></div></section>
    <VoiceSalesperson initialSessionId={sessionId} />
    <section className="customer-content" id="catalogue"><div className="customer-section-heading"><div><span className="customer-section-label">Curated for the everyday</span><h2>Start with the piece that changes the room.</h2></div><span>{catalogue.length} products · {catalogueSource === "shopify" ? "live connected catalogue" : "preview catalogue"}</span></div><div className="customer-product-grid">{catalogue.slice(0, 4).map((product) => <button className={selected.id === product.id ? "customer-product selected" : "customer-product"} key={product.id} type="button" onClick={() => { setSelected(product); setDecision(null); setBasket(false); }}><div className={`customer-product-art ${product.art}`}><span>{product.tag}</span><b>↗</b></div><div className="customer-product-copy"><div><small>{product.category}</small><strong>{product.name}</strong></div><span>{money(product.price)}</span></div><p>{product.finish} · {product.width}cm wide</p></button>)}</div></section>
    <section className="customer-demo-section" id="conversation"><div className="conversation-panel"><div className="conversation-panel-header"><span className="haven-avatar">✦</span><div><strong>Ask Haven</strong><small>Customer guidance · connected preview</small></div><span className="conversation-online"><i />Online</span></div><div className="conversation-messages">{messages.map((message, index) => <div className={`conversation-message ${message.role}`} key={`${message.role}-${index}`}><span className="message-avatar">{message.role === "assistant" ? "✦" : "You"}</span><p>{message.text}</p></div>)}</div><div className="conversation-suggestions"><button type="button" onClick={() => setChatInput("Show me something under ₹12k")}>Under ₹12k</button><button type="button" onClick={() => setChatInput("What is the warmest finish?")}>Warmest finish</button><button type="button" onClick={() => setChatInput("Help me compare the desks")}>Compare desks</button></div><div className="conversation-input"><input aria-label="Ask Haven a question" value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") sendMessage(); }} placeholder="Ask about the room, size, or finish…" /><button type="button" onClick={sendMessage} aria-label="Send question">↗</button></div></div><div className="offer-panel"><div className="offer-panel-heading"><div><span className="customer-section-label">Test your own offer</span><h2>See how this workflow responds.</h2></div><span className="test-pill">Preview only</span></div><p>Change the quantity or requested offer. Customer identity and merchant authority are resolved by the server.</p><div className="offer-fields"><label>Product<select value={selected.id} onChange={(event) => { const product = catalogue.find((item) => item.id === event.target.value); if (product) { setSelected(product); setDecision(null); } }}>{catalogue.slice(0, 4).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Customer<select aria-label="Server-derived customer segment" disabled value={segment}><option value="new">New customer</option><option value="repeat">Repeat customer</option></select></label><label>Quantity<input type="number" min="1" max="10" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /></label><label>Requested discount<input type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label></div><div className="offer-summary"><span>Preview total</span><strong>{money(testPrice)}</strong><small>Workflow v{policy?.version ?? "—"} · {policy?.minimumMargin ?? "—"}% margin floor</small></div><button className="customer-button customer-button-dark customer-button-full" type="button" onClick={evaluate} disabled={!sessionId}>Evaluate this offer <span>↗</span></button>{decision ? <DecisionPanel decision={decision} onAdd={() => setBasket(true)} added={basket} /> : <div className="offer-empty"><span>✦</span><p>Evaluate an offer to see the server decision, matched rules, and next step.</p></div>}</div></section>
    <footer className="customer-footer"><span>Haven Home</span><span>Connected commerce preview</span><a href="/merchant">Merchant workspace ↗</a></footer>
  </main>;
}

function DecisionPanel({ decision, onAdd, added }: { decision: CommerceEvaluation; onAdd: () => void; added: boolean }) {
  const tone = decision.outcome === "ALLOW" ? "allow" : decision.outcome === "DENY" ? "deny" : "review";
  const title = decision.outcome === "ALLOW" ? "Offer accepted" : decision.outcome === "COUNTER" ? "Here’s the strongest offer" : decision.outcome === "ESCALATE" ? "A quick review is needed" : "That offer is outside the workflow";
  const offerPrice = decision.approvedPricePaise ?? decision.counterPricePaise;
  return <div className={`decision-panel decision-${tone}`}><div className="decision-panel-top"><div><span>Workflow decision</span><strong>{title}</strong></div><b>{decision.outcome}</b></div><p>{decision.evidence[decision.evidence.length - 1]}</p><div className="decision-rules-new">{decision.matchedRules.slice(0, 2).map((rule) => <span key={rule}>✓ {rule}</span>)}</div>{offerPrice !== undefined ? <div className="decision-price"><span>{decision.outcome === "ALLOW" ? "Approved price" : "Strongest safe price"}</span><strong>{money(offerPrice / 100)} <small>each</small></strong></div> : null}{decision.outcome !== "DENY" ? <button className="customer-button customer-button-light customer-button-full" type="button" onClick={onAdd}>{added ? "Added to basket ✓" : "Add to basket"}</button> : null}</div>;
}
