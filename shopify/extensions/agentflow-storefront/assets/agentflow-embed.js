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
    } catch (error) {
      connection.textContent = "Development connection: unavailable";
      addMessage(error && error.message ? error.message : "The storefront assistant is unavailable.", "assistant");
    } finally { submit.disabled = false; input.focus(); }
  });
})();
