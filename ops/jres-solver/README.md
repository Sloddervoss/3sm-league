# JRES-solver microservice (Stap 2 — canary)

Bewezen optimalisatie via de **JRES C++/HiGHS MIP-solver** (MIT) als losse
microservice, precies zoals het open-source-onderzoek adviseerde. Dit is de
**optionele Stap 2**: de TypeScript-heuristiek in de StintPlanner werkt al; deze
service geeft bewezen-optimale planning (gap=0) voor grotere/24h-teams.

## Hoe het werkt
- **Container** `jres-solver:canary` bouwt de C++-core + een dunne Node-wrapper.
- **Wrapper** (`wrapper.js`): `POST /solve` met `{ input, options }` → spawn de
  binary (JSON in → JSON uit via tempfile) → retourneert `{ status, output }`.
- Rust op de **3sm-docker host** (`127.0.0.1:8090`, Supabase-host), niet op Edge
  Functions (native binair + HiGHS kan dat niet draaien).

## Bewijs (getest op 3sm-docker, 2026-08-05)
| Case | max | stint-verdeling | gap | solve |
|---|---|---|---|---|
| `short_race.json` (3 stints) | ok | Ayrton,Ayrton,Niki (consecutive=2) | 0 | 13 ms |
| `24h_race.json` (29 stints, integrated spotter) | ok | 6/6/6/6/5, elkeen + eigen spotter | **0** | **325 ms** |

`diagnosis: []` = geen infeasibility. Spotter-integrated wijst nooit coureur+spotter tegelijk aan.

## Build (op de host)
```bash
# 1) kopieer jres_solver_cpp-repo (met cxxopts-submodule) + deze map naar de host
# 2) zet de context klaar (zie build_jres_on_docker.sh) en:
bash build_jres_on_docker.sh
```
De Dockerfile is multi-stage: Stage 1 (=builder, gcc+cmake+HiGHS via FetchContent)
compileert; Stage 2 (=runtime, alleen static binary + node) is klein.

## Import-contract voor de 3SM StintPlanner (later te koppelen)
`POST http://127.0.0.1:8090/solve`
```json
{
  "input": {
    "success": true,
    "consecutiveStints": 3,
    "minimumRestHours": 4,
    "maximumBusyHours": 8,
    "firstStintDriver": "Niki",
    "teamMembers": [{"name":"Niki","isDriver":true,"isSpotter":false,"tzOffset":1}],
    "stints": [{"id":"1","startTime":"2026-09-12T12:00:00.000Z","endTime":"2026-09-12T14:00:00.000Z"}],
    "availability": {"Niki": {"2026-09-12T12:00:00.000Z": "Preferred", "...": "Available"}}
  },
  "options": { "timeLimit": 20, "spotterMode": "integrated", "allowNoSpotter": false }
}
```
→ `{ "status": "ok", "output": { "schedule": [{id,driver,spotter,startTime,endTime}], "diagnosis": [], "stats": {} } }`

**Belangrijke format-tips (uit de praktijk):**
- Voeg `"success": true` toe.
- Beschikbaarheid: **per uur-UTC-key** `YYYY-MM-DDTHH:00:00.000Z` = `Available|Preferred|Unavailable`.
- Stints zijn vaste segmenten (input), de solver verdeelt alleen coureurs/spot erover.
- `stints[].endTime` is dann exact race-einde normaal de laatste; de solver kapt af.
- `consecutiveStints`/`minimumRestHours`/`maximumBusyHours` zijn globale root-velden.

## Status
- ✅ Gebouwd + getest (short + 24h, integrated spotter, gap 0).
- ⏳ **Niet aan de StintPlanner gekoppeld** (bewust: Stap 1 heuristiek werkt; koppeling
  is de volgende stap en raakt productie-UI).
- ⏳ Container draait nu als lokale canary; geen deployments/releases gepubliceerd,
  niets gecommit.

## Bestanden
- `Dockerfile` (multi-stage build, target `solver` → `build/bin/jres_solver`)
- `wrapper.js` (Node HTTP-adapter, JSON in → JSON uit)
- `build_jres_on_docker.sh` (build + restart + smoke)
