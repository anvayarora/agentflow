(function () {
  var root = document.getElementById("agentflow-storefront-assistant");
  if (!root || root.dataset.agentflowReady === "true") return;
  root.dataset.agentflowReady = "true";

  var proxyPath = root.dataset.agentflowProxyPath || "/apps/agentflow/chat";
  var sessionKey = "agentflow.shopify.session";
  var sessionId = null;
  try { sessionId = window.sessionStorage.getItem(sessionKey); } catch { /* session storage may be unavailable */ }

  root.innerHTML = [
    '<button class="agentflow-launcher" type="button" aria-expanded="false" aria-controls="agentflow-panel"><span class="agentflow-launcher-mark">A</span><span>Ask AgentFlow</span></button>',
    '<section class="agentflow-panel" id="agentflow-panel" hidden aria-label="AgentFlow storefront assistant"><header class="agentflow-panel-header"><div><strong>Haven Home</strong><span>Shopping guidance, connected to the store</span></div><button class="agentflow-close" type="button" aria-label="Close assistant">×</button></header><div class="agentflow-messages" aria-live="polite"><div class="agentflow-message agentflow-message-assistant">Tell me what you are looking for and I will help you explore the catalogue.</div></div><div class="agentflow-connection" hidden>Development connection: checking…</div><form class="agentflow-form"><label class="agentflow-sr-only" for="agentflow-input">Message</label><input id="agentflow-input" maxlength="2000" placeholder="Ask about the catalogue…" autocomplete="off"/><button type="submit" aria-label="Send message">↑</button></form></section>'
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
    return { pageType: pageType, hintedProductId: root.dataset.agentflowProductId || undefined, url: window.location.href };
  }

  function endpoint(name) { return proxyPath.replace(/\/chat$/, "/" + name); }
  function addAction(label, handler) {
    var action = document.createElement("button");
    action.type = "button";
    action.className = "agentflow-action";
    action.textContent = label;
    action.addEventListener("click", handler);
    messages.appendChild(action);
    messages.scrollTop = messages.scrollHeight;
    return action;
  }
  async function createCheckout() {
    var response = await fetch(endpoint("checkout"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId, idempotencyKey: "shopify-" + sessionId }) });
    var payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Checkout could not be created.");
    return payload;
  }
  function loadRazorpay() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) return resolve();
      var script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = function () { reject(new Error("Payment checkout could not be loaded.")); };
      document.head.appendChild(script);
    });
  }
  async function launchCheckout(details) {
    if (!details || details.provider !== "razorpay" || !details.publicKeyId) throw new Error("Razorpay test checkout is not configured.");
    await loadRazorpay();
    return new Promise(function (resolve, reject) {
      var options = {
        key: details.publicKeyId,
        amount: details.amountPaise,
        currency: details.currency,
        name: "Haven Home",
        description: "AgentFlow authorized checkout",
        order_id: details.providerOrderId,
        handler: async function (response) {
          try {
            var verifyResponse = await fetch(endpoint("payments/verify"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId, transactionId: details.transactionId, orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }) });
            var verified = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verified.error || "Payment verification failed.");
            addMessage("Payment verified. Your order is confirmed.", "assistant");
            resolve(verified);
          } catch (error) { addMessage(error && error.message ? error.message : "Payment verification failed.", "assistant"); reject(error); }
        },
        modal: { ondismiss: function () { reject(new Error("Payment was not completed.")); } },
        theme: { color: "#111827" }
      };
      var checkout = new window.Razorpay(options);
      checkout.on("payment.failed", function () { reject(new Error("Payment was not completed.")); });
      checkout.open();
    });
  }

  function offerAction(offer) {
    if (!offer || !sessionId || !offer.offerId || offer.status !== "OFFERED") return;
    var action = addAction(offer.outcome === "ALLOW" ? "Continue to secure payment" : "Offer requires merchant review", async function () {
      action.disabled = true;
      try {
        if (offer.outcome !== "ALLOW") throw new Error("This offer needs merchant approval before payment.");
        var acceptedResponse = await fetch(endpoint("offers/accept"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ offerId: offer.offerId }) });
        var accepted = await acceptedResponse.json();
        if (!acceptedResponse.ok) throw new Error(accepted.error || "Offer could not be accepted.");
        var checkout = await createCheckout();
        addAction("Pay with Razorpay test checkout", function () { launchCheckout(checkout).catch(function (error) { addMessage(error && error.message ? error.message : "Payment was not completed.", "assistant"); }); });
      } catch (error) { addMessage(error && error.message ? error.message : "The offer could not be prepared for payment.", "assistant"); action.disabled = false; }
    });
  }

  launcher.addEventListener("click", function () { setOpen(panel.hidden); });
  close.addEventListener("click", function () { setOpen(false); });
  if (root.dataset.agentflowDevStatus === "true") connection.hidden = false;

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message) return;
    input.value = "";
    addMessage(message, "customer");
    var submit = form.querySelector("button");
    submit.disabled = true;
    connection.textContent = "Development connection: contacting AgentFlow…";
    connection.hidden = root.dataset.agentflowDevStatus !== "true";
    try {
      var response = await fetch(proxyPath, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId: sessionId || undefined, message: message, storefrontContext: pageContext() }) });
      var payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The storefront assistant is unavailable.");
      sessionId = payload.sessionId || sessionId;
      if (sessionId) try { window.sessionStorage.setItem(sessionKey, sessionId); } catch { /* session storage may be unavailable */ }
      connection.textContent = "Development connection: " + (payload.status || "connected");
      addMessage(payload.message || "AgentFlow received your request.", "assistant");
      offerAction(payload.offer);
      if (payload.checkout && payload.checkout.provider === "razorpay") addAction("Pay with Razorpay test checkout", function () { launchCheckout(payload.checkout).catch(function (error) { addMessage(error && error.message ? error.message : "Payment was not completed.", "assistant"); }); });
    } catch (error) {
      connection.textContent = "Development connection: unavailable";
      addMessage(error && error.message ? error.message : "The storefront assistant is unavailable.", "assistant");
    } finally { submit.disabled = false; input.focus(); }
  });
})();
