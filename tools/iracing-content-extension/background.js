const SCANNER_URL = chrome.runtime.getURL("popup.html?standalone=1");

async function openOrFocusScannerTab() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("popup.html*") });
  const existing = tabs.find((tab) => tab.url?.startsWith(chrome.runtime.getURL("popup.html")));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: SCANNER_URL });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: SCANNER_URL, active: true });
}

chrome.action.onClicked.addListener(() => {
  openOrFocusScannerTab().catch((error) => {
    console.error("Kon scanner-tab niet openen", error);
  });
});
