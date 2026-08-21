# AgentFlow deployment

## Architecture

```text
Private GitHub repository
        ↓
Vercel Preview
        ↓
AgentFlow demo
```

The current application is a client-rendered TypeScript/React prototype with a deterministic policy evaluator and seeded Haven Home commerce data. Vercel builds use the documented `vinext` + Nitro adapter; local/Sites builds retain the existing Cloudflare adapter. No provider secret is required for the demo build.

## Environments

- Local: `npm run dev`
- Preview: Vercel deployment from the reviewed GitHub source; the verified Preview is currently created directly because the authenticated Vercel team scope does not permit deployment creation
- Production: intentionally not promoted until red-team and E2E verification pass

## Environment variable names

No application environment variables are required by the current demo build. Future provider-backed environments should add names to `.env.example` before configuring Vercel.

## Deployment process

1. Run the local checks and production build.
2. Confirm the secret scan is clean and inspect staged files.
3. Commit to `main` in the private GitHub repository.
4. Create a Preview deployment from the reviewed commit. Once the Vercel team role is corrected, enable the GitHub webhook so pushes to a feature branch create Previews automatically.
5. Verify `/`, the merchant workspace, the policy surface, and `/store`.
6. Keep Production promotion gated behind red-team and E2E verification.

## Preview verification

Smoke test the landing page, demo launch, merchant dashboard, seeded catalogue, policy canvas, storefront chat, a normal negotiation, and the absence of unexpected payment requests. Also inspect browser console errors, failed network requests, Vercel build output, and runtime logs. The current app exposes the demo through `/`; `/login`, `/app`, and `/store` are not separate route files yet.

## Rollback procedure

Use Vercel's deployment history to promote the last verified Preview to Production after the release gate is approved. If a Production deployment is ever unhealthy, roll back to the previous verified deployment without changing source history.

## Current integrations

- Catalogue: Demo / seeded Haven Home data with CSV/XLSX upload UI
- Payments: Mock / Razorpay Test Mode presentation only; no live payment credentials
- LLM: Mock / deterministic local demo flow; no NVIDIA NIM credential configured
- Shopify: not connected
- WooCommerce: not connected
