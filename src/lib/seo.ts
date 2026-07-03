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
