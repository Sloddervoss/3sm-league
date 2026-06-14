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
    "nordschleife", "road course", "speedway",
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
    if (hasAny(cleaned, ["cookie", "privacy", "terms", "login", "password", "sign out", "checking credentials"])) return false;
    return hasAny(cleaned, TRACK_HINTS);
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

  function extractNameFromElement(element) {
    const labels = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.querySelector("h1,h2,h3,h4,h5,strong")?.textContent,
      element.querySelector("a")?.textContent,
      element.getAttribute("data-track-name"),
      element.querySelector("[class*='name' i]")?.textContent,
      element.querySelector("[class*='title' i]")?.textContent,
    ].map(cleanText).filter(Boolean);

    const namedLabel = labels.find(looksLikeTrackName);
    if (namedLabel) return namedLabel;

    // Try to find track name inside element text by looking for track hints
    const lines = cleanText(element.innerText)
      .split(/(?<=[a-z)])\s+(?=[A-Z][a-z])/)
      .map(cleanText)
      .filter(Boolean);

    return lines.find(looksLikeTrackName) || "";
  }

  // --- PAGE-SPECIFIC SCANNING ---

  function scanTableRows() {
    const results = [];
    const tables = document.querySelectorAll("table, [role='grid'], [role='table']");
    for (const table of tables) {
      const rows = table.querySelectorAll("tr, [role='row']");
      for (const row of rows) {
        const cells = row.querySelectorAll("td, [role='cell'], th");
        if (cells.length < 2) continue;
        const rowText = cleanText(row.innerText || row.textContent);
        if (!rowText || rowText.length < 4 || rowText.length > 2000) continue;

        const name = extractNameFromElement(row);
        if (!name) continue;

        const lower = rowText.toLowerCase();
        const notOwned = NOT_OWNED_WORDS.some((word) => lower.includes(word));
        const owned = !notOwned && OWNED_WORDS.some((word) => lower.includes(word));
        results.push({ name, owned });
      }
    }
    return results;
  }

  function scanCards() {
    const results = [];
    const cards = document.querySelectorAll("[class*='card' i], [class*='item' i], article, li");
    for (const card of cards) {
      const text = cleanText(card.innerText || card.textContent);
      if (!text || text.length < 4 || text.length > 1800) continue;
      const name = extractNameFromElement(card);
      if (!name) continue;

      const lower = text.toLowerCase();
      const notOwned = NOT_OWNED_WORDS.some((word) => lower.includes(word));
      const owned = !notOwned && OWNED_WORDS.some((word) => lower.includes(word));
      results.push({ name, owned });
    }
    return results;
  }

  function scanVisibleLines() {
    return cleanText(document.body.innerText)
      .split(/(?<=[a-z)])\s+(?=[A-Z])/)
      .map(cleanText)
      .filter(looksLikeTrackName)
      .slice(0, 300);
  }

  // --- IRACING CUSTOMER ID ---

  function extractCustIdFromPage() {
    const url = location.href;
    const custMatch = url.match(/[?&]cust_id[=/](\d+)/i);
    if (custMatch) return custMatch[1];
    const pathMatch = href.match(/(?:cust_)?(\d{4,})/);
    if (pathMatch) return pathMatch[1];
    try {
      if (typeof window.__INITIAL_STATE__?.user?.cust_id === "number") return String(window.__INITIAL_STATE__.user.cust_id);
      if (typeof window.__NEXT_DATA__?.props?.pageProps?.custId === "number") return String(window.__NEXT_DATA__.props.pageProps.custId);
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

  // --- MAIN ---
  const pageIsOwnedFilter = currentPageIsOwnedFilter();

  // 1. Try BFF API for cust_id
  let custId = extractCustIdFromPage();
  if (!custId) custId = await fetchCustIdViaBFF();

  // 2. Scan DOM - try multiple strategies
  const tableResults = scanTableRows();
  const cardResults = scanCards();

  // Merge: table results preferred (closer to actual data), deduplicate
  const allCandidates = [...tableResults, ...cardResults];
  const seen = new Set();
  const candidates = [];
  for (const item of allCandidates) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
  }

  // Determine owned: if page has purchased filter or explicit owned keywords
  let ownedTracks;
  if (pageIsOwnedFilter) {
    // On the tracks page with tags=purchased, ALL shown tracks are owned
    ownedTracks = candidates.map((c) => c.name).sort((a, b) => a.localeCompare(b));
  } else {
    ownedTracks = candidates
      .filter((item) => item.owned)
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b));
  }

  const visibleTrackLines = scanVisibleLines();

  // If DOM found nothing but visible lines detected tracks, use those
  if (ownedTracks.length === 0 && visibleTrackLines.length > 0) {
    ownedTracks = [...new Set(visibleTrackLines.map((t) => t.toLowerCase()))]
      .map((t) => {
        const orig = visibleTrackLines.find((l) => l.toLowerCase() === t);
        return orig;
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

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
      tableResults,
      cardResults,
      candidates,
      visibleTrackLines,
      bodySample: cleanText(document.body.innerText).slice(0, 5000),
    },
  };

  try {
    chrome.storage.local.set({ lastScan: result });
  } catch {}

  return result;
})();