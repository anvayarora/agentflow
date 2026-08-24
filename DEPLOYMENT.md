# AgentFlow deployment

## Architecture

```text
Private GitHub repository
        ↓
Vercel Preview
        ↓
AgentFlow server + React surfaces
        ↓
PostgreSQL (DATABASE_URL)
```

## Environments

- Local: `npm run dev`; without `DATABASE_URL`, a deterministic seeded memory repository keeps the demo usable.
- Preview: Vercel Node runtime with PostgreSQL environment variables configured. The deployment must run the migration and seed process against the selected database before testing.
- Production: intentionally gated until red-team and E2E verification pass.

## Environment variable names

Names only; values belong in the deployment secret store.

```text
DATABASE_URL
AGENTFLOW_DEMO_ORGANIZATION_ID
AGENTFLOW_DEMO_CUSTOMER_ID
NIM_API_KEY
NIM_MODEL_ID
NIM_BASE_URL
SHOPIFY_STORE_DOMAIN
SHOPIFY_API_VERSION
SHOPIFY_STOREFRONT_ACCESS_TOKEN
SHOPIFY_ADMIN_ACCESS_TOKEN
PAYMENT_PROVIDER
CATALOG_PROVIDER
LLM_PROVIDER
DEMO_MODE
```

## Deployment process

1. Install from the committed lockfile.
2. Run `npm run db:generate` only when the schema changes; commit the resulting migration.
3. Run `npm run db:migrate` and `npm run db:seed` against the Preview PostgreSQL database.
4. Run `npm run build`, `npm run lint`, and `npm run test:backend`.
5. Push the reviewed commit to `main` in the private GitHub repository.
6. Verify the Vercel Preview, browser console, failed network calls, and runtime logs.
7. Keep Production promotion gated behind the release checks.

## Preview verification

Check `/`, `/merchant`, `/merchant/onboarding`, `/merchant/workflow`, `/merchant/connectors`, `/customer`, `/api/catalogue/products`, and `/api/commerce/evaluate`.

The customer request must contain only a session, product, quantity, and proposed price/discount. Confirm that the response carries a published policy version, matched rules, evidence, and one of `ALLOW`, `COUNTER`, `ESCALATE`, or `DENY`.

## Rollback procedure

Keep published policy versions immutable. Roll back an application release through Vercel's deployment history, and roll back policy authority by publishing the last verified policy version. Do not rewrite historical audit or transaction references.

## Current integrations

- Catalogue: canonical Haven Home demo seed in the server repository; PostgreSQL when configured; Shopify sync remains an existing optional connector surface and is not required for this P0 backend.
- Payments: mock/test presentation only; no live payment action is wired by this task.
- LLM: NVIDIA NIM may propose Policy IR drafts when `NIM_API_KEY` is present; deterministic compiler fallback otherwise.
- Shopify: not part of this backend task.
- WooCommerce: not connected.
