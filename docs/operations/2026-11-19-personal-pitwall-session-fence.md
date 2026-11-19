# Personal Pitwall — simulator-session fence

Datum: 2026-11-19
Branch: `fix/personal-pitwall-session-privacy`
Migratie: `20261119130000_personal_pitwall_session_fence.sql`
Rollback: `supabase/rollbacks/20261119130000_personal_pitwall_session_fence.down.sql`

## Waarom

`transportSessionId` wordt door de connector per proces gemaakt
(`simhub-<guid>`), niet per iRacing/LMU-sessie. Practice → qualifying → race
kan dus dezelfde transport-id, hetzelfde circuit en dezelfde `race_run_id`
houden. De eerste share-versie vergeleek alleen die waarden en de tellers ten
opzichte van het moment van delen. Een oude bearer-link kon daardoor een
latere sessie op hetzelfde circuit lezen zodra de klok en het rondetotaal weer
voorbij het anker stonden.

De echte simulatoridentiteit zit al in de bestaande data:

1. `v3_normalized#>>'{paceHistory,observedSessionId}'`
   (`sim-<SessionUniqueID>-s<SessionNum>`, of `sim-s<SessionNum>` als SimHub
   geen uniek weekendnummer heeft). Alleen geldig als
   `paceHistory.transportSessionId` gelijk is aan het frame.
2. Server-side meetsegmenten: `simhub_lap_summaries.observed_session_id` en
   `simhub_measurement_events.observed_session_id`, gekoppeld aan
   `delivered_session_id`. Alleen bruikbaar als er voor die transportverbinding
   precies één verschillende waarde bestaat; twee waarden = ambigu = geen
   share.

Er is geen nieuwe client- of RPC-parameter nodig: de identiteit komt uit wat de
connector al stuurt en wat de meetlaag al bewaart.

## Ingest-fence (geen spectator-poll nodig)

Trigger `pitwall_session_fence_trg` op `simhub_telemetry_latest` (after insert
or update) doet niets zolang het device geen actieve share heeft. Anders
revoket hij de share onmiddellijk en onherstelbaar bij:

- terminale sessie (`checkered`, `cool_down`, `ended`, `not_in_world`, of
  checkered/black/disqualify flag). `meatball` is géén terminaal signaal: dat
  is de mechanische waarschuwingsvlag en blijft in echte rijsnapshots staan
  terwijl de sessie doorloopt;
- gewijzigde `observed_session_id` (met dezelfde transport-id);
- verdwijnende `observed_session_id` (bewijs weg = geen continuïteit);
- gewijzigde transport-id, circuitnaam/config/trackId of eigenaar;
- klok- of ronde-terugloop, of een sprong in `sessionTimeRemainingSeconds`
  die een nieuwe sessie aantoont;
- een gat van meer dan 120 seconden tussen twee geaccepteerde frames.

De trigger is exception-safe: een fout kost nooit een telemetrieframe. De
reader is daarnaast fail-closed: een ontbrekende of afwijkende identiteit
geeft nooit data, ook als de trigger onverhoopt niet liep.

## Share- en leesregels

- `pitwall_share_create_v2` weigert zonder bewezen identiteit
  (`session_unproven`), zonder actieve sessie (`not_shareable`) of zonder
  verse data (`not_fresh`).
- `unknown` is niet zelfstandig actief. De productieconnector stuurt die staat
  tijdens het rijden. Actief vereist: `isInCar = true`, sessieklok ≥ 20 s en
  (bij `unknown`) een afgeronde ronde, een lopende ronde ≥ 10 s of een laatste
  rondetijd. Terminale signalen overschrijven alles.
- `pitwall_shared_snapshot_v2` bindt op `observed_session_key` én
  `track_id`, en controleert terminal/transport/circus/race_run/tellers.
- De oude transport-only RPC's (`_v1`) zijn ingetrokken. Een gecachte client
  moet de nieuwe bundel gebruiken.

## Publieke projectie

- `circuit.trackId` is de officiële, publieke circuit-id; nodig voor de echte
  kaartgeometrie.
- Auto's krijgen stabiele pseudonieme sleutels `car-<12 hex>`, afgeleid van de
  transport-id en de ruwe opponent-id. Dezelfde auto houdt dezelfde sleutel
  als rijen herschikken; de sleutel is niet over sessies te correleren en de
  ruwe id (soms een coureursnaam) verlaat de server nooit.
- `sectors` is een begrensde whitelist (max. 40 auto's, 16 sectoren), alleen
  uit pace-history die bij de gebonden sessie hoort. Geen traces, geen
  `paceHistory`, geen `sectorGuards`, geen accountvelden.
- Ontbrekende of ambigue sectorindeling wordt expliciet als
  `available:false` met reden teruggegeven; de UI toont "sectortijden niet
  beschikbaar" in plaats van een verzonnen indeling.
- Ronden en pace komen alleen uit `simhub_device_laps` met dezelfde
  `observed_session_id`. Rijen zonder bewezen identiteit (oud of ambigu)
  blijven NULL en worden niet getoond.

## Token in de URL

De link gebruikt `#t=<64 hex>`. Een inline script in `index.html` is het eerste
uitvoerbare script: het neemt de token in een one-shot closure en haalt de
fragment direct uit de adresbalk. `main.tsx` importeert de app pas daarna
(dynamische import), dus ook module-level analytics ziet de token niet. Er
wordt niets in localStorage/sessionStorage bewaard.

## Uitrol

1. Migratie toepassen (additief; geen bestaande kolom wordt herschreven).
2. Bestaande actieve shares worden bij de migratie gerevoked met
   `session_unproven`; dat is bewust, hun oude bewijs is niet te controleren.
3. Frontend deployen (gebruikt `_v2` RPC's).
4. Controleren: owner discovery toont `shareable_reason`; een share op een
   `unknown`-sessie met `isInCar` en actieve klok werkt; een oude link sterft
   bij een sessiewissel zonder dat iemand hoeft te pollen.

## Rollback

`supabase/rollbacks/20261119130000_personal_pitwall_session_fence.down.sql`
verwijdert trigger, `_v2`-functies, indexen en de additieve kolommen, herstelt
de oorspronkelijke `simhub_capture_lap` en geeft de `_v1`-RPC's weer execute.
Reeds gerevokete shares blijven gerevoked (bewust irreversibel). De migratie
kan daarna opnieuw worden toegepast.

## Tests

- `npm run test:db:pitwall-fence` — echte PGlite/PostgreSQL: 80 checks over
  unknown-state, identiteitsverandering, reset, terminal, gap, ambigu bewijs,
  ronden-isolatie, owner-binding en rollback.
- `npm run test:db:pitwall-share` — bestaande 76 checks blijven groen.
- `npx vitest run src/test/personalPitwall.test.tsx src/features/personal-pitwall/share.helpers.test.ts`
- `npm run test:browser:pitwall-share` — echte Chromium (preview op poort
  8080): token weg vóór DOMContentLoaded, geen token in requests,
  track-42-kaart geladen, zichtbare geverifieerde sectoren, expliciete
  onbeschikbaarheid.

## Beperkingen

- Een solosessie zonder pace-history én zonder bewaarde meetsegmenten heeft
  geen bewijsbare identiteit en blijft dus niet deelbaar. Dat is fail-closed,
  geen fout.
- Oude rondenrijen zonder `observed_session_id` verdwijnen uit de publieke
  weergave; nieuwe rijen worden gestempeld.
- De fence verklaart een gat > 120 s als einde van de bewezen continuïteit.
  Delen moet daarna opnieuw worden gestart.
