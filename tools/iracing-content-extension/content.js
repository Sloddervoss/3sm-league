(async () => {
  const EXT_VERSION = "0.6.1"; // versie-marker: toont welke content.js écht draait
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
    "autodromo", "autódromo", "autodrome", "park", "ring",
    "street course", "international", "oval", "grand prix",
    "nordschleife", "road course", "sports car course", "rallycross",
    "motorland", "motorsenter", "road america", "road atlanta",
  ];
  const GENERIC_TRACK_NAMES = new Set([
    "circuit", "circuit - medium", "circuit - short", "ev circuit",
    "international", "national", "oval", "raceway", "roval",
    "road course", "rallycross", "short", "medium", "long", "touring",
    "classic", "historic", "full course", "grand prix",
    "north", "south", "east", "west",
  ]);

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
    const normalized = cleaned.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    if (cleaned.length < 8 || cleaned.length > 140) return false;
    if (/^\d+(\.\d+)?$/.test(cleaned)) return false;
    if (GENERIC_TRACK_NAMES.has(normalized)) return false;
    if (/^(?:circuit|road course|oval|raceway|roval)\s*-\s*(?:short|medium|long|classic|historic|national|international)$/i.test(cleaned)) return false;
    if (/^(?:oval\s*-\s*(?:left turning|right turning|\d{4})|roval\s+\d{4})$/i.test(cleaned)) return false;
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

  // --- IRACING CUSTOMER ID & USER NAME ---

  function extractCustIdFromPage() {
    const url = location.href;
    const custMatch = url.match(/[?&]cust_id[=/](\d+)/i);
    if (custMatch) return custMatch[1];
    const pathMatch = url.match(/(?:cust_)?(\d{4,})/);
    if (pathMatch) return pathMatch[1];
    try {
      if (typeof window.__INITIAL_STATE__?.user?.cust_id === "number") return String(window.__INITIAL_STATE__.user.cust_id);
      if (typeof window.__NEXT_DATA__?.props?.pageProps?.custId === "number") return String(window.__NEXT_DATA__.props.pageProps.custId);
    } catch {}
    // Check for data attributes or hidden inputs
    const custInput = document.querySelector('[name="cust_id"], [data-cust-id], input[name="cust_id"]');
    if (custInput) return cleanText(custInput.value || custInput.getAttribute("data-cust-id") || custInput.getAttribute("name"));
    return null;
  }

  /**
   * Extract the logged-in user's display name from the page.
   * Tries multiple patterns commonly found on iRacing's members-ng SPA.
   */
  function extractUserNameFromPage() {
    try {
      // 1. Check common SPA/Redux react props
      // Look for user name in page metadata or title
      const title = document.title;
      if (title && !title.includes("Log in") && !title.includes("Sign in") && !title.includes("iRacing")) {
        // Some pages set title to the user's name
      }

      // 2. Try to find user info in React props / DOM
      // The header area typically contains the user's name
      const bodyText = document.body.innerText || "";

      // 3. Look for user menu patterns - the user name often appears near a sign-out link
      const allElements = document.querySelectorAll("a, button, span, div, nav");
      for (const el of allElements) {
        const text = cleanText(el.textContent || "");
        // Skip empty, very short, or very long texts
        if (text.length < 2 || text.length > 60) continue;

        // Check nearby elements for "sign out" / "logout" indicator
        const parent = el.parentElement;
        const parentText = parent ? cleanText(parent.textContent || "").toLowerCase() : "";
        const siblingTexts = [];
        if (parent) {
          for (const sibling of parent.children) {
            if (sibling !== el) {
              siblingTexts.push(cleanText(sibling.textContent || "").toLowerCase());
            }
          }
        }
        const nearbyHasSignOut = siblingTexts.some(t =>
          t.includes("sign out") || t.includes("logout") || t.includes("signout")
        );

        // If we find text near a "sign out" link, it's likely the user name
        if (nearbyHasSignOut && text.length >= 2 && text.length <= 50) {
          return text;
        }

        // Also check element text itself
        if (text.toLowerCase().includes("sign out") || text.toLowerCase().includes("logout")) {
          // The parent container might have the user name
          const parentChildren = parent ? Array.from(parent.children).map(c => cleanText(c.textContent || "")) : [];
          const possibleName = parentChildren.find(t =>
            t.length >= 2 && t.length <= 50 &&
            !t.toLowerCase().includes("sign") && !t.toLowerCase().includes("logout") &&
            !t.toLowerCase().includes("setting") && !t.toLowerCase().includes("help") &&
            !t.toLowerCase().includes("account")
          );
          if (possibleName) return possibleName;
        }
      }

      // 4. Look for "Welcome, Name" or "Hi, Name" patterns
      const welcomeMatch = bodyText.match(/(?:Welcome|Hi|Hello|Logged in as)[,:]\s*([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s._-]{1,40})/i);
      if (welcomeMatch) return cleanText(welcomeMatch[1]);

      // 5. Get text from nav/header elements that might contain user name
      const header = document.querySelector("header, [role='banner'], nav:first-of-type");
      if (header) {
        const headerLinks = header.querySelectorAll("a, button, span");
        const linkTexts = Array.from(headerLinks)
          .map(el => cleanText(el.textContent || ""))
          .filter(t => t.length >= 2 && t.length <= 50);
        // Find the text that doesn't look like a navigation label
        const navLabels = ["tracks", "cars", "home", "members", "racing", "profile",
          "settings", "help", "logout", "sign out", "my account", "licensed content",
          "leagues", "results", "stats", "replays", "hosted", "test drive",
          "paint shop", "forums", "support", "store", "account"];
        const nonLabel = linkTexts.find(t =>
          !navLabels.includes(t.toLowerCase()) &&
          !navLabels.some(l => t.toLowerCase() === l) &&
          !t.match(/^\d+$/)
        );
        if (nonLabel) return nonLabel;
      }

      // 6. Last resort: look for "signed in" text nearby
      const signedInMatch = bodyText.match(/signed\s+in\s+(?:as\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s._-]{1,40})/i);
      if (signedInMatch) return cleanText(signedInMatch[1]);

    } catch (e) {
      // Silently fail
    }
    return null;
  }

  async function fetchCustIdAndNameViaBff() {
    // Try multiple BFF endpoints for both cust_id and user name
    // These only work when called from the members-ng domain with a valid session cookie

    const bffBase = "https://members-ng.iracing.com/bff/pub";

    // Helper: try a BFF endpoint
    async function tryEndpoint(path) {
      try {
        const url = path.startsWith("http") ? path : `${bffBase}${path}`;
        const res = await fetch(url, {
          credentials: "include",
          headers: { "Accept": "application/json" },
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    // Helper: follow iRacing's "link" pattern (initial call returns {link: "https://...", ttl: ...})
    async function followLink(json) {
      if (!json?.link) return json;
      try {
        const linked = await fetch(json.link, {
          headers: { "Accept": "application/json" },
        });
        if (linked.ok) return await linked.json();
      } catch {}
      return json;
    }

    // Endpoint 1: /verify - returns session info for logged-in users
    // Endpoint 2: /proxy/data/member/get - member info
    // Endpoint 3: /proxy/data/member/info - alternative

    const endpoints = [
      "/verify",
      "/proxy/data/member/get?include_licenses=1",
      "/proxy/data/member/info?include_licenses=1",
    ];

    let custId = null;
    let userName = null;

    for (const ep of endpoints) {
      const json = await tryEndpoint(ep);
      if (!json) continue;

      const data = await followLink(json);

      // Try common response shapes
      // 1. Array with cust_id (member/get style)
      if (Array.isArray(data) && data.length > 0) {
        const member = data[0];
        if (!custId && member?.cust_id) {
          custId = String(member.cust_id);
          userName = userName || member?.display_name || member?.username || null;
        }
        if (!userName && member?.display_name) {
          userName = cleanText(member.display_name);
        }
        if (!userName && member?.username) {
          userName = cleanText(member.username);
        }
      }

      // 2. Object with cust_id
      if (data?.cust_id && !custId) {
        custId = String(data.cust_id);
        userName = userName || data?.display_name || data?.username || null;
      }

      // 3. Object with member or user key
      if (data?.member?.cust_id && !custId) {
        custId = String(data.member.cust_id);
        userName = userName || data.member?.display_name || data.member?.username || null;
      }
      if (data?.user?.cust_id && !custId) {
        custId = String(data.user.cust_id);
        userName = userName || data.user?.display_name || data.user?.username || null;
      }

      // 4. Object with redirectUrl and session info (verify endpoint style)
      if (data?.redirectUrl && !custId) {
        // The verify endpoint might have user info in the session
        // Check for common session shapes
        if (data.session?.cust_id) custId = String(data.session.cust_id);
        if (data.session?.display_name) userName = userName || cleanText(data.session.display_name);
        if (data.session?.username) userName = userName || cleanText(data.session.username);
        // Check for user object on the data itself
        if (data.user?.cust_id) custId = String(data.user.cust_id);
        if (data.user?.name) userName = userName || cleanText(data.user.name);
      }

      // Stop early if we have both
      if (custId && userName) break;
    }

    // Endpoint 4: Try the old members.iracing.com API for driver info
    if (!custId) {
      try {
        const res = await fetch("https://members.iracing.com/member/api/member/get", {
          credentials: "include",
          headers: { "Accept": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.cust_id) custId = String(data.cust_id);
          if (!userName && data?.display_name) userName = cleanText(data.display_name);
        }
      } catch {}
    }

    return { custId, userName };
  }

  /**
   * API-first: haal ALLE owned tracks op via de BFF `lookup/tracks` endpoint.
   * Geschikt voor iRacing's naar secties opgesplitste pagina, waar DOM-scannen
   * alleen de zichtbare rijen (~7) leest. De API retourneert de volledige lijst
   * met owned-status, ongeacht de layout.
   * Volgt het standaard {link:...}-patroon en is tolerant voor meerdere
   * response-vormen.
   */
  async function fetchOwnedTracksViaBff() {
    try {
      const res = await fetch(
        "https://members-ng.iracing.com/bff/pub/proxy/data/lookup/tracks",
        { credentials: "include", headers: { "Accept": "application/json" } }
      );
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        return { owned: [], usable: false, httpStatus: res.status, raw: text || `HTTP ${res.status}` };
      }
      let json = await res.json();
      let followed = false;
      if (json?.link) {
        const linked = await fetch(json.link, { headers: { "Accept": "application/json" } });
        if (linked.ok) { json = await linked.json(); followed = true; }
      }
      // ruwe sample bewaren zodat we de echte veldn namen kunnen zien als de
      // parser iets mist (beperkt om de storage/export niet te veel te laten groeien).
      const rawSample = JSON.stringify(json).slice(0, 2500);
      const rows = Array.isArray(json)
        ? json
        : Array.isArray(json?.data) ? json.data
        : Array.isArray(json?.tracks) ? json.tracks
        : Array.isArray(json?.data?.items) ? json.data.items
        : Array.isArray(json?.content) ? json.content
        : [];
      const owned = [];
      let keysSample = null;
      for (const row of rows) {
        if (!keysSample && row && typeof row === "object") keysSample = Object.keys(row).slice(0, 40);
        const name = cleanText(row?.track_name || row?.name || row?.display_name || row?.friendly_name || row?.label || "");
        if (!name) continue;
        const isOwned = row?.owned === true
          || row?.owned_tracks === true
          || row?.purchase_status === "owned"
          || row?.is_owned === true
          || row?.user_owns === true
          || row?.in_inventory === true
          || (typeof row?.owned === "string" && /^(1|true|owned|purchased)$/i.test(row.owned))
          || (typeof row?.purchase_status === "string" && /^(1|owned|purchased|true)$/i.test(row.purchase_status));
        if (isOwned) owned.push(name);
      }
      return {
        owned,
        usable: owned.length > 0,
        httpStatus: res.status,
        followedLink: followed,
        rawCount: rows.length,
        rawKeys: keysSample,
        raw: rawSample,
      };
    } catch (e) {
      return { owned: [], usable: false, error: String((e && e.message) || e).slice(0, 300) };
    }
  }

  // --- MAIN ---
  const pageIsOwnedFilter = currentPageIsOwnedFilter();

  // 1. Try BFF for both cust_id and user name
  let custId = extractCustIdFromPage();
  let userName = extractUserNameFromPage();

  const [bffResult, bffTracks] = await Promise.all([
    fetchCustIdAndNameViaBff(),
    fetchOwnedTracksViaBff(),
  ]);

  if (bffResult.custId && !custId) custId = bffResult.custId;
  if (bffResult.userName && !userName) userName = bffResult.userName;

  // 2. Scan DOM for tracks. De BFF-API is de primaire bron (volledige lijst,
  // imuun voor de pagina-redesign); de DOM-scan geldt alleen als de API niets
  // opleverde (bijv. niet-ingelogd of endpoint gewijzigd).
  const tableResults = scanTableRows();
  const cardResults = scanCards();

  // Merge: table results preferred, deduplicate
  const allCandidates = [...tableResults, ...cardResults];
  const seen = new Set();
  const candidates = [];
  for (const item of allCandidates) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(item);
  }

  // Determine owned tracks. Primary: BFF API (volledige, layout-onafhankelijke
  // lijst). Fallback: DOM-scan wanneer de API niets gave.
  let ownedTracks;
  if (bffTracks.usable) {
    ownedTracks = [...new Set(bffTracks.owned)]
      .sort((a, b) => a.localeCompare(b));
  } else if (pageIsOwnedFilter) {
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
      version: EXT_VERSION,
      source: "3 Stripe iRacing Content Extension",
      scannedAt: new Date().toISOString(),
      pageUrl: location.href,
      pageTitle: document.title,
      pageIsOwnedFilter,
      iracingCustId: custId,
      uploaderName: userName,
      api: {
        usable: bffTracks.usable,
        httpStatus: bffTracks.httpStatus ?? null,
        followedLink: bffTracks.followedLink ?? null,
        rawCount: bffTracks.rawCount ?? null,
        rawKeys: bffTracks.rawKeys ?? null,
        error: bffTracks.error ?? null,
      },
      ownedTracks,
      candidates: candidates.map(({ name, owned }) => ({ name, owned })),
    },
    debug: {
      version: EXT_VERSION,
      pageUrl: location.href,
      pageTitle: document.title,
      pageIsOwnedFilter,
      iracingCustId: custId,
      uploaderName: userName,
      apiOwnedTracks: bffTracks.owned,
      apiUsable: bffTracks.usable,
      apiHttpStatus: bffTracks.httpStatus ?? null,
      apiFollowedLink: bffTracks.followedLink ?? null,
      apiRawCount: bffTracks.rawCount ?? null,
      apiRawKeys: bffTracks.rawKeys ?? null,
      apiRaw: bffTracks.raw ?? null,
      apiError: bffTracks.error ?? null,
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
