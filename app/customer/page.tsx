import { redirect } from "next/navigation";

import { shopifyPreviewStore } from "../../lib/connectors";

/**
 * The shopper experience is owned by the connected Shopify storefront.
 * Keep this route as a compatibility bridge for old bookmarks, but never
 * render a second AgentFlow-hosted commerce surface here.
 */
export default function CustomerRedirect() {
  redirect(shopifyPreviewStore.url);
}
