# Samenwerken tussen Beest (Codex) en de server (Hermes)

Beest heeft geen eigen GitHub-toegang: de sleutel die daar staat is niet op
GitHub geautoriseerd. De server heeft die toegang wel. Daarom loopt alle
uitwisseling via de server, in bundels.

## Wat waar staat

| plek | wat |
| --- | --- |
| `C:\Users\vdevo\.codex\worktrees\<taak>\3-stripe-league-hub-main` | Codex-werkplek per taak, eigen branch |
| `C:\Users\vdevo\3sm\3sm-sync.ps1` | het script op de pc |
| `/home/hermes/beest-inbox/` | wat de pc heeft gestuurd |
| `/home/hermes/beest-uit/` | wat de pc kan ophalen |
| `/home/hermes/.hermes/scripts/3sm-beest-bridge.sh` | de brug, draait elke 5 minuten |

## Op de pc

Vanuit de werkplek waar je werkt:

```powershell
# je branch naar de server sturen (gaat daarna naar GitHub)
powershell -ExecutionPolicy Bypass -File C:\Users\vdevo\3sm\3sm-sync.ps1 -Mode push

# nieuwste main + alle branches van de server ophalen
powershell -ExecutionPolicy Bypass -File C:\Users\vdevo\3sm\3sm-sync.ps1 -Mode pull

# waar sta ik
powershell -ExecutionPolicy Bypass -File C:\Users\vdevo\3sm\3sm-sync.ps1 -Mode status
```

`-Werkplek <pad>` wijst naar een andere Codex-werkplek; zonder dat argument wordt
`github-main` gebruikt.

## Regels om elkaar niet in de weg te zitten

1. **Eén branch per taak, en nooit dezelfde branch aan twee kanten.** Ik werk op
   `feat/…` of `fix/…`, Codex op `codex/…`. Samenvoegen gebeurt via `main`.
2. **Eerst committen, dan pushen.** Wat niet gecommit is, gaat niet mee — het
   script waarschuwt met het aantal openstaande bestanden.
3. **Vóór een nieuwe taak `-Mode pull`.** Anders begint Codex op een oude main.
4. **Na een push binnen vijf minuten zichtbaar.** De brug zet de branch op GitHub;
   daarna kan ik hem hier ophalen en andersom.
5. **Niet dezelfde bestanden tegelijk bewerken.** Is dat nodig, zeg het en we
   spreken een volgorde af; anders overschrijft de laatste push de eerste.

## Wat de brug niet doet

- Geen automatische merge: een branch die niet fast-forwardbaar is, blijft staan
  en moet met de hand worden opgelost.
- Geen deploy: pushen naar GitHub verandert niets aan de live site of de database.
- Geen force-push: de brug pusht alleen nieuwe commits op een branch.
