# 3SM iRacing Car Mapping Repair — Audit

Status: PARTIAL — AMBIGUOUS / OFFICIAL DATA GAPS REMAIN
Datum: 2026-09-04 | We deden GEEN mapping die niet bewezen is.

## Context
Nadat de bucket/week-catalogus-repair (751a870) klaar was, bleven **6 actieve** canonical
Special Events "blocked" door `missing_car_catalog_mapping`. Doel: alleen *bewezen* officiële
car → lokale 3SM mapping repareren, geen gokken.

## De 6 blocked events (na bucket-repair)

| source_key | season_id | actief | classes | cars coverage |
|---|---|---|---|---|
| `iracing:2026:portimao-1000` | **6578** (Data API) | ja | {HPD,GT1,GT2} local | cars=[] (leeg) |
| `iracing:2026:suzuka-1000km` | null | ja | {} | 11 GT3 cars, localCarId=NULL |
| `iracing:2026:petit-le-mans` | null | ja | {} | 16 cars (GTP+LMP2+GT3), localCarId=NULL |
| `iracing:2026:bathurst-1000` | null | ja | {} | 2 Supercars, localCarId=NULL |
| `iracing:2026:8-hours-of-indianapolis` | null | ja | {} | 11 GT3 cars, localCarId=NULL |
| `iracing:2026:britcar-24hr` | null | ja | {} | cars=[] (leeg) |

## Bron-onderzoek
- Officiële WP-kalender (page 263677) → HTTP 404 (pre-bestaand, onafhankelijk van deze task).
- 5 van de 6 events hebben `season_id=null` + `provenance: "official iRacing Special Events page;
  exact times pending explicit season mapping"`. Hun cars zijn **feature-filenames** van de
  (nu onbereikbare) WP-pagina, **zonder officiële car_id / officialClassId**. Er is dus geen
  gezaghebbende Data-API-bron om die te verifiëren.
- **Portimao** is het enige event met een echte `season_id` (6578) en `provenance: "...+ authenticated
  Data API"`. Via de iRacing Data API (season_schedule + car/get) bewezen:
  - officiële serie: **"Portimao 1000km Presented by Simucube"**, Algarve GP
  - `car_restrictions` → **car_id 64 = "Aston Martin DBR9 GT1"** (dirpath `astonmartin\dbr9`)
  - `race_week_car_classes` = leeg → de restrictie is de enige bewezen eligible set via deze API.

## Mapping-analyse (classificatie per fase 4/6)
- **A. EXACT PROVEN MATCH**: alleen Portimao's `car_id 64 → local `aston-martin-dbr9-gt1`` (GT1,
  in de canonical whitelist). 
- **C/D. AMBIGUOUS / ONBEWEZEN**: De Portimao-rij claimt `local_class_ids={HPD,GT1,GT2}` maar ik heb
  enkel GT1 (DBR9) officieel bewezen. De legacy-klasse-claims HPD/GT2 + hun auto's
  (hpd-arx-01c, corvette-c6r, ford-gt-gt2-gt3) zijn **niet** per-car door deze event-data bewezen.
- **E. WRONG EVENT SOURCE DATA**: de 5 WP-derived events hebben officiële metadata die alleen via
  de 404-pagina bestaat → niet af te leiden, niet te repareren zonder gokken.

## Beslissing
Conform het GO:
- Geen mapping toegevoegd die niet onomstotelijk bewezen is.
- Portimao's GT1-BRC9-bewijs is partieel (de event-rij eist meer klassen), dus **niet geforceerd**.
- De 5 WP-specials + de onvolledige Portimao blijven **blocked** met reden "officieel car id niet
  gezaghebbend te bepalen" (WP 404 / ontbrekende season-mapping).
- De lokale whitelist `endurance_activate_iracing_slot` is ongewijzigd; de guard is niet omzeild.

## Resultaat
- Bewezen mapping toegevoegd: **0** (geen veilig volledige mapping mogelijk binnen regels).
- Events READY: **0** van 6.
- Events STILL BLOCKED: **6** (5 WP-derived zonder officiële id + Portimao incompleet).
- Nieuwe lokale car-rijen: **0** (niets gefabriceerd).
- Backup: `/opt/supabase/backups/pre-carmapping-20260904-carmapping.sql`
  (sha `86da4de6d0c97c898e6545d87b5b2e6979ff007b7d43bbadd8532d8062e7d8bd`).
- SimHub/telemetrie/manifests: ongewijzigd (default 0.4.0.0, canary 0.4.1.0).

## Hoe wél te unblocken (vereist extra autorisatie / bron)
Portimao: gerechtvaardigde vulling van de volledige officiële car-set vereist óf een bevestigde
season-mapping voor alle GT1/GT2/HPD-klassen óf uitdrukkelijke bevestiging dat alleen GT1=DBR9
geldt. De andere 5 vereisen een werkbare officiële bron (WP of een expliciete season-mapping per
event) — niet beschikbaar zolang WP 404 is.