export const shopifyPreviewStore = {
  name: "Haven Home Preview",
  url: "https://u2xwzd-kc.myshopify.com",
  status: "Connected · development store",
  detail: "The customer demo can read the connected catalogue or use a safe preview fallback.",
};

export const connectorCatalog = [
  { name: "Shopify", label: "Storefront + catalogue", status: "Preview linked", tone: "neutral", icon: "S" },
  { name: "Payment rail", label: "Test environment", status: "Ready", tone: "success", icon: "↗" },
  { name: "AI model", label: "Policy-aware assistant", status: "Demo mode", tone: "neutral", icon: "✦" },
  { name: "File import", label: "CSV or XLSX catalogue", status: "Connected", tone: "success", icon: "▦" },
] as const;
