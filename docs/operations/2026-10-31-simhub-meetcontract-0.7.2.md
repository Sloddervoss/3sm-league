# Meetcontract 0.7.2.0 — eisen uit de DDL-review (6.1 sol)

Deze release (0.7.2.0) is fase 1 en 2: de bestaande meting vastleggen, de ballast
eruit halen en de null-semantiek eerlijk maken. Er komt **geen** nieuwe protocoluitbreiding
bij (geen events, geen rondeaggregaten, geen outbox, geen capabilities-blok). De
DDL-review legt wel vast waaraan die uitbreiding later moet voldoen; dit document zet de
eisen vast zodat de volgende fase ze niet opnieuw hoeft uit te vinden — en zodat te zien
is waar de huidige code ze al respecteert.

## De eisen

| # | Eis | Status in 0.7.2.0 |
|---|---|---|
| 1 | Event- en summary-ID's zijn **durable UUID's**, één keer gemaakt bij creatie en bewaard in de outbox. Geen tellers zoals `evt-1` of `lap-17`. | Nog geen events in de payload. Er is bewust geen teller-achtige ID toegevoegd. |
| 2 | Meetgebeurtenissen krijgen een **`record_revision`**; een latere bevestiging of correctie is een **nieuwe gebeurtenis met verwijzing**, niet stilzwijgend genegeerd. | Idem: nog geen events. |
| 3 | Wear krijgt een **geversioneerd schema `wear_v1`** met expliciete schaal (0–100, **resterend** percentage), **verplichte hoeksleutels `fl`/`fr`/`rl`/`rr`** en **`confidence` tussen 0 en 1**. | Het bestaande `tyres.wearPercent` is ongewijzigd (procenten, per hoek genest als `frontLeft`/…). De schaal is 0–100 en de waarde is het resterende percentage; `wear_v1` zelf komt in de volgende fase. Zie `TyreZoneReader`. |
| 4 | Dekking is **per metriekgroep** (temperatuur, brandstof, belasting) met `valid_duration_seconds`, `sample_count` en `max_gap_seconds`; een **integraal is null als de dekking ontbreekt**. | Nog geen aggregaten. `CaptureValueRules` levert nu al `null` in plaats van 0 waar de dekking ontbreekt (brandstof, reparatietijd). |
| 5 | `sample_count` is een **integer**, geen double. | Niet van toepassing in deze release; vastgelegd voor de aggregaten. |
| 6 | Driver-identiteit in rondeaggregaten gebruikt **dezelfde naamruimte als het kernframe**: de naam zoals SimHub die levert, met optionele UUID-resolutie — geen UUID die de client niet kan kennen. | Het kernframe stuurt `identity.currentDriverId` / `currentDriverName` al zoals SimHub ze geeft. Geen client-side UUID's toegevoegd. |
| 7 | Meetreeksen mogen **niet** in het genormaliseerde snapshot terechtkomen dat browsers kunnen lezen. | Deze release voegt geen reeksen toe. Bij de volgende fase: eigen pad, niet in de publieke view. |
| 8 | De versie is **overal 0.7.2.0**. | `AssemblyVersion` en `AssemblyFileVersion` van connector én updater staan op `0.7.2.0`; `UpdatePathTests` (V24) bewaakt dat. |

## Wat dat betekent voor de volgende fase

- Een gebeurtenis-ID wordt bij creatie één keer als UUID gemaakt en **in de outbox
  bewaard**; een retry hergebruikt hetzelfde ID. Een nieuwe versie van dezelfde
  gebeurtenis is een nieuwe rij met `record_revision + 1` en een verwijzing naar het
  oorspronkelijke ID.
- Dekking hoort bij de metriekgroep, niet bij het frame: een ronde met 10 % temperatuurdekking
  levert geen integraal, ook niet als de brandstofdekking 100 % was.
- `wear_v1` vervangt op termijn `tyres.wearPercent`; tot die tijd blijven beide naast
  elkaar bestaan en is de bestaande sleutel niet van betekenis veranderd.

## Versie en updatepad

Deze release heet `0.7.2.0`. Dat is de `--patch`-variant van `bump-version.sh`
(`0.7.1.2 → 0.7.2.0`). Let op: `bump-version.sh` zonder argument maakt er `0.8.0.0` van;
gebruik dus `release.sh --patch`, of `--skip-build` als de versie al gezet is.

Het updatepad is niet gewijzigd: de plugin start de externe updater met dezelfde
argumenten, wacht op het `ready`-event en sluit SimHub daarna pas. `UpdatePathTests`
bewijst dat een installatie die op 0.7.1.2 staat met één update naar 0.7.2.0 gaat,
inclusief een oude `STAGED`- en `WAITING_FOR_RESTART`-staat.
