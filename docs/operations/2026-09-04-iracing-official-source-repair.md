# 3SM iRacing Official Source Repair + Verified Mappings

Status: PASS — official source repaired; SOME car mappings still unverified | Datum: 2026-09-04

## 1. Oude dode bron (vervangen)

- **Oud**: `https://www.iracing.com/wp-json/wp/v2/pages/263677` — WP page-id API.
- **Reden falen**: retourneerde HTTP 404 (page-id verouderd/verplaatst). De importer liep daardoor
  elke sync als `partial` met `official_calendar: HTTP 404` en viel terug op de season_mapping-seeds.

## 2. Nieuwe stabiele officiële bron

- **Nieuw**: `https://www.iracing.com/special-events/` (officiële Special Events kalender, public HTML).
- HTTP 200, ~647 KB. De bestaande `discoverUpcomingSpecialEvents`-parser leest de `<h2>`-events +
  "Cars Competing"-secties uit deze HTML (bewezen: 15 upcoming events, incl. Suzuka, Britcar, Petit,
  Bathurst, 8 Hours of Indianapolis — met de juiste klassen en model-feature-slugs).
- Provenance: `source_payload.calendar_source_url` (i.p.v. dode `calendar_page_id`).

## 3. Bron-prioriteitsmodel

1. iRacing Data API — numerieke `car_id` gezaghebbend.
2. officiële event-sectie op `/special-events/` met model/klasse-lijst.
3. officiële season_mapping (geverifieerde localCarMap).
4. anders NOT VERIFIED (geen gok/via filenaam-gok).

## 4. Sync-resultaten (productie)

| run | status | events_seen | inserts | updates | slot_inserts | slot_updates | error_summary |
|---|---|---|---|---|---|---|---|
| #1 (na fix) | **success** | 54 | 0 | 0 | 0 | 212 | *(geen)* |
| #2 | **success** | 54 | 0 | 0 | 0 | 212 | *(geen)* |

- Oud (vóór fix): `partial` + `official_calendar: HTTP 404`. → **verbetering bevestigd**.
- Idempotentie #2: identiek aan #1, 0 inserts/updates → **idempotent PASS**.
- Actieve catalogus stabiel op **60**.

## 5. Suzuka-mapping (exact bewezen → toegepast)

- Exacte officiële roster via **Data API season 6618** (GT3 Class, class_id 2708): 11 officiële car-ids.
- Elke feature-slug in de DB-rij gemapt naar exacte lokale 3SM-whitelist-slug + lokaal class-id.
- `local_class_ids={GT3}`, `local_car_ids=11`, `cars[]` 11 items allemaal met `localCarId` +
  `officialClassId=2708`, **0 unmapped**, **11 unieke lokale slakken** (geen duplicaat).
- Slots: Suzuka heeft 0 actieve slots (date_only) → activatie vraagt nog slot-publicatie; dat is een
  aparte zaak buiten deze mapping-task. Mapping zelf is **READY** en guard-consistent (alle 11 in
  de GT3-whitelist).

## 6. Verdere blocked events (correct blocked)

- **Portimao**: officiële model-set bewezen (HPD ARX-01c, DBR9 GT1, Corvette C6.R, Ford GT GT2).
  Numerieke ids: DBR9=car 64 bewezen via Data API; de andere drie hebben in deze run géén
  apart bewijs dat ze in season 6578 eligible zijn (car_restrictions gaf alleen 64). Daarom
  **PARTIAL → blocked** (niet gokken). 5 slots aanwezig.
- **Bathurst** (Supercars), **Petit Le Mans** (GTP/LMP2/GT3), **Britcar** (GT3/GT4),
  **8h Indianapolis** (GT3): klasse-niveau bewezen via officiële pagina; **geen exacte per-event
  numerieke car-ids** in deze run → **NOT VERIFIED → blocked**.

## 7. Regressie (uit vorige fases, herbevestigd na source-fix + syncx2)

- Nürburgring actieve slots = **40**; 09:00 CEST (07:00 UTC) en 19:00 CEST (17:00 UTC) elk **1×**.
- 0 actieve buckets met week-set; de 7 overschaduwde bucket-rijen blijven **inactief**.
- Catalog bucket/timeslot fixes intact; Special Events-pagina laadt; activatie-guard blokkeert nog
  steeds de niet-bewezen events; geen event geautoactiveerd.

## 8. Backup / rollback

- Backup vóór Suzuka-mapping: `/opt/supabase/backups/pre-suzuka-map-20260904-suzuka-map.sql`
  (sha `f9527bf4…`, off-host op 3sm-docker).
- Edge-functie vóór source-fix: `index.ts.pre-official-source` (volume).
- Bron-commit: `ab4ee58` (git main).

## 9. Tests

- Nieuw: `iracingOfficialSourceRoundTrip.test.ts` (fixture `iracing-special-events-sample.html`) —
  bewijst stable-route + parser + provenance.
- Contract-test geüpdatet (stable route, géén dode WP-page fetch).
- Volledige suite: **719/723** — enkel 4 bekende pre-bestaande endurance-capability-fails (ongerelateerd).
- tsc / lint / build PASS.

## 10. SimHub / telemetrie / kanalen (onaangetast)

- default = 0.4.0.0, stable = 0.4.0.0, canary = 0.4.1.0.