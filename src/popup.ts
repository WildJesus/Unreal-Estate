// Extension popup — auto-open toggle, language switcher, overlay segmented control.
// NOTE: popup.ts intentionally does NOT import from i18n.ts to keep the popup
// bundle self-contained (no shared Rollup chunk that would break content scripts).

import { type Lang } from './i18n';

// Feature flags — keep in sync with content.ts.
const DEBUGGER_FEATURE_ENABLED = false;

// ─── Element refs ─────────────────────────────────────────────────────────────

const toggle        = document.getElementById('auto-open')        as HTMLInputElement;
const overlayOnBtn  = document.getElementById('overlay-on-btn')   as HTMLButtonElement;
const overlayOffBtn = document.getElementById('overlay-off-btn')  as HTMLButtonElement;
const debugBtn      = document.getElementById('debug-btn')        as HTMLButtonElement;
const aboutBtn      = document.getElementById('about-btn')        as HTMLButtonElement;
const status        = document.getElementById('status')           as HTMLDivElement;
const popupTitle    = document.getElementById('su-popup-title')   as HTMLSpanElement;
const labelAutoOpen = document.getElementById('label-auto-open')  as HTMLSpanElement;
const labelLang     = document.getElementById('label-lang')       as HTMLSpanElement;
const langCs        = document.getElementById('lang-cs')          as HTMLButtonElement;
const langEn        = document.getElementById('lang-en')          as HTMLButtonElement;

let overlayOn = false;

// ─── Popup-local translations ─────────────────────────────────────────────────

const POPUP_STRINGS: Record<Lang, {
  title:          string;
  autoTurnOn:     string;
  langLabel:      string;
  overlayOn:      string;
  overlayOff:     string;
  launchDebugger: string;
  about:          string;
  notOnSreality:  string;
}> = {
  cs: {
    title:          'Unreal Estate',
    autoTurnOn:     'Automaticky zapnout',
    langLabel:      'Jazyk',
    overlayOn:      'ZAP',
    overlayOff:     'VYP',
    launchDebugger: 'Spustit debugger',
    about:          'O projektu',
    notOnSreality:  'Nejste na stránce sreality.cz.',
  },
  en: {
    title:          'Unreal Estate',
    autoTurnOn:     'Auto turn on',
    langLabel:      'Language',
    overlayOn:      'ON',
    overlayOff:     'OFF',
    launchDebugger: 'Launch debugger',
    about:          'About',
    notOnSreality:  'Not on a sreality.cz page.',
  },
};

// ─── Apply language to popup UI ───────────────────────────────────────────────

function applyPopupLang(lang: Lang) {
  const s = POPUP_STRINGS[lang] ?? POPUP_STRINGS.cs;
  popupTitle.textContent    = s.title;
  labelAutoOpen.textContent = s.autoTurnOn;
  labelLang.textContent     = s.langLabel;
  overlayOnBtn.textContent  = s.overlayOn;
  overlayOffBtn.textContent = s.overlayOff;
  debugBtn.textContent      = s.launchDebugger;
  aboutBtn.textContent      = s.about;
  langCs.classList.toggle('active', lang === 'cs');
  langEn.classList.toggle('active', lang === 'en');
  (status as any)._notOnSreality = s.notOnSreality;
}

function setOverlayToggle(on: boolean) {
  overlayOn = on;
  overlayOnBtn.classList.toggle('su-seg-active-on',   on);
  overlayOffBtn.classList.toggle('su-seg-active-off', !on);
}

// ─── Load saved settings ──────────────────────────────────────────────────────

chrome.storage.sync.get({ autoOpen: true, lang: 'cs' }, (settings) => {
  toggle.checked = settings.autoOpen as boolean;
  applyPopupLang((settings.lang as Lang) ?? 'cs');
});

chrome.storage.local.get({ overlayOpen: false }, (local) => {
  setOverlayToggle(local.overlayOpen as boolean);
});

// ─── Persist toggle changes ───────────────────────────────────────────────────

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoOpen: toggle.checked });
});

// ─── Language switcher ────────────────────────────────────────────────────────

[langCs, langEn].forEach((btn) => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang as Lang;
    applyPopupLang(lang);
    chrome.storage.sync.set({ lang });
  });
});

// ─── Overlay segmented control ────────────────────────────────────────────────

function sendToActiveTab(type: string) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes('sreality.cz')) {
      status.textContent = (status as any)._notOnSreality ?? 'Not on a sreality.cz page.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type });
    window.close();
  });
}

overlayOnBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes('sreality.cz')) {
      status.textContent = (status as any)._notOnSreality ?? 'Not on a sreality.cz page.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'show-overlay' });
    setOverlayToggle(true);
    chrome.storage.local.set({ overlayOpen: true });
  });
});

overlayOffBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id || !tab.url?.includes('sreality.cz')) {
      status.textContent = (status as any)._notOnSreality ?? 'Not on a sreality.cz page.';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'hide-overlay' });
    setOverlayToggle(false);
    chrome.storage.local.set({ overlayOpen: false });
  });
});

// Hide debug button in production builds.
if (!DEBUGGER_FEATURE_ENABLED) debugBtn.style.display = 'none';

if (DEBUGGER_FEATURE_ENABLED) debugBtn.addEventListener('click', () => sendToActiveTab('show-debugger'));
aboutBtn.addEventListener('click',  () => sendToActiveTab('show-about'));
