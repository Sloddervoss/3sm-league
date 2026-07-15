const partsInZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
};

export const utcToZonedInput = (iso: string, timeZone = "Europe/Amsterdam") => {
  const p = partsInZone(new Date(iso), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export const zonedInputToUtc = (value: string, timeZone = "Europe/Amsterdam") => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Ongeldige lokale datum/tijd.");
  const target = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: 0 };
  const targetWallClock = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0);
  let guess = targetWallClock;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = partsInZone(new Date(guess), timeZone);
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    guess += targetWallClock - observedWallClock;
  }
  const finalParts = partsInZone(new Date(guess), timeZone);
  if (finalParts.year !== target.year || finalParts.month !== target.month || finalParts.day !== target.day || finalParts.hour !== target.hour || finalParts.minute !== target.minute) throw new Error("Deze lokale tijd bestaat niet door de overgang van zomer- of wintertijd.");
  return new Date(guess).toISOString();
};
