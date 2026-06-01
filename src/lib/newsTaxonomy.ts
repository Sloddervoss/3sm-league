export type NewsCategoryDefinition = {
  label: string;
  slug: string;
  description: string;
};

export type NewsSearchablePost = {
  slug: string;
  title: string;
  category: string;
  season_id?: string | null;
  excerpt?: string | null;
  content_html?: string | null;
};

export const NEWS_CATEGORIES: NewsCategoryDefinition[] = [
  {
    label: "Raceverslagen",
    slug: "raceverslagen",
    description: "Uitgebreide verslagen van 3SM-races met strategie, incidenten en beslissende momenten.",
  },
  {
    label: "Race Recaps",
    slug: "race-recaps",
    description: "Korte samenvattingen van races binnen 3 Stripe Motorsport.",
  },
  {
    label: "League Updates",
    slug: "league-updates",
    description: "Belangrijke updates over kalender, regels, formats en praktische league-informatie.",
  },
  {
    label: "Interviews",
    slug: "interviews",
    description: "Gesprekken met coureurs, teams en mensen achter de schermen van de 3SM-community.",
  },
  {
    label: "Reviews",
    slug: "reviews",
    description: "Analyses en reviews van cars, updates, formats en simracing-onderwerpen.",
  },
  {
    label: "Community",
    slug: "community",
    description: "Nieuws uit de paddock: trainingen, Discord, community-initiatieven en verhalen van leden.",
  },
  {
    label: "iRacing Nieuws",
    slug: "iracing-nieuws",
    description: "iRacing-updates vertaald naar wat ze betekenen voor de 3SM-grid.",
  },
  {
    label: "Special Events",
    slug: "special-events",
    description: "Aankondigingen, previews en recaps van endurance, one-offs en bijzondere race-avonden.",
  },
];

const normalizeSlugInput = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const categoryToSlug = (category: string) =>
  NEWS_CATEGORIES.find((item) => item.label === category)?.slug || normalizeSlugInput(category);

export const categorySlugToLabel = (slug: string | undefined | null) =>
  NEWS_CATEGORIES.find((item) => item.slug === slug)?.label || null;

export const categoryBySlug = (slug: string | undefined | null) =>
  NEWS_CATEGORIES.find((item) => item.slug === slug) || null;

export const articlePath = (post: { category: string; slug: string }, suffix = "") =>
  `/news/${categoryToSlug(post.category)}/${post.slug}${suffix}`;

export const authorSlug = (name: string | null | undefined) => normalizeSlugInput(name || "3SM redactie") || "3sm-redactie";

export const authorPath = (name: string | null | undefined, suffix = "") => `/news/author/${authorSlug(name)}${suffix}`;

const stripHtml = (value: string | null | undefined) => (value || "").replace(/<[^>]*>/g, " ");

export const filterNewsPosts = <T extends NewsSearchablePost>(posts: T[], categoryLabel: string | null, query: string, seasonId?: string | null) => {
  const normalizedQuery = query.trim().toLowerCase();
  return posts.filter((post) => {
    const matchesCategory = !categoryLabel || post.category === categoryLabel;
    if (!matchesCategory) return false;
    const matchesSeason = !seasonId || post.season_id === seasonId;
    if (!matchesSeason) return false;
    if (!normalizedQuery) return true;
    const haystack = [post.title, post.category, post.excerpt || "", stripHtml(post.content_html)].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
};
