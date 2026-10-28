# Bandenprior: leren over alle rijders, per auto en per circuit

Datum: 2026-10-29
Migratie: `supabase/migrations/20261029090000_tyre_prior_model.sql`
Rollback: `supabase/rollback/20261029090000_tyre_prior_model.rollback.sql`
Test: `supabase/tests/20261029090000_tyre_prior_model.sql` (33 PASS, in een transactie met rollback)

## Waarom

Het bandenmodel wist tot nu toe alleen wat één apparaat zelf had gereden. Een
nieuwe combinatie van auto en circuit begon daardoor met niets, terwijl de
league allang weet hoe een Lambo op Montreal slijt. Deze migratie legt die
kennis vast: per auto en per circuit, over alle apparaten, zonder namen of
apparaat-id's. De pitwall begint bij een onbekende combinatie met de
dichtstbijzijnde voorkennis en werkt die bij met de eigen stint.

## 1. Sleutels bij de ingest

`simhub_tyre_lap_samples` had al `car_key` en `track_key`, maar de trigger
schreef ze met een eigen normalisatie en zonder `trackId`/`trackConfig`. Nu:

| Sleutel | Regel | Voorbeeld |
|---|---|---|
| `car_key` | `carId` uit het identity-blok, anders `carName`; kleine letters, alleen a-z0-9 | `lamborghinievogt3` |
| `track_key` | `trackId` + `':'` + genormaliseerde `trackConfig`; zonder `trackId` de genormaliseerde `trackName` | `218:` (Montreal, geen config), `465:fullcourse` |

Twee kleine hulpfuncties (`tyre_car_key()`, `tyre_track_key()`) dragen de regel,
zodat trigger, backfill en leeslaag niet uit elkaar kunnen lopen. Ze staan in
dezelfde migratie als de trigger; de trigger houdt zijn
`exception when others`-vangnet, dus een fout kan de ingest nog steeds niet
blokkeren.

**Waarom `trackId:config` en niet de naam.** Twee layouts van dezelfde baan zijn
twee circuits voor het model: Spa GP en Spa Full Course slijten anders. Alleen
de id met de config is daar ondubbelzinnig over. Gevolg: `tyre_coverage` toont
nu `218:` in plaats van `montreal`; een leesbare naam hoort in de UI-catalogus,
niet in de sleutel.

**Waarom het identity-blok vóór de kolommen gaat.** In de oefendata bleek een
`car_id`-kolom van een vorige sessie te blijven staan terwijl het identity-blok
al de nieuwe auto noemde. De payload is wat de connector elke frame meestuurt en
is dus de waarheid; de kolommen zijn terugval.

## 2. Backfill: 0 van 113 rijen, en dat is het eerlijke antwoord

De backfill (`tyre_backfill_keys()`, idempotent, los aanroepbaar) vult
uitsluitend rijen waarvan **dezelfde apparaat én dezelfde sessie** in
`simhub_telemetry_latest` staat. In productie leverde dat **0 van de 113 rijen**
op:

```
samples: 113 rijen, 3 apparaten, 5 sessies (2026-10-27)
car_key/track_key gevuld: 0 / 0
sessies in simhub_telemetry_latest: 5 — geen enkele gelijk aan een sample-sessie
```

De oorzaak is structureel: `simhub_telemetry_latest` heeft `primary key
(device_id)` — één rij per apparaat. De identiteit van een oude sessie is er
alleen als die sessie nog de laatste is. De identiteit van de samples van
27 oktober is dus nergens meer te vinden: de events-tabel van dat apparaat
stopt op 25 oktober, de praktijkrondes hebben een ander sessie-id-formaat.

Er is bewust **niet** teruggevallen op "de laatste identiteit van dit apparaat".
Elke waarneming voor deze apparaten wijst weliswaar naar Lambo/Montreal, maar
dat is een aanname over een sessie van twee dagen later. Een verkeerd
geëtiketteerde stint is voor het model erger dan een ontbrekende: hij komt in
de exacte trap terecht en is daarna niet meer te onderscheiden van een meting.

Gevolg: de prior begint in productie leeg en vult zich vanaf de eerstvolgende
stint. De bestaande schattingen veranderen daardoor niet (zie §6). Zodra de
sessie-identiteit alsnog ergens opduikt (archief, import), vult één aanroep van
`tyre_backfill_keys()` de rest — de functie is idempotent en raakt alleen
NULL's aan.

De accumulator (`simhub_tyre_lap_accum`) had één rij waar de identiteit wél
bekend was (de nog lopende sessie `simhub-ee11…`); die is gevuld.

## 3. `tyre_prior_stats`: de gepoolde cijfers

Eén rij per (auto, circuit), en verder niets:

| Kolom | Betekenis |
|---|---|
| `car_key`, `track_key` | de combinatie |
| `stints` | aantal stints dat meedoet (minstens één hoek met drie rondes basis) |
| `rondes` | som van de stintspanne van die stints |
| `sum_wear_fl/fr/rl/rr` | som van de wear-daling (begin − eind, procentpunt) per hoek |
| `rondes_fl/fr/rl/rr` | som van de meetbasis per hoek in rondes — de noemer |
| `bijgewerkt_op` | laatste herberekening |

Geen `device_id`, geen sessie, geen coureur, geen tijdstip per stint. De tabel
heeft RLS aan, geen policies en geen grants; alleen SECURITY DEFINER-functies
lezen hem.

**Onderhoud: statement-trigger, niet een refresh vanuit de pitwall.** De
pitwall is een lezer; die mag het model niet onderhouden, want dan kloppen de
cijfers alleen als iemand de pagina opent en telt een stint die nooit bekeken
wordt nooit mee. De trigger hangt aan `simhub_tyre_lap_samples` (de tabel waar
de flush elke afgeronde ronde in schrijft) en herberekent na elke
schrijfopdracht de groepen. Statement-level en niet per rij: één herberekening
per flush, en een backfill van duizend rijen kost ook één herberekening. Faalt
de herberekening, dan gaat de ingest door en staat er een warning in het
PG-log — een meting mag nooit sneuvelen op een statistiek.

Gemeten kosten (transactie met rollback, in deze productie-DB):

| Scenario | Tijd |
|---|---|
| 20 000 synthetische rondes in één statement (incl. één herberekening) | 1,34 s |
| één losse ronde bij 5 114 rijen in de tabel | 0,23 s |
| één losse ronde bij 20 114 rijen | 0,38 s |

Bij de leagueschaal (enkele duizenden rijen per seizoen) is dat verwaarloosbaar.
Boven ~100 000 samples wordt een gerichte herberekening per groep de moeite
waard; de functie heeft daar al een filter voor (`tyre_prior_refresh(car, track)`).

## 4. `tyre_prior(car_key, track_key)`: de hiërarchie

Vier traps, en ze zijn **disjunct**: elke trap bevat alleen wat de fijnere trap
niet al heeft.

| Trap | Wat erin zit |
|---|---|
| `exact` | deze auto op dit circuit |
| `auto` | deze auto op andere circuits |
| `circuit` | andere auto's op dit circuit |
| `algemeen` | alles wat overblijft |

Per trap eerst de steilste hoek: `rate_trap = max over hoeken( sum_wear_hoek /
rondes_hoek )`, met alleen hoeken die minstens drie rondes meeliepen. Dat is
dezelfde hoekkeuze als in de stintview, dus prior en eigen meting zijn hetzelfde
soort getal. Een trap met minder dan drie rondes doet niet mee: één korte stint
is geen kennis.

Gewicht per trap, op rondes:

```
w = n / (n + 8)
```

Acht rondes is de halve weg: bij n = 8 weegt de trap even zwaar als alles
eromheen. Van grof naar fijn blenden:

```
r = r_algemeen
r = w_circuit·r_circuit + (1 − w_circuit)·r
r = w_auto·r_auto       + (1 − w_auto)·r
r = w_exact·r_exact     + (1 − w_exact)·r
```

`n_eff = Σ w_i · n_i` over de traps die meededen: de rondes die de uitkomst
daadwerkelijk dragen, niet het ruwe totaal. `level` is de fijnste trap die
meedeed. `bron` is een zin met aantallen, bijvoorbeeld:

```
algemeen: 54 stints, 540 rondes over alle auto's en circuits ·
eigen data: deze auto op dit circuit: 1 stints, 10 rondes
```

**Waarom disjunct.** Zonder die scheiding telt de eigen cel in drie traps mee en
zou een combinatie met veel eigen data zichzelf naar het groepsgemiddelde
blijven trekken — precies het tegenovergestelde van "meer data = smaller".

**Waarom de prior de eigen stint van de aanroeper bevat.** De pool is per auto
en circuit, niet per apparaat; de eigen stint zit er dus in. Dat is bewust: de
alternative is apparaat-id's in de pool bewaren, en dat botst met §7. Het effect
is klein en conservatief — bij een pool die alleen uit de eigen stint bestaat
verandert het getal niet (0,5 in, 0,5 uit).

## 5. `pitwall_tyre_estimate_v2`: prior als startpunt

Alles wat er was blijft: graad, `stints`, `stints_totaal`, `wear_per_lap`,
`zwakste_hoek`, `wear_now`, `wear_now_car_key/track_key`, `threshold_pct`,
`range_laps`, `provenance`, `usable`, `voorlopig`, en de bestaande
`basis`-velden.

Nieuw in `basis`:

| Veld | Betekenis |
|---|---|
| `bron` | waar het startpunt vandaan kwam: `eigen` \| `auto` \| `circuit` \| `algemeen` |
| `prior_rate` | de rate van de prior (pp per ronde), of null |
| `prior_n` | `n_eff` van de prior |
| `prior_level` | de fijnste trap met data |
| `prior_bron` | de mensleesbare bron van de prior |
| `rondes_effectief` | eigen basis + prior: de maat achter de bandbreedte |

De eigen stint werkt de prior bij met **dezelfde formule**:

```
w_eigen = n_eigen / (n_eigen + 8)
rate    = w_eigen · rate_eigen + (1 − w_eigen) · rate_prior
n_eff   = n_eigen + n_prior
```

Met `n_eigen ≥ 8` heeft de eigen meting dus minstens de helft van het gewicht.
Zonder prior is `w_eigen` het enige gewicht en verandert er niets aan het getal;
zonder eigen stint is de prior het getal en heet de bron `auto`/`circuit`/
`algemeen` met herkomst `geschat`.

**Bandbreedte.** `range_laps` = resterende wear tot 40 % gedeeld door `rate`,
met een marge uit de graad (A ±10 %, B 25 %, C de helft tot het dubbele) die
schaalt met de effectieve basis: `schaal = clamp(8 / n_eff, 0,5; 4,0)`. Onder
acht rondes breder (tot 4×), daarboven smaller, met 0,5 als vloer — dat is de
meetruis: de helling blijft een meting met ruis, dus meer data maakt de band
niet willekeurig smal.

**De eigen meting valt altijd binnen de band.** Wijkt de pool af van wat het
apparaat zelf zag, dan wordt de band breder in plaats van dat de meting erbuiten
valt. Zonder prior is dit een no-op (de rate ís dan de eigen helling).

**`usable` blijft een uitspraak over de eigen meting**: minstens acht rondes van
de gebruikte hoek, graad A of B, wear over. Een prior maakt een apparaat niet
bruikbaar; hij maakt het bereik smaller of breder en zet `voorlopig` op waar.

## 6. Wat er in productie gebeurde

| Apparaat | Voor | Na | Verschil |
|---|---|---|---|
| CAT-PC (e90ad2ca) | 0,4833 · 88–153 · A · usable false | 0,4833 · 88–153 · A · usable false | geen |
| DESKTOP-E2SEMRP (7e748fad) | 0,0958 · 393–788 · C | 0,0958 · 393–788 · C | geen |
| PCBART (8ea3fe36) | 0,3429 · 150–169 · A · usable true | 0,3429 · 150–169 · A · usable true | geen |

Verklaarbaar: de pool is leeg (0 van 113 rijen met sleutel), dus `prior_rate` is
null en `rate` blijft de eigen helling; `n_eff` is de eigen basis, dus de
bandbreedte is identiek. De nieuwe velden staan er wel: `basis.bron = "eigen"`,
`prior_rate = null`, `rondes_effectief = 3 / 36 / 14`.

De ingest is end-to-end getest met een synthetische frame-reeks: het
identity-blok `{"carId":"lamborghinievogt3","trackId":465,"trackConfig":"Full
Course"}` levert `car_key = lamborghinievogt3` en `track_key = 465:fullcourse`
in zowel de accumulator als de sample; een frame zonder identity wist de sleutel
van de lopende ronde niet.

## 7. Privacy

- `tyre_prior_stats` bevat geen apparaat, sessie, coureur of tijdstip per stint;
  alleen sommen per auto en circuit.
- De tabel heeft geen grants en geen RLS-policies; alleen SECURITY
  DEFINER-functies lezen hem.
- `tyre_prior()` geeft exact vier velden: `rate`, `n_eff`, `level`, `bron`. De
  bron is een zin met aantallen, geen identificatie. De test controleert dat er
  geen apparaatnaam, apparaat-id of coureur in de uitvoer staat.
- Wat een gebruiker wél kan leren: dat er op een combinatie is gereden en
  hoeveel rondes er gepoold zijn. Wie dat reed, niet — daar is geen veld voor.
  Bij kleine pools is het getal in feite één iemands stint, maar nog steeds
  zonder herleidbare identiteit; daarom tellen traps onder drie rondes niet mee
  en is `n_eff` klein, wat de band breed houdt.

## 8. Beperkingen

1. **0 van 113 rijen gebackfilld.** `simhub_telemetry_latest` bewaart één rij
   per apparaat, dus de sessie-identiteit van de oefendata is weg. De prior
   begint leeg; vanaf de eerstvolgende stint vult hij zich. Wil je de oude data
   alsnog meetellen, dan moet de identiteit per sessie bewaard worden (een
   `simhub_telemetry_sessions`-tabel of de identiteit in de samples zelf).
2. **De eigen stint zit in de pool.** Zonder apparaat-id's in de pool is dat
   niet te vermijden. Het effect is klein en conservatief, maar het is geen
   zuivere leave-one-out empirical Bayes.
3. **De auto-trap middelt over circuits**, gewogen naar rondes. Tien rondes op
   Monza en vijfhonderd op Spa geven samen bijna Spa. Dat is de bedoeling
   (rondes zijn de eenheid), maar het betekent wel dat één veel gereden circuit
   de auto-trap domineert.
4. **`track_key` is van vorm veranderd** (`218:` in plaats van `montreal`). De
   bestaande rijen hadden geen sleutel, dus er is geen datamigratie nodig; de
   dekkingstabel toont nu id's. De UI leest de nieuwe `basis`-velden nog niet —
   dat is een aparte stap, en de bestaande velden blijven ongewijzigd, dus niets
   breekt.
5. **De herberekening is een volledige scan van de stintview** per
   schrijfopdracht. Bij deze schaal is dat 0,23–0,38 s per ronde; boven ~100 000
   samples moet dat gericht per groep.
6. **`k = 8` en de vloer 0,5 zijn gekozen, niet gefit.** Acht rondes is de
   bestaande `v_min_basis` uit het model (de grens waaronder een helling een
   indicatie is); de vloer 0,5 is de bestaande ondergrens van de bandbreedte.
   Beide zijn consistent met wat er al stond, maar het zijn aannames.

## 9. Testscenario's en hun uitkomst

| Scenario | Uitkomst |
|---|---|
| 0 stints op Spa+Lambo | `rate` null, `level` null, `n_eff` 0 |
| 1 stint, 10 rondes basis | `exact`, 0,5000, `n_eff` 5,56 |
| 3 stints | `exact`, 0,5000, `n_eff` 23,68 |
| 10 stints | `exact`, 0,5000, `n_eff` 92,59 |
| 50 stints | `exact`, 0,5000, `n_eff` 492,13 |
| auto zonder circuit (Lambo op Brands Hatch, data op Spa+Monza) | `auto`, 0,4980 = (250+4)/510 |
| circuit zonder auto (Porsche op Brands Hatch, BMW-stint daar) | `circuit`, 0,3602 (tussen circuit 0,25 en algemeen 0,498) |
| tegengestelde hellingen (exact 2,0 vs auto 0,4942) | 1,3308 = 10/18·2,0 + 8/18·0,4942, `level` exact |
| nieuwe combinatie, alleen een wear-stand | `basis.bron = auto`, getal = prior, bereik aanwezig, `geschat`, `voorlopig`, niet `usable` |
| eigen stint + bevestigende pool | rate = 10/18·0,5 + 8/18·prior, `rondes_effectief` groeit, band op de vloer |
| **echte CAT-PC-stint met gesimuleerde sleutels** | 0,5360 · **96–113** in plaats van 88–153, eigen meting (112) blijft binnen de band |

De laatste regel is de simulatie die in de testtransactie gebeurt en wordt
teruggedraaid: de 113 rijen krijgen daar tijdelijk `lamborghinievogt3` / `218:`
plus tien rondes voorkennis. Het laat zien wat er gebeurt zodra de ingest de
sleutels wél vult — de band gaat van 88–153 naar 96–113, en de gemeten 112
rondes blijven erin.

## 10. Volgende stappen

1. De connector stuurt de identiteit al per frame; vanaf de volgende stint
   vullen de sleutels zich zonder pluginwijziging.
2. De pitwall de nieuwe `basis`-velden laten tonen (`bron`, `prior_level`,
   `rondes_effectief`) — nu alleen in de RPC, de UI negeert ze nog.
3. Als de oude oefendata mee moet tellen: sessie-identiteit bewaren
   (`simhub_telemetry_sessions`), dan vult `tyre_backfill_keys()` de 113 rijen
   alsnog.
