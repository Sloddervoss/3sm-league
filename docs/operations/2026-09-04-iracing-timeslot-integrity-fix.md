# 3SM iRacing Timeslot Integrity Fix — Nürburgring EC combined-series slots

Status: PASS — officiële sloten renderen 1× | Datum: 2026-09-04

## Root cause (bewezen)

Het **Nürburgring Endurance Championship combined-event** (`iracing:2026:nurburgring-endurance-championship`)
toonde "16 officiële tijdsloten" voor de 10 okt-week terwijl die week maar 8 unieke slots heeft.

Oorzaak: **twee source_slot_key-formatten naast elkaar op hetzelfde event**:

| formaat | voorbeeld | label | first_seen | bron |
|---|---|---|---|---|
| Oud (ISo) | `...:2026-10-10T07:00:00.000Z` | — (leeg) | 2026-09-01+ | oude special-events-loop (`normalizeSpecialEvent`, key `<sourceKey>:<sessionStartAt>`) |
| **Canoniek (week)** | `...:week8:20261010070000` | "10 oktober 2026" | 2026-08-15 | huidige `discoverCombinedSeriesEvent` |

Beide verwijzen naar dezelfde officiële `session_start_at`, maar de UNIQUE `(catalog_event_id, source_slot_key)`
läte ze als aparte rijen bestaan (keys verschillen). Resultaat: **80 slots voor 40 unieke starts** = elke officiële
slot exact 2×. Het UI "Alle tijdsloten" count is de rauwe `active` count → 80 in plaats van 40.

**Classificatie: TRUE_DUPLICATE (DB) — systematisch, enkel het Nürburgring combined-event.**
Geen frontend/join/timezone-probleem; geen DB-appends in de importer; de importer is idempotent op source_slot_key.

## Was dit gerelateerd aan de recente bucket-repair?

**NO.** Commit `751a870` (bucket-wrap in special-events-loop) *stopt* de aanmaak van nieuwe ISO-orphans
(het skipt kind=series), maar de bestaande 40 ISO-orphan-rijen (uit eerdere syncs vóór die fix) bleven actief.
De duplicate lag dus **historisch** in de data; de bucket-fix maakte het niet erger en kon het niet wissen.

## Repair

- **Data-fix (veilig, geen delete)**: `active=false` op de 40 ISO-orphan-slot-rijen op het Nürburgring-event
  (`source_slot_key` zonder `:weekN:`, die exact dezelfde `session_start` als de canonieke week-rij), zodat
  de UI canoniek 40 i.p.v. 80 toont. Rijen blijven behouden (rollback-ondersteund).
- **Geen importer-code-wijziging nodig**: de bron maakt al alleen week-format canonieke slots en skipt
  kind=series in de special-loop (751a870). Sync #1 en #2 re-activeerden de orphans niet (slots_inserted=0).
- UNIQUE `(catalog_event_id, source_slot_key)` ongewijzigd — is al correct; het probleem was twee key-vormen,
  geen ontbrak bhree UNIQUE.

## Verificatie

- Back-up: `/opt/supabase/backups/pre-timeslot-20260904-timeslot.sql` (sha `ef3a35f4…`, off-host op 3sm-docker).
- Vóór: 80 actief (40 week + 40 ISO) | Na: **40 actief (40 week + 0 ISO)**.
- Sync #1: slots_inserted=0 | Sync #2: slots_inserted=0 — count stabiel op 40, 0 actieve orphans over alle events.
- All 40 orphans: `linked_races=0` EN `interest_rows=0` → geen activatie/interesse-referenties verloren.
- Tests: slot-identity 4/4, iRacing-suite 92/93 (1 voormals-test-gefix), volledige suite 716/720
  (4 = bekende pre-bestaande endurance-capability-tests, ongerelateerd), tsc/build/lint clean.
- SimHub/telemetrie/manifests onaangetast (default 0.4.0.0, canary 0.4.1.0).

## Kanonieke slot-identiteit

- Vóór: `source_slot_key` (twee formaten coexistent voor combined-series) | Na: uitsluitend **week-formaat**
  `...:<serie>:week<N>:<YYYYMMDDHHMMSS>` (gelabeld).
- Definitie in `normalize.ts` combined-pad (lijn 556) — gezaghebbend.
- Test-borging: `src/test/iracingCombinedSeriesSlotIdentity.test.ts`.