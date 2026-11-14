# Pitwall learning — observation-policy publisher v1 (LOCAL)

Status: **lokale, additieve bouw. Niet gedeployed; geen productie-DDL, geen
Edge-deploy, geen clientactivatie en geen inschrijving.** Dit document beschrijft
wat de publisher wel en niet publiceert en waar de grens met de bestaande
leerlagen ligt.

## 1. Wat er is toegevoegd

Eén migratie (`20261114000945_pitwall_learning_observation_policy.sql`) voegt
exact één functie toe:

```
public.simhub_observation_policy_v1(p_token_hash text) RETURNS jsonb
```

plus haar ACL. De paired rollback
(`supabase/rollbacks/20261114000945_pitwall_learning_observation_policy.sql`)
dropt uitsluitend diezelfde functie. Er zijn geen tabellen, kolommen,
private-schema-grants, return-typewijzigingen of globale grant-intrekkingen.

De Edge-ontvanger `simhub-ingest-v3` roept de functie ná een **geaccepteerde**
V3-write en alleen wanneer de bestaande observation-modus `on` is. Het antwoord
krijgt dan één optioneel veld:

```json
"observation": {
  "enabled": true, "mode": "on", "available": true,
  "policy": {"captureAllowed": true, "policyVersion": 1}
}
```

`enabled`, `mode`, `available`, de ACK, de replay-/statuspaden en de
requestbytes blijven ongewijzigd. Zonder `on` doet de Edge-route **nul** extra
RPC's. Er is geen nieuwe endpoint, capability, cache, cron of configuratie.

## 2. Autoriteit

De owner komt uitsluitend uit de bestaande devicebinding:

```
public.simhub_devices.token_hash -> owner_user_id   (revoked_at IS NULL)
LEFT JOIN pitwall_learning.account_policy (capture_enabled, policy_version)
```

De aanvrager geeft nooit een owner, token of hash mee; de Edge-route gebruikt
dezelfde al gevalideerde tokenhash die zij voor de schrijf-RPC berekent. Dit is
machine-tokenauth, geen browser-JWT: er wordt bewust geen `auth.uid()`-owner
geëist. De functie is `SECURITY DEFINER`, `STABLE`, met gepinde
`search_path = pg_catalog, public, pg_temp` en volledig gekwalificeerde
relaties. `EXECUTE` is expliciet ingetrokken van `PUBLIC`, `anon` en
`authenticated` en alleen aan `service_role` gegeven; daarnaast weigert de
functie zelf een niet-`service_role`-claim.

Live lifecycle gecontroleerd: de bestaande Pair-routines `INSERT`en een nieuw
device met een nieuwe tokenhash en laten `owner_user_id` daarna ongemoeid;
intrekken zet alleen `revoked_at`. Er is dus geen ondersteunde rebind die
dezelfde geldige token aan een andere owner koppelt. Er is daarom geen nieuwe
serverepoch/hash/protocol nodig en er is geen latest-owner-backfill.

## 3. Antwoordmatrix

| Situatie | Antwoord |
| --- | --- |
| actieve token, policy `capture_enabled = true`, versie ≥ 1 | `{"captureAllowed": true, "policyVersion": <echte versie>}` |
| policy `capture_enabled = false` | `{"captureAllowed": false, "policyVersion": null}` |
| geen policyrij (niet ingeschreven) | deny/null |
| onbekende tokenhash | deny/null |
| ingetrokken device (`revoked_at`) | deny/null |
| NULL, leeg, verkeerde lengte, hoofdletters, niet-hex, witruimte | deny/null, zonder normalisatie |

Een toekomstige `policy_version` blijft de echte waarde (bijv. `2`); de publisher
zegent die nooit als `1`. De bestaande client weigert onbekende versies zelf.
Het antwoord bevat uitsluitend `captureAllowed` en `policyVersion` — geen owner,
device, token of hash.

## 4. Edge-fallback

De composer (`supabase/functions/_shared/observationPolicyV1.ts`) doet hooguit
één begrensde lookup (750 ms) per geaccepteerd antwoord en cachet niets. Bij
ontbrekende RPC, fout, timeout, niet-object of een allow zonder geldige
positieve integrale versie laat hij `policy` weg: de geaccepteerde 202 en ACK
blijven dan exact zoals voorheen. Een expliciete deny uit de database wordt wel
als `false/null` gepubliceerd. Er is geen isolate- of globaal geheugen van
accountrechten.

## 5. Privacy en bestaande handhaving

Ruwe observation-telemetrie ontvangen is niet hetzelfde als private
leercapture. De bestaande P1-projectie (`capture_source_batch`) blijft de
poort voor private capture en is in de rehearsal met de echte guard uitgeoefend:
account A (allowed) wordt vastgelegd, account B (`capture_enabled = false`)
niet, een account zonder policyrij niet, en het intrekken van A's toestemming
stopt verdere batches. De globale `capture_enabled`-schakelaar blijft
daarbovenop staan. De guard kijkt naar owner/policy, niet naar
`revoked_at`; die devicepoort zit in de tokenroute vóór de write.

## 6. Wat dit niet bewijst

- Geen productie- of Edge-deploy, geen migratie op een echte database, geen
  enrollment en geen geactiveerde client.
- De extra RPC is **niet** als performance-PASS gemeten. De bestaande
  productieclone-poort (p95 ≤ +10% én ≤ +20 ms op het volledige pad) blijft
  open tot een matched full-path meting.
- De rehearsal gebruikt de canonieke repo-DDL-keten met een minimale
  `simhub_devices`-stub, geen volledig productieschema of volledige
  ingest-rehearsal.
- `observation.enabled` en de settings-opt-in blijven ongewijzigd; dit pakket
  voegt geen UI, client-SDK of installatie toe.
