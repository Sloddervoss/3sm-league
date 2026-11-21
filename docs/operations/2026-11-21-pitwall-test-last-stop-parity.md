# Pitwall-test en Mijn Pitwall — dezelfde laatste stop

Datum: 2026-11-21
Branch: `fix/test-pitwall-last-stop`
Basis: `f66642260e1fa5bc16ee1353459862669bb26ee8`
Status: lokaal geïmplementeerd en getest; **geen push, deploy, migratie of productieactie**.
Lokale codecommit: `c96b0f180dc5f225e5f37a51afd4dd8b5ed1d492`.

## 1. Besluit

`/admin/pitwall-test` toont in de premiumweergave dezelfde kaart **Laatste stop**
als Mijn Pitwall, op dezelfde plek direct onder de beslissingsband. Zo kan een
beheerder een willekeurige connector testen die hij via de bestaande
beheerpoort al mag bekijken, zonder een tweede presentatie of een tweede
meetwaarheid.

De pariteit is een blijvende ontwerpregel, geen eenmalige kopie:

- **Eén component**: `PitDurationPanel` uit `src/features/personal-pitwall/`.
- **Eén slot**: `PitwallPremiumView` rendert `pitDuration` in
  `.ptp-pit-benchmark` met `data-pit-strategy-benchmark="gross"`, direct na
  `DecisionBand`.
- **Eén copy en format**: `formatPitDuration`, `PIT_BENCHMARK_SEMANTICS` en
  `PIT_DURATION_SEMANTICS` uit `pitVisits.ts`.
- **Eén lege/faaltoestand**: dezelfde expliciete `no_session`/
  `no_completed_visit`-tekst, dezelfde bronflankdiagnostiek en dezelfde
  foutmelding.
- **Eén brondata-pad**: `pitwall_personal_pit_visits_v1`, die alleen een echt
  gepaard `pit_in`/`pit_out`-paar uit de nieuwste observed sessie teruggeeft.
  Geen schatting, geen `received_at`, geen strategieberekening.

Alleen de **lezer** verschilt:

| Route | Lezer | Autorisatie |
|---|---|---|
| Mijn Pitwall | `readPersonalPitVisits` in `share.ts` | eigen device |
| `/admin/pitwall-test` | `readAdminPitVisits` in `adminPitVisits.ts` | niet-eigen device via bestaande `can_manage_simhub()` |

De owner-transport blijft owner-only; de testpagina gebruikt hem niet. De
adminlezer voegt geen rol, grant, RPC of anonieme/share-route toe. De
routecontrole blijft `isSuperAdmin`, wat in deze repo gelijk is aan
`can_manage_simhub()` (beide uitsluitend `super_admin`). De server-RPC blijft
de echte grens: `owner_user_id = auth.uid() OR can_manage_simhub()`.

## 2. Live gating en contextwissel

De kaart verschijnt alleen als de bestaande livevoorwaarde waar is:
`enabled={live}` met `live = !detailQuery.error && isTelemetryLive(received_at)`.
Zonder live telemetrie blijft de kaart weg, net als op Mijn Pitwall.

`PitDurationPanel` krijgt nu een `contextKey` mee: device + `last_session_id` +
`session_id` + `race_run_id` (dezelfde waarde die de premiumview al gebruikt).
De zichtbare feed en fout zijn aan die context gebonden:

- bij een device- of sessiewissel verdwijnt de oude stop **in dezelfde render**,
  vóór de nieuwe query klaar is;
- een oude, later binnenkomende query raakt de nieuwe context niet door de
  generatieteller;
- een fout toont de expliciete melding en laat geen oude stop staan.

Polling blijft 5 s en leest dezelfde bounded RPC; er is geen nieuwe
abonnement- of Realtime-route.

## 3. Tests en bewijs

### Route-pariteit (frontend)

```bash
npm run test:pitwall-parity
# 4 tests: geselecteerd niet-eigen device als admin, lege sessie,
#          devicewissel + laat antwoord, expliciete fout
```

`src/test/pitwallPitDurationParity.test.tsx` rendert de echte
`PersonalPitwallPage` en `PitwallDeviceTestPage`, met dezelfde
`PitDurationPanel` en dezelfde RPC-fixture. Het vergelijkt de kaarttekst,
`data-pit-duration`, `data-pit-source` en `data-pit-benchmark`. De adminroute
selecteert expliciet een niet-eigen device (`device-admin-a`) en de test
controleert dat beide lezers met `p_limit: 5` dezelfde stop ophalen.

### Componentgedrag

```bash
npx vitest run src/features/personal-pitwall/PitDurationPanel.test.tsx
# 8 tests: bestaande parse/format/empty/error + devicewissel,
#          sessiewissel en late respons
```

### Database (geïsoleerde PGlite, geen remote DB)

```bash
npm run test:db:pitwall-pit-visits
# 28/28: bestaande pair-/sessie-/diagnostiektests plus
#        owner vs. admin (can_manage_simhub) vs. outsider en rollback
```

De test gebruikt echte tabel- en functiegrantcontroles. De admin-lezing op een
niet-eigen device slaagt alleen met `can_manage_simhub()`; zonder die poort
krijgt dezelfde uid `Permission denied`. De bestaande rollback verwijdert beide
tabellen en de lezer.

### Browserreplay en screenshot

```bash
npx vite --config vite.pitwall-look.config.ts
PIT_DURATION_PARITY_OUT=/tmp/pit-duration-parity \
  bash scripts/ensure-playwright-runtime.sh \
  node docs/pitwall-look/preview/pit-duration-parity-shot.mjs
```

De fixture monteert het echte `PitDurationPanel` twee keer in dezelfde
`.ptp-pit-benchmark`-slot: owner en admin (niet-eigen device), met dezelfde
gemeten stop. Bewijs: `docs/pitwall-look/evidence/pitwall-last-stop-parity-20261121/`
(`pitwall-personal-admin-parity.png`, `evidence.json`). Beide kaarten zijn
bytegelijk in waarde, bron, benchmark, slot en copy: **38.125 s** uit
`measurement_event_pit_edges`.

### Volledige frontendsuite

```bash
npm test
# 235 files / 2472 tests geslaagd; 3 bestaande falingen in
# simHubConnectorContract (2) en tyreTelemetryContract (1): dezelfde drie
# die de eerdere basisrun op de ongewijzigde commit al vastlegde. Beide
# bestanden zijn in deze wijziging niet aangeraakt; de nieuwe pariteitstests
# zijn groen.
```

## 4. Impact-check

1. **Website/frontend**: `/admin/pitwall-test` premiumweergave krijgt de
   bestaande Laatste-stop-kaart; Mijn Pitwall krijgt alleen de extra
   contextsleutel. Geen route- of toegangswijziging.
2. **Backend/API**: geen nieuwe RPC, grant of migratie. De bestaande
   owner-or-`can_manage_simhub()`-RPC wordt door de adminlezer hergebruikt.
3. **Bot**: geen impact verwacht.
4. **Data/database**: geen schemawijziging, geen productie-DML, geen backfill.
5. **Auth/rollen**: geen nieuwe rol of bredere toegang. Route blijft
   super-admin; server-RPC blijft de grens.
6. **Deployment**: geen deploy; geen plugin-/manifestwijziging.

## 5. Risico's en grenzen

- De kaart verschijnt pas bij een expliciete pit-uit en alleen in de nieuwste
  observed sessie. Dat is dezelfde grens als Mijn Pitwall, geen bug.
- Een beheerder ziet de bruto pitstraattijd van een niet-eigen connector; dat
  is bestaand beheerbereik, geen nieuwe data-exposure.
- De browserfixture bewijst de kaartpresentatie en -pariteit, niet een live
  productieconnector. De echte route-pariteit wordt door de frontendtest en de
  DB-test gedekt.
- Geen productie-DB, migratie, deploy, share-link of connectoractie uitgevoerd.

## 6. Vervolg

Lokale commit en releasevoorbereiding; push/deploy wachten op een nieuwe
publicatie-GO. PRODUCTIEWIJZIGING: NEE.
