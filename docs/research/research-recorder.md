# Research-recorder (plugin 0.7.0 — **verwijderd in 0.7.2.0**)

> **Status sinds 0.7.2.0: deze recorder bestaat niet meer.** De code (`Research*.cs`), het
> SimHub-paneel, de instellingen `ResearchEnabled`/`ResearchDirectory` en het testproject
> `3SM.EnduranceConnector.ResearchTests` zijn verwijderd. Dit document blijft staan als
> beschrijving van wat er tot 0.7.1.2 was en hoe een bestaand JSONL-bestand eruitziet.
> Bestaande opnames op schijf zijn gebruikersdata en worden door de plugin nooit
> verwijderd of aangeraakt.
>
> Laden van een oude configuratie met de researchsleutels blijft werken: onbekende
> sleutels worden genegeerd (zie `SettingsCompatibilityTests`).

Lokale, optionele opname van telemetrie voor onderzoek. De recorder is een **dunne laag
bovenop de bestaande capture**: hij leest niets opnieuw uit de SDK wat de capture al heeft,
schrijft JSONL via een begrensde wachtrij op een eigen thread en laat de bestaande capture
en het verzenden byte-identiek wanneer de opname uit staat.

- **Standaard uit.** Aanzetten gaat via SimHub → 3SM → Research. De keuze wordt lokaal bewaard
  (`ConnectorSettings.ResearchEnabled`, schemaversie 7).
- **Locatie:** `%LOCALAPPDATA%\3SM\EnduranceConnector\research\` (per sessie één `.jsonl`),
  naast `salt.txt` met de pseudonimiseringssalt.
- **Niets verlaat het apparaat vanzelf.** Er is geen upload, geen relay-verkeer en geen
  koppeling met backend, database of website. Exporteren is een expliciete knop.

## Aanzetten, pauzeren, stoppen

| Actie | Waar | Effect |
| --- | --- | --- |
| Aan/uit | Research → schakelaar | Aan: nieuwe sessie zodra iRacing telemetrie levert. Uit: `session_close` + flush. |
| Pauzeren / hervatten | Research → knoppen | Pauze stopt samples én markers; de flankdetectie blijft meelopen zodat hervatten geen valse markers geeft. |
| Status | Research → statusblok | Opgenomen samples, events, wachtrijdiepte, drops, bytes en het pad. |
| Verwijderen | Research → "Researchdata verwijderen" | Stopt de opname, verwijdert alle `.jsonl` én `salt.txt`. |
| Exporteren | Research → "Exporteren…" | Kopieert één sessiebestand naar een zelfgekozen pad. |
| Marker | Research → protocolmarker | Zet een herhaalbare marker in hetzelfde bestand (`source: "manual"`). |

## Bestandsformaat (JSONL, één record per regel)

`schemaVersion: 1`. Vier recordtypes + een afsluitregel:

| type | wanneer | inhoud |
| --- | --- | --- |
| `session_header` | regel 1, één keer | `schemaVersion`, `pluginVersion`, `simHubVersion`, `simulator`, `simulatorVersion` (indien beschikbaar), `units`, `track{name,config,id}`, `car{id,name}`, `sessionId`, `transportSessionId`, `startedAtUtc`, `sampling{contextMs,captureMs,tyres}`, `queue{capacity,dropPolicy}`, `privacy{...}`, `driverPseudoId`, `droppedSamplesAtOpen`, `dropAccounting` |
| `sample` | 1 Hz | `ts`, `sessionTimeSeconds`, `sequence`, `fields{...}` |
| `event` | op een flank of handmatig | `ts`, `sessionTimeSeconds`, `sequence`, `kind`, `source` (`auto`/`manual`), `data{...}` |
| `status` | elke 30 samples (instelbaar) | `written`, `queued`, `droppedSamples`, `paused` |
| `session_close` | laatste regel | `reason`, `samplesWritten`, `eventsWritten`, `droppedSamples`, `bytesWritten`, `durationSeconds`, `closedCleanly` |

Elk veld in `sample.fields` is een object:

```json
"wearPercent.frontLeft.0": {"v": 4.8, "p": "last_known", "at": "2026-10-25T20:00:00.000Z", "rateMs": 0, "r": "stale_snapshot"}
```

- `v` — waarde (getal, bool of tekst); `null` als er geen bruikbare waarde is.
- `p` — herkomst: `measured`, `last_known`, `estimated`, `unavailable`, `invalid`.
- `at` — **tijdstip van de laatste echte meting** aan de bron; alleen aanwezig als het afwijkt
  van `ts` (het sample-tijdstip).
- `rateMs` — sampleperiode van de bron; alleen aanwezig als die afwijkt van het sample-interval.
  `0` betekent: alleen bij een sim-refresh (banden). Ontbreekt `rateMs`, dan loopt de bron op
  hetzelfde 1 Hz-interval als het sample.
- `r` — korte reden (`frozen_pit_snapshot`, `stale_capture`, `channel_missing`, `out_of_range`, …).

## Herkomstregels

| Herkomst | Betekenis |
| --- | --- |
| `measured` | Op dit sample (of binnen de tolerantie) echt gemeten. |
| `last_known` | Laatst bekende waarde; `at` zegt wanneer die echt gemeten is. |
| `estimated` | Alleen door de plugin berekend (nu niet gebruikt; gereserveerd). |
| `unavailable` | De bron leverde niets. Nooit een 0 als vervanging. |
| `invalid` | Waarde viel buiten de plausibiliteitsgrens (sentinel/parsefout); het getal is weggelaten. |

**Een bevroren pit-snapshot is nooit `measured`.** Het pit-entry-anker uit de capture
(`V3Tyres.pitEntry`) komt in het sample als een eigen `pitEntry.*`-blok met herkomst
`last_known` en `r: "frozen_pit_snapshot"`. Dezelfde regel geldt voor iedere observatie met
`trigger: "pit_entry"`, ook als het sample zelf vers is.

## Frequenties en bronnen

| Veld(en) | Bron | Frequentie |
| --- | --- | --- |
| `steeringWheelRad` | ruw kanaal `SteeringWheelAngle` (rad) | 1 Hz |
| `latAccelMps2`, `longAccelMps2` | ruwe kanalen `LatAccel` / `LongAccel` (m/s²) | 1 Hz |
| `throttlePct`, `brakePct` | capture `vehicle`-blok; **alleen als dat blok ontbreekt** het ruwe kanaal (0–1 → %) | capture-interval / 1 Hz |
| `speedKph` | capture `vehicle`; anders de bestaande `SpeedKmh`-property | capture-interval / 1 Hz |
| `gear`, `rpm` | capture `vehicle` | capture-interval |
| `fuelLitres`, `fuelPerLapLitres`, `lapsRemaining` | capture `fuel` | capture-interval |
| `position`, `classPosition`, `completedLaps`, `lastLapSeconds`, `bestLapSeconds`, `currentLapElapsedSeconds`, `lapDistancePct`, `onPitRoad`, `incidents`, `sessionTimeSeconds` | capture (`timing`/`position`/`track`/`raceState`/`session`) | capture-interval |
| `wearPercent.<hoek>.<zone>`, `carcassTempC.<hoek>.<zone>`, `tyre.setsUsed`, `tyre.compoundId`, `trackTempC`, `airTempC`, `trackRubberState` | bestaande tyre-tracker in de capture | `rateMs: 0` (sim-refresh) |
| `pitEntry.*` | bevroren pit-entry-anker uit de capture | `rateMs: 0`, altijd `last_known` |
| `tyreSnapshotFrozenAt`, `pitEntry.frozenAt` | moment van bevriezen | `rateMs: 0` |

`<hoek>` is `frontLeft`, `frontRight`, `rearLeft`, `rearRight`; `<zone>` is `0` (left),
`1` (middle), `2` (right).

## Wachtrij, flush en crash-herstel

- **Niet-blokkerend.** De telemetrythread doet alleen `TryAdd` op een begrensde
  `BlockingCollection` (default 2048 records). Is die vol, dan telt de sample als drop en gaat
  de tick gewoon verder — er wordt nooit op schijf-I/O gewacht.
- **Drops zijn zichtbaar** in de `status`-records en in `session_close` (`droppedSamples`,
  cumulatief). De kopregel noemt het beleid (`dropAccounting`), want drops zijn per definitie
  pas bekend nadat er al geschreven is.
- **Flush:** na 64 records of 1 seconde (wat eerst komt) naar het OS; bij sluiten `Flush(true)`
  (fsync). Instelbaar via `ResearchRecorderOptions`.
- **Één bestand per sessie.** Nieuwe sessie (of opnieuw aanzetten) = nieuw bestand met nieuwe
  kopregel; bestaande bestanden worden nooit hergebruikt of aangevuld.
- **Crash-herstel.** Een half geschreven laatste regel wordt bij het teruglezen overgeslagen
  (`ResearchJsonlReader`); de regels ervoor blijven bruikbaar. Een kapotte regel midden in het
  bestand wordt gerapporteerd maar gooit nooit.

## Protocolmarkers

| `kind` | Trigger |
| --- | --- |
| `garage` | van "in de auto" naar "niet in de auto" |
| `stint` | in de auto stappen, of de pitstraat verlaten |
| `pit_entry` | `onPitRoad` gaat van false naar true |
| `pit_box` | op de pitstraat met snelheid ≤ 5 km/u (één keer per bezoek) |
| `tyre_change` | `TireSetsUsed` loopt op |
| `reset` | sessietijd springt > 5 s terug of rondeteller daalt |
| `session_end` | iRacing stopt (of de plugin sluit af) |

Elke marker is herhaalbaar: een tweede pitstop levert opnieuw `pit_entry`, `pit_box` en
`tyre_change`. Handmatige markers komen met `source: "manual"` en een `note`.

## Privacy

- Geen rijders-, team- of tegenstandernamen in het bestand. De kopregel bevat
  `driverPseudoId` = `p-` + eerste 16 hex van `SHA-256(salt | driverId)`.
- De salt (128 bits) staat lokaal in `salt.txt` en gaat **niet** mee met een export; zonder de
  salt is de ID niet terug te rekenen naar een iRacing `cust_id`, met de salt alleen met
  voorkennis van de kandidaat-ID's.
- Verwijderen wist de sessiebestanden én de salt.
- Bestanden zijn niet versleuteld: het zijn lokale onderzoeksbestanden in het gebruikersprofiel.

## Tests

De pure logica staat los van SimHub en is te compileren en te draaien zonder de plugin-DLL's:

```
cd tools/simhub-plugin/3SM.EnduranceConnector.ResearchTests
dotnet run            # 59 checks: provenance, capture-hergebruik, 1 Hz-gate, JSONL, wachtrij,
                      # drops, crash-herstel, markers, pseudonieme ID, end-to-end recorder
dotnet run -- --sample ../../docs/research/voorbeeld-sessie.jsonl   # voorbeeld opnieuw genereren
```

De harness bouwt met `LangVersion 7.3` — dezelfde taalversie als de plugin (net48) — en de
zelfde bestanden compileren ook tegen de .NET Framework 4.8-referentieassemblies.

## Beperkingen

1. **Niet op een echte SimHub/iRacing-installatie getest.** De pure logica is hier gedraaid;
   de pluginintegratie moet op Beest worden gebouwd en in SimHub worden gerooktest.
2. **Capture-velden bestaan alleen als de bestaande capture loopt.** De capture draait op het
   verzendpad (gekoppeld: `CaptureV3`; lokale fallback: `Capture`). Staat de relay op centraal
   zonder koppeling, dan leveren die velden `unavailable` — de recorder leest ze bewust niet
   zelf opnieuw.
3. **Bevroren anker: `at` is het moment van bevriezen**, niet de oorspronkelijke meting. De
   bestaande `TyreSnapshotTracker` bewaart dat eerdere tijdstip niet, en het V3-contract is
   niet aangepast om de payload byte-identiek te houden.
4. **Kanaalinterpretatie.** `Throttle`/`Brake` worden als iRacing-fractie 0–1 gelezen; een
   waarde boven 1 levert `unavailable` in plaats van een gok. Stuurhoek staat in radialen;
   er wordt niet naar graden omgerekend.
5. **Bestandsgrootte.** Ongeveer 4,5 kB per sample (≈ 16 MB per uur, ≈ 380 MB per 24 uur) —
   elke bandenzone draagt zijn eigen herkomst, tijdstip en frequentie. Er is geen compressie
   of rotatie op grootte; één bestand per sessie.
6. **Drop-teller staat in `status`/`session_close`, niet in de kopregel** (die wordt één keer
   geschreven). Bij een harde crash midden in een sessie is de drop-teller van die sessie
   alleen terug te lezen uit de laatste `status`-regel.
7. **`simulatorVersion` is `null`** als iRacing geen `WeekendInfo.BuildVersion` levert.
8. **Markers hangen aan de capture-state.** Zonder verse capture (> 5 s) worden geen markers
   gedetecteerd, zodat er nooit een marker op oude staat wordt gegokt. `pit_box` vereist een
   snelheid uit de capture.
9. **Pauzeren beëindigt de sessie niet**: het bestand blijft open en dezelfde sessie loopt door
   na hervatten. Stoppen (schakelaar uit of SimHub sluiten) schrijft `session_close`.
10. **Export is een kopie**, geen filter of aggregatie; de salt en dus de sleutel tot de
    pseudoniemen blijft achter op de pc waar is opgenomen.
