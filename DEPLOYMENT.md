# AgentFlow deployment

## Architecture

```text
Private GitHub repository
        ↓
Vercel Git integration
        ↓
AgentFlow server + React surfaces
        ↓
PostgreSQL (DATABASE_URL)
```

The current PostgreSQL service is Aiven `agentflow-postgres` on the free `free-1-1gb` plan in Bangalore (`do-blr`). Vercel Production and Preview use the encrypted `DATABASE_URL` secret for this service. The URI is never committed or documented here.

## Environments

- Local: `npm run dev`; without `DATABASE_URL`, a deterministic seeded memory repository keeps the demo usable.
- Preview: Vercel Node runtime with PostgreSQL environment variables configured. The deployment must run the migration and seed process against the selected database before testing.
- Production: the live `agentflow` Git integration currently auto-promotes pushes to `main` to its Production target. The current canonical alias is `https://agentflow-beige-eight.vercel.app`. Keep promotion gated operationally until red-team/E2E verification is complete.

## Environment variable names

Names only; values belong in the deployment secret store.

```text
DATABASE_URL
AGENTFLOW_DEMO_ORGANIZATION_ID
AGENTFLOW_DEMO_CUSTOMER_ID
NIM_API_KEY
NIM_MODEL_ID
NIM_BASE_URL
SARVAM_API_KEY
SARVAM_BASE_URL
SARVAM_STT_MODEL
SARVAM_TTS_MODEL
SARVAM_TIMEOUT_MS
SHOPIFY_STORE_DOMAIN
SHOPIFY_API_VERSION
SHOPIFY_STOREFRONT_ACCESS_TOKEN
SHOPIFY_ADMIN_ACCESS_TOKEN
SHOPIFY_API_SECRET
SHOPIFY_UCP_PROFILE_URL
AGENTFLOW_PUBLIC_URL
SHOPIFY_UCP_VERSION
SHOPIFY_APP_PROXY_PREFIX
SHOPIFY_APP_PROXY_SUBPATH
PAYMENT_PROVIDER
CATALOG_PROVIDER
LLM_PROVIDER
DEMO_MODE
MAX_OFFER_REQUESTS_PER_SESSION
OFFER_COOLDOWN_SECONDS
```

## Deployment process

1. Install from the committed lockfile.
2. Run `npm run db:generate` only when the schema changes; commit the resulting migration.
3. Run `npm run db:migrate` and `npm run db:seed` against the Aiven Preview PostgreSQL database.
4. Run `npm run build`, `npm run lint`, and `npm run test:backend`.
5. Push the reviewed commit to `main` in the private GitHub repository.
6. Verify the Vercel deployment target, browser console, failed network calls, and runtime logs.
7. Keep manual promotion commands out of the workflow until red-team/E2E checks pass; note that the current existing main-branch integration is already configured for Production.

## Preview verification

Check `/`, `/merchant`, `/merchant/onboarding`, `/merchant/storefront`, `/merchant/workflow`, `/merchant/growth`, `/merchant/approvals`, `/profiles/agentflow-ucp.json`, `/api/catalogue/products`, `/api/commerce/evaluate`, and `/api/shopify/ucp/diagnostics`.

Prompt 6 voice surfaces are `/api/salespeople`, `/api/merchant/salespeople/stats`,
`/api/voice/session`, `/api/voice/stt`, `/api/voice/tts`, `/api/voice/turn`, and
`/api/voice/status`. Sarvam credentials remain server-only; raw microphone audio is
processed for transcription and is not persisted by default. The normal test suite
uses provider mocks. Run the dedicated real-provider suite only with
`RUN_SARVAM_E2E=1` and an explicitly provisioned server credential.

For Store Bootstrap, use `POST /api/merchant/catalog/bootstrap` with a CSV/XLSX
to create a persisted review preview, then send `{ "importRunId": "…", "confirm": true }`
only after the merchant confirms the mapping. Shopify writes use the current Admin
GraphQL `productSet` mutation and are reconciled by SKU/handle. Shopify remains the
inventory source of truth by default, so imports do not overwrite quantities. To make
AgentFlow the inventory source of truth, set `AGENTFLOW_CATALOGUE_INVENTORY_SOURCE=agentflow`
and add the required inventory scopes; the service then requires a compare-and-set
inventory implementation before enabling absolute writes.

The signed storefront action surface is `/apps/agentflow/ui-action` (proxied to
`/api/shopify/proxy/ui-action`) and supports only schema-validated product view,
shortlist, compare, cart, offer, and checkout actions. Shopper preferences, page
context, conversation history, and shortlist IDs are persisted per shopping session.

The customer request must contain only a session, product, quantity, and proposed price/discount. Confirm that the response carries a published policy version, matched rules, evidence, and one of `ALLOW`, `COUNTER`, `ESCALATE`, or `DENY`.

## Rollback procedure

Keep published policy versions immutable. Roll back an application release through Vercel's deployment history, and roll back policy authority by publishing the last verified policy version. Do not rewrite historical audit or transaction references.

## Current integrations

- Catalogue: Shopify UCP is the buyer-facing source when verified; the canonical Haven Home seed remains the safe local fallback and private-cost join.
- Payments: existing server-authorized Test/mock path; no live payment mode.
- LLM: NVIDIA NIM proposes typed Policy IR drafts when `NIM_API_KEY` is present; Setup Copilot remains unavailable until the provider is configured.
- Storefront AI: NVIDIA Nemotron Ultra is the reasoning provider; the shopper agent
  has no provider fallback and receives compact public product projections only.
- Shopify: Haven Home development store target, UCP 2026-04-08 catalog/cart connector, signed App Proxy contract, and Theme App Extension source under `shopify/`.
- WooCommerce: not connected.

## Shopify storefront handoff

The customer surface is a Shopify Theme App Extension app embed. It calls `/apps/agentflow/chat`, which Shopify proxies to `/api/shopify/proxy/chat`. AgentFlow verifies the Shopify HMAC signature, binds the verified shop domain to the Haven Home organization, and derives customer context only from Shopify's signed `logged_in_customer_id`.

UCP calls are server-only and use the discovered merchant endpoint. Product and cart payloads are treated as commerce data, never as policy authority. Private cost and policy rules are not sent to the widget.

The committed `shopify/shopify.app.toml.example` is intentionally placeholder-only. One-time Shopify Partner actions remain: authenticate Shopify CLI, create/link the development app, fill the deployed AgentFlow URL, deploy the Theme App Extension, configure the App Proxy, and enable the app embed in the Haven Home Theme Editor. Do not commit the generated local `shopify.app.toml`, API secret, or storefront password.
