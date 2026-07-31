# Community Support Platform Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to continue this plan task-by-task.

**Goal:** Build a premium, transparent 3SM Community Support page with management in the existing Control Room, without turning the main site into a donation shop.

**Architecture:** `/support/` and its footer link are controlled by `community-support.config.json`. While `public` is false, only Super-admins can view the page and both crawler HTML and sitemap treat it as private/noindex. Public builds fail closed until `dataSource` is backed by the shared Supabase readmodel; after that backend phase, the `public` flag releases UI, footer, crawler HTML and sitemap together. Management is a Super-admin-only native module inside the existing `/admin/` Control Room. Phase 1 uses schema-validated, user-scoped session storage that is removed on logout/user switch.

**Tech Stack:** React, TypeScript, Tailwind CSS, React Router, Supabase Auth roles, Vitest, Vite route HTML generator.

---

## Fixed product decisions

- Public name and route: **Community Support**, `/support/`.
- Discovery: subtle footer link only; never a main-menu item.
- Current access: Super-admin-only, but no preview/test naming in routes or components.
- Public release: first replace the local-session datasource with the audited Supabase readmodel; after that, changing `"public": false` to `true` releases UI, footer link, crawler HTML and sitemap together. A build fails if `public=true` while the datasource is still local.
- Management: native `/admin/` Control Room module, visible only to Super-admin and permanently protected.
- Languages: Dutch and English; mobile and desktop are equal acceptance targets.
- Monthly costs derive dynamically from manual and recurring entries.
- Race costs are dedicated records linked read-only to an existing race; they are never duplicated as manual ledger entries.
- Supported race formats are Feature and Sprint. Legacy untyped races are accepted only when they are standalone; unknown formats and any endurance signal in format, league or race name fail closed.
- Each race has at most one strictly positive rounded cost record. Public race-cost projections omit internal IDs, notes, league IDs and format metadata.
- Coverage uses contributions + net merchandise proceeds + referral income. Merchandise fees, purchasing and shipping are deducted before support coverage.
- Reserve is displayed separately and does not fill the monthly progress bar.
- Public ledger shows only explicitly public rows; invoices and private details never reach the public model.
- Supporter public name is self-entered; name and amount visibility are separate choices. No supporter messages.
- PayPal starts with one-time payments only, but production integration waits for a suitable Business/developer setup.
- iRacing referral stays hidden until a real link exists.
- Concept merchandise is visible only while the public flag is false; public release hides concept products.

## Phase 1: gated production-shaped frontend

### Task 1: Shared feature boundary and financial model

**Files:**
- Create: `community-support.config.json`
- Create: `src/features/community-support/types.ts`
- Create: `src/features/community-support/store.tsx`
- Create: `src/features/community-support/model.ts`
- Create: `src/features/community-support/CommunitySupportAccessGate.tsx`
- Test: `src/test/communitySupportModel.test.ts`

**Verification:**
- Net merchandise proceeds are calculated correctly.
- Reserve remains separate from monthly coverage.
- Recurring costs apply from their start month.
- Private ledger rows never reach the public selector.
- Management always requires Super-admin.

### Task 2: Public support page

**Files:**
- Create: `src/features/community-support/public/CommunitySupportPage.tsx`

**Acceptance:**
- Premium dark/orange 3SM presentation.
- Hero, monthly status, coverage bar, ways to support, spending categories, public ledger and supporter wall.
- Honest empty states with no invented amounts or supporters.
- PayPal CTA exists only when enabled.
- iRacing referral is absent.
- Concept products disappear automatically when public access is enabled.
- NL/EN metadata and visible copy.

### Task 3: Separate support management

**Files:**
- Create: `src/features/control-room/support/CommunitySupportModule.tsx`

**Acceptance:**
- Add/remove ledger rows.
- Add/toggle/remove recurring costs.
- Add/toggle/remove products and concept state.
- Configure reserve and supporter defaults.
- Working totals and navigation to `/support/`.
- No Control Room imports or routes.

### Task 4: Route, footer and SEO integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `scripts/route-classification.mjs`
- Modify: `scripts/generate-route-html.mjs`
- Modify: `tsconfig.app.json`
- Modify: `vite.config.ts`

**Acceptance:**
- `/support/` is a gated public-facing route; support management is mounted natively inside `/admin/`.
- Navbar has no support link.
- Footer uses the shared visibility rule.
- With `public=false`, `/support/` and `/admin/` generate noindex HTML and neither enters the sitemap.
- With `public=true` and `dataSource=local-session`, the build fails closed.
- With `public=true` after the shared Supabase datasource is implemented, `/support/` gets crawler HTML and sitemap inclusion while `/admin/` stays private.

### Task 5: Integrated verification and remote review

**Commands:**
```bash
npx vitest run src/test/communitySupportModel.test.ts
npm test
npx tsc --noEmit --pretty false
npm run lint -- --quiet
npm run build
git diff --check
```

**Browser checks:**
- Anonymous `/support/` receives the gated login state.
- Non-Super-admin cannot view the gated support page or the Control Room support module.
- Super-admin can add data in the `/admin/` Community Support module and immediately see it on `/support/`.
- NL/EN changes visible copy and metadata.
- Mobile layout has no horizontal clipping.
- Footer link is visible only to Super-admin while `public=false`.
- Browser console has zero errors.

**Remote access:** Run Vite from this isolated worktree and expose it through a temporary `trycloudflare.com` tunnel. The app's normal password login and Super-admin role remain the authorization boundary. Do not push or deploy.

## Later production phases — not authorized yet

1. Replace local browser store with Supabase tables, public aggregate views, private invoice Storage and audited RLS.
2. Add server-side one-time PayPal Checkout with idempotent webhook verification; never trust the browser success redirect as payment evidence.
3. Add merchandise orders, automatic stock reservation, refunds, fulfillment and NL/BE shipping.
4. Complete legal, fiscal, privacy, returns and PayPal-account checks before accepting real money.
5. Add the real iRacing referral card only when the approved link exists.

## Release boundary

No Git push or production deploy without Vincent's explicit approval. Phase 1 remains in `feat/community-support-platform` until remote review is accepted.
