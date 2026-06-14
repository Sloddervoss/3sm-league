(async () => {
  const OWNED_WORDS = [
    "owned", "purchased", "licensed", "my content",
    "content owned", "included", "installed",
  ];
  const NOT_OWNED_WORDS = [
    "add to cart", "buy now", "purchase", "not owned",
    "not purchased", "unowned",
  ];
  const TRACK_HINTS = [
    "circuit", "speedway", "raceway", "motorsport",
    "autodromo", "autodrome", "park", "ring",
    "street course", "international", "oval", "grand prix",
    "nordschleife", "speedway", "road course",
  ];

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function hasAny(text, words) {
    const lower = text.toLowerCase();
    return words.some((word) => lower.includes(word));
  }

  function looksLikeTrackName(text) {
    const cleaned = cleanText(text);
    if (cleaned.length < 4 || cleaned.length > 140) return false;
    if (/^\d+(\.\d+)?$/.test(cleaned)) return false;
    if (hasAny(cleaned, ["cookie", "privacy", "terms", "login", "password"])) return false;
    return hasAny(cleaned, TRACK_HINTS);
  }

  function getCandidateElements() {
    const selectors = [
      "article", "li", "tr", "[role='row']",
      "[class*='card' i]", "[class*='content' i]",
      "[class*='track' i]", "[class*='item' i]",
      "a[href*='track' i]", "a[href*='cars-and-tracks' i]",
    ];
    return Array.from(document.querySelectorAll(selectors.join(",")));
  }

  function extractNameFromElement(element) {
    const labels = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.querySelector("h1,h2,h3,h4,h5,strong")?.textContent,
      element.querySelector("a")?.textContent,
    ].map(cleanText).filter(Boolean);

    const namedLabel = labels.find(looksLikeTrackName);
    if (namedLabel) return namedLabel;

    const lines = cleanText(element.innerText)
      .split(/(?=[A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/)
      .map(cleanText)
      .filter(Boolean);

    return lines.find(looksLikeTrackName) || "";
  }

  function classifyElement(element, pageIsOwnedFilter) {
    const text = cleanText(element.innerText || element.textContent);
    if (!text || text.length > 1800) return null;

    const name = extractNameFromElement(element);
    if (!name) return null;

    const lower = text.toLowerCase();
    const notOwned = NOT_OWNED_WORDS.some((word) => lower.includes(word));
    const owned = !notOwned && (pageIsOwnedFilter || OWNED_WORDS.some((word) => lower.includes(word)));

    return { name, owned, textSample: text.slice(0, 500) };
  }

  function uniqueByName(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function extractVisibleTrackLines() {
    return cleanText(document.body.innerText)
      .split(/(?<=[a-z)])\s+(?=[A-Z])/)
      .map(cleanText)
      .filter(looksLikeTrackName)
      .slice(0, 300);
  }

  function currentPageIsOwnedFilter() {
    const url = new URL(location.href);
    const tags = url.searchParams.getAll("tags").join(" ").toLowerCase();
    const filter = url.searchParams.get("filter")?.toLowerCase() || "";
    const bodyText = cleanText(document.body.innerText).toLowerCase();
    return (
      tags.includes("purchased") || tags.includes("owned") || tags.includes("licensed") ||
      filter === "purchased" || filter === "owned" ||
      bodyText.includes("purchased content") || bodyText.includes("owned content")
    );
  }

  function extractCustIdFromPage() {
    // Try URL patterns
    const url = location.href;
    const custMatch = url.match(/[?&]cust_id[=/](\d+)/i);
    if (custMatch) return custMatch[1];

    // Try common iRacing page patterns
    const pathMatch = url.match(/\/member\/(?:cust_)?(\d+)/i);
    if (pathMatch) return pathMatch[1];

    // Try meta tags
    const meta = document.querySelector('meta[name="iracing-cust-id"], meta[property="iracing:cust_id"]');
    if (meta) return meta.getAttribute("content");

    // Try global JS variables
    try {
      if (typeof window.__INITIAL_STATE__?.user?.cust_id === "number") {
        return String(window.__INITIAL_STATE__.user.cust_id);
      }
      if (typeof window.__NEXT_DATA__?.props?.pageProps?.custId === "number") {
        return String(window.__NEXT_DATA__.props.pageProps.custId);
      }
    } catch {}

    // Try Redux store (members SPA)
    try {
      const reduxRoot = document.querySelector("#__redux-store");
      if (reduxRoot?.textContent) {
        const parsed = JSON.parse(reduxRoot.textContent);
        if (parsed?.user?.cust_id) return String(parsed.user.cust_id);
      }
    } catch {}

    return null;
  }

  async function fetchCustIdViaBFF() {
    try {
      const res = await fetch("https://members-ng.iracing.com/bff/pub/proxy/data/member/get?include_licenses=1", {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json?.link) {
        const linked = await fetch(json.link, { headers: { "Accept": "application/json" } });
        if (linked.ok) {
          const data = await linked.json();
          if (Array.isArray(data) && data[0]?.cust_id) return String(data[0].cust_id);
        }
      }
      if (Array.isArray(json) && json[0]?.cust_id) return String(json[0].cust_id);
      return null;
    } catch {
      return null;
    }
  }

  async function fetchOwnedContentViaBFF(custId) {
    try {
      // Try the content endpoint
      const res = await fetch(
        `https://members-ng.iracing.com/bff/pub/proxy/data/member/info?cust_ids=${custId}`,
        { credentials: "include", headers: { "Accept": "application/json" } }
      );
      if (!res.ok) return null;
      const json = await res.json();
      if (json?.link) {
        const linked = await fetch(json.link, { headers: { "Accept": "application/json" } });
        if (linked.ok) return await linked.json();
      }
      return json;
    } catch {
      return null;
    }
  }

  // --- MAIN SCAN ---
  const pageIsOwnedFilter = currentPageIsOwnedFilter();

  // 1. Try to get cust_id
  let custId = extractCustIdFromPage();
  if (!custId) custId = await fetchCustIdViaBFF();

  // 2. DOM scan
  const candidates = uniqueByName(
    getCandidateElements()
      .map((element) => classifyElement(element, pageIsOwnedFilter))
      .filter(Boolean)
  );

  const ownedTracks = candidates
    .filter((item) => item.owned)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));

  const visibleTrackLines = extractVisibleTrackLines();

  const result = {
    export: {
      source: "3 Stripe iRacing Content Extension",
      scannedAt: new Date().toISOString(),
      pageUrl: location.href,
      pageTitle: document.title,
      pageIsOwnedFilter,
      iracingCustId: custId,
      ownedTracks,
      candidates: candidates.map(({ name, owned }) => ({ name, owned })),
    },
    debug: {
      pageUrl: location.href,
      pageTitle: document.title,
      pageIsOwnedFilter,
      iracingCustId: custId,
      candidateCount: candidates.length,
      candidates,
      visibleTrackLines,
      bodySample: cleanText(document.body.innerText).slice(0, 5000),
    },
  };

  // Store for popup to read
  try {
    chrome.storage.local.set({ lastScan: result });
  } catch {}

  return result;
})();