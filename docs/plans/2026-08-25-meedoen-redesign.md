# /meedoen/ redesign

## Scope

Volledige redesign van uitsluitend de content en read-only functionaliteit van `/meedoen/`. Shared `Navbar`, `StickyRaceBar`, `Footer`, app-shell en andere pagina's blijven functioneel en visueel ongewijzigd.

## Git en herstelpunt

- Worktree: `/home/hermes/projects/3sm-league-meedoen-redesign`
- Branch: `feat/meedoen-redesign-20260825`
- Startcommit: `8a278f194b63c94c1245e6e4f46d560a47eecd47`
- Basis: actuele `origin/main` op 25 augustus 2026
- De bestaande checkout `/home/hermes/projects/3sm-league` bevat unrelated Endurance/SimHub-wijzigingen en wordt niet gewijzigd, gereset of gestasht.

## Inspectiebevindingen

### Huidige pagina

- Route: `src/App.tsx`, `/meedoen` naar lazy-loaded `src/pages/JoinPage.tsx`.
- `JoinPage.tsx` is 579 regels en bevat vrijwel alle content, visuals, metadata en FAQ lokaal.
- Page-specific: `CircuitArtwork` en alle lokale contentarrays.
- Shared: `Navbar`, `StickyRaceBar`, `Footer`, providers en globale Tailwind/CSS tokens.
- De redesign gebruikt page-specific componenten en Tailwind-classes. Geen globale CSS-wijziging tenzij aantoonbaar noodzakelijk.

### Databronnen

- Eerstvolgende race: `public.races` met relationele `leagues(name, car_class, season)`.
- Laatste race: `public.races`, status `completed`.
- Podium: `public.race_results`, publieke naamprojectie uit `public.public_profiles` met `iracing_name` als eerste keuze.
- Inschrijvingen: `public.race_registrations` plus `public.season_registrations`, gededupliceerd op `user_id`; status `withdrawn` telt niet mee.
- Activity facts: afgeronde races en unieke circuits uit echte completed-racegegevens.
- Trackmaps: gedeelde `TrackMap`, eerst lokale layered SVG-runtime, daarna bestaande `trackData`-map, daarna een rustige page-specific fallback.
- Alle queries zijn read-only. De redesign roept geen registratie- of andere mutaties aan.

### Actuele data tijdens nulmeting

- Eerstvolgende race: Race 12, Circuit de Spa-Francorchamps, GT3.
- Unieke inschrijvingen: 9. De teller moet dus verborgen blijven door de grens van minimaal 10.
- Laatste race met uitslag: Race 11, Circuit de Lédenon.
- Podium kon via publieke racedata en `public_profiles` worden opgebouwd.
- Afgeronde races: 38.

### Taalmodel

- Eén bestaande route, `/meedoen/`.
- Taalkeuze wordt opgeslagen als `3sm-language`.
- `LanguageProvider` vertaalt bestaande DOM-tekst via een MutationObserver.
- De redesign gebruikt page-local, getypte NL/EN-copy vanaf de eerste implementatie. Dynamische waarden en natuurlijke Engelse tekst worden niet achteraf door woord-voor-woordvertaling samengesteld.

### SEO en dubbele content

- Runtime metadata staat in `JoinPage.tsx`.
- Crawler metadata en route-HTML staan in `scripts/generate-route-html.mjs`.
- Live canonical: `https://3stripemotorsport.cc/meedoen/`.
- Search Console op 25 augustus 2026: submitted and indexed, indexing allowed, fetch successful, Google canonical gelijk aan user canonical.
- Meetperiode 25 juli tot en met 22 augustus 2026: 93 impressies, 6 klikken, gemiddelde positie 10,30.
- Zichtbare zoekintentie bevat onder andere `dutch league racing`, `iracing community` en `racing community`; privacydrempels verbergen vermoedelijk een deel van de klikqueries.
- Dubbelingsoorzaak: `generate-route-html.mjs` injecteert routecopy zowel in een verborgen blok vóór `#root` als in `<noscript>`. React rendert daarna dezelfde bezoekerscopy in `#root`, terwijl het verborgen blok blijft staan.
- Page-specific oplossing: `/meedoen/` krijgt één semantische, zichtbare no-JS/root-fallback die React bij mount vervangt. Geen verborgen tweede copy en geen dubbele noscript-copy. FAQ JSON-LD moet exact overeenkomen met de zichtbare FAQ.

## Implementatierichting

1. Page-local copycontract met natuurlijke NL- en EN-copy, metadata en FAQ.
2. Page-local read-only datahook met afzonderlijke loading/error/empty states.
3. Hero met 3SM-identiteit, technische racevisual en rustige motion.
4. Trust-strip zonder generieke badgewand.
5. Live activity-compositie met volgende race, registration-threshold, laatste race, podium en echte activity facts.
6. Concrete community/league-uitleg, solo/eigen team-positionering en eenvoudige deelnameflow.
7. Compacte klasse/endurance-statussectie zonder deadlines of onvoltooide functies als live te presenteren.
8. Toegankelijke FAQ-accordion en afsluitende Discord/kalender-CTA.
9. Motion respecteert `prefers-reduced-motion` via Framer Motion `useReducedMotion` en CSS media fallback.
10. Alleen `/meedoen/` crawlerfallback en schema aanpassen; geen globale route-redesign.

## Verificatiegate voor visuele review

- NL en EN in echte browser.
- 320, 375, 390, 430, 768, 1024, 1440 en 1920 px.
- Eerstvolgende race, laatste race, podium en trackmap.
- Inschrijvingsteller bij 9 verborgen; helpertests voor 9 en 10.
- Loading, lege data, gedeeltelijke queryfout en trackfallback.
- Keyboard/focus, accordion, contrast en reduced motion.
- Raw crawler-HTML: één H1, één inhoudsbron, canonical, metadata, internal links en FAQ schema gelijk aan zichtbare FAQ.
- Homepage, calendar, results, standings en news regressiesmoke.
- Volledige tests, typecheck, lint, productiebuild en `git diff --check`.
- Geen push, merge of deploy voordat Vincent de production-ready DEV-versie visueel goedkeurt.

## Rollback

Tijdens development:

```bash
git worktree remove /home/hermes/projects/3sm-league-meedoen-redesign
git branch -D feat/meedoen-redesign-20260825
```

Na eventuele latere merge worden de exacte redesigncommits en gerichte revertcommando's bij de review-handoff vastgelegd. Unrelated wijzigingen mogen nooit onderdeel van rollback zijn.
