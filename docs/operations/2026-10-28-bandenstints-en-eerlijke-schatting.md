# Bandenstints: delta's, dekking en een eerlijke schatting (v2)

Datum: 2026-10-28
Migratie: `supabase/migrations/20261028090000_tyre_stint_model.sql`
Rollback: `supabase/rollback/20261028090000_tyre_stint_model.rollback.sql`

## Waarom

`simhub_tyre_lap_samples` bewaart per ronde een wear-momentopname, maar geen
stint. Zonder stinteenheid weet je niet welke twee metingen bij dezelfde
bandenset horen, en dus is er geen slijtage per ronde en geen bandbreedte. Deze
migratie legt de stint als eerste-klas object neer en bouwt daar twee leesfuncties
op: een dekkingsoverzicht en de pitwallschatting v2.

`pitwall_tyre_estimate_v1` blijft ongewijzigd bestaan. v1 werkt op
(event, team) en een anker; v2 werkt op apparaat en op rondes. Er is geen
frontendwijziging in deze stap: de UI leest nog v1.

## Wat er is toegevoegd

### 1. View `public.tyre_stint_deltas`

Per apparaat, sessie en opeenvolgende bandenset één rij. Geen grant aan
`authenticated`: de brontabel heeft geen RLS-policies, dus de view wordt alleen
via de RPC's hieronder gelezen.

| Kolom | Betekenis |
|---|---|
| `device_id`, `session_key` | apparaat en sessie |
| `set_number` | `tyre_set` uit het tyres-blok, anders het afgeleide volgnummer |
| `set_bron` | `payload` (iRacing-teller `TireSetsUsed`/`tyres.sets.used`) of `afgeleid` (wear-sprong) |
| `lap_from`, `lap_to`, `rondes` | bereik en aantal rondes in de stint |
| `wear_span` | rondes tussen de eerste en laatste wear-meting (noemer van de helling) |
| `wear_metingen` | aantal rondes met een wear-waarde in deze stint |
| `wear_begin_fl/fr/rl/rr`, `wear_end_fl/fr/rl/rr` | eerste en laatste wear-meting per hoek |
| `wear_per_lap_fl/fr/rl/rr` | procentpunt per ronde, negatief = slijt; NULL als een meting ontbreekt, de stint korter is dan één ronde, of de wear steeg |
| `zwakste_hoek` | hoek met de laagste resterende wear aan het eind |
| `track_temp_c` | gemiddelde baantemperatuur over de stint |
| `car_key`, `track_key` | laatst bekende sleutels binnen de stint (NULL als de payload ze niet had) |
| `laatste_meting` | `max(captured_at)` |

**Setgrens.** De teller is leidend. Ontbreekt hij in de rijen, dan splitst een
wear-sprong omhoog van meer dan 0,5 pp: wear kan binnen dezelfde set niet
stijgen, want `wearPercent` ververst alleen in de pitstraat. Staat de teller er
wél, dan wordt er niet op wear gesplitst — anders maakt ruizige testtelemetrie
drie stints waar er één is.

**Geen verzonnen helling.** `wear_per_lap` is NULL zodra één van beide metingen
ontbreekt of de wear steeg. Er is geen 0 en geen interpolatie: de view zegt
"dit weet ik niet".

### 2. RPC `public.tyre_coverage(p_limit integer default 50)`

```
returns table(car_key text, track_key text, stints bigint, wear_labels bigint, grade text, laatste_meting timestamptz)
```

Groepeert de stints per auto en baan. `stints` = aantal stints,
`wear_labels` = aantal stints met een bruikbare wear-meting, graad A bij 3+
stints, B bij 2, C bij 1, D bij 0. `p_limit` wordt geklemd op 1..500.
Zelfde poort als `tyre_data_coverage()`: alleen eigen of beheerde apparaten
(`can_manage_simhub`), dus geen banden van een ander team.

### 3. RPC `public.pitwall_tyre_estimate_v2(p_device_id uuid)`

```
returns jsonb
```

| Sleutel | Betekenis |
|---|---|
| `grade` / `grade_label` | A (3+ stints), B (2), C (1), D (0) |
| `usable` | het getal mag als getal in de pitwall: er is een helling, minstens twee stints, een bereik en wear boven de drempel |
| `voorlopig` | nog niet bevestigd: geen getal, geen gemeten setgrens, of een basis korter dan 8 rondes |
| `stints` | aantal stints van dit apparaat waarop de graad rust |
| `wear_per_lap` | procentpunt per ronde van de zwakste hoek, positief = slijt; NULL zonder bruikbare helling |
| `zwakste_hoek` | hoek waarop die helling rust |
| `range_laps` | `{low, high}` resterende rondes tot 40 % wear, marge naar graad: A ±10 %, B ±25 %, C de helft tot het dubbele; NULL zonder helling |
| `basis` | `{car_key, track_key, track_temp_c, rondes_in_basis, set_number, set_bron, lap_from, lap_to}` — `rondes_in_basis` is de meetbasis, niet de stintlengte |
| `provenance` | `measured` (eigen helling met teller als setgrens), `estimated` (helling wel gemeten, setgrens afgeleid of auto/baan wijkt af), `last_known` (alleen een wear-stand), `unavailable` (geen stint) |
| `wear_now`, `threshold_pct` | de wear-stand waar het bereik op rust, en de drempel (40) |

De basisstint is de meest recente stint met minstens drie rondes tussen de
metingen; bij gelijke tijd de langste. `usable` en `voorlopig` zijn bewust
verschillend: een graad A met een gemeten setgrens maar een basis van drie
rondes is bruikbaar en tóch voorlopig.

**Rechten.** `security definer`, `revoke ... from public, anon`,
`grant execute ... to authenticated`. De check is dezelfde apparaatpoort als
`tyre_rounds_for_device()`: eigen apparaat of `can_manage_simhub()`. Zonder
`auth.uid()` volgt `42501`, bij een vreemd apparaat `42501`.

## Toepassen

```bash
cat supabase/migrations/20261028090000_tyre_stint_model.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
```

Vooraf is een schema-dump gemaakt:
`/tmp/pre-migration-schema-20261028.sql` op 3sm-docker.

## Rollback

```bash
cat supabase/rollback/20261028090000_tyre_stint_model.rollback.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
```

De rollback verwijdert alleen wat deze migratie aanmaakte (twee functies, de
view, de index). `simhub_tyre_lap_samples`, `pitwall_tyre_estimate_v1`,
`tyre_rounds_for_device` en `tyre_data_coverage` blijven staan; er is niets aan
bestaande objecten gewijzigd.

## Getest op productie (2026-10-28)

Echte data: 113 rondes, 3 apparaten, 5 sessies.

**View.** 8 stints. De sessie met een teller bleef één stint van 37 rondes
(`set_bron = payload`, wear 100,000 → 96,550, `wear_per_lap_fl` −0,0958); de
sessies zonder teller splitsten op wear-sprongen in 4 stints (PCBART) en
1 stint (CAT-PC `simhub-f8a5…`). Geen enkele stint kreeg een helling zonder twee
metingen.

**Dekking** (super_admin): één rij, `stints 8`, `wear_labels 8`, graad `A`.
Als eigenaar zonder beheerdersrol (endurance_manager) zag dezelfde functie alleen
het eigen apparaat: 1 stint, graad `C`.

**Schatting v2:**

| Apparaat | grade | provenance | usable | voorlopig | wear_per_lap | range_laps |
|---|---|---|---|---|---|---|
| CAT-PC `e90ad2ca` | A | measured | true | true (basis 3 rondes) | 0,4833 | 101–125 |
| PCBART `8ea3fe36` | A | estimated (setgrens afgeleid) | true | true | 0,3429 | 144–177 |
| DESKTOP `7e748fad` | C | measured | false | true | 0,0958 | 295–1181 |
| BEEST `81222914` (geen rondes) | D | unavailable | false | true | null | null |

**Synthetische randen** (tijdelijke rijen, daarna verwijderd, telling terug op
113 rondes / 8 stints):

- één stint met één wear-meting → `last_known`, `wear_per_lap` null, `range_laps` null;
- wear die stijgt binnen één payload-set → `wear_per_lap` null in de view, geen bereik;
- helling over 9 rondes op dezelfde auto → `measured`, A, 191–235;
- basis op een andere auto dan de laatst bekende → `estimated`, `voorlopig` true;
- `p_limit` 0 → 1 rij, 10000 → alle rijen (klem op 1..500).

**Rechten.** `anon` krijgt `permission denied` op beide functies en op de view;
zonder `sub`-claim geeft `tyre_coverage` 0 rijen en v2 `Authentication required`;
een vreemd apparaat opvragen geeft `Permission denied`; `p_device_id = null`
geeft `22023`. v1-functies ongewijzigd aanwezig.

**Rollback geoefend.** Na de rollback: 0 views, 0 v2-functies, 3 v1-functies,
0 index, 113 rondes. Daarna opnieuw toegepast zonder fouten.

## Bekende beperkingen

- `car_key` en `track_key` zijn in de huidige productiedata leeg (de
  identiteitsmigratie is nog niet door de connector gevuld). Het
  dekkingsoverzicht toont daarom nu één rij met lege sleutels. Zodra de
  connector ze stuurt, splitst het overzicht vanzelf per auto en baan.
- De graad telt de stints van het apparaat over alle sessies. `basis` laat zien
  op welke auto, baan en temperatuur het getal rust; bij een andere auto of baan
  dan de laatst bekende wordt de herkomst `estimated`.
- `range_laps` bij graad C is eerlijk breed (de helft tot het dubbele) en kan
  boven een race-afstand uitkomen. Dat is de meting, niet een fout: bij één stint
  is er geen smallere band te verdedigen.
- De view is niet aan `authenticated` gegrond. Een nieuwe lezer hoort via een
  `security definer`-RPC met eigendomscheck, niet met een directe grant.
