// Tijdzone utilities — admin voert altijd Amsterdam (CET/CEST) tijd in
const TZ = "Europe/Amsterdam";

/** Amsterdam lokale tijd string → UTC ISO string (voor opslaan in DB) */
export function amsToUTC(localStr: string): string {
  if (!localStr) throw new Error("Datum & tijd is verplicht");
  if (localStr.length > 16) return new Date(localStr).toISOString();
  const temp = new Date(localStr + ":00.000Z");
  if (isNaN(temp.getTime())) throw new Error("Ongeldige datum/tijd waarde");
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(temp);
  const p: Record<string, string> = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const amsDate = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:00.000Z`);
  return new Date(temp.getTime() - (amsDate.getTime() - temp.getTime())).toISOString();
}

/** UTC ISO string → "YYYY-MM-DDTHH:mm" in Amsterdam tijd (voor datetime-local input) */
export function utcToAmsLocal(utcStr: string): string {
  const date = new Date(utcStr);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p: Record<string, string> = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
