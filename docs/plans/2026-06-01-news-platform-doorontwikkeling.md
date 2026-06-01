# Nieuwsmodule Doorontwikkeling Implementation Plan

> **For Hermes:** Implement lokaal met TDD; geen push, deploy of database-migratie op productie zonder expliciet akkoord.

**Goal:** Maak de publieke nieuwsomgeving van 3 Stripe Motorsport bruikbaar als professioneel motorsport-/simracingnieuwsplatform met zoeken, categorieën, auteurs, seizoenskoppeling en gerelateerde artikelen.

**Architecture:** Behoud Supabase `news_posts` als bron en breid die gecontroleerd uit met optionele season/view metadata. Centraliseer categorie-taxonomie en URL-slugs in een frontend utility zodat editor, overzicht, categoriepagina's en detailpagina's dezelfde labels/SEO gebruiken. Gebruik React Router voor deelbare routes: `/news`, `/news?category=reviews`, `/news/reviews`, `/news/reviews/artikel-slug`, en `/news/author/race-control`.

**Tech Stack:** React + Vite + TypeScript, React Router, TanStack Query, Supabase/Postgres migrations, Vitest source/regression tests.

---

## Route- en URL-keuze

- Categoriepagina's krijgen canonical path `/news/:categorySlug` omdat dat SEO-vriendelijker en leesbaarder is dan alleen query parameters.
- De overzichtspagina blijft `/news` en ondersteunt daarnaast `?category=reviews` voor filter-links/backwards compatibility.
- Artikellinks worden nieuw: `/news/:categorySlug/:slug`. De oude route `/news/:slug` blijft werken als fallback zodat bestaande links niet breken.
- Auteurs krijgen `/news/author/:authorSlug` met slug gebaseerd op `display_name || iracing_name || 3SM redactie`.

## Database-aanpak

1. Voeg optioneel toe aan `news_posts`:
   - `season_id UUID REFERENCES public.leagues(id) ON DELETE SET NULL`
   - `view_count INTEGER NOT NULL DEFAULT 0`
   - `last_viewed_at TIMESTAMPTZ`
2. Indexen:
   - `idx_news_posts_season_id`
   - `idx_news_posts_status_published_at`
   - `idx_news_posts_view_count`
3. Editor krijgt een season-select uit `leagues`, maar seizoen blijft optioneel zodat bestaand nieuws blijft werken.
4. Populair deze week gebruikt voorlopig `view_count` als basis; echte click/reactie-events kunnen later via een aparte analytics-tabel.

## Bite-sized implementation tasks

### Task 1: Add regression tests
- Modify `src/test/publicNewsWorkflow.test.ts`.
- Assert category taxonomy utility, filter/search UI, category routes, author route, category/detail SEO routes, related articles and migration fields.
- Run targeted Vitest and verify RED.

### Task 2: Add shared news taxonomy helpers
- Create `src/lib/newsTaxonomy.ts` with category definitions, slug helpers, route builders, search/filter helper and author slug helper.
- Reuse this in public pages and editor.

### Task 3: Extend Supabase metadata locally
- Create migration `supabase/migrations/20260601140000_news_platform_metadata.sql`.
- Update generated local `types.ts` for `season_id`, `view_count`, `last_viewed_at`.

### Task 4: Upgrade public news overview/category pages
- Modify `src/App.tsx` route order.
- Modify `src/pages/NewsPage.tsx` to support `/news/:categorySlug`, `?category=...`, `?q=...`, live search/filtering, category descriptions, popular section and professional card polish.

### Task 5: Upgrade article pages
- Modify `src/pages/NewsDetailPage.tsx` to support category-prefixed URLs, wider article layout, clickable categories/authors/seasons and related articles.

### Task 6: Add author pages
- Create `src/pages/NewsAuthorPage.tsx` showing author avatar/name/description fallback and all published articles by that author.

### Task 7: Add optional season linking to editor
- Modify `src/pages/NewsEditorPage.tsx` with `season_id`, leagues query and select in the article metadata area.
- Keep old articles valid without a season.

### Task 8: Verify
- Run targeted Vitest, full tests, lint and production build.
- Start/update local preview tunnel and provide the new link with `?mock=1` once ready.
