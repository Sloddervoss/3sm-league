# Nul-, onbekend- en sentinel-semantiek in de V3-payload (plugin 0.7.2.0)

Dit document beschrijft **welke velden null kunnen zijn** in de telemetry die de 3SM
SimHub-connector verstuurt, en **wat de server daarmee moet doen**. Het is de
tegenhanger van de wijziging in `CaptureValueRules.cs`, `TyreZoneReader.cs` en
`CaptureV3()`, met tests in `3SM.EnduranceConnector.DiagnosticsTests`
(`CaptureNullSemanticsTests`, N01–N45).

## De drie toestanden

| Toestand | In de payload | Betekenis |
|---|---|---|
| **onbekend** | `null` (of de sleutel ontbreekt) | De bron leverde niets: kanaal ontbreekt, speler zit niet in de auto, SimHub geeft de property niet door. |
| **nul** | `0` | Een echte meting. Een lege tank in de garage, een nieuwe band met 0,00 % wear, 0 s resterende reparatie. |
| **sentinel** | `null` | De sim gebruikt een aparte waarde voor "geen waarde" (iRacing: `-1`, `32767`, `65535`). Die wordt nooit als getal doorgestuurd. |

**Regel voor de server: `null` is geen 0 en 0 is geen `null`.** Een ontbrekende meting
mag nooit als 0 in een gemiddelde, integraal of drempelvergelijking belanden.

## Wat er in 0.7.1.2 misging

| Plek | Oud gedrag | Nu |
|---|---|---|
| `fuel.fuelLitres` | Ontbrekende brandstof werd `0` (`Math.Max(0, GetDouble(..., 0))`). | `null`; een gemeten 0 blijft `0`. |
| `fuel.fuelPct` | Kwam uit dezelfde 0, dus `0` % bij een onbekende tank. | `null` zonder liters of zonder plausibele tankinhoud. |
| `track.onPitRoad` | Viel terug op `false` als de property ontbrak. | `null`; ruwe `OnPitRoad` uit de SDK eerst, de SimHub-property als vangnet. |
| `tyres.wearPercent` | Wearfractie `0` werd weggefilterd ("geen meting"). | `0` = `0,00 %` (nieuwe band); alleen een ontbrekend kanaal is `null`. |

## Velden die null kunnen zijn

### `fuel`
| Veld | Null wanneer | Server |
|---|---|---|
| `fuelLitres` | Geen brandstofkanaal, of een waarde buiten 0–250 L (sentinel/onmogelijk). | Niet gebruiken voor stint- of verbruiksberekeningen. Geen 0 invullen. |
| `fuelPct` | Geen liters, of geen plausibele `fuelCapacityLitres`. | Idem; niet als "leeg" interpreteren. |
| `fuelPerLapLitres` | Nog geen ronde met een bruikbare delta gemeten. | Overslaan. |
| `lapsRemaining` | Geen liters én geen schatting van de sim. | Overslaan. |
| `fuelCapacityLitres` | Sessiegegevens geven geen tankinhoud. | Geen percentage afleiden. |

### `track`
| Veld | Null wanneer | Server |
|---|---|---|
| `onPitRoad` | Noch het SDK-kanaal `OnPitRoad`, noch de pitlane-property is leesbaar. | **Niet** als "niet in de pitstraat" behandelen. Een pit-entry-anker alleen zetten bij een expliciete `true`-flank. |
| `lapDistancePct` | Geen property, geen tegenstanderrij, of buiten 0–1. | Overslaan. |

### `pitService`
| Veld | Null wanneer | Server |
|---|---|---|
| `pitServiceFlagsRaw` | Kanaal ontbreekt of is negatief (sentinel). | Geen aangevinkte service veronderstellen. `0` betekent wél "niets aangevinkt". |
| `requiredRepairSeconds` / `optionalRepairSeconds` | Kanaal ontbreekt, `-1`, of buiten 0–86 400 s. | `0` = "er staat niets open"; `null` = onbekend. |

### `tyres`
| Veld | Null wanneer | Server |
|---|---|---|
| `wearPercent.<hoek>[i]` | Wear-kanaal ontbreekt, of de fractie valt buiten 0–1,001. | `0` is een nieuwe band. Alleen `null` betekent "geen meting". |
| `carcassTempC.<hoek>[i]` | Kanaal ontbreekt, of buiten −40…300 °C. | `0 °C` is een geldige meting (koude band in de garage). |
| `sets.*` | Kanaal ontbreekt. | `available = 255` is de SDK-tekst voor "onbeperkt", geen aantal. |

### Overige bestaande nulls
`session.sessionLapsRemaining`, `session.sessionTimeRemainingSeconds`,
`timing.*`, `position.*`, `raceState.incidents`, `identity.trackId` en alle
`vehicle`-velden zijn al nullable en ongewijzigd: `null` betekent daar "niet geleverd".

## Wat dit betekent voor de ingest

1. **Sla `null` op als `null`**, niet als 0. Een kolom met `NOT NULL DEFAULT 0` maakt
   deze wijziging ongedaan.
2. **Aggregaten** (gemiddelde brandstof, temperatuursintegralen) rekenen alleen met
   niet-null samples en rapporteren hun dekking; een integraal over 10 % van een ronde
   is geen meting van die ronde.
3. **Pit-ankers** alleen zetten op een expliciete pitstraatwaarneming. `null` is geen
   "uit de pitstraat".
4. **Dashboards** tonen "onbekend" bij `null`, niet "0" of "0,0".

## Bewijs

`CaptureNullSemanticsTests` dekt elk geval hierboven als aparte PASS/FAIL-regel:
N01–N14 (brandstof), N15–N19 (pitstraat), N20–N28 (pitService), N29–N37 (banden),
N38–N45 (wat er dan letterlijk in de JSON staat). De V3-baseline
(`V3PayloadFixtureTests`, gouden frame) blijft ongewijzigd: bij een volledige meting
verandert er niets aan de payload.
