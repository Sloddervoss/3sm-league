import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [] }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "admin-test" },
    isAdmin: true,
    isSuperAdmin: false,
    loading: false,
    rolesLoading: false,
  }),
}));

vi.mock("@/components/Navbar", () => ({ default: () => <div>Navbar</div> }));
vi.mock("@/components/Footer", () => ({ default: () => <div>Footer</div> }));
vi.mock("@/features/control-room/overview", () => ({ OverviewModule: () => <div>Overview</div> }));
vi.mock("@/features/control-room/results/ResultImportWorkspace", () => ({ ResultImportWorkspace: () => <div>Import</div> }));
vi.mock("@/features/control-room/community/CommunityModule", () => ({ CommunityModule: () => <div>Community</div> }));
vi.mock("@/features/control-room/communications/CommunicationsModule", () => ({ CommunicationsModule: () => <div>Communications</div> }));
vi.mock("@/features/control-room/settings/PointsManager", () => ({ PointsManager: () => <div>Points</div> }));
vi.mock("@/features/control-room/season/SeasonCarLockManager", () => ({ SeasonCarLockManager: () => <div>Locks</div> }));
vi.mock("@/features/control-room/season/RaceDeleteConfirmation", () => ({ RaceDeleteConfirmation: () => <div>Delete</div> }));
vi.mock("@/features/control-room/track", () => ({ TrackIntelligenceModule: () => <div>Tracks</div> }));
vi.mock("@/features/control-room/editorial", () => ({ EditorialWorkspace: () => <div>Editorial</div> }));
vi.mock("@/features/control-room/roles/RolesRightsModule", () => ({ RolesRightsModule: () => <div>Roles</div> }));
vi.mock("@/features/control-room/stewarding", () => ({ StewardingWorkspace: () => <div>Stewarding</div> }));

vi.mock("@/features/control-room/season/SeasonRaceWorkspace", () => ({
  SeasonRaceWorkspace: ({ onAction }: { onAction?: (action: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onAction?.({
        id: "race-create",
        impact: "write",
        allowedRoles: ["admin", "super_admin"],
        panel: "race-form",
        context: { seasonId: "season-test", tab: "calendar" },
      })}
    >
      Open raceformulier
    </button>
  ),
}));

vi.mock("@/features/control-room/season/SeasonRaceActionForm", () => ({
  SeasonRaceActionForm: () => {
    const [name, setName] = useState("");
    return <input aria-label="Test racenaam" value={name} onChange={(event) => setName(event.target.value)} />;
  },
}));

import AdminWorkspacePrototype from "@/pages/AdminWorkspacePrototype";

describe("Control Room form draft persistence", () => {
  it("keeps a race draft mounted when unrelated parent state rerenders", () => {
    render(<AdminWorkspacePrototype />);

    fireEvent.click(screen.getByText("Races"));
    fireEvent.click(screen.getByText("Open raceformulier"));

    const raceName = screen.getByLabelText("Test racenaam") as HTMLInputElement;
    fireEvent.change(raceName, { target: { value: "Concept Race Spa" } });
    expect(raceName.value).toBe("Concept Race Spa");

    fireEvent.click(screen.getByLabelText("Open menu"));

    expect((screen.getByLabelText("Test racenaam") as HTMLInputElement).value).toBe("Concept Race Spa");
  });
});
