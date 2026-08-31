# 3SM SimHub Endurance Connector — Updategids & schaagnotities

## Voor deelnemers: hoe verloopt een update?

De plugin koppelt **eenmalig**. Een update zit verpakt in één DLL-bestand en laat je
koppeling intact — je hoeft **niet opnieuw te koppelen** na elke update.

1. Download het nieuwe artifact van GitHub Actions (de **3SM-EnduranceConnector-SimHub-…**-bundle).
2. Sluit SimHub volledig af.
3. Vervang de oude `3SM.EnduranceConnector.dll` door de nieuwe (map met `SimHubWPF.exe`).
4. Rechtsklik → Eigenschappen → eventueel **Blokkering opheffen**.
5. Start SimHub opnieuw.

**Pairing blijft:** de device-token staat versleuteld opgeslagen en wordt bij upgrade
bewaard. Je hoeft zelden een nieuwe paar-code aan te vragen.

## ⚠️ Eenmalige bootstrap van 0.3.8.0 → 0.3.9.0 (belangrijk)

0.3.8.0 had een defect: de ingebedde updater vereist 10 invoerargumenten, maar de
0.3.8.0-connector gaf er maar 6 mee. Daardoor **lukte de automatische self-update-knop
niet** (de updater stopte met `Verplicht updaterargument ontbreekt: --started-utc-ticks`).

**Vanaf 0.3.9.0 werkt de automatische self-update weer normaal.** Die énige overgang van
0.3.8.0 naar 0.3.9.0 gebeurt daarom handmatig, via dezelfde officiële methode als elke
andere update (hierboven), die het defect volledig omzeilt:

1. Download het **0.3.9.0**-artifact (deploy-bundle / GitHub Actions).
2. Sluit SimHub volledig af.
3. Vervang de oude `3SM.EnduranceConnector.dll` door de 0.3.9.0-variant (map met `SimHubWPF.exe`).
4. Rechtsklik → Eigenschappen → zo nodig **Blokkering opheffen**.
5. Start SimHub opnieuw.

**Controle achteraf (optioneel):** je ziet in de status van de plugin of 0.3.9.0 actief is.
De oude 0.3.8.0-settings en je koppeling (device-token) blijven behouden.

Daarna kan de plugin weer **automatisch** toekomstige versies installeren via de normale
geharde 10-arg self-updater (geen handmatige vervanging meer nodig).

## Waarom géén automatische update?

SimHub heeft **geen native auto-update** voor externe plugins die naast `SimHubWPF.exe`
in Program Files liggen. De plugin doet wél een **veilige, eenmalig-per-24-uur**
versie-check (naar `…/simhub-version`) en toont **"Nieuwe versie beschikbaar · vervang de
DLL en herstart"** in de status. De plugin vervangt zelf **nooit** de DLL: dat zou
schrijfrechten op Program Files, AV/code-signing en een niet-bestaande betrouwbaarheidsketen
vereisen — een disproportioneel risico voor deze community.

## Schaagbaarheid (~30 man)

De limieten zijn in de code geverifieerd en ruim toereikend voor tientallen deelnemers:

| Laag | Limiet | Gevolg bij 30 man |
|---|---|---|
| Plugin-interval | 1000 ms → 1 verzoek/s per device | ieder op eigen thuis-IP: 1/s ✓ |
| Edge ingest per IP | 600/min = 10/s per address | gedistribueerd thuisnetwerk ✓ |
| DB ingest per device | 400 ms gate + latest-only | 30 rijen, triviaal |
| Cloudflare per IP | 300/10 s = 30/s | gedistribueerd ✓ |
| Realtime (Race Control) | channel per device | tientallen subs, self-hosted ✓ |

**Belangrijkste schaalfactor:** iRacing onthoudt live telemetry aan niet-rijdende teamleden
(anti-cheat). Per team is dus maar **één device tegelijk "live"** → bij 30 man ~het aantal
teams, niet 30 streams. De `isInCar`-heartbeat van niet-actieve devices houdt dit licht.

**Uitzondering voor iedereen achter één NAT/office-IP:** dan lopen jullie gezamenlijk tegen
de 10/s-ingest-grens aan. Op thuisverbindingen (de realiteit) is dit geen probleem.
