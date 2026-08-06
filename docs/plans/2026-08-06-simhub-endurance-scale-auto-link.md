# SimHub Endurance: auto-link schaalbaar + 1× koppeling — Implementatieplan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Maak de SimHub-koppeling geschikt voor de Endurance-tab op schaal (~30 man / meerdere teams & races) met eenmalige pairing, automatische server-side device→event/entry-koppeling, en veilige plugin-praktijk.

**Architecture:** Device-only pairing blijft de autoriteit (één keer, permanent). Alle routing (welk event/team/entry, practice vs race) gebeurt **server-side** op basis van de device-binding in de DB; de plugin blijft "stom" en stuurt per snapshot alleen telemetry + huidige coureur + auto/circuit + isInCar-heartbeat. Envelope wordt v2 (additieve velden) met strikte parser- en contract-test-updates. Auto-update = versie-check + "nieuwe versie beschikbaar"-notificatie in de plugin-UI; geen DLL-zelftoevoegen (risico op Admin-rechten/AV/code-signing).

**Tech Stack:** C# (.NET SimHub 9.11.21 plugin), Deno edge functions (Supabase), PostgreSQL RPC/SECURITY DEFINER, React (Race Control / Endurance-werkruimte), Supabase realtime + latest-only ingest.

**Repo (branch):** `/home/hermes/projects/3sm-league-endurance` (branch `feat/endurance-control-center`).
**Regels:** backend-first, additief, zero-downtime; niets pushen/deployen zonder expliciete GO (deploy alleen via `3sm-web:/opt/3sm/deploy.sh`).

---

## Fase 0 — Basis & contract-verificatie (reinheid)

### Task 0.1: Bevestig actuele baseline
**Files:** repo root
**Steps:**
1. `git status -sb` en `git log --oneline -5` → bevestig dat je op `feat/endurance-control-center` zit en de werkboom schoon is (of commit je werk eerst).
2. Loopt `npx vitest run` groen? Noteer uitgang.
3. **Commit:** `docs: baseline check before simhub scale plan` (alleen als er iets veranderd is).

---

## Fase 1 — Envelope v2 & plugin telemetry-uitbreiding

**Doel:** de plugin stuurt straks de data die de Endurance-tab écht nodig heeft: **huidige coureur**, **auto**, **circuit/track** en **isInCar-heartbeat**. Alles blijft optioneel/fail-closed.

### Task 1.1: Bump schema naar protocolVersion 2 (contract)
**Files:**
- Modify: `contracts/simhub-telemetry.v1.schema.json` → hernoem naar `contracts/simhub-telemetry.v2.schema.json`
- Modify: `supabase/functions/_shared/simhub.ts` (parser: `protocolVersion` const, `exactKeys` voor `race` en `telemetry` — regels ±71,82,85)

**Step 1 (rood):** merk in een bestaande contract-parity-test dat de nieuwe velden ontbreken.
**Step 2:** voeg toe aan de parser (alleen additief, bestaande velden onveranderd):
- `race` krijgt nieuwe members: `currentDriverId` (string|null), `currentDriverName` (string|null), `carId` (string|null), `carName` (string|null), `trackName` (string|null), `trackConfig` (string|null).
- `telemetry` krijgt: `isInCar` (bool), en optioneel `driverCount` (int|null)/`driverIndex` (int|null) voor multi-driver.
- `protocolVersion` → `2` (pak oude v1-berichten niet ongemerkt aan).
**Step 3:** werk `race`/`telemetry` `required` lijsten en `additionalProperties` correct bij; alle nieuwe leden nullable behalve `isInCar`.
**Step 4 (groen):** `npx vitest run` + een contract-schema-validatie-run.
**Step 5 — Commit:** `feat(simhub): bump telemetry envelope to v2 with driver/car/track/isInCar`.

### Task 1.2: Plugin capture uitbreiden (C#)
**Files:**
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/TelemetryContracts.cs` (envelope-klassen: neem v2-velden op)
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs` `Capture(...)` (± regels 326-365)
- Modify: `tools/simhub-plugin/3SM.EnduranceConnector/ConnectorSettings.cs` (nieuwe property-paden voor coureur/auto/circuit)

**Step 1:** voeg in `ConnectorSettings` property-path-defaults toe (iRacing via SimHub DataCore):
- `CurrentDriverProperty` / `DriverNameProperty` (huidige coureur; lees uit sessie/driver-info)
- `CarIdProperty` = `DataCorePlugin.GameData.NewData.CarModel` (of CarID)
- `CarNameProperty`, `TrackNameProperty`, `TrackConfigProperty`
**Step 2:** vul in `Capture` deze velden via de bestaande `GetRaw`/`GetString` helpers; zet `null` bij ontbrekende waarde (nooit verzinnen).
**Step 3:** `isInCar` = waar zodra `DataUpdate` draait en de plugin actief rijdt (gebruik de bestaande `running`-logica; niet-actieve devices sturen straks alleen heartbeat — zie Task 2.3).
**Step 4 — Compile:** bouw via de workflow (zie `build-simhub-plugin.yml`) of lokaal `build.ps1 -SimHubPath ...`. **Noteer in de oplevering expliciet of het een echte Windows-host compile is (CI) of alleen signature-check.**
**Step 5 — Commit:** `feat(simhub): plugin sends current driver, car, track, isInCar`.

### Task 1.3: Contract-parity & frontend-types
**Files:**
- Modify: `src/integrations/supabase/types.ts` (hand-inject nieuwe velden naast bestaande telemetry-velden)
- Modify: `src/lib/centralSimHubRelay.ts` / `src/lib/localSimHubBridge.ts` (parsers accepteren v2)
- Modify: bestaande parity-tests (`contract`-testen)

**Step 1 (rood):** schrijf/updat de parity-test: "schema-v2-veld X wordt correct geparseerd door browser-parser en plugin-serialisatie".
**Step 2 (groen):** implementeer.
**Step 3:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
**Step 4 — Commit:** `test(simhub): contract parity for envelope v2`.

---

## Fase 2 — Server-side device→endurance-entry binding & routing (auto-link)

**Doel:** device wordt in de Endurance-tab aan een specifiek event+entry+team gekoppeld; ingest leidt live telemetry naar de juiste plek en herkent practice-vs-race. Plugin hoeft géén event/team te weten.

### Task 2.1: Migratie — endurance-binding op simhub_devices
**Files:**
- Create: `supabase/migrations/20260806_endurance_device_binding.sql`
- Create (rollback): `supabase/rollback/20260806_endurance_device_binding.rollback.sql`

**SQL:** voeg toe aan `public.simhub_devices`:
- `endurance_event_id UUID REFERENCES public.endurance_events(id) ON DELETE SET NULL`
- `endurance_entry_id UUID REFERENCES public.endurance_entries(id) ON DELETE SET NULL`
- index op `(endurance_event_id, endurance_entry_id)`
**Constraint (fail-closed):** een device mag niet tegelijk legacy- en endurance-gebonden zijn:
`CHECK ( (race_id IS NULL OR endurance_event_id IS NULL) AND (team_id IS NULL OR endurance_entry_id IS NULL) )` — degelijk op de daadwerkelijke kolomnamen afstemmen.
**Step:** valideer met `supabase db lint`/native parser; geen deploy zonder GO.
**Commit:** `feat(simhub): endurance event/entry binding on devices`.

### Task 2.2: Ingest-RPC → routing practice vs race + endurance-gate
**Files:**
- Modify: `supabase/functions/_shared/simhub.ts` (envelope v2 parser al klaar)
- Modify: `supabase/functions/simhub-ingest/index.ts` (RPC-aanroep + car/circuit/driver doorgeven)
- Modify: migratie `20260716192852` of nieuwe migratie — herschrijf `simhub_ingest_snapshot` zodat hij:
  1. device oplost via `token_hash`;
  2. **endurance-gate:** device-owner moet een actieve/ingeschreven rijder zijn voor het gebonden `endurance_event_id` (`endurance_registrations` status niet rejected/withdrawn) — anders `not_registered` en geen write (zelfde patroon als `endurance_record_practice_lap`);
  3. **practice-routing:** bestaat er een actieve `endurance_practice_sessions` voor dit event (en device-owner ingeschreven) → schrijf ook een `endurance_practice_laps`-rij (lap + car + circuit + driver) via bestaande logica;
  4. anders → latest-only snapshot met de v2-telemetry incl. `race.currentDriverId`/`carId`/`trackName`.

**Step 1 (rood):** DB-transactietest: gebonden + ingeschreven owner → `accepted` + (afhankelijk routing) lap-rij óf snapshot geschreven.
**Step 2 (groen):** implementeer RPC (SECURITY DEFINER, service_role-only).
**Step 3 (verificatie):** `npx vitest run` + handmatige DB-run op de canary zoals in de practice-skill beschreven.
**Commit:** `feat(simhub): ingest routes practice vs race with endurance gate`.

### Task 2.3: isInCar heartbeat (schaal/anti-cheat)
**Files:**
- Modify: `EnduranceConnectorPlugin.cs` (niet-actieve device: lichte heartbeat i.p.v. rijke rij)
- Modify: ingest-RPC (accepteer heartbeat zonder lap, update alleen `telemetry.isInCar`/last_seen)

**Doel:** per team slechts 1 rijk pakket tegelijk; rest = `< 1 req/s` heartbeat. Dit is de schaalfactor die 30 man haalbaar houdt.
**Step:** verminder `SendIntervalMilliseconds` voor niet-actieve devices; `isInCar=false` → alleen heartbeat-velden.
**Commit:** `feat(simhub): isInCar heartbeat for non-active devices`.

---

## Fase 3 — Race Control: multi-team live overzicht & driver matching

**Doel:** Race Control toont per team de live device (niet alleen één geselecteerd device), en detecteert driver-mismatch op basis van de nu-wél aangeleverde `currentDriverId`.

### Task 3.1: Entries→device mapping in Race Control
**Files:**
- Modify: `src/features/endurance/race-control/SimHubTelemetryPanel.tsx`
- Modify: `src/features/endurance/race-control/RaceControlPanel.tsx` (± regels 60-68: per team doorgeven)
- Modify: `src/lib/centralSimHubRelay.ts` (los device per `endurance_entry_id` op via binding)

**Step:** geef per team/entry de gekoppelde device-id mee; panel subscribelt op dat device (realtime) i.p.v. handmatig één te selecteren. Lege/geen-device → huidige "manual-only" fallback (advisory, geen breuk).
**Step 2 (verificatie):** `npx tsc`, `vitest`, dev-server + tunnel. Noteer expliciet dat echte live-relaydata alleen op staging/live met ingelogde super-admin aantoonbaar is (fail-closed lokale route laat het bewust niet zien).
**Commit:** `feat(endurance): race control maps entries to live devices`.

### Task 3.2: Driver mismatch met currentDriverId
**Files:** `SimHubTelemetryPanel.tsx` (± regels 79-85, 103-106)

**Step 1 (rood):** test dat `latest.payload.race.currentDriverId !== plannedDriverId` → "Afwijking gedetecteerd".
**Step 2 (groen):** gebruik `currentDriverId`/`currentDriverName` i.p.v. de oude `driverId` (die in centrale modus `null` was).
**Commit:** `feat(endurance): live driver mismatch from currentDriverId`.

---

## Fase 4 — 30-man UX & veilige auto-update

**Doel:** toewijzings-UI in de Endurance-tab + plugin-update zo makkelijk mogelijk zónder risicovolle DLL-autoswap.

### Task 4.1: Device-assignment UI in Endurance-tab
**Files:**
- Create: `src/features/endurance/devices/DeviceAssignmentPanel.tsx`
- Modify: werkruimte waarin de tab wordt ge-ensembled (per memory: separate season/race/standalone flows)
- Modify: `src/features/endurance/repository/dataAccess.ts` + gegenereerde `types.ts` (nieuwe kolommen op de device-tabel toestaan)

**Step:** super-admin kan per endurance-event/entry een ongekoppelde device kiezen (en terugnemen). De mutatie schrijft `simhub_devices.endurance_event_id/endurance_entry_id` (SECURITY DEFINER RPC, super-admin-only). Geen wijziging aan de pairing zelf.
**Commit:** `feat(endurance): assign unassigned devices to events/entries`.

### Task 4.2: Plugin versie-check (veilige "nieuwe versie" notificatie)
**Files:**
- Create edge: `supabase/functions/simhub-version/index.ts` (publiek, laagfrequent, serveert `{ version, dllUrl }`)
- Modify: `EnduranceConnectorPlugin.cs` (bij init/status: 1× per dag GET naar versie-endpoint, toon "Nieuwe versie beschikbaar" in de plugin-UI; géén download/vervang)
- Modify: `ConnectorSettings.cs` (lokaal cached gecheckte versie)

**Boundaries (fail-closed):** de plugin **vervangt nooit zelf** de DLL; endpoint is read-only en gepingd aan exacte production-origin; geen credentials naar het versie-endpoint.
**Commit:** `feat(simhub): safe update-availability notice in plugin`.

### Task 4.3: Distributie & release-doc voor ~30 man
**Files:**
- Modify: `docs/plans/2026-08-06-simhub-endurance-scale-auto-link.md` → bijlage "Update-gids voor deelnemers"
- Modify: `.github/workflows/build-simhub-plugin.yml` (versie-tag in artifact-naam handhaven; retention voldoende)

**Step:** documenteer: upgrade = 1 DLL vervangen + herstart, pairing blijft. Vermeld schaalgrenzen (één actief device per team; thuis-IP's; LAN-NAT-uitzondering).
**Commit:** `docs(simhub): participant update guide and scale notes`.

---

## Verificatie & oplevering (verplicht voor GO)

1. `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, productiebuild — allemaal groen.
2. End-to-end op canary/DB: gebonden+ingeschreven device → correcte routing (practice lap XOR live snapshot); niet-ingeschreven → `not_registered`, geen write.
3. **Schoon:** testdata/accounts verwijderen; `0|0|0`-check zoals in eerdere fasen.
4. Plugin: bevestig **welke** verificatie echt is (CI Windows-host compile vs alleen signature-check) — noem nooit "gecompileerd" bij alleen signature-check.
5. **Geen GO-claim** na review-fixes tot de laatste tests/rehearsals zijn herdraaid.
6. **NIET pushen/deployen zonder expliciete GO**; deploy uitsluitend via `3sm-web:/opt/3sm/deploy.sh`.

## Rollback
- DB: `supabase/rollback/20260806_endurance_device_binding.rollback.sql`.
- Edge: oude `simhub_ingest_snapshot` herstellen uit git.
- Plugin: oude DLL herplaatsen; **pairing blijft** (settings in ConnectorSettings, schema-compatibel).
