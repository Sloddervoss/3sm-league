# GO-dossier — live sectoren 0.7.6.4

## Opdracht en grenzen

Vincent: `fix het`, bericht `1572341105910087723`.
Implementatie/bouw/test van de samenhangende plugin-, opslag- en Pitwall-fix.
Publicatie, manifestwissel, productie-DDL en installatie wachten op aparte GO.

- Exacte basis: `a4545823d725a44e3758f2910091f32b8c00d441`.
- Werkbranch: `release/simhub-0.7.6.4`.
- Bevroren gedeeld contract: `docs/contracts/live-sector-updates-v1.md`, commit `f4accfe3`.
- Actuele stabiele manifestversie uitgelezen: 0.7.6.3; doel 0.7.6.4.
- Recent gemelde vloot: 0.4.2.1, 0.7.6.2, 0.7.6.3 en onbekend. Dit is geen
  belofte dat iedere aanwezige versie dezelfde automatische upgradeproef doorstaat.
- Geen functionele wijziging aan updater, koppeling, brandstof-/bandenleren,
  verplichte V3-framevelden of de bestaande vaste premium-layout.
- Bestaande PACE-toestemming/enablement blijft gelden; geen nieuwe default-off knop.

## Onderverdeling

- Plugin: `fix/live-sectors-plugin-0764`, eigen werkboom vanaf contractcommit;
  alleen meting, publicatiecadans, versie en bijbehorende diagnostiektests.
- UI: `fix/live-sectors-ui-0764`, eigen werkboom vanaf contractcommit;
  bestaande normale/klassieke en premium sectorconsumers en tests.
- Integratiebranch: optionele TS-validator, pure JSONB-merge, paired rollback,
  serializer-interop en echte Windows-vendorbuild. Geen gedeelde checkout/branchwissels.

## Bewezen tussenpoorten

- PASS: 28 nieuwe contracttests liepen eerst rood (26 failures); daarna 60/60
  nieuwe plus bestaande PACE-tests groen. Echt V3-normalisatiepad inbegrepen.
- PASS: 25 regressies op echte geïsoleerde PostgreSQL 18.6 via PGlite 0.5.16.
  Dit is GEEN uitgevoerde proef op productie-PostgreSQL 15.
- PASS: ontbreken van nieuwe key behoudt oud gedrag; fout optioneel sectorblok
  kost geen bestaande metingen of core frame. Volledige-rondesom blijft gekeurd.
- PASS: voorlopige sector voor finish; vasthouden na vijf seconden; onafhankelijke
  volgende-rondevervanging; juiste vorige-bestreferentie; verificatie/invalidation;
  duplicaten/reordering, bronreset en 40 auto's met 16 sectoren begrensd.
- PASS: werkelijk uitgelezen bestaande projector behoudt nieuwe sectorvelden ook
  voor niet-geselecteerde tegenstanders, inclusief vereiste nullfeiten.
- PASS: bestaande merge-signatuur, STABLE, invoker en bestaande ACL blijven gelijk;
  nieuwe helpers zijn alleen voor de bestaande vertrouwde rollen uitvoerbaar.
- PASS: forward en rollback weigeren een onverwachte functiebasis; rollback is in
  de geïsoleerde engine uitgevoerd en herstelt de oude functie exact.
- PASS: Beest via SSH bereikbaar, echte SimHub SDK-DLL's en VS Build Tools aanwezig.
  Geïnstalleerd: 0.7.6.3, SHA-256 gelijk aan stabiel manifest.
- Windows dagelijkse werkboom bevat drie bestaande gebruikerswijzigingen aan
  EnduranceConnectorPlugin.cs, FlagProfileInstaller.cs en SettingsControl.cs.
  Die blijven onaangeroerd; ook de oudere Desktop-DLL wordt niet overschreven.

## Open poorten — niet als klaar melden

1. Plugin- en UI-commits integreren; eigen diff- en volledige relevante regressiecheck.
2. Echte C# serializer → TS-normalizer/snapshot → SQL-merge/projector → UI-consumer.
3. Schone exacte commit archiveren met bronmanifest; full net48/vendor-SDK Release
   in unieke Windows-scratchmap, zonder GUI/procesactie/installatie/Desktop-copy.
4. Werkelijke DLL/updater/log terughalen, assemblyversie en inputs controleren,
   geïnstalleerde/Desktop-hashes vóór/na bewijzen en één artifact bevriezen.
5. Echte browsercontrole van gebouwde bestaande app met gemarkeerde replay waar
   nodig; geen synthetische data als live nauwkeurigheid of gereden ronde opvoeren.
6. Bron- en contractreview afsluiten; exacte BLOCKED/OPEN gates blijven zichtbaar.
7. Publicatie en ondersteunde 0.7.6.3 → bevroren 0.7.6.4 apparaatupgrade apart
   uitvoeren en bewijzen. Geen download of offline harness als echte upgrade tellen.

## Latere uitrolvolgorde na GO

Bewaar eerst huidige manifestwaarden, validatorbestanden en functiedefinities met
hashes. Valideer daarna serveracceptatie/merge vóór een nieuwe connector wordt
aangeboden. Gebruik alleen de nieuwe optionele PACE-parser en de pure mergehelper;
vervang NOOIT simhub_persist_v3 of de bestaande late-sessiestartfix.
Publiceer exact bevroren DLL/ZIP via bestaande ondertekende updatepad, werk download-
pagina en tests consistent bij, behoud oude assets/downloads en controleer daarna
werkelijk geladen clientversie, verse oude telemetrie én meerdere losse sectoren.

## Bewijs

`/home/hermes/artifacts/3sm/sector-live-0.7.6.4/`:
parser-red.json, parser-green.json, sql-green.json, windows-preflight.json,
production-pace-merge-before.sql en production-pace-project-before.sql.

Productie frontend changes: NONE.
Productie backend/DB/plugin changes: NONE.
PRODUCTIEWIJZIGING: NEE
