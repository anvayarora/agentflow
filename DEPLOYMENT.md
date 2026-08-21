# AgentFlow deployment

## Architecture

```text
Private GitHub repository
        ↓
Vercel Preview
        ↓
AgentFlow demo
```

The current application is a client-rendered TypeScript/React prototype with a deterministic policy evaluator and seeded Haven Home commerce data. No provider secret is required for the demo build.

## Environments

- Local: `npm run dev`
- Preview: Git-connected Vercel deployment from `main` or a feature branch
- Production: intentionally not promoted until red-team and E2E verification pass

## Environment variable names

No application environment variables are required by the current demo build. Future provider-backed environments should add names to `.env.example` before configuring Vercel.

## Deployment process

1. Run the local checks and production build.
2. Confirm the secret scan is clean and inspect staged files.
3. Commit to `main` in the private GitHub repository.
4. Let the Git-connected Vercel project create a Preview deployment.
5. Verify `/`, the merchant workspace, the policy surface, and `/store`.
6. Keep Production promotion gated behind red-team and E2E verification.

## Preview verification

Smoke test the landing page, demo launch, merchant dashboard, seeded catalogue, policy canvas, storefront chat, a normal negotiation, and the absence of unexpected payment requests. Also inspect browser console errors, failed network requests, Vercel build output, and runtime logs.

## Rollback procedure

Use Vercel's deployment history to promote the last verified Preview to Production after the release gate is approved. If a Production deployment is ever unhealthy, roll back to the previous verified deployment without changing source history.

## Current integrations

- Catalogue: Demo / seeded Haven Home data with CSV/XLSX upload UI
- Payments: Mock / Razorpay Test Mode presentation only; no live payment credentials
- LLM: Mock / deterministic local demo flow; no NVIDIA NIM credential configured
- Shopify: not connected
- WooCommerce: not connected
