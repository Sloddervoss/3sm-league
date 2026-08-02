# Community Support Platform Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to continue this plan task-by-task.

**Goal:** Build a premium, transparent 3SM Community Support page with management in the existing Control Room, without turning the main site into a donation shop.

**Architecture:** `/support/` and its footer link are controlled by `community-support.config.json`. While `public` is false, admins and Super-admins can review the page and both crawler HTML and sitemap treat it as private/noindex. Public builds fail closed until `dataSource` is backed by the shared Supabase readmodel; after that backend phase, the `public` flag releases UI, footer, crawler HTML and sitemap together. Management is an admin-only native module inside the existing `/admin/` Control Room, available to both `admin` and `super_admin`. Phase 1 uses schema-validated, user-scoped session storage that is removed on logout/user switch.

**Tech Stack:** React, TypeScript, Tailwind CSS, React Router, Supabase Auth roles, Vitest, Vite route HTML generator.

---

## Fixed product decisions

- Public name and route: **Community Support**, `/support/`.
- Discovery: subtle footer link only; never a main-menu item.
- Current access: admin and Super-admin only, but no preview/test naming in routes or components.
- Public release: first replace the local-session datasource with the audited Supabase readmodel; after that, changing `"public": false` to `true` releases UI, footer link, crawler HTML and sitemap together. A build fails if `public=true` while the datasource is still local.
- Management: native `/admin/` Control Room module, visible to `admin` and `super_admin` and permanently protected from all other roles.
- Languages: Dutch and English; mobile and desktop are equal acceptance targets.
- Monthly costs derive dynamically from manual entries and recurring entries. A recurring entry is explicitly monthly or yearly; yearly entries occur once per year in their configured start month.
- Race costs are dedicated records linked read-only to an existing race; they are never duplicated as manual ledger entries.
- Local-session review initialization idempotently adds every missing eligible completed race at one hosted hour × $0.50, without writing to Supabase.
- The final result-import confirmation includes hosted hours, the optional 25% discount and a live USD/EUR preview. After a successful result write, it create-only initializes a missing race-cost record for the same `race_id`; a result re-import shows and preserves any existing hours, discount, USD source amount, exchange-rate snapshot and EUR amount.
- Hosting source prices derive centrally from whole hosted hours × $0.50, with an optional 25% discount. Each new race snapshots the then-configured USD/EUR rate and stores the resulting rounded EUR amount; later rate changes apply only to future race records and never rewrite existing entries.
- The Control Room supports individual race corrections and one bulk hours/discount update for every recorded race in a selected season; standalone races remain individually editable. Only this explicit Race Costs correction flow may update an existing cost, and it preserves the stored exchange rate.
- Supported race formats are Feature and Sprint. Legacy untyped races are accepted only when they are standalone; unknown formats and any endurance signal in format, league or race name fail closed.
- Each race has at most one strictly positive rounded EUR cost record. EUR amounts are the only values included in income, expense and reserve totals. Public details may additionally expose hosted hours, discount, original USD amount and the stored rate, but omit internal IDs, notes, league IDs and format metadata.
- Coverage uses contributions + net merchandise proceeds + referral income. Merchandise fees, purchasing and shipping are deducted before support coverage.
- Reserve is displayed separately and does not fill the monthly progress bar.
- Public ledger shows only explicitly public rows; invoices and private details never reach the public model.
- Supporter public name is self-entered; name and amount visibility are separate choices. No supporter messages.
- PayPal starts with a PayPal.Me handoff from a 3SM-owned amount/privacy modal. PayPal opens externally in a new tab or app; it is never embedded or presented as verified Checkout.
- Opening PayPal.Me is only intent. The visitor must separately choose **Ik heb betaald** before a pending payment check is created.
- Exactly one configurable payment admin receives the private Discord bot DM. Only that Discord user may resolve it after manually checking PayPal.
- Confirmation records gross contribution and actual PayPal fee separately and idempotently; pending, not-found and expired claims never affect financial totals.
- iRacing referral is a simple configurable public link, independent from PayPal claims or Discord DMs, and stays hidden until enabled with a valid official iRacing URL. Actually received credit is booked manually as referral income.
- Concept merchandise is visible only while the public flag is false; public release hides concept products.
- Products use up to four uploaded JPEG/PNG/WebP photos rather than externally entered image URLs. During local-session review the browser resizes these photos and stores them only in the active admin session; a later shared datasource must move the binaries to audited object storage.

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
- Monthly recurring costs apply from their start month; yearly costs apply once per year in the start month.
- Private ledger rows never reach the public selector.
- Management always requires `admin` or `super_admin`; editor, steward and ordinary member roles remain denied.

### Task 2: Public support page

**Files:**
- Create: `src/features/community-support/public/CommunitySupportPage.tsx`

**Acceptance:**
- Premium dark/orange 3SM presentation.
- Hero, monthly status, coverage bar, ways to support, spending categories, public ledger and supporter wall.
- Honest empty states with no invented amounts or supporters.
- PayPal CTA exists only when enabled.
- iRacing referral appears as a compact secondary link below the support options only when configured; otherwise it is absent.
- Concept products disappear automatically when public access is enabled.
- NL/EN metadata and visible copy.

### Task 3: Separate support management

**Files:**
- Create: `src/features/control-room/support/CommunitySupportModule.tsx`

**Acceptance:**
- Add/remove ledger rows.
- Add/toggle/remove recurring costs.
- Add/toggle/remove products and concept state, including up to four locally uploaded photos with preview/removal.
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
npx tsc -p tsconfig.app.json --noEmit --pretty false
npx eslint . --quiet
npm run build
git diff --check
```

**Browser checks:**
- Anonymous `/support/` receives the gated login state.
- Editor, steward, ordinary member and anonymous users cannot view the gated support page or the Control Room support module.
- Both `admin` and `super_admin` can add data in the `/admin/` Community Support module and immediately see it on `/support/`.
- NL/EN changes visible copy and metadata.
- Mobile layout has no horizontal clipping.
- Footer link is visible to `admin` and `super_admin` while `public=false`.
- Browser console has zero errors.

**Remote access:** Run Vite from this isolated worktree and expose it through a temporary `trycloudflare.com` tunnel. The app's normal password login plus an `admin` or `super_admin` role remain the authorization boundary. Do not push or deploy.

## Later production phases — not authorized yet

1. Replace local browser store with Supabase tables, public aggregate views, private invoice Storage and audited RLS.
2. Apply and audit the prepared PayPal.Me intent migration, release the bot DM handler backend-first, configure the real PayPal.Me destination/admin Discord ID, and only then switch the shared datasource flag. No real DM or payment is part of local review.
3. Optionally replace the manual PayPal.Me verification flow with server-side PayPal Checkout, idempotent capture and verified webhooks; never trust a browser success redirect as payment evidence.
4. Add merchandise orders, automatic stock reservation, refunds, fulfillment and NL/BE shipping.
5. Complete legal, fiscal, privacy, returns and PayPal-account checks before accepting real money.
6. Configure and enable the approved iRacing referral link; verify the compact NL/EN public block and manually book only credit actually received.

## Release boundary

No Git push, database migration, bot restart, real Discord DM, PayPal transaction or production deploy without Vincent's explicit approval. Phase 1 remains in `feat/community-support-platform` until remote review is accepted. The checked-in configuration remains fail-closed on `public=false` and `dataSource=local-session`.
