# T13-S2C2a — observation-ACK-classificatie en duurzame per-rij-toepassing

Status: **LOKAAL GEÏMPLEMENTEERD EN GETEST; NIET GEACTIVEERD EN NIET BEDRAAD.**
Nieuwe bibliotheek `ObservationAck.cs` plus een minimale uitbreiding van
`ObservationLedgerStore.ApplyAck`. Geen HTTP, sendlease, plugin/settings/
pipeline/sender-wiring, geen echte `%APPDATA%`-file, geen DB/Edge/release.

## Bron van de wire-vorm (geen aanname)

De resolver is tegen de werkelijke bron gebouwd:

- `supabase/functions/_shared/simhubAggregates.ts` — `mergeMeasurementAck`
  levert  `measurements.events`/`measurements.laps` met `received`, `accepted`,
  `duplicates`, `superseded`, `rejected`, `block_error`, `stored`.
- `supabase/functions/_shared/simhubAggregates.ts` — bij `stored:false` worden
  `accepted`/`duplicates`/`superseded` leeggemaakt. `stored:false` is dus nooit
  een per-rij-succes.
- `supabase/functions/_shared/simhubAggregates.ts` — `AckId` is
  `{ id, recordRevision }` en `jsonResponse` serialiseert dat als
  `recordRevision` (camelCase). Dit is de **werkelijke Edge-wirevorm**.
- `supabase/migrations/20261031200200_plugin08_complete_coverage.sql` (en de
  latere fast-path/supersedes-migraties) — de database levert
  `{'id', 'record_revision'}` (snake_case); `rejected` bevat
  `{'id', 'index', 'reason'}`. De database-index is de positie in de
  oorspronkelijke parserreeks; de Edge vertaalt hem met `acceptedIndexes`
  terug naar de volledige aangeboden payload.
- De resolver leest daarom **beide bronvormen** (`record_revision` en
  `recordRevision`). Staan ze samen met een verschillende of ongeldige waarde,
  dan blijft de revisie onbewezen. De bestaande legacy-parser leest alleen
  snake_case; die baseline wordt hier niet gerepareerd.
- `supabase/functions/_shared/simhubExtensions.ts` — de echte redenvorm is
  `${path}.observation is invalid: ${code}` en
  `${path} contains unknown fields`.

## Aangeboden batch en indexruimte

- `ObservationOfferedRow.TryCreate(...)` freeze't UID, revisie, exacte
  `RowJson`, lane (`Legacy`/`Observation`) en — alleen voor OBS — de complete
  `ObservationPairingBinding`. De fabriek leest de identiteit uit `RowJson`,
  accepteert geen device-mismatch en weigert een legacy-rij die toch een
  observation draagt.
- `ObservationOfferedBatch.TryCreate(...)` bewaart de volledige, geordende
  `lapSummaries`-lijst vóór enige lanesplitsing. Een dubbele UID in één batch
  is ambigu en wordt geweigerd.
- De resolver vertaalt `rejected.index` altijd tegen deze volledige lijst.
  `[OBS, legacy, OBS]` op index 0/1/2 raakt dus precies die rij. Een
  id/index-conflict markeert beide betrokken rijen `NotDelivered`; er wordt
  niets opgeruimd.

## Per-rij-union

| Uitkomst | Voorwaarde | Ledger |
|---|---|---|
| `Accepted` / `Duplicate` / `Superseded` | `record_revision >= offered/local` | verwijderen in dezelfde snapshot; `deliveredTotal++` |
| `NotDelivered` | lagere/ontbrekende/ongeldige revisie, ongenoemd, conflict, stale epoch | niets wijzigen |
| `Deferred` | `observation_unavailable`, `observation is unavailable`, `contains unknown fields` (na padprefix) | `attempts++`, bounded backoff (2 s … 60 s), dezelfde UID/revisie/`RowJson` |
| `Quarantined` | vaste permanente codes, onbekende code → `server_rejected_unknown` | `state=quarantine` + lokale reden in dezelfde commit; geen retry |
| legacy | bestaand `Accepted/Duplicate/Superseded/Rejected` | bestaande `MeasurementOutbox.ApplyAck`; deze component wijzigt die queue niet |

- Ontbrekende, negatieve, fractionele, overflow- en stringrevisies worden
  nooit als succes gelezen. Een kale UID is voor OBS dus `NotDelivered`.
- Alleen de negen vaste `observation_invalid_*`-codes zijn permanent benoemd;
  elke andere suffix of onbekende servercode wordt één vaste lokale
  `server_rejected_unknown`.
- `stored:false`, ontbrekende `measurements`/`laps`, onparseerbare JSON en een
  onveilige/onbegrensde `block_error` leveren geen delivery en geen teller.
  Een `block_error` wordt voor diagnose tot een korte tokenvorm begrensd.

## Atomaire toepassing

`ObservationLedgerStore.ApplyAck(ObservationAckResolution, nowUtc)` is de
enige delivery-API. Er bestaat bewust geen `DeleteAsDelivered`,
`MarkDelivered(uid)` of `bool stored`-overload; de publieke constructor van
`ObservationAckResolution` is internal, dus een caller kan alleen een echt
geresolveerde batch/ACK plus de epoch aanbieden.

Onder de ledgerlock én de `ObservationBindingFence`:

1. De actuele fence moet gelijk zijn aan de `ExpectedBinding` van de resolutie.
   Een epoch-/bindingwissel geeft `RefusedStaleEpoch`: geen cleanup, geen
   teller, entries blijven `pending`/`deferred`.
2. Per OBS-rij worden UID, revisie, **exacte** `RowJson` en entrybinding
   opnieuw vergeleken. Een oud ACK voor een andere revisie/payload is
   `UnknownUid`/`IdentityConflict` en verwijdert niets.
3. Delivery, `Deferred`, `Quarantined` en alle tellers worden in één enkele
   snapshot opgebouwd. Quarantaine is terminaal; een latere `accepted` of
   `deferred` maakt daar geen delivery van. Onbekende UID's/replays geven
   alleen `ack_unknown_uid`, nooit een entry of `deliveredTotal++`.
4. Vlak vóór de publicerende switch controleert een guard opnieuw de fence en
   de volledige delivery-plan (UID/revisie/`RowJson`). Een fout vóór de switch
   laat schijf en geheugen ongemoeid (`NotCommitted`).
5. Een fout ná de switch verzoent de **volledige** snapshot inclusief tellers.
   Alleen een exacte match wordt als levering geadopteerd; anders volgt
   `Uncertain` + fail-closed, zonder tweede legacy-fallback.
6. `Stored` is uitsluitend waar als elke aangeboden OBS-rij in deze commit
   daadwerkelijk is verwijderd. `remaining.Count == 0`, een lege queue, een
   replay of een quarantaine is nooit `Stored`.

## Bewijs

Zie `artifacts/3sm/pitwall-learning-p2-observation-ack/REPORT.md` en de
`.log`/`.exit`-paren in dezelfde root. De nieuwe selector is
`--only-observation-ack`; hij zit ook in `--only-measurement` en de volledige
harness. De tests gebruiken echte bestanden onder een geïsoleerde tijdelijke
map en synthetische ACK-fixtures in de hierboven geverifieerde wire-vorm.

## Niet in S2C2a

- Geen HTTP-post, geen async `SemaphoreSlim`-sendlease, geen
  `SendEnvelope`, geen plan/drain en geen productiecaller
  (`SendV3Async`/`AcknowledgeMeasurements`).
- Geen plugin-, settings-, pipeline-, sampler- of pairing-GUI-wijziging.
- Geen enkele echte serverresponse, SDK, DB, Edge of productie-`%APPDATA%`.
- De Q2 non-UTC mutable-sample-kwestie blijft expliciet gedelegeerd en is
  onafhankelijk van deze ledger/ACK-code.
