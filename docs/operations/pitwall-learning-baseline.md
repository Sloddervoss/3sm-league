# Zelflerende pitwall — P0 feitendossier

**Datum:** 11 november 2026. **Status:** technische P0-audit en bronmap afgerond; onafhankelijke specreview PASS en kwaliteitsreview APPROVED, geen blockers. Beleids-/scopepoort vóór P1 nog open. Geen model-/productie-PASS.

## Scope en isolatie

- Uitvoeringsopdracht: “Ga aan het werk” op het implementatieplan van 11 november 2026. Volgens §21 eerst P0; aparte productie- en autonome-promotiepoorten blijven gelden.
- Fasebasis en `origin/main`: `c0cf8f194a86898621b26dd4ffa41956f1e8ecf3`; hoofdwerkboom blijft op `1877369e428d04c386a0bb9172cb87b042bc9d57`.
- Eigen werkboom `/home/hermes/wt/pitwall-learning-p0`, branch `feat/pitwall-learning-p0`, bij start schoon. Bronmap apart op dezelfde exacte basis, branch `docs/pitwall-learning-source-map`.
- Verschil tussen functionele basis en main is uitsluitend twee operationele documenten. Geen bestaande werkboom, appcode, brondata, rol, functie, cron of connector vervangen.
- `AGENTS.md`, `HERMES.md`, `docs/AI_START_HERE.md`, systeem-/data-/rollenmap en productie-accessrunbook gelezen. Verouderde runbookwaarden over PG15.8 en `/opt/3sm` niet als live waarheid gebruikt.
- Geen commit/push/merge/deploy gedaan; fasebestanden zijn lokale reviewdelta. Auteurconfig gecontroleerd: Sloddervoss met de afgesproken noreply-identiteit.

## Live baseline, alleen lezen

Toegang: `ssh 3sm-docker` → `docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`. Alle audit-SQL expliciet `READ ONLY`, lokale statement-/lock-/idle-timeouts en afsluitende `ROLLBACK`. Geen RPC aangeroepen die ingest, fitting of onderhoud uitvoert.

Catalogussnapshot 15:35:56 UTC, aggregateaudit vanaf 15:41:42 UTC; dit zijn momentopnamen, niet dezelfde transactie. PostgreSQL 15.19, database `postgres`, gebruiker `supabase_admin`, system-ID `7618318406906855462`, read-only `on`, SSL `off`. Geen schema `pitwall_learning` of learningrol aangetroffen. Geen canonieke applicatie-migratieledger; bestaande realtime-/supabase_functions-ledgers niet voor de app aangezien.

Vastgelegd in afgeschermd lokaal bewijs: source-kolommen, public relaties/owners/ACL/RLS, policies, relevante triggers/indexen/constraints, default ACL's, cron en 115 relevante functiedefinities met SHA-256. Definitieve artifactmanifest/hash wordt na eindcontrole toegevoegd; ruwe definities blijven buiten Git en Discord.

Belangrijke live `pg_get_functiondef`-hashes:

- `simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)` — `ace4d500960d4853624b039fdf25f3293f9054b79b086aa26ff600baae8dde35`.
- `simhub_persist_v3` — `618e300c52d715f61a243efc0e1157845dc36602e57488f906dc40348924262f`.
- `simhub_update_strategy_v3` — `83e72a73309c2606a163e959c120b1ebc3f3f7806ae018d89b36ada6f43939d6`.
- `get_pitwall_data(uuid,uuid)` — `a0b6a09a7771c3b4ac1fdbde76d9db191b8faa89500a117399d048460a3bab05`.

Deze hashes identificeren de volledige body, niet alleen de functienaam. Voor toekomstige DDL opnieuw de live baseline vergelijken; P0 bevriest productie niet.

## Wire-/deploymentwaarheid

De connector kiest `simhub-ingest-v3` (`EnduranceConnectorPlugin.cs:30`). Entry plus alle 12 ontdekte lokale importdependencies zijn op de werkelijke Edge-mount SHA-256-gelijk aan de gekozen repo-basis. Onder meer `simhubExtensions.ts` is `d3f5e40e06562e8cfea0907c9db672b31742146ba38457446072bb98e1c21212` en V3-entry is `b9dce7b057180f6a236ed50b17b85cdede49b5318b6f46dbdfea99d42d8d8d43`.

De oude `simhub-ingest/index.ts` wijkt wél af: live directe fetch-RPC plus twee oude error-mappings in plaats van supabase-js. Dit is genoteerde legacydrift buiten de nieuwe V3-route; niet “hersteld” of als V3-blocker voorgesteld.

Actieve SEO-service gebruikt `/opt/3sm-release-1877369e`, timer actief. `/var/www/3sm/assets/index-CHjAIX4T.js` SHA-256 `a70ba21b5f24b230a729b4c08cbc3de97df0ac683768183612b48c09e22036dd`. Default `node` op webhost is v20.20.2; de bewezen Node24-binary is expliciet `/opt/node24/bin/node`, v24.21.0. Toekomstige workerbouw mag niet blind de default node gebruiken.

## Werkelijke dekking versus onafhankelijke voorbeelden

Auditbron: `scripts/pitwall-learning/audit-sources.sql`. Alleen globale tellingen, geen namen, tokens of individuele records. Kleine aantallen zijn niet automatisch anoniem; dit is een intern technisch dossier.

- Fuelbaseline: 286 rondes, 232 bestaand-geldig; **7 device-sessies met geldige monsters**, 15 race-runs over de volledige tabel. Dat zijn niet 232 onafhankelijke sessies of 15 onafhankelijk gevalideerde tests. Nieuwe modeltoelaatbaarheid/historische accountdekking nog onbekend.
- Lap summaries: 424, 339 complete-flag, 11 geobserveerde device-sessies en 38 segmenten; slechts 3 distinct gerapporteerde observed-session-ID's. Geen van die tellers bewijst automatisch unieke onafhankelijke races. 43 records falen de opnieuw gelezen coverage-eisen; 85 hebben invalid reasons. 107 zijn pit-flag true, overige 317 NULL; geen expliciete false. Driver-changed true 2, overige 422 NULL. Fuel-added 15 positief en 409 onbekend. De conservatieve audit eist expliciete niet-pit/niet-driverwissel/geen-refuel en telt daarom **0 structurele kandidaten**, niet “0 normale rondes”. Eerst contractsemantiek bewijzen; NULL niet stil false/nul maken.
- Measurement-events: 201 over 11 geobserveerde device-sessies; 58 service-completed, 104 value-changed, 38 session-start, **1 refresh-confirmed**. Een eventnaam is nog geen volledig gekwalificeerd interval.
- Per-cornerdiagnostiek: 156 gerapporteerde generatiegroepen, 4 generatieovergangen en 155 wearstijgingen zonder gerapporteerde generatieverandering. Diagnostisch, geen fysieke-setteller. Tijdties, oude revisies en reset-/refreshsemantiek vergen kwalificatie; onbekende gekwalificeerde sets blijven `NULL`.
- Tyrelaps: 1152 over 81 device-sessies, 1037 met car/track-key, 17 sleutelcombinaties, 117 met compound én baantemperatuur. Herhaalde last_available-waarden zijn geen onafhankelijke wear-ankers.
- Priorbijdragen: 87 records, 59 device-sessies, 76 legacy set-numbergroepen. Die 76 zijn niet bewezen onafhankelijke fysieke sets volgens het nieuwe contract.
- Pitstops: 1 record, **0 gesloten entry/exit en 0 ingevulde pitduur**. Dat ene record is dus nog niet eens een gemeten netto-pitbenchmark. Netto vergelijkingssegment/servicecomponent ontbreken als trainingsbewijs.
- Huidige device-eigenaren: vier source-devices horen nu bij vier accounts. Historische eigenaar op observatietijd is daarmee niet bewezen en blijft onbekend; geen nieuwe pooling op deze join.
- Oude priorqueue: 789 afgehandeld, 0 onafgehandeld, 0 met opgeslagen fout. Bestaande drain `tyre_prior_drain(50)` elke twee minuten, alarm elke vijf minuten. Geen tweede job nodig of gemaakt.

## Tijd, revisies en identiteit

- Live batchstore actualiseert hogere revisies **in-place** en vervangt `received_at` met `now()`. UID/revision/hash zijn aanwezig, maar oude overschreven revisies kunnen niet uit de huidige rij teruggetoverd worden. Een nieuwe private snapshotlaag moet die geschiedenis vanaf capture expliciet bewaren; historisch replay krijgt geen echte pre-outcomeclaim.
- 208/424 lap-eindtijden en 116/201 event-observatietijden liggen ná serverontvangst; maximale afwijkingen respectievelijk 2,678363 s en 2,622697 s, geen daarvan boven 60 s. Dit bewijst beperkte klokordeningproblemen in die momentopname, niet de precieze oorzaak. Geen timestamps corrigeren of toekomstinformatie toestaan op basis van een gegokte offset.
- `known_at` is serverbeschikbaarheid; echte uitgiftetijd en knowledge cutoff moeten op serverklok bevroren worden. Model/horizon/order moet ook bij vertraagde levering of klokambiguïteit conservatief kwalificeren.
- Observed SDK session en delivered transport session hebben verschillende ID-domeinen. Dat ze in alle huidige records ongelijk zijn, is **geen** bewijs dat alles offline/laat is afgeleverd. Niet blind vergelijken als één sessietype.
- De measurement-event- en lap-summaryarchieven hebben geen directe historische owner/car/layout/compound-/regulationskolommen; die provenance mag niet uit de nieuwste device-snapshot komen. Exacte bron-/join-/fallbackkaart staat in `docs/contracts/pitwall-learning-source-map.md`, inclusief door de parent gesloten livecontroles. Batchstore- en persist-v3-body zijn parser-geëxtraheerd byte-exact aan de betreffende migratiebody vergeleken. `current_driver_id` op de lap is een servermatig uit de simrijdernaam opgeloste 3SM-user-UUID, geen raw iRacing-ID en niet automatisch de device-eigenaar.

## Resource-/latentiepoort

Hostmomentopname: 8192 MiB RAM, 5901 MiB beschikbaar, geen swap, 33 GiB vrij op relevante filesystem. DB circa 235,1 MiB, Edge circa 242,1 MiB, Kong circa 473,3 MiB. Een momentopname is geen raceloadgarantie; Kong CPU was die seconde 57,31%.

Laatste 15 minuten: geen V3-ingestrequests gevonden in begrensde accesslogs en geen verse succesvolle ingest in device-health. Laatste health-gerapporteerde succesvolle ingest 11:01:31 UTC. Geen testframes of pairingwrites opgewekt om de audit mooier te maken.

Cumulatieve `pg_stat_statements` voor de bestaande persist-query: 831906 calls sinds reset 3 augustus 2026, gewogen gemiddelde 5,356019 ms, maximum 5091,316231 ms. Dit is SQL-uitvoertijd over een lange periode, **geen** p50/p95 end-to-end-/ACK-benchmark. `track_functions=none`. p50/p95/ACK-replayverschil blijft niet gemeten en dus geen PASS. De private P1-rehearsal moet dezelfde inputs baseline/kandidaat met lock-/workeruitval vergelijken; budgetten in het beleidsvoorstel.

## P0-beleid en fasegrens

Voorgesteld beleid: `docs/contracts/pitwall-learning-policy-v1.md`. Aanbevolen eerste release: private capture + baseline-shadow, persoonlijk eerst, geen nieuwe pooling, geen historische seed en geen modeladvies. Retentie 7/180/90 dagen en modelminimums uit het plan zijn expliciete beslispunten, geen nu ingestelde waarden. Per-target maximale intervalbreedte/driftgrenzen ontbreken nog voor autonome promotie.

De bronmap is gecontroleerd. Nog nodig vóór de P1-startpoort: akkoord op datagebruik/retentie/eerste releasebereik; daarna exacte private-schema/capture-implementatie en rehearsal. Gebrek aan 20 onafhankelijke fuelsessies of bewezen wearintervallen blokkeert **modelpromotie**, niet het bouwen van veilige bewijs-/shadowinfrastructuur na die scope-GO.

## Checks en impact

- Audit heeft een echte rode testuitkomst gehad vóór het SQL-bestand bestond. Onafhankelijke specreview PASS met guard-/dekkingsbevindingen; daarvoor nieuwe tegenproeven eerst rood gedraaid. Nu 16 SQL-parser/safetytests PASS en echte productie-read-only uitvoering met alle 10 JSON-secties. Laatste audit 16:00:16 UTC; SQL-SHA256 `9114a633fec31ef8cf685ddb1092a08ec93fd399dcb1119643cbdf06abf72004`. Definitieve bewijsartifactmanifesten staan in de beschermde bewijslocatie hieronder.
- De guard controleert nu alle tien secties exact éénmaal, zonder dubbele JSON-keys, en de verplichte NULL-counts per eigen sectie. Distinct gerapporteerde sessie-ID's, allowlisted uitsluitredenhistogrammen en prior-contrib/queue in de diagnostische device-union zijn toegevoegd. Redenfrequenties kunnen meerdere redenen per ronde tellen; ze niet als onafhankelijke voorbeelden of unieke afgekeurde rondes optellen. Vrije/onbekende redenlabels worden niet geëxporteerd.
- Catalogus opnieuw read-only gelezen: pre 15:35:56 UTC, definitieve post 16:10:40 UTC, dus ná de laatste audit van 16:00:16 UTC. Alle 8 vaste catalogussecties exact gelijk (91 public relaties, 165 policies en de vastgelegde functies/grants/triggers/indexen/cron). Canonieke pariteit-SHA256 `560c3b4b43699701978c23290b426a4440e9dba82f2f6c749a11f5762eafa6fc`. Dynamische identiteitstimestamp apart gehouden. Dit is een non-interferencecheck, geen database-backup of prestatietest.
- Tegenproeven omvatten DML, write-CTE, SELECT INTO, row locks, niet-allowlisted functie, persistent SET, onbegrensde timeout, READ WRITE, COMMIT en tweede transactie. Dit zijn offline guardtests, geen productiefoutinjection.
- Appcode ongewijzigd; geen nieuwe app-build/volledige Vitestsuite/typecheck als P0-bewijs geclaimd. De oude bekende releasebaseline blijft historische context, geen opnieuw gemeten groen oordeel.
- Frontend/UI/SEO: geen functionele impact. Backend/API/bot/auth/rollen: geen writes of contractwijzigingen. Data/DB: uitsluitend SELECT-audit; geen DDL/migratie/backfill. Deployment: niets gepubliceerd of herstart. Nieuwe scripts en contractdocs zijn lokaal reviewwerk.

**Productiefrontendwijzigingen: NONE. PRODUCTIEWIJZIGING: NEE.**

## Bewijslocatie en open poort

Definitief beschermd bewijs en SHA-256-manifest buiten de tijdelijk opgeschoonde scratchmap:
`/home/hermes/artifacts/3sm/pitwall-learning-p0-20261111/`.
Alleen de korte rapportage wordt als tekstbijlage gedeeld; ruwe functiedefinities/catalognamen
en infrastructuurdetails blijven intern. Het package-manifest legt de zeven lokale reviewbestanden
vast; dit is geen gepushte commit of productierelease.

Technische audit: PASS. Beleid en start P1: wacht op expliciete scopebevestiging.
Aanbevolen: persoonlijke leerroute, geen nieuwe pooling, termijnen 7/180/90 dagen, eerst
private capture + baseline-shadow; geen historische seed, modeladvies, frontendpublicatie of
productie-DDL onder die lokale bouw-GO.

### Ontvangen P1-bouwGO

Vincent bevestigde op 11 november 2026 met “go p1” (bericht `1570111234442002505`)
het voorgestelde persoonlijke bereik en de termijnen 7/180/90 dagen. De P0-rapportage
hierboven beschrijft de situatie bij oplevering; de lokale P1-startpoort is nu geopend.
De beoordeelde P0-delta wordt lokaal gecommit en vormt de exacte basis van een nieuwe
schone P1-werkboom. Geen push, productie-DDL, publicatie of modelactivatie onder deze GO.
