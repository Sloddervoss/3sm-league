# Bandenprior: leren over alle rijders, per auto en per circuit

Datum: 2026-10-29
Migratie: `supabase/migrations/20261029090000_tyre_prior_model.sql` (het model) en
`supabase/migrations/20261029120000_tyre_prior_guard_and_contract.sql` (de keuring:
truncate-recht, triggerkosten, dubbeltelling en contract)
Rollback: `supabase/rollback/20261029090000_tyre_prior_model.rollback.sql` en
`supabase/rollback/20261029120000_tyre_prior_guard_and_contract.rollback.sql`
Test: `supabase/tests/20261029090000_tyre_prior_model.sql` (33 PASS),
`supabase/tests/20261029120000_tyre_prior_guard_and_contract.sql` (40 PASS, in een
transactie met rollback) en `supabase/tests/20261029120000_tyre_prior_lock.sh`
(lock-timeout met twee sessies)

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
heeft RLS aan, geen policies en **geen enkel recht** voor een clientrol; alleen
SECURITY DEFINER-functies lezen en schrijven hem.

**Waarom er geen grant meer op staat.** Supabase's default privileges geven elke
nieuwe tabel in `public` alle rechten aan `anon` en `authenticated`. RLS houdt
SELECT/INSERT/UPDATE/DELETE tegen als er geen policy is, maar **TRUNCATE valt
buiten RLS**: `truncate public.tyre_prior_stats` als anon wist de hele pool in één
statement. Sinds `20261029120000` staan de rechten eraf voor `public`, `anon`,
`authenticated` én `service_role`, en de migratie controleert dat zelf met
`has_table_privilege()` — faalt die controle, dan stopt de migratie in plaats van
een gat open te laten. RLS blijft aan zonder policies: dat is de tweede laag.

**Onderhoud: per gesloten stint, met een verschil.** De eerste versie hing een
statement-trigger aan `simhub_tyre_lap_samples` die bij **elke** afgeronde ronde
de hele pool opnieuw berekende. Dat was bij 20 000 rondes 0,5–1 s per ronde, en
een ingest die op de lock van die herberekening wachtte stond 11,57 s stil. Nu:

| Laag | Wat het doet |
|---|---|
| `tyre_prior_contrib` | één rij per **gesloten** stint: rondes, wear-daling en meetbasis per hoek, met het apparaat erbij (privé, zie §7) |
| `tyre_prior_sync_session(device, sessie)` | herziet alleen de gesloten stints van die sessie, vergelijkt met de vorige bijdrage en schrijft het **verschil** naar `tyre_prior_stats` |
| drie statement-triggers (insert/update/delete) | weten via overgangstabellen welke sessies geraakt zijn; de insert-trigger slaat de hele stap over als er geen stint gesloten is |
| `lock_timeout = 2s`, `statement_timeout = 8s` op de triggerfunctie | de ingest blokkeert nooit: bij een timeout volgt alleen een warning en gaat de ronde door |

Een stint is **gesloten** zodra hij niet meer de lopende stint van het apparaat
is: er is een volgende bandenset begonnen, of er is een nieuwe sessie gestart.
Een lopende stint telt dus niet mee — hij is nog geen kennis, en zo hoeft er per
ronde niets herberekend te worden. De poortwachter kijkt daarvoor naar twee
dingen: de bandenset van de vorige ronde en de wear (een sprong omhoog is een
nieuwe set). Alleen als beide tellers bekend en gelijk zijn en de wear daalt,
gaat de trigger vrijuit; in alle andere gevallen wordt de sessie herzien.

Gemeten kosten (transactie met rollback, in deze productie-DB, 20 743 samples):

| Scenario | Tijd |
|---|---|
| normale lap (zelfde sessie, zelfde set) | **0,5–0,6 ms** |
| lap die een stint sluit (sessie van 100 rondes) | 5,4 ms |
| 200 sessies × 100 rondes in één statement (incl. trigger) | ~0,5 s, één keer |
| insert tijdens een ACCESS EXCLUSIVE-lock op de pool | **2 020 ms**, daarna gewoon door (warning) |

De laatste regel is de lock-timeout: de trigger wacht nooit langer dan 2 s en de
ingest gaat door. De statistiek loopt dan één stint achter; `tyre_prior_refresh()`
haalt dat in (zie §10).

## 4. `tyre_prior(car_key, track_key, exclude_device)`: de hiërarchie

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

`n_eff = Σ w_i · n_i` over de traps die meededen: de gewogen meetbasis, niet het
ruwe totaal. `level` is de fijnste trap die meedeed. Daarnaast geeft de functie
**`rondes`** (de echte rondes achter de blend: de som van de meetbasis van de
trap die meedeed) en **`stints`** (het echte aantal stints) — die twee zijn te
natellen, `n_eff` niet. `bron` is een zin met aantallen, bijvoorbeeld:

```
alle auto's en circuits: 54 stints, 540 rondes (stints van andere apparaten) ·
deze auto op dit circuit: 1 stints, 10 rondes (stints van andere apparaten)
```

**Waarom de eigen stint eruit gaat, en niet eraf.** De pool is per auto en
circuit, dus de eigen stint van de aanroeper zit erin. De eerste versie telde
hem in v2 nog eens op bij `n_eigen`; de band werd daardoor 38 % smaller zonder
dat er één nieuwe meting bij kwam. Sinds `20261029120000` krijgt `tyre_prior()`
het apparaat mee (`p_exclude_device`) en telt het de bijdragen van dat apparaat
niet mee:

```sql
select public.tyre_prior('lamborghinievogt3', '218:', p_device_id);
```

Gekozen voor **uitsluiten bij de bron**, niet voor aftrekken achteraf. Aftrekken
werkt alleen zolang de tellingen positief blijven, moet per trap opnieuw worden
gedaan, en maakt van een som een verschil dat niemand meer kan natellen.
Uitsluiten is één voorwaarde op dezelfde boekhouding, is exact, en laat de
drempel van drie rondes op de juiste populatie werken: een trap die alleen uit
eigen stints bestond valt weg in plaats van "bijna leeg" te blijven en toch
gezag te suggereren. De eigen stint telt daarna precies één keer mee — als eigen
meting in v2 (`w_eigen = n_eigen/(n_eigen+8)`).

De trap `exact` heet daarom ook geen "eigen data" meer: hij is per definitie
andermans data op precies deze combinatie.

**Waarom disjunct.** Zonder die scheiding telt de eigen cel in drie traps mee en
zou een combinatie met veel eigen data zichzelf naar het groepsgemiddelde
blijven trekken — precies het tegenovergestelde van "meer data = smaller".

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
| `prior_n` | `n_eff` van de prior: de **gewogen** meetbasis, geen aantal rondes |
| `prior_rondes` | de **echte** rondes in de pool, exclusief de eigen stints |
| `prior_stints` | het **echte** aantal stints in de pool, exclusief de eigen |
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

`n_eff = n_eigen + n_prior` telt de eigen stint **één keer**: `n_prior` komt uit
een prior waarin de eigen stints van dit apparaat niet meer zitten. Bestaat de
pool op deze combinatie alleen uit eigen data, dan is `n_prior` nul, blijft
`rondes_effectief` gelijk aan de eigen basis en verandert de band niet — de
keuring van de eerste versie liet zien dat hij daar 38 % smaller werd.

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
- `tyre_prior_contrib` bevat wél het apparaat, per stint. Dat is onvermijdelijk:
  zonder die koppeling is de eigen stint niet uit te sluiten (fout 3) en is een
  stint niet met een verschil bij te werken (fout 2). De tabel is strenger
  afgeschermd dan de oude: RLS aan, geen policies, en **geen enkel recht** voor
  `public`, `anon`, `authenticated` of `service_role`. Alleen SECURITY
  DEFINER-functies komen erbij; er is geen functie die een apparaat teruggeeft.
- `tyre_prior()` geeft exact zes velden: `rate`, `n_eff`, `rondes`, `stints`,
  `level` en `bron`. De bron is een zin met aantallen, geen identificatie. De
  test controleert dat er geen apparaatnaam, apparaat-id of coureur in de
  uitvoer staat.
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
2. **De eigen stint zit in de boekhouding.** `tyre_prior_contrib` koppelt een
   stint aan het apparaat dat hem reed. Dat is nodig voor het uitsluiten (en
   voor het bijwerken met een verschil) en het is niet publiek: geen grants,
   RLS aan, en geen functie die een apparaat teruggeeft. Wie met beheerdersrechten
   in de database kijkt, kan het wel zien — dat was met de samples zelf ook al zo.
3. **De auto-trap middelt over circuits**, gewogen naar rondes. Tien rondes op
   Monza en vijfhonderd op Spa geven samen bijna Spa. Dat is de bedoeling
   (rondes zijn de eenheid), maar het betekent wel dat één veel gereden circuit
   de auto-trap domineert.
4. **`track_key` is van vorm veranderd** (`218:` in plaats van `montreal`). De
   bestaande rijen hadden geen sleutel, dus er is geen datamigratie nodig; de
   dekkingstabel toont nu id's. De pitwall leest de nieuwe `basis`-velden
   (`prior_rondes`, `prior_stints`) en valt terug op `prior_n` als een oudere
   server die nog niet stuurt.
5. **Een stint telt pas mee als hij dicht is.** De lopende stint van het
   laatst geziene apparaat staat niet in de pool: hij is nog niet af, en zo kost
   een gewone ronde niets. De laatste stint van een sessie komt erin zodra de
   volgende sessie begint (of de volgende bandenset). Een apparaat dat nooit
   meer terugkomt, houdt zijn allerlaatste stint dus buiten de pool; dat is
   bewust — een halve stint is geen kennis — en `tyre_prior_refresh()` hanteert
   dezelfde grens, zodat incrementeel en herbouwd altijd gelijk zijn.
6. **`k = 8` en de vloer 0,5 zijn gekozen, niet gefit.** Acht rondes is de
   bestaande `v_min_basis` uit het model (de grens waaronder een helling een
   indicatie is); de vloer 0,5 is de bestaande ondergrens van de bandbreedte.
   Beide zijn consistent met wat er al stond, maar het zijn aannames.
7. **Een enorme bulk-insert kan de statistiek één keer overslaan.** De trigger
   heeft een `statement_timeout` van 8 s; een import van tienduizenden rijen in
   één statement haalt dat en levert dan een warning op. De rijen zijn dan wel
   binnen (de ingest gaat altijd door) maar de pool loopt achter tot de volgende
   stint of een `tyre_prior_refresh()`.

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
| **echte CAT-PC-stint met gesimuleerde sleutels** | 0,4834 · **106–118** in plaats van 88–153, eigen meting (112) blijft binnen de band |
| eigen data als enige in de pool | prior leeg, `rondes_effectief` = eigen basis, band 0,670 breed — met de oude dubbeltelling 0,512 (38 % smaller) |
| andermans stint op dezelfde combinatie | `exact`, 10 rondes, `n_eff` = eigen + 5,56, band smaller (0,500) |
| lopende stint | telt niet in de pool; na de sluitende ronde wel |
| 20 000 rondes (200 sessies) | normale lap 0,5 ms, stint-sluitende lap 5,4 ms |
| lock op de pool tijdens een insert | wacht 2 020 ms (lock_timeout), warning, insert bewaard |
| incrementeel vs. herbouwd | identiek na insert, update en delete |

De CAT-PC-regel is de simulatie die in de testtransactie gebeurt en wordt
teruggedraaid: de 113 rijen krijgen daar tijdelijk `lamborghinievogt3` / `218:`
plus tien rondes voorkennis van een ander apparaat. Het laat zien wat er gebeurt
zodra de ingest de sleutels wél vult — de band gaat van 88–153 naar 106–118, en
de gemeten 112 rondes blijven erin. De eigen stint van CAT-PC telt daarbij niet
mee in de prior (die is uitgesloten), alleen als eigen meting.

## 10. Wat de keuring van 20261029090000 rechtzette

De eerste versie had vier echte fouten. Ze zijn hierboven op hun plek beschreven;
dit is het overzicht met de reparatie erbij.

| Fout | Wat er misging | Reparatie |
|---|---|---|
| **TRUNCATE voor anon** | default privileges gaven `anon` en `authenticated` alle rechten; RLS stopt TRUNCATE niet, dus de pool was in één statement te wissen | alle rechten eraf voor `public`, `anon`, `authenticated` en `service_role`; RLS aan, geen policies; de migratie controleert het zelf met `has_table_privilege()` en stopt als er nog een recht staat |
| **Kosten per ronde** | de trigger herberekende bij elke afgeronde ronde de hele pool (0,5–1 s bij 20 000 rondes) en een insert wachtte 11,57 s op de lock | alleen gesloten stints, per stint een bijdrage, en de cel bijwerken met het **verschil**; `lock_timeout` 2 s en `statement_timeout` 8 s met alleen een warning |
| **Dubbeltelling** | de pool bevatte de eigen stint en v2 telde die er met `n_eigen` nog eens bij op: 38 % te smal zonder nieuwe informatie | `tyre_prior(car, track, exclude_device)` sluit de eigen stints bij de bron uit; de eigen stint telt één keer mee, als eigen meting |
| **Contract** | `prior_n` was `n_eff` (gewogen) maar werd als rondes gepresenteerd, de UI zei "van andere rijders" terwijl de eigen stint meetelde, en de trap `exact` heette "eigen data" | `tyre_prior()` geeft `rondes` en `stints` naast `n_eff`; `basis.prior_rondes` en `basis.prior_stints` staan ernaast; de trap `exact` heet "deze auto op dit circuit (stints van andere apparaten)" |

De vaste getallen zijn niet verschoven: CAT-PC 88–153 (0,4833), PCBART 150–169
(0,3429), DESKTOP-E2SEMRP 393–788 (0,0958), alle drie met `basis.bron = eigen`
en `prior_rate = null`, want de pool is in productie leeg (0 van 113 rijen met
een sleutel).

## 11. Volgende stappen

1. De connector stuurt de identiteit al per frame; vanaf de volgende stint
   vullen de sleutels zich zonder pluginwijziging.
2. De pitwall toont sinds `fix(pitwall): toon de echte rondes achter de
   bandenprior` de echte rondes (`prior_rondes`) en de opbouw als titeltip.
3. Als de oude oefendata mee moet tellen: sessie-identiteit bewaren
   (`simhub_telemetry_sessions`), dan vult `tyre_backfill_keys()` de 113 rijen
   alsnog.
4. Na een storing of een overgeslagen trigger: `select public.tyre_prior_refresh();`
   bouwt de bijdragen en de cellen opnieuw op (idempotent, secondewerk).
