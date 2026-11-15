# GO-poort — read-only productiebasis en geïsoleerde clone-/latencyproef

**Status: GO ontvangen op 14 november 2026, Discord `1571098628259582075`.**
Uitsluitend onderstaande read-only productievoorbereiding en geïsoleerde cloneproef;
geen productie-DDL/deploy-/activatie-GO. Uitvoerwerkboom begint op `e36718a6`;
de functionele codebasis blijft `e939c32a`.
Bevroren codebasis: `e939c32aa5dd73d9d6ebf4a9b8e5a108e3c39277` op
`feat/pitwall-learning-p2`, boomgelijk aan onafhankelijk geaccepteerd `88f0b7e`.

## Waarom deze poort echt nog nodig is

De client en policy-publisher zijn lokaal geaccepteerd; de geteste SQL-basis was
bewust een minimale synthetische fixture met oudere wrapper. Dat bewijst geen
compatibiliteit met alle actuele live-objecten of totale ingestlatency. Er is nog
geen actief zelflerend advies en niets uit dit pakket is geïnstalleerd/geactiveerd.
Geen nieuwe modelreview van ongewijzigde clientcode; geen herhaling van de minimale
SQL-proef. De ontbrekende informatie komt uit de echte catalogus en realistische clone.

## Eén gevraagde scope

1. **Alleen-lezen productie-inventarisatie** via de bestaande self-hosted runbookroute
   op `3sm-docker`: identiteit/versie, relevante schema-objecten/kolommen/constraints/
   indexes/owners/effectieve ACLs, bestaande functieversies en applicatiemigratieledger
   vaststellen (niet aannemen). Alleen metadata; geen telemetrypayloads, gebruikers-
   of accountpolicy-rijen, tokens, wachtwoorden, servicekeys of env-dumps ophalen.
2. **Begrensde schema-only basis**, indien nodig, naar een afgeschermde lokale
   artifactmap. Geen productierijen of globals/passworddump. Relevante Edge-bron- en
   dependencyversies alleen-lezen vaststellen zonder container-env/geheimen te loggen.
3. **Volledig aparte wegwerpclone** met uitsluitend synthetische testidentiteiten/
   gegevens. Eerst resources, image-digests, namen/netwerk/volumes/ports en de backend-
   route hard verifiëren. Geen productievolumes/bindmounts of Docker-socket in test-
   containers; geen gepubliceerde hostpoort. Alle schema-/fixture-/flagwijzigingen
   uitsluitend in de bewezen clone. Productie krijgt geen canary of testverzoek.
4. **Werkelijke ingest-/rollback-/compatibiliteitsproef** met passende huidige
   parser- en RPC-bytes, inclusief ontbrekende publisher/foutpad, legacyclient,
   nieuwe client, geldige/ongeldige batches, replay en policy-denial. Een ontbrekende
   baseline/dependency eerst expliciet herstellen in de clone, nooit op productie.
5. **Vooraf vastgelegde matched baseline/kandidaat-latencyproef**: inputreeks,
   toestand/rollen, warming, samples, volgorde, statistic en stopregel vóór uitvoering
   pinnen. p95-toename maximaal **10% én 20ms**, strengste grens. Geen extra core-
   afwijzing of onbedoeld ACK/replayverschil. Ruwe samples mechanisch narekenen;
   geen gunstige retry, afrondings-PASS of microquery verkopen als full-pathbewijs.

## Harde verboden

- Geen productie-DDL/DML, migratie, privilegewijziging of accountinschrijving.
- Geen productie-Edge/config/flags, website-/pitwallpresentatie, SimHub-installatie,
  GUI/herstart, release/signing/manifest/kanaal/updaterwijziging.
- Geen cloud/PAT-route, ongeautoriseerde installs/upgrades of pulls.
- Geen productieframes/fixtures, live experimenten, pooling, fitting/modeladvies of
  autonome promotie. Beperkte testconfiguratie mag alleen in de eigen clone.

## Oplevering en grenzen

PASS/FAIL per werkelijke cataloguscompatibiliteit, rollback, functionele pariteit,
volledige entrytypecheck en full-pathlatency. Onmogelijke/ontbrekende route betekent
OPEN/BLOCKED met concreet ontbrekend bewijs, niet een verzonnen PASS. Leg de exacte
code- en objecthashes, commando-exits, schemabasis, clonehandle/identiteitsguards en
ruwe samples vast; verifieer gerichte opruiming van alleen eigen wegwerpresources.

Een eventuele PASS is nog steeds **geen** GO voor productieapply/deploy, enrollment,
clientactivatie of modelgebruik. De echte ondersteunde oude→nieuwe automatische
updateproef blijft apart verplicht; geen bootstrap of handmatige DLL als vervanging.

Productiefrontendwijzigingen: NONE. PRODUCTIEWIJZIGING: NEE.
