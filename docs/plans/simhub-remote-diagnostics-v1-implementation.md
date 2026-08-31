# 3SM Remote Diagnostics v1 — Implementation Plan

- **Release:** 0.3.10.0
- **Status:** PLAN / FASE A BEGONNEN — DB-migraties + RPCs in uitvoering.
  Nog GEEN productie-deploy, nog GEEN 0.3.10.0 release zonder aparte GO.
- **Datum:** 2026-08-31, herzien n.a.v. review-besluiten
- **Scope:** Remote Diagnostics v1 — uitsluitend observability, **geen** remote management

---

## 0. Ontwerpprincipe: harde isolatie

> **Diagnostics mogen NOOIT telemetry-ingest blokkeren, vertragen of sequence/session-state beïnvloeden.**

- Diagnostics gebruiken een **eigen** HTTP-client, eigen timeout, eigen CancellationToken, eigen `_diagnosticsBusy`-volatile en een eigen cooldown.
- Diagnostics starten los van het `DataUpdate`-telemetrypad: een aparte achtergrond-timer, nooit in een telemetry-send-blocking callback.
- Diagnostics delen alleen het **bestaande device-token** voor auth, maar gebruiken een **eigen endpoint** `…/simhub-diagnostic`.
- Diagnostics mogen de updater-state **alleen read-only** uitlezen (uit de persisted `UpdaterState`-store).
- Diagnostics mogen **nooit** updater-state muteren, updater starten, SimHub herstarten, commands uitvoeren.

---

## 1. Wire contract

### Endpoint
`POST https://api.3stripemotorsport.cc/functions/v1/simhub-diagnostic`

Auth: `Authorization: Bearer <device-token>` (zelfde principe als ingest)

Body-cap: ≤ 4 KiB, response klein.

### 1a. Heartbeat (`type: "heartbeat"`)

Alle velden `required` tenzij anders vermeld.

| Veld | Type | Nullable | Betekenis |
|---|---|---|---|
| `type` | string | nee | discriminator `"heartbeat"` |
| `deviceId` | string | nee | client-kennis van device; **server verifieert via token** |
| `connectorVersion` | string | nee | Assembly/File version van connector |
| `simHubVersion` | string | nee | SimHubWPF.exe FileVersion |
| `gameConnected` | bool | nee | iRacing `GameRunning` |
| `telemetryAvailable` | bool | nee | er is telemetry verzonden deze sessie |
| `rawDataAvailable` | bool | nee | `data.NewData != null` |
| `rawTelemetryAvailable` | bool | nee | rauwe iRacing-telemetry-object beschikbaar |
| `sessionTimeReadOk` | bool | nee | SessionTelemetryReader las SessionTime succesvol |
| `sessionTimeSeconds` | double | ja | laatst gelezen sessietijd (finite ≥ 0); null = n/a |
| `sessionTimeReader` | string | nee | lezer-identiteit (`"RawDataReflection"`) |
| `sequence` | int | nee | huidige telemetry-sequence teller |
| `lastTelemetryAttemptUtc` | string | ja | laatste telemetry-ingest verzendpoging |
| `lastSuccessfulIngestUtc` | string | ja | laatste geslaagde ingest |
| `lastIngestHttpStatus` | int | ja | laatste ingest HTTP-status (0 = netwerkfout) |
| `diagnosticCode` | string | nee | huidige vaste statuscode |
| `updaterState` | string | nee | persisted updater-FSM state (`IDLE`…`SUCCESS`/`FAILED`) |
| `updaterCurrentVersion` | string | nee | geïnstalleerde connector-versie |
| `updaterTargetVersion` | string | ja | te installeren remote versie (null als geen) |
| `lastUpdateResult` | string | ja | `"none"` / `"success"` / `"failure:<code>"` |
| `lastUpdateUtc` | string | ja | laatste update-poging |
| `clientReportedAtUtc` | string | nee | client-digitale timestamp van verzending |

**Voorbeeld heartbeat:**
```json
{
  "type": "heartbeat",
  "deviceId": "7e748fad-64a1-4fce-bc14-4f595480ff67",
  "connectorVersion": "0.3.9.0",
  "simHubVersion": "1.0.9735.26972",
  "gameConnected": true,
  "telemetryAvailable": true,
  "rawDataAvailable": true,
  "rawTelemetryAvailable": false,
  "sessionTimeReadOk": true,
  "sessionTimeSeconds": 1873.5,
  "sessionTimeReader": "RawDataReflection",
  "sequence": 410,
  "lastTelemetryAttemptUtc": "2026-08-31T18:18:33Z",
  "lastSuccessfulIngestUtc": "2026-08-31T18:18:31Z",
  "lastIngestHttpStatus": 202,
  "diagnosticCode": "OK",
  "updaterState": "IDLE",
  "updaterCurrentVersion": "0.3.9.0",
  "updaterTargetVersion": null,
  "lastUpdateResult": "none",
  "lastUpdateUtc": null,
  "clientReportedAtUtc": "2026-08-31T18:18:33Z"
}
```

### 1b. Status/error event (`type: "event"`)

| Veld | Type | Nullable | Betekenis |
|---|---|---|---|
| `type` | string | nee | `"event"` |
| `deviceId` | string | nee | idem heartbeat — server cross-check |
| `code` | string | nee | vaste diagnostic-eventcode |
| `atUtc` | string | nee | clienttijdstempel van gedetecteerd statusverloop |
| `exceptionType` | string | ja | alleen exception **type-naam**; nooit `Exception.Message` |
| `detail` | string | ja | **alleen 3SM-generated** (allowlist, max 200 chars); nooit raw exception text |
| `occurredAfter` | string | ja | voorgaande status die deze verandering triggerde |

**Voorbeeld event:**
```json
{
  "type": "event",
  "deviceId": "7e748fad-64a1-4fce-bc14-4f595480ff67",
  "code": "SESSION_TIME_READ_FAILED",
  "atUtc": "2026-08-30T20:01:03Z",
  "exceptionType": "System.Reflection.TargetInvocationException",
  "detail": "session time member not present",
  "occurredAfter": "OK"
}
```

---

## 2. DB-schema

### 2a. `simhub_device_health`

| Kolom | Type | Constraint | Betekenis |
|---|---|---|---|
| `device_id` | uuid | **PRIMARY KEY**, FK → `simhub_devices(id) ON DELETE CASCADE` | device |
| `connector_version` | text | NOT NULL | |
| `simhub_version` | text | NOT NULL | |
| `game_connected` | boolean | NOT NULL | |
| `telemetry_available` | boolean | NOT NULL | |
| `raw_data_available` | boolean | NOT NULL | |
| `raw_telemetry_available` | boolean | NOT NULL | |
| `session_time_read_ok` | boolean | NOT NULL | |
| `session_time_seconds` | double precision | | |
| `session_time_reader` | text | NOT NULL | |
| `sequence` | bigint | NOT NULL | |
| `client_last_telemetry_attempt_utc` | timestamptz | | **client-reported**, niet authoritative |
| `client_last_successful_ingest_utc` | timestamptz | | **client-reported**, niet authoritative |
| `client_last_ingest_http_status` | integer | | **client-reported**, niet authoritative |
| `diagnostic_code` | text | NOT NULL, CHECK in allowed codes | |
| `updater_state` | text | NOT NULL | |
| `updater_current_version` | text | NOT NULL | |
| `updater_target_version` | text | | |
| `last_update_result` | text | | |
| `last_update_utc` | timestamptz | | |
| `client_reported_at_utc` | timestamptz | | client-timestamp |
| `received_at` | timestamptz | NOT NULL DEFAULT now() | server-timestamp (online-basis) |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

**Indexes:** PK op `device_id` volstaat (latest-only). Optionele index op `received_at` voor online/offline-lijst-query.

**RLS:**
- Schrijven: alleen via service-role RPC (device-token → token-hash lookup), niet door anon/authenticated.
- Lezen: `super_admin` via narrow RPC of Realtime publication.

### 2b. `simhub_device_diagnostic_events`

| Kolom | Type | Constraint |
|---|---|
| `id` | bigint generated always as identity | PK |
| `device_id` | uuid | FK → `simhub_devices(id) ON DELETE CASCADE`, NOT NULL |
| `code` | text | NOT NULL, CHECK in allowed codes |
| `exception_type` | text | |
| `detail` | text | ≤ 200 chars (server-check) |
| `reported_at_utc` | timestamptz | client-timestamp |
| `received_at` | timestamptz | NOT NULL DEFAULT now() |

**Indexes:** `(device_id, received_at DESC)` voor per-device history; PK op `id`.

**RLS:** schrijven service-role-only; lezen `super_admin`-only.

**Retentie:** beide limieten: max 100 events per device **en** max 7 dagen (wie het eerst is, schrapt). Bij insert: events ouder dan 7 dagen verwijderen, en daarna voor dat device alleen de nieuwste 100 behouden.

### 2c. Accessory: `diagnostic_code` constraint

```sql
CREATE TYPE simhub_diagnostic_code AS ENUM (
    'OK', 'RAW_DATA_UNAVAILABLE', 'RAW_TELEMETRY_UNAVAILABLE',
    'SESSION_TIME_READ_FAILED', 'TELEMETRY_STALE',
    'INGEST_401', 'INGEST_403', 'INGEST_429', 'INGEST_500',
    'DEVICE_UNBOUND', 'DEVICE_REVOKED',
    'UPDATE_CHECK_FAILED', 'UPDATE_DOWNLOAD_FAILED', 'UPDATE_HASH_FAILED',
    'UPDATE_SIGNATURE_FAILED', 'UPDATE_INSTALL_FAILED',
    'UPDATE_DLL_LOCKED', 'UPDATE_ROLLBACK_USED'
);
```

---

## 3. Edge / RPC flow

### 3a. Nieuwe Edge-function: `simhub-diagnostic`

```
POST /functions/v1/simhub-diagnostic
Authorization: Bearer <device-token>
Content-Type: application/json
```

**Flow:**
1. Extract token uit `Authorization` header.
2. `sha256Hex(token)` → lookup `simhub_devices` via token_hash (service role).
3. Device check: niet revoked, niet verlopen, token matcht.
4. Body-deviceId cross-check: als body `deviceId` bevat, moet die exact matchen met het token-device; mismatch → reject (401).
5. Strict schema validatie: `exactKeys` per type, weiger onbekende velden.
6. **Heartbeat:** `INSERT … ON CONFLICT (device_id) DO UPDATE` in `simhub_device_health`.
7. **Event:** insert in `simhub_device_diagnostic_events` + cleanup oude events.
8. Rate-limit check (sectie 4).
9. Return `{ ok: true }` of foutcode.
10. **Failure isolation:** alle fouten worden gevangen; geen crash die andere Edge-functions beïnvloedt.

### 3b. Nieuwe RPC (SECURITY DEFINER, service-role-only): `simhub_upsert_health`

```sql
CREATE OR REPLACE FUNCTION simhub_upsert_health(
    p_token_hash text,
    p_health jsonb
) RETURNS jsonb
    SECURITY DEFINER
    LANGUAGE plpgsql AS $$
DECLARE
    v_device simhub_devices;
    v_result jsonb;
BEGIN
    SELECT * INTO v_device FROM simhub_devices
    WHERE token_hash = p_token_hash AND revoked_at IS NULL
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;

    INSERT INTO simhub_device_health AS h (
        device_id, connector_version, simhub_version,
        game_connected, telemetry_available, raw_data_available,
        raw_telemetry_available, session_time_read_ok, session_time_seconds,
        session_time_reader, sequence, client_last_telemetry_attempt_utc,
        client_last_successful_ingest_utc, client_last_ingest_http_status, diagnostic_code,
        updater_state, updater_current_version, updater_target_version,
        last_update_result, last_update_utc, client_reported_at_utc,
        received_at, updated_at
    ) VALUES (
        v_device.id,
        p_health->>'connectorVersion',
        p_health->>'simHubVersion',
        (p_health->>'gameConnected')::boolean,
        (p_health->>'telemetryAvailable')::boolean,
        (p_health->>'rawDataAvailable')::boolean,
        (p_health->>'rawTelemetryAvailable')::boolean,
        (p_health->>'sessionTimeReadOk')::boolean,
        (p_health->>'sessionTimeSeconds')::double precision,
        p_health->>'sessionTimeReader',
        (p_health->>'sequence')::bigint,
        (p_health->>'lastTelemetryAttemptUtc')::timestamptz,
        (p_health->>'lastSuccessfulIngestUtc')::timestamptz,
        (p_health->>'lastIngestHttpStatus')::integer,
        p_health->>'diagnosticCode',
        p_health->>'updaterState',
        p_health->>'updaterCurrentVersion',
        p_health->>'updaterTargetVersion',
        p_health->>'lastUpdateResult',
        (p_health->>'lastUpdateUtc')::timestamptz,
        (p_health->>'clientReportedAtUtc')::timestamptz,
        now(), now()
    ) ON CONFLICT (device_id) DO UPDATE SET
        connector_version = EXCLUDED.connector_version,
        simhub_version = EXCLUDED.simhub_version,
        game_connected = EXCLUDED.game_connected,
        telemetry_available = EXCLUDED.telemetry_available,
        raw_data_available = EXCLUDED.raw_data_available,
        raw_telemetry_available = EXCLUDED.raw_telemetry_available,
        session_time_read_ok = EXCLUDED.session_time_read_ok,
        session_time_seconds = EXCLUDED.session_time_seconds,
        session_time_reader = EXCLUDED.session_time_reader,
        sequence = EXCLUDED.sequence,
        client_last_telemetry_attempt_utc = EXCLUDED.client_last_telemetry_attempt_utc,
        client_last_successful_ingest_utc = EXCLUDED.client_last_successful_ingest_utc,
        client_last_ingest_http_status = EXCLUDED.client_last_ingest_http_status,
        diagnostic_code = EXCLUDED.diagnostic_code,
        updater_state = EXCLUDED.updater_state,
        updater_current_version = EXCLUDED.updater_current_version,
        updater_target_version = EXCLUDED.updater_target_version,
        last_update_result = EXCLUDED.last_update_result,
        last_update_utc = EXCLUDED.last_update_utc,
        client_reported_at_utc = EXCLUDED.client_reported_at_utc,
        updated_at = now();

    RETURN jsonb_build_object('result', 'accepted');
END;
$$;
```

### 3c. Nieuwe RPC: `simhub_insert_diagnostic_event`

```sql
CREATE OR REPLACE FUNCTION simhub_insert_diagnostic_event(
    p_token_hash text,
    p_event jsonb
) RETURNS jsonb
    SECURITY DEFINER
    LANGUAGE plpgsql AS $$
DECLARE
    v_device simhub_devices;
    v_detail text;
BEGIN
    SELECT * INTO v_device FROM simhub_devices
    WHERE token_hash = p_token_hash AND revoked_at IS NULL
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;

    v_detail := p_event->>'detail';
    IF v_detail IS NOT NULL AND length(v_detail) > 200 THEN
        v_detail := left(v_detail, 200);
    END IF;

    INSERT INTO simhub_device_diagnostic_events
        (device_id, code, exception_type, detail, reported_at_utc, received_at)
    VALUES (
        v_device.id,
        p_event->>'code',
        p_event->>'exceptionType',
        v_detail,
        (p_event->>'atUtc')::timestamptz,
        now()
    );

    -- Retention: keep max 100 per device, max 7 days
    DELETE FROM simhub_device_diagnostic_events
    WHERE device_id = v_device.id
    AND (received_at < now() - interval '7 days'
         OR id NOT IN (
             SELECT id FROM simhub_device_diagnostic_events
             WHERE device_id = v_device.id
             ORDER BY received_at DESC
             LIMIT 100
         ));

    RETURN jsonb_build_object('result', 'accepted');
END;
$$;
```

---

## 4. Auth-model

- **Zelfde principe als ingest:** de connector stuurt HTTP `Authorization: Bearer <device-token>` (DPAPI-protected, alleen uit memory-time ontsleuteld). **Nooit** token in query/body/logs.
- **Server-side koppeling aan device:** de Edge-functie doet token→device lookup via `sha256Hex(token)` → `simhub_devices.token_hash`.
- **Body-deviceId cross-check:** als body `deviceId` bevat, moet die exact matchen met het device uit de token. Mismatch → reject (401). De server is **altijd authoritative**; `deviceId` is alleen een consistency-check.
- **Revoked/expired device:** als device `revoked_at IS NOT NULL` → reject met `DEVICE_REVOKED`, geen health/event schrijven.

---

## 5. Rate limits

**Gescheiden van telemetry-ingest. Geen gedeelde rate-limitbucket met `simhub-ingest`.**

### Heartbeat
- **Client:** maximaal 1 per 60 seconden per device (cooldown-based timer).
- **Server — DB/RPC-authoritative:** de RPC checkt `received_at` van de vorige heartbeat voor dat device. Als `now() - received_at < 55 seconds` → reject met 429 (`"diagnostic_rate_limited"`). Tolerantie 55s (i.p.v. 60) accepteert clock/jitter. `received_at` (server timestamp) is authoritative.
- **Edge mag daarnaast een snelle lokale limiter hebben** (bijv. `consumeEdgeRateLimit("diagnostic-address:<cf-ip>", 60, 60 * 1000)`), maar de DB/RPC is de uiteindelijke authority.
- **Geen gedeelde bucket met telemetry-ingest.**

### Status/error event
- **Client:** alleen bij state change, maximaal 1 per 10 seconden per device.
- **Server — DB/RPC-authoritative:** de RPC checkt `received_at` van het vorige event voor dat device met dezelfde `code`. Als `now() - received_at < 10 seconds` → reject (dedupe). State change zonder code-wijziging binnen cooldown wordt gededupliceerd.
- **Recovery → OK:** één herstel-event, daarna geen herhaalde `OK`-spam.

### 429-handling (client)
- Client verlengt cooldown. Geen directe retry. Volgende heartbeat na 60 s.
- **Belangrijk:** de 429 komt nu van de RPC (DB-authoritative rate limit), niet alleen van de Edge. Client behandelt elke 429 hetzelfde: cooldown verlengen, geen directe retry.

---

## 6. Retention

| Tabel | Limiet | Implementatie |
|---|---|---|
| `simhub_device_health` | 1 rij per device (latest) | `ON CONFLICT (device_id) DO UPDATE` |
| `simhub_device_diagnostic_events` | max 100 events/device | `DELETE` bij insert (zie RPC) |
| | max 7 dagen | `DELETE` bij insert **plus** periodieke cleanup (bv. dagelijkse cron). Periodieke cleanup is noodzakelijk omdat devices die stoppen met events sturen nooit meer per-insert cleanup triggeren. Bestaande cron/scheduler gebruiken; geen nieuwe infrastructuur. |

---

## 7. Diagnostic codes

Vaste toegestane codes (enum/allowlist, server-side geweigerd als niet in deze set):

| Code | Betekenis |
|---|---|
| `OK` | Alles goed |
| `RAW_DATA_UNAVAILABLE` | `data.NewData` ontbreekt ondanks `gameConnected` |
| `RAW_TELEMETRY_UNAVAILABLE` | RawData.Telemetry-object niet bereikbaar |
| `SESSION_TIME_READ_FAILED` | SessionTelemetryReader las geen geldige SessionTime |
| `TELEMETRY_STALE` | Ingest actueel (geen fresh telemetry in venster) |
| `INGEST_401` | Ingest HTTP 401 (ongeldig token) |
| `INGEST_403` | Ingest HTTP 403 (verboden) |
| `INGEST_429` | Ingest HTTP 429 (rate-limited) |
| `INGEST_500` | Ingest HTTP 500/server error |
| `DEVICE_UNBOUND` | Device niet actief/ongebonden |
| `DEVICE_REVOKED` | Device ingetrokken |
| `UPDATE_CHECK_FAILED` | Update check HTTP/netwerkfout |
| `UPDATE_DOWNLOAD_FAILED` | Download van update DLL mislukt |
| `UPDATE_HASH_FAILED` | SHA256 mismatch na download |
| `UPDATE_SIGNATURE_FAILED` | RSA signature mismatch |
| `UPDATE_INSTALL_FAILED` | Updater installatiefout |
| `UPDATE_DLL_LOCKED` | DLL in gebruik, updater kan niet vervangen |
| `UPDATE_ROLLBACK_USED` | Updater heeft rollback uitgevoerd |

**Lifecycle:** actieve `diagnosticCode` blijft staan zolang het probleem bestaat. Bij herstel → `OK` + één recovery-event. Daarna geen herhaalde `OK`-spam.

---

## 8. Failure isolation

Voor elk scenario: **telemetry-ingest blijft volledig onaangetast** (eigen client, eigen cooldown, niet-blokkerend).

| Scenario | Diagnostics-gedrag | Effect op ingest |
|---|---|---|
| Endpoint offline | Heartbeat faalt; volgende tick (60s) probeert opnieuw | Geen |
| Timeout (eigen timeout, kort) | Eigen timeout-fout; volgende tick | Geen |
| 401/403 (token ongeldig) | Event `INGEST_401/403` of `DEVICE_UNBOUND`; geen token-rotatie | Geen |
| 429 (rate-limit) | Cooldown verlengen; geen directe retry | Geen |
| 500/5xx | Event `INGEST_500`; volgende tick | Geen |
| DNS/netwerk faalt | Eigen timeout-melding; volgende tick; geen retry-storm | Geen |
| Backend minutenlang onbereikbaar | Diagnostics stoppen voor die minuten, queue niets op; **geen retry-storm**; bij herstel draait de 60s-tick gewoon verder | Geen |
| Telemetry-ingest faalt zonder diagnostics | Ingest-eigen gedrag ongewijzigd | n.v.t. |

**Geen retry-storm:** na elke failure wordt niet eerder opnieuw geprobeerd dan de normale 60s-heartbeat-tick (of langer bij 429). Er is geen exponentiële backoff nodig, maar een vaste 60s-cyclus; events volgen aparte 10s-cooldown.

**Structuur:** diagnostics-timer naast telemetry-sender; geen gedeelde cancellation/resource die ingest-verzenddelay veroorzaakt. Beide delen `_shutdown`, maar diagnostics-http wordt apart gedisposed met aparte timeout.

---

## 9. Privacy/security review

### Expliciete allowlist — WEL
- `type`, `deviceId` (cross-check, nooit authoritative)
- `connectorVersion`, `simHubVersion`
- `gameConnected`, `telemetryAvailable`, `rawDataAvailable`, `rawTelemetryAvailable`
- `sessionTimeReadOk`, `sessionTimeSeconds`, `sessionTimeReader`
- `sequence`
- `lastTelemetryAttemptUtc`, `lastSuccessfulIngestUtc`, `lastIngestHttpStatus`
- `diagnosticCode`
- `updaterState`, `updaterCurrentVersion`, `updaterTargetVersion`, `lastUpdateResult`, `lastUpdateUtc`
- `clientReportedAtUtc`, `atUtc`
- (event) `code`, `exceptionType` (alleen type-naam), `detail` (kort, gesanitized, ≤ 200 chars), `occurredAfter`

### HARD VERBODEN — NOOIT versturen
- Bearer/device-token (nooit in body/query/logs)
- Authorization headers (nooit loggen)
- Passwords / secrets
- Volledige requests/responses
- Volledige SimHub.log of logs
- Volledige telemetry-payload of data-velden (lap/speed/fuel/pos etc.)
- Arbitrary/volledige stack traces
- Windows-gebruikersnaam (`Environment.UserName` verboden)
- Lokale persoonlijke bestandspaden (geen `%LOCALAPPDATA%`, geen SimHub-map-pad)

### Sanitization
- `detail`: max 200 chars, eerste volledige whitespace-trim; geen paden/tokens/gebruikersnamen.
- `exceptionType`: alleen de volledige type-naam van de top-level exception (bijv. `System.InvalidOperationException`); géén `InnerException`, géén stack.
- De code die `detail` vult wordt geconstipeerd om alleen uit een vaste, geprefixeerde waarschuwing te bestaan en niet de ruwe exception-message.

---

## 10. Implementatievolgorde

| Fase | Wat | Afhankelijk van |
|---|---|---|
| **A** | DB-migratie: `simhub_device_health` + `simhub_device_diagnostic_events` + triggers + RLS + RPCs (2x) | Niets |
| **B** | Edge-function `simhub-diagnostic` (nieuw bestand `supabase/functions/simhub-diagnostic/index.ts`) | Fase A (DB-schema + RPCs) |
| **C** | Connector: `DiagnosticsClient.cs` — aparte HTTP-client, heartbeat-sampler, event-pusher, cooldown, isolation | Niets (geen nieuwe DB-afhankelijkheid voor client) |
| **D** | Connector: integratie in `EnduranceConnectorPlugin.cs` — `DataUpdate`-onafhankelijke timer, updater-state read-only, status-velden | Fase C |
| **E** | Connector: `ConnectorSettings.cs` — `DiagnosticsEnabled` boolean (default true) | Fase C |
| **F** | Connector: Unit tests voor diagnostics (see testmatrix) | Fase C+D |
| **G** | Terug naar `main` mergen, BUILD + TEST + FREEZE volgens `3sm-simhub-release` skill | Fase A-F |
| **H** | PUBLICATIE (pas na apart GO) | Fase G |

**Belangrijk:** Fase A en B zijn onafhankelijk van C/D/E — de DB en Edge kunnen al worden gemigreerd/getest zonder connector-release. Maar Fase C/D/E vereisen dat de Edge-function live is (of een test-mock).

---

## 11. Testmatrix

| # | Test | Verwachting |
|---|---|---|
| T01 | Geldige heartbeat met correct token | Health-row upsert, `result: accepted` |
| T02 | Geldige heartbeat met token/deviceId mismatch | 401 reject |
| T03 | Ongeldig/bad token | 401 reject |
| T04 | Revoked device | 401 reject |
| T05 | Malformed payload (onbekende velden) | 422 reject |
| T06 | Oversized payload (> 4 KiB) | 413 reject |
| T07 | Event rate limit (10s cooldown) | 2e event binnen 10s → 429 of dedupe |
| T08 | Heartbeat rate limit (60s) | 2e heartbeat binnen 60s → 429 |
| T09 | Recovery → OK event | Eén OK-event, geen herhaling |
| T10 | Retention: 100+ events per device | Oudste events verwijderd, max 100 |
| T11 | Retention: events ouder dan 7 dagen | Verwijderd |
| T12 | RLS: anon/authenticated kan niet schrijven | Forbidden |
| T13 | RLS: super_admin kan lezen | Data zichtbaar |
| T14 | Diagnostics endpoint offline (simulatie) | Telemetry blijft werken |
| T15 | Timeout op diagnostics-request | Telemetry blijft werken |
| T16 | 429 van diagnostics endpoint | Telemetry blijft werken |
| T17 | 500 van diagnostics endpoint | Telemetry blijft werken |
| T18 | Telemetry en diagnostics tegelijk actief | Beide werken, geen sequence-beïnvloeding |
| T19 | Updater-state read-only bewijs | Diagnostics leest state, muteert niet |
| T20 | Geen secrets/logs in payload | Allowlist-check, geen token/stack/path in body |

---

## 12. UI-ready velden (voor Race Control, nog NIET bouwen)

| Veld | Bron |
|---|---|
| Online/offline | `received_at` + online_window (150s) |
| Connector version | `simhub_device_health.connector_version` |
| SimHub version | `simhub_device_health.simhub_version` |
| Heartbeat age | `now() - received_at` |
| Game connected | `game_connected` |
| Raw telemetry OK | `raw_telemetry_available` |
| SessionTime reader OK | `session_time_read_ok` |
| Current SessionTime | `session_time_seconds` |
| Ingest status | `client_last_ingest_http_status` |
| Diagnostic code | `diagnostic_code` |
| Updater state | `updater_state` |
| Current/target version | `updater_current_version` / `updater_target_version` |
| Last update result | `last_update_result` / `last_update_utc` |

Online/offline wordt server-side berekend op `received_at` + 150s window. De health-rij blijft staan na offline (laatste context) — alleen `online`-vlag wordt niet gezet.

---

## 13. Open vragen / blockers

| # | Vraag | Status |
|---|---|---|
| 1 | Diagnostics `DiagnosticsEnabled` setting default **true** of **false**? | Voorstel: true (alleen gezond verstand; als diagnostics faalt, is dat een signaal op zich) |
| 2 | Moet diagnostics werken **zonder pairing** (device token)? | Nee — diagnostics vereist een geldig device-token (zelfde als ingest). Zonder pairing geen diagnostics. |
| 3 | Server-side rate-limit: in-memory Edge (per instance) of DB-backed? | In-memory Edge (per instance) is voldoende voor v1. Bij multi-instance: `consumeEdgeRateLimit` per instance, maar dat is acceptabel voor v1. |
| 4 | `simhub_device_health` lezen via Realtime publication of narrow RPC? | Narrow RPC (`simhub_read_device_health(p_admin_token)`) is veiliger voor v1. Realtime later. |
| 5 | Migratie rollback: simpele `DROP TABLE` of bewaar rollback script? | Standaard rollback.sql zoals bestaande migraties. |
| 6 | Connector `0.3.10.0` branch: `release/simhub-0.3.10.0`? | Ja, volgens `3sm-simhub-release` skill. |

---

## 14. Connector-wijzigingen (C#) — overzicht

### Nieuw bestand: `DiagnosticsClient.cs`

```csharp
namespace ThreeSM.EnduranceConnector
{
    internal sealed class DiagnosticsClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly CancellationTokenSource _shutdown = new();
        private readonly object _gate = new();
        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly SessionTelemetryReader _sessionTime = new();
        private readonly string _diagnosticsEndpoint;
        private int _diagnosticsBusy;
        private long _lastHeartbeatMs;
        private long _lastEventMs;
        private string _currentCode = "OK";
        private string _previousCode = "OK";

        // Settings
        private const int HeartbeatIntervalMs = 60_000;
        private const int EventCooldownMs = 10_000;
        private const int HttpTimeoutMs = 5_000;

        public DiagnosticsClient(string baseUrl) { /* ... */ }

        public void Start(Uri endpoint, string token, string deviceId, string connectorId) { /* ... */ }
        public void Stop() { /* ... */ }

        // Called from DataUpdate thread — non-blocking, updates state, does NOT send
        public void Observe(GameData data, bool gameRunning, bool isInCar) { /* ... */ }

        // Called from SendAsync to track ingest status
        public void RecordIngestAttempt(DateTime utc, int? httpStatus) { /* ... */ }

        // Internal: fires heartbeat on 60s timer
        private async Task SendHeartbeatAsync(string token, string deviceId, string connectorId, string simHubVersion, CancellationToken ct) { /* ... */ }

        // Internal: fires event on state change (cooldown-gated)
        private async Task SendEventAsync(string token, string deviceId, string code, string exceptionType, string detail, CancellationToken ct) { /* ... */ }

        public void Dispose() { /* ... */ }
    }
}
```

### Wijzigingen in `EnduranceConnectorPlugin.cs`

- **Nieuwe velden:** `_diagnostics`, `_lastTelemetryAttemptUtc`, `_lastSuccessfulIngestUtc`, `_lastIngestHttpStatus`.
- **`Init()`:** start `_diagnostics` als `Settings.UseCentralRelay && IsPaired`.
- **`DataUpdate()`:** roept `_diagnostics?.Observe(...)` aan (non-blocking, na de interval-gate).
- **`SendAsync()`:** roept `_diagnostics?.RecordIngestAttempt(...)` aan bij succes/failure.
- **`End()`:** roept `_diagnostics?.Stop()` aan.
- **`Capture()`:** leest `rawDataAvailable` (data.NewData != null) en `rawTelemetryAvailable` (+ reflectie check) voor diagnostics.
- **Updater-state:** read-only via `UpdaterStateStore.TryRead()` (bestaande 0.3.9.0 state-store).

### Wijzigingen in `ConnectorSettings.cs`
- `public bool DiagnosticsEnabled = true;` (default true, noemt in Settings UI)

---

## 15. Release

0.3.10.0 volgt de bestaande `3sm-simhub-release` skill en MACHINE/HUMAN artifact-flow.

**Nog NIET bouwen, NIET migreren, NIET Edge-function publiceren, NIET release maken.**

Eerst dit plan reviewen. Pas na GO starten met Fase A (DB-migratie).