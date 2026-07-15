export const ENDURANCE_SCHEMA_VERSION = 2;
export const ENDURANCE_STORAGE_KEY = "3sm:endurance:dev:v2";

export type EnduranceRole = "endurance_admin" | "race_manager" | "team_manager" | "driver" | "reserve";
export type EventVisibility = "open" | "invite_only" | "hidden";
export type EventStatus = "draft" | "registration_open" | "registration_closed" | "planning" | "live" | "completed";
export type RegistrationStatus = "interest" | "provisional" | "confirmed" | "reserve" | "rejected" | "withdrawn";
export type AvailabilityType = "available" | "preferred" | "avoid" | "unavailable" | "uncertain";
export type StintStatus = "draft" | "confirmed" | "ready" | "in_car" | "completed" | "expired" | "replaced";
export type ConfirmationStatus = "unseen" | "viewed" | "accepted" | "change_requested";

export interface EndurancePersona {
  id: string;
  name: string;
  role: EnduranceRole;
  timezone: string;
}

export interface EventSlot { id: string; startAt: string; label: string }
export interface EventCar { id: string; className: string; carName: string; maxDrivers: number }

export interface EnduranceEvent {
  id: string;
  name: string;
  circuit: string;
  configuration: string;
  imageUrl?: string;
  startAt: string;
  endAt: string;
  briefingStartAt: string;
  expectedEndAt: string;
  registrationDeadline: string;
  slots: EventSlot[];
  cars: EventCar[];
  maxDriversPerCar: number;
  visibility: EventVisibility;
  status: EventStatus;
  source: "manual" | "calendar_import" | "copied";
  invitedUserIds: string[];
  managerIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EnduranceRegistration {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
  classPreference: string;
  availableCars: string[];
  preferredCar: string;
  slotId: string;
  maxStints: number;
  nightDriving: boolean;
  willingToStart: boolean;
  willingToFinish: boolean;
  notes: string;
  registeredAt: string;
}

export interface AvailabilityBlock {
  id: string;
  eventId: string;
  userId: string;
  startAt: string;
  endAt: string;
  type: AvailabilityType;
  note: string;
}

export interface PaceEntry {
  id: string;
  eventId: string;
  userId: string;
  circuit: string;
  configuration: string;
  car: string;
  conditions: "dry" | "wet";
  averageLapSeconds: number;
  medianLapSeconds: number;
  bestLapSeconds: number;
  bestFiveAverageSeconds: number;
  consistencySeconds: number;
  validLaps: number;
  incidents: number;
  averageStintMinutes: number;
  recordedAt: string;
  source: "manual" | "csv" | "result_import";
  notes: string;
}

export interface EnduranceTeam {
  id: string;
  eventId: string;
  name: string;
  carId: string;
  carNumber: string;
  managerId: string;
  livery: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: "manager" | "driver" | "reserve";
}

export interface EnduranceStint {
  id: string;
  eventId: string;
  teamId: string;
  driverId: string;
  originalStartAt: string;
  originalEndAt: string;
  actualStartAt: string;
  actualEndAt: string;
  expectedLaps: number;
  fuelLitres: number;
  tyreChange: boolean;
  doubleStint: boolean;
  notes: string;
  status: StintStatus;
}

export interface StintConfirmation {
  id: string;
  eventId: string;
  versionId: string;
  userId: string;
  status: ConfirmationStatus;
  note: string;
  updatedAt: string;
}

export interface PlanningVersion {
  id: string;
  eventId: string;
  teamId: string;
  label: string;
  createdAt: string;
  createdBy: string;
  published: boolean;
  stints: EnduranceStint[];
}

export interface EnduranceNotification {
  id: string;
  userId: string;
  eventId: string;
  type: "invitation" | "deadline" | "availability_missing" | "team_assigned" | "plan_published" | "plan_changed" | "confirmation_needed" | "stint_soon";
  title: string;
  message: string;
  privatePath: string;
  read: boolean;
  createdAt: string;
  discordStatus: "disabled" | "queued" | "sent";
}

export interface AuditRecord {
  id: string;
  eventId: string | null;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
}

export interface EnduranceState {
  schemaVersion: number;
  activePersonaId: string;
  personas: EndurancePersona[];
  events: EnduranceEvent[];
  registrations: EnduranceRegistration[];
  availability: AvailabilityBlock[];
  paceEntries: PaceEntry[];
  teams: EnduranceTeam[];
  teamMembers: TeamMember[];
  stints: EnduranceStint[];
  planningVersions: PlanningVersion[];
  confirmations: StintConfirmation[];
  notifications: EnduranceNotification[];
  auditLog: AuditRecord[];
}
