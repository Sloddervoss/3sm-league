# AGENTS.md — Werkregels voor AI-assistenten in de 3SM-league repo

Lees dit bestand bij de start van ELKE taak. Deze regels zijn bindend.
Voor de bredere projektcontext geldt `HERMES.md` en `docs/AI_START_HERE.md`.

## 1. Commit NOOIT direct op `main`

`main` is de beschermde lijn en verandert ALLEEN via merges (pull requests).
Sta je op het punt om op `main` te committen? **Stop** en maak eerst een branch.

## 2. Bouw voort op bestaande wijzigingen en besluiten

De bestaande, al uitgevoerde wijzigingen en besluiten zijn je startpunt. Die
vormen de gevestigde werkwijze in de repo (git-historie, docsmappen, notities).
Vertrek daar nooit vanaf zonder dat expliciet te zeggen; je bouwt voort op wat
er al is.

## 3. Elke taak start op een nieuwe feature-branch

```
git checkout main && git pull
git checkout -b feat/<korte-slug>     # of fix/<korte-slug>
```

Werk alleen op die branch. Merge je eigen branch NOOIT zelf naar `main`.

## 4. Conventional Commits — zodat wijzigingen in één oogopslag te classificeren zijn

```
feat(scope): omschrijving    # nieuwe feature
fix(scope): omschrijving     # bugfix / reparatie
docs(ops): omschrijving      # documentatie / ops-notities
test(scope): omschrijving    # tests
```

`scope` = het subsystem, bijvoorbeeld: `iracing-sync`, `endurance`, `pitwall`,
`simhub`, `support`.

## 5. Kleine, logische commits

Eén werkeenheid per commit, geen één megacommit.

## 6. Bekijk eerst de bestaande situatie vóór je code schrijft

Lees de relevante git-historie, de docsmappen (bv. `docs/operations`) en
verifieer de huidige staat op `main` voor je code schrijft. Doet iets of iemand
al werk op hetzelfde onderdeel (open branch, actieve feature, open PR)?
**Overleg dan in plaats van dubbel werk te doen of te overschrijven.**

## 7. Push ALTIJD je branch en zet een PR open

```
git push -u origin <branchnaam>
```

Zet daarna een pull request open richting `main`. Merge het niet zelf.

## 8. Eindig met een korte samenvatting

Bevat in ieder geval:

- de branchnaam/namen die je gepusht hebt,
- het PR-nummer / de link als je die geopend hebt,
- één regel: **"PRODUCTIEWIJZIGING: JA of NEE"** — of er iets live is geraakt
  (DB-schema, live site-inhoud of productiedata).

Als je het DB-schema of migraties gewijzigd hebt, zeg dat dan expliciet in de
samenvatting en geef migratiebestanden een unieke tijdstempel-prefix.

## 9. Werk onder de git-identiteit van de projecteigenaar

Commit en push ALLEEN onder:

```
Sloddervoss <268675390+Sloddervoss@users.noreply.github.com>
```

Gebruik nooit een eigen of andere auteur. Check vóór elke commit:

```
git config user.name
git config user.email
```