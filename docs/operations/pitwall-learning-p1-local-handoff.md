# P1 learning — lokale handoff, geen vrijgave

## Besluit

**Functionele bouw: PASS. Codekwaliteit: APPROVED. Performancepoort: OPEN / INCONCLUSIVE.**
P1 heeft dus geen volledige faseacceptatie en geen productie-GO. P2 is niet gestart.
Geen push, main-merge, uitrol, training of nieuw zichtbaar advies.
Productiefrontendwijzigingen: NONE. PRODUCTIEWIJZIGING: NEE.

Lokale integratiebranch: `feat/pitwall-learning-p1`.
Implementatie inclusief laatste harnessguards: `f87100474175473883b921b12b10acb08c2e8822`.
Reviewde databasecode: `25044e013f3362656c95cb7be4d54c86098b01b9`.
De twee harnessbestanden veranderden daarna; SQL, clientcontract en applicatiecode niet.

## Geleverde grenzen

- Pure learningbijdrage-v1-parser met fail-closed modelallowlist en expliciete units.
  Een bronobservatie heeft tijd én zone; een trainingcutoff mag dagprecisie hebben.
- Private, immutable bronrevisies en begrensde batch-outbox. Tijdens de bestaande
  ingesttransactie alleen een batch per owner/statement plus job; detailmaterialisatie
  wordt later via een begrensde, geautoriseerde lease-API uitgevoerd.
- Owner op receipt bevroren; actuele owner/policy/versie/workerflag opnieuw gecontroleerd
  voordat toegestane verwerking/export/finish kan slagen. Geen accountpooling.
- Claim/dead-letter SKIP LOCKED, beperkte aantallen, leaseverval/stale-tokencontrole,
  NOWAIT finish, retry/backoff en atomaire/idempotente materialisatie.
- Vier statement-triggers op event/laparchives, niet op ticks/latest. Geen wijzigingen
  aan bestaande ingest-RPC-definities, connector, DLL, updater of bestaande leerpools.
- Behoudende rollback: capture uit, triggers weg, worker dicht, bewijs/batches/jobs blijven.
  Retentie 7/180/90 dagen is bouwcontract; geen retentiejob of leerdienst aangezet.

Er is nog geen nieuw automatisch draaiend model. De bestaande leerroute blijft ongemoeid.
De workerdaemon, contextkwalificatie, voorspellingen/scoring en testpitwallpresentatie
horen bij latere, afzonderlijk toegestane fasen.

## Verificatie

- Learningcontract: 121/121 tests, onafhankelijke specherkeuring en quality APPROVED.
- Database: 350/350 SQL-asserties opnieuw door onafhankelijke quality-reviewer uitgevoerd.
  Eigen private SQL-probes bevestigden policy-intrekking bij source- én batchretry.
- Python harness: 20/20 na de laatste parentcorrectie; P0-auditguard: 16/16.
- Volledige integratiesuite: 1947 geslaagd, dezelfde ene bestaande
  `tyreTelemetryContract.test.ts`-fout als de ongewijzigde basis. Geen nieuwe testfout.
- Typecheck: dezelfde 16 diagnostics als de basis, exact vergeleken; geen nieuwe.
- Gewijzigde TypeScriptbestanden: ESLint groen. Volledige lokale `npm run build` geslaagd.
- Echte V3-parser accepteert een synthetische volledige envelope met 20 events + 3 laps:
  14.492 UTF-8 B voor de twee arrays, 15.430 UTF-8 B voor het volledige frame.
  Geen HTTP-E2E of werkelijk productieframe geclaimd.
- Laatste parentcorrecties sluiten alle sample-bytebudgetten in de performancegate in
  en voegen de ontbrekende SQL-guard bij finish-busy claim toe. Bytebudgetregressies
  eerst rood, daarna groen; de bewaakte busy-probe echt uitgevoerd. SQL is ongewijzigd.

## Open prestatiepoort

Eén vooraf vastgelegde ronde: 40 rondes, vijf gebalanceerde fasen, iedere fase eigen
backend, drie volledige ongetimede warmups na DDL/flagsetup en distinct identifiers.
Geen doorgaan met herhalen totdat toevallig groen wordt gemeten.

- Absent p95: 168,808 ms; capture-aan p95: 189,939 ms.
- Primair verschil: **+21,131 ms / +12,518%**, boven beide grenzen.
- A/A absent: +7,964 ms / +4,718%, binnen budget.
- A/A installed-off: +25,016 ms / +17,226%, buiten budget.
- De vastgelegde grens blijft **≤20 ms EN ≤10%**. Uitslag: INCONCLUSIVE, geen PASS.

Dit is geen betrouwbare productieschatting of bewijs dat de oorzaak alleen hostruis is.
Een afzonderlijk gecontroleerde prestatievalidatie is nodig voordat P1 mag worden
geaccepteerd of capture ooit wordt geactiveerd. Niet alvast P2 of productie starten.
Oudere cold-backend-metingen en de 0,5-CPU-FAIL blijven historische, niet vergelijkbare
bewijzen; ze worden niet tot PASS herschreven.

## Restgrenzen en bewijsintegriteit

- Applicatierollen mogen private tabellen niet TRUNCATE-en; een bevoegde operator kan
  zonder de verwijderde brede FK toch jobs verwezen. Geen handmatige private TRUNCATE;
  latere retentie moet referenties expliciet afhandelen.
- Een direct-SQL item >16 KiB kan stil worden gefilterd. Normale bronconstraints begrenzen
  huidige wire-items; geen volledigheidsclaim voor geprivilegieerde oversize-inserts.
- Geforceerde batch-done wordt al met `materialization_required` geweigerd voordat de
  policyfoutcode nodig is. Geen succes of export. Een oud rolcomment noemt drie API's;
  effectieve expliciete grants tellen er vier.
- Een vroege builderstart overschreef zes historische thin-outbox-probelogs; vijf oude
  green-logs zijn uit onafhankelijke reviewkopieën teruggezet. Die historische directory
  wordt niet als byte-bevroren origineel gepresenteerd. De definitieve gekalibreerde
  uitvoer plus onafhankelijke reviewlogs vormen het actuele bewijs.

Privé bewijsroot: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/`.
Definitieve review: `quality-calibrated-review/review.md`; meting: `calibrated-perf-review/`.
Parentstatus, build-/testlogs, dump/TOC en SHA-256-manifest staan daar afzonderlijk.

De netwerkloze testcontainer is na een custom-format backup met geverifieerde TOC
verwijderd en afwezig gecontroleerd. De dump bevat uitsluitend synthetische rijen plus
schema-only productiemetadata. Productie is alleen-lezen nagekeken: private namespace,
workerrol en vier capturetriggers ontbreken daar nog steeds. Geen live activatie.
