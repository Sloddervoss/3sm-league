type MetaAttr = "content" | "href";

const ensureMetaElement = (selector: string) => {
  const existing = document.head.querySelector(selector);
  if (existing) return existing;

  if (selector === 'meta[name="description"]') {
    const element = document.createElement("meta");
    element.name = "description";
    document.head.appendChild(element);
    return element;
  }

  const ogMatch = selector.match(/^meta\[property="([^"]+)"\]$/);
  if (ogMatch) {
    const element = document.createElement("meta");
    element.setAttribute("property", ogMatch[1]);
    document.head.appendChild(element);
    return element;
  }

  if (selector === 'link[rel="canonical"]') {
    const element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
    return element;
  }

  return null;
};

export const setMetaTag = (selector: string, attr: MetaAttr, value: string) => {
  const element = ensureMetaElement(selector);
  if (element) element.setAttribute(attr, value);
};

type SeoMeta = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle?: string;
  ogDescription?: string;
};

export const setSeoMeta = ({ title, description, canonicalUrl, ogTitle = title, ogDescription = description }: SeoMeta) => {
  document.title = title;
  setMetaTag('meta[name="description"]', "content", description);
  setMetaTag('meta[property="og:title"]', "content", ogTitle);
  setMetaTag('meta[property="og:description"]', "content", ogDescription);
  setMetaTag('meta[property="og:url"]', "content", canonicalUrl);
  setMetaTag('meta[name="twitter:title"]', "content", ogTitle);
  setMetaTag('meta[name="twitter:description"]', "content", ogDescription);
  setMetaTag('link[rel="canonical"]', "href", canonicalUrl);
};

// Canonieke beschrijving van de organisatie, identiek aan het blok in index.html
// en aan organizationJsonLd() in scripts/generate-route-html.mjs. Hetzelfde @id
// zorgt dat Google dit als één entiteit ziet in plaats van losse kopieën.
export const SITE_ORGANIZATION_ID = "https://3stripemotorsport.cc/#organisatie";

export const siteOrganizationJsonLd = (siteUrl = "https://3stripemotorsport.cc") => ({
  "@type": "SportsOrganization",
  "@id": SITE_ORGANIZATION_ID,
  name: "3 Stripe Motorsport",
  alternateName: "3SM",
  url: `${siteUrl}/`,
  logo: `${siteUrl}/favicon-192x192.png`,
  description: "3 Stripe Motorsport is een Nederlandse iRacing league en community met een eigen kalender, uitslagen en standen.",
  sport: "Sim racing",
  foundingDate: "2026",
  areaServed: { "@type": "Country", name: "Nederland" },
  knowsAbout: ["iRacing", "sim racing", "endurance racing"],
  sameAs: [
    "https://discord.gg/H7tZVuzBgT",
    "https://www.instagram.com/3stripemotorsport",
    "https://www.facebook.com/people/3-Stripe-Motorsport/61589158685020/",
  ],
});
