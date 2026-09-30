/**
 * Deelbare URL's voor coureurs, teams en seizoenen.
 *
 * Waarom dit bestaat: deze entiteiten leefden alleen in een popup zonder adres.
 * Daardoor kon Google ze niet als losse pagina kennen — 34 coureurs, 4 teams en
 * 3 seizoenen waren onzichtbaar. Elke entiteit krijgt nu een echte URL, terwijl
 * de kaart gewoon de popup blijft openen: voor bezoekers verandert er niets.
 *
 * LET OP: scripts/generate-route-html.mjs kan deze TS-module niet importeren en
 * herhaalt de slugregels. Houd ze identiek (kleine letters, accenten gestript,
 * alles wat geen letter of cijfer is wordt één streepje).
 */

export const slugifyEntity = (value: string | null | undefined): string =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type NamedProfile = {
  user_id?: string | null;
  display_name?: string | null;
  iracing_name?: string | null;
};

/** Naam zoals de site die toont: iRacing-naam gaat voor de profielnaam. */
export const driverDisplayName = (profile: NamedProfile | null | undefined): string =>
  (profile?.iracing_name || profile?.display_name || "").trim();

export const driverSlug = (profile: NamedProfile | null | undefined): string =>
  slugifyEntity(driverDisplayName(profile)) || String(profile?.user_id || "");

export const driverPath = (profile: NamedProfile | null | undefined): string =>
  `/drivers/${driverSlug(profile)}`;

type NamedTeam = { id?: string | null; name?: string | null };

export const teamSlug = (team: NamedTeam | null | undefined): string =>
  slugifyEntity(team?.name) || String(team?.id || "");

export const teamPath = (team: NamedTeam | null | undefined): string => `/teams/${teamSlug(team)}`;

type NamedLeague = { id?: string | null; name?: string | null; season?: string | number | null };

export const seasonLabel = (league: NamedLeague | null | undefined): string =>
  [league?.name, league?.season].filter(Boolean).join(" ").trim();

export const seasonSlug = (league: NamedLeague | null | undefined): string =>
  slugifyEntity(seasonLabel(league)) || String(league?.id || "");

export const seasonPath = (league: NamedLeague | null | undefined): string => `/seasons/${seasonSlug(league)}`;

/**
 * Zet de robots-meta op noindex. Gebruikt door de profielpagina's wanneer een
 * slug niet bestaat: die pagina's worden nooit geprerenderd, maar een bezoeker
 * of crawler kan er via een verouderde link alsnog binnenkomen.
 */
export const setNoindex = () => {
  const selector = 'meta[name="robots"]';
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.name = "robots";
    document.head.appendChild(element);
  }
  element.content = "noindex, follow";
};

export const clearNoindex = () => {
  document.head.querySelectorAll('meta[name="robots"]').forEach((element) => element.remove());
};
