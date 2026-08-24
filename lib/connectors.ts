export const shopifyPreviewStore = {
  name: "Haven Home",
  url: "https://haven-home-k1gerlw9.myshopify.com",
  status: "UCP development store",
  detail: "Live Shopify development storefront · AgentFlow app embed target.",
};

export const connectorCatalog = [
  { name: "Shopify", label: "Storefront + catalogue", status: "Preview linked", tone: "neutral", icon: "S" },
  { name: "Payment rail", label: "Test environment", status: "Ready", tone: "success", icon: "↗" },
  { name: "AI model", label: "Policy-aware assistant", status: "Demo mode", tone: "neutral", icon: "✦" },
  { name: "File import", label: "CSV or XLSX catalogue", status: "Connected", tone: "success", icon: "▦" },
] as const;
