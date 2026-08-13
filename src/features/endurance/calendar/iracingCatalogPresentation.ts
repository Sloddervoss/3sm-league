export type CatalogTimingStatus = "full" | "partial" | "race_only";

/** Eén officieel deelnemende auto uit het `cars` JSON-veld van een event. */
export type IRacingCatalogCar = {
  id?: string;
  sourceKey?: string;
  name: string;
  imageUrl?: string | null;
  officialClassId?: string | null;
  localCarId?: string | null;
};

export type IRacingSlotInterestSummaryRow = {
  catalog_event_id: string;
  catalog_slot_id: string;
  interested_count: number;
  is_current_user_interested: boolean;
};

export type IRacingSlotInterestMember = {
  catalog_slot_id: string;
  user_id: string;
  iracing_name: string | null;
  display_name: string | null;
};

export type IRacingEventInterestSummaryRow = {
  catalog_event_id: string;
  interested_count: number;
  is_current_user_interested: boolean;
};

export type IRacingManagerInterestOverviewRow = {
  catalog_event_id: string;
  interested_count: number;
};

export type IRacingCatalogSlot = {
  id: string;
  catalog_event_id: string;
  source_slot_key: string;
  session_start_at: string;
  practice_start_at: string | null;
  practice_duration_minutes: number | null;
  qualifying_start_at: string | null;
  qualifying_duration_minutes: number | null;
  transition_duration_minutes: number | null;
  estimated_race_start_at: string | null;
  race_duration_minutes: number | null;
  race_lap_limit: number | null;
  session_duration_minutes: number | null;
  session_timing_status: CatalogTimingStatus;
  label: string | null;
  active: boolean;
};

export type IRacingCatalogEvent = {
  id: string;
  source_key: string;
  name: string;
  year: number;
  circuit: string | null;
  configuration: string | null;
  event_start_date: string | null;
  event_end_date: string | null;
  duration_minutes: number | null;
  class_ids: string[];
  local_class_ids: string[];
  /** Gekoppelde lokale 3SM-auto-ID's om de activatiegate te bepalen. */
  local_car_ids: string[];
  /** Officiële deelnemende auto's uit het `cars` JSONB-veld. */
  cars: IRacingCatalogCar[];
  team_event: boolean;
  official_url: string | null;
  poster_url: string | null;
  availability_status: "exact_slots" | "date_only" | "tbd";
  source_updated_at: string | null;
  last_seen_at: string;
  active: boolean;
  slots: IRacingCatalogSlot[];
  selectedEventId: string | null;
  selectedSlotId: string | null;
};

const instantFormatter = (language: "nl" | "en", zone: "utc" | "amsterdam") => new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: zone === "utc" ? "UTC" : "Europe/Amsterdam",
  timeZoneName: "short",
});

export const formatCatalogInstant = (iso: string, zone: "utc" | "amsterdam", language: "nl" | "en" = "nl") =>
  instantFormatter(language, zone).format(new Date(iso));

/** Lokale kalenderdag voor event-zichtbaarheid; niet afleiden uit UTC. */
export const catalogTodayAmsterdam = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Amsterdam",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const phaseRange = (startAt: string | null, minutes: number | null, language: "nl" | "en" = "nl") => {
  if (!startAt || minutes === null) return null;
  const endAt = new Date(new Date(startAt).getTime() + minutes * 60_000).toISOString();
  const short = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
  return `${short.format(new Date(startAt))}–${short.format(new Date(endAt))}`;
};

/** Een iRacing-race volgt direct op de kwalificatie wanneer geen aparte overgang is gepubliceerd. */
export const expectedCatalogRaceStart = (slot: Pick<IRacingCatalogSlot, "estimated_race_start_at" | "qualifying_start_at" | "qualifying_duration_minutes">) => {
  if (slot.estimated_race_start_at) return slot.estimated_race_start_at;
  if (!slot.qualifying_start_at || slot.qualifying_duration_minutes === null) return null;
  return new Date(new Date(slot.qualifying_start_at).getTime() + slot.qualifying_duration_minutes * 60_000).toISOString();
};

export const catalogDateWindow = (event: Pick<IRacingCatalogEvent, "event_start_date" | "event_end_date">, language: "nl" | "en" = "nl") => {
  if (!event.event_start_date) return language === "en" ? "Date not yet published" : "Datum nog niet gepubliceerd";
  const formatter = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const start = formatter.format(new Date(`${event.event_start_date}T12:00:00Z`));
  if (!event.event_end_date || event.event_end_date === event.event_start_date) return start;
  return `${start} – ${formatter.format(new Date(`${event.event_end_date}T12:00:00Z`))}`;
};

export const selectedCatalogSlot = (event: IRacingCatalogEvent) =>
  event.slots.find((slot) => slot.id === event.selectedSlotId) ?? null;
