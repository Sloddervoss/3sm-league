# 3SM Remote Diagnostics v1 — plan (archief)

> **⚠️ VERVANGEN door:** `docs/plans/simhub-remote-diagnostics-v1-implementation.md`
>
> Dit document is het oorspronkelijke ontwerp (2026-08-31). Het concrete implementatieplan
> (wire contract, DB-schema, Edge/RPC, auth, rate limits, retention, codes, failure isolation,
> privacy/security, implementatievolgorde, testmatrix, UI-velden, open vragen) staat in het
> nieuwe document. Dit archief blijft bewaard als ontwerphistorie; de inhoud is grotendeels
> overgenomen/verfijnd in het implementatieplan.

Status: **ARCHIEF / ONTWERP — zie implementatieplan. Nog NIET bouwen.**
Datum: 2026-08-31
Scope: beperkte health-diagnostics vanuit de 3SM SimHub-connector. Volledig **apart** van telemetry-ingest (verzendpath, RPC, DB-tabellen) en van updater-hardening.
Kandidaat-versie: waarschijnlijk een latere release dan updater-hardening (zie Releasebesluit aan het einde).

---

## 1. Ontwerpprincipe: isolatie (hard)

> **Diagnostics mogen NOOIT telemetry-ingest blokkeren, vertragen of sequence/session-state beïnvloeden.**

- Diagnostics gebruiken een **eigen** HTTP-client, eigen timeout, eigen CancellationToken, eigen `_diagnosticsBusy`-volatile en een eigen cooldown. Het diagnostick-pad raakt de `Sequence` / `_sessionId` / `_sendGate` / ingeststelemetry-verzending **niet**.
- Diagnostics starten los van het `DataUpdate`-telemetrypad: een op een aparte (achtergrond-)route/timer, nooit in een telemetry-send-blocking callback.
- Als diagnostics falen, wordt er hooguit een eigen status-vlag gezet; telemetry blijft ongemoeid.
- Diagnostics delen alleen het **bestaande device-token** voor auth (geen nieuwe geheimen), maar gebruiken een **eigen endpoint** `…/simhub-diagnostic`.
- Feedback-loop naar updater: diagnostics mogen de updater-state *lezen* (uit de persisted state die de updater-hardening introduceert), maar niet zelf de updater aansturen (geen remote-trigger van installs — dat blijft lokale user-actie).

---

## 2. Authenticatie — **[RESOLVED]**

- **Zelfde principe als ingest:** het connector stuurt een HTTP `Authorization: Bearer <device-token>` (DPAPI-protected, alleen uit memory-time ontsleuteld). **Nooit** token in query/body; nooit in logs.
- **Server-side koppeling aan device:** de Edge-functie / RPC ziet alleen de token→device lookup (via token-hash opgelost tot `device_id`), **niet** een via-client verstuurde deviceId.
- **deviceId uit body wordt NIET blind vertrouwd.** De server bepaalt de echte device context uit de token.

**DeviceId/body-besluit (v1):** server is authoritative.
- Als body `deviceId` bevat → moet die **exact** overeenkomen met het device dat bij het bearer/device-token hoort.
- **mismatch → reject (weigeren).** Niet stil negeren.
- **Beter contract-ontwerp:** hoewel `deviceId` een extra consistency-check mag zijn, gebruikt de server **altijd de token-binding als identiteit** en dient `deviceId` alleen ter verifikatie-consistency.

- Revoked/expired device: zelfde gates als ingest — geen health meer schrijven (of alleen expliciet `DEVICE_UNBOUND`/`DEVICE_REVOKED`-event met server-besluit).

---

## 3. Wire contract — exact JSON schema

Endpoint: `POST https://api.3stripemotorsport.cc/functions/v1/simhub-diagnostic`
Auth: `Authorization: Bearer <deviceToken>`
Body-cap: klein (bijv. ≤ 4 KiB), response klein.

### 3a. Heartbeat (`type: "heartbeat"`)

Alle velden `required` tenzij anders vermeld. De `*Utc`-velden zijn UTC-tijdstempels (ISO-8601).

| veld | type | nullable | required | betekenis | voorbeeld |
|---|---|---|---|---|---|
| `type` | string | nee | ja | discriminator `heartbeat` | `"heartbeat"` |
| `deviceId` | string (uuid) | nee | ja(1) | client-kennis van huidige device; **server verifieert via token** | `"7e748fad-…"` |
| `connectorVersion` | string | nee | ja | Assembly/File version van connector | `"0.3.8.0"` |
| `simHubVersion` | string | nee | ja | SimHubWPF.exe FileVersion | `"1.0.9735.26972"` |
| `gameConnected` | bool | nee | ja | iRacing `GameRunning` | `true` |
| `telemetryAvailable` | bool | nee | ja | er is een normaal telemetry-snapshot verzonden deze sessie | `true` |
| `rawDataAvailable` | bool | nee | ja | `data.NewData != null` | `true` |
| `rawTelemetryAvailable` | bool | nee | ja | rauwe iRacing-telemetry-object (RawData.Telemetry) beschikbaar | `false` |
| `sessionTimeReadOk` | bool | nee | ja | SessionTelemetryReader las `SessionTime` succesvol | `false` |
| `sessionTimeSeconds` | double \| null | ja | ja | laatst gelezen sessietijd (alleen finite ≥ 0); null = n/a of leesfout | `1753.7` |
| `sessionTimeReader` | string | nee | ja | lezer-identiteit, vast `"RawDataReflection"` (v0.3.8.0) | `"RawDataReflection"` |
| `sequence` | int | nee | ja | huidige telemetry-sequence teller | `2048` |
| `lastTelemetryAttemptUtc` | string\|null | ja | ja | laatste telemetry-ingest verzendpoging | `"2026-08-30T20:00:20Z"` |
| `lastSuccessfulIngestUtc` | string\|null | ja | ja | laatste geslaagde ingest | `"2026-08-30T20:00:18Z"` |
| `lastIngestHttpStatus` | int \| null | ja | ja | laatste ingest HTTP-status (0 = netwerkfout) | `200` |
| `diagnosticCode` | string | nee | ja | huidige vaste statuscodel (sectie 5) | `"OK"` |
| `updaterState` | string | nee | ja | persisted updater-FSM state (`IDLE`…`SUCCESS`\|`FAILED`) | `"IDLE"` |
| `updaterCurrentVersion` | string | nee | ja | geïnstalleerde connector-versie | `"0.3.8.0"` |
| `updaterTargetVersion` | string\|null | ja | ja | te installeren remote versie (leeg als geen) | `null` |
| `lastUpdateResult` | string\|null | ja | ja | uit updater-hardening (`none/success/failure:<code>`) | `"none"` |
| `lastUpdateUtc` | string\|null | ja | ja | laatste update-poging | `null` |
| `clientReportedAtUtc` | string | nee | ja | client-digitale timestamp van verzending | `"2026-08-30T20:00:19Z"` |

voetnoot (1): `deviceId` wordt verzonden zodat de telemetry-edge het kan cross-checken met de token, maar de server is authoritative. Backward-compat/optioneel indien de server alleen met token werkt.

Voorbeeld (volledig, maar compact):
```json
{
  "type": "heartbeat",
  "deviceId": "7e748fad-64a1-4fce-bc14-4f595480ff67",
  "connectorVersion": "0.3.8.0",
  "simHubVersion": "1.0.9735.26972",
  "gameConnected": true,
  "telemetryAvailable": true,
  "rawDataAvailable": true,
  "rawTelemetryAvailable": false,
  "sessionTimeReadOk": false,
  "sessionTimeSeconds": null,
  "sessionTimeReader": "RawDataReflection",
  "sequence": 2048,
  "lastTelemetryAttemptUtc": "2026-08-30T20:00:20Z",
  "lastSuccessfulIngestUtc": "2026-08-30T20:00:18Z",
  "lastIngestHttpStatus": 200,
  "diagnosticCode": "OK",
  "updaterState": "IDLE",
  "updaterCurrentVersion": "0.3.8.0",
  "updaterTargetVersion": null,
  "lastUpdateResult": "none",
  "lastUpdateUtc": null,
  "clientReportedAtUtc": "2026-08-30T20:00:19Z"
}
```

### 3b. Status/error event (`type: "event"`)

| veld | type | nullable | required | betekenis |
|---|---|---|---|---|
| `type` | string | nee | ja | `event` |
| `deviceId` | string | nee | ja | idem heartbeat — server cross-check |
| `code` | string | nee | ja | vaste diagnostic-eventcode (sectie 4) |
| `atUtc` | string | nee | ja | clienttijdstempel van het gedetecteerde statusverloop |
| `exceptionType` | string \| null | ja | nee(2) | alleen volledige exception **type** (geen stacktrace) |
| `detail` | string \| null | ja | nee(2) | korte gesaniteerde boodschap (≤ 200 chars, geallowist, geen geheimen) |
| `occurredAfter` | string \| null | ja | nee | (optioneel) voorgaande status die deze verandering triggerde |

voetnoot (2): `exceptionType`+`detail` alleen en strikt gesanitized volgens sectie 6; bij normaal state-transition (bv `OK→RAW_DATA_UNAVAILABLE`) mag `detail` leeg.

Voorbeeld:
```json
{
  "type": "event",
  "deviceId": "7e748fad-…",
  "code": "SESSION_TIME_READ_FAILED",
  "atUtc": "2026-08-30T20:01:03Z",
  "exceptionType": "System.Reflection.TargetInvocationException",
  "detail": "requested member not present"
}
```

---

## 4. Toegestane vaste diagnostic codes (events)

Alleen deze vaste enum-achtige codes; alles erbuiten wordt server-side geweigerd (allow list):

```
OK
RAW_DATA_UNAVAILABLE
RAW_TELEMETRY_UNAVAILABLE
SESSION_TIME_READ_FAILED
TELEMETRY_STALE
INGEST_401
INGEST_403
INGEST_429
INGEST_500
DEVICE_UNBOUND
DEVICE_REVOKED
UPDATE_CHECK_FAILED
UPDATE_DOWNLOAD_FAILED
UPDATE_HASH_FAILED
UPDATE_SIGNATURE_FAILED
UPDATE_INSTALL_FAILED
UPDATE_DLL_LOCKED
UPDATE_ROLLBACK_USED
```

Betekenis (compuact):
- `OK` — alles goed.
- `RAW_DATA_UNAVAILABLE` — `data.NewData` ontbreekt ondanks `gameConnected`.
- `RAW_TELEMETRY_UNAVAILABLE` — RawData.Telemetry-object niet bereikbaar.
- `SESSION_TIME_READ_FAILED` — reader las geen geldige SessionTime.
- `TELEMETRY_STALE` — ingest auteureel (geen fresh telemetry in venster).
- `INGEST_401/403/429/500` — respectievelijke ingest HTTP-uitkomst.
- `DEVICE_UNBOUND` — device ongebonden / niet actief.
- `DEVICE_REVOKED` — device ingetrokken.
- `UPDATE_*` — updater-uitkomsten, conform updater-hardening failure codes.

`diagnosticCode`-veld in de heartbeat is de "huidige status" — een van bovenstaande (meestal `OK` of een blijvende waarschuwing).

**DiagnosticCode-lifecycle-besluit (v1):**
- De **actieve diagnostic code blijft staan zolang het probleem bestaat** (geen onmiddellijke terugval naar OK).
- Bij **herstel**:
  - current code → `OK`;
  - één **recovery/state-change event** opslaan;
  - daarna **geen herhaalde `OK`-events spammen**.

---

## 5. Heartbeat-rate en latest-health

- **Maximaal 1 heartbeat per 60 seconden per device** (client-side throttle; server-side rate-limit als harde bovengrens).
- **Latest-health semantics:** de Edge-functie upserté één rij per device in `simhub_device_health` (zie sectie 7). Geen history in health-tabel; de meest recente heartbeat overschrijft.
- **Tijdsemantiek gescheiden:**
  - **server-timestamp** = ontvangsttijd op de server (`received_at`, `now()` in Edge/DB). Bepalend voor online/offline.
  - **client-timestamp** = `clientReportedAtUtc` uit het veld; bepalend voor o.a. freshness van de client. Wordt apart opgeslagen; nooit als server-timestamp gebruiken.
  - Online/offline wordt server-side op server-timestamp + `online_window` (bijv. device online als last heartbeat < 150 s geleden) berekend; bij offline wordt de laatste health behouden (voor context) maar niet als "live" gemarkeerd.
- Client-timer voert alleen heartbeat uit als connector niet in shutdown; throttle onderbreekt geen lopende heartbeat (cooldown-based).

---

## 6. Privacy/security — expliciete allowlist

**Alleen deze velden mogen worden verstuurd, en alleen in het exacte schema van sectie 3.** Alles buiten de allowlist wordt NIET verstuurd/geaccepteerd; de server weigert onbekende velden (strict).

**WEL (allow list):**
- `type`, `deviceId` (cross-check, nooit gezaghebbend)
- `connectorVersion`, `simHubVersion`
- `gameConnected`, `telemetryAvailable`, `rawDataAvailable`, `rawTelemetryAvailable`
- `sessionTimeReadOk`, `sessionTimeSeconds`, `sessionTimeReader`
- `sequence`
- `lastTelemetryAttemptUtc`, `lastSuccessfulIngestUtc`, `lastIngestHttpStatus`
- `diagnosticCode`
- `updaterState`, `updaterCurrentVersion`, `updaterTargetVersion`, `lastUpdateResult`, `lastUpdateUtc`
- `clientReportedAtUtc`, `atUtc`
- (event) `code`, `exceptionType` (alleen type-naam, geen ArgumentException-inner etc.), `detail` (kort, gesanitized, ≤ 200 chars), `occurredAfter`

**NOOIT (hard verboden):**
- bearer/device-token (keer nooit in body/query/logs)
- Authorization headers (nooit loggen)
- passwords / secrets
- volledige requests/responses
- volledige SimHub.log of logs
- volledige telemetry-payload of data-velden (lap/speed/fuel/pos etc. worden NIET meegetoond in diagnostics; die horen bij ingest, niet bij de allowlist)
- arbitrary/volledige stack traces
- Windows-gebruikersnaam (`Environment.UserName` verboden)
- lokale persoonlijke bestandspaden (nooit paden — geen `%LOCALAPPDATA%`, geen SimHub-map-pad in diagnostics)

**Sanitization (detail/exceptionType):**
- `detail`: max 200 chars, eerste volledige whitespace-trim; patch-foutjes uit; als het veld niet in de allow-liter is of geheimen lijkt te bevatten → vervangen/weglaten.
- `exceptionType`: alleen de volledige type-naam van de top-level exception (bijv. `System.InvalidOperationException`); géén `InnerException`, géén stack.
- Patent-weergave: message-velden mogen geen paden/tokens/gebruikersnamen bevatten — de code die `detail` vult wordt geconstipeerd om alleen uit een vaste, geprefixeerde waarschuwing te bestaan (bv "session time reader returned invalid value") en niet de ruwe exception-message.

---

## 7. Database-ontwerp

Twee tabellen: `simhub_device_health` (latest per device) en `simhub_device_diagnostic_events` (beperkte history).

### 7a. `simhub_device_health`

| kolom | type | constraint | betekenis |
|---|---|---|---|
| `device_id` | uuid | **PRIMARY KEY**; FK → `simhub_devices(id) ON DELETE CASCADE` | device |
| `connector_version` | text | | latest |
| `simhub_version` | text | | latest |
| `game_connected` | boolean | | latest |
| `telemetry_available` | boolean | | latest |
| `raw_data_available` | boolean | | latest |
| `raw_telemetry_available` | boolean | | latest |
| `session_time_read_ok` | boolean | | latest |
| `session_time_seconds` | double precision \| null | | latest |
| `session_time_reader` | text | | latest |
| `sequence` | bigint | | latest |
| `last_telemetry_attempt_utc` | timestamptz \| null | | |
| `last_successful_ingest_utc` | timestamptz \| null | | |
| `last_ingest_http_status` | integer \| null | | |
| `diagnostic_code` | text | vaste enum (sectie 4) via trigger/constraint | latest |
| `updater_state` | text | | latest |
| `updater_current_version` | text | | latest |
| `updater_target_version` | text \| null | | |
| `last_update_result` | text \| null | | |
| `last_update_utc` | timestamptz \| null | | |
| `client_reported_at_utc` | timestamptz \| null | | client-timestamp |
| `received_at` | timestamptz NOT NULL DEFAULT now() | | server-timestamp (online-basis) |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | | |

- **Indexes:** PK op device_id volstaat (latest-only). Optionele index op `received_at` voor online/offline-lijst-query.
- **RLS:** 
  - **schrijven:** alleen via service-role RPC/Edge (device-token → token-hash → service-role), niet door anon/authenticated;
  - **lezen:** `super_admin` (via hosted publication of een narrow RPC); andere rollen lezen niets.
- **Retentie:** latest-only, geen cleanup nodig voor health.

### 7b. `simhub_device_diagnostic_events`

| kolom | type | constraint |
|---|---|---|
| `id` | bigint generated always as identity | PK |
| `device_id` | uuid | FK → `simhub_devices(id) ON DELETE CASCADE` |
| `code` | text | vaste enum (sectie 5) |
| `exception_type` | text \| null | |
| `detail` | text \| null | ≤ 200 chars (server-check) |
| `reported_at_utc` | timestamptz \| null | client-timestamp |
| `received_at` | timestamptz NOT NULL DEFAULT now() | server-timestamp |

- **Indexes:** `(device_id, received_at DESC)` voor het dashboard + per-device history; PK op id.
- **RLS:** schrijven service-role-only; lezen `super_admin`-only.

**Event-retention-besluit (v1):** gebruik **beide limieten**:
- max **100 diagnostic events per device**;
- max **7 dagen** bewaren.

Dus: events ouder dan **7 dagen verwijderen**, en daarnaast per device **alleen de nieuwste 100 behouden**. Implementatie: bij insert (of periodieke cleanup) events voor dat device ouder dan de 100ste/7 dagen verwijderen.
- `simhub_device_health` blijft **één actuele rij per device** en heeft **geen event-history-retention nodig** (sectie 7a).

### Server-write path

- Edge-functie `simhub-diagnostic`:
  1. `Authorization`-token → lookup `simhub_devices` via token_hash (service role);
  2. device-actief/geen revoke-check; indien revoked → wijs events af of schrijf enkel `DEVICE_REVOKED`;
  3. parse strict schema; weiger onbekende velden/codes;
  4. heartbeat → `INSERT … ON CONFLICT (device_id) DO UPDATE` in `simhub_device_health` (latest);
  5. event → insert in `simhub_device_diagnostic_events` met server-time;
  6. rate-limit: max 1 heartbeat/60 s + event-cooldown (sectie 8) server-side als harde bovengrens;
  7. return klein `{ok:true}` of foutcode.
- private RPC (SECURITY DEFINER, service-role-only) voor de upserts, gescheiden van telemetry-RPC.

---

## 8. Rate-limit / cooldown / deduplication — **[RESOLVED]**

**Gescheiden van normale telemetry-ingest. Geen gedeelde rate-limitbucket met race telemetry.**

**Heartbeat:**
- client max **1 per 60 seconden/device**;
- server **harde grens apart van ingest** (op dit endpoint; overschrijding → `429`, geen health-write; helpt ingest niet).

**Diagnostic status/error event:**
- **direct bij relevante state-change** (niet wachten op 60 s-tick);
- max **1 per 10 seconden/device**;
- **dedupe/cooldown** zodat dezelfde fout **niet blijft spammen**.

**Deduplication:** server houdt per device de laatst geschreven eventcode + tijd bij; dezelfde `code` binnen het cooldown-venster wordt niet opnieuw geschreven tenzij state of relevante detail veranderd is. Event wordt gestuurd bij **verandering** van diagnostic-state; geen herhaling zonder state-change binnen cooldown.

**429-handling:** client verlengt cooldown; geen directe retry; geen retry-storm (sectie 9).

---

## 9. Isolatie bij failure (wat gebeurt er per case)

Voor elk scenario: **telemetry-ingest blijft volledig onaangetast** (eigen client, eigen cooldown, niet-blokkerend).

| scenario | gedrag diagnostics | effect op ingest |
|---|---|---|
| diagnostics endpoint offline | heartbeat-events falen; `lastIngestHttpStatus`/eigen diag-status wordt gemarkeerd; **geen** retry, alleen volgende geplande tick (60 s) | geen |
| timeout (eigen timeout, kort) | eigen timeout-fout; volgende tick probeert opnieuw | geen |
| 401/403 (token/device ongeldig) | niet updateteren; event `INGEST_401/403` of `DEVICE_UNBOUND`; device-token niet roteren   | geen (lazer-401 uit ingest is gescheiden) |
| 429 (rate-limit) | cooldown verlengen; geen directe retry | geen |
| 500/5xx | event `INGEST_500`; volgende tick | geen |
| DNS/netwerk faalt | eigen timeout melding; volgende tick; geen retry-storm | geen |
| backend minutenlang onbereikbaar | diagnostics stoppen voor die minuten, queeu niets op; **geen retry-storm**; bij herstel draait de 60 s-tick gewoon verder | geen |
| telemetry-ingest faalt t.ch.zonder diagnostics | ingest-eigen gedrag ongewijzigd | n.v.t. |

**Geen retry-storm:** na elke failure wordt niet eerder opnieuw geprobeerd dan de normale 60 s-heartbeat-tick (of langer bij 429). Er is geen exponentiele backoff nodig, maar een vaste 60 s-cyclus; events volgen aparte 10 s-cooldown.

**Structuur:** diagnostics-rader naast telemetry-sender; geen gedeelde cancellation/resource-beëindiging die ingest-bedachtings-delay veroorzaakt. Beide delen `_shutdown`, maar diagnostics-http wordt apart gedisposed en aparte timeout.

---

## 10. Server offline-detection & UI-ready velden

- **Online/offline:** server rekent op `simhub_device_health.received_at` + een `online_window` (bijv. 150 s). In Race Control tonen we `online` (laatste heartbeat binnen window), `stale` (buiten window maar recent genoeg), `offline` (oud/geen).
- De health-rij blijft staan na offline (laatste context) — alleen `online`-vlag wordt niet gezet.
- Toekomstige UI (Race Control per device) leest deze tabel + laatste events via super-admin RPC/Realtime. Eerst contract+frozen, UI later.

---

## 11. Ontwerpkeuzes — **[ALLES RESOLVED]**

Alle open punten zijn voor v1 vastgelegd:

| # | keuze | besluit |
|---|---|---|
| 1 | Event retention | **beide limieten**: max **100 events/device** én max **7 dagen** (wie het eerste is, schrapt). Health blijft 1 rij/device, geen event-history-retention. (sectie 7b) |
| 2 | `deviceId`-in-body vs token | **server is authoritative**; als body `deviceId` bevat, moet die **exact** matchen met het token-device, anders **reject** (niet negeren). Ontwerp: token-binding is de identiteit, `deviceId` is enkel een consistency-check. (sectie 2) |
| 3 | Rate limits | **gescheiden van ingest**; heartbeat client max 1/60s + server harde grens apart; events client max 1/10s bij state-change; geen gedeelde bucket met telemetry. (sectie 8) |
| 4 | diagnosticCode lifecycle | blijkende actieve code zolang het probleem bestaat; bij herstel → `OK` + één recovery/state-change event; daarna **geen herhaalde OK-spam**. (sectie 4) |
| 5 | Updater-integratie | diagnostics **leest updater-state read-only**; **geen** remote update/install-trigger/restart/rollback-trigger/command-execution. Diagnostics v1 = observability, geen managementsysteem. (sectie 14) |

---

## 12. Bijkomende eis: geen invloed op sequence/session

- Diagnostics schrijft **nooit** naar `simhub_device_sessions`, `simhub_telemetry_latest` of de telemetry-event-tabellen.
- Diagnostics verhoogd de telemetry `sequence` **niet**.
- Diagnostics delen geen `_sendGate`/`_activeSend`-lock met ingest; ze hebben een volledig eigen vergrendeling.
- Een langzamende diagnostics-http mag de DataUpdate-verzendcyclus niet dwarsbomen.

---

## 13. Releasebesluit — **[RESOLVED]**

**Definitief optie A:**

- **0.3.9.0** = uitsluitend **updater-hardening**. Geen Diagnostics backend/Edge/DB in deze release.
- **0.3.10.0** = Remote Diagnostics v1 als aparte feature-release, pas nadat **0.3.9.0 stabiel** is.

Reden: updater-betrouwbaarheid is releasekritisch en moet geïsoleerd getest worden. Diagnostics introduceert nieuwe DB-, Edge-, security- en retention-oppervlakken en hoort daardoor niet in dezelfde release als de updater-hardening.

De bestaande 0.3.8.0 en M4 blijven ongemoeid; er wordt nu niets gebouwd.

---

## 14. Relatie tot updater-hardening / niet mengen — **[RESOLVED]**

- Diagnostics **leest** updater-state (`updater-state.json` dedicated store uit `simhub-updater-hardening.md` sectie 5) in event/heartbeat, **alleen read-only**.
- Diagnostics en updater-hardening mogen alleen op het **leesvlak** aanraken.

**Updater-integratie-besluit (v1):** remote diagnostics krijgt **GEEN** mogelijkheid voor:
- remote update;
- install trigger;
- restart;
- rollback trigger;
- command execution.

**Diagnostics v1 is uitsluitend observability, geen remote-managementsysteem.** Diagnostics mag nooit updater-state muteren, retries triggeren of installaties beïnvloeden.
- Beide documents zijn samen reviewable, maar de **releases** worden apart besloten (optie A: 0.3.9.0 = updater, 0.3.10.0 = diagnostics).
- M4 en SessionTime blijven apart en niet veranderd.
