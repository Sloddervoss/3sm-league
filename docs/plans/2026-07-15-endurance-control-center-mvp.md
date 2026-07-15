# 3Stripe Endurance Control Center MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Bouw een volledig lokale, klikbare en persistent werkende Endurance Control Center-MVP binnen de bestaande 3SM React-app, zonder productie-Supabase, OAuth of Discordwrites.

**Architecture:** De feature leeft geïsoleerd onder `src/features/endurance/` en gebruikt een getypeerde repository/context-adapter met één namespaced localStorage-document. Alle tijden worden als UTC ISO opgeslagen en als Europe/Amsterdam weergegeven. De UI gebruikt dezelfde Navbar/Footer en 3SM-stijl; later kan de local repository door een Supabase/RLS-adapter worden vervangen zonder schermen of domeinlogica te herschrijven.

**Tech Stack:** React 18, TypeScript, React Router 6, Tailwind, Lucide, Vitest, native HTML drag/drop en pointer-events; geen nieuwe runtime dependency.

---

### Task 1: Isoleer branch, plan en devveiligheid

**Objective:** Garandeer dat geen productiecheckout, database of bot wordt geraakt.

**Files:**
- Create: `docs/plans/2026-07-15-endurance-control-center-mvp.md`
- Create: `src/features/endurance/core/environment.ts`
- Test: `src/test/enduranceDevIsolation.test.ts`

**Steps:**
1. Werk uitsluitend in `/home/hermes/projects/3sm-league-endurance` op `feat/endurance-control-center`.
2. Definieer `ENDURANCE_STORAGE_KEY = "3sm:endurance:dev:v1"` en een disabled production adapter.
3. Voeg broncontracttest toe: geen `supabase.from`, `supabase.functions`, fetch naar 3SM API, Discordwrite of Storage-upload onder `src/features/endurance/`.
4. Verifieer met gerichte Vitest-test.

### Task 2: Domeintypes, seed en pure regels

**Objective:** Leg events, rollen, privacy, pace, teams, stints, versies en audit als testbaar domein vast.

**Files:**
- Create: `src/features/endurance/core/types.ts`
- Create: `src/features/endurance/core/seed.ts`
- Create: `src/features/endurance/core/selectors.ts`
- Test: `src/features/endurance/core/selectors.test.ts`

**Steps:**
1. Type eventvisibility (`open|invite_only|hidden`) en rollen (`endurance_admin|race_manager|team_manager|driver|reserve`).
2. Type registrations, availability, pace entries, teams/members, stints, confirmations, versions, notifications en audit records.
3. Seed één zesuursrace met drie startslots en bruikbare lokale persona’s/data.
4. Schrijf pure access checks: kaart zichtbaar, privéworkspace zichtbaar, event beheren, eigen team beheren.
5. Schrijf pace-score/betrouwbaarheid, overlap/dekking, rust/dubbelplanning en availability-waarschuwingen.
6. Test privacy, racegrenzen, UTC/DST-weergave-input, pacebetrouwbaarheid en warnings.

### Task 3: Lokale repository, reducer en audit

**Objective:** Maak iedere UI-mutatie persistent, versieerbaar en herstelbaar.

**Files:**
- Create: `src/features/endurance/core/EnduranceStore.tsx`
- Create: `src/features/endurance/core/actions.ts`
- Test: `src/features/endurance/core/actions.test.ts`

**Steps:**
1. Laad veilig uit localStorage; valideer schemaVersion; val terug op seed bij corruptie.
2. Implementeer immutable actions voor event, registratie, beschikbaarheid, pace, teams, stints, confirmations, live adjustments en notifications.
3. Voeg bij iedere belangrijke action automatisch audit old/new snapshot toe.
4. Implementeer planning snapshot/publish/restore zonder originele tijden te overschrijven.
5. Voeg devpersona-wissel en reset toe.
6. Test roundtrip, corruptieherstel, audit, versieherstel en immutable original schedule.

### Task 4: Endurance shell, kalender en beheer

**Objective:** Lever de navigatie, aankomende races, mijn races en handmatig eventbeheer.

**Files:**
- Create: `src/features/endurance/shell/EndurancePage.tsx`
- Create: `src/features/endurance/shell/EnduranceNav.tsx`
- Create: `src/features/endurance/calendar/UpcomingRaces.tsx`
- Create: `src/features/endurance/calendar/MyRaces.tsx`
- Create: `src/features/endurance/calendar/EventManager.tsx`
- Create: `src/features/endurance/shared/DevPersonaBar.tsx`

**Steps:**
1. Bouw pagina met Navbar, Footer en duidelijke Endurance-header.
2. Toon alleen eventkaarten toegestaan door visibility/invite/registration/manager.
3. Laat beheerder events handmatig aanmaken, kopiëren en slot/klasse/auto vastleggen.
4. Bouw werkende tabnavigatie: Aankomende races, Mijn races, Racebeheer.
5. Geen dode tabs: alleen gebouwde schermen zichtbaar.

### Task 5: Registratie en privé-raceworkspace

**Objective:** Maak aanmelden werkend en handhaaf privétoegang in de clientadapter.

**Files:**
- Create: `src/features/endurance/registration/RegistrationForm.tsx`
- Create: `src/features/endurance/workspace/RaceWorkspace.tsx`
- Create: `src/features/endurance/workspace/OverviewPanel.tsx`
- Test: `src/test/enduranceAccessFlow.test.tsx`

**Steps:**
1. Bouw alle MVP-aanmeldvelden en statussen met slot-/klasse-/autokeuze.
2. Geef private workspace pas na registratie/invite/managerrol.
3. Toon status, team, deadline, volgende actie en mededeling.
4. Laat manager participantstatus wijzigen/verwijderen; toegang vervalt conform regels.
5. Test open/invite/hidden en participant removal.

### Task 6: Beschikbaarheid en pace

**Objective:** Maak multi-block availability en betrouwbare pace-invoer/upload bruikbaar.

**Files:**
- Create: `src/features/endurance/availability/AvailabilityPanel.tsx`
- Create: `src/features/endurance/availability/AvailabilityTimeline.tsx`
- Create: `src/features/endurance/pace/PacePanel.tsx`
- Create: `src/features/endurance/pace/csv.ts`
- Test: `src/features/endurance/pace/csv.test.ts`

**Steps:**
1. Toon racewindow inclusief briefing/uitloop en Nederlandse tijdzone.
2. Laat meerdere UTC-blokken toevoegen/wijzigen/verwijderen met vijf availabilitytypes.
3. Overlay blokken visueel op tijdlijn en bied mobiel formulieralternatief.
4. Laat handmatige pace-invoer en CSV-import toe; toon gemiddelde, mediaan, best-5, consistentie en betrouwbaarheid.
5. CSV-fouten moeten concreet zijn en geen gedeeltelijke write veroorzaken.

### Task 7: Team Builder

**Objective:** Maak automatische voorstellen en handmatige drag/drop tussen auto’s werkend.

**Files:**
- Create: `src/features/endurance/teams/TeamBuilder.tsx`
- Create: `src/features/endurance/teams/teamProposal.ts`
- Test: `src/features/endurance/teams/teamProposal.test.ts`

**Steps:**
1. Maak teams/auto’s met klasse, nummer, manager en coureurs.
2. Implementeer pacegroepen en gebalanceerde teams als deterministische pure voorstellen.
3. Gebruik native drag/drop voor coureurs tussen unassigned en teams.
4. Toon pace, dekking en waarschuwingen per team.
5. Respecteer manager scope: teammanager alleen eigen auto, race/admin alle teams.

### Task 8: Stintplanner, bevestiging en versies

**Objective:** Lever een werkende horizontale planning met drag/drop, resize en warnings.

**Files:**
- Create: `src/features/endurance/stints/StintPlanner.tsx`
- Create: `src/features/endurance/stints/StintTimeline.tsx`
- Create: `src/features/endurance/stints/stintGenerator.ts`
- Test: `src/features/endurance/stints/stintGenerator.test.ts`

**Steps:**
1. Genereer voorstel vanuit racewindow, tankduur, availability en teamleden.
2. Sleep coureur/stint naar tijdpositie; snap op 5/10/15 minuten of tankduur.
3. Resize stintduur, wissel/verwijder/kopieer en blokkeer dubbele planning.
4. Overlay availability en toon harde/zachte warning.
5. Publiceer snapshot; coureurs bevestigen of vragen wijziging; manager ziet open confirmations.
6. Herstel vorige versie zonder auditverlies.

### Task 9: Race Control en lokale notificaties

**Objective:** Maak de planner tijdens een echte race handmatig bruikbaar.

**Files:**
- Create: `src/features/endurance/race-control/RaceControlPanel.tsx`
- Create: `src/features/endurance/notifications/NotificationCenter.tsx`
- Create: `src/features/endurance/notifications/discordOutbox.ts`
- Test: `src/features/endurance/notifications/discordOutbox.test.ts`

**Steps:**
1. Toon huidige, volgende en twee opvolgende coureurs plus planningdelta.
2. Implementeer +5/+10/custom delay, repairtijd, vroeg klaar, verlengen en vervangen.
3. Bewaar originalStart/originalEnd en wijzig alleen actualStart/actualEnd voor live updates.
4. Maak in-app notificaties en disabled Discord-outboxpayloads met alleen private deeplink, zonder gevoelige content.
5. Geef mobiel een compacte next-driver/confirm-weergave.

### Task 10: Route, navbar, footer en vertaling

**Objective:** Integreer Endurance herkenbaar in de lokale 3SM-shell.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/components/Footer.tsx`
- Modify: `src/i18n/translations.ts`
- Test: `src/test/enduranceIntegration.test.ts`

**Steps:**
1. Lazy route `/endurance/*` naar `EndurancePage`.
2. Voeg Endurance aan desktop/mobile navbar en footer toe.
3. Voeg exacte EN-translations voor zichtbare NL-copy toe.
4. Test route/import/nav/footer en dev-isolation.

### Task 11: Integratie, accessibility en handoff

**Objective:** Lever een aantoonbaar werkende lokale MVP voor review.

**Files:**
- Modify as required only under endurance feature/tests/integration files.

**Steps:**
1. Run gerichte tests, volledige Vitest, TypeScript, ESLint, build en `git diff --check`.
2. Start Vite op `0.0.0.0` met een vaste vrije poort.
3. Test als admin: event maken → coureur indelen → stints genereren → publiceren → Race Control delay.
4. Test als coureur: aanmelden → availability → pace → stint bevestigen.
5. Test als niet-aangemeld lid: geen private teams/pace/stints/files.
6. Test mobiel op aanmelden, availability, stints, bevestigen en volgende coureur.
7. Controleer console, localStorage-reset en databehoud na reload.
8. Rapporteer LAN-URL, branch/worktree, tests en expliciet: lokaal, niet gepusht, niet live.

## Production promotion gate (niet uitvoeren in deze MVP)

1. Forward-only Supabase migrations met per-event RLS en SECURITY DEFINER helpers waar nodig.
2. `EnduranceRepository` Supabase-implementatie; UI blijft ongewijzigd.
3. Storage buckets/policies voor event/teamfiles; geen wachtwoorden in publieke metadata.
4. Server-side role grants voor endurance_admin/race_manager/team_manager.
5. Realtime subscriptions per geautoriseerde event/teamchannel.
6. Discord outbox via bestaande 3SM-botpipeline met private deeplinks.
7. Staging restore + role-based HTTP tests voor anon, member, invitee, removed driver, reserve, teammanager, racemanager en enduranceadmin.
8. Alleen na expliciete goedkeuring: merge naar main, migratie+site als gecontroleerde gecombineerde release.
