# 3SM iRacing Event Catalog Integrity Fix

Datum: 2026-09-04 | Status: LIVE in productie | Scope: Endurance catalogus-import

## Root cause

De Endurance/iRacing-catalogus toonde "duplicate events" voor series. Geen echte DB-duplicaten:
alle 89 `source_key`'s zijn uniek (UNIQUE `endurance_iracing_events_source_key_key`), en de
importer is idempotent (upsert `onConflict: "source_key"`).

Probleem: de special-events-importloop verwerkte óók `kind === "series"`-entries. Daardoor werd
de **serie-bucket-rij** (`iracing:2026:<slug>`, zonder weken) als actief geüpsert **naast** de
individuele **week-rijen** (`iracing:2026:<slug>:weekN:<circuit>`). Omdat beide een andere
`source_key` hebben, botst de UNIQUE niet en verschenen beide als losse kaart.

Voorbeeld: Production Endurance Challenge = 1 actieve bucket + 12 actieve week-rijen → 13 kaarten
voor één serie. Geldde voor elke niet-combined serie (Global Endurance Tour, Creventic, IMSA,
Michelin, GT Endurance by Simucube, Production Endurance Challenge).

Gerespecteerd: `combined: true` series (bv. Nürburgring EC) blijven één combined-event met
per-week child-slots — die buckets zijn correct en blijven actief.

## Reparatie

1. **Data (veilig)**: `active = false` op exact 7 overschaduwde buckets die een actieve week-set
   hebben (imsa-endurance-series, production-endurance-challenge, global-endurance-tour,
   creventic-endurance-series, imsa-sportscar-endurance-challenge, imsa-michelin-pilot-challenge,
   gt-endurance-series-by-simucube). **Geen verwijdering** — rijen blijven behouden
   (`active=false`); race/team/stint-links aan week-rijen onaangetast (verified: 0 race-koppelingen
   aan gedeactiveerde buckets).
2. **Importerfix** (`iracing-special-events-sync/index.ts`): special-events-loop skipt
   `entry.kind === "series"`; de series-loop doet die al (week-rijen niet-combined, één event
   combined). Bij her-sync worden buckets dus niet opnieuw actief gezet.
3. **UNIQUE/identity**: behouden op `source_key` — is al canoniek. Geen client-side fake-dedupe.

## Resultaat

- Actieve catalogus-rijen: **67 → 60** (7 standalone events + 53 week-rijen; 29 inactieve rijen
  behouden)
- Sync idempotent: run 1 = 55 seen/0 inserted/1 updated; run 2 = 55 seen/**0 inserted/0 updated**
- Na run 1: **0 actieve buckets met week-set** (fix houdt data-repair in stand)

## Tests / gates

- Catalogus+sync+UI suite: **84/84 PASS** (11 test-files), inclusief nieuwe test voor de
  series-bucket-skip
- Volledige suite: 708/712 (de 4 fails = bekende pre-bestaande endurance-capability-tests,
  ongerelateerd, faalden al vóór deze repair op main)
- tsc clean, build PASS, lint clean

## Notes

- Sync draait 2×/dag (`3sm-iracing-endurance-sync.timer` 08:00/20:00 Europe/Amsterdam), status
  bleef `partial` omdat de officiële kalenderpagina (WP 263677) HTTP 404 geeft — pre-bestaand,
  onafhankelijk van deze repair; events worden uit verstekmapping + Data-API gehaald.
- Backup: `/opt/supabase/backups/pre-catalog-repair-20260904-catalog-repair.sql`
  (off-host op 3sm-docker) + lokale kopie `/tmp/pre-catalog-repair-20260904-catalog-repair.sql`
  (sha `677f894e…`).
- SimHub/telemetrie-kanalen en -manifests onaangetast: default 0.4.0.0, canary 0.4.1.0.