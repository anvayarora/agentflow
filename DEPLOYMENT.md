# AgentFlow deployment

## Architecture

```text
Private GitHub repository
        ↓
Vercel Preview
        ↓
AgentFlow demo
```

The current application is a TypeScript/React commerce control plane with separate merchant and customer routes, a deterministic policy evaluator, a secure server-side connector boundary, and a seeded Haven Home fallback catalogue. Vercel builds use the documented `vinext` + Nitro adapter; local/Sites builds retain the existing Cloudflare adapter. Secrets are read only by server routes and are never bundled into client code.

## Environments

- Local: `npm run dev`
- Preview: the GitHub repository is linked to the Vercel project `agentflow-buildathon`; the current Vercel team role returns 403 when creating a deployment from `main`, so hosted Preview generation remains a release blocker
- Production: intentionally not promoted until red-team and E2E verification pass

## Environment variable names

Configure the names in `.env.example` through the deployment secret store. Never commit values. NIM and Shopify are optional; the safe deterministic compiler and preview catalogue remain available when live credentials are absent.

## Deployment process

1. Run the local checks and production build.
2. Confirm the secret scan is clean and inspect staged files.
3. Push the reviewed source to `main` in the private GitHub repository.
4. Once the Vercel team role is corrected, the GitHub link will deploy the updated `main`; keep Production promotion gated behind the release checks.
5. Verify `/`, `/merchant`, `/merchant/onboarding`, `/merchant/workflow`, `/merchant/connectors`, and `/customer`.
6. Keep Production promotion gated behind red-team and E2E verification.

## Preview verification

Smoke test the landing page, separate merchant dashboard, guided onboarding compiler, discrepancy review, editable workflow, connector status, customer storefront, chat, a custom negotiation, and the absence of unexpected live payment requests. Also inspect browser console errors, failed network requests, Vercel build output, and runtime logs.

## Rollback procedure

Use Vercel's deployment history to promote the last verified Preview to Production after the release gate is approved. If a Production deployment is ever unhealthy, roll back to the previous verified deployment without changing source history.

## Current integrations

- Catalogue: server-side Shopify development-store sync through `/api/connectors/shopify/catalog` when a Storefront or Admin token is configured; seeded Haven Home fallback otherwise
- Payments: Mock / test adapter presentation only; no live payment credentials
- LLM: NVIDIA NIM server route when `NIM_API_KEY` is configured; deterministic compiler fallback otherwise. The key must be rotated and entered through the deployment secret store.
- Shopify: Haven Home development storefront connected for the customer preview
- WooCommerce: not connected
