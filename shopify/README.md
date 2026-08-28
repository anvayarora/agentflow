# AgentFlow Shopify surface

This directory is the Shopify app and Theme App Extension source for the Haven Home development store.

The app requests the minimal product Admin API scopes needed for reviewed catalogue bootstrap. Inventory remains Shopify-owned by default. It uses:

- a Theme App Extension app embed for the customer-facing assistant;
- an App Proxy at `/apps/agentflow/*` for same-origin storefront requests;
- server-side UCP catalog and cart calls from AgentFlow.

The configured scopes are `read_products,write_products`. AgentFlow uses the current
Admin GraphQL `productSet` mutation for idempotent product/variant reconciliation.
It does not write absolute inventory quantities unless an explicit inventory-source
configuration and compare-and-set implementation are added.

The committed `shopify.app.toml.example` contains placeholders only. After Shopify CLI authentication, link the development app and copy the generated configuration to `shopify.app.toml` locally. Never commit client secrets or store passwords.

```text
npx --yes @shopify/cli@latest app init --name AgentFlow --template none --path shopify
npx --yes @shopify/cli@latest app generate extension --template theme --name agentflow-storefront --path shopify
npx --yes @shopify/cli@latest app dev --path shopify --store haven-home-k1gerlw9.myshopify.com
```

The app proxy URL must point to the deployed AgentFlow origin followed by `/api/shopify/proxy`. The Theme App Extension must be deployed and then enabled from the development store's Theme Editor. The app embed deep link is generated after Shopify assigns the app client ID.
