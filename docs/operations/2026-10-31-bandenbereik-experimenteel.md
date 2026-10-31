# Het bandenbereik is een experiment, geen advies

Datum: 2026-10-31
Migratie: `supabase/migrations/20261031170000_tyre_band_experimenteel.sql`
Rollback: `supabase/rollback/20261031170000_tyre_band_experimenteel.rollback.sql`
Client: `src/features/endurance/pitwall/strategy/tyreEstimateV2.ts`,
`TyreModelPanel.tsx`, `TyreAdviceLine.tsx`
Test: `src/test/pitwallTyreBandExperimenteel.test.tsx`

## Waarom

`basis.band.soort` heette `modelmarge`, en dat woord las als een gekalibreerde
marge rond het aantal resterende rondes. Dat is het niet: de band komt uit de
spreiding tussen de eigen stints plus de meetruis van één apparaat. Er is geen
enkele meting die zegt dat de echte band binnen die grenzen valt.

Besluit (Vincent): het bereik blijft zichtbaar — het is het enige getal dat het
model rekent — maar het is een experiment en het stuurt de beslissing niet.

## Wat er verandert

| Plek | Voor | Na |
|---|---|---|
| `basis.band.soort` | `modelmarge` | `experimenteel` |
| `basis.band.beslissend` | bestaat niet | `false` |
| Kop in het modelpaneel | `Modelbereik` | `Experimenteel bereik` |
| Regel onder het bereik | `Modelbereik, geen gemeten garantie.` | `Experimenteel bereik: stuurt het advies niet.` |
| Bandenrij in de beslissingsband | `8–12 rondes tot 40%` | `geen advies · experimenteel bereik` |

`usable`, `range_laps`, de graad, de adviespoort, de contextcontrole en de
priorvariantie zijn niet aangeraakt: het bereik komt dus nog steeds terug. Wat
verandert is de betekenis die eraan hangt.

## De regel in de client

`band.beslissend` is streng: alleen een expliciete `true` laat het bereik
meewegen. Ontbreekt het blok of het veld, dan is het antwoord nee. Dat is
fail-closed, en het is de enige juiste kant voor een getal dat geen advies is —
een server die zwijgt mag geen advies dragen.

`naarTyreEstimate()` is de enige doorgang naar de beslissingsband. Een
niet-beslissend bereik levert daar geen `lapsRange`, geen `ratePerLap`, geen
`lapsToThreshold` en geen `limitPct`, en zet `experimenteel: true`. Zonder
`lapsToThreshold` kan de bandenrij de tank niet verdringen: de stop komt dan uit
de tank, niet uit het bereik. `TyreAdviceLine` toont in dat geval tekst in
plaats van rondes.

## Verificatie

- `npx vitest run`: 191 bestanden, 1564 tests, alle groen.
- De migratie is niet tegen een database gedraaid (geen Postgres in deze
  omgeving); de SQL is een `create or replace` van de bestaande functie met twee
  gewijzigde JSON-sleutels.
