# Bandenstints: delta's, dekking en een eerlijke schatting (v2)

Datum: 2026-10-28
Migratie: `supabase/migrations/20261028090000_tyre_stint_model.sql`
Rollback: `supabase/rollback/20261028090000_tyre_stint_model.rollback.sql`
Correctie: `supabase/migrations/20261028120000_tyre_stint_model_fixes.sql`
Rollback correctie: `supabase/rollback/20261028120000_tyre_stint_model_fixes.rollback.sql`

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
| `wear_span` | rondes tussen de eerste en laatste wear-meting van de stint (welke hoek dan ook) |
| `wear_span_fl/fr/rl/rr` | de meetbasis per hoek: rondes tussen die hoek se eerste en laatste meting (noemer van die hoek) |
| `heeft_helling` | true als minstens één hoek een bruikbare helling heeft — alleen deze stints tellen voor de graad |
| `wear_metingen` | aantal rondes met een wear-waarde in deze stint |
| `wear_begin_fl/fr/rl/rr`, `wear_end_fl/fr/rl/rr` | eerste en laatste wear-meting per hoek |
| `wear_per_lap_fl/fr/rl/rr` | procentpunt per ronde over de eigen span van die hoek, negatief = slijt; NULL als een meting ontbreekt, de hoek korter dan één ronde meet, of de wear steeg |
| `zwakste_hoek` | hoek met de steilste helling (meest negatieve `wear_per_lap`) — precies de hoek waarvan v2 het getal neemt |
| `track_temp_c` | gemiddelde baantemperatuur over de stint |
| `car_key`, `track_key` | laatst bekende sleutels binnen de stint (NULL als de payload ze niet had) |
| `laatste_meting` | `max(captured_at)` |

**Setgrens.** De teller is leidend. Een rij zonder teller erft de laatste
bekende `tyre_set`; pas een rij mét een ándere teller opent een nieuwe stint. Zo
verdwijnt een pitstop niet meer wanneer de rij ervoor toevallig geen teller had
(65 % van de productierijen heeft er geen). Is er in de hele partitie geen
tellerhistorie, dan splitst een wear-sprong omhoog van meer dan 0,5 pp: wear kan
binnen dezelfde set niet stijgen, want `wearPercent` ververst alleen in de
pitstraat. Zodra de teller er wél is, wordt er niet op wear gesplitst — anders
maakt ruizige testtelemetrie drie stints waar er één is.

**Geen verzonnen helling.** `wear_per_lap` is NULL zodra één van beide metingen
ontbreekt of de wear steeg. Er is geen 0 en geen interpolatie: de view zegt
"dit weet ik niet". Elke hoek rekent met zijn eigen eerste en laatste meting,
dus een hoek die later begint of eerder ophoudt krijgt zijn eigen noemer en niet
die van de hele stint.

### 2. RPC `public.tyre_coverage(p_limit integer default 50)`

```
returns table(car_key text, track_key text, stints bigint, wear_labels bigint, grade text, laatste_meting timestamptz)
```

Groepeert de stints per auto en baan. `stints` = aantal stints,
`wear_labels` = aantal stints met een gemeten helling (minstens één hoek met
twee metingen over minstens één ronde), graad A bij 3+ van die stints, B bij 2,
C bij 1, D bij 0. Een blok zonder bruikbare helling is geen dekking en telt dus
niet mee. `p_limit` wordt geklemd op 1..500.
Zelfde poort als `tyre_data_coverage()`: alleen eigen of beheerde apparaten
(`can_manage_simhub`), dus geen banden van een ander team.

### 3. RPC `public.pitwall_tyre_estimate_v2(p_device_id uuid)`

```
returns jsonb
```

| Sleutel | Betekenis |
|---|---|
| `grade` / `grade_label` | A (3+ stints met een gemeten helling), B (2), C (1), D (0) |
| `usable` | het getal mag als getal in de pitwall: er is een helling, graad A of B, een bereik, wear boven de drempel én een meetbasis van minstens acht rondes |
| `voorlopig` | nog niet bevestigd: geen getal, geen gemeten setgrens, of een basis korter dan 8 rondes |
| `stints` | aantal stints met een gemeten helling (waarop de graad rust) |
| `stints_totaal` | alle blokken van dit apparaat, ook de blokken zonder helling |
| `wear_per_lap` | procentpunt per ronde van de zwakste hoek, positief = slijt; NULL zonder bruikbare helling |
| `zwakste_hoek` | hoek waarop die helling rust |
| `range_laps` | `{low, high}` resterende rondes tot 40 % wear, marge naar graad én meetbasis: A ±10 %, B ±25 %, C de helft tot het dubbele bij acht rondes — breder bij een kortere basis, smaller bij een langere; NULL zonder helling |
| `basis` | `{car_key, track_key, track_temp_c, rondes_in_basis, set_number, set_bron, lap_from, lap_to, zwakste_hoek}` — `rondes_in_basis` is de meetbasis, niet de stintlengte |
| `provenance` | `measured` (eigen helling met teller als setgrens), `estimated` (helling wel gemeten, setgrens afgeleid of auto/baan wijkt af), `last_known` (alleen een wear-stand), `unavailable` (geen stint) |
| `wear_now`, `wear_now_car_key`, `wear_now_track_key`, `threshold_pct` | de wear-stand waar het bereik op rust (met de auto en baan van die meting), en de drempel (40) |

De basisstint is de meest recente stint met een gemeten helling over minstens
drie rondes; bij gelijke tijd de langste. `usable` en `voorlopig` zijn bewust
verschillend: een graad A met een gemeten setgrens en een basis van acht rondes
is bruikbaar; onder die acht rondes is het getal een indicatie en blijft
`usable` false.

**Rechten.** `security definer`, `revoke ... from public, anon`,
`grant execute ... to authenticated`. De check is dezelfde apparaatpoort als
`tyre_rounds_for_device()`: eigen apparaat of `can_manage_simhub()`. Zonder
`auth.uid()` volgt `42501`, bij een vreemd apparaat `42501`.

## Correctie (20261028120000)

De eerste versie was op acht punten te ruim of te optimistisch. De correctie
vervangt alleen de view en de twee RPC's; de brontabel, de index en
`pitwall_tyre_estimate_v1` blijven ongemoeid.

| # | Fout in 090000 | Correctie |
|---|---|---|
| 1 | De graad telde elk blok, ook blokken zonder bruikbare helling. | Graad A/B/C telt alleen stints met een gemeten `wear_per_lap` (minstens één hoek met twee metingen over minstens één ronde). `tyre_coverage.wear_labels` telt dezelfde stints en de graad rust daarop, niet op `count(*)`. |
| 2 | `'NaN'::numeric` in een wear-kolom liet v2 crashen op `::integer` (`cannot convert NaN to integer`, `0A000`). | NaN wordt bij binnenkomst NULL (`nullif`) en vóór elke `::integer`-cast staat een guard. Een all-NaN nieuwste meting levert dus de laatste echte wear-stand, geen fout. |
| 3 | `lag(tyre_set)` pakte de vorige rij, ook als die geen teller had; een pitstop naast een NULL-rij verdween stil (65 % van de rijen heeft geen teller). | De setgrens gebruikt de laatste niet-NULL `tyre_set` binnen de partitie (last-observation-carried-forward). Zonder enige tellerhistorie blijft de wear-sprong het bewijs. |
| 4 | `wear_per_lap` deelde door de span van de hele stint, terwijl de teller uit één hoek kwam. | Elke hoek rekent met zijn eigen eerste en laatste meting (`wear_span_fl/fr/rl/rr`). |
| 5 | `range_laps` was te smal bij een basis van drie rondes. | De bandbreedte schaalt met `wear_span`: acht rondes is de nominale marge, korter wordt breder (tot 4×), langer smaller (tot 0,5×). `usable` wordt pas true bij `wear_span >= 8`. |
| 6 | `zwakste_hoek` was de hoek met de laagste resterende wear, terwijl v2 de steilste helling gebruikte. | `zwakste_hoek` is de hoek met de steilste helling; v2 neemt zijn getal uit diezelfde hoek, dus tabel en getal kunnen niet meer uiteenlopen. |
| 7 | `wear_now` kwam uit de nieuwste meting, ook van een andere auto of baan. | `wear_now` krijgt voorrang voor een meting die bij de basis past; wijkt auto of baan af, dan wordt `provenance` `estimated`. |
| 8 | De windows ordenden alleen op `lap_number`. | `captured_at` staat in elke window-ordening (en in de array-orders), zodat de volgorde deterministisch is. |

## Toepassen

```bash
cat supabase/migrations/20261028090000_tyre_stint_model.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"

cat supabase/migrations/20261028120000_tyre_stint_model_fixes.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
```

Vooraf is een schema-dump gemaakt:
`/tmp/pre-migration-schema-20261028.sql` op 3sm-docker.

## Rollback

```bash
cat supabase/rollback/20261028090000_tyre_stint_model.rollback.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
```

```bash
cat supabase/rollback/20261028120000_tyre_stint_model_fixes.rollback.sql \
  | ssh 3sm-docker "docker exec -i supabase-db psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1"
```

De rollback van 090000 verwijdert alleen wat die migratie aanmaakte (twee
functies, de view, de index). `simhub_tyre_lap_samples`,
`pitwall_tyre_estimate_v1`, `tyre_rounds_for_device` en `tyre_data_coverage`
blijven staan; er is niets aan bestaande objecten gewijzigd.

De rollback van de correctie zet de definities van vóór de fix terug (inclusief
de fouten). Omdat de gecorrigeerde view vijf kolommen meer heeft en
`create or replace` geen kolommen kan laten vallen, gaan de twee RPC's en de
view eerst weg en komen daarna in de oude vorm terug. Daarna is opnieuw
toepassen van 20261028120000 genoeg om weer bij te zijn.

## Getest op productie (2026-10-28)

### Na de correctie (20261028120000)

Echte data: 113 rondes, 3 apparaten, 5 sessies, nog steeds 8 stints — alle acht
met een gemeten helling. De teller-carried-forward verandert de splitsing niet
op deze data (de CAT-PC-sessie met teller blijft één stint; PCBART splitst op
wear-sprongen in vier; `simhub-f8a5…` in één).

**Dekking** (super_admin): één rij, `stints 8`, `wear_labels 8`, graad `A`.
Als eigenaar zonder beheerdersrol zag dezelfde functie alleen het eigen
apparaat.

**Schatting v2, na de correctie:**

| Apparaat | grade | stints (helling/totaal) | provenance | usable | voorlopig | wear_per_lap | range_laps |
|---|---|---|---|---|---|---|---|
| CAT-PC `e90ad2ca` | A | 3 / 3 | measured | false (basis 3) | true | 0,4833 | 88–153 |
| PCBART `8ea3fe36` | A | 4 / 4 | estimated (setgrens afgeleid) | true (basis 14) | true | 0,3429 | 150–169 |
| DESKTOP `7e748fad` | C | 1 / 1 | measured | false | true | 0,0958 | 393–788 |
| DESKTOP-GR4NN00 `81222914` (geen rondes) | D | 0 / 0 | unavailable | false | true | null | null |

**Vóór de correctie** (zelfde data, 090000), ter vergelijking:

| Apparaat | grade | usable | wear_per_lap | range_laps |
|---|---|---|---|---|
| CAT-PC `e90ad2ca` | A | true | 0,4833 | 101–125 |
| PCBART `8ea3fe36` | A | true | 0,3429 | 144–177 |
| DESKTOP `7e748fad` | C | false | 0,0958 | 295–1181 |
| DESKTOP-GR4NN00 `81222914` | D | false | null | null |

De richting klopt: de basis van drie rondes is niet meer bruikbaar en levert
een bredere band (88–153 in plaats van 101–125), de basis van veertien rondes
een smallere (150–169), en de lange basis van 36 rondes de smalste verhouding
(393–788 in plaats van 295–1181). De graad blijft op deze data gelijk omdat elk
blok hier toevallig twee metingen heeft; de synthetische test hieronder laat
zien dat blokken zonder helling nu niet meer meetellen.

### Synthetische randen

`supabase/tests/20261028120000_tyre_stint_model_fixes.sql` draait in één
transactie met `ROLLBACK` op een echt maar leeg apparaat (DESKTOP-GR4NN00) en
beslist met 25 assertions. Alles PASS:

- drie blokken zonder helling (stijgende wear, één meting, één wear-rij) →
  `stints 3`, `wear_labels 0`, graad `D`, `provenance last_known`, geen getal
  en geen bereik;
- daar één stint met één gemeten hoek bij → graad `C`, `stints 1`,
  `stints_totaal 4` (vóór de fix werd dit `A`);
- NaN in één hoek en in de hele nieuwste meting → `wear_now` 96 uit de laatste
  echte meting, geen crash; `('NaN'::numeric)::integer` faalt nog steeds met
  `0A000`, dus de guard is geen dode code;
- teller 1 → NULL → 2 → twee stints (1..3 en 4..6); NULL direct vóór en na de
  wissel → ook twee stints;
- FL gemeten op ronde 1–6 en FR alleen op 1–3 → FL −1,0000 over span 5 en
  FR −1,5000 over span 2, `zwakste_hoek = fr` (de oude code deelde beide door 5
  en gaf FR −0,6000);
- basis op auto A (`syn-car-a`) met de nieuwste meting op auto B → `wear_now`
  komt uit A (95,556, niet 80), `provenance estimated`;
- eindstand 13 blokken, 9 met helling → graad `A` met `stints 9`.

Na afloop: 113 rondes, 8 stints, 0 rijen met een `syn-`-sessie.

### Rechten

`anon` krijgt `permission denied` op beide functies en op de view; zonder
`sub`-claim geeft `tyre_coverage` 0 rijen en v2 `Authentication required`; een
eigenaar zonder beheerdersrol die een vreemd apparaat opvraagt krijgt
`Permission denied`; `p_device_id = null` geeft `22023`; `p_limit` klemt op
1..500. v1-functies ongewijzigd aanwezig.

### Rollback geoefend

De rollback van de correctie is op productie gedraaid: de view kwam terug op 26
kolommen (zonder `wear_span_*` en `heeft_helling`), beide RPC's op de oude
definitie, 8 stints en 113 rondes. Daarna is 20261028120000 opnieuw toegepast
(31 kolommen) en waren de getallen weer die van de tabel hierboven.

## Bekende beperkingen

- `car_key` en `track_key` zijn in de huidige productiedata leeg (de
  identiteitsmigratie is nog niet door de connector gevuld). Het
  dekkingsoverzicht toont daarom nu één rij met lege sleutels. Zodra de
  connector ze stuurt, splitst het overzicht vanzelf per auto en baan.
- De graad telt de stints met een gemeten helling van het apparaat over alle
  sessies. `basis` laat zien op welke auto, baan en temperatuur het getal rust;
  bij een andere auto of baan dan de laatst bekende wordt de herkomst
  `estimated`. `stints_totaal` laat zien hoeveel blokken er daarnaast zijn.
- `range_laps` bij graad C is eerlijk breed (de helft tot het dubbele bij acht
  rondes, breder bij een kortere basis) en kan boven een race-afstand uitkomen.
  Dat is de meting, niet een fout: bij één stint is er geen smallere band te
  verdedigen.
- De view is niet aan `authenticated` gegrond. Een nieuwe lezer hoort via een
  `security definer`-RPC met eigendomscheck, niet met een directe grant.
