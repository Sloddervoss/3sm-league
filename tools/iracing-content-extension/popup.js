const SUPABASE_URL = "https://3stripemotorsport.cc";
const UPLOAD_FUNCTION = `${SUPABASE_URL}/functions/v1/track-intelligence-upload`;
const EXTENSION_API_KEY = "RoEbEQBO0zMMbUiZyCsAgCnQ8hB9ad6rAMQgKAAArds";

// The URL that shows purchased tracks in a table
const TRACKS_PAGE =
  "https://members-ng.iracing.com/web/racing/licensed-content/tracks?" +
  "filter=all&match=any&sort=track_name&tags=purchased&view=table";

const openTracksBtn = document.querySelector("#openTracks");
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
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

async function scanCurrentPage() {
  const buttons = [scanCurrentBtn, openTracksBtn, openTracksFromEmpty, rescanFromEmpty];
  buttons.forEach((b) => { if (b) b.disabled = true; });
  setStatus("Scannen...");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Geen actieve tab gevonden.");

    const url = tab.url || "";
    if (!url.includes("iracing.com")) {
      setStatus("Dit is geen iRacing-pagina.", true);
      return;
    }

    const result = await runScanOnTab(tab.id);
    displayResult(result);
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
    const tab = await getActiveTab();
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: TRACKS_PAGE });
    } else {
      await chrome.tabs.create({ url: TRACKS_PAGE });
    }

    // Wacht 7 sec voor SPA laadtijd, scan dan automatisch
    setTimeout(async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url?.includes("iracing.com")) {
          const result = await runScanOnTab(tabs[0].id);
          displayResult(result);
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
      page_url: exp.pageUrl || null,
      scanned_at: exp.scannedAt || new Date().toISOString(),
    };

    const response = await fetch(UPLOAD_FUNCTION, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok || result.error) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    uploadStatus.hidden = true;
    uploadResult.hidden = false;
    uploadSummary.textContent = `${result.created_records} tracks opgeslagen voor ${result.member_name || "jouw profiel"}.`;
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

// Event listeners
openTracksBtn.addEventListener("click", openTracksPage);
scanCurrentBtn.addEventListener("click", scanCurrentPage);
uploadBtn.addEventListener("click", uploadScan);
copyBtn.addEventListener("click", copyExport);
copyDebugBtn.addEventListener("click", copyDebug);
rescanBtn?.addEventListener("click", resetToNavigate);
openTracksFromEmpty?.addEventListener("click", openTracksPage);
rescanFromEmpty?.addEventListener("click", scanCurrentPage);

// Auto-check on open
checkStoredScan();