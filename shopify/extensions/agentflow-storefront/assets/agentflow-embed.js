(function () {
  var root = document.getElementById("agentflow-storefront-assistant");
  if (!root || root.dataset.agentflowReady === "true") return;
  root.dataset.agentflowReady = "true";

  var proxyPath = root.dataset.agentflowProxyPath || "/apps/agentflow/chat";
  var sessionKey = "agentflow.shopify.session";
  var sessionId = null;
  var productsById = {};
  try { sessionId = window.sessionStorage.getItem(sessionKey); } catch { /* storage may be unavailable */ }

  root.innerHTML = [
    '<button class="agentflow-launcher" type="button" aria-expanded="false" aria-controls="agentflow-panel"><span class="agentflow-launcher-mark">✦</span><span>Shop with AgentFlow</span></button>',
    '<section class="agentflow-panel" id="agentflow-panel" hidden aria-label="AgentFlow shopping assistant"><header class="agentflow-panel-header"><div><strong>Haven Home</strong><span>Your personal product guide</span></div><button class="agentflow-close" type="button" aria-label="Close assistant">×</button></header><div class="agentflow-messages" aria-live="polite"><div class="agentflow-message agentflow-message-assistant">Tell me what you are looking for and I’ll find the right pieces.</div></div><div class="agentflow-connection" hidden>Connected to Haven Home</div><form class="agentflow-form"><label class="agentflow-sr-only" for="agentflow-input">Message</label><input id="agentflow-input" maxlength="2000" placeholder="Ask for a product, size, or finish…" autocomplete="off"/><button type="submit" aria-label="Send message">↑</button></form></section>'
  ].join("");

  var launcher = root.querySelector(".agentflow-launcher");
  var panel = root.querySelector(".agentflow-panel");
  var close = root.querySelector(".agentflow-close");
  var form = root.querySelector(".agentflow-form");
  var input = root.querySelector("#agentflow-input");
  var messages = root.querySelector(".agentflow-messages");
  var connection = root.querySelector(".agentflow-connection");

  function setOpen(open) { launcher.setAttribute("aria-expanded", String(open)); panel.hidden = !open; if (open) input.focus(); }
  function addMessage(text, kind) { var item = document.createElement("div"); item.className = "agentflow-message agentflow-message-" + kind; item.textContent = text; messages.appendChild(item); messages.scrollTop = messages.scrollHeight; }
  function pageContext() {
    var rawPageType = root.dataset.agentflowPageType || "other";
    var pageType = { index: "home", home: "home", collection: "collection", product: "product", search: "search", cart: "cart", other: "other" }[rawPageType] || "other";
    return { pageType: pageType, currentProductId: root.dataset.agentflowProductId || undefined, currentCollection: root.dataset.agentflowCollection || undefined, url: window.location.href };
  }
  function endpoint(name) { return proxyPath.replace(/\/chat$/, "/" + name); }
  function addAction(label, handler) { var action = document.createElement("button"); action.type = "button"; action.className = "agentflow-action"; action.textContent = label; action.addEventListener("click", handler); messages.appendChild(action); messages.scrollTop = messages.scrollHeight; return action; }
  function productTitle(product) { return product && (product.title || product.name) || "Product"; }
  function productPrice(product) { var value = product && (product.priceMinorUnits !== undefined ? product.priceMinorUnits : product.listPricePaise); if (typeof value !== "number") return ""; return "₹" + (value / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function productImage(product) { return product && (product.imageUrl || (Array.isArray(product.media) ? product.media[0] : undefined)); }
  function productUrl(product) { if (!product) return null; if (product.productUrl) return product.productUrl; if (product.handle) return "/products/" + encodeURIComponent(product.handle); return null; }

  function invokeAction(action) {
    return fetch(endpoint("ui-action"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, action: action }) }).then(function (response) { return response.json().then(function (payload) { if (!response.ok) throw new Error(payload.error || "That action could not be completed."); return payload; }); });
  }
  function renderProductCard(product) {
    var card = document.createElement("article"); card.className = "agentflow-product-card";
    var image = productImage(product); if (image) { var img = document.createElement("img"); img.src = image; img.alt = productTitle(product); img.loading = "lazy"; card.appendChild(img); } else { var placeholder = document.createElement("div"); placeholder.className = "agentflow-product-placeholder"; placeholder.textContent = "✦"; card.appendChild(placeholder); }
    var body = document.createElement("div"); body.className = "agentflow-product-copy"; var title = document.createElement("strong"); title.textContent = productTitle(product); body.appendChild(title); var price = document.createElement("span"); price.textContent = productPrice(product); body.appendChild(price); card.appendChild(body);
    var controls = document.createElement("div"); controls.className = "agentflow-product-actions";
    var view = document.createElement("button"); view.type = "button"; view.textContent = "View"; view.addEventListener("click", function () { var href = productUrl(product); if (href) window.location.href = href; }); controls.appendChild(view);
    var save = document.createElement("button"); save.type = "button"; save.textContent = "Save"; save.addEventListener("click", function () { save.disabled = true; invokeAction({ type: "ADD_TO_SHORTLIST", productId: product.id }).then(function () { save.textContent = "Saved"; }).catch(function () { save.disabled = false; }); }); controls.appendChild(save);
    var add = document.createElement("button"); add.type = "button"; add.textContent = "Add"; add.addEventListener("click", function () { add.disabled = true; invokeAction({ type: "ADD_TO_CART", productId: product.id }).then(function (payload) { add.textContent = payload.cart ? "Added" : "Unavailable"; }).catch(function (error) { add.disabled = false; addMessage(error.message || "That item could not be added.", "assistant"); }); }); controls.appendChild(add);
    card.appendChild(controls); return card;
  }
  function renderSurface(payload) {
    (payload.products || []).forEach(function (product) { if (product && product.id) productsById[product.id] = product; });
    var ui = payload.ui || {}; var productIds = ui.productIds || (payload.products || []).map(function (product) { return product.id; });
    if (["PRODUCT_GRID", "PRODUCT_SPOTLIGHT", "SHORTLIST", "COMPARISON"].indexOf(ui.type) >= 0) {
      var grid = document.createElement("div"); grid.className = "agentflow-product-grid"; productIds.forEach(function (id) { if (productsById[id]) grid.appendChild(renderProductCard(productsById[id])); }); messages.appendChild(grid);
      if (ui.type === "COMPARISON" && productIds.length > 1) addAction("Compare these options", function () { sendMessage("Compare these options"); });
    }
    if (payload.cart && payload.cart.lines) { var cartNote = document.createElement("div"); cartNote.className = "agentflow-cart-note"; cartNote.textContent = "Cart updated · " + payload.cart.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0) + " item(s)"; messages.appendChild(cartNote); }
    if (Array.isArray(payload.growthActions) && payload.growthActions.length) { payload.growthActions.slice(0, 2).forEach(function (growth) { var product = growth.product; if (product && product.id) productsById[product.id] = product; var label = growth.type === "BUNDLE" ? "Available as a bundle" : "A considered add-on for your order"; addAction(label, function () { sendMessage("Tell me about the bundle option"); }); }); }
    if (payload.offer && payload.offer.offerId) addAction(payload.offer.outcome === "ALLOW" ? "Review private offer" : "See offer status", function () { sendMessage("Show me the offer"); });
    messages.scrollTop = messages.scrollHeight;
  }
  async function sendMessage(text) {
    if (!text) return;
    addMessage(text, "customer"); input.value = ""; var submit = form.querySelector("button"); submit.disabled = true; connection.textContent = "Connected · finding a fit…"; connection.hidden = root.dataset.agentflowDevStatus !== "true";
    try {
      var response = await fetch(proxyPath, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, message: text, storefrontContext: pageContext() }) });
      var payload = await response.json(); if (!response.ok) throw new Error(payload.error || "The shopping assistant is unavailable.");
      sessionId = payload.sessionId || sessionId; if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* storage may be unavailable */ }
      connection.textContent = "Connected to Haven Home"; addMessage(payload.message || "I found a few ways to help.", "assistant"); renderSurface(payload);
    } catch (error) { connection.textContent = "Temporarily unavailable"; addMessage(error && error.message ? error.message : "The shopping assistant is unavailable.", "assistant"); }
    finally { submit.disabled = false; input.focus(); }
  }
  launcher.addEventListener("click", function () { setOpen(panel.hidden); }); close.addEventListener("click", function () { setOpen(false); }); if (root.dataset.agentflowDevStatus === "true") connection.hidden = false;
  form.addEventListener("submit", function (event) { event.preventDefault(); sendMessage(input.value.trim()); });
})();
