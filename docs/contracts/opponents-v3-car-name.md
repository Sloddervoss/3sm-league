# Opponents v3 — `carName` (additief)

Normatief: `supabase/functions/_shared/opponents.ts` (Edge-parser) en de connector-serializer
(producer). Het protocol blijft versie 3; dit veld is een additieve uitbreiding van het
tegenstandermodel.

## Veld

- Draadpad: `payload.opponents[i].carName`; opgeslagen in `v3_normalized.opponents[].carName`.
- Type: nullable string, maximaal **120 tekens** (zelfde tekental als `text()` in de parser), getrimd.
- Optioneel op de draad: **ontbreken en `null` betekenen beide `null`** (onbekend). Een oudere
  connector die het veld niet kent stuurt het niet mee; dat is de normale situatie, geen fout.
- Geen afleiding: `carClass`, `carClassId`, `driverName` of `id` zijn nooit een bron voor het model.

## Compatibiliteit

| Situatie | Edge-uitkomst |
|---|---|
| Oud frame zonder `carName` | geaccepteerd (202); alle bestaande velden ongewijzigd; `carName: null` |
| Nieuw frame met `carName` | geaccepteerd (202); waarde getrimd overgenomen |
| `""` of alleen whitespace | `null`; rij en frame blijven |
| Geen tekst (getal, bool, object, array) | `null` + logregel; rij en frame blijven |
| Langer dan 120 tekens | `null` + logregel; rij en frame blijven |
| Onbekende rootkey naast dit veld | ongewijzigd begrensd geaccepteerd; 33 onbekende rootkeys blijft 422 |

Een kapot model kost dus nooit de tegenstanderrij of de kerntelemetrie (geen 422/500). Oudere
clients negeren het extra veld; de frontend-interface hoeft hiervoor niet mee te veranderen.

## Payloadbudget

Het bestaande POST-budget blijft **24.576 UTF-8-bytes** (`readBoundedJson`); er is geen
server-side trimming bijgekomen. Gemeten op een echt frame met 40 tegenstanders:

- zonder `carName`: 14.756 bytes;
- 40 × 120 ASCII-tekens: 20.076 bytes (past);
- 40 × 120 multibyte-tekens (240 bytes per model): 24.876 bytes (past **niet**).

Past het model niet, dan mag de producer `carName` per rij weglaten (twee rijen weglaten brengt
het voorbeeld op 24.370 bytes). Alle 40 rijen en spelers blijven dan staan; de weggelaten velden
worden `null`. Dat is geen player loss en vraagt geen wijziging van het budgetcontract.

## Bewijs

```bash
deno test supabase/functions/_shared/opponents_test.ts
./node_modules/.bin/vitest run src/test/simhubOpponentCarName.test.ts
```
