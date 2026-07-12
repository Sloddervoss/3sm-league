export type OverviewNavigation =
  | {
    destination: "community";
    focus: { kind: "pending-team-requests"; requestId?: string };
  }
  | {
    destination: "communications";
    focus: { kind: "unsent-announcements"; announcementId?: string };
  }
  | {
    destination: "season";
    focus: { kind: "race"; raceId: string; leagueId: string | null };
  }
  | {
    destination: "season";
    focus: { kind: "registrations" | "car-locks"; raceId: string; leagueId: string | null };
  };

export type OverviewModuleProps = {
  /** The Control Room shell owns routing and entity-specific panel opening. */
  onNavigate?: (navigation: OverviewNavigation) => void;
};
