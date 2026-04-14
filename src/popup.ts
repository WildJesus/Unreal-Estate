// Extension popup — auto-open toggle, language switcher, manual launch button.
// NOTE: popup.ts intentionally does NOT import from i18n.ts to keep the popup
// bundle self-contained (no shared Rollup chunk that would break content scripts).

import { type Lang } from './i18n';

// Feature flags — keep in sync with content.ts.
const DEBUGGER_FEATURE_ENABLED = false;

// ─── Element refs ─────────────────────────────────────────────────────────────

const toggle        = document.getElementById('auto-open')        as HTMLInputElement;
const launchBtn     = document.getElementById('launch-btn')       as HTMLButtonElement;
const debugBtn      = document.getElementById('debug-btn')        as HTMLButtonElement;
const aboutBtn      = document.getElementById('about-btn')        as HTMLButtonElement;
const status        = document.getElementById('status')           as HTMLDivElement;
const popupTitle    = document.getElementById('su-popup-title')   as HTMLSpanElement;
const labelAutoOpen = document.getElementById('label-auto-open')  as HTMLSpanElement;
const labelLang     = document.getElementById('label-lang')       as HTMLSpanElement;
const langCs        = document.getElementById('lang-cs')          as HTMLButtonElement;
const langEn        = document.getElementById('lang-en')          as HTMLButtonElement;

// ─── Popup-local translations (5 keys — keeps popup bundle self-contained) ───

const POPUP_STRINGS: Record<Lang, {
  title:          string;
  autoTurnOn:     string;
  langLabel:      string;
  launchOverlay:  string;
  launchDebugger: string;
  about:          string;
  notOnSreality:  string;
}> = {
  cs: {
    title:          'Historický srovnávač bydlení',
    autoTurnOn:     'Automaticky zapnout',
    langLabel:      'Jazyk',
    launchOverlay:  'Spustit overlay',
    launchDebugger: 'Spustit debugger',
    about:          'O projektu',
    notOnSreality:  'Nejste na stránce sreality.cz.',
  },
  en: {
    title:          'Historical Housing Comparator',
    autoTurnOn:     'Auto turn on',
    langLabel:      'Language',
    launchOverlay:  'Launch overlay',
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
  launchBtn.textContent     = s.launchOverlay;
  debugBtn.textContent      = s.launchDebugger;
  aboutBtn.textContent      = s.about;
  langCs.classList.toggle('active', lang === 'cs');
  langEn.classList.toggle('active', lang === 'en');
  // Store for use in sendToActiveTab error message.
  (status as any)._notOnSreality = s.notOnSreality;
}

// ─── Load saved settings ──────────────────────────────────────────────────────

chrome.storage.sync.get({ autoOpen: true, lang: 'cs' }, (settings) => {
  toggle.checked = settings.autoOpen as boolean;
  applyPopupLang((settings.lang as Lang) ?? 'cs');
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
    // Writing to storage.sync triggers chrome.storage.onChanged in the content
    // script, which calls setLang() + rebuildAllUI() there automatically.
    chrome.storage.sync.set({ lang });
  });
});

// ─── Launch buttons ───────────────────────────────────────────────────────────

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

// Hide debug button in production builds.
if (!DEBUGGER_FEATURE_ENABLED) debugBtn.style.display = 'none';

launchBtn.addEventListener('click', () => sendToActiveTab('show-overlay'));
if (DEBUGGER_FEATURE_ENABLED) debugBtn.addEventListener('click', () => sendToActiveTab('show-debugger'));
aboutBtn.addEventListener('click',  () => sendToActiveTab('show-about'));
