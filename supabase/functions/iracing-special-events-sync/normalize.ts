export type TimingStatus = "full" | "partial" | "race_only";
export type AvailabilityStatus = "exact_slots" | "date_only" | "tbd";

export type OfficialEventCar = {
  sourceKey: string;
  name: string;
  imageUrl: string | null;
  officialClassId: string | null;
  localCarId?: string | null;
};

export type SpecialEventSeed = {
  sourceKey: string;
  year: number;
  name: string;
  circuit?: string | null;
  configuration?: string | null;
  trackId?: number | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  classIds?: string[];
  cars?: OfficialEventCar[];
  teamEvent?: boolean;
  officialUrl?: string | null;
  posterUrl?: string | null;
};

type RaceTimeDescriptor = {
  session_times?: string[];
  repeating?: boolean;
  first_session_time?: string;
};

export type IRacingSchedule = {
  season_id?: number;
  series_id?: number;
  track?: { track_id?: number; track_name?: string; config_name?: string };
  race_time_descriptors?: RaceTimeDescriptor[];
  practice_length?: number;
  qualify_length?: number;
  warmup_length?: number;
  race_time_limit?: number;
  race_lap_limit?: number;
  session_minutes?: number;
};

type ScheduleEnvelope = IRacingSchedule & { schedules?: IRacingSchedule[] };

const unwrapSchedule = (input?: IRacingSchedule | ScheduleEnvelope | IRacingSchedule[] | null): IRacingSchedule => {
  if (!input) return {};
  const rows = Array.isArray(input) ? input : Array.isArray((input as ScheduleEnvelope).schedules)
    ? (input as ScheduleEnvelope).schedules ?? []
    : [input as IRacingSchedule];
  if (rows.length === 0) return {};
  const base = rows.find((row) => row.race_time_descriptors?.length) ?? rows[0];
  return {
    ...base,
    race_time_descriptors: rows.flatMap((row) => row.race_time_descriptors ?? []),
  };
};

export type NormalizedSlot = {
  sourceSlotKey: string;
  sessionStartAt: string;
  practiceStartAt: string | null;
  practiceDurationMinutes: number | null;
  qualifyingStartAt: string | null;
  qualifyingDurationMinutes: number | null;
  transitionDurationMinutes: number | null;
  estimatedRaceStartAt: string | null;
  raceDurationMinutes: number | null;
  raceLapLimit: number | null;
  sessionDurationMinutes: number | null;
  sessionTimingStatus: TimingStatus;
  label: string | null;
  source: string;
};

export type NormalizedSpecialEvent = SpecialEventSeed & {
  circuit: string | null;
  configuration: string | null;
  trackId: number | null;
  dateStart: string | null;
  dateEnd: string | null;
  durationMinutes: number | null;
  classIds: string[];
  cars: OfficialEventCar[];
  teamEvent: boolean;
  officialUrl: string | null;
  posterUrl: string | null;
  availabilityStatus: AvailabilityStatus;
  slots: NormalizedSlot[];
  sourceHash: string;
};

const htmlText = (value: string) => value
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;|&#160;/g, " ")
  .replace(/&#8211;|&#x2013;/gi, "-")
  .replace(/&#8217;|&#x2019;/gi, "'")
  .replace(/\s+/g, " ").trim();

const monthNumber: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const parseOfficialDateRange = (text: string): { dateStart: string; dateEnd: string } | null => {
  const match = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–]\s*(?:(?:([A-Za-z]+)\s+)?(\d{1,2})))?,\s*(\d{4})\b/);
  if (!match) return null;
  const startMonth = monthNumber[match[1].toLowerCase()];
  const endMonth = monthNumber[(match[3] ?? match[1]).toLowerCase()];
  if (!startMonth || !endMonth) return null;
  const year = Number(match[5]);
  return { dateStart: isoDate(year, startMonth, Number(match[2])), dateEnd: isoDate(year, endMonth, Number(match[4] ?? match[2])) };
};

const eventCarsFromSection = (section: string): OfficialEventCar[] => {
  const carsArea = section.split(/Cars Competing<\/h3>/i)[1] ?? "";
  const figures = carsArea.match(/<figure\b[\s\S]*?<\/figure>/gi) ?? [];
  const seen = new Set<string>();
  return figures.flatMap((figure) => {
    const contextSource = figure.match(/uploadedSrc&quot;:&quot;([^&]+)&quot;/i)?.[1]?.replace(/\\\//g, "/");
    const imageUrl = contextSource ?? figure.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1] ?? null;
    if (!imageUrl) return [];
    const rawName = imageUrl.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const sourceKey = rawName.toLowerCase().replace(/-\d+x\d+$/i, "");
    if (!sourceKey || seen.has(sourceKey)) return [];
    seen.add(sourceKey);
    const name = rawName.replace(/-\d+x\d+$/i, "").replace(/[-_]+/g, " ")
      .replace(/\bfeature\b/gi, "").replace(/\s+/g, " ").trim();
    return [{ sourceKey, name, imageUrl, officialClassId: null }];
  });
};

export function enrichSeedFromOfficialCalendar(seed: SpecialEventSeed, calendarHtml: string): SpecialEventSeed {
  const anchor = seed.officialUrl?.split("#")[1] ?? "";
  if (!anchor) throw new Error("Officiële event-URL mist een sectieanker");
  const start = calendarHtml.indexOf(`id="${anchor}"`);
  if (start < 0) throw new Error("Eventsectie ontbreekt op officiële iRacing-kalender");
  const sectionStart = calendarHtml.lastIndexOf("<section", start);
  const sectionEnd = calendarHtml.indexOf("</section>", start);
  if (sectionStart < 0 || sectionEnd < 0) throw new Error("Officiële eventsectie is onvolledig");
  const section = calendarHtml.slice(sectionStart, sectionEnd + 10);
  const heading = section.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const poster = section.match(/<figure\b[^>]*class="[^"]*wp-block-image[^"]*"[^>]*>[\s\S]*?<img\b[^>]*\bsrc="([^"]+)"/i)?.[1];
  const dateText = htmlText(section.match(/<p\b[^>]*>[\s\S]*?<em>([\s\S]*?)<\/em>[\s\S]*?<\/p>/i)?.[1] ?? "");
  const dates = parseOfficialDateRange(dateText);
  const carsArea = section.split(/Cars Competing<\/h3>/i)[1] ?? "";
  const classes = htmlText(carsArea.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] ?? "")
    .split(/\s*\/\/\s*|\s*\/\s*|\s*,\s*/).map((value) => value.trim()).filter(Boolean);
  const cars = eventCarsFromSection(section);
  return {
    ...seed,
    name: heading ? htmlText(heading) : seed.name,
    dateStart: dates?.dateStart ?? seed.dateStart ?? null,
    dateEnd: dates?.dateEnd ?? seed.dateEnd ?? null,
    posterUrl: poster ?? seed.posterUrl ?? null,
    classIds: classes.length ? classes : seed.classIds,
    cars: cars.length ? cars : seed.cars,
    teamEvent: /\bTEAM EVENT\b/i.test(htmlText(section)) || seed.teamEvent === true,
  };
}

const finiteMinutes = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

const addMinutes = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

const utcIso = (value: string): string | null => {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
};

const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const timing = (schedule: IRacingSchedule, sessionStartAt: string): Omit<NormalizedSlot, "sourceSlotKey" | "sessionStartAt" | "label" | "source"> => {
  const practice = finiteMinutes(schedule.practice_length);
  const qualify = finiteMinutes(schedule.qualify_length);
  const warmup = finiteMinutes(schedule.warmup_length);
  const raceDuration = finiteMinutes(schedule.race_time_limit);
  const raceLapLimit = finiteMinutes(schedule.race_lap_limit);
  const sessionMinutes = finiteMinutes(schedule.session_minutes);
  const knownPreRace = (practice ?? 0) + (qualify ?? 0) + (warmup ?? 0);

  // Alleen een aantoonbare resttijd gebruiken: totale sessie - gepubliceerde fasen -
  // time-limited race. Lap-limited schedules leveren geen betrouwbare eindtijd.
  const transition = sessionMinutes !== null && raceDuration !== null
    ? sessionMinutes - knownPreRace - raceDuration
    : null;
  const safeTransition = transition !== null && transition >= 0 && transition <= 30 ? transition : null;
  const hasSequence = practice !== null || qualify !== null || warmup !== null;
  const canEstimateRace = hasSequence && safeTransition !== null;
  const qualifyingOffset = practice !== null ? practice + (warmup ?? 0) : null;

  return {
    practiceStartAt: practice !== null ? sessionStartAt : null,
    practiceDurationMinutes: practice,
    qualifyingStartAt: qualify !== null && qualifyingOffset !== null ? addMinutes(sessionStartAt, qualifyingOffset) : null,
    qualifyingDurationMinutes: qualify,
    transitionDurationMinutes: safeTransition,
    estimatedRaceStartAt: canEstimateRace ? addMinutes(sessionStartAt, knownPreRace + safeTransition) : null,
    raceDurationMinutes: raceDuration,
    raceLapLimit,
    sessionDurationMinutes: sessionMinutes,
    sessionTimingStatus: canEstimateRace ? "full" : hasSequence ? "partial" : "race_only",
  };
};

export async function normalizeSpecialEvent(seed: SpecialEventSeed, input?: IRacingSchedule | ScheduleEnvelope | IRacingSchedule[] | null): Promise<NormalizedSpecialEvent> {
  if (!seed.sourceKey.trim() || !seed.name.trim() || !Number.isInteger(seed.year)) {
    throw new Error("Ongeldig Special Event-bronrecord");
  }
  const schedule = unwrapSchedule(input);
  const starts = new Set<string>();
  for (const descriptor of schedule?.race_time_descriptors ?? []) {
    for (const raw of descriptor.session_times ?? []) {
      const iso = utcIso(raw);
      if (iso) starts.add(iso);
    }
    if (!descriptor.repeating && descriptor.first_session_time) {
      const iso = utcIso(descriptor.first_session_time);
      if (iso) starts.add(iso);
    }
  }
  const slots = Array.from(starts).sort().map((sessionStartAt) => ({
    sourceSlotKey: `${seed.sourceKey}:${sessionStartAt}`,
    sessionStartAt,
    ...timing(schedule ?? {}, sessionStartAt),
    label: null,
    source: "iracing_data_api",
  }));
  const dateStart = seed.dateStart ?? null;
  const dateEnd = seed.dateEnd ?? null;
  if (slots.length && dateStart && dateEnd) {
    const earliestAllowed = Date.parse(`${dateStart}T00:00:00Z`) - 24 * 60 * 60 * 1000;
    const latestAllowedExclusive = Date.parse(`${dateEnd}T00:00:00Z`) + 2 * 24 * 60 * 60 * 1000;
    const outsideOfficialWindow = slots.some((slot) => {
      const instant = Date.parse(slot.sessionStartAt);
      return instant < earliestAllowed || instant >= latestAllowedExclusive;
    });
    if (outsideOfficialWindow) {
      throw new Error("iRacing-seasonmapping bevat timeslots buiten het officiële eventvenster");
    }
  }
  const eventWithoutHash = {
    ...seed,
    circuit: seed.circuit ?? schedule?.track?.track_name ?? null,
    configuration: seed.configuration ?? schedule?.track?.config_name ?? null,
    trackId: seed.trackId ?? schedule?.track?.track_id ?? null,
    dateStart,
    dateEnd,
    durationMinutes: finiteMinutes(schedule?.race_time_limit),
    classIds: [...new Set(seed.classIds ?? [])].sort(),
    cars: Array.from(new Map((seed.cars ?? []).map((car) => [car.sourceKey, car])).values())
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
    teamEvent: seed.teamEvent ?? true,
    officialUrl: seed.officialUrl ?? null,
    posterUrl: seed.posterUrl ?? null,
    availabilityStatus: (slots.length ? "exact_slots" : dateStart ? "date_only" : "tbd") as AvailabilityStatus,
    slots,
  };
  return { ...eventWithoutHash, sourceHash: await sha256(eventWithoutHash) };
}
