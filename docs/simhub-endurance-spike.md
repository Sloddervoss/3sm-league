# 3SM SimHub Endurance spike

Lokale technische proef voor adviserend live Race Control. Deze spike verstuurt geen data naar productie, Supabase of Discord.

## Onderdelen

- `contracts/simhub-telemetry.v1.schema.json` — versieerbaar datacontract.
- `tools/simhub-bridge/server.mjs` — lokale, token-beveiligde HTTP-bridge op loopback.
- `tools/simhub-bridge/simulate.mjs` — reproduceerbare iRacing-telemetriesimulator.
- `tools/simhub-plugin/3SM.EnduranceConnector/` — SimHub 9.x/.NET Framework 4.8 pluginbron.
- Race Control → **SimHub live telemetry** — adviserend browserpaneel.

## Lokale end-to-end demo

Open twee terminals in de repository:

```bash
npm run simhub:bridge
npm run simhub:simulate -- --count 120
```

Open daarna de lokale Endurance-pagina op **dezelfde pc als de bridge**, kies Race Control en klik **Lokale bridge koppelen**. Geef de browser toestemming voor lokale netwerktoegang als Chrome/Edge daarom vraagt. Standaardwaarden:

```text
Bridge: http://127.0.0.1:8787
Token:  local-3sm-simhub-spike
Event:  event-road-america-6h
Team:   team-orange-31
Driver: user-jaimy
```

Selftest:

```bash
npm run simhub:self-test
```

De bridge accepteert maximaal 32 KB per pakket, vereist een Bearer-token, weigert onbekende velden en niet-oplopende sequence-nummers en bewaart alleen het laatste pakket per event/team in geheugen.

## Plugin bouwen op Windows

Vereisten:

1. SimHub 9.x geïnstalleerd.
2. Visual Studio 2022 Build Tools.
3. .NET Framework 4.8 targeting pack.
4. PowerShell.

Build zonder installatie:

```powershell
cd tools\simhub-plugin\3SM.EnduranceConnector
.\build.ps1
```

Build en kopieer de DLL naar de lokale SimHub-installatie:

```powershell
.\build.ps1 -Install
```

Herstart SimHub, activeer **3SM Endurance Connector** onder Plugins en vul bridge, token, event-ID, team-ID en coureur-ID in. De geavanceerde propertymapping is aanpasbaar als een SimHub-profiel andere propertynamen gebruikt.

## Bewuste grenzen

- De plugin gebruikt uitsluitend gedocumenteerde `IPlugin`/`IDataPlugin`-interfaces en genormaliseerde properties; geen raw iRacing-objecten.
- `DataUpdate` doet geen blokkerende netwerkcall. Maximaal één achtergrondrequest per ingesteld interval wordt gestart.
- Alleen loopback-HTTP is toegestaan. Dit is dus een same-PC ontwikkelproef, geen productiearchitectuur.
- Telemetry verandert nooit automatisch een stint of planning.
- De Linux CI-host kan het WPF/.NET Framework 4.8-project niet tegen echte SimHub-DLL's compileren. De definitieve DLL-build moet daarom op een Windows-pc met SimHub plaatsvinden.
- Voor livegebruik is later een server-side ingestservice met korte pairingcodes, team/eventautorisatie, rate limiting, Realtime en auditlogging nodig.

## Onderzochte SimHub-versie

- Release: SimHub `9.11.21`, gepubliceerd 2 juli 2026.
- Officiële wiki: plugin-SDK gebruikt Visual Studio 2022+, C#/WPF en het meegeleverde `User.PluginSdkDemo`.
- Interfaces gecontroleerd tegen de publieke SDK-demo-signatures: `IPlugin`, `IDataPlugin`, `IWPFSettingsV2`, `Init`, `DataUpdate`, `End` en `PluginManager`.
