# S2E5 — observation policy in de bestaande persist-transactie

## Gerichte S1/S2/S3-reparatie (2026-11-14)

De onderstaande oorspronkelijke proef blijft numeriek PASS, maar de onafhankelijke
review wees die bron functioneel af: SPEC BLOCKED; QUALITY NOT REACHED. Die
uitkomst en de oude artefacten zijn niet vervangen of kwijtgescholden.

De reparatie bouwt op `3c117c7a2ab92b9e7fb2460484cc91f907ceca9c`, op
`fix/pitwall-learning-s2e5-policy-repair`. Alleen de huidige ongepubliceerde
S2E5-migratie en paired rollback worden aangepast; oudere migraties blijven gelijk.

- S1: Edge componeert `observationPolicyRequested` pas na parser/contextvalidatie
  in het bestaande normalized argument, en overschrijft een vervalste bodywaarde.
  SQL leest account_policy alleen bij JSON boolean true. Ontbrekend, false,
  verkeerd type en unavailable betekenen nul private policy-scans en NULL in het
  nog steeds aanwezige vierde resultaatveld. Intent is geen toestemming: token,
  device, rol en de echte `d.owner_user_id` blijven de autoriteit.
- S2: de optionele tabel-lock is NOWAIT; impliciete lock-wachttijd wordt maximaal
  5ms (of de strengere bestaande lock_timeout). Minder dan 25ms resterend op de
  al lopende statement_timeout slaat het optionele werk over. Caller-GUCs worden
  hersteld; statement_timeout wordt nooit aangepast/herstart en query_canceled
  wordt niet gevangen. Een globale annulering blijft atomair afbreken, ook vóór
  core-acceptatie. Dit is geen belofte dat corewerk onder iedere globale deadline
  past. De ON-lockproeven gebruiken geen meetbatch/policyrij en lezen gecommitteerde
  corewrites vanuit een andere sessie; een verstreken budget mag die proef niet
  maskeren. PG15 timeout/exception-documentatie staat bij het nieuwe bewijs.
- S3: één guard omvat de gehele rollbackactie, inclusief DDL/ACL/NOTIFY. Alleen
  een echte vier-output preimage activeert herstel. Herhaling op drie outputs en
  een ontbrekende functie zijn aantoonbaar no-op op functie-inventaris/ACL.
- De entrytests behouden failed-core, identiteit, default-off en oldDB-fallback,
  met herstelde late rejection na timeout en expliciete policy/history-overlap.
  Het harnas kan via `S2E5_ARTIFACT_ROOT` naar een nieuwe private bewijsroot. Hoge
  transportsequenties/UIDs in de behouden lab worden niet als lapNumber gebruikt.
- De bestaande exclusief overgedragen lab wordt hergebruikt, zonder nieuwe stack
  of schemaherstel: alleen de vier eigen capturetriggers, twee goedgekeurde
  S1-projecties en de phase-RPCs worden gecontroleerd hersteld. Worker blijft dicht.

Nieuw bewijs (exacte bevroren SHA, exits, één eigen preregistratie/proef en
safe-disable):
`/home/hermes/artifacts/3sm/pitwall-learning-p2-policy-hop-repair-20261114/REPORT.md`.
Oud builder-/reviewbewijs blijft read-only. Een onafhankelijke gerichte SPEC-recheck
en daarna QUALITY op de nieuwe SHA blijven aparte poorten; buildertests zijn geen
zelfcertificering. Geen productie, push, merge of deploy.

## Scope en bron

Lokale bouw/test na Vincent's keuze voor optie 2. Geen productie-apply, deployment,
push, merge, enrollment, plugininstallatie, fitting of modelactivatie.
Basis `a787c8ae2b7b53694c0cbce4d616a476b8877e7f`;
branch `fix/pitwall-learning-s2e5-policy-hop`.

- Gemeten bron/harnas: `5bb2be5521ebf6cdb1cefa19d57cbaf25a5e17bd`.
- Definitieve rollbackverificatie/reviewdoel: `4b39b8df64960789fbb89bd8ce6d638a203834ec`.
- Na de meting wijzigde alleen `scripts/pitwall-learning/s2e5/audit.py`, niet de
  applicatie, migratie, timingrunner, dataset of limieten. De geregistreerde oude
  audit-bytes blijven bewaard; de uitzondering is expliciet voor onafhankelijke
  review. Een nieuwe SHA is geen aanleiding om de vaste meting te herhalen.

## Werkende lokale verandering

`20261114101500_pitwall_learning_policy_in_persist.sql` voegt aan het bestaande
acht-argumentenresultaat van `simhub_persist_v3` één vierde veld toe:
`observation_policy`. De bijbehorende rollback herstelt de exacte eerdere
functie inclusief type, owner, grants en `search_path`, niet een blinde DROP.
Alle vroege retourpaden behouden hun resultaatstring en geven NULL-policy; alle
tien RETURN QUERY's passen bij het vierkolomsresultaat. Dat is daadwerkelijk in
PostgreSQL getoetst, niet alleen door TypeScript.

De Edge leest het ingebedde feit zonder aparte policy-HTTP-call. Alleen als het
veld **afwezig** is (oude database) gebruikt hij de bestaande begrensde fallback.
Aanwezig null/ongeldig is fail-closed zonder extra lookup; een geldige weigering
blijft een weigering. Publieke clientresponsvorm, device-/accountautoriteit,
client-TTL en historische betekenis zijn niet verruimd. Bestaande losse policy-RPC
blijft behouden zolang het pakket actief is.

## Eén vaste proef — numeriek PASS, zelfstandig herberekend

- Registratie SHA256:
  `00b94b29b1092240d07b8ea26252f1f245e0029b9e4ae7e4d71abf48478215a1`.
- Ruwe samples SHA256:
  `291c54522ef1688bc972b7269733f5965d57a5b4f413900e855b39305125a46a`.
- 40 warmups + 200 gemeten paren; alle 480 responses behouden, HTTP202.
- Per gemeten arm 196 gewone hot frames, 2 legacy- en 2 observation-laps;
  dezelfde ABBA/cadence/nearest-rank-statistiek en strikte grenzen als S2E4.
- p95 baseline 253.65473300000303 ms, kandidaat 219.09025599999586 ms;
  delta -34.56447700000717 ms. Beide grenzen (<=10% én <=20 ms toename) PASS.
- Alle validatiefouten leeg; kandidaat vijf private capture-batches/twee
  observation-rijen, baseline drie legacy-laps, kandidaat vijf laps.
- Kong policy-RPC-delta **0 over de hele run**; elf capability-probes zijn een
  andere, bestaande operatie en worden niet als policylookup verhuld.

Dit is de hele kandidaat tegenover de gevangen live bron, geen bewezen exclusieve
causale winst van deze ene wijziging en geen WAN/CDN/TLS- of productiebelasting-
garantie. S2E3/S2E4 blijven hun eigen geldige FAILs. Parent herberekende alle ruwe
samples onafhankelijk; geen meting herhaald en geen ongunstige sample verwijderd.

## Functionele en rollbackbewijzen

Builderbewijs: echte SQL pre-/forward-/post-rollback-contracten; volledige
kandidaat-entrytypecheck exit0; 4 entry-, 16 policy- en 239 observation-tests;
oude-pad-control faalt en herstelde bron is groen; elf benoemde HTTP-cases;
werkelijk overlappende permissie-/revocatieraces. Alleen een onafhankelijke review
kan dit als SPEC/QUALITY accepteren; die loopt afzonderlijk op de bevroren bron.

De eerste post-run audit telde zijn eigen geaccepteerde HTTP-fallbackproef ten
onrechte als rollbackmutatie. Deze proef voegt één legacy-lap, één capture-batch
en één job toe. Mislukte poging/artefacten zijn privé gearchiveerd. Builder
herbouwde alleen de eigen kandidaat-DB vanuit de goedgekeurde schemakopie om de
rollbackverificatie opnieuw uit te voeren; baseline en de gemeten ruwe data
bleven behouden. Dat is een nieuwe rollbackfixture, niet behoud van de oude
benchmarkrijen door een rebuild.

De gecorrigeerde audit meet afzonderlijk: vóór/na alleen S2E5-rollback exact gelijk;
dan de bedoelde fallbackwrite (precies drie verwachte nieuwe rijen); daarna exact
gelijke digests over alle resterende rollbacks. Een foutieve metadata-check op
`proargmodes='o'` miste TABLE-uitvoer (`t`); parent corrigeerde de telling en
hervatte alleen de resterende verificatie, zonder uitgevoerde DDL te herhalen.

`audit-finish-saved.log` exit0 en `SAFE-DISABLE.json` PASS: exacte oude functie,
fallback HTTP202 met één losse lookup, vijf globale schakelaars UIT, workerrechten
gesloten, legacy V1/V2/V3 bruikbaar en disabled observation afgewezen zonder
core-verlies. Dit is safe-disable met databehoud, geen volledige schemarestauratie.
De leer-schakelaars staan UIT; de eigen containers blijven uitsluitend voor
review/parentreadback draaien.

## Open productpoorten en bewijs

Onafhankelijke SPEC/QUALITY-acceptatie loopt; numerieke PASS is geen productie-GO.
Overgenomen clone-component-/rol-/publicatiekwalificaties en beperkte fresh-write-
taildekking blijven zichtbaar. Geen hele-DB-identiteitsclaim. Oude→nieuwe
updaterproef, echte geïnstalleerde connector, fitting/onafhankelijke modelscore,
zelflerend advies en test/live-UI-activatie zijn hiermee niet geleverd.

Privé bewijsroot:
`/home/hermes/artifacts/3sm/pitwall-learning-p2-policy-hop-20261114/`;
`REPORT.md`, `PARENT-INDEPENDENT-PERF.json`, `REGISTERED-BENCHMARK.json`,
`BENCHMARK-RESULT.json`, `SAFE-DISABLE.json`, `FINAL-HANDLES.json`.
Reviewroot: `/home/hermes/artifacts/3sm/pitwall-learning-p2-policy-hop-review-20261114/`.

Production frontend changes: NONE.
PRODUCTIEWIJZIGING: NEE.
