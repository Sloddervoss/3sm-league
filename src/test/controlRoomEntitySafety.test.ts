import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Control Room entity context and destructive safety", () => {
  const workspace = read("src/pages/AdminWorkspacePrototype.tsx");
  const seasonWorkspace = read("src/features/control-room/season/SeasonRaceWorkspace.tsx");
  const deleteConfirmation = read("src/features/control-room/season/RaceDeleteConfirmation.tsx");
  const editor = read("src/features/control-room/season/SeasonEditor.tsx");
  const carLocks = read("src/features/control-room/season/SeasonCarLockManager.tsx");

  it("keeps typed season action context through the router", () => {
    expect(workspace).toContain("const [seasonAction, setSeasonAction]");
    expect(workspace).toContain("const openSeasonAction = (action: SeasonWorkspaceAction)");
    expect(workspace).toContain("seasonId: action.context.seasonId, raceId: action.context.raceId");
    expect(seasonWorkspace).toContain("initialSeasonId?: string");
    expect(workspace).toContain("initialSeasonId={seasonAction?.context.seasonId}");
  });

  it("routes race deletion and registration management to distinct contextual panels", () => {
    expect(workspace).toContain('case "registration-manager": return <SeasonRaceWorkspace initialTab="registrations"');
    expect(workspace).toContain('case "race-delete-confirm":');
    expect(workspace).toContain("<RaceDeleteConfirmation target={{ raceId: seasonAction.context.raceId");
    expect(workspace).not.toContain('case "race-delete-confirm":\n      case "registration-manager":\n      case "lobby-manager":');
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
});
