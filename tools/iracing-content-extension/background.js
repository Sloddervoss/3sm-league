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

async function openScannerSidePanel(tab) {
  if (!chrome.sidePanel?.open) {
    await openOrFocusScannerWindow();
    return;
  }

  if (tab?.id) {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "popup.html",
      enabled: true,
    });
  }

  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    await chrome.sidePanel.open({});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  openScannerSidePanel(tab).catch((error) => {
    console.error("Kon scanner-sidepanel niet openen", error);
    openOrFocusScannerWindow().catch((fallbackError) => {
      console.error("Kon scanner-popup niet openen", fallbackError);
    });
  });
});
