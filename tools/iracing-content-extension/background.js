const SCANNER_URL = chrome.runtime.getURL("popup.html?standalone=1");
const POPUP_WIDTH = 540;
const POPUP_HEIGHT = 760;

async function openOrFocusScannerWindow() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("popup.html*") });
  const existing = tabs.find((tab) => tab.url?.startsWith(chrome.runtime.getURL("popup.html")));

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: SCANNER_URL });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, {
        focused: true,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
      });
    }
    return;
  }

  await chrome.windows.create({
    url: SCANNER_URL,
    type: "popup",
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true,
  });
}

chrome.action.onClicked.addListener(() => {
  openOrFocusScannerWindow().catch((error) => {
    console.error("Kon scanner-popup niet openen", error);
  });
});
