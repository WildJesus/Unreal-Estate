// Extension popup — auto-open toggle + manual launch button.

const toggle = document.getElementById("auto-open") as HTMLInputElement;
const launchBtn = document.getElementById("launch-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLDivElement;

// ─── Load saved setting ───────────────────────────────────────────────────────

chrome.storage.sync.get({ autoOpen: true }, (settings) => {
  toggle.checked = settings.autoOpen as boolean;
});

// ─── Persist toggle changes ───────────────────────────────────────────────────

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ autoOpen: toggle.checked });
});

// ─── Launch button ────────────────────────────────────────────────────────────

function sendToActiveTab(type: string) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes("sreality.cz")) {
      status.textContent = "Not on a sreality.cz page.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type });
    window.close();
  });
}

launchBtn.addEventListener("click", () => sendToActiveTab("show-overlay"));

const debugBtn = document.getElementById("debug-btn") as HTMLButtonElement;
debugBtn.addEventListener("click", () => sendToActiveTab("show-debugger"));
