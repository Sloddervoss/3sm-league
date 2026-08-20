const SUPABASE_URL = "https://api.3stripemotorsport.cc";
const UPLOAD_FUNCTION = `${SUPABASE_URL}/functions/v1/track-intelligence-upload`;
const EXTENSION_API_KEY = "RoEbEQBO0zMMbUiZyCsAgCnQ8hB9ad6rAMQgKAAArds";

// The URL that shows purchased tracks in a table
const TRACKS_PAGE =
  "https://members-ng.iracing.com/web/racing/licensed-content/tracks?" +
  "filter=all&match=any&sort=track_name&tags=purchased&view=table";

const openTracksBtn = document.querySelector("#openTracks");
const openStandaloneBtn = document.querySelector("#openStandalone");
const scanCurrentBtn = document.querySelector("#scanCurrent");
const uploadBtn = document.querySelector("#uploadBtn");
const copyBtn = document.querySelector("#copyBtn");
const copyDebugBtn = document.querySelector("#copyDebugBtn");
const rescanBtn = document.querySelector("#rescanBtn");
const openTracksFromEmpty = document.querySelector("#openTracksFromEmpty");
const rescanFromEmpty = document.querySelector("#rescanFromEmpty");

const stepNavigate = document.querySelector("#step-navigate");
const stepResult = document.querySelector("#step-result");
const stepEmpty = document.querySelector("#step-empty");
const statusText = document.querySelector("#status");
const exportText = document.querySelector("#exportText");
const ownedCount = document.querySelector("#ownedCount");
const custIdDisplay = document.querySelector("#custIdDisplay");
const userNameDisplay = document.querySelector("#userNameDisplay");
const uploadStatus = document.querySelector("#uploadStatus");
const uploadMessage = document.querySelector("#uploadMessage");
const uploadResult = document.querySelector("#uploadResult");
const uploadSummary = document.querySelector("#uploadSummary");

let lastScan = null;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#f87171" : "#a1a1aa";
}

function showStep(step) {
  stepNavigate.hidden = step !== "navigate";
  stepResult.hidden = step !== "result";
  stepEmpty.hidden = step !== "empty";
  // Reset upload UI when switching away from result
  if (step !== "result") {
    uploadStatus.hidden = true;
    uploadResult.hidden = true;
    uploadBtn.disabled = false;
  }
}

function resetToNavigate() {
  lastScan = null;
  showStep("navigate");
  setStatus("");
}

const isStandalone = new URLSearchParams(location.search).get("standalone") === "1";
if (isStandalone) {
  document.body.classList.add("standalone");
  if (openStandaloneBtn) openStandaloneBtn.hidden = true;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isIracingUrl(url = "") {
  return url.includes("iracing.com");
}

async function rememberTargetTab(tabId) {
  if (!tabId) return;
  try { await chrome.storage.local.set({ targetIracingTabId: tabId }); } catch {}
}

async function getTargetIracingTab() {
  const active = await getActiveTab();
  if (active?.id && isIracingUrl(active.url || "")) {
    await rememberTargetTab(active.id);
    return active;
  }

  try {
    const { targetIracingTabId } = await chrome.storage.local.get("targetIracingTabId");
    if (targetIracingTabId) {
      const tab = await chrome.tabs.get(targetIracingTabId);
      if (tab?.id && isIracingUrl(tab.url || "")) return tab;
    }
  } catch {}

  const tabs = await chrome.tabs.query({
    currentWindow: true,
    url: [
      "https://members-ng.iracing.com/*",
      "https://members.iracing.com/*",
      "https://www.iracing.com/*",
    ],
  });
  if (tabs[0]?.id) {
    await rememberTargetTab(tabs[0].id);
    return tabs[0];
  }

  return null;
}

async function runScanOnTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    if (!result) throw new Error("Content script gaf geen resultaat terug.");
    return result;
  } catch (error) {
    throw new Error(`Scan mislukt: ${error.message}`);
  }
}

function displayResult(result) {
  lastScan = result;
  const exp = result.export || result;
  exportText.value = JSON.stringify(exp, null, 2);
  ownedCount.textContent = String(exp.ownedTracks?.length || 0);
  custIdDisplay.textContent = exp.iracingCustId || "—";
  userNameDisplay.textContent = exp.uploaderName || "—";
  // Reset upload UI on fresh scan display
  uploadStatus.hidden = true;
  uploadResult.hidden = true;
  uploadBtn.disabled = false;

  if (exp.ownedTracks?.length > 0) {
    showStep("result");
    setStatus(
      `${exp.ownedTracks.length} tracks gevonden. Upload naar 3 Stripe of scan opnieuw.`
    );
  } else {
    showStep("empty");
    setStatus(
      exp.iracingCustId
        ? `Geen tracks gevonden (iRacing ID: ${exp.iracingCustId}). Open de tracks pagina en probeer opnieuw.`
        : "Geen tracks gevonden en geen iRacing ID kunnen ophalen. Zorg dat je ingelogd bent op iRacing.",
      true
    );
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bouw een page-URL met specifiek pagina-nummer, gebaseerd op de huidige URL. */
function pageUrlFor(baseUrl, page) {
  const url = new URL(baseUrl);
  const pageSize = url.searchParams.get("page_size") || url.searchParams.get("rows_per_page");
  if (pageSize) url.searchParams.set("page_size", pageSize);
  url.searchParams.set("page", String(page));
  // Verwijder 'rows_per_page'-alias indien aanwezig (iRacing gebruikt page_size)
  url.searchParams.delete("rows_per_page");
  return url.href;
}

async function scanAllPages() {
  const tab = await getTargetIracingTab();
  if (!tab?.id) throw new Error("Geen iRacing-tab gevonden.");
  const startUrl = tab.url || "";

  // Vind de startpagina uit de URL (default 1) en scan hem eerst.
  let expectedPage;
  try { expectedPage = parseInt(new URL(startUrl).searchParams.get("page") || "1", 10) || 1; }
  catch { expectedPage = 1; }

  const first = await runScanOnTab(tab.id);
  const pag = first?.export?.pagination || first?.debug?.pagination || {};
  const total = pag.totalCount || 0;
  const pageSize = pag.pageSize || 12;

  // Verzameling van alle unieke tracknamen over de pagina's heen.
  const seenNames = new Set();
  const seenCandidates = new Map(); // name -> owned

  function absorb(scanResult) {
    const exp = scanResult?.export || scanResult;
    const owned = Array.isArray(exp.ownedTracks) ? exp.ownedTracks : exp.candidates
      ?.filter((c) => exp.pageIsOwnedFilter || c.owned).map((c) => c.name) || [];
    owned.forEach((n) => seenNames.add(n));
    (Array.isArray(exp.candidates) ? exp.candidates : []).forEach((c) => {
      if (!seenCandidates.has(c.name)) seenCandidates.set(c.name, { name: c.name, owned: c.owned });
    });
    return exp;
  }

  const firstExport = absorb(first);

  // Bepaal hoeveel pagina's er zijn. Als we de teller niet kunnen lezen, stop na 1.
  let lastPage = 1;
  if (total > 0 && pageSize > 0) {
    lastPage = Math.ceil(total / pageSize);
  } else {
    const count = firstExport.ownedTracks?.length || 0;
    if (total > count) lastPage = Math.ceil(total / (count || pageSize || 1));
  }
  if (lastPage < 1) lastPage = 1;
  // Cap defensief zodat we niet eindeloos door navigeren op een verkeerde parse.
  if (lastPage > 200) lastPage = 200;

  // Scan de resterende pagina's door de iRacing-tab telkens opnieuw te laden.
  for (let page = expectedPage + 1; page <= lastPage; page++) {
    setStatus(`Pagina ${page}/${lastPage} scannen...`);
    const targetUrl = pageUrlFor(startUrl, page);
    const updated = await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
    await sleep(6000); // wacht op SPA-load
    const scanned = await runScanOnTab(updated.id);
    absorb(scanned);
  }

  // Bouw een samengevoegde export: paginering weergevend dat we allemaal hebben.
  const mergedExport = firstExport;
  mergedExport.ownedTracks = [...seenNames].sort((a, b) => a.localeCompare(b));
  mergedExport.candidates = [...seenCandidates.values()];
  mergedExport.pagination = {
    ...pag,
    scannedPages: Math.max(1, lastPage - expectedPage + 1),
    merged: true,
  };
  // Meerder dit zo dat displayResult de nieuwe tijden ook echt laat zien.
  return { export: mergedExport, debug: { ...(first?.debug || {}), pagination: mergedExport.pagination } };
}

async function scanCurrentPage() {
  const buttons = [scanCurrentBtn, openTracksBtn, openTracksFromEmpty, rescanFromEmpty];
  buttons.forEach((b) => { if (b) b.disabled = true; });
  setStatus("Scannen...");

  try {
    const tab = await getTargetIracingTab();
    if (!tab?.id) throw new Error("Geen iRacing-tab gevonden. Open eerst de iRacing tracks pagina.");

    const url = tab.url || "";
    if (!isIracingUrl(url)) {
      setStatus("Dit is geen iRacing-pagina.", true);
      return;
    }

    const result = await scanAllPages();
    displayResult(result);
    const exp = result.export || result;
    const pag = exp.pagination || {};
    if (pag.totalCount && pag.merged) {
      setStatus(`${exp.ownedTracks.length} tracks gevonden (alle ${pag.totalCount} via ${pag.scannedPages || 1} pagina's). Upload naar 3 Stripe of scannen opnieuw.`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Scan mislukt.";
    setStatus(msg, true);
    showStep("empty");
  } finally {
    buttons.forEach((b) => { if (b) b.disabled = false; });
  }
}

async function openTracksPage() {
  openTracksBtn.disabled = true;
  if (openTracksFromEmpty) openTracksFromEmpty.disabled = true;
  setStatus("Tracks pagina openen...");

  try {
    const existing = await getTargetIracingTab();
    let targetTab;
    if (existing?.id) {
      targetTab = await chrome.tabs.update(existing.id, { url: TRACKS_PAGE, active: true });
    } else {
      targetTab = await chrome.tabs.create({ url: TRACKS_PAGE, active: true });
    }
    if (targetTab?.id) await rememberTargetTab(targetTab.id);

    // Wacht 7 sec voor SPA laadtijd, scan dan automatisch alle pagina's.
    setTimeout(async () => {
      try {
        const target = targetTab?.id ? await chrome.tabs.get(targetTab.id) : await getTargetIracingTab();
        if (target?.id && isIracingUrl(target.url || "")) {
          const result = await scanAllPages();
          displayResult(result);
          const pag = (result.export || result).pagination || {};
          if (pag.totalCount && pag.merged) setStatus(`Alle ${pag.totalCount} tracks gevonden (${pag.scannedPages || 1} pagina's).`);
          return;
        }
      } catch {}
      setStatus("Pagina geopend. Klik op 'Scan huidige pagina' als de tracks zichtbaar zijn.", false);
      showStep("navigate");
    }, 7000);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Navigatie mislukt.", true);
  } finally {
    openTracksBtn.disabled = false;
    if (openTracksFromEmpty) openTracksFromEmpty.disabled = false;
  }
}

async function uploadScan() {
  if (!lastScan) return;

  uploadBtn.disabled = true;
  uploadStatus.hidden = false;
  uploadResult.hidden = true;
  uploadMessage.textContent = "Uploaden naar 3 Stripe...";
  setStatus("Bezig met uploaden...");

  try {
    const exp = lastScan.export || lastScan;
    const payload = {
      api_key: EXTENSION_API_KEY,
      tracks: (exp.ownedTracks || []).map((name) => ({ name })),
      candidates: (exp.candidates || []).map((c) => ({ name: c.name, owned: c.owned })),
      iracing_cust_id: exp.iracingCustId || null,
      uploader_name: exp.uploaderName || null,
      page_url: exp.pageUrl || null,
      scanned_at: exp.scannedAt || new Date().toISOString(),
    };

    const response = await fetch(UPLOAD_FUNCTION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Server gaf geen JSON terug (${response.status}). Endpoint: ${UPLOAD_FUNCTION}`);
    }

    if (!response.ok || result.error) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    uploadStatus.hidden = true;
    uploadResult.hidden = false;
    const ignoredText = result.ignored_tracks ? ` (${result.ignored_tracks} vage namen genegeerd)` : "";
    uploadSummary.textContent = `${result.saved_records ?? result.created_records} tracks opgeslagen/bijgewerkt voor ${result.member_name || "jouw profiel"}${ignoredText}.`;
    setStatus("Upload gelukt! Data is toegevoegd aan de Track Intelligence test.", false);
  } catch (error) {
    uploadStatus.hidden = true;
    setStatus(`Upload mislukt: ${error.message}`, true);
  } finally {
    uploadBtn.disabled = false;
  }
}

async function copyExport() {
  if (!lastScan) return;
  const text = JSON.stringify(lastScan.export || lastScan, null, 2);
  await navigator.clipboard.writeText(text);
  setStatus("Export gekopieerd.");
}

async function copyDebug() {
  if (!lastScan) return;
  const text = JSON.stringify(lastScan.debug || lastScan, null, 2);
  await navigator.clipboard.writeText(text);
  setStatus("Debug info gekopieerd.");
}

// Auto-check on popup open
async function checkStoredScan() {
  try {
    const { lastScan: stored } = await chrome.storage.local.get("lastScan");
    if (stored) {
      displayResult(stored);
      return;
    }
  } catch {}

  try {
    const tab = await getActiveTab();
    if (tab?.url?.includes("iracing.com")) {
      // Snel scan, geen loading state
      try {
        const result = await runScanOnTab(tab.id);
        displayResult(result);
        return;
      } catch {}
    }
  } catch {}

  showStep("navigate");
  setStatus("Klik 'Open iRacing tracks pagina' om te beginnen.");
}

async function openStandaloneScanner() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?standalone=1") });
}

// Event listeners
openTracksBtn.addEventListener("click", openTracksPage);
openStandaloneBtn?.addEventListener("click", openStandaloneScanner);
scanCurrentBtn.addEventListener("click", scanCurrentPage);
uploadBtn.addEventListener("click", uploadScan);
copyBtn.addEventListener("click", copyExport);
copyDebugBtn.addEventListener("click", copyDebug);
rescanBtn?.addEventListener("click", resetToNavigate);
openTracksFromEmpty?.addEventListener("click", openTracksPage);
rescanFromEmpty?.addEventListener("click", scanCurrentPage);

// Auto-check on open
checkStoredScan();