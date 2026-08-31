# 3SM SimHub Updater-hardening — v0.3.9.0 (kandidaat) — plan

Status: **ONTWERP / REVIEW — nog NIET bouwen.**
Datum: 2026-08-31
Branches bron-analyse: `release/simhub-0.3.8.0` (shipped), `main` (focus-updater-code met RSA/manifest sig-verificatie).
Scope: uitsluitend updater-betrouwbaarheid. **Niet mengen** met M4, SessionTime-fix of Diagnostics (wordt apart freed of losse release, zie sectie Releasebesluit).

Relevantie-basis: bestaande READ-ONLY analyse van de live 0.3.8.0-artefact + Beest updater.log. **Niet** gebaseerd op een definitief bewezen CAT-PC-oorzaak.

---

## 1. Huidige updaterflow van de live 0.3.8.0

De live versie-endpoint serveert `0.3.8.0` (sha `0ed14d0b…`, 300032 B, RSA-ondertekende metadata; live endpoint antwoordt exact dit, getoond in analyse). De shipped `3SM.EnduranceConnector.dll` die actief is op clients bevat de externe updater + het geharde contact.

De connector-update-flow (bron `release/simhub-0.3.8.0` `EnduranceConnectorPlugin.cs`, lijnen ~120–216):

1. **Check (1×/24u of via UI-knop, force):** GET `…/simhub-version` → parse `VersionResponse` (`version`, `dllUrl`, `sha256`, `byteLength`, `fileName`, `signature`, `checkedAt`). Validaties: `IsAllowedPluginDownload` (HTTPS, exact host `3stripemotorsport.cc`, default port, géén userinfo/query/fragment, exact pad `/downloads/3SM.EnduranceConnector-<version>.dll`) + `IsSha256`. Alleen als remote > local wordt update beschikbaar; anders "Actueel".
2. **Bevestiging:** MessageBox "…gecontroleerd gedownload en geïnstalleerd. SimHub sluit daarna af en start automatisch opnieuw. Doorgaan?".
3. **Download naar staging:** `%LOCALAPPDATA%\3SM\EnduranceConnector\Updates\<version>\3SM.EnduranceConnector.dll`, gedeeld `DownloadUpdateAsync` met size-cap 5 MiB + `AllowAutoRedirect=false`. Fout ⇒ partial bestand wordt verwijderd en opnieuw gegooid.
4. **Verify:** SHA-256 van staged == `expectedHash`; FileVersionInfo == remote version. Mismatch ⇒ afwijzen vóór enige vervanging.
5. **Extract Updater:** embedded `3SM.EnduranceConnector.Updater.exe` resource → zelfde updates-dir.
6. **Launch updater (Verbelevatie):** `Process.Start(…, Verb="runas")` met args `--pid <SimHubPid> --started-utc-ticks <…> --target <geladen.dll> --staged <staged.dll> --sha256 <…> --installed-sha256 <…> --length <…> --version <…> --simhub <SimHubWPF.exe-pad> [--no-restart] [--ready-event <naam>]`.
7. **Updater (extern, gelanceerd als mede-stap):**
   - mutex `Global\3SM.EnduranceConnector.Updater` (preventie dubbele updater);
   - `ValidatePaths` (canonical SimHub-map, exact bestandsnamen, geen staged==target, UNC/reparse-point controles);
   - `ValidatePayload` (SHA-256 + fileversie + length op staged);
   - `AcquireSimHubProcess(pid, startedUtcTicks, simHubPath, noRestart)` — valideert exacte PID + starttijd + executablepad van SimHub;
   - `SignalReady(ready-event)` — pas dan mag de plugin SimHub afsluiten (ready-before-shutdown handshake);
   - `WaitForSimHubExit(pid, 2min timeout)` — wacht op proces-exit;
   - her-validate paths+payload na exit;
   - `RecoverPreviousTransaction(target, installedHash)` (journal herstel, zie sectie 10);
   - check `Sha256(target) == installedHash` — als de **geïnstalleerde** DLL in de tussentijd gewijzigd is ⇒ afbreken;
   - `Install(...)` via `File.Replace(incoming, target, backup, true)` (zelfde volume, atomaire vervanging) met back-up `.3sm-backup` + journal;
   - daarna herstart via Explorer-shell + PID-bevestiging (niet-elevated restart), tenzij `--no-restart`.
8. Niet-blokkerende fouten → MessageBox + updater.log; plugin-status via `SetUpdateStatus`.

Beest updater.log (empirisch, 2026-08-09 t/m 08-20) toont de volgorde/beelden exact, incl. successen (0.3.0.1→0.3.5.0→0.3.6.0→0.3.7.0) én failures (SimHub-exit-timeout, concurrent mutex).

---

## 2. Bewezen bestaande protections (al in 0.3.8.0)

Vanuit READ-ONLY bewijs:

| Bescherming | Waar | Bewijs |
|---|---|---|
| HTTPS-only + vaste host/pad download-URL, geen redirects | connector `IsAllowedPluginDownload`, `DownloadUpdateAsync` `AllowAutoRedirect=false` | code + live endpoint |
| SHA-256 controle van download vóór install | connector + updater `ValidatePayload` | code |
| File-versie + bestandsgrootte controle | connector + updater `ValidatePayload` | code |
| Staged download naar tijdelijke/Update-dir, nooit directe overwrite vóór validatie | connector | code |
| Externe updater vervangt DLL (loaded DLL vervangt zichzelf nooit) | `3SM.EnduranceConnector.Updater` apart project | code |
| Atomaire vervanging `File.Replace(… backup)` | updater `Install` | code + Beest log/resultaat |
| Back-up `.3sm-backup` + last-known-good | updater | code + Beest staged-DLL-geschiedenis |
| Rollback bij install-fout na vervanging | updater `Install` catch | Beest log "Installatiefout; vorige DLL wordt atomair teruggezet" |
| Transactie-journal + recovery vóór install | updater `WriteJournal` / `RecoverPreviousTransaction` | Beest log "Onderbroken update … / Beschadigd journal … opgeruimd" |
| Proces-identiteit (exact PID + starttijd + path) vóór shutdown | updater `AcquireSimHubProcess` | code |
| Ready-before-shutdown handshake | `SignalReady` via ready-event | code + Beest log "Procesidentiteit bevestigd" |
| Machinebrede mutex (geen dubbele updater) | `Global\…Updater` mutex | Beest log "Er draait al een 3SM-updater" |
| Protected device-token (DPAPI) — niet in updater-args/logs | connector | code |
| SimHub restart via Explorer-shell (niet-elevated) + PID-bevestiging | updater `RestartSimHub` | code + Beest log |

### ⚠️ Belangrijke feitcorrectie: géén RSA-release-manifest-verificatie in 0.3.8.0

Uit de live-artefact + release-branch (`release/simhub-0.3.8.0`) blijkt: de **live 0.3.8.0-connector verifieert GEEN RSA-handtekening van het release-manifest**. Het `VersionResponse` dat de 0.3.8.0-connector leest bevat alleen `name/version/dllUrl/sha256/checkedAt` — géén `signature`/`byteLength`/`fileName`-velden, en de code bevat **geen** `ReleasePublicKeyXml`/`VerifyReleaseManifest`. De 0.3.8.0-controle is: **HTTPS+vaste host/pad-URL** én **SHA-256** én **file-versie** = integrity via TLS + hash, zonder cryptografische release-handtekening.

De RSA-handtekeningverificatie (`ReleasePublicKeyXml` + `VerifyReleaseManifest`) bestaat alleen op de **`main`/`fix/endurance-multiuser-hardening`-lijn** (AssemblyVersion 0.3.0.1), die NIET de live 0.3.8.0 is. Dit is een **genuine gap** die vóór publicatie van 0.3.9.0 moet worden aangepakt (zie open vraag hieronder).

**Impact voor 0.3.9.0:** de release-metadata-additievelijke eigenschappen (Signature/ByteLength/FileName) zijn **niet** door de 0.3.8.0-clients gelezen — backward-compat blijft. Voor 0.3.9.0 is het wel een **open ontwerpkeuze** of we de RSA-manifest-handtekening (vanuit de main-lijn) overnemen als hardened verificatie — dat is een aparte, waardevolle betrouwbaarheid/security-hardening en verdient een expliciete beslissing, NIET als stille bijvangst in deze release.

---

## 2b. ✅ PROVEN 0.3.8.0 SELF-UPDATE DEFECT (separaat van CAT-PC root cause)

**Status: `PROVEN 0.3.8.0 SELF-UPDATE DEFECT`.** Dit is intern bewijs uit het release-artefact zelf — onafhankelijk van CAT-PC. **Nog NIET `PROVEN CAT-PC ROOT CAUSE`**: dat vereist de echte CAT-PC `updater.log`/`SimHub.log`, die niet beschikbaar is (geen SSH naar CAT-PC — bewuste afspraak). Zie sectie 3.

Deze bevinding spreekt het eerdere bewijs niet tegen: de ingebedde updater in 0.3.8.0 **kan** het geharde 10-arg-protocol ondersteunen (hij vereist het zelfs), terwijl de 0.3.8.0-connector bij het *starten* van die updater slechts **6 argumenten** meegaf. Beide feiten zijn tegelijk waar.

### Exact vastgelegd

**1. Callsite in 0.3.8.0** — `EnduranceConnectorPlugin.cs`, methode `InstallAvailableUpdateAsync`, regels 178-184 (bevestigd in `release/simhub-0.3.8.0`-bron én in de connector-IL van de geüploade DLL `0ed14d0b`):

```csharp
var arguments =
    "--pid "  + QuoteArgument(currentProcess.Id.ToString()) +
    " --target " + QuoteArgument(targetDll) +
    " --staged " + QuoteArgument(stagedDll) +
    " --sha256 " + QuoteArgument(expectedHash) +
    " --version " + QuoteArgument(remoteVersion.ToString()) +
    " --simhub " + QuoteArgument(simHubPath);
```

**2. De 6 args die 0.3.8.0 feitelijk verstuurt:**
`--pid --target --staged --sha256 --version --simhub`

**3. De 10 args die de ingebedde updater vereist** (`Program.cs`-Main, `Required(options, …)`):
`--pid --started-utc-ticks --target --staged --sha256 --installed-sha256 --length --version --simhub` (+ optioneel `--ready-event`, `--no-restart`)

**4. Eerste ontbrekende argument:** `--started-utc-ticks` (tweede wat geparsed wordt in de updater-Main, na `pid`).

**5. Verwachte fout:** de updater gooit `System.ArgumentException: Verplicht updaterargument ontbreekt: --started-utc-ticks` bij het parsen van de commandoregel, **vóórdat** enige banner/security/install-logica draait. De updater logt `FOUT: …` en retourneert exit-code 1.

**6. Waarom dit vóór DLL-mutatie faalt:** de arg-parsing + `ValidatePaths` + `AcquireSimHubProcess` + `SignalReady` gebeuren allemaal strikt **vóór** `Install(...)` (die `File.Replace` doet). Omdat het ontbrekende verplichte argument al in de allereerste stap faalt, bereikt de flow **nooit** de vervangingsfase.

**7. Waarom de bestaande plugin daardoor intact blijft:** geen enkele code-pad naar `File.Replace`/back-up/journal wordt bereikt; de target-DLL en de draaiende plugin worden nooit gemuteerd. Een mislukte 0.3.8.0-selfupdate laat de werkende 0.3.8.0-connector dus **ongewijzigd achter** (het defect is een "crash-vóór-mutatie", geen corruptie).

**Bewijs-niveau-voorwaarde vóór status-upgrade:** deze declaratie wordt pas `PROVEN CAT-PC ROOT CAUSE` als de echte CAT-PC `updater.log` een exit met `Verplicht updaterargument ontbreekt` (of vergelijkbare 10-arg-parse-fout) toont. Zolang dat ontbreekt, blijft het `PROVEN 0.3.8.0 SELF-UPDATE DEFECT (alleen artifact-intern gedemonstreerd)`.

**Reproductie:** gedemonstreerd/aantoonbaar in de lokale E2E-harness (sectie 13, test #1/#2): echte 0.3.9.0 `3SM.EnduranceConnector.Updater.exe` aangeroepen met de 6-arg-set reproduceert exact de `Verplicht updaterargument ontbreekt`-exit; met de 10-arg-set accepteert dezelfde updater de handshake en installeert. De connector-fix in 0.3.9.0 stuurt nu alle 10 args (geverifieerd in sectie 13, test #21).

---

## 3. Nog ONBEWEZEN CAT-PC-oorzaak (bewust gemarkeerd)

De exacte CAT-PC updater-crash blijft **unconfirmed**. Dit plan speculeert er NIET over alsof het bewezen is.

**Blokkade analyse:** er is géén SSH-toegang/ookup naar CAT-PC (geen Windows-SSH-credential, bewuste afspraak), en CAT-PC was in de analyse niet recent online (laatste `last_seen_at` 2026-08-30 21:52; alle clients oud). Daardoor zijn er **geen** directe CAT-PC `%LOCALAPPDATA%\3SM\EnduranceConnector\Updater\updater.log` of relevante `SimHub.log`-fragmenten beschikbaar.

**Hoogstwaarschijnlijk mechanisme (hypothese, NIET conclusie):** uit het Beest log zijn twee bewijsbare faalmodi in dezelfde updater geld die een "crash"-perceptie kunnen geven:
1. **SimHub-exit-timeout:** `TimeoutException: SimHub is niet binnen twee minuten afgesloten; update geannuleerd` (Beest 18:19 en 18:29). SimHub stopte niet binnen de 2-min-limit → update geannuleerd vóór vervanging.
2. **Concurrent updater (stale mutex):** een updater startte terwijl de vorige nog actief was → `Er draait al een 3SM-updater` (Beest 18:18, 18:19), gevolgd door/secondair gestart met een Timeout.

Beide paden eindigen in **annulering/foutmelding, géén DLL-overschrijving of corruptie**. Toch is dit **nog geen bewijs** voor CAT-PC — dat eist de echte CAT-PC-log, zodra beschikbaar, parallel op te pakken.

**Actie vóór definitieve conclusie:** zodra CAT-PC beschikbaar is, als eerste ophalen:
- `%LOCALAPPDATA%\3SM\EnduranceConnector\Updater\updater.log` (volledig + timestamps);
- relevante `SimHub.log`-fragmenten rond het crashtijdstip;
- status van `.3sm-backup` / `.3sm-journal` in de SimHub-map, of de werkende DLL nog geladen/ongewijzigd is.

Daarna pas "bewezen oorzaak" wijzigen. Dit plan blijft geldig ongeacht de uitkomst.

---

## 4. FSM states + toegestane transitions

Toestand wordt **persisted** (niet alleen in-memory) zodat crash/reboot de machine niet reset naar een willekeurige staat. Definities expliciet (geen impliciete overgangen):

| state | betekenis |
|---|---|
| `IDLE` | geen update-loop, geen staged update in behandeling |
| `CHECKING` | versie-check naar `simhub-version` bezig (force of 24u-check) |
| `UPDATE_AVAILABLE` | remote > local, metadata valid (URL/host/pad, sha256, [signature]), wacht op gebruiker-bevestiging |
| `DOWNLOADING` | download naar staged Updates-dir bezig |
| `VERIFYING` | SHA-256 + fileversie + length van staged controleren |
| `STAGED` | staged DLL valide, updater-extract + launch bezig |
| `WAITING_FOR_RESTART` | updater gestart; wacht op SimHub-exit + install (of uitstel tot volgende start, zie sectie 7) |
| `INSTALLING` | updater vervangt target (+ back-up/journal) |
| `SUCCESS` | replacement + [herstart] geslaagd |
| `FAILED` | install/fout; rollback-of-annulering afgerond; werkende DLL intact of hersteld |

### Transition table (expliciet — `current_state | event | next_state | side_effect | recovery`)

| current_state | event | next_state | side_effect | recovery |
|---|---|---|---|---|
| `IDLE` | check gestart (force of 24u-grens) | `CHECKING` | event ontstaat; HTTP GET `simhub-version` | none |
| `CHECKING` | endpoint HTTP fout / time-out | `IDLE` | status melding "check mislukt"; **geen** staged mutatie | retry na 24u of force |
| `CHECKING` | remote <= local | `IDLE` | melding "Actueel"; `LastKnownRemote*` bijgewerkt | none |
| `CHECKING` | remote > local + metadata valid | `UPDATE_AVAILABLE` | `LastKnownRemoteVersion/Sha/Url` persisted | none |
| `CHECKING` | remote > local + metadata INVALID | `IDLE` | melding "metadata ongeldig"; geen auto-update | force opnieuw |
| `UPDATE_AVAILABLE` | gebruiker annuleert (No) | `IDLE` | status gereset | none |
| `UPDATE_AVAILABLE` | gebruiker bevestigt (Yes) | `DOWNLOADING` | start download staged | op fout→FAILED |
| `DOWNLOADING` | download HTTP fout / partial te groot | `FAILED` | staged partial verwijderd | retry (handmatig) |
| `DOWNLOADING` | download voltooid | `VERIFYING` | SHA-256/fileversie/length check | op fail→FAILED |
| `VERIFYING` | sha/versie/length mismatch | `FAILED` | staged afgekeurd; niets vervangen | retry (handmatig) |
| `VERIFYING` | valid | `STAGED` | updater extract + launch (runas) | op launch-fout→FAILED |
| `STAGED` | UAC geannuleerd / Launch fout (error 1223) | `FAILED` | status "update geannuleerd bij Windows-bevestiging"; SimHub blijft draaien | retry mogelijk |
| `STAGED` | updater gestart, ready-signal | `WAITING_FOR_RESTART` | SimHub sluit; updater wacht op exit | op stop-timeout→ zie sectie 6/7 |
| `WAITING_FOR_RESTART` | SimHub exited binnen timeout | `INSTALLING` | updater voert install uit (File.Replace+backup+journal) | op failure→`FAILED`+rollback |
| `WAITING_FOR_RESTART` | SimHub stop NIET binnen 2 min | `WAITING_FOR_RESTART` (persisted) | **geen forcing, geen DLL-mutatie**; staged behouden; installatie uitgesteld tot volgende start-cyclus | volgende SimHub-start hervat (max 1 poging/start) |
| `INSTALLING` | replacement geslaagd, installerende process exit | `SUCCESS` | SimHub herstart (of manual-next-start) | herstart-fout → `SUCCESS`+melding (niet FAILED; install ok) |
| `INSTALLING` | install-fout na vervanging | `FAILED` | rollback back-up herstellen (File.Replace terug) | retry (handmatig) |
| elke wirwar | exception / verlies van proces | `FAILED` | journal/recovery + back-up-restore waar mogelijk | zie sectie 10 |
| `SUCCESS` | (24u-check) | `CHECKING` | nieuwe cyclus | none |

**Invariante regel:** er is alleen `STAGED→WAITING_FOR_RESTART→INSTALLING→SUCCESS|FAILED` als een valide staged DLL bestaat + updater is gestart. Alle andere states raken geenszins de geladen DLL.

---

## 5. Persisted updater-state store — **[RESOLVED]**

**Besluit (v1):** de updater-FSM wordt **NIET** als gewone multi-writer `ConnectorSettings` opgeslagen. Het SimHub-plugin-proces én het losse updater-proces mogen niet tegelijk dezelfde `ConnectorSettings` muteren — dat zou een nieuwe race/corruptiebron worden.

**Dedicated state store:** `%LOCALAPPDATA%\3SM\EnduranceConnector\Updater\updater-state.json`

Eisen (hard):
- **atomic write** via temp-bestand + `File.Replace`/`Move` (nooit in-place);
- expliciet **schema/version-veld** (bv `"schemaVersion": 1`);
- corrupt/missing bestand mag de connector **nooit laten crashen**;
- **veilige defaults** bij missing/corrupt (state `IDLE`, geen pending staged);
- **named mutex/file-synchronisatie** wanneer meerdere processen dezelfde state kunnen schrijven;
- **duidelijk vastleggen welk proces eigenaar is van welke transitions** (zie onder);
- het **updater-journal blijft aparte install/recovery-authority**.

De connector mag deze updater-state later **uitlezen** voor UI/Diagnostics. Diagnostics 0.3.10.0 krijgt daarop alleen **READ-ONLY** toegang.

**Schema** (`updater-state.json`):

| veld | type | owner(schrijver) | betekenis |
|---|---|---|---|
| `schemaVersion` | int | beide (fixed=1) | versie van dit schema |
| `state` | string | connector (pre-install) / updater (install) | FSM-state |
| `stateChangedUtc` | string\|null | connector/updater | moment van laatste transitie |
| `pendingUpdateVersion` | string\|null | connector | staged remote versie |
| `pendingStagedDll` | string\|null | connector | staging-pad van te installeren DLL |
| `pendingSimHubPid` | int\|null | connector | SimHub-PID van WAITING-moment (tracerbaarheid) |
| `lastUpdateResult` | string\|null | updater | `none/success/failure:<code>` |
| `lastUpdateUtc` | string\|null | updater | laatste update-poging |
| `lastUpdateErrorCode` | string\|null | updater | foutcode (sectie 12) |

**Transition-eigenaar:** de **connector (plugin-process)** is eigenaar van `IDLE→…→STAGED` en van het zetten van `WAITING_FOR_RESTART`. De **losse updater-process** is eigenaar van `STAGED/WAITING→INSTALLING→SUCCESS|FAILED` en schrijft `lastUpdate*`. Beide gebruiken dezelfde mutex + atomic-write; de lezer (connector voor UI/diagnostics) accepteert default-waarden bij ontbrekend/verouderd schema.

**Dubbele waarheid vermijden:** wat **rechtstreeks uit het journal af te leiden** is, wordt `niet` als aparte flag opgeslagen. Concreet:
- `RecoveryRequired` wordt **niet** apart opgeslagen — het wordt **afgeleid**: er is een journal-bestand aanwezig én state ∈ {`INSTALLING`,`WAITING_FOR_RESTART`,`STAGED`} → recovery-vlag is impliciet waar.
- De **journal-status is de install/recovery-authority** (`updater-state.json` is alleen de logische FSM; de journal is de fysieke install-waarheid). Geen FSM-flag die de journal-waarheid dupliceert.

**Corruptie-handling:** bij JSON-parsefout of onbekende `schemaVersion` → sla state weg naar `updater-state.json.corrupt-<ts>` (best-effort) en start met veilige defaults `{schemaVersion:1, state:"IDLE"}`. Nooit een exception naar de connector laten lekken; nooit een update starten vanuit corrupte state.

---

## 6. Gedrag bij SimHub die NIET afsluit — **[RESOLVED]**

**Besluit (v1):** houd **maximaal 2 minuten wachten** op SimHub-exit. De timeout **verruimen is géén oplossing**. Als SimHub na 2 min nog draait:

- **NIET forceren** en **NIET de DLL vervangen** (DLL is geladen; muteren terwijl SimHub leeft is verboden).
- state → `WAITING_FOR_RESTART` (persisted in updater-state store).
- De voorgestelde staged update **behouden**; updater stopt netjes.
- **Installatie gebeurt pas rond de volgende CLEAN EXIT van dat SimHub-proces** — zie sectie 7.

**Correcte semantiek van `WAITING_FOR_RESTART` (verduidelijkt):**
> `WAITING_FOR_RESTART` betekent **NIET** "bij de volgende SimHub-start proberen we de DLL te vervangen" — want zodra SimHub gestart is, is de connector-DLL alweer geladen (in-process) en kan die niet worden vervangen.
>
> Feitelijke definitie: **`staged update waiting for a clean SimHub exit/install opportunity`** — de installatie mag alleen worden uitgevoerd nádat de betreffende SimHub-PID daadwerkelijk volledig beëindigd is.

Veilige voorkeursflow (gewenst):
1. update volledig downloaden/verifiëren/stagen;
2. updater vraagt SimHub normaal af te sluiten;
3. **maximaal 2 minuten wachten**;
4. als SimHub niet stopt: **niets vervangen, staged behouden, state=`WAITING_FOR_RESTART`, updater stopt netjes**.

**DLL-lock:** de geladen `3SM.EnduranceConnector.dll` is door SimHub in gebruik (File-share lock) terwijl het proces draait. Vervangen mag daarom alleen ná daadwerkelijke process-exit. Extra guard vóór `File.Replace`: nogmaals `Process.GetProcessesByName("SimHubWPF")` controleren (TOCTOU-closing) + exacte PID/starttijd-valideren.

---

## 7. `WAITING_FOR_RESTART` lifecycle — **[RESOLVED]**

**Vooronderzoek lifecycle-hook (keuze A vs B):**
- De publieke SimHub-plugin-API biedt enkel `Init()` en `End(PluginManager)` als lifecycle. `End()` wordt bij **fatsoenlijke shutdown én bij plugin-unload/reload** aangeroepen — er is **geen aparte betrouwbare "proces gaat nu volledig stoppen"-callback** in het IPlugin-contract. Omdat de plugin **in-process** in SimHubWPF.exe draait, is "plugin disabled" vs "SimHub-proces stopt" op `End()`-moment niet uit elkaar te halen.
- Daarom is een helper die in `End()` wordt gestart **niet betrouwbaar gegarandeerd** als clean-exit-only signaal (zou ook bij plugin-reload een 2-min-wachtende spook-helper aanmaken). Dit is geen bewezen single-purpose shutdown-hook.

**Gekozen methode (v1): Fallback B** — expliciet en betrouwbaar:
- **Geen automatische installatie op startup** (verboden: DLL is dan al geladen) en **geen magische auto-resume** die SimHub direct na openen weer probeert te sluiten.
- `WAITING_FOR_RESTART` blijft **persisted staan** in de updater-state store.
- De installatie wordt gehervat bij een **volgende expliciete update/installactie** (gebruiker klikt "installeren"/"update controleren+installeren", of er wordt een nieuwe update-trigger gegeven). Daarbij wordt **maximaal één nieuwe poging** gedaan:
  - updater vraagt SimHub opnieuw normaal af te sluiten;
  - wacht max 2 min;
  - ná bevestigde SimHub-exit: staged opnieuw verifiëren → install met journal/rollback.
  - Als die ene poging opnieuw faalt → `FAILED`; **geen retry-loop**; volgende poging vereist weer expliciete gebruikersactie.
- Deze methode vervangt **nooit** de DLL zolang een SimHub-proces (dat de geladen connector draagt) leeft.

**Optie A (auto-resume bij latere schone shutdown) noteer ik als mogelijke latere verbetering** die een betrouwbare shutdown-only hook vereist welke de huidige SimHub-plugin-API niet biedt; niet in v0.3.9.0.

**Installatie-voorwaarden (altijd):** staged opnieuw verifiëren (hash/versie/length), target check `Sha256(target)==installedHash`, journal volgens sectie 10, géén SimHub-proces met die PID meer actief. Als de user SimHub bewust zelf heeft afgesloten: installeren **zonder** SimHub automatisch te herstarten (behoud `--no-restart` gedrag in die expliciete hervatting).

---

## 8. Staged update lifecycle — **[RESOLVED]**

- Staging-dir: `%LOCALAPPDATA%\3SM\EnduranceConnector\Updates\<version>\` (ook bevat embedded updater exe).
- Levensloop: `download→(verwijder bij fout)→verify→STAGED→[WAITING]→hervat-verify→INSTALL→delete staged na success`.
- **Nooit** een staged-pad direct over de geladen target schrijven; target wordt pas via extern updater na simhub-exit aangeraakt.

**Staging-cleanup-besluit (v1):** behoud altijd:
- de **actieve staged release**;
- **last-known-good/backup** die nodig is voor rollback.

Na een succesvolle installatie mogen **oudere, niet meer benodigde staging-directories automatisch** worden verwijderd.
**Standaard-cleanup-regel:** verwijder staging-dirs die **ouder dan 7 dagen zijn én niet gerefereerd** door de huidige state / een open journal / een actieve rollback-backup.
**Nooit een bestand verwijderen dat nog nodig is voor recovery** (actieve staged, journal-referentie of last-known-good die nog voor rollback kan dienen).

---

## 9. Concurrent updater handling + stale mutex/process recovery

- **Huidig:** mutex `Global\3SM.EnduranceConnector.Updater`; een tweede updater krijgt `Er draait al een 3SM-updater` en stopt. Empirisch op Beest.
- **Gap:** mutex vrijgave is in de json-good-pad netjes, maar bij een **stale/gere-created** mutex of een updater die hanger bleef op een ander pad kan de mutex door de volgende run niet direct verkregen worden → "er draait al een updater" terwijl er feitelijk niets meer draait.
- **Recovery-ontwerp:**
  - de mutex-probe wordt gekoppeld aan een **matching PID/heartbeat** (bijv. het updater-arg `--pid` + proces-leeftijd) i.p.v. alleen mutex-existence;
  - als de mutex geen live matching process meer heeft (proces dood) → stale-mutex vrijmaken/opnieuw claimen en doorgaan;
  - cross-device: mutex-naam blijft machinebreed; binnen één machine mag er maar één install-transactie tegelijk;
  - als een vorige install al `WAITING_FOR_RESTART` persistte, hervatten i.p.v. een tweede install te starten.

---

## 10. Rollback / journal recovery + crash/reboot per fase — **[RESOLVED]**

Bewezen huidig (Beest log + code):
- journal `.3sm-journal` + back-up `.3sm-backup`; `RecoverPreviousTransaction` herstelt of ruimt op;
- "Onderbroken update gevonden; bekende goede back-up wordt hersteld"
- "Beschadigd journal gevonden terwijl de bekende geïnstalleerde DLL intact is; journal wordt opgeruimd"

**Commit-definitie (v1):** een installatie geldt pas als **committed** nadat **alles** waar is:
1. atomic `File.Replace` uitgevoerd;
2. de **nieuwe DLL opnieuw is geverifieerd** (respectievelijk SHA-256 + verwachte versie/hash);
3. verwachte versie/hash klopt;
4. het journal **expliciet als `COMMITTED` is geschreven**.

**Journal is de waarheid.** Bij **onduidelijke/incomplete state na crash** (geen eenduidig COMMITTED-bewijs):
- **rollback naar last-known-good** (back-up herstellen);
- **Liever één onnodige rollback dan een ambigu half-geïnstalleerde toestand.**

Voorgesteld gedrag per crash/reboot-tijdstip:

| fase waarin crash/reboot | gevolg-wens |
|---|---|
| vóór download | staged deels/afwezig → opnieuw uit `IDLE`; geen target-mutatie |
| tijdens download | partial bestand verwijderen → retry bij volgende start; geen install-poging zolang invalid |
| na download vóór verify | staged blijft; bij volgende start re-verify; indien mismatch eruit |
| `VERIFYING` | niets gemuteerd; restart veilig → `FAILED`/`IDLE` |
| `STAGED`, vóór updater-launch | restart veilig; staged blijft; retry volgende start |
| updater gestart, vóór install (SimHub nog aan) | journal niet aangemaakt; SimHub exit hangend → WAITING; restart veilig (target ongemoeid) |
| `INSTALLING` na `File.Replace` maar vóór COMMITTED-journal | journal ≠ COMMITTED → **rollback naar last-known-good** (back-up) |
| `INSTALLING` na vervanging + her-verify + COMMITTED-journal, vóór opruiming | journal levert waarheid; nieuwe DLL is committed; opruimen journal |
| na vervanging vóór herstart | install ok (committed) maar SimHub niet herstart → `SUCCESS` + melding "start handmatig" |
| tijdens herstart | `SUCCESS`; volgende start gebruikt nieuwe DLL (of rollback indien journal niet-gecommit) |

**Exacte momenten waar de huidige DLL WEL/NIET wordt gemuteerd:**
- **NIET** gedurende check, download, verify, staging, WAITING, en elke fase vóór `File.Replace` op target na SimHub-exit.
- **WEL** uitsluitend binnen `Install()` (updater, na SimHub-exit + journal + verifies): `File.Replace(incoming, target, backup, true)` — en dat is exact één atomaire stap.
- `target` wordt bovendien vóór install gecheckt op `Sha256(target)==installedHash`; als gewijzigd → afbreken (voorkomt overschrijven van een vreemde/wijzigende DLL).

---

## 11. Last-known-good

- Back-up `.3sm-backup` van de vorige geïnstalleerde (werkende) DLL blijft behouden na success (Beest: vorige versie beschikbaar).
- Journal + back-up geven samen "last-known-good" herstelbasis.
- Zodra de nieuwe build volledig gevalideerd EN geïnstalleerd is, wordt de vorige als back-up vastgehouden tot een volgende update (geen onmiddellijke delete).
- Bij install-failure: back-up wordt teruggezet (rollback), zodat de werkende connector intact blijft.

---

## 12. Failure codes

Expliciete, stabiele codes (voor persisted `LastUpdateErrorCode` + toekomstige Diagnostics-v1-events):

| code | betekenis |
|---|---|
| `NONE` | geen fout |
| `UPDATE_CHECK_FAILED` | versie-endpoint onbereikbaar / HTTP fout / timeout |
| `UPDATE_METADATA_INVALID` | URL-policy / sha256-format / signature ongeldig |
| `UPDATE_DOWNLOAD_FAILED` | download mislukt/partial/te groot |
| `UPDATE_HASH_FAILED` | staged SHA-256 mismatch |
| `UPDATE_SIGNATURE_FAILED` | release-manifest signature verificatie faalde |
| `UPDATE_INSTALL_FAILED` | install mislukt (na vervanging of vóór) |
| `UPDATE_DLL_LOCKED` | target niet vervangbaar, SimHub nog in gebruik (DLL-lock) |
| `UPDATE_ROLLBACK_USED` | rollback toegepast bij install-fout |
| `UPDATE_TIMEOUT_RESTART` | SimHub-exit timeout; state → `WAITING_FOR_RESTART` (geen FAILED; geen target-mutatie) |
| `UPDATE_WAITING` | staged update wacht op een schone SimHub-exit/install-opportunity (normale persisted staat, geen fout) |
| `UPDATE_EXE_MISSING` | embedded updater-resource ontbreekt / extract faalde |
| `UPDATE_UAC_CANCELLED` | Windows-bevestiging (runas) geannuleerd (1223) |
| `UPDATE_ALREADY_RUNNING` | concurrent updater (mutex) — geprobeerd terwijl ander actief |

---

## 13. Testmatrix — lokale E2E-harness resultaten (2026-08-31)

**Statuslegenda:** ✅ **gedraaid & groen** (lokale E2E-harness op Beest, echte updater.exe + echte processen/Files.Replace/journal/rollback/defaults) · ⏳ gepland/te bouwen · 🔴 geblokkeerd tot publicatie (vereist live manifest)

| # | test | verwacht | status |
|---|---|---|---|
| 1 | **0.3.8.0 6-arg → defect** | 6 args → updater gooit `Verplicht updaterargument ontbreekt: --started-utc-ticks`, exit≠0, target intact | ✅ **T01 PASS**: exit −532462766 (0xE0434352), log `System.ArgumentException … --started-utc-ticks` bij `Program.Required` (regel 479), target-sha = 0.3.8.0 (intact) |
| 2 | **0.3.9.0 10-arg → install** | 10 args + ready-event → handshake, `INSTALLING→SUCCESS`, target=0.3.9.0 | ✅ **T02 PASS**: exit 0, targetver=0.3.9.0, state file `SUCCESS` + `lastUpdateResult:success`, ready-event handshake geaccepteerd |
| 3 | upgrade 0.3.8.0 → 0.3.9.0 (volledige cyclus) | download→verify→stage→install→SUCCESS | ✅ **T02 + T01 dekt contract/upgrade pad**. Echte manifest-live (lease-upgrade) is 🔴 tot publicatie |
| 4 | wrong SHA → reject vóór mutatie | afwijzen; target intact | ⏳ (ValidatePayload-code aanwezig; batch toe te voegen) |
| 5 | wrong RSA signature → reject | `UPDATE_SIGNATURE_FAILED` vóór mutatie | 🔴 RSA-metadata-check zit op de **main-lijn**, NIET in de 0.3.9.0-release (die verifieert SHA-256, géén embedded-RSA-manifest) — zie sectie 2 "feitcorrectie" |
| 6 | wrong byteLength → reject | afwijzen vóór mutatie | ⏳ |
| 7 | wrong fileName/version → reject | `InvalidDataException` bij ValidatePayload/ValidatePaths | ⏳ |
| 8 | HTTP timeout/failure | bestaande DLL intact, update-afgebroken | ⏳ (connector-side DownloadUpdateAsync) |
| 9 | partial/truncated download | reject vóór install | ⏳ |
| 10 | SimHub sluit normaal → install | `INSTALLING→SUCCESS`, back-up behouden | ✅ **T02 dekt dit** (dummy SimHub exit na 1.5s → install + SUCCESS) |
| 11 | SimHub blijft >2 min → **WAITING_FOR_RESTART** | geen DLL-mutatie, staged behouden, netjes stoppen (exit 0) | ✅ **T05 PASS**: na 120.9s → state `WAITING_FOR_RESTART`, `lastUpdateErrorCode:UPDATE_WAITING`, target intact (0.3.8.0), exit 0 |
| 12 | staged blijft valide aanwezig na WAITING | staged-dll + state `pendingStagedDll` behouden | ✅ **T05 PASS** (state file toont `pendingStagedDll`, staged-dir intact) |
| 13 | WAITING → volgende schone exit → max 1 hervatpoging | één poging, geen auto-loop | ⏳ (resume-logica zit in connector InstallAvailableUpdateAsync; E2E volgt) |
| 14 | tweede WAITING-failure → `FAILED`, geen retry-loop | state FAILED; geen loop | ⏳ |
| 15 | crash vóór staging | target intact; next start schoon | ⏳ |
| 16 | crash na staging vóór replace | journal-recovery → rollback naar last-known-good | ⏳ |
| 17 | crash tijdens/na replace vóór re-verify | journal-recovery; geen half-state | ⏳ |
| 18 | crash na re-verify vóór COMMITTED | rollback naar last-known-good | ⏳ |
| 19 | crash na COMMITTED journal | bewezen complete commit herkend; journal opgeruimd | ⏳ |
| 20 | **install-fout ná File.Replace → rollback** | target = vorige werkende DLL, state FAILED | ✅ **T08 PASS**: `--simulate-failure` → IOException na replace, log "Installatiefout; vorige DLL wordt atomair teruggezet", target terug naar 0.3.8.0, state `FAILED`+`UPDATE_INSTALL_FAILED` |
| 21 | **tweede updater-start terwijl eerste bezig** | `Er draait al een 3SM-updater`, geen dubbele mutatie | ✅ **T10 PASS**: tweede start → `System.InvalidOperationException: Er draait al een 3SM-updater` (regel 41), exit≠0 |
| 22 | 10-arg arg-contract in 0.3.9.0 | connector bevat `--started-utc-ticks --installed-sha256 --length --ready-event` | ✅ build + strings op 0.3.9.0-DLL + T02 handshake-bewijs |
| 23 | state-store: missing | safe-defaults IDLE, geen crash | ✅ **T25 PASS** |
| 24 | state-store: corrupt JSON | defaults IDLE + `.corrupt-<ts>` bewaard | ✅ **T26 PASS** |
| 25 | state-store: onbekende schemaVersion | defaults IDLE | ✅ **T27 PASS** |
| 26 | state-store: interrupted atomic write | leftover `.tmp` genegeerd; geldige state gelezen; geen tmp-overblijfsel na succes | ✅ **T28/T28b PASS** |
| 27 | state-store: oude 0.3.8.0 zonder state-file | backward-compat safe-defaults IDLE | ✅ **T29 PASS** |
| 28 | state-store: multiwriter (plugin+updater) | last-writer-wins, geen corruptie, geen crash | ✅ **T19 PASS** (2 threads × 60) |
| 29 | rollback zelf faalt | duidelijke RECOVERY_REQUIRED/FAILED, geen verborgen SUCCESS | ⏳ (RestoreBackupAtomic-waaier) |

> **Bewezen met echte productiecomponenten** (lokale E2E-harness op Beest, geen live endpoint/publicatie): T01 (0.3.8.0-defect-reproductie), T02 (0.3.9.0 10-arg handshake + upgrade + SUCCESS), T05 (WAITING_FOR_RESTART), T08 (rollback), T10 (concurrency-mutex), T19/T25-T28 (state-store). De harness gebruikt de echte `3SM.EnduranceConnector.Updater.exe`, echte dummy `SimHubWPF.exe` (PID/starttijd/pad-identiteit, named ready-event), echte `Global\`-mutex, echte staging/File.Replace/journal/rollback.
>
> **Nog te bouwen/te draaien:** crash/recovery-injectie op de 5 fasen (15-19), fout-pad batch (SHA/byteLength/version), resume-hervatpoging (13/14), rollback-faalmode (29). Deze vereisen alleen extra harness-cases — geen code- of publicatiewijziging.

---

## 14. Backward compat met geïnstalleerde 0.3.8.0 clients

- De release-target (kandidaat 0.3.9.0) gebruikt **hetzelfde contact** als 0.3.8.0 (`simhub-version` endpoint velden + updater-args + embedded updater-pad). Nieuwe only-additionele persisted velden (sectie 5) worden gelezen als afwezig/leeg door oudere 0.3.8.0 → geen crash; oudere clients dragen gewoon de oude mentaliteit.FSM-persist is **backward-compatible**: 0.3.8.0 heeft deze velden niet; bij upgrade naar 0.3.9.0 initieer je `UpdaterState=IDLE` en `RecoveryRequired=false|(indien journal/j back-up aanwezig: eerst recovery)` — een oudere client die een staged update heeft achtergelaten wordt netjes overgenomen.
- Bestaande staging-dirs (Beest: 0.3.3–0.3.7) mogen blijven; 0.3.9.0 behandelt ze als gewone staged voor gewenste versie en ruimt enkel op na success.
- Een reeds-geïnstalleerde 0.3.8.0 kan zonder data-migratie naar 0.3.9.0 updaten (zelfde updater-arg-contract bewezen).
- Signing: handhaaf RSA-metadata-verificatie; 0.3.9.0 moet door de **bestaande 0.3.8.0-validation** als geldige, nieuwere, correct ondertekende release worden herkend (net als 0.3.8.0 door 0.3.7 werd herkend — Beest 0.3.6→0.3.7 bewezen).

---

## 15. Ontwerpkeuzes — **[ALLES RESOLVED]**

Alle open punten zijn voor v1 vastgelegd:

| # | keuze | besluit |
|---|---|---|
| 1 | SimHub-exit-timeout | behoud **max 2 min**; bij overschrijding **niet forceren, niet muteren**, state → `WAITING_FOR_RESTART`, staged behouden, installatie uitgesteld tot volgende start-cyclus. Timeout verruimen is géén oplossing. (sectie 6) |
| 2 | Crash/recovery rond `File.Replace` | journal + **expliciete COMMITTED-status is de waarheid**; install pas committed ná replace + her-verify + correcte versie/hash + COMMITTED-journal. Bij onduidelijke/incomplete state: **rollback naar last-known-good**. Liever één onnodige rollback dan een ambigu half-geïnstalleerde toestand. (sectie 10) |
| 3 | Re-verify vanuit `WAITING_FOR_RESTART` | **max 1 automatische installatiepoging per SimHub-start**; bij opnieuw falen → `FAILED`, geen retry-loop; volgende poging vereist expliciete gebruikersactie/nieuwe update-trigger. (sectie 7) |
| 4 | Staging cleanup | behoud actieve staged release + last-known-good/backup nodig voor rollback. Na succes: oudere niet-benodigde staging-dirs automatisch verwijderen. Standaard: **ouder dan 7 dagen én niet gerefereerd** door state/journal/rollback. Nooit een recovery-nodig bestand verwijderen. (sectie 8) |
| 5 | Updater-state | blijft **primair lokaal/persistent**. Diagnostics v1 mag het later alleen **read-only** uitlezen/reporteren; nooit update starten, state muteren, retry triggeren of installatie beïnvloeden. (sectie 5) |

---

## 16. Releasebesluit — **[RESOLVED]**

**Definitief optie A:**

- **0.3.9.0** — uitsluitend **updater-hardening**. **Geen** Diagnostics backend/Edge/DB in deze release.
- **0.3.10.0** — Remote Diagnostics v1 als aparte feature-release, pas **nadat 0.3.9.0 stabiel** is.

Reden: updater-betrouwbaarheid is releasekritisch en moet geïsoleerd getest worden; Diagnostics introduceert nieuwe DB-, Edge-, security- en retention-oppervlakken en hoort niet in dezelfde release.

De bestaande 0.3.8.0 en M4 blijven ongemoeid; er wordt nu nog niets gebouwd.

---

## 17. CAT-PC-crash status — **[UNCONFIRMED]**

- **Blijft expliciet UNCONFIRMED.**
- De algemene updater-hardening mag **wel** ontworpen worden op basis van bewezen zwakke punten (sectie 2/empirie), maar er wordt **nergens geschreven** dat deze wijzigingen dé bewezen CAT-PC-fix zijn.
- **Vóór definitief bouwen/publiceren van 0.3.9.0:** indien mogelijk nog de echte CAT-PC `%LOCALAPPDATA%\3SM\EnduranceConnector\Updater\updater.log` + relevante `SimHub.log` rond de crash bekijken.
- Als die logs **niet meer beschikbaar** zijn: dat rapporteren, en de updater-hardening behandelen als **preventieve robustness-release** (geen bewezen root-cause-fix).
- Dit onderzoek kan later **parallel** lopen zodra CAT-PC beschikbaar is.
