// Service worker — handles toolbar button clicks and relays toggle message
// to the content script running on the active sreality.cz tab.

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  chrome.tabs.sendMessage(tab.id, { type: "toggle-overlay" }).catch(() => {
    // Content script not present on this page — nothing to do.
  });
});
