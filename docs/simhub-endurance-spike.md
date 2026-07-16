# 3SM SimHub Endurance telemetry

Adviserende live iRacing-telemetry voor Endurance Race Control. Handmatige Race Control blijft altijd beschikbaar en telemetry wijzigt nooit automatisch de planning.

## Architectuur

### Centrale multi-testerroute (aanbevolen)

```text
iRacing op Windows-sim-pc
  → SimHub 9.x
  → 3SM Endurance Connector
  → outbound HTTPS
  → /functions/v1/simhub-ingest
  → Postgres latest-only snapshot + Supabase Realtime
  → 3SM Race Control
```

Er hoeft geen poort op de sim-pc open. LAN-IP, port-forward en een tunnel per tester zijn niet nodig. De plugin gebruikt standaard:

```text
https://api.3stripemotorsport.cc/functions/v1
```

### Lokale fallback

De bestaande lokale bridge op `http://127.0.0.1:8787` blijft uitsluitend beschikbaar voor ontwikkeling en offline simulatie. Stel de plugin daarvoor expliciet in op **lokale bridgefallback**. Publiceer deze bridge nooit rechtstreeks op internet.

## Pairing zonder handmatige ID's

1. Tijdens de eerste gecontroleerde productiecanary logt uitsluitend een super-admin in op `https://3stripemotorsport.cc/simhub-koppelen`.
2. De super-admin kiest een actieve/toekomstige 3SM-race en het team van de tester.
3. De site maakt transactioneel één willekeurige code van acht tekens, tien minuten geldig en eenmalig bruikbaar.
4. De tester opent SimHub → Plugins → **3SM Endurance Connector**, vult alleen de ontvangen code in en klikt **Koppelen**; een websiteaccount op de sim-pc is niet nodig.
5. De plugin wisselt de code via HTTPS om voor een willekeurig device-token en server-side race/team-binding.
6. Het token wordt op Windows met DPAPI voor de huidige gebruiker versleuteld. De server bewaart alleen SHA-256.
7. Daarna publiceert de plugin maximaal ongeveer één snapshot per seconde.

URL, race-ID, team-ID, account-ID en token hoeven niet handmatig in de plugin te worden ingevuld. De productie-relayorigin is in de plugin vastgezet om tokenexfiltratie via gewijzigde instellingen te voorkomen.

## Serveronderdelen

- `supabase/migrations/20260716170000_simhub_central_relay.sql`
  - short-lived/single-use pairingcodes;
  - intrekbare devices met gehashte tokens;
  - latest-only telemetry per device;
  - atomic exchange, per-device rate guard en replaycontrole;
  - super-admin-only RLS tijdens de eerste canary zolang communityteamlidmaatschap zelf te kiezen is;
  - Supabase Realtime-publicatie.
- `supabase/functions/simhub-pair/index.ts`
  - website-JWT validatie voor create/list/revoke;
  - super-admin-autorisatie voor create/list/revoke;
  - unauthenticated code-exchange met bounded Edge-isolatelimiter; distributed Cloudflare-rate limiting is een verplichte staging/prod-gate;
  - geeft het device-token exact één keer terug.
- `supabase/functions/simhub-ingest/index.ts`
  - Bearer device-token;
  - maximaal 24 KB en uitsluitend JSON;
  - strict protocol-v1-validatie;
  - bounded write-vrije Edge-isolatelimiter plus transactionele 400 ms deviceguard;
  - blijvende sequencecontrole per eerder geziene SimHub-sessie, maximaal 64 sessies per device;
  - geen interne databasefouten in responses.
- `src/pages/SimHubPairingPage.tsx`
  - productie-veilige accountpagina voor pairing, intrekken en live RLS/Realtimemonitor;
  - geen toegang tot de lokale Endurance-planner of handmatige Race Control.
- `src/features/endurance/race-control/SimHubTelemetryPanel.tsx`
  - blijft de geïsoleerde lokale bridgefallback van de development-MVP;
  - importeert geen Supabase- of netwerkplatformclient.

## Veiligheidsmodel

- TLS is verplicht voor centrale endpoints; alleen HTTP-loopback is toegestaan als lokale fallback.
- Pairingcodes hebben circa 40 bits entropie, verlopen na tien minuten en worden atomair verbruikt.
- Code, IP/fingerprint en device-token worden uitsluitend gehasht in de database gebruikt.
- Device-token is per installatie intrekbaar, verloopt uiterlijk 36 uur na de gekoppelde racestart en stopt bij race-einde/statusfout of verlies van de staffrol van de code-eigenaar. Intrekken/invalideren verwijdert ook direct de latest snapshot.
- Race, team en eigenaar komen uit de server-side pairingbinding; pluginvelden zijn niet autoritatief.
- Service-role-RPC's zijn niet uitvoerbaar door `anon` of `authenticated`.
- Telemetry is strict, bounded, maximaal circa 1 Hz en alleen `IRacing`.
- De server onthoudt `last_sequence` per device én per eerder geziene `session_id`; terugschakelen naar een oude sessie reset de teller dus niet. Een nieuwe sessie start alleen met een lage sequence na minimaal vijf seconden stilte. Tijdstempels buiten de toegestane skew worden geweigerd.
- Tijdens de eerste canary kan uitsluitend super-admin devices beheren en latest snapshots lezen. Na geslaagde tests moet toegang bewust in frontend, Edge én SQL worden verbreed; alleen het menu aanpassen is onvoldoende. Zelfgekozen `team_memberships` zijn nadrukkelijk geen telemetry-autorisatiebewijs.
- Er wordt geen ruwe iRacing-data of historie opgeslagen; alleen het laatste geldige snapshot per device.
- Bij meerdere geldige devices voor dezelfde race/team toont Race Control de nieuwste geldige update. Ongewenste devices kunnen via de pairingpagina worden ingetrokken.
- Logging bevat geen pairingcode, Authorization-header, device-token of ruwe payload.

## Plugin bouwen en installeren op Windows

Vereisten:

1. SimHub 9.x geïnstalleerd; getest tegen `9.11.21`.
2. Visual Studio 2022 Build Tools.
3. .NET Framework 4.8 targeting pack.
4. PowerShell.

Build:

```powershell
cd tools\simhub-plugin\3SM.EnduranceConnector
.\build.ps1
```

Build en lokaal installeren:

```powershell
.\build.ps1 -Install
```

Of kopieer `3SM.EnduranceConnector.dll` handmatig naar de SimHub-installatiemap en herstart SimHub. Activeer daarna de plugin en vul de door staff gemaakte code in. Een upgrade blijft veilig in lokale modus totdat pairing slaagt. De PDB is alleen nodig voor debugging. **Lokale koppeling vergeten** wist alleen de DPAPI-kopie op die pc; trek het device daarnaast op de website in.

## Lokale end-to-end demo

Open twee terminals in de repository:

```bash
npm run simhub:bridge
npm run simhub:simulate -- --count 120
```

Open daarna lokale Endurance Race Control, klap **Lokale bridgefallback voor ontwikkeling** open en activeer de fallback. Standaard:

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

## Test- en releasegate

Lokaal:

```bash
npm run simhub:self-test
npx vitest run
npx tsc --noEmit --pretty false
npm run lint -- --quiet
npm run build
npx deno check --no-lock supabase/functions/simhub-pair/index.ts supabase/functions/simhub-ingest/index.ts
npx deno test --no-lock supabase/functions/_shared/simhub_test.ts
git diff --check
```

Voor staging/live, in deze volgorde:

1. Gevalideerde databasebackup en rollbackpunt maken.
2. Migratie eerst op disposable/stagingdatabase toepassen en auth/RLS-tests uitvoeren.
3. `SIMHUB_ALLOWED_ORIGINS` exact op staging-/productieorigins zetten.
4. Cloudflare/gateway distributed rate limits voor `simhub-pair` en `simhub-ingest` activeren en met 429-smokes bewijzen; de in-function limiter is bewust alleen bounded per Edge-isolate.
5. `simhub-pair` en `simhub-ingest` deployen met gateway-JWT-validatie uit; beide functies voeren hun eigen respectievelijke website/device-auth uit.
6. Pairingpagina en Race Control naar staging deployen.
7. Nieuwe Windows-pluginartifact bouwen tegen echte SimHub 9.11.21-DLL's.
8. Rolgebaseerde smokes: anoniem, regulier/teamlid, moderator en admin geweigerd; uitsluitend super-admin toegestaan; directe PostgREST-SELECT op `simhub_devices` geweigerd, rolverlies geweigerd, race-einde geweigerd en ingetrokken device geweigerd.
9. Pas na expliciete GO productie promoten.

Stop bij iedere afwijking. Bij rollback eerst Edge Functions uitschakelen en webroute terugzetten; laat tabellen intact totdat bevestigd is dat geen devices meer publiceren.

## Bewuste grenzen

- SimHub is optioneel en adviserend; netwerkuitval mag SimHub of Race Control niet blokkeren.
- De plugin gebruikt uitsluitend gedocumenteerde `IPlugin`/`IDataPlugin`-interfaces en genormaliseerde properties.
- `DataUpdate` doet geen blokkerende netwerkcall en start maximaal één achtergrondrequest tegelijk.
- Centrale telemetry publiceert voorlopig geen coureuridentiteit (`driverId: null`): de staffcode-eigenaar is niet noodzakelijk de tester of actieve coureur. Automatische iRacing-coureurwissels vereisen later een expliciete, team-gevalideerde iRacing-ID-mapping.
- De centrale migratie en functies mogen niet rechtstreeks zonder staging-, backup- en RLS-smoke naar productie.
