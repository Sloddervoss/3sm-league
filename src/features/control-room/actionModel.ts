export type ControlRoomRole = "editor" | "moderator" | "admin" | "super_admin";

export type ControlRoomPanelId =
  | "season-form"
  | "season-delete-confirm"
  | "race-form"
  | "race-delete-confirm"
  | "registration-manager"
  | "car-lock-confirm"
  | "lobby-manager"
  | "solo-race-form"
  | "solo-race-delete-confirm"
  | "result-import-wizard"
  | "team-request-review"
  | "team-form"
  | "team-delete-confirm"
  | "editor-role-manager"
  | "privileged-role-manager"
  | "driver-delete-confirm"
  | "announcement-composer"
  | "points-manager"
  | "track-sync-confirm"
  | "track-run-log"
  | "track-export"
  | "steward-inbox"
  | "news-editor";

export type ControlRoomActionId =
  | "season-create"
  | "season-edit"
  | "season-delete"
  | "race-create"
  | "race-edit"
  | "race-delete"
  | "season-registration"
  | "car-lock"
  | "lobby-edit"
  | "solo-race-create"
  | "solo-race-edit"
  | "solo-race-delete"
  | "result-import"
  | "team-request-review"
  | "team-create"
  | "team-edit"
  | "team-delete"
  | "driver-editor-role"
  | "driver-privileged-roles"
  | "driver-delete"
  | "announcement-compose"
  | "points-config"
  | "track-sync"
  | "track-log"
  | "track-export"
  | "steward-inbox"
  | "news-editor";

export type ControlRoomActionMeta = {
  title: string;
  impact: "read" | "write" | "destructive";
  /** Independent site roles allowed to open the action; this is not a hierarchy. */
  allowedRoles: ControlRoomRole[];
  panel: ControlRoomPanelId;
};

export const CONTROL_ROOM_ACTIONS: Record<ControlRoomActionId, ControlRoomActionMeta> = {
  "season-create": { title: "Nieuw seizoen", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "season-form" },
  "season-edit": { title: "Seizoen bewerken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "season-form" },
  "season-delete": { title: "Seizoen verwijderen", impact: "destructive", allowedRoles: ["admin", "super_admin"], panel: "season-delete-confirm" },
  "race-create": { title: "Nieuwe race", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "race-form" },
  "race-edit": { title: "Race bewerken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "race-form" },
  "race-delete": { title: "Race verwijderen", impact: "destructive", allowedRoles: ["admin", "super_admin"], panel: "race-delete-confirm" },
  "season-registration": { title: "Inschrijvingen beheren", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "registration-manager" },
  "car-lock": { title: "Auto-keuze locken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "car-lock-confirm" },
  "lobby-edit": { title: "Lobby beheren", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "lobby-manager" },
  "solo-race-create": { title: "Nieuwe losse race", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "solo-race-form" },
  "solo-race-edit": { title: "Losse race bewerken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "solo-race-form" },
  "solo-race-delete": { title: "Losse race verwijderen", impact: "destructive", allowedRoles: ["admin", "super_admin"], panel: "solo-race-delete-confirm" },
  "result-import": { title: "Resultaten importeren", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "result-import-wizard" },
  "team-request-review": { title: "Team-aanvraag beoordelen", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "team-request-review" },
  "team-create": { title: "Team aanmaken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "team-form" },
  "team-edit": { title: "Team bewerken", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "team-form" },
  "team-delete": { title: "Team verwijderen", impact: "destructive", allowedRoles: ["admin", "super_admin"], panel: "team-delete-confirm" },
  "driver-editor-role": { title: "Editorrol beheren", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "editor-role-manager" },
  "driver-privileged-roles": { title: "Admin- en Stewardrollen beheren", impact: "write", allowedRoles: ["super_admin"], panel: "privileged-role-manager" },
  "driver-delete": { title: "Coureur verwijderen", impact: "destructive", allowedRoles: ["admin", "super_admin"], panel: "driver-delete-confirm" },
  "announcement-compose": { title: "Discord-aankondiging", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "announcement-composer" },
  "points-config": { title: "Puntensysteem", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "points-manager" },
  "track-sync": { title: "Track Intelligence synchroniseren", impact: "write", allowedRoles: ["admin", "super_admin"], panel: "track-sync-confirm" },
  "track-log": { title: "Track Intelligence synclog", impact: "read", allowedRoles: ["admin", "super_admin"], panel: "track-run-log" },
  "track-export": { title: "Track Intelligence export", impact: "read", allowedRoles: ["admin", "super_admin"], panel: "track-export" },
  "steward-inbox": { title: "Stewarding", impact: "write", allowedRoles: ["moderator", "admin", "super_admin"], panel: "steward-inbox" },
  "news-editor": { title: "Nieuwsredactie", impact: "write", allowedRoles: ["editor", "admin", "super_admin"], panel: "news-editor" },
};
