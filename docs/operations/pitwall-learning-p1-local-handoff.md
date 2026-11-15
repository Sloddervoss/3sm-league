# P1 learning — lokale handoff, geen vrijgave

## Besluit

**Lokale P1-bouwacceptatie: PASS. Functionele review en codekwaliteit: APPROVED.**
De gecontroleerde 200-ronde proef voldoet aan de vooraf vastgelegde p95-regel;
de onafhankelijke spec-/qualityreview en herkeuring van de bewijsreparaties zijn afgerond.
Dit is een lokale puntmeting met zeer kleine marge, geen robuuste productiegarantie.
Productievalidatie/uitrol zijn niet goedgekeurd. P2 is niet gestart.
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

## Gecontroleerde lokale prestatiepoort en historische uitkomsten

De onderstaande 40-ronde-uitkomst blijft **historisch INCONCLUSIVE** en wordt
niet herschreven. De apart vooraf vastgelegde 200-ronde gecontroleerde run staat
in `docs/operations/pitwall-learning-p1-controlled-perf.md`: p95 absent
145,319 ms → on 159,842 ms, **+14,523 ms / +9,994%**, A/A binnen budget
(+4,184 ms/+2,879% en +1,791 ms/+1,313%), 0 contractfouten op 1000 samples.
Dat is volgens de ongewijzigde gate **PASS**, met een brede bootstrapdiagnostiek
(−28,076 … +39,999 ms) die alleen ter informatie dient. Parent en onafhankelijke
review hebben de ruwe samples, preregistratie en kleine marge gecontroleerd.
De gerichte herkeuring op `77779b5ae1996eace337293dffdd70d2d8ff2f58` is APPROVED.
Volgordesamenvatting en provenance zijn als apart erratum hersteld, zonder de meetdata
of numerieke gate te wijzigen. Geen robuuste productiegarantie, productie-GO of P2.

De oude 40-ronde-meting: 40 rondes, vijf gebalanceerde fasen, iedere fase eigen
backend, drie volledige ongetimede warmups na DDL/flagsetup en distinct identifiers.
Geen doorgaan met herhalen totdat toevallig groen wordt gemeten.

- Absent p95: 168,808 ms; capture-aan p95: 189,939 ms.
- Primair verschil: **+21,131 ms / +12,518%**, boven beide grenzen.
- A/A absent: +7,964 ms / +4,718%, binnen budget.
- A/A installed-off: +25,016 ms / +17,226%, buiten budget.
- De vastgelegde grens blijft **≤20 ms EN ≤10%**. Uitslag: INCONCLUSIVE, geen PASS.

Dit is geen betrouwbare productieschatting of bewijs dat de oorzaak alleen hostruis is.
De later uitgevoerde gecontroleerde validatie hierboven sluit de lokale bouwpoort.
Voor capture-activatie blijft afzonderlijke productievalidatie/GO nodig.
Niet alvast P2 of productie starten.
Oudere cold-backend-metingen en de 0,5-CPU-FAIL blijven historische, niet vergelijkbare
bewijzen; ze worden niet tot PASS herschreven.

## Restgrenzen en bewijsintegriteit

- Applicatierollen mogen private tabellen niet TRUNCATE-en; een bevoegde operator kan
  zonder de verwijderde brede FK toch verweesde jobs achterlaten. Geen private TRUNCATE;
  latere retentie moet referenties expliciet afhandelen.
- Een direct-SQL item >16 KiB kan stil worden gefilterd. Normale bronconstraints begrenzen
  huidige wire-items; geen volledigheidsclaim voor geprivilegieerde oversize-inserts.
- Geforceerde batch-done wordt al met `materialization_required` geweigerd voordat de
  policyfoutcode nodig is. Geen succes of export. Een oud rolcomment noemt drie API's;
  effectieve expliciete grants tellen er vier.
- Een vroege builderstart overschreef zes historische thin-outbox-probelogs; vijf oude
  green-logs zijn uit onafhankelijke reviewkopieën teruggezet. Die historische directory
  wordt niet als byte-bevroren origineel gepresenteerd. Die gekalibreerde uitvoer
  blijft historisch bewijs; de actuele gecontroleerde run en reviews staan hieronder.

Historische bewijsroot: `/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/`;
SQL-review: `quality-calibrated-review/review.md` onder die root.
Actuele meetdata: `/home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-20261111/`.
Definitieve delta-review: `/home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-review-final-20261111/`.
Apart erratum: `/home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-evidence-fix-20261111/`.
Parentherberekening en backup/cleanup: `/home/hermes/artifacts/3sm/pitwall-learning-p1-controlled-parent-20261111/`.
De oorspronkelijke 192- en 34-regelige manifesten blijven ongewijzigd en verifieerbaar.

De netwerkloze testcontainer is na een custom-format backup met geverifieerde TOC
verwijderd en afwezig gecontroleerd. De dump bevat uitsluitend synthetische rijen plus
schema-only productiemetadata. Productie is alleen-lezen nagekeken: private namespace,
workerrol en vier capturetriggers ontbreken daar nog steeds. Geen live activatie.
