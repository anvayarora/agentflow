(function () {
  var root = document.getElementById("agentflow-storefront-assistant");
  if (!root || root.dataset.agentflowReady === "true") return;
  root.dataset.agentflowReady = "true";

  var proxyPath = root.dataset.agentflowProxyPath || "/apps/agentflow/chat";
  var sessionKey = "agentflow.shopify.session";
  var sessionId = null;
  var productsById = {};
  var voiceProfiles = [];
  var voiceSession = null;
  var voiceMode = false;
  var currentMode = "voice";
  var voiceMuted = false;
  var recorder = null;
  var recorderStream = null;
  var recorderTimer = null;
  var speechRecognition = null;
  var voiceControlsLoaded = false;
  var notificationTimer = null;
  var manualDismissed = false;
  var lastFocusedElement = null;

  var PRESENTATION = Object.freeze({
    CLOSED: "CLOSED",
    LAUNCHER_ONLY: "LAUNCHER_ONLY",
    PANEL_OPEN: "PANEL_OPEN",
    PANEL_MINIMIZED: "PANEL_MINIMIZED",
    VOICE_ACTIVE: "VOICE_ACTIVE",
    COBROWSING: "COBROWSING",
    NOTIFICATION_ONLY: "NOTIFICATION_ONLY",
    ATTENTION_REQUIRED: "ATTENTION_REQUIRED",
    ERROR: "ERROR"
  });
  var presentationState = PRESENTATION.CLOSED;

  try { sessionId = window.sessionStorage.getItem(sessionKey); } catch { /* storage may be unavailable */ }

  root.innerHTML = [
    '<button class="agentflow-launcher" type="button" aria-expanded="false" aria-controls="agentflow-panel"><span class="agentflow-launcher-mark">✦</span><span>Shop with AgentFlow</span></button>',
    '<div class="agentflow-notification" role="status" aria-live="polite" hidden><span class="agentflow-notification-mark" aria-hidden="true">✦</span><span class="agentflow-notification-text"></span><button class="agentflow-notification-action" type="button" hidden>Open</button></div>',
    '<button class="agentflow-ambient-voice" type="button" aria-label="Return to AgentFlow voice" hidden><span class="agentflow-ambient-mark" aria-hidden="true">●</span><span class="agentflow-ambient-copy"><b>AgentFlow</b><small>Voice guide is listening</small></span><span class="agentflow-ambient-wave" aria-hidden="true"><i></i><i></i><i></i></span></button>',
    '<section class="agentflow-panel" id="agentflow-panel" hidden aria-hidden="true" aria-label="AgentFlow shopping assistant">',
      '<header class="agentflow-panel-header">',
        '<div class="agentflow-brand"><span class="agentflow-brand-mark" aria-hidden="true">✦</span><div class="agentflow-brand-copy"><strong>AgentFlow AI</strong><span>Haven Home shopping guide <b class="agentflow-online">Online</b></span></div></div>',
        '<div class="agentflow-header-actions"><button class="agentflow-header-action agentflow-minimize" type="button" aria-label="Minimize AgentFlow">−</button><button class="agentflow-header-action agentflow-close" type="button" aria-label="Close AgentFlow">×</button></div>',
      '</header>',
      '<div class="agentflow-panel-body">',
        '<section class="agentflow-guidance" aria-label="Salesperson and language">',
          '<div class="agentflow-guidance-heading"><h2>Choose your salesperson</h2><small>Personalised guidance</small></div>',
          '<div class="agentflow-guides" role="list" aria-label="AI salespeople"><div class="agentflow-guide-loading">Loading your guides…</div></div>',
          '<div class="agentflow-language-row"><span>Language</span><div class="agentflow-language-pills" role="group" aria-label="Choose language"><button class="agentflow-language-pill is-selected" type="button" data-language="en-IN" aria-pressed="true">English</button><button class="agentflow-language-pill" type="button" data-language="hi-IN" aria-pressed="false">हिन्दी</button><button class="agentflow-language-pill" type="button" data-language="hinglish" aria-pressed="false">Hinglish</button></div></div>',
          '<select id="agentflow-salesperson" class="agentflow-hidden-select" aria-hidden="true" tabindex="-1"></select><select id="agentflow-language" class="agentflow-hidden-select" aria-hidden="true" tabindex="-1"><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option><option value="hinglish">Hinglish</option></select>',
        '</section>',
        '<div class="agentflow-mode-switch" role="tablist" aria-label="Choose how to shop"><button class="agentflow-mode-button" type="button" role="tab" data-mode="chat" aria-selected="false">Chat</button><button class="agentflow-mode-button" type="button" role="tab" data-mode="voice" aria-selected="true">Voice</button></div>',
        '<section class="agentflow-voice-view" aria-label="Voice shopping">',
          '<div class="agentflow-voice-intro"><strong>Talk it through with your guide</strong><span>Describe the room, budget, or feeling you have in mind.</span></div>',
          '<div class="agentflow-voice-stage" data-state="idle" aria-live="polite"><div class="agentflow-voice-rings" aria-hidden="true"></div><span class="agentflow-voice-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div>',
          '<p class="agentflow-voice-state">Ready when you are</p><span class="agentflow-voice-detail">Maya is ready to help you find the right piece.</span>',
          '<button class="agentflow-voice-toggle" type="button" aria-pressed="false"><span class="agentflow-mic-dot">●</span><span>Start talking</span></button>',
          '<div class="agentflow-voice-controls"><button class="agentflow-voice-control agentflow-mute" type="button" aria-pressed="false"><span aria-hidden="true">♩</span><b>Mute</b></button><button class="agentflow-voice-control agentflow-type-instead" type="button"><span aria-hidden="true">⌨</span><b>Type instead</b></button><button class="agentflow-voice-control agentflow-settings" type="button"><span aria-hidden="true">☷</span><b>Settings</b></button></div>',
          '<span class="agentflow-voice-status" role="status">Voice-ready · choose a guide</span>',
          '<div class="agentflow-try-card"><strong>Try saying…</strong><div class="agentflow-try-prompts"><button class="agentflow-try-prompt" type="button" data-prompt="Mujhe work from home ke liye desk chahiye">“Mujhe work from home ke liye desk chahiye”</button><button class="agentflow-try-prompt" type="button" data-prompt="Show me cozy sofas under ₹50,000">“Show me cozy sofas under ₹50,000”</button><button class="agentflow-try-prompt" type="button" data-prompt="What goes well with this chair?">“What goes well with this chair?”</button><button class="agentflow-try-prompt" type="button" data-prompt="Need a dining set for 4">“Need a dining set for 4”</button></div></div>',
        '</section>',
        '<section class="agentflow-chat-view" aria-label="Chat shopping">',
          '<div class="agentflow-chat-intro"><strong>Let’s find your piece</strong><span>Ask about style, size, budget, or what pairs well.</span></div>',
          '<div class="agentflow-messages" aria-live="polite"><div class="agentflow-message agentflow-message-assistant">Tell me what you are looking for and I’ll guide you to the right pieces.</div></div>',
          '<div class="agentflow-suggestions" aria-label="Suggested questions"><button class="agentflow-suggestion" type="button" data-prompt="Show me sofas under ₹50,000">Sofas under ₹50,000</button><button class="agentflow-suggestion" type="button" data-prompt="I need a work-from-home desk">Work-from-home desk</button><button class="agentflow-suggestion" type="button" data-prompt="What goes with this chair?">What goes with this chair?</button><button class="agentflow-suggestion" type="button" data-prompt="Show modern living room furniture">Modern living room</button></div>',
          '<div class="agentflow-connection" hidden>Connected to Haven Home</div>',
          '<form class="agentflow-form"><label class="agentflow-sr-only" for="agentflow-input">Message</label><input id="agentflow-input" maxlength="2000" placeholder="Ask anything about furniture, decor, or your room…" autocomplete="off"/><button class="agentflow-mic" type="button" aria-label="Record a voice request">🎙</button><button type="submit" aria-label="Send message">↑</button></form>',
        '</section>',
      '</div>',
    '</section>'
  ].join("");

  var launcher = root.querySelector(".agentflow-launcher");
  var panel = root.querySelector(".agentflow-panel");
  var close = root.querySelector(".agentflow-close");
  var minimize = root.querySelector(".agentflow-minimize");
  var form = root.querySelector(".agentflow-form");
  var input = root.querySelector("#agentflow-input");
  var messages = root.querySelector(".agentflow-messages");
  var connection = root.querySelector(".agentflow-connection");
  var salespersonSelect = root.querySelector("#agentflow-salesperson");
  var languageSelect = root.querySelector("#agentflow-language");
  var guides = root.querySelector(".agentflow-guides");
  var voiceToggle = root.querySelector(".agentflow-voice-toggle");
  var voiceStatus = root.querySelector(".agentflow-voice-status");
  var voiceStage = root.querySelector(".agentflow-voice-stage");
  var voiceState = root.querySelector(".agentflow-voice-state");
  var voiceDetail = root.querySelector(".agentflow-voice-detail");
  var micButton = root.querySelector(".agentflow-mic");
  var muteButton = root.querySelector(".agentflow-mute");
  var notification = root.querySelector(".agentflow-notification");
  var notificationText = root.querySelector(".agentflow-notification-text");
  var notificationAction = root.querySelector(".agentflow-notification-action");
  var ambientVoice = root.querySelector(".agentflow-ambient-voice");

  var internalText = /(?:organization[_-]?id|apiproxy(?:path)?|ucp(?:endpoint)?|shopify_[a-z_]+|drizzle|postgres(?:ql)?|sqlstate|stack\s*trace|(?:select|insert|update|delete)\s+[\s\S]{0,180}\s+from\s+|\/api\/|database\s+error|internal\s+server)/i;
  function safeUiText(value, fallback) {
    var text = typeof value === "string" ? value.trim() : "";
    return text && text.length <= 500 && !internalText.test(text) ? text : fallback;
  }
  function selectedGuide() { return voiceProfiles.find(function (profile) { return profile.id === salespersonSelect.value; }) || voiceProfiles[0] || { displayName: "Your guide" }; }
  function setVoiceUiState(state, title, detail) { voiceStage.dataset.state = state; voiceState.textContent = safeUiText(title, "Your guide is ready"); voiceDetail.textContent = safeUiText(detail, "Tell me what you are looking for."); }
  function setVoiceStatus(text) { voiceStatus.textContent = safeUiText(text, "Voice is temporarily unavailable."); }
  function setMode(mode) {
    currentMode = mode === "chat" ? "chat" : "voice";
    panel.classList.toggle("is-chat-mode", currentMode === "chat");
    root.querySelectorAll(".agentflow-mode-button").forEach(function (button) { var selected = button.dataset.mode === currentMode; button.setAttribute("aria-selected", String(selected)); });
    if (currentMode === "chat" && presentationState === PRESENTATION.PANEL_OPEN) input.focus();
    if (currentMode === "voice") loadVoiceControls();
  }
  function clearNotification() { if (notificationTimer) window.clearTimeout(notificationTimer); notificationTimer = null; notification.hidden = true; notificationText.textContent = ""; notificationAction.hidden = true; }
  function showNotification(text, options) {
    options = options || {};
    var message = safeUiText(text, "AgentFlow is ready when you are.");
    notificationText.textContent = message;
    notification.hidden = false;
    notificationAction.hidden = !options.action;
    if (options.action) notificationAction.textContent = options.actionLabel || "Open";
    if (notificationTimer) window.clearTimeout(notificationTimer);
    if (!options.persistent) notificationTimer = window.setTimeout(clearNotification, options.duration || 4600);
  }
  function stopVoiceCapture() {
    voiceMode = false;
    stopSpeechRecognition();
    stopRecording();
    if (window.speechSynthesis && window.speechSynthesis.cancel) window.speechSynthesis.cancel();
    voiceToggle.setAttribute("aria-pressed", "false");
    voiceToggle.classList.remove("is-active");
    voiceToggle.querySelector("span:last-child").textContent = "Start talking";
    if (voiceStage.dataset.state !== "error") setVoiceUiState("idle", "Ready when you are", selectedGuide().displayName + " is ready to help you shop.");
  }
  function restoreFocus() { if (lastFocusedElement && typeof lastFocusedElement.focus === "function" && document.contains(lastFocusedElement) && !panel.contains(lastFocusedElement)) lastFocusedElement.focus(); else launcher.focus(); lastFocusedElement = null; }
  function transition(nextState, options) {
    options = options || {};
    if (!PRESENTATION[nextState]) nextState = PRESENTATION.CLOSED;
    var wasPanelOpen = !panel.hidden;
    presentationState = nextState;
    var panelOpen = nextState === PRESENTATION.PANEL_OPEN || nextState === PRESENTATION.VOICE_ACTIVE || nextState === PRESENTATION.ATTENTION_REQUIRED || nextState === PRESENTATION.ERROR;
    var ambient = nextState === PRESENTATION.COBROWSING && voiceMode;
    panel.hidden = !panelOpen;
    panel.setAttribute("aria-hidden", String(!panelOpen));
    launcher.setAttribute("aria-expanded", String(panelOpen));
    root.dataset.presentationState = nextState;
    root.classList.toggle("is-cobrowsing", nextState === PRESENTATION.COBROWSING);
    root.classList.toggle("is-notification-only", nextState === PRESENTATION.NOTIFICATION_ONLY);
    root.classList.toggle("is-ambient-voice", ambient);
    ambientVoice.hidden = !ambient;
    if (nextState === PRESENTATION.NOTIFICATION_ONLY || nextState === PRESENTATION.LAUNCHER_ONLY || nextState === PRESENTATION.CLOSED || nextState === PRESENTATION.PANEL_MINIMIZED || nextState === PRESENTATION.COBROWSING) panel.setAttribute("tabindex", "-1");
    else panel.removeAttribute("tabindex");
    if (panelOpen) { setMode(currentMode); loadVoiceControls(); }
    if (!panelOpen && options.stopVoice) stopVoiceCapture();
    if (!panelOpen && wasPanelOpen && options.focus !== false) restoreFocus();
    if (panelOpen && !wasPanelOpen) { lastFocusedElement = document.activeElement; window.setTimeout(function () { if (currentMode === "chat") input.focus(); else voiceToggle.focus(); }, 0); }
  }
  function addMessage(text, kind) {
    var item = document.createElement("div");
    item.className = "agentflow-message agentflow-message-" + kind;
    item.textContent = safeUiText(text, kind === "customer" ? "" : "I can help you explore the collection and your cart.");
    if (!item.textContent) return;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }
  function pageContext() {
    var rawPageType = root.dataset.agentflowPageType || "other";
    var pageType = { index: "home", home: "home", collection: "collection", product: "product", search: "search", cart: "cart", other: "other" }[rawPageType] || "other";
    return { pageType: pageType, currentProductId: root.dataset.agentflowProductId || undefined, currentCollection: root.dataset.agentflowCollection || undefined, url: window.location.href };
  }
  function endpoint(name) { return proxyPath.replace(/\/chat(?:\?.*)?$/, "/" + name); }
  function addAction(label, handler) { var action = document.createElement("button"); action.type = "button"; action.className = "agentflow-action"; action.textContent = label; action.addEventListener("click", handler); messages.appendChild(action); messages.scrollTop = messages.scrollHeight; return action; }
  function productTitle(product) { return product && (product.title || product.name) || "Product"; }
  function productPrice(product) { var value = product && (product.priceMinorUnits !== undefined ? product.priceMinorUnits : product.listPricePaise); if (typeof value !== "number") return ""; return "₹" + (value / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function productImage(product) { return product && (product.imageUrl || (Array.isArray(product.media) ? product.media[0] : undefined)); }
  function productUrl(product) { if (!product) return null; if (product.productUrl) return product.productUrl; if (product.handle) return "/products/" + encodeURIComponent(product.handle); return null; }
  function productHandle(product) { var href = productUrl(product); if (!href) return ""; var match = href.match(/\/products\/([^/?#]+)/i); return match ? decodeURIComponent(match[1]).toLowerCase() : ""; }
  function findProductElement(product) {
    if (!product || !document.querySelectorAll) return null;
    var id = String(product.id || "").toLowerCase(); var handle = productHandle(product); var nodes = document.querySelectorAll("[data-product-id], [data-product-handle], a[href*='/products/']");
    for (var index = 0; index < nodes.length; index += 1) { var node = nodes[index]; if (root.contains(node)) continue; var nodeId = String(node.getAttribute("data-product-id") || "").toLowerCase(); var nodeHandle = String(node.getAttribute("data-product-handle") || "").toLowerCase(); var href = node.getAttribute("href") || ""; var hrefMatch = href.match(/\/products\/([^/?#]+)/i); var hrefHandle = hrefMatch ? decodeURIComponent(hrefMatch[1]).toLowerCase() : ""; if ((id && nodeId === id) || (handle && (nodeHandle === handle || hrefHandle === handle))) return node; }
    return null;
  }
  function highlightProduct(product) {
    var target = findProductElement(product); if (!target) return false;
    var previous = document.querySelectorAll(".agentflow-page-highlight"); for (var index = 0; index < previous.length; index += 1) previous[index].classList.remove("agentflow-page-highlight");
    target.classList.add("agentflow-page-highlight"); target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(function () { target.classList.remove("agentflow-page-highlight"); }, 7000); return true;
  }
  function beginCoBrowsing(message, options) {
    options = options || {};
    if (!manualDismissed) transition(PRESENTATION.COBROWSING, { stopVoice: false, focus: false });
    showNotification(message, { action: options.action !== false, actionLabel: "Return to guide", duration: options.duration || 5200 });
  }
  async function fetchPayload(url, options) { var response = await fetch(url, options); var payload = await response.json().catch(function () { return {}; }); if (!response.ok) throw new Error(safeUiText(payload.error, "The shopping assistant is temporarily unavailable.")); return payload; }
  function invokeAction(action) { return fetchPayload(endpoint("ui-action"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, action: action }) }); }
  function nativeVariantId(productOrLine) { var value = productOrLine && (productOrLine.variantId || productOrLine.id); var match = String(value || "").match(/(\d+)$/); return match ? match[1] : String(value || ""); }
  async function nativeCart() { var response = await fetch("/cart.js", { headers: { Accept: "application/json" } }); if (!response.ok) throw new Error("Shopify cart is unavailable."); return response.json(); }
  async function nativeAdd(product) {
    var variant = product && Array.isArray(product.variants) ? product.variants.find(function (item) { return item.available !== false; }) || product.variants[0] : null;
    var variantId = nativeVariantId(variant || product); if (!variantId) throw new Error("That item has no purchasable variant.");
    var response = await fetch("/cart/add.js", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ items: [{ id: Number(variantId) || variantId, quantity: 1 }] }) });
    if (!response.ok) throw new Error("Shopify could not add that item to the cart.");
    var cart = await nativeCart(); var present = Array.isArray(cart.items) && cart.items.some(function (item) { return String(item.variant_id) === String(variantId) && item.quantity > 0; }); if (!present) throw new Error("Shopify did not confirm that item in the cart."); return cart;
  }
  async function reconcileNativeCart(agentCart) {
    if (!agentCart || !Array.isArray(agentCart.lines)) return nativeCart();
    var cart = await nativeCart(); var updates = {};
    agentCart.lines.forEach(function (line) { var variantId = nativeVariantId(line); if (variantId && Number.isInteger(line.quantity)) { var existing = (cart.items || []).find(function (item) { return String(item.variant_id) === String(variantId); }); if (!existing || existing.quantity !== line.quantity) updates[variantId] = line.quantity; } });
    if (Object.keys(updates).length) { var response = await fetch("/cart/update.js", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ updates: updates }) }); if (!response.ok) throw new Error("Shopify could not sync your cart."); cart = await response.json(); }
    return cart;
  }
  function renderProductCard(product) {
    var card = document.createElement("article"); card.className = "agentflow-product-card";
    var image = productImage(product); if (image) { var img = document.createElement("img"); img.src = image; img.alt = productTitle(product); img.loading = "lazy"; card.appendChild(img); } else { var placeholder = document.createElement("div"); placeholder.className = "agentflow-product-placeholder"; placeholder.textContent = "✦"; card.appendChild(placeholder); }
    var tag = document.createElement("span"); tag.className = "agentflow-product-tag"; tag.textContent = safeUiText(product && (product.badge || product.tag || product.category), "Curated piece"); card.appendChild(tag);
    var body = document.createElement("div"); body.className = "agentflow-product-copy"; var title = document.createElement("strong"); title.textContent = productTitle(product); body.appendChild(title); var price = document.createElement("span"); price.textContent = productPrice(product); body.appendChild(price); var descriptor = document.createElement("small"); descriptor.textContent = safeUiText(product && (product.description || product.material || product.finish), "A considered piece for your home."); body.appendChild(descriptor); card.appendChild(body);
    var controls = document.createElement("div"); controls.className = "agentflow-product-actions";
    var show = document.createElement("button"); show.type = "button"; show.textContent = "Show"; show.setAttribute("aria-label", "Show " + productTitle(product)); show.addEventListener("click", function () { var shown = highlightProduct(product); beginCoBrowsing(shown ? "Showing " + productTitle(product) + " on this page." : "I can open " + productTitle(product) + " for you.", { action: true }); }); controls.appendChild(show);
    var view = document.createElement("button"); view.type = "button"; view.textContent = "View"; view.setAttribute("aria-label", "View " + productTitle(product)); view.addEventListener("click", function () { var href = productUrl(product); if (href) { beginCoBrowsing("Opening " + productTitle(product) + ".", { action: false }); window.location.href = href; } }); controls.appendChild(view);
    var compare = document.createElement("button"); compare.type = "button"; compare.textContent = "Compare"; compare.setAttribute("aria-label", "Compare " + productTitle(product)); compare.addEventListener("click", function () { transition(currentMode === "voice" ? PRESENTATION.VOICE_ACTIVE : PRESENTATION.PANEL_OPEN, { focus: false }); sendMessage("Compare " + productTitle(product) + " with the other options", "text"); }); controls.appendChild(compare);
    var save = document.createElement("button"); save.type = "button"; save.textContent = "Save"; save.setAttribute("aria-label", "Save " + productTitle(product)); save.addEventListener("click", function () { save.disabled = true; invokeAction({ type: "ADD_TO_SHORTLIST", productId: product.id }).then(function () { save.textContent = "Saved"; transition(PRESENTATION.NOTIFICATION_ONLY, { focus: false }); showNotification(productTitle(product) + " saved to your shortlist."); }).catch(function () { save.disabled = false; addMessage("I couldn’t save that piece just now.", "assistant"); }); }); controls.appendChild(save);
    var add = document.createElement("button"); add.type = "button"; add.textContent = "Add"; add.setAttribute("aria-label", "Add " + productTitle(product) + " to cart"); add.addEventListener("click", function () { add.disabled = true; invokeAction({ type: "ADD_TO_CART", productId: product.id }).then(function (payload) { return nativeAdd(product).then(function () { return reconcileNativeCart(payload.cart).then(function () { add.textContent = "Added"; transition(PRESENTATION.NOTIFICATION_ONLY, { focus: false }); showNotification(productTitle(product) + " added to your Shopify cart.", { action: true, actionLabel: "View guide" }); return payload; }); }); }).catch(function (error) { add.disabled = false; addMessage(safeUiText(error && error.message, "I couldn’t add that piece to your Shopify cart."), "assistant"); }); }); controls.appendChild(add);
    card.appendChild(controls); return card;
  }
  function renderSurface(payload) {
    (payload.products || []).forEach(function (product) { if (product && product.id) productsById[product.id] = product; });
    var ui = payload.ui || {}; var productIds = ui.productIds || (payload.products || []).map(function (product) { return product.id; });
    if (["PRODUCT_GRID", "PRODUCT_SPOTLIGHT", "SHORTLIST", "COMPARISON"].indexOf(ui.type) >= 0) { var grid = document.createElement("div"); grid.className = "agentflow-product-grid"; productIds.forEach(function (id) { if (productsById[id]) grid.appendChild(renderProductCard(productsById[id])); }); messages.appendChild(grid); addAction("Show these options on this page", function () { var shown = 0; productIds.forEach(function (id) { if (productsById[id] && highlightProduct(productsById[id])) shown += 1; }); beginCoBrowsing(shown ? "Showing the matching options on this page." : "Those options are available in the guide.", { action: true }); }); if (ui.type === "COMPARISON" && productIds.length > 1) addAction("Compare these options", function () { transition(PRESENTATION.PANEL_OPEN, { focus: false }); sendMessage("Compare these options", "text"); }); }
    if (payload.cart && payload.cart.lines) { var cartNote = document.createElement("div"); cartNote.className = "agentflow-cart-note"; cartNote.textContent = "Syncing your Shopify cart…"; messages.appendChild(cartNote); reconcileNativeCart(payload.cart).then(function (cart) { var count = Array.isArray(cart.items) ? cart.items.reduce(function (sum, line) { return sum + Number(line.quantity || 0); }, 0) : payload.cart.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0); cartNote.textContent = "Shopify cart updated · " + count + " item(s)"; }).catch(function () { cartNote.textContent = "I couldn’t sync that change to your Shopify cart."; }); }
    if (Array.isArray(payload.growthActions) && payload.growthActions.length) payload.growthActions.slice(0, 2).forEach(function (growth) { var product = growth.product; if (product && product.id) productsById[product.id] = product; var label = growth.type === "BUNDLE" ? "Available as a bundle" : "A considered add-on for your order"; addAction(label, function () { sendMessage("Tell me about the bundle option", "text"); }); });
    if (payload.offer && payload.offer.offerId) { addAction(payload.offer.outcome === "ALLOW" ? "Review your offer" : "See offer status", function () { transition(PRESENTATION.ATTENTION_REQUIRED, { focus: false }); sendMessage("Show me the offer", "text"); }); if (!manualDismissed) transition(PRESENTATION.ATTENTION_REQUIRED, { focus: false }); }
    if (payload.approval || payload.checkout || payload.requiresApproval) { if (!manualDismissed) transition(PRESENTATION.ATTENTION_REQUIRED, { focus: false }); }
    if (payload.navigation && payload.navigation.productId && productsById[payload.navigation.productId]) { var navProduct = productsById[payload.navigation.productId]; var didHighlight = highlightProduct(navProduct); beginCoBrowsing(didHighlight ? "Showing " + productTitle(navProduct) + " on this page." : "Opening " + productTitle(navProduct) + ".", { action: true }); }
    messages.scrollTop = messages.scrollHeight;
  }
  function renderGuideOptions() {
    guides.innerHTML = "";
    voiceProfiles.forEach(function (profile, index) { var card = document.createElement("button"); card.type = "button"; card.className = "agentflow-guide-card"; card.setAttribute("role", "listitem"); card.dataset.profileId = profile.id; var avatar = document.createElement("span"); avatar.className = "agentflow-guide-avatar"; avatar.textContent = String(profile.displayName || "Guide").slice(0, 1).toUpperCase(); avatar.setAttribute("aria-hidden", "true"); card.appendChild(avatar); var name = document.createElement("span"); name.className = "agentflow-guide-name"; name.textContent = profile.displayName || "Guide " + (index + 1); card.appendChild(name); var description = document.createElement("span"); description.className = "agentflow-guide-description"; description.textContent = profile.description || "Your personal product guide"; card.appendChild(description); card.addEventListener("click", function () { selectSalesperson(profile.id); }); guides.appendChild(card); }); updateGuideSelection();
  }
  function updateGuideSelection() { root.querySelectorAll(".agentflow-guide-card").forEach(function (card) { var selected = card.dataset.profileId === salespersonSelect.value; card.classList.toggle("is-selected", selected); card.setAttribute("aria-pressed", String(selected)); }); var guide = selectedGuide(); setVoiceUiState(voiceStage.dataset.state || "idle", voiceState.textContent, guide.displayName + " is ready to help you shop."); }
  function updateLanguageSelection() { root.querySelectorAll(".agentflow-language-pill").forEach(function (pill) { var selected = pill.dataset.language === languageSelect.value; pill.classList.toggle("is-selected", selected); pill.setAttribute("aria-pressed", String(selected)); }); }
  async function loadVoiceControls() {
    if (voiceControlsLoaded) return;
    voiceControlsLoaded = true;
    try { var payload = await fetchPayload(endpoint("salespeople"), { headers: { Accept: "application/json" } }); voiceProfiles = payload.salespeople || []; salespersonSelect.innerHTML = ""; voiceProfiles.forEach(function (profile) { var option = document.createElement("option"); option.value = profile.id; option.textContent = profile.displayName + " · " + (profile.description || "product guide"); salespersonSelect.appendChild(option); }); if (!voiceProfiles.length) throw new Error("No AI salesperson is available for this store."); var preferred = voiceProfiles.find(function (profile) { return profile.isMerchantDefault; }) || voiceProfiles[0]; salespersonSelect.value = preferred.id; renderGuideOptions(); updateLanguageSelection(); await ensureVoiceSession(false); setVoiceStatus("Ready with " + preferred.displayName); setVoiceUiState("idle", "Ready when you are", preferred.displayName + " is ready to help you shop."); }
    catch (error) { guides.innerHTML = "<span class=\"agentflow-guide-description\">Your guides are temporarily unavailable.</span>"; setVoiceStatus(error && error.message ? error.message : "Voice options are temporarily unavailable."); setVoiceUiState("error", "Your guide is taking a moment", "You can continue with chat while we reconnect."); }
  }
  async function ensureVoiceSession(selectorOpened) { var payload = await fetchPayload(endpoint("voice/session"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, voiceEnabled: true, selectorOpened: Boolean(selectorOpened) }) }); voiceSession = payload; sessionId = payload.sessionId || sessionId; if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* storage may be unavailable */ } if (payload.salesperson && salespersonSelect.value !== payload.salesperson.id) salespersonSelect.value = payload.salesperson.id; updateGuideSelection(); return payload; }
  function selectSalesperson(id) { salespersonSelect.value = id; updateGuideSelection(); ensureVoiceSession(true).then(function (view) { setVoiceStatus("Ready with " + view.salesperson.displayName); }).catch(function (error) { setVoiceStatus(error && error.message ? error.message : "That salesperson is unavailable."); }); }
  function playAudio(audioBase64, mimeType) { if (!audioBase64 || voiceMuted) return; try { var audio = new Audio("data:" + (mimeType || "audio/wav") + ";base64," + audioBase64); setVoiceUiState("speaking", selectedGuide().displayName + " is speaking", "Take your time — I’m here when you’re ready."); audio.onended = function () { if (voiceMode) setVoiceUiState("listening", "I’m listening", "Tell me what you would like to explore next."); }; audio.play().catch(function () { setVoiceStatus("Tap the screen to hear your guide."); }); } catch { /* audio is an enhancement; text remains available */ } }
  async function speakText(text) { if (!text || !voiceSession) return; try { var payload = await fetchPayload(endpoint("voice/tts"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, text: text }) }); playAudio(payload.audioBase64, payload.mimeType); } catch (error) { setVoiceStatus(error && error.message ? error.message : "Voice output is temporarily unavailable."); } }
  function localVoiceCommand(text) {
    var value = text.toLowerCase().replace(/[?!.,]/g, "").trim();
    var amount = Math.max(420, Math.floor(window.innerHeight * 0.72));
    var collectionRequest = value.match(/\b(?:open|show|go to)\s+(?:the\s+)?(.+?)\s+collection\b/);
    if (collectionRequest) {
      var collectionQuery = collectionRequest[1].trim();
      var collectionLinks = document.querySelectorAll("a[href*='/collections/']");
      for (var collectionIndex = 0; collectionIndex < collectionLinks.length; collectionIndex += 1) {
        var collectionLink = collectionLinks[collectionIndex];
        if ((collectionLink.textContent || "").toLowerCase().includes(collectionQuery) || (collectionLink.getAttribute("href") || "").toLowerCase().includes(collectionQuery.replace(/\s+/g, "-"))) {
          beginCoBrowsing("Opening the " + collectionQuery + " collection.", { action: false });
          window.location.href = collectionLink.href;
          return "Opening the collection.";
        }
      }
    }
    if (/(accessor(?:y|ies)|section)/.test(value) && /\b(show|open|find|dikhao|dikhai|take)\b/.test(value)) {
      var sectionNodes = document.querySelectorAll("[id*='accessor'], [class*='accessor'], [data-section-id*='accessor'], [data-section-type*='accessor']");
      if (sectionNodes.length) sectionNodes[0].scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollBy(0, amount);
      beginCoBrowsing("Showing the accessories section.");
      return "Showing the accessories section.";
    }
    if (/\b(scroll|move)\s+(down|lower)\b|\bshow me more\b/.test(value)) { window.scrollBy(0, amount); beginCoBrowsing("Showing you more of the collection."); return "Scrolling down."; }
    if (/\b(scroll|move)\s+up\b/.test(value)) { window.scrollBy(0, -amount); beginCoBrowsing("Moving back up the collection."); return "Scrolling up."; }
    if (/\b(scroll|go)\s+to\s+(the\s+)?top\b/.test(value)) { window.scrollTo(0, 0); beginCoBrowsing("Back at the top of the page."); return "Back at the top."; }
    if (/\b(scroll|go)\s+to\s+(the\s+)?bottom\b/.test(value)) { window.scrollTo(0, document.body.scrollHeight); beginCoBrowsing("Taking you to the end of the collection."); return "At the bottom of the page."; }
    if (/\b(open|show|go to)\s+(the\s+)?cart\b/.test(value)) { beginCoBrowsing("Opening your cart.", { action: false }); window.location.href = "/cart"; return "Opening your cart."; }
    if (/\b(go|take me)\s+(back|home)\b|\bopen\s+(the\s+)?home(page)?\b/.test(value)) { beginCoBrowsing("Taking you there.", { action: false }); if (/back/.test(value)) window.history.back(); else window.location.href = "/"; return "Taking you there."; }
    var productKeys = Object.keys(productsById);
    if (/\b(open|show|view)\s+(the\s+)?(first|1st)\s+product\b/.test(value) && productKeys[0]) { var firstUrl = productUrl(productsById[productKeys[0]]); if (firstUrl) { beginCoBrowsing("Opening the first result.", { action: false }); window.location.href = firstUrl; } return "Opening the first result."; }
    var requested = value.match(/\b(?:show|highlight|locate|find)\s+(?:the\s+)?(.+)/); if (requested && productKeys.length) { var query = requested[1].replace(/\b(on|in)\s+(the\s+)?page\b/g, "").trim(); var match = productKeys.map(function (key) { return productsById[key]; }).find(function (product) { return (productTitle(product) + " " + (product.handle || "")).toLowerCase().includes(query); }); if (match) return highlightProduct(match) ? (beginCoBrowsing("Showing " + productTitle(match) + " on this page."), "I’ve highlighted that option on this page.") : "I can open that option for you."; }
    return null;
  }
  async function handleVoiceText(text) { if (!text) return; addMessage(text, "customer"); var localReply = localVoiceCommand(text); if (localReply) { addMessage(localReply, "assistant"); await speakText(localReply); return; } await sendMessage(text, "voice"); }
  async function transcribeRecording(blob) { setVoiceUiState("thinking", "Understanding you…", "I’m finding the best way to help."); setVoiceStatus("Understanding you…"); var formData = new FormData(); formData.append("file", blob, "voice-request.webm"); if (sessionId) formData.append("sessionId", sessionId); formData.append("languageCode", languageSelect.value === "hinglish" ? "hi-IN" : languageSelect.value); try { var payload = await fetchPayload(endpoint("voice/stt"), { method: "POST", body: formData }); sessionId = payload.sessionId || sessionId; await handleVoiceText((payload.transcript || "").trim()); setVoiceStatus("Listening when you are ready"); setVoiceUiState("listening", "I’m listening", "Tell me what you would like to explore next."); } catch (error) { var message = error && error.message ? error.message : "Voice input is temporarily unavailable."; setVoiceStatus(message); setVoiceUiState("error", "Couldn’t catch that", "Try again, or switch to chat whenever you like."); addMessage(message, "assistant"); } }
  async function startRecording() { if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { setVoiceStatus("This browser does not support microphone input. You can still type."); return; } try { await ensureVoiceSession(false); recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true }); var mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"; var chunks = []; recorder = new MediaRecorder(recorderStream, { mimeType: mimeType }); recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); }; recorder.onstop = function () { var blob = new Blob(chunks, { type: mimeType }); if (recorderStream) recorderStream.getTracks().forEach(function (track) { track.stop(); }); recorder = null; recorderStream = null; if (recorderTimer) window.clearTimeout(recorderTimer); recorderTimer = null; micButton.classList.remove("is-recording"); transcribeRecording(blob); }; recorder.start(); micButton.classList.add("is-recording"); setVoiceUiState("listening", "I’m listening", "Tap the microphone again when you’re finished."); setVoiceStatus("Listening… tap the mic when you are done"); recorderTimer = window.setTimeout(stopRecording, 9000); } catch (error) { setVoiceUiState("error", "Microphone permission needed", "You can continue by typing your request."); setVoiceStatus(error && error.message ? error.message : "Microphone permission is needed for voice input."); } }
  function stopRecording() { if (recorder && recorder.state !== "inactive") recorder.stop(); }
  function recognitionConstructor() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function startSpeechRecognition() { var Constructor = recognitionConstructor(); if (!Constructor) { setVoiceStatus("Voice mode is ready. Tap the mic for each request."); return; } speechRecognition = new Constructor(); speechRecognition.lang = languageSelect.value === "hi-IN" ? "hi-IN" : "en-IN"; speechRecognition.continuous = true; speechRecognition.interimResults = false; speechRecognition.onresult = function (event) { for (var index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) handleVoiceText(event.results[index][0].transcript.trim()); }; speechRecognition.onerror = function () { setVoiceUiState("error", "Couldn’t catch that", "Try again, or switch to chat whenever you like."); setVoiceStatus("Voice mode paused. Tap Start talking to try again."); }; speechRecognition.onend = function () { if (voiceMode && speechRecognition) try { speechRecognition.start(); } catch { /* browser is already restarting */ } }; try { speechRecognition.start(); setVoiceUiState("listening", "I’m listening", "Speak naturally, like you’re talking to a real person."); setVoiceStatus("Listening continuously · say scroll, cart, or a product request"); } catch { setVoiceStatus("Voice mode is ready. Tap the mic for each request."); } }
  function stopSpeechRecognition() { if (speechRecognition) { var current = speechRecognition; speechRecognition = null; try { current.stop(); } catch { /* already stopped */ } } }
  async function toggleVoiceMode() { if (voiceMode) { stopVoiceCapture(); setVoiceStatus("Voice mode paused"); return; } try { await ensureVoiceSession(true); voiceMode = true; transition(PRESENTATION.VOICE_ACTIVE, { focus: false }); voiceToggle.setAttribute("aria-pressed", "true"); voiceToggle.classList.add("is-active"); voiceToggle.querySelector("span:last-child").textContent = "Stop listening"; setVoiceUiState("listening", "I’m listening", "Speak naturally, like you’re talking to a real person."); startSpeechRecognition(); } catch (error) { setVoiceUiState("error", "Voice is taking a moment", "You can continue with chat while we reconnect."); setVoiceStatus(error && error.message ? error.message : "Voice mode is temporarily unavailable."); } }
  async function sendMessage(text, inputMode) { if (!text) return; if (inputMode !== "voice") addMessage(text, "customer"); input.value = ""; var submit = form.querySelector("button[type=submit]"); submit.disabled = true; connection.textContent = "Connected · finding a fit…"; connection.hidden = root.dataset.agentflowDevStatus !== "true"; var useVoice = inputMode === "voice" || voiceMode; if (useVoice) setVoiceUiState("thinking", "Thinking…", "I’m finding the best way to help."); try { var requestPath = useVoice ? endpoint("voice/turn") : proxyPath; var body = useVoice ? { sessionId: sessionId || undefined, message: text, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, voiceEnabled: true, inputMode: inputMode || "text", storefrontContext: pageContext() } : { sessionId: sessionId || undefined, message: text, storefrontContext: pageContext() }; var payload = await fetchPayload(requestPath, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }); sessionId = payload.sessionId || sessionId; if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* storage may be unavailable */ } connection.textContent = "Connected to Haven Home"; addMessage(safeUiText(payload.message, "I found a few ways to help."), "assistant"); renderSurface(payload); if (payload.voice && payload.voice.audioBase64) playAudio(payload.voice.audioBase64, payload.voice.mimeType); if (payload.voice && payload.voice.error) setVoiceStatus(payload.voice.error); else if (useVoice) { setVoiceUiState("listening", "I’m listening", "Tell me what you would like to explore next."); setVoiceStatus("Listening when you are ready"); } } catch (error) { var message = error && error.message ? error.message : "The shopping assistant is temporarily unavailable."; connection.textContent = "Temporarily unavailable"; addMessage(message, "assistant"); if (useVoice) setVoiceUiState("error", "Your guide is taking a moment", "You can switch to chat or try again shortly."); if (!manualDismissed) { transition(PRESENTATION.ERROR, { focus: false }); showNotification(message, { action: true, actionLabel: "Retry", persistent: true }); } } finally { submit.disabled = false; if (currentMode === "chat" && presentationState === PRESENTATION.PANEL_OPEN) input.focus(); } }

  launcher.addEventListener("click", function () { manualDismissed = false; clearNotification(); transition(panel.hidden ? (voiceMode ? PRESENTATION.VOICE_ACTIVE : PRESENTATION.PANEL_OPEN) : PRESENTATION.PANEL_MINIMIZED, { focus: true }); });
  ambientVoice.addEventListener("click", function () { manualDismissed = false; clearNotification(); transition(PRESENTATION.VOICE_ACTIVE, { focus: true }); setMode("voice"); });
  notificationAction.addEventListener("click", function () { manualDismissed = false; clearNotification(); transition(voiceMode ? PRESENTATION.VOICE_ACTIVE : PRESENTATION.PANEL_OPEN, { focus: true }); });
  close.addEventListener("click", function () { manualDismissed = true; clearNotification(); transition(PRESENTATION.LAUNCHER_ONLY, { stopVoice: true, focus: true }); });
  minimize.addEventListener("click", function () { transition(PRESENTATION.PANEL_MINIMIZED, { focus: true }); });
  voiceToggle.addEventListener("click", toggleVoiceMode);
  root.querySelector(".agentflow-type-instead").addEventListener("click", function () { transition(PRESENTATION.PANEL_OPEN, { focus: false }); setMode("chat"); });
  root.querySelector(".agentflow-settings").addEventListener("click", function () { setVoiceStatus("Voice settings follow your browser controls."); });
  muteButton.addEventListener("click", function () { voiceMuted = !voiceMuted; muteButton.setAttribute("aria-pressed", String(voiceMuted)); muteButton.classList.toggle("is-active", voiceMuted); muteButton.querySelector("b").textContent = voiceMuted ? "Unmute" : "Mute"; if (recorderStream) recorderStream.getAudioTracks().forEach(function (track) { track.enabled = !voiceMuted; }); setVoiceStatus(voiceMuted ? "Microphone muted" : "Microphone ready"); });
  micButton.addEventListener("click", function () { if (recorder) stopRecording(); else startRecording(); });
  root.querySelectorAll(".agentflow-mode-button").forEach(function (button) { button.addEventListener("click", function () { manualDismissed = false; transition(button.dataset.mode === "voice" ? PRESENTATION.VOICE_ACTIVE : PRESENTATION.PANEL_OPEN, { focus: false }); setMode(button.dataset.mode); }); });
  root.querySelectorAll(".agentflow-language-pill").forEach(function (pill) { pill.addEventListener("click", function () { languageSelect.value = pill.dataset.language; updateLanguageSelection(); ensureVoiceSession(false).then(function () { setVoiceStatus("Ready in " + pill.textContent.trim()); }).catch(function () { setVoiceStatus("That language is temporarily unavailable."); }); }); });
  root.querySelectorAll("[data-prompt]").forEach(function (button) { button.addEventListener("click", function () { manualDismissed = false; transition(PRESENTATION.PANEL_OPEN, { focus: false }); setMode("chat"); sendMessage(button.dataset.prompt, "text"); }); });
  salespersonSelect.addEventListener("change", function () { updateGuideSelection(); ensureVoiceSession(true).then(function (view) { setVoiceStatus("Ready with " + view.salesperson.displayName); }).catch(function (error) { setVoiceStatus(error && error.message ? error.message : "That salesperson is unavailable."); }); });
  languageSelect.addEventListener("change", function () { updateLanguageSelection(); if (voiceMode && speechRecognition) { stopSpeechRecognition(); startSpeechRecognition(); } ensureVoiceSession(false).catch(function (error) { setVoiceStatus(error && error.message ? error.message : "That language is unavailable."); }); });
  form.addEventListener("submit", function (event) { event.preventDefault(); sendMessage(input.value.trim(), "text"); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); manualDismissed = true; transition(PRESENTATION.LAUNCHER_ONLY, { stopVoice: true, focus: true }); return; }
    if (event.key === "Tab" && !panel.hidden) { var focusable = panel.querySelectorAll("button:not([disabled]), input:not([disabled])"); if (!focusable.length) return; var first = focusable[0]; var last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  transition(PRESENTATION.CLOSED, { focus: false });
})();
