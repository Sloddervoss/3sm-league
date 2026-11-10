# PACE-opslag: productie-migratie en rollback

Status: **TOEGEPAST OP 11 NOVEMBER 2026** na expliciete GO en parent-rehearsal.
De bevroren forward is éénmaal transactioneel uitgevoerd op productie. Alle acht
functiedefinities, eigenaars, security en ACL’s zijn exact tegen de goedgekeurde
PG15-kloon teruggelezen; tabellen, views, policies en configuratie bleven gelijk.
De scheduler is niet veranderd. Zie `2026-11-11-pitwall-test-and-simhub-0762.md`
voor het volledige uitrolbewijs en de backup.

## Wat de migratie doet

- Voegt drie helpers toe: `simhub_pace_merge_v1`, `simhub_pace_project_v1`,
  `simhub_pace_cleanup_v1`.
- Laat `simhub_persist_v3` een optioneel `paceCapture`-blok samenvoegen tot een
  begrensde `paceHistory` in het bestaande JSONB-veld
  `simhub_telemetry_latest.v3_normalized`. Signatuur, defaults, retourkolommen,
  ACK, replay-poort, device-lock, routering, meting, banden en versiemetadata
  blijven ongewijzigd; alleen het PACE-blok is ingevoegd.
- Geeft `get_simhub_device_details` en `get_pitwall_data` dezelfde begrensde
  projectie (max 40 auto's; volledige reeksen alleen voor eigen auto plus de
  gevraagde/leidende auto). Vorm en overige velden blijven gelijk.
- Laat `get_pitwall_pace` eerst de opgeslagen `paceHistory` lezen en pas daarna
  de bestaande `simhub_lap_times`-fallback gebruiken; TTL geldt op de leesroute.
- Voegt `paceCapture` toe aan de feature-allowlist van
  `simhub_connector_config_apply`. De bestaande configuratierij (revisie 4,
  `paceCapture: true`) wordt niet gewijzigd.
- Geen tabellen, kolommen, indexen, policies of data.

## Herkomst en hashes

| Artefact | SHA-256 |
| --- | --- |
| `supabase/migrations/20261110231000_pitwall_pace_storage.sql` | `c093162c9c7885b5a2ecc2a65cf46d6b6e2095d868ee31a8978237d88918fb21` |
| `supabase/rollbacks/20261110231000_pitwall_pace_storage.sql` | `01fac7b003c38a33cd95a93678b40b608f3dcbb3c127daafc6fe4b4c2f14c70f` |
| `supabase/tests/fixtures/pace-live-baseline-functions.sql` | zie `pace-live-baseline-manifest.json` |

Baseline: `pg_get_functiondef()` op productie (PostgreSQL 15.19,
`3sm-docker/supabase-db`), read-only uitgelezen op 2026-11-10 en vastgelegd in
`supabase/tests/fixtures/pace-live-baseline-functions.sql`. Per functie staan
zowel de fixture-SHA-256 als de `definitionMd5` in het manifest. De migratie
bevat een harde poort die op PostgreSQL 15 stopt zodra een van de vijf
live-definities afwijkt; op een andere engine (PGlite) vervalt alleen die
tekstvergelijking.

## Toepassen (alleen na expliciete GO)

1. Maak eerst een backup volgens de bestaande conventie (custom-format
   `pg_dump` + globals + TOC + SHA-256-manifest).
2. Vergelijk read-only `pg_get_functiondef` met de `definitionMd5`-waarden uit
   `supabase/tests/fixtures/pace-live-baseline-manifest.json`. De migratie zelf
   weigert bij drift op PostgreSQL 15.
3. Pas alleen dit bestand toe, in één transactie:
   `psql -X -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261110231000_pitwall_pace_storage.sql`
4. Lees de objects terug (zie hieronder) en controleer de ACL's.

## Verifiëren na toepassing (read-only)

```sql
select proname, pg_get_function_identity_arguments(oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('simhub_pace_merge_v1','simhub_pace_project_v1',
                   'simhub_pace_cleanup_v1','simhub_persist_v3',
                   'get_pitwall_data','get_simhub_device_details',
                   'get_pitwall_pace','simhub_connector_config_apply')
 order by 1;

select has_function_privilege('anon','public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)','EXECUTE') as anon_merge,
       has_function_privilege('authenticated','public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)','EXECUTE') as authenticated_merge,
       has_function_privilege('service_role','public.simhub_pace_cleanup_v1()','EXECUTE') as service_cleanup,
       has_function_privilege('anon','public.get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') as anon_pace;

select config_revision, features
  from public.simhub_connector_config where id = 1;
```

Verwacht: `anon` en `authenticated` hebben geen EXECUTE op merge/project/cleanup;
`anon` heeft geen EXECUTE op de lezers; de configuratierevisie en
`paceCapture: true` zijn onveranderd.

## Rollback

`psql -X -1 -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261110231000_pitwall_pace_storage.sql`

- Herstelt de vijf functies exact naar de live-definitie van 2026-11-10 en
  verwijdert de drie helpers.
- **Laat bestaande `paceHistory`-sleutels in de data staan.** De oude lezers
  negeren die; de TTL-opruimer is na rollback weg, dus fysiek opruimen is een
  aparte, goedgekeurde actie. Niet stilzwijgend verwijderen: het is de enige
  kopie van de opgenomen historie.
- Raakt de configuratierij niet aan. Let op: de herstelde
  `simhub_connector_config_apply` kent `paceCapture` niet in zijn allowlist; een
  features-write via die oude route zou de vlag uit het object laten vallen.
  Herstel dus eerst de forward-definitie voordat iemand de configuratie opnieuw
  laat schrijven.

## Rehearsal-bewijs

Uitgevoerd op een geïsoleerde, disposable kloon van productie
(`supabase/postgres:15.19.0.004`, `--network none --memory 512m --cpus 1`) met
het volledige `public`-schema (85 basistabellen, 6 views, 230 functies, 165 policies) en
dezelfde tabel-ACL's. Geen productieconnectie voor DDL/DML.

- `supabase/tests/pace-production-rehearsal.sql`: al zijn `PASS`-regels groen,
  inclusief 5/6/8-argumenten-persist, ACK-vorm, replay, routering, caps
  (40 auto's / 20 rondes / 3 sporen / 128 bins), TTL, leak-checks en
  cleanup-batches van 100 + 5.
- `supabase/tests/pace-rollback-rehearsal.sql`: vijf definities exact gelijk aan
  de baseline, helpers weg, ACL's en configuratie ongemoeid, oude persistgedrag
  terug.
- `scripts/test-pace-storage.mjs` (PGlite): 38/38 PASS, inclusief
  rollback-roundtrip en forward-opnieuw.
- Objectinventaris na forward: alleen de drie helpers toegevoegd; 0 tabellen of
  policies verwijderd of toegevoegd.

## Risico's en grenzen

- De plugin stuurt per frame **één** metriek (de eigen auto of een tegenstander);
  volledige historie voor alle 40 auto's is dus nooit gegarandeerd.
- `freshness` blijft 5 seconden in de UI; de opslag-TTL is 24 uur.
- De cleanup is begrensd (100 rijen per aanroep, `SKIP LOCKED`). Inroosteren
  gebeurt later als aparte stap. Zonder scheduler blijven verlopen sleutels op
  inactieve devices fysiek staan; de harde opslaggrens en lees-/merge-TTL blijven
  gelden.
- Een leesroute die `get_pitwall_data` gebruikt, krijgt nu een geprojecteerde
  `v3_normalized` (geen `paceCapture`, volledige reeksen alleen voor eigen +
  referentie). Dat is de PACE-capability, geen wijziging van de overige velden.
- De migratie is geschreven voor PostgreSQL 15.19; de harde baseline-poort is
  versie-specifiek tekstueel en vervalt op andere engines.
