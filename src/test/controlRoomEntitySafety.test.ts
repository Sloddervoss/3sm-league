import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Control Room entity context and destructive safety", () => {
  const workspace = read("src/pages/AdminWorkspacePrototype.tsx");
  const seasonWorkspace = read("src/features/control-room/season/SeasonRaceWorkspace.tsx");
  const deleteConfirmation = read("src/features/control-room/season/RaceDeleteConfirmation.tsx");
  const editor = read("src/features/control-room/season/SeasonEditor.tsx");
  const actionForm = read("src/features/control-room/season/SeasonRaceActionForm.tsx");
  const carLocks = read("src/features/control-room/season/SeasonCarLockManager.tsx");
  const editorial = read("src/features/control-room/editorial/EditorialWorkspace.tsx");
  const newsEditor = read("src/pages/NewsEditorPage.tsx");
  const profile = read("src/pages/ProfilePage.tsx");

  it("keeps typed season action context through the router", () => {
    expect(workspace).toContain("const [seasonAction, setSeasonAction]");
    expect(workspace).toContain("const openSeasonAction = (action: SeasonWorkspaceAction)");
    expect(workspace).toContain("setSeasonAction(action)");
    expect(workspace).toContain("<SeasonRaceActionForm action={seasonAction}");
    expect(seasonWorkspace).toContain("initialSeasonId?: string");
    expect(workspace).toContain("initialSeasonId={seasonAction?.context.seasonId}");
  });

  it("routes race deletion and registration management to distinct contextual panels", () => {
    expect(workspace).toContain('case "registration-manager": return <SeasonRaceWorkspace initialTab="registrations"');
    expect(workspace).toContain('case "race-delete-confirm":');
    expect(workspace).toContain("<RaceDeleteConfirmation target={{ raceId: seasonAction.context.raceId");
    expect(workspace).not.toContain('case "race-delete-confirm":\n      case "registration-manager":\n      case "lobby-manager":');
  });

  it("uses a native action-specific form instead of the legacy editor for season and race drawers", () => {
    expect(workspace).toContain('import { SeasonRaceActionForm }');
    expect(workspace).toContain("<SeasonRaceActionForm action={seasonAction}");
    expect(workspace).not.toContain('import { SeasonEditor }');
    expect(actionForm).toContain("const isSeasonCreate");
    expect(actionForm).toContain("const isLobbyEdit");
    expect(actionForm).toContain("if (isSeasonCreate) createSeason.mutate()");
    expect(actionForm).toContain("slots.map((slot, index) => slotPayload(slot, league.id, index + 1))");
    expect(actionForm).toContain("race_date: amsToUTC(`${slot.date}T${slot.time}`)");
    expect(actionForm).toContain("const canWrite = Boolean(user && (isAdmin || isSuperAdmin))");
    expect(actionForm).toContain("Alleen lobbygegevens");
    expect(actionForm).toContain("Seizoensdefaults");
    expect(actionForm).toContain("Pas toe op alle rondes");
    expect(actionForm).toContain("Afwijkende sessie- of circuitcondities voor deze ronde");
    expect(actionForm).toContain("weather");
    expect(actionForm).toContain("setup");
    expect(actionForm).toContain("Selecteer eerst een seizoen voor deze race.");
    expect(seasonWorkspace).toContain('action.id === "race-create" && !action.context.seasonId');
  });

  it("keeps standalone race creation separate from the selected season", () => {
    expect(seasonWorkspace).toContain('activeTab === "solo"');
    expect(seasonWorkspace).toContain('actionButton("Nieuwe losse race", { id: "solo-race-create", impact: "write", context: { tab: "solo" } })');
    expect(actionForm).toContain('const targetLeagueId = isSoloCreate ? null : action.context.seasonId || targetRace?.league_id || null');
    expect(actionForm).toContain("slotPayload(slot, targetLeagueId");
  });

  it("requires an explicit, pending-protected delete confirmation and leaves cancel inert", () => {
    expect(workspace).toContain("onCancel={() => setActiveAction(null)}");
    expect(deleteConfirmation).toContain("onClick={onCancel}");
    expect(deleteConfirmation).toContain("disabled={deleteRace.isPending}");
    expect(deleteConfirmation).toContain("onClick={() => deleteRace.mutate()}");
    expect(editor).toContain("window.confirm(`${label} verwijderen?");
    expect(editor).toContain("if (window.confirm");
  });

  it("previews exact same-league race-registration impacts before bulk exceptions", () => {
    expect(carLocks).toContain("matchingRaceRegistrationChanges");
    expect(carLocks).toContain("leagueRaceIds.has(row.race_id)");
    expect(carLocks).toContain("affectedRaceRegistrations");
    expect(carLocks).toContain("Impact op losse-race inschrijvingen:");
    expect(carLocks).toContain('.in("id", affected.map((row) => row.id))');
    expect(carLocks).not.toContain("race_registrations are intentionally not read or written here");
  });

  it("preserves unsaved drawer forms across parent rerenders and query refetches", () => {
    expect(workspace).toContain("{renderActionDrawer()}");
    expect(workspace).toContain("{renderLiveActionContent()}");
    expect(workspace).not.toContain("<ActionDrawer />");
    expect(workspace).not.toContain("<LiveActionContent />");
    expect(actionForm).toContain("hydratedLeagueRef");
    expect(actionForm).toContain("hydratedRaceRef");
    expect(editorial).toContain("hydratedSelectionRef");
    expect(newsEditor).toContain("hydratedPostRef");
    expect(profile).toContain("hydratedProfileRef");
  });
});
