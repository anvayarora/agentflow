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
  var recorder = null;
  var recorderStream = null;
  var recorderTimer = null;
  var speechRecognition = null;
  var voiceControlsLoaded = false;
  try { sessionId = window.sessionStorage.getItem(sessionKey); } catch { /* storage may be unavailable */ }

  root.innerHTML = [
    '<button class="agentflow-launcher" type="button" aria-expanded="false" aria-controls="agentflow-panel"><span class="agentflow-launcher-mark">✦</span><span>Shop with AgentFlow</span></button>',
    '<section class="agentflow-panel is-voice-first" id="agentflow-panel" hidden aria-label="AgentFlow shopping assistant"><header class="agentflow-panel-header"><div><strong>Haven Home</strong><span>Your personal product guide</span></div><button class="agentflow-close" type="button" aria-label="Close assistant">×</button></header><div class="agentflow-voice-toolbar"><div class="agentflow-voice-heading"><span>AI salesperson</span><small>Talk naturally and I’ll guide you</small></div><div class="agentflow-voice-first-copy"><span class="agentflow-voice-orb" aria-hidden="true">✦</span><strong>How can I help you shop?</strong><span>Ask for a style, size, budget, or a way around the page.</span></div><div class="agentflow-voice-selects"><label>Guide<select id="agentflow-salesperson" aria-label="Choose AI salesperson"><option value="">Loading guides…</option></select></label><label>Language<select id="agentflow-language" aria-label="Choose language"><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option><option value="hinglish">Hinglish</option></select></label></div><div class="agentflow-voice-actions"><button class="agentflow-voice-toggle" type="button" aria-pressed="false"><span class="agentflow-mic-dot">●</span><span>Start voice</span></button><button class="agentflow-text-toggle" type="button">Continue with text</button><span class="agentflow-voice-status" role="status">Voice-ready · choose a guide</span></div></div><div class="agentflow-messages" aria-live="polite"><div class="agentflow-message agentflow-message-assistant">Tell me what you are looking for and I’ll guide you to the right pieces.</div></div><div class="agentflow-connection" hidden>Connected to Haven Home</div><form class="agentflow-form"><label class="agentflow-sr-only" for="agentflow-input">Message</label><input id="agentflow-input" maxlength="2000" placeholder="Ask for a product, size, or finish…" autocomplete="off"/><button class="agentflow-mic" type="button" aria-label="Record a voice request">🎙</button><button type="submit" aria-label="Send message">↑</button></form></section>'
  ].join("");

  var launcher = root.querySelector(".agentflow-launcher");
  var panel = root.querySelector(".agentflow-panel");
  var close = root.querySelector(".agentflow-close");
  var form = root.querySelector(".agentflow-form");
  var input = root.querySelector("#agentflow-input");
  var messages = root.querySelector(".agentflow-messages");
  var connection = root.querySelector(".agentflow-connection");
  var salespersonSelect = root.querySelector("#agentflow-salesperson");
  var languageSelect = root.querySelector("#agentflow-language");
  var voiceToggle = root.querySelector(".agentflow-voice-toggle");
  var textToggle = root.querySelector(".agentflow-text-toggle");
  var voiceStatus = root.querySelector(".agentflow-voice-status");
  var micButton = root.querySelector(".agentflow-mic");

  var internalText = /(?:organization[_-]?id|apiproxy(?:path)?|ucp(?:endpoint)?|shopify_[a-z_]+|drizzle|postgres(?:ql)?|sqlstate|stack\s*trace|(?:select|insert|update|delete)\s+[\s\S]{0,180}\s+from\s+|\/api\/|database\s+error|internal\s+server)/i;
  function safeUiText(value, fallback) { var text = typeof value === "string" ? value.trim() : ""; return text && text.length <= 500 && !internalText.test(text) ? text : fallback; }
  function setOpen(open) { launcher.setAttribute("aria-expanded", String(open)); panel.hidden = !open; if (open) { panel.classList.add("is-voice-first"); panel.classList.remove("is-text-mode"); loadVoiceControls(); } else { panel.classList.remove("is-text-mode"); panel.classList.add("is-voice-first"); } }
  function showTextChat() { panel.classList.remove("is-voice-first"); panel.classList.add("is-text-mode"); input.focus(); }
  function addMessage(text, kind) { var item = document.createElement("div"); item.className = "agentflow-message agentflow-message-" + kind; item.textContent = safeUiText(text, kind === "customer" ? "" : "I can help you explore the catalogue and your cart."); if (!item.textContent) return; messages.appendChild(item); messages.scrollTop = messages.scrollHeight; }
  function setVoiceStatus(text) { voiceStatus.textContent = safeUiText(text, "Voice is temporarily unavailable."); }
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
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index]; if (root.contains(node)) continue;
      var nodeId = String(node.getAttribute("data-product-id") || "").toLowerCase(); var nodeHandle = String(node.getAttribute("data-product-handle") || "").toLowerCase(); var href = node.getAttribute("href") || ""; var hrefMatch = href.match(/\/products\/([^/?#]+)/i); var hrefHandle = hrefMatch ? decodeURIComponent(hrefMatch[1]).toLowerCase() : "";
      if ((id && nodeId === id) || (handle && (nodeHandle === handle || hrefHandle === handle))) return node;
    }
    return null;
  }
  function highlightProduct(product) {
    var target = findProductElement(product); if (!target) return false;
    var previous = document.querySelectorAll(".agentflow-page-highlight"); for (var index = 0; index < previous.length; index += 1) previous[index].classList.remove("agentflow-page-highlight");
    target.classList.add("agentflow-page-highlight"); target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(function () { target.classList.remove("agentflow-page-highlight"); }, 7000); return true;
  }

  async function fetchPayload(url, options) {
    var response = await fetch(url, options);
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(safeUiText(payload.error, "The shopping assistant is temporarily unavailable."));
    return payload;
  }
  function invokeAction(action) {
    return fetchPayload(endpoint("ui-action"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, action: action }) });
  }
  function renderProductCard(product) {
    var card = document.createElement("article"); card.className = "agentflow-product-card";
    var image = productImage(product); if (image) { var img = document.createElement("img"); img.src = image; img.alt = productTitle(product); img.loading = "lazy"; card.appendChild(img); } else { var placeholder = document.createElement("div"); placeholder.className = "agentflow-product-placeholder"; placeholder.textContent = "✦"; card.appendChild(placeholder); }
    var body = document.createElement("div"); body.className = "agentflow-product-copy"; var title = document.createElement("strong"); title.textContent = productTitle(product); body.appendChild(title); var price = document.createElement("span"); price.textContent = productPrice(product); body.appendChild(price); card.appendChild(body);
    var controls = document.createElement("div"); controls.className = "agentflow-product-actions";
    var show = document.createElement("button"); show.type = "button"; show.textContent = "Show"; show.addEventListener("click", function () { if (highlightProduct(product)) addMessage("Showing " + productTitle(product) + " on this page.", "assistant"); else addMessage("I can open " + productTitle(product) + " for you.", "assistant"); }); controls.appendChild(show);
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
      addAction("Show these options on this page", function () { var shown = 0; productIds.forEach(function (id) { if (productsById[id] && highlightProduct(productsById[id])) shown += 1; }); addMessage(shown ? "I’ve brought the matching options into view." : "Those options are available in the assistant above.", "assistant"); });
      if (ui.type === "COMPARISON" && productIds.length > 1) addAction("Compare these options", function () { sendMessage("Compare these options", "text"); });
    }
    if (payload.cart && payload.cart.lines) { var cartNote = document.createElement("div"); cartNote.className = "agentflow-cart-note"; cartNote.textContent = "Cart updated · " + payload.cart.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0) + " item(s)"; messages.appendChild(cartNote); }
    if (Array.isArray(payload.growthActions) && payload.growthActions.length) { payload.growthActions.slice(0, 2).forEach(function (growth) { var product = growth.product; if (product && product.id) productsById[product.id] = product; var label = growth.type === "BUNDLE" ? "Available as a bundle" : "A considered add-on for your order"; addAction(label, function () { sendMessage("Tell me about the bundle option", "text"); }); }); }
    if (payload.offer && payload.offer.offerId) addAction(payload.offer.outcome === "ALLOW" ? "Review private offer" : "See offer status", function () { sendMessage("Show me the offer", "text"); });
    if (payload.navigation && payload.navigation.productId && productsById[payload.navigation.productId] && highlightProduct(productsById[payload.navigation.productId])) addMessage("I’ve highlighted that option on this page.", "assistant");
    messages.scrollTop = messages.scrollHeight;
  }

  async function loadVoiceControls() {
    if (voiceControlsLoaded) return;
    voiceControlsLoaded = true;
    try {
      var payload = await fetchPayload(endpoint("salespeople"), { headers: { Accept: "application/json" } });
      voiceProfiles = payload.salespeople || [];
      salespersonSelect.innerHTML = "";
      voiceProfiles.forEach(function (profile) { var option = document.createElement("option"); option.value = profile.id; option.textContent = profile.displayName + " · " + (profile.description || "product guide"); salespersonSelect.appendChild(option); });
      if (!voiceProfiles.length) throw new Error("No AI salesperson is available for this store.");
      var preferred = voiceProfiles.find(function (profile) { return profile.isMerchantDefault; }) || voiceProfiles[0];
      salespersonSelect.value = preferred.id;
      await ensureVoiceSession(false);
      setVoiceStatus("Ready with " + preferred.displayName);
    } catch (error) {
      salespersonSelect.innerHTML = "<option value=\"\">Unavailable</option>";
      setVoiceStatus(error && error.message ? error.message : "Voice options are temporarily unavailable.");
    }
  }
  async function ensureVoiceSession(selectorOpened) {
    var payload = await fetchPayload(endpoint("voice/session"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, voiceEnabled: true, selectorOpened: Boolean(selectorOpened) }) });
    voiceSession = payload;
    sessionId = payload.sessionId || sessionId;
    if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* storage may be unavailable */ }
    if (payload.salesperson && salespersonSelect.value !== payload.salesperson.id) salespersonSelect.value = payload.salesperson.id;
    return payload;
  }
  function playAudio(audioBase64, mimeType) { if (!audioBase64) return; try { var audio = new Audio("data:" + (mimeType || "audio/wav") + ";base64," + audioBase64); audio.play().catch(function () { /* autoplay may be blocked until the next gesture */ }); } catch { /* audio is an enhancement; text remains available */ } }
  async function speakText(text) {
    if (!text || !voiceSession) return;
    try { var payload = await fetchPayload(endpoint("voice/tts"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, text: text }) }); playAudio(payload.audioBase64, payload.mimeType); } catch (error) { setVoiceStatus(error && error.message ? error.message : "Voice output is temporarily unavailable."); }
  }
  function localVoiceCommand(text) {
    var value = text.toLowerCase().replace(/[?!.,]/g, "").trim();
    if (/\b(scroll|move)\s+(down|lower)\b|\bshow me more\b/.test(value)) { window.scrollBy(0, Math.max(420, Math.floor(window.innerHeight * 0.72))); return "Scrolling down."; }
    if (/\b(scroll|move)\s+up\b/.test(value)) { window.scrollBy(0, -Math.max(420, Math.floor(window.innerHeight * 0.72))); return "Scrolling up."; }
    if (/\b(scroll|go)\s+to\s+(the\s+)?top\b/.test(value)) { window.scrollTo(0, 0); return "Back at the top."; }
    if (/\b(scroll|go)\s+to\s+(the\s+)?bottom\b/.test(value)) { window.scrollTo(0, document.body.scrollHeight); return "At the bottom of the page."; }
    if (/\b(open|show|go to)\s+(the\s+)?cart\b/.test(value)) { window.location.href = "/cart"; return "Opening your cart."; }
    if (/\b(go|take me)\s+(back|home)\b|\bopen\s+(the\s+)?home(page)?\b/.test(value)) { if (/back/.test(value)) window.history.back(); else window.location.href = "/"; return "Taking you there."; }
    var productKeys = Object.keys(productsById);
    if (/\b(open|show|view)\s+(the\s+)?(first|1st)\s+product\b/.test(value) && productKeys[0]) { var firstUrl = productUrl(productsById[productKeys[0]]); if (firstUrl) window.location.href = firstUrl; return "Opening the first result."; }
    var requested = value.match(/\b(?:show|highlight|locate|find)\s+(?:the\s+)?(.+)/);
    if (requested && productKeys.length) {
      var query = requested[1].replace(/\b(on|in)\s+(the\s+)?page\b/g, "").trim();
      var match = productKeys.map(function (key) { return productsById[key]; }).find(function (product) { return (productTitle(product) + " " + (product.handle || "")).toLowerCase().includes(query); });
      if (match) return highlightProduct(match) ? "I’ve highlighted that option on this page." : "I can open that option for you.";
    }
    return null;
  }
  async function handleVoiceText(text) {
    if (!text) return;
    addMessage(text, "customer");
    var localReply = localVoiceCommand(text);
    if (localReply) { addMessage(localReply, "assistant"); await speakText(localReply); return; }
    await sendMessage(text, "voice");
  }
  async function transcribeRecording(blob) {
    setVoiceStatus("Understanding you…");
    var formData = new FormData(); formData.append("file", blob, "voice-request.webm"); if (sessionId) formData.append("sessionId", sessionId); formData.append("languageCode", languageSelect.value === "hinglish" ? "hi-IN" : languageSelect.value);
    try { var payload = await fetchPayload(endpoint("voice/stt"), { method: "POST", body: formData }); sessionId = payload.sessionId || sessionId; await handleVoiceText((payload.transcript || "").trim()); setVoiceStatus("Listening when you are ready"); } catch (error) { var message = error && error.message ? error.message : "Voice input is temporarily unavailable."; setVoiceStatus(message); addMessage(message, "assistant"); }
  }
  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { setVoiceStatus("This browser does not support microphone input. You can still type."); return; }
    try {
      await ensureVoiceSession(false);
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      var chunks = []; recorder = new MediaRecorder(recorderStream, { mimeType: mimeType });
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = function () { var blob = new Blob(chunks, { type: mimeType }); if (recorderStream) recorderStream.getTracks().forEach(function (track) { track.stop(); }); recorder = null; recorderStream = null; if (recorderTimer) window.clearTimeout(recorderTimer); recorderTimer = null; micButton.classList.remove("is-recording"); transcribeRecording(blob); };
      recorder.start(); micButton.classList.add("is-recording"); setVoiceStatus("Listening… tap the mic when you are done"); recorderTimer = window.setTimeout(stopRecording, 9000);
    } catch (error) { setVoiceStatus(error && error.message ? error.message : "Microphone permission is needed for voice input."); }
  }
  function stopRecording() { if (recorder && recorder.state !== "inactive") recorder.stop(); }
  function recognitionConstructor() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function startSpeechRecognition() {
    var Constructor = recognitionConstructor(); if (!Constructor) { setVoiceStatus("Voice mode is ready. Tap the mic for each request."); return; }
    speechRecognition = new Constructor(); speechRecognition.lang = languageSelect.value === "hi-IN" ? "hi-IN" : "en-IN"; speechRecognition.continuous = true; speechRecognition.interimResults = false;
    speechRecognition.onresult = function (event) { for (var index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) handleVoiceText(event.results[index][0].transcript.trim()); };
    speechRecognition.onerror = function () { setVoiceStatus("Voice mode paused. Tap Start voice to try again."); };
    speechRecognition.onend = function () { if (voiceMode && speechRecognition) try { speechRecognition.start(); } catch { /* browser is already restarting */ } };
    try { speechRecognition.start(); setVoiceStatus("Listening continuously · say scroll, cart, or a product request"); } catch { setVoiceStatus("Voice mode is ready. Tap the mic for each request."); }
  }
  function stopSpeechRecognition() { if (speechRecognition) { var current = speechRecognition; speechRecognition = null; try { current.stop(); } catch { /* already stopped */ } } }
  async function toggleVoiceMode() {
    if (voiceMode) { voiceMode = false; stopSpeechRecognition(); stopRecording(); voiceToggle.setAttribute("aria-pressed", "false"); voiceToggle.classList.remove("is-active"); voiceToggle.querySelector("span:last-child").textContent = "Start voice"; setVoiceStatus("Voice mode paused"); return; }
    try { await ensureVoiceSession(true); voiceMode = true; voiceToggle.setAttribute("aria-pressed", "true"); voiceToggle.classList.add("is-active"); voiceToggle.querySelector("span:last-child").textContent = "Stop voice"; startSpeechRecognition(); } catch (error) { setVoiceStatus(error && error.message ? error.message : "Voice mode is temporarily unavailable."); }
  }
  async function sendMessage(text, inputMode) {
    if (!text) return;
    if (inputMode !== "voice") addMessage(text, "customer");
    input.value = ""; var submit = form.querySelector("button[type=submit]"); submit.disabled = true; connection.textContent = "Connected · finding a fit…"; connection.hidden = root.dataset.agentflowDevStatus !== "true";
    var useVoice = inputMode === "voice" || voiceMode;
    try {
      var requestPath = useVoice ? endpoint("voice/turn") : proxyPath;
      var body = useVoice ? { sessionId: sessionId || undefined, message: text, salespersonProfileId: salespersonSelect.value || undefined, language: languageSelect.value, voiceEnabled: true, inputMode: inputMode || "text", storefrontContext: pageContext() } : { sessionId: sessionId || undefined, message: text, storefrontContext: pageContext() };
      var payload = await fetchPayload(requestPath, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      sessionId = payload.sessionId || sessionId; if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* storage may be unavailable */ }
      connection.textContent = "Connected to Haven Home"; addMessage(safeUiText(payload.message, "I found a few ways to help."), "assistant"); renderSurface(payload); if (payload.voice && payload.voice.audioBase64) playAudio(payload.voice.audioBase64, payload.voice.mimeType); if (payload.voice && payload.voice.error) setVoiceStatus(payload.voice.error); else if (useVoice) setVoiceStatus("Listening when you are ready");
    } catch (error) { var message = error && error.message ? error.message : "The shopping assistant is temporarily unavailable."; connection.textContent = "Temporarily unavailable"; addMessage(message, "assistant"); if (useVoice) setVoiceStatus(message); }
    finally { submit.disabled = false; input.focus(); }
  }

  launcher.addEventListener("click", function () { setOpen(panel.hidden); });
  close.addEventListener("click", function () { setOpen(false); });
  voiceToggle.addEventListener("click", toggleVoiceMode);
  textToggle.addEventListener("click", showTextChat);
  micButton.addEventListener("click", function () { if (recorder) stopRecording(); else startRecording(); });
  salespersonSelect.addEventListener("change", function () { ensureVoiceSession(true).then(function (view) { setVoiceStatus("Ready with " + view.salesperson.displayName); }).catch(function (error) { setVoiceStatus(error && error.message ? error.message : "That salesperson is unavailable."); }); });
  languageSelect.addEventListener("change", function () { if (voiceMode && speechRecognition) { stopSpeechRecognition(); startSpeechRecognition(); } ensureVoiceSession(false).catch(function (error) { setVoiceStatus(error && error.message ? error.message : "That language is unavailable."); }); });
  if (root.dataset.agentflowDevStatus === "true") connection.hidden = false;
  form.addEventListener("submit", function (event) { event.preventDefault(); sendMessage(input.value.trim(), "text"); });
})();
