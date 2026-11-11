# Pitwall learning — beleidsvoorstel v1

**Status: P1 lokaal afgerond; vervolg-GO voor afgeschermde P2-bouw ontvangen. Niet op productie geactiveerd.**

P2 begint vanaf `79ca3381ee880bb145c91c9804da7584fc2b683a` na de afgeronde
P1-bouwacceptatie en Vincents vervolgopdracht (Discord `1570215019860332665`).
Dit staat lokale context-/kwaliteitskwalificatie, fysieke setintervallen en
stopsegmenten toe (T09–T12). T13 blijft conditioneel op een bewezen broncontractgat;
geen connector-/Edge-publicatie of geïnstalleerde DLL-wissel zonder aparte GO.
Geen productie-DDL, historische seed, nieuwe pooling, fitting/modeladvies,
autonome promotie, UI-copy/publicatie of start van P3 onder dit fasebesluit.
Account- en retentiegrenzen hieronder blijven ongewijzigd.

Vincent bevestigde op 11 november 2026 met “go p1” het voorgestelde eerste bereik: persoonlijk leren, geen nieuwe pooling, retentie 7/180/90 dagen en afgeschermde lokale bouw/tests van de bewijslaag. Dit is geen GO voor productie-DDL, publicatie, autonome promotie of modeladvies. De bestaande fuelroute, bandenpool en hun instellingen worden niet aangepast.

De hieronder genoemde account-/retentiekeuzes gelden als bouwcontract voor P1. De promotiegrenzen blijven een voorstel voor een latere aparte poort; geen productie-account is hierdoor automatisch ingeschreven of gewijzigd.

## Voorgesteld eerste releasebereik

- Eerst private bewijs-/revisiecapture en baseline-shadow; daarna next-complete-lap fuel. Geen nieuw model beslist nu iets.
- Eerste modelbijdrage uitsluitend `/admin/pitwall-test`, na aparte migratie-, visual-copy- en publicatie-GO. Geen endurance-/klassiekwijziging.
- Geen automatische SimHub-/iRacing-bediening, tankinstelling of live strategie-experimenten.
- Geen historische seed in de eerste productie-DDL. Een latere begrensde seed is een apart besluit en blijft `replay`/`as_of_unverifiable` waar eerder beschikbare revisies ontbreken.
- Bandenwear, pitverlies en economisch bandenadvies blijven afzonderlijke targets en mogen geblokkeerd blijven terwijl fuel vordert.

## P1-bouwcontract: accountgebruik

**Aanbevolen conservatieve start:** de nieuwe learninglaag alleen voor toegelaten persoonlijke sessies; geen nieuwe cross-accountbijdragen of nieuwe gezamenlijke model-serving totdat pooling en transparantiecopy afzonderlijk zijn goedgekeurd. Dit ontmantelt de bestaande bandenpool niet.

- `owner_user_id` op observatiemoment, device en simrijder zijn afzonderlijke begrippen. Huidig eigenaarschap is geen historisch eigendomsbewijs.
- Onbekende historische eigenaar/context → uitsluiten van fitting/serving; wel als onbekend bronprobleem tellen.
- Een account-policyversie moet capture, persoonlijke fitting, pooling en serving afzonderlijk kunnen begrenzen. Zonder toepasselijke policy geen nieuw modelgebruik.
- Account-/device-/sessie-ID's intern alleen voor provenance, groepssplitsing en verwijdering; geen e-mail, naam of token als modelkenmerk.
- Opt-out/verwijdering blokkeert betrokken modellen/pointers en vraagt herbouw zonder bijdrage. Een bronrij verwijderen is geen bewijs dat bestaande parameters vergeten hebben.
- Teamtoegang volgt bestaande bindings-/autorisatieregels en krijgt nooit de volledige pool of historische data van een latere device-eigenaar.
- Vijf externe accounts is alleen een voorgestelde minimale productgrens voor externe fijnmazige bijdragen, geen anonimiteitsclaim.

**Besluit voor P1:** persoonlijk eerst, geen nieuwe pooling. Een gezamenlijke pool vereist later een apart besluit.

## P1-bouwcontract: retentie

- Afgeronde jobs/transportadministratie maximaal 7 dagen.
- Compacte bronrevisies en voorbeelden maximaal 180 dagen; geen volledige raw frames/paceHistory kopiëren.
- Forecasts/evaluaties maximaal 90 dagen.
- Actieve/vorige modelmanifesten plus maximaal 90 dagen na retirement, binnen hetzelfde accountbeleid. Als het benodigde datasetbewijs binnen dat beleid niet behouden kan worden, versie laten verlopen/inactief maken.
- Geen uitzonderingsroute die opt-out/verwijdering stil overschrijft.

Deze termijnen zijn bevestigd als P1-bouwcontract, niet nu op productie ingesteld. Geen bestaande retentiejob is veranderd.

## Vast te pinnen automatische promotiegrenzen

Beleid vastleggen vóór scoring, nooit na een tegenvallende kandidaat versoepelen:

- Fuel: minstens 100 toegelaten rondes, 20 onafhankelijke sessies; minstens 10 train-, 5 kalibratie- en 5 testsessies in het verklaarde toepassingsbereik.
- Wear: minstens 30 gekwalificeerde onafhankelijke intervallen uit meerdere sessies. Unieke fysieke sets én sessies apart tellen. Vier hoeken zijn niet vier onafhankelijke sessies.
- Pitverlies: minstens 20 passende complete stops voor contextafhankelijk modeladvies. Absolute entry→exit is geen netto verlies of losse bandenkost.
- Chronologische train/kalibratie/testgroepssplitsing; hele set/sessie bij elkaar, gemeenschappelijke races als afhankelijkheid rapporteren. Onbekende-accountgeneralisatie apart van volgende sessie van bekende rijder.
- Voorgestelde puntfoutwinst minstens 10% gemiddelde absolute fout tegenover de vastgepinde bestaande baseline op holdout; gegroepeerde onzekerheidsrapportage verplicht.
- Nominaal 90%-bereik: werkelijke dekking, breedte en aantallen rapporteren. Nog vast te leggen per-target maximale breedte en toegestane score-/driftregressie; zolang niet vastgelegd geen automatische promotie.
- Fuel: geen slechtere onderschatting tegenover baseline en geen nieuwe geobserveerde kandidaatveroorzaakte droogrijsituatie in de toets. Geen belofte van nul toekomstig risico.
- Reserve/finishvariant blijven expliciet beleid; kandidaat mag reserve niet zelfstandig verlagen.
- Geen promotie bij ontbrekende verplichte metrics, privacy-/context-/schemafout, te oude toestand, ontbrekende broncontinuïteit of model-/manifesthashfout.
- Grote modelverandering blokkeert; niet achteraf tot een acceptabel getal afknippen.
- Activatie target×surface met generation/CAS en audit. Kill switches voor capture, worker, shadow en modelgebruik afzonderlijk; vorige passende versie of bestaande baseline als terugval.
- Wear-validatie is géén vrijgave van economische bandenkeuze; pace/warm-up/marginale servicekosten vergen eigen bewijs.

**Open besluit:** deze startgrenzen en de nog ontbrekende breedte-/driftgrenzen vaststellen vóór automatische promotie. P0 is niet de promotie-GO.

## Resource- en performancepoort

Voorgestelde startbudgetten: één worker, maximaal twee DB-connecties, maximaal 1000 bronrecords/pagina, 256 MiB, 0,25 CPU, maximaal één kandidaatrun/uur/target en alleen bij veranderd manifest. Drie pogingen/backoff, daarna dead-letter; geen permanent retry-loop.

Container op bestaand intern Docker-netwerk, niet-root, read-only rootfilesystem, geen published port of Docker-socket; eigen beperkte DB-rol met bounded EXECUTE, geen admincredentials. Runtime-image op gecontroleerde digest; dependency audit/lockfile blijft P1/workerpoort.

**Niet bewezen onder raceload:** de P0-momentopname is geen loadtest. Bij de audit was geen verse succesvolle ingest in de laatste 15 minuten zichtbaar. p50/p95-ACK/end-to-endlatentie is daarom niet gemeten. Cumulatieve `pg_stat_statements`-gemiddelden vervangen die toets niet.

Voor productie-DDL in private PG15.19-kloon met exacte live functies en parserbytes: dezelfde begrensde inputreeks baseline/kandidaat; geldig frame, oude/nieuwe client, volle batch, replay, lock/fout/queueachterstand. Eis: geen extra afwijzing of ACK-/replayverschil; p95-toename maximaal 10% én maximaal 20 ms, strengste grens; geen onbegrensde capture-scan; worker binnen 256 MiB. Geen fixtures of performanceprobes met writes op productie.

## Fasebesluit

P0-dossier levert de feiten voor een eerste releasebesluit; dit document is geen vooraf ingevulde PASS. Accountgebruik, retentie en het eerste lokale P1-bereik zijn bevestigd met “go p1”. Exacte DDL/rollback/backup/clone-rehearsal blijft aparte productiepoort. Autonome modelpromotie en nieuwe zichtbare copy hebben later hun eigen GO.

**Productiefrontendwijzigingen: NONE. PRODUCTIEWIJZIGING: NEE.**
