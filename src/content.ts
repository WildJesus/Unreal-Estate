// Content script — injected into every sreality.cz page.

import {
  type BurdenComparison,
  computeBurdenComparison,
  formatCZK,
  formatBurdenPercent,
  formatMultiplier,
  parseCzechPrice,
} from "./universes/calc";
import { getCurrentYearData, getRegionalData, getAvailableYears, DATA_VERSION } from "./universes/data";
import { t, setLang, getLang, type Lang } from "./i18n";

// Snapshot of current-year economic data. Evaluated once at module load — the
// page doesn't live long enough for this to become stale.
const CURRENT = getCurrentYearData();
import { type CzechRegion, type LocationResult, extractLocationFromDetail, extractLocationFromCard } from "./universes/location";

const VERSION = "1.0.2";

// Feature flag: city comparison is not yet fully implemented — hidden until ready.
const CITY_FEATURE_ENABLED = false;
// Feature flag: debugger is a dev tool — hidden in production builds.
const DEBUGGER_FEATURE_ENABLED = false;

// Human-readable names for the 14 Czech kraje, used in the info popup walkthrough.
const REGION_DISPLAY_NAMES: Record<CzechRegion, string> = {
  'praha':            'Praha',
  'stredocesky':      'Středočeský kraj',
  'jihocesky':        'Jihočeský kraj',
  'plzensky':         'Plzeňský kraj',
  'karlovarsky':      'Karlovarský kraj',
  'ustecky':          'Ústecký kraj',
  'liberecky':        'Liberecký kraj',
  'kralovehradecky':  'Královéhradecký kraj',
  'pardubicky':       'Pardubický kraj',
  'vysocina':         'Kraj Vysočina',
  'jihomoravsky':     'Jihomoravský kraj',
  'olomoucky':        'Olomoucký kraj',
  'zlinsky':          'Zlínský kraj',
  'moravskoslezsky':  'Moravskoslezský kraj',
};

// Locative case (6. pád) for Czech story: "v Praze", "v Jihomoravském kraji" etc.
const REGION_DISPLAY_NAMES_LOCATIVE: Record<CzechRegion, string> = {
  'praha':            'Praze',
  'stredocesky':      'Středočeském kraji',
  'jihocesky':        'Jihočeském kraji',
  'plzensky':         'Plzeňském kraji',
  'karlovarsky':      'Karlovarském kraji',
  'ustecky':          'Ústeckém kraji',
  'liberecky':        'Libereckém kraji',
  'kralovehradecky':  'Královéhradeckém kraji',
  'pardubicky':       'Pardubickém kraji',
  'vysocina':         'Kraji Vysočina',
  'jihomoravsky':     'Jihomoravském kraji',
  'olomoucky':        'Olomouckém kraji',
  'zlinsky':          'Zlínském kraji',
  'moravskoslezsky':  'Moravskoslezském kraji',
};

// English region names for the English story narrative.
const REGION_DISPLAY_NAMES_EN: Record<CzechRegion, string> = {
  'praha':            'Prague',
  'stredocesky':      'Central Bohemia',
  'jihocesky':        'South Bohemia',
  'plzensky':         'Plzeň Region',
  'karlovarsky':      'Karlovy Vary Region',
  'ustecky':          'Ústí nad Labem Region',
  'liberecky':        'Liberec Region',
  'kralovehradecky':  'Hradec Králové Region',
  'pardubicky':       'Pardubice Region',
  'vysocina':         'Vysočina Region',
  'jihomoravsky':     'South Moravia',
  'olomoucky':        'Olomouc Region',
  'zlinsky':          'Zlín Region',
  'moravskoslezsky':  'Moravia-Silesia',
};

// Context object stored per ⓘ button — carries everything needed to render
// the full story popup without re-computing anything.
interface PopupCtx {
  c:           BurdenComparison;
  region:      CzechRegion;
  isEstimated: boolean;
  nowIndex:    number;   // regional price index for current year
  histIndex:   number;   // regional price index for comparison year
  nowWage:     number;   // regional avg gross monthly wage, current year
  histWage:    number;   // regional avg gross monthly wage, comparison year
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PriceEntry {
  value: string;   // e.g. "12 500 000 Kč"
  source: string;  // e.g. "Hlavní cena", "Celková cena", "Podobné inzeráty"
}

// ─── Price scanner ───────────────────────────────────────────────────────────

// Matches total prices only: "12 500 000 Kč" or "25 000 Kč/měs" (rental).
// Excludes per-unit prices like "50 000 Kč/m²".
const PRICE_RE = /^\d[\d\s]*\s*Kč(\s*\/\s*měs\.?)?$/;

// Sreality injects zero-width spaces (U+200B) between characters in some text
// as an anti-scraping measure. NBSP (U+00A0) is used as a thousands separator.
// Normalize both so matching and display are consistent.
function normalizePrice(text: string): string {
  return text
    .replace(/\u200B/g, "")   // zero-width spaces → gone
    .replace(/\u00A0/g, " ")  // non-breaking spaces → regular space
    .trim();
}

// Returns true if el or any of its near ancestors has line-through decoration.
function isStrikethrough(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; i < 5; i++) {
    if (!node || node === document.body) break;
    if (window.getComputedStyle(node).textDecorationLine.includes("line-through")) return true;
    node = node.parentElement;
  }
  return false;
}

// Collect all non-strikethrough prices within a root element.
// excluded: containers whose contents should be skipped.
function collectPrices(root: Element, source: string, excluded: Element[] = []): PriceEntry[] {
  const found = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = normalizePrice(walker.currentNode.textContent?.trim() ?? "");
    if (!PRICE_RE.test(text)) continue;
    const parent = walker.currentNode.parentElement;
    if (!parent) continue;
    if (isStrikethrough(parent)) continue;
    if (excluded.some((ex) => ex.contains(parent))) continue;
    found.add(text);
  }
  return [...found].map((value) => ({ value, source }));
}

// Find the first element matching `selector` whose full textContent (after
// normalization) equals `search`. Using textContent instead of walking text
// nodes makes this robust against per-character span obfuscation.
function findElByContent(search: string, selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    if (normalizePrice(el.textContent ?? "").trim() === search) return el;
  }
  return null;
}

// Walk up exactly n levels from el (stops at body).
function nthAncestor(el: Element, n: number): Element {
  let current: Element = el;
  for (let i = 0; i < n; i++) {
    const parent = current.parentElement;
    if (!parent || parent === document.body) break;
    current = parent;
  }
  return current;
}

// ─── Page-type detection ─────────────────────────────────────────────────────

function isDetailPage(): boolean {
  return window.location.pathname.startsWith("/detail/");
}

function isInMap(el: Element): boolean {
  return !!el.closest('#map-container, [data-e2e="collapsed-map"]');
}

// ─── Listing page: general scan ──────────────────────────────────────────────

function scanListingPage(): PriceEntry[] {
  return collectPrices(document.body, "Inzerát");
}

// ─── Detail page: targeted scans only ────────────────────────────────────────

function getMortgageContainers(): Element[] {
  return Array.from(
    document.querySelectorAll('[data-e2e="mortgage-offers-link-detail"]')
  );
}

function scanDetailPage(): PriceEntry[] {
  const results: PriceEntry[] = [];
  // Deduplicate by source+value so the same price can appear under different
  // source labels (e.g. Hlavní cena and Celková cena may be the same amount).
  const seen = new Set<string>();

  function add(entries: PriceEntry[]) {
    for (const e of entries) {
      const key = `${e.source}::${e.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(e);
      }
    }
  }

  const mortgageContainers = getMortgageContainers();
  for (const c of mortgageContainers) add(collectPrices(c, "Hypotéka"));

  const heading = document.querySelector("h1") ?? document.querySelector("h2");
  if (heading) add(collectPrices(nthAncestor(heading, 2), "Hlavní cena", mortgageContainers));

  // "Celková cena:" — query <dt> by full textContent, read sibling <dd>.
  // Uses querySelector("dd") on parent instead of nextElementSibling because
  // Emotion injects a <style> tag between <dt> and <dd>.
  const celkovaDt = findElByContent("Celková cena:", "dt");
  if (celkovaDt) {
    const dd = celkovaDt.parentElement?.querySelector("dd");
    if (dd) {
      const priceText = normalizePrice(dd.textContent ?? "");
      if (PRICE_RE.test(priceText) && !mortgageContainers.some((ex) => ex.contains(dd))) {
        add([{ value: priceText, source: "Celková cena" }]);
      }
    }
  }

  // "Podobné inzeráty" — query heading tags by textContent, walk up 2 levels.
  const podobneEl = findElByContent("Podobné inzeráty", "h1,h2,h3,h4");
  if (podobneEl) add(collectPrices(nthAncestor(podobneEl, 2), "Podobné inzeráty", mortgageContainers));

  return results;
}

function scanPrices(): PriceEntry[] {
  return isDetailPage() ? scanDetailPage() : scanListingPage();
}

// ─── Overlay state (declared before highlights so applyHighlights can reference them) ──

let mainOverlayEl: HTMLElement | null = null;
let mainVisible = false;
let debugOverlayEl: HTMLElement | null = null;
let debugVisible = false;
let aboutOverlayEl: HTMLElement | null = null;

// Shared MutationObserver — forward-declared so DOM-modifying functions can
// temporarily pause it to break the observer↔render feedback loop.
let observer: MutationObserver;

// Track pending close-animation timeout so showInfoPopup can cancel it on
// immediate re-open (prevents stale setTimeout from hiding a just-shown popup).
let _hideTimer: ReturnType<typeof setTimeout> | null = null;

// Latest PopupCtx from any rendered widget or detail-page comparison, used by
// the main overlay ⓘ button which isn't tied to a specific listing element.
let latestPopupCtx: PopupCtx | null = null;

// Whether the user has ever clicked a ⓘ button. Loaded once from storage on
// script init; used to gate the first-render pulse animation on detail pages.
let infoIconSeen = false;
chrome.storage.local.get({ infoIconSeen: false }, (r) => {
  infoIconSeen = r.infoIconSeen as boolean;
});
// ── Info-icon pulse sequence ──────────────────────────────────────────────────
// Drives a repeating animation on the first detail-page ⓘ button until the
// user opens the popup. Each "run" re-triggers the CSS animation once by
// removing + re-adding the class (with a forced reflow in between).
//
// Schedule: 5 s initial → 3 × 10 s → 20 s forever (resets per URL).
//
// The button is located by ID ('su-pulse-target') rather than a captured
// reference so the timer always acts on the current DOM node after re-renders.
let infoPulseHref     = '';
let infoPulseTimer: ReturnType<typeof setTimeout> | null = null;
let infoPulseRunCount = 0;
// True during the 3 s animation window. When a re-render interrupts a running
// animation by replacing the button, the render loop re-attaches the class.
let infoPulseActive   = false;

function triggerPulse() {
  if (infoIconSeen || location.href !== infoPulseHref) return;
  const btn = document.getElementById('su-pulse-target');
  if (!btn) return;

  // Remove → force reflow → re-add to restart a single CSS animation cycle.
  btn.classList.remove('su-info-pulse');
  void btn.offsetWidth;
  btn.classList.add('su-info-pulse');
  infoPulseActive   = true;
  infoPulseRunCount++;

  // Clear the active flag after the animation completes (3 s + small buffer).
  setTimeout(() => { infoPulseActive = false; }, 3_200);

  // 3 runs at 10 s, then 20 s indefinitely.
  const nextDelay = infoPulseRunCount <= 3 ? 10_000 : 20_000;
  infoPulseTimer = setTimeout(triggerPulse, nextDelay);
}

function startPulseSequence() {
  infoPulseTimer = setTimeout(triggerPulse, 5_000);
}

function cancelPulseSequence() {
  if (infoPulseTimer !== null) { clearTimeout(infoPulseTimer); infoPulseTimer = null; }
  infoPulseRunCount = 0;
  infoPulseActive   = false;
}

// ── Comparison state ──────────────────────────────────────────────────────────
// activeYear is set by the year picker in the main overlay and read by all
// comparison renderers. null means no year is selected.
let activeYear: number | null = null;
let comparisonEls: Element[] = [];
let comparisonCSSInjected = false;

// Detected location for the current page. Updated on every applyHighlights()
// call (which fires on page load, SPA navigation, and DOM mutations).
let detectedLocation: LocationResult | null = null;

// ─── Highlights ───────────────────────────────────────────────────────────────
// Applies a faded orange highlight to every DOM element whose text is a
// matched price. Mirrors the same targeting logic as the scanners above.

const HIGHLIGHT_CLASS = "su-hl";
let highlightedEls: Element[] = [];

function highlightIn(root: Element, excluded: Element[] = []) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = normalizePrice(walker.currentNode.textContent?.trim() ?? "");
    if (!PRICE_RE.test(text)) continue;
    const parent = walker.currentNode.parentElement;
    if (!parent) continue;
    if (isStrikethrough(parent)) continue;
    if (excluded.some((ex) => ex.contains(parent))) continue;
    parent.classList.add(HIGHLIGHT_CLASS);
    highlightedEls.push(parent);
  }
}

function applyHighlights() {
  removeHighlights();
  // Refresh location on every highlight pass (covers SPA navigation).
  detectedLocation = isDetailPage() ? extractLocationFromDetail(document) : null;
  // Exclude all our overlay/popup panels so their price text doesn't get highlighted.
  const overlayExclusions: Element[] = [];
  if (mainOverlayEl)  overlayExclusions.push(mainOverlayEl);
  if (debugOverlayEl) overlayExclusions.push(debugOverlayEl);
  if (infoPopupEl)    overlayExclusions.push(infoPopupEl);

  if (isDetailPage()) {
    const mc = getMortgageContainers();
    mc.forEach((c) => highlightIn(c, overlayExclusions));

    const heading = document.querySelector("h1") ?? document.querySelector("h2");
    if (heading) highlightIn(nthAncestor(heading, 2), [...mc, ...overlayExclusions]);

    // Celková cena: directly highlight the <dd> — its content is obfuscated
    // character-by-character so the text-node walker won't match anything inside it.
    const celkovaDt = findElByContent("Celková cena:", "dt");
    if (celkovaDt) {
      const dd = celkovaDt.parentElement?.querySelector("dd");
      if (dd && !mc.some((ex) => ex.contains(dd)) && !overlayExclusions.some((ex) => ex.contains(dd))) {
        dd.classList.add(HIGHLIGHT_CLASS);
        highlightedEls.push(dd);
      }
    }

    const podobneEl = findElByContent("Podobné inzeráty", "h1,h2,h3,h4");
    if (podobneEl) highlightIn(nthAncestor(podobneEl, 2), [...mc, ...overlayExclusions]);
  } else {
    highlightIn(document.body, overlayExclusions);
  }
  // After all highlights are placed, render inline comparison widgets for listing pages.
  renderListingComparisons();
}

function removeHighlights() {
  for (const el of highlightedEls) el.classList.remove(HIGHLIGHT_CLASS);
  highlightedEls = [];
  // Keep widgets in DOM during active pulse — clearing them mid-animation
  // causes the 3 s disappear/reappear. renderListingComparisons() early-returns
  // too, so no duplicate widgets are created. Normal clearing resumes after.
  if (!infoPulseActive) clearListingComparisons();
}

// ─── Shared CSS snippet ───────────────────────────────────────────────────────

// Shared between both overlays — injected once per overlay build.
const SU_BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&display=swap');
  /* .su-hl is used for price-element tracking only — no visible highlight */
`;

// ─── Debug Overlay ────────────────────────────────────────────────────────────
// Shows raw detected prices. Positioned bottom-right.

function buildDebugOverlay(): HTMLElement {
  const style = document.createElement("style");
  style.textContent = SU_BASE_CSS + `
    #su-debug-overlay {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 300px;
      max-height: 440px;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 16px;
      color: #111111;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
      overflow: hidden;
    }
    #su-debug-overlay.su-hidden { display: none !important; }

    #su-dbg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 11px 14px 10px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      flex-shrink: 0;
    }
    #su-dbg-title-wrap { display: flex; align-items: center; gap: 7px; }
    #su-dbg-name {
      font-size: 13px;
      font-weight: 700;
      color: #111111;
      letter-spacing: 0.01em;
    }
    #su-dbg-badge {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      color: #666666; background: #f0f0f0;
      border: 1px solid rgba(0,0,0,0.12); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-dbg-version {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      color: #dc2626; background: rgba(220,38,38,0.07);
      border: 1px solid rgba(220,38,38,0.25); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-dbg-close {
      background: none; border: none; color: #aaaaaa; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 2px 0 2px 8px;
      transition: color 0.15s; font-family: inherit;
    }
    #su-dbg-close:hover { color: #111111; }

    #su-dbg-price-list {
      overflow-y: auto; padding: 6px 14px; flex: 1;
    }
    #su-dbg-price-list::-webkit-scrollbar { width: 3px; }
    #su-dbg-price-list::-webkit-scrollbar-track { background: transparent; }
    #su-dbg-price-list::-webkit-scrollbar-thumb { background: rgba(220,38,38,0.25); border-radius: 2px; }

    .su-dbg-price-item {
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.07);
    }
    .su-dbg-price-item:last-child { border-bottom: none; }
    .su-dbg-pi-top {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
    }
    .su-dbg-price-value {
      color: #111111; font-size: 16px; font-weight: 700;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .su-dbg-price-source {
      font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: #666666;
      background: #f0f0f0; border: 1px solid rgba(0,0,0,0.10);
      border-radius: 4px; padding: 3px 7px; white-space: nowrap; flex-shrink: 0;
    }
    .su-dbg-pi-loc {
      display: flex; justify-content: space-between; align-items: center; gap: 6px;
    }
    .su-dbg-loc-text {
      font-size: 12px; font-weight: 600; color: #444444;
    }
    .su-dbg-loc-src {
      font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #888888; background: #f5f5f5;
      border: 1px solid rgba(0,0,0,0.08); border-radius: 3px;
      padding: 1px 5px; white-space: nowrap; flex-shrink: 0;
    }
    .su-dbg-loc-none {
      font-size: 11px; font-style: italic; color: #aaaaaa;
    }
    .su-dbg-empty {
      color: #aaaaaa; font-style: italic; font-size: 13px;
      text-align: center; margin: 12px 0;
    }
    #su-dbg-footer {
      padding: 8px 14px; border-top: 1px solid rgba(0,0,0,0.07);
      font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
      color: #888888; text-align: center; flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "su-debug-overlay";
  el.innerHTML = `
    <div id="su-dbg-header">
      <div id="su-dbg-title-wrap">
        <span id="su-dbg-name">${t('dbgTitle')}</span>
        <span id="su-dbg-badge">${t('dbgBadge')}</span>
        <span id="su-dbg-version">v${VERSION}</span>
      </div>
      <button id="su-dbg-close" title="${t('dbgClose')}">✕</button>
    </div>
    <div id="su-dbg-price-list">
      <p class="su-dbg-empty">${t('dbgScanning')}</p>
    </div>
    <div id="su-dbg-footer">${t('dbgNoPricesFound')}</div>
  `;

  el.querySelector("#su-dbg-close")!.addEventListener("click", hideDebugOverlay);
  return el;
}

function renderDebugFull() {
  if (!debugOverlayEl) return;
  const list = debugOverlayEl.querySelector("#su-dbg-price-list")!;
  const footer = debugOverlayEl.querySelector("#su-dbg-footer")!;

  if (isDetailPage()) {
    // Detail page: one location per page — show it in the footer,
    // source labels per price entry (Hlavní cena, Celková cena, etc.).
    const prices = scanPrices();
    if (prices.length === 0) {
      list.innerHTML = `<p class="su-dbg-empty">${t('dbgNoPricesOnPage')}</p>`;
      footer.textContent = t('dbgZeroPrices');
      return;
    }
    list.innerHTML = prices
      .map((p) => `
        <div class="su-dbg-price-item">
          <div class="su-dbg-pi-top">
            <span class="su-dbg-price-value">${p.value}</span>
            <span class="su-dbg-price-source">${p.source}</span>
          </div>
        </div>`)
      .join("");
    const loc = detectedLocation;
    footer.textContent = loc
      ? t('dbgFooterWithLoc', prices.length, loc.region, loc.source)
      : t('dbgFooterNoLoc', prices.length);
    return;
  }

  // Listing page: per-card location from each highlighted price element.
  // highlightedEls is populated by applyHighlights() before this runs.
  if (highlightedEls.length === 0) {
    list.innerHTML = `<p class="su-dbg-empty">${t('dbgNoPricesOnPage')}</p>`;
    footer.textContent = t('dbgZeroPrices');
    return;
  }

  let located = 0;
  list.innerHTML = highlightedEls
    .map((el) => {
      const price = normalizePrice(el.textContent ?? "");
      const loc = extractLocationFromCard(el);
      if (loc) located++;

      const locRow = loc
        ? `<div class="su-dbg-pi-loc">
             <span class="su-dbg-loc-text">${loc.city ?? loc.region}${loc.district ? " · " + loc.district : ""}</span>
             <span class="su-dbg-loc-src">${loc.source}</span>
           </div>`
        : `<div class="su-dbg-pi-loc"><span class="su-dbg-loc-none">${t('dbgLocationUnknown')}</span></div>`;

      return `
        <div class="su-dbg-price-item">
          <div class="su-dbg-pi-top">
            <span class="su-dbg-price-value">${price}</span>
          </div>
          ${locRow}
        </div>`;
    })
    .join("");

  footer.textContent = t('dbgFooterLocated', highlightedEls.length, located);
}

function showDebugOverlay() {
  if (!debugOverlayEl) {
    debugOverlayEl = buildDebugOverlay();
    document.body.appendChild(debugOverlayEl);
  }
  debugOverlayEl.classList.remove("su-hidden");
  debugVisible = true;
  applyHighlights();   // populates highlightedEls + detectedLocation first
  renderDebugFull();   // then render with per-card location data
}

function hideDebugOverlay() {
  debugOverlayEl?.classList.add("su-hidden");
  debugVisible = false;
  if (!mainVisible) removeHighlights();
}

function toggleDebugOverlay() {
  debugVisible ? hideDebugOverlay() : showDebugOverlay();
}

// ─── Main Overlay ─────────────────────────────────────────────────────────────
// Universe selector UI. Positioned bottom-left.

function buildMainOverlay(): HTMLElement {
  const style = document.createElement("style");
  style.textContent = SU_BASE_CSS + `
    #su-main-overlay {
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 360px;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 16px;
      color: #111111;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
      overflow: hidden;
    }
    #su-main-overlay.su-mo-hidden { display: none !important; }

    /* ── Header ── */
    #su-mo-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 14px 10px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      flex-shrink: 0;
    }
    #su-mo-title-wrap { display: flex; align-items: center; gap: 7px; }
    #su-mo-name { font-size: 13px; font-weight: 700; color: #111111; letter-spacing: 0.01em; }
    #su-mo-version {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      color: #dc2626; background: rgba(220,38,38,0.07);
      border: 1px solid rgba(220,38,38,0.25); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-mo-controls { display: flex; gap: 2px; }
    .su-mo-btn {
      background: none; border: none; color: #aaaaaa; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 2px 5px;
      transition: color 0.15s; font-family: inherit; border-radius: 4px;
    }
    .su-mo-btn:hover { color: #111111; }
    /* ⓘ button in overlay header / mini bar */
    .su-mo-info-btn {
      background: none; border: none; cursor: pointer;
      padding: 2px 4px; line-height: 0; flex-shrink: 0;
      opacity: 0.45; transition: opacity 0.15s;
    }
    .su-mo-info-btn:hover { opacity: 1; }
    .su-mo-info-btn svg path { fill: #555555 !important; }

    /* ── Minimized bar ── */
    #su-mo-mini {
      display: none; align-items: center;
      padding: 9px 14px; gap: 8px;
    }
    #su-main-overlay.su-minimized #su-mo-header { display: none; }
    #su-main-overlay.su-minimized #su-mo-mini   { display: flex; }
    #su-main-overlay.su-minimized #su-mo-body   { display: none; }

    #su-mo-mini-label {
      font-size: 12px; font-weight: 700; color: #888888;
      letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
    }
    #su-mo-mini-filters { flex: 1; display: flex; align-items: center; }
    .su-mini-year-btn {
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 14px; font-weight: 700; letter-spacing: 0.04em;
      color: #dc2626; background: rgba(220,38,38,0.08);
      border: 1px solid rgba(220,38,38,0.30); border-radius: 6px;
      padding: 3px 10px; cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .su-mini-year-btn:hover {
      background: rgba(220,38,38,0.16); border-color: rgba(220,38,38,0.55);
    }
    #su-mo-mini-controls { display: flex; gap: 2px; flex-shrink: 0; }

    /* ── Body ── */
    #su-mo-body { padding: 4px 14px 12px; display: flex; flex-direction: column; }

    .su-mo-section {
      padding: 10px 0;
      border-bottom: 1px solid rgba(0,0,0,0.07);
    }
    .su-mo-section:last-child { border-bottom: none; padding-bottom: 2px; }

    .su-mo-section-head { display: flex; align-items: center; gap: 8px; }
    .su-mo-section-title {
      font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
      color: #333333; text-transform: uppercase; cursor: default;
    }

    /* Section checkbox */
    .su-mo-chk {
      appearance: none; -webkit-appearance: none;
      width: 14px; height: 14px;
      border: 1.5px solid rgba(0,0,0,0.22); border-radius: 3px;
      background: #ffffff; cursor: pointer;
      flex-shrink: 0; position: relative;
      transition: background 0.15s, border-color 0.15s; margin: 0;
    }
    .su-mo-chk:checked { background: #dc2626; border-color: #dc2626; }
    .su-mo-chk:checked::after {
      content: ''; position: absolute;
      left: 3px; top: 0px; width: 5px; height: 8px;
      border: 2px solid #ffffff; border-top: none; border-left: none;
      transform: rotate(45deg);
    }

    .su-mo-section-content { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .su-mo-section.su-disabled .su-mo-section-content {
      opacity: 0.28; pointer-events: none;
    }

    /* Year selected display */
    #su-year-selected-display {
      font-size: 12px; font-weight: 600; color: #888888;
      letter-spacing: 0.02em; min-height: 18px;
    }
    #su-year-selected-display.su-has-year {
      display: flex; flex-direction: column; align-items: center;
      background: rgba(220,38,38,0.06);
      border: 1px solid rgba(220,38,38,0.22);
      border-radius: 10px; padding: 8px 0 10px; min-height: auto;
    }
    .su-year-display-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      color: #888888; text-transform: uppercase; margin-bottom: 2px;
    }
    .su-year-display-number {
      font-size: 35px; font-weight: 700; color: #dc2626;
      font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: 0.04em;
    }

    /* Year slider */
    #su-year-slider {
      width: 100%; margin: 0;
      -webkit-appearance: none; appearance: none;
      height: 4px; border-radius: 2px;
      background: linear-gradient(to right,
        #dc2626 0%, #dc2626 var(--su-slider-pct, 0%),
        #e5e5e5 var(--su-slider-pct, 0%), #e5e5e5 100%);
      outline: none; cursor: pointer;
    }
    #su-year-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px; height: 18px; border-radius: 50%;
      background: #dc2626; cursor: pointer;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(220,38,38,0.35);
    }
    #su-year-slider::-moz-range-thumb {
      width: 18px; height: 18px; border-radius: 50%;
      background: #dc2626; cursor: pointer;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(220,38,38,0.35);
      border: none;
    }
    #su-year-slider-labels {
      display: flex; justify-content: space-between; margin-top: -2px;
      font-size: 10px; font-weight: 600; color: #aaaaaa; letter-spacing: 0.03em;
    }

    /* Year pills */
    #su-year-pills { display: flex; gap: 5px; }
    .su-year-pill {
      flex: 1; padding: 5px 0; text-align: center;
      background: #f5f5f5; border: 1px solid rgba(0,0,0,0.10);
      border-radius: 6px; color: #666666;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 12px; font-weight: 700; cursor: pointer; letter-spacing: 0.01em;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .su-year-pill:hover {
      background: #eeeeee; border-color: rgba(0,0,0,0.20); color: #111111;
    }
    .su-year-pill.su-active {
      background: rgba(220,38,38,0.08); border-color: #dc2626; color: #dc2626;
    }

    /* City section */
    #su-city-display { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #333333; }
    .su-city-badge {
      font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #666666; background: #f0f0f0; border: 1px solid rgba(0,0,0,0.10);
      border-radius: 4px; padding: 2px 6px;
    }

    /* ── Comparison section (detail page) ── */
    #su-mo-comparison { padding-top: 0; }
    .su-comp-grid { display: flex; flex-direction: column; gap: 5px; }
    .su-comp-row {
      display: flex; align-items: baseline; gap: 6px;
    }
    .su-comp-label {
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #888888; white-space: nowrap; flex-shrink: 0; min-width: 72px;
    }
    .su-comp-value {
      font-size: 14px; font-weight: 700; color: #111111;
      font-variant-numeric: tabular-nums; flex: 1; text-align: right;
    }
    .su-comp-value-adj { color: #dc2626; }
    .su-comp-pct-tag {
      font-size: 11px; font-weight: 700; padding: 2px 5px;
      border-radius: 4px; flex-shrink: 0; white-space: nowrap;
    }
    .su-comp-pct-down { color: #16a34a; background: rgba(22,163,74,0.10); }
    .su-comp-pct-up   { color: #dc2626; background: rgba(220,38,38,0.10); }
    .su-comp-divider  { border: none; border-top: 1px solid rgba(0,0,0,0.07); margin: 3px 0; }
    .su-comp-nodata   { font-size: 12px; font-style: italic; color: #aaaaaa; text-align: center; padding: 4px 0; }
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "su-main-overlay";
  el.innerHTML = `
    <div id="su-mo-header">
      <div id="su-mo-title-wrap">
        <span id="su-mo-name">${t('extensionName')}</span>
        <span id="su-mo-version">v${VERSION}</span>
        <button class="su-mo-info-btn" id="su-mo-header-info" title="${t('widgetInfoTooltip')}">
          <svg width="18" height="18" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <path fill="#555555" fill-rule="nonzero" d="M256 0c70.691 0 134.695 28.656 181.021 74.979C483.344 121.305 512 185.309 512 256c0 70.691-28.656 134.695-74.979 181.018C390.695 483.344 326.691 512 256 512c-70.691 0-134.695-28.656-181.018-74.982C28.656 390.695 0 326.691 0 256S28.656 121.305 74.982 74.979C121.305 28.656 185.309 0 256 0zm-10.029 160.379c0-4.319.761-8.315 2.282-11.988 1.515-3.66 3.797-6.994 6.836-9.98 3.028-2.98 6.341-5.241 9.916-6.758 3.593-1.511 7.463-2.282 11.603-2.282 4.143 0 8.006.771 11.564 2.278 3.561 1.521 6.828 3.782 9.808 6.779 2.976 2.987 5.212 6.31 6.695 9.973 1.489 3.663 2.236 7.659 2.236 11.978 0 4.195-.739 8.128-2.229 11.767-1.483 3.631-3.709 6.993-6.692 10.046-2.965 3.043-6.232 5.342-9.79 6.878-3.569 1.528-7.432 2.306-11.592 2.306-4.259 0-8.206-.764-11.834-2.278-3.604-1.522-6.913-3.807-9.892-6.832-2.973-3.046-5.209-6.383-6.685-10.032-1.486-3.646-2.226-7.596-2.226-11.855zm13.492 179.381c-1.118 4.002-3.375 11.837 3.316 11.837 1.451 0 3.299-.81 5.5-2.412 2.387-1.721 5.125-4.336 8.192-7.799 3.116-3.53 6.362-7.701 9.731-12.507 3.358-4.795 6.888-10.292 10.561-16.419a1.39 1.39 0 011.907-.484l12.451 9.237c.593.434.729 1.262.34 1.878-5.724 9.952-11.512 18.642-17.362 26.056-5.899 7.466-11.879 13.66-17.936 18.553l-.095.07c-6.057 4.908-12.269 8.602-18.634 11.077-17.713 6.86-45.682 5.742-53.691-14.929-5.062-13.054-.897-27.885 3.085-40.651l20.089-60.852c1.286-4.617 2.912-9.682 3.505-14.439.974-7.915-2.52-13.032-11.147-13.032h-17.562a1.402 1.402 0 01-1.395-1.399l.077-.484 4.617-16.801a1.39 1.39 0 011.356-1.02l89.743-2.815a1.39 1.39 0 011.434 1.34l-.063.445-38.019 125.55zm151.324-238.547C371.178 61.606 316.446 37.101 256 37.101c-60.446 0-115.174 24.501-154.784 64.112C61.606 140.822 37.101 195.554 37.101 256c0 60.446 24.505 115.178 64.115 154.784 39.606 39.61 94.338 64.115 154.784 64.115s115.178-24.505 154.787-64.115c39.611-39.61 64.112-94.338 64.112-154.784s-24.505-115.178-64.112-154.787z"/>
          </svg>
        </button>
      </div>
      <div id="su-mo-controls">
        <button class="su-mo-btn" id="su-mo-minimize" title="${t('moMinimize')}">─</button>
        <button class="su-mo-btn" id="su-mo-close" title="${t('moClose')}">✕</button>
      </div>
    </div>

    <div id="su-mo-mini">
      <span id="su-mo-mini-label">${t('extensionName')}</span>
      <span id="su-mo-mini-filters"></span>
      <button class="su-mo-info-btn" id="su-mo-mini-info" title="${t('widgetInfoTooltip')}">
        <svg width="18" height="18" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <path fill="#555555" fill-rule="nonzero" d="M256 0c70.691 0 134.695 28.656 181.021 74.979C483.344 121.305 512 185.309 512 256c0 70.691-28.656 134.695-74.979 181.018C390.695 483.344 326.691 512 256 512c-70.691 0-134.695-28.656-181.018-74.982C28.656 390.695 0 326.691 0 256S28.656 121.305 74.982 74.979C121.305 28.656 185.309 0 256 0zm-10.029 160.379c0-4.319.761-8.315 2.282-11.988 1.515-3.66 3.797-6.994 6.836-9.98 3.028-2.98 6.341-5.241 9.916-6.758 3.593-1.511 7.463-2.282 11.603-2.282 4.143 0 8.006.771 11.564 2.278 3.561 1.521 6.828 3.782 9.808 6.779 2.976 2.987 5.212 6.31 6.695 9.973 1.489 3.663 2.236 7.659 2.236 11.978 0 4.195-.739 8.128-2.229 11.767-1.483 3.631-3.709 6.993-6.692 10.046-2.965 3.043-6.232 5.342-9.79 6.878-3.569 1.528-7.432 2.306-11.592 2.306-4.259 0-8.206-.764-11.834-2.278-3.604-1.522-6.913-3.807-9.892-6.832-2.973-3.046-5.209-6.383-6.685-10.032-1.486-3.646-2.226-7.596-2.226-11.855zm13.492 179.381c-1.118 4.002-3.375 11.837 3.316 11.837 1.451 0 3.299-.81 5.5-2.412 2.387-1.721 5.125-4.336 8.192-7.799 3.116-3.53 6.362-7.701 9.731-12.507 3.358-4.795 6.888-10.292 10.561-16.419a1.39 1.39 0 011.907-.484l12.451 9.237c.593.434.729 1.262.34 1.878-5.724 9.952-11.512 18.642-17.362 26.056-5.899 7.466-11.879 13.66-17.936 18.553l-.095.07c-6.057 4.908-12.269 8.602-18.634 11.077-17.713 6.86-45.682 5.742-53.691-14.929-5.062-13.054-.897-27.885 3.085-40.651l20.089-60.852c1.286-4.617 2.912-9.682 3.505-14.439.974-7.915-2.52-13.032-11.147-13.032h-17.562a1.402 1.402 0 01-1.395-1.399l.077-.484 4.617-16.801a1.39 1.39 0 011.356-1.02l89.743-2.815a1.39 1.39 0 011.434 1.34l-.063.445-38.019 125.55zm151.324-238.547C371.178 61.606 316.446 37.101 256 37.101c-60.446 0-115.174 24.501-154.784 64.112C61.606 140.822 37.101 195.554 37.101 256c0 60.446 24.505 115.178 64.115 154.784 39.606 39.61 94.338 64.115 154.784 64.115s115.178-24.505 154.787-64.115c39.611-39.61 64.112-94.338 64.112-154.784s-24.505-115.178-64.112-154.787z"/>
        </svg>
      </button>
      <div id="su-mo-mini-controls">
        <button class="su-mo-btn" id="su-mo-unminimize" title="${t('moExpand')}">▭</button>
        <button class="su-mo-btn" id="su-mo-mini-close" title="${t('moClose')}">✕</button>
      </div>
    </div>

    <div id="su-mo-body">
      <div class="su-mo-section" id="su-mo-year-section">
        <div class="su-mo-section-head">
          <input type="checkbox" class="su-mo-chk" id="su-mo-year-chk" checked />
          <span class="su-mo-section-title">${t('moYearSection')}</span>
        </div>
        <div class="su-mo-section-content">
          <div id="su-year-selected-display">${t('moNoYearSelected')}</div>
          <input type="range" id="su-year-slider" min="0" step="1" value="0" />
          <div id="su-year-slider-labels">
            <span id="su-year-slider-min"></span>
            <span id="su-year-slider-max"></span>
          </div>
          <div id="su-year-pills">
            <button class="su-year-pill" data-year="2000">2000</button>
            <button class="su-year-pill" data-year="2005">2005</button>
            <button class="su-year-pill" data-year="2010">2010</button>
            <button class="su-year-pill" data-year="2015">2015</button>
            <button class="su-year-pill" data-year="2020">2020</button>
          </div>
        </div>
      </div>

      <div class="su-mo-section su-disabled" id="su-mo-city-section"${!CITY_FEATURE_ENABLED ? ' style="display:none"' : ''}>
        <div class="su-mo-section-head">
          <input type="checkbox" class="su-mo-chk" id="su-mo-city-chk" />
          <span class="su-mo-section-title">${t('moCitySection')}</span>
        </div>
        <div class="su-mo-section-content">
          <div id="su-city-display">
            Praha <span class="su-city-badge">${t('moCitySelected')}</span>
          </div>
        </div>
      </div>

      <div class="su-mo-section" id="su-mo-comparison" style="display:none;">
        <div class="su-mo-section-head">
          <span class="su-mo-section-title">${t('moComparison')}</span>
        </div>
        <div id="su-mo-comp-content" class="su-mo-section-content"></div>
      </div>
    </div>
  `;

  // ── Interaction wiring ──────────────────────────────────────────────────────

  let selectedYear: number | null = null;

  const yearChk     = el.querySelector("#su-mo-year-chk") as HTMLInputElement;
  const cityChk     = el.querySelector("#su-mo-city-chk") as HTMLInputElement;
  const yearSection = el.querySelector("#su-mo-year-section")!;
  const citySection = el.querySelector("#su-mo-city-section")!;
  const yearSlider  = el.querySelector("#su-year-slider") as HTMLInputElement;
  const yearDisplay = el.querySelector("#su-year-selected-display")!;
  const miniFilters = el.querySelector("#su-mo-mini-filters")!;

  // Map slider integer index → actual dataset year (every position is valid).
  const availableYears = getAvailableYears();
  yearSlider.max = String(availableYears.length - 1);
  (el.querySelector("#su-year-slider-min") as HTMLElement).textContent =
    String(availableYears[0]);
  (el.querySelector("#su-year-slider-max") as HTMLElement).textContent =
    String(availableYears[availableYears.length - 1]);

  function updateSliderFill() {
    const idx = parseInt(yearSlider.value);
    const pct = availableYears.length > 1
      ? (idx / (availableYears.length - 1)) * 100
      : 0;
    yearSlider.style.setProperty('--su-slider-pct', `${pct}%`);
  }

  function updateMiniFilters() {
    if (yearChk.checked && selectedYear !== null) {
      miniFilters.innerHTML =
        `<button class="su-mini-year-btn">${selectedYear}</button>`;
    } else {
      miniFilters.innerHTML = '';
    }
  }

  function selectYear(year: number | null) {
    selectedYear = year;
    activeYear = year;  // sync module-level state for comparison renderers
    el.querySelectorAll<HTMLElement>(".su-year-pill").forEach((pill) => {
      pill.classList.toggle("su-active", parseInt(pill.dataset.year ?? "") === year);
    });
    if (year !== null) {
      yearDisplay.innerHTML = `
        <span class="su-year-display-label">${t('moSelectedYear')}</span>
        <span class="su-year-display-number">${year}</span>
      `;
      yearDisplay.classList.add("su-has-year");
    } else {
      yearDisplay.textContent = t('moNoYearSelected');
      yearDisplay.classList.remove("su-has-year");
    }
    updateMiniFilters();
    updateDetailComparison();
    renderListingComparisons();
  }

  yearChk.addEventListener("change", () => {
    yearSection.classList.toggle("su-disabled", !yearChk.checked);
    updateMiniFilters();
    updateDetailComparison();
    if (yearChk.checked && activeYear !== null) {
      renderListingComparisons();
    } else {
      clearListingComparisons();
    }
  });

  if (CITY_FEATURE_ENABLED) {
    cityChk.addEventListener("change", () => {
      citySection.classList.toggle("su-disabled", !cityChk.checked);
      updateMiniFilters();
    });
  }

  // Slider fires selectYear immediately — no confirm step needed.
  yearSlider.addEventListener("input", () => {
    updateSliderFill();
    selectYear(availableYears[parseInt(yearSlider.value)]);
  });

  // Pills snap the slider to the matching index and call selectYear.
  el.querySelectorAll<HTMLElement>(".su-year-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const year = parseInt(pill.dataset.year ?? "");
      const idx = availableYears.indexOf(year);
      if (idx >= 0) { yearSlider.value = String(idx); updateSliderFill(); }
      selectYear(year);
    });
  });

  el.querySelector("#su-mo-minimize")!.addEventListener("click", () => {
    updateMiniFilters();
    el.classList.add("su-minimized");
  });
  // Year pill in the mini bar expands the overlay.
  miniFilters.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("su-mini-year-btn")) {
      el.classList.remove("su-minimized");
    }
  });
  el.querySelector("#su-mo-unminimize")!.addEventListener("click", () => {
    el.classList.remove("su-minimized");
  });
  el.querySelector("#su-mo-close")!.addEventListener("click", hideMainOverlay);
  el.querySelector("#su-mo-mini-close")!.addEventListener("click", hideMainOverlay);

  // ⓘ buttons — show the info popup using the most-recently-rendered widget context.
  function openOverlayInfoPopup(e: MouseEvent) {
    e.stopPropagation();
    if (!latestPopupCtx) return;
    showInfoPopup(e.currentTarget as HTMLElement, latestPopupCtx);
  }
  el.querySelector("#su-mo-header-info")!.addEventListener("click", openOverlayInfoPopup);
  el.querySelector("#su-mo-mini-info")!.addEventListener("click", openOverlayInfoPopup);

  // Restore selected year if one was active before a rebuild (e.g. language switch).
  if (activeYear !== null) {
    selectedYear = activeYear;  // must be set before updateMiniFilters() reads it
    const idx = availableYears.indexOf(activeYear);
    if (idx >= 0) { yearSlider.value = String(idx); updateSliderFill(); }
    yearDisplay.innerHTML = `
      <span class="su-year-display-label">${t('moSelectedYear')}</span>
      <span class="su-year-display-number">${activeYear}</span>
    `;
    yearDisplay.classList.add("su-has-year");
    el.querySelectorAll<HTMLElement>(".su-year-pill").forEach((pill) => {
      pill.classList.toggle("su-active", parseInt(pill.dataset.year ?? "") === activeYear);
    });
    updateMiniFilters();
  }

  return el;
}

function showMainOverlay() {
  if (!mainOverlayEl) {
    mainOverlayEl = buildMainOverlay();
    document.body.appendChild(mainOverlayEl);
  }
  mainOverlayEl.classList.remove("su-mo-hidden");
  mainVisible = true;
  applyHighlights();  // includes renderListingComparisons
  updateDetailComparison();
}

function hideMainOverlay() {
  mainOverlayEl?.classList.add("su-mo-hidden");
  mainVisible = false;
  if (!debugVisible) removeHighlights();
}

// ─── Comparison CSS (listing-page inline widgets) ─────────────────────────────

function ensureComparisonCSS() {
  if (comparisonCSSInjected) return;
  comparisonCSSInjected = true;
  const style = document.createElement("style");
  // 4-line stacked widget — narrow footprint, no horizontal overflow.
  // Line 1: [NOW-YEAR]  price  (Burden X%)  ⓘ
  // Line 2: Mortgage:   payment/měs
  // Line 3: [CMP-YEAR] ↓X%  equiv-price  (Burden Y%)
  // Line 4: Mortgage:  ↓X%  hist-payment/měs
  style.textContent = `
    .su-comp-widget {
      display: inline-flex; flex-direction: column; gap: 4px;
      margin-top: 5px; padding: 7px 12px 7px 10px;
      background: #ffffff !important;
      border-left: 3px solid #dc2626 !important;
      border-radius: 0 9px 9px 0;
      font-family: 'Quicksand', system-ui, sans-serif !important;
      line-height: 1 !important;
      box-shadow: 0 1px 6px rgba(0,0,0,0.10);
      transition: opacity 0.2s;
      color: #111111 !important;
    }
    /* Map variant: block-level so it stacks below the price label;
       width: max-content prevents stretching inside the marker container. */
    .su-comp-widget-map {
      display: flex !important; flex-direction: column !important;
      width: max-content;
      align-self: flex-start;
      margin-top: 3px; padding: 4px 8px 4px 7px; gap: 2px;
      border-left-width: 2px !important;
      box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    }
    /* Block text-decoration and color cascade from parent card/link hover states */
    .su-comp-widget, .su-comp-widget * {
      text-decoration: none !important;
      font-style: normal !important;
    }
    .su-cw-row {
      display: flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    .su-cw-divider {
      border: none; border-top: 1px solid rgba(0,0,0,0.08); margin: 2px 0;
    }
    .su-cw-year {
      font-size: 12px; font-weight: 700 !important; letter-spacing: 0.04em;
      color: #ffffff !important; background: #dc2626 !important;
      border: 1px solid #dc2626 !important;
      padding: 2px 7px; border-radius: 4px;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .su-cw-year-hist {
      color: #dc2626 !important; background: rgba(220,38,38,0.08) !important;
      border-color: rgba(220,38,38,0.30) !important;
    }
    .su-cw-price {
      font-size: 14px; font-weight: 700 !important; color: #111111 !important;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-price-hist {
      font-size: 14px; font-weight: 700 !important; color: #dc2626 !important;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-burden {
      font-size: 11px; font-weight: 600 !important; color: #777777 !important;
    }
    .su-cw-mort-label {
      font-size: 10px; font-weight: 700 !important; letter-spacing: 0.05em; text-transform: uppercase;
      color: #aaaaaa !important; flex-shrink: 0;
    }
    .su-cw-mort {
      font-size: 13px; font-weight: 700 !important; color: #555555 !important;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-equiv-label {
      font-size: 10px; font-weight: 700 !important; letter-spacing: 0.05em; text-transform: uppercase;
      color: #dc2626 !important; flex-shrink: 0;
    }
    .su-cw-equiv-sep {
      font-size: 9px; font-weight: 600 !important; color: #bbbbbb !important; letter-spacing: 0.02em;
    }
    .su-cw-equiv-block {
      display: grid !important;
      grid-template-columns: auto auto 1fr;
      grid-template-rows: auto auto;
      column-gap: 6px; row-gap: 4px;
      align-items: center;
    }
    .su-cw-equiv-block > :nth-child(1) { grid-column: 1; grid-row: 1; }
    .su-cw-equiv-block > :nth-child(2) { grid-column: 2; grid-row: 1 / 3; align-self: center; }
    .su-cw-equiv-block > :nth-child(3) { grid-column: 3; grid-row: 1; }
    .su-cw-equiv-block > :nth-child(4) { grid-column: 1; grid-row: 2; }
    .su-cw-equiv-block > :nth-child(5) { grid-column: 3; grid-row: 2; }
    .su-cw-delta {
      font-size: 10px; font-weight: 700 !important; letter-spacing: 0.02em;
      padding: 1px 4px; border-radius: 3px;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .su-cw-dn { color: #16a34a !important; background: rgba(22,163,74,0.10) !important; }
    .su-cw-up { color: #dc2626 !important; background: rgba(220,38,38,0.10) !important; }
    .su-cw-info {
      color: #bbbbbb !important; cursor: pointer !important;
      margin-left: auto; flex-shrink: 0;
      background: none !important; border: none; padding: 0; line-height: 0;
      display: inline-flex; align-items: center; justify-content: center;
      pointer-events: auto !important;
    }
    .su-cw-info svg { pointer-events: none !important; }
    .su-cw-info:not(.su-info-pulse) svg path { fill: #bbbbbb !important; }
    .su-cw-info:not(.su-info-pulse):hover svg path { fill: #777777 !important; }
    @keyframes su-info-pulse-glow {
      0%, 100% { filter: none; }
      50%       { filter: drop-shadow(0 0 5px rgba(220,38,38,0.85)); }
    }
    @keyframes su-info-pulse-fill {
      0%, 100% { fill: #bbbbbb; }
      50%       { fill: #dc2626; }
    }
    .su-cw-info.su-info-pulse {
      animation: su-info-pulse-glow 3s ease-in-out 1;
      opacity: 1 !important;
    }
    .su-cw-info.su-info-pulse svg path {
      animation: su-info-pulse-fill 3s ease-in-out 1;
    }

    /* ── Info popup ── */
    #su-info-popup {
      position: fixed;
      width: 440px;
      max-width: 96vw;
      max-height: 80vh;
      overflow-y: auto;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      color: #111111;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.65;
      z-index: 2147483647;
      box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
      transform-origin: top right;
      animation: su-popup-in 0.15s ease-out;
    }
    #su-info-popup.su-popup-hidden { display: none; }
    @keyframes su-popup-in {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes su-popup-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    #su-popup-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px 9px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      cursor: grab; user-select: none;
    }
    #su-popup-header:active { cursor: grabbing; }
    #su-popup-title {
      font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: #888888;
    }
    #su-popup-close {
      background: none; border: none; color: #aaaaaa; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0 0 0 10px;
      transition: color 0.15s; font-family: inherit; flex-shrink: 0;
      pointer-events: auto !important;
    }
    #su-popup-close:hover { color: #111111; }
    #su-popup-body { padding: 12px 14px; }
    .su-pp-story-p {
      margin-bottom: 14px; color: #333333; font-size: 13px; font-weight: 600; line-height: 1.7;
    }
    .su-pp-num-hero {
      color: #dc2626 !important; font-weight: 700 !important; font-size: 15px !important;
      white-space: nowrap !important;
    }
    .su-pp-num-support {
      color: #111111 !important; font-weight: 700 !important;
      white-space: nowrap !important;
    }
    .su-pp-climax {
      margin: 18px 0 14px; color: #333333; font-size: 13px; font-weight: 600;
    }
    .su-pp-climax-muted { color: #777777; font-weight: 600; }
    .su-pp-climax-burden {
      color: #dc2626 !important; font-weight: 700 !important; font-size: 16px !important;
      white-space: nowrap !important;
    }
    .su-pp-punchline {
      border-left: 3px solid #dc2626;
      padding-left: 12px;
      margin: 4px 0 14px;
      color: #333333; font-size: 13px; font-weight: 600;
    }
    .su-pp-punchline-price {
      color: #dc2626 !important; font-weight: 700 !important; font-size: 16px !important;
      white-space: nowrap !important;
    }
    .su-pp-region-warn {
      font-size: 11px; font-style: italic; color: #aaaaaa; margin-bottom: 12px;
    }
    .su-pp-sources-line {
      display: block; font-size: 10px; color: #aaaaaa;
      margin-top: 16px; padding-top: 10px;
      border-top: 1px solid rgba(0,0,0,0.08);
    }
    .su-pp-widget-preview {
      display: flex; flex-direction: column; gap: 4px;
      padding: 7px 12px 7px 10px;
      background: rgba(0,0,0,0.03);
      border-left: 3px solid #dc2626;
      border-radius: 0 8px 8px 0;
    }
  `;
  document.head.appendChild(style);
}

// Renders a coloured arrow+percent delta badge used in both the inline widget
// and the popup widget preview.
function cwDelta(pct: number): string {
  const arrow = pct <= 0 ? '↓' : '↑';
  const cls   = pct <= 0 ? 'su-cw-dn' : 'su-cw-up';
  return `<span class="su-cw-delta ${cls}">${arrow}${Math.abs(pct).toFixed(0)}%</span>`;
}

// ─── Info popup ───────────────────────────────────────────────────────────────
// Single shared popup element, repositioned on every ⓘ click.

/** Make `popup` draggable by dragging `handle`. Clears `bottom` on first drag
 *  so the popup's position is fully determined by `top`+`left` afterwards. */
function makePopupDraggable(popup: HTMLElement, handle: HTMLElement): void {
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener('mousedown', (e) => {
    // Only drag on primary button; ignore clicks on the × close button.
    if (e.button !== 0 || (e.target as Element).closest('#su-popup-close')) return;
    e.preventDefault();
    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = popup.offsetLeft;
    startTop  = popup.offsetTop;
    handle.style.cursor = 'grabbing';

    const onMove = (e: MouseEvent) => {
      const newLeft = Math.max(0, Math.min(startLeft + e.clientX - startX, window.innerWidth  - popup.offsetWidth));
      const newTop  = Math.max(0, Math.min(startTop  + e.clientY - startY, window.innerHeight - popup.offsetHeight));
      popup.style.left   = `${newLeft}px`;
      popup.style.top    = `${newTop}px`;
      popup.style.bottom = '';
    };
    const onUp = () => {
      handle.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
// Context is stored in a WeakMap keyed on the ⓘ button element so no data
// needs to be serialised into the DOM.

let infoPopupEl: HTMLElement | null = null;
const _popupCtx = new WeakMap<HTMLElement, PopupCtx>();

function buildInfoPopup(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'su-info-popup';
  el.classList.add('su-popup-hidden');
  el.innerHTML = `
    <div id="su-popup-header">
      <span id="su-popup-title">${t('popupTitle')}</span>
      <button id="su-popup-close" title="${t('popupClose')}">✕</button>
    </div>
    <div id="su-popup-body"></div>
  `;
  el.querySelector('#su-popup-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    hideInfoPopup();
  });
  makePopupDraggable(el, el.querySelector('#su-popup-header')!);
  // Pause observer so appending the popup doesn't trigger a widget re-render loop.
  observer?.disconnect();
  document.body.appendChild(el);
  observer?.observe(document.body, { childList: true, subtree: true });
  return el;
}

function renderPopupContent(ctx: PopupCtx): void {
  const popup = infoPopupEl!;
  const { c, region, isEstimated, nowIndex, histIndex } = ctx;
  const lang = getLang();

  // Region name in the correct form for the active language
  const displayRegion = lang === 'cs'
    ? REGION_DISPLAY_NAMES_LOCATIVE[region]
    : REGION_DISPLAY_NAMES_EN[region];

  // Derived display values
  const priceGrowthPct = Math.round((nowIndex / histIndex - 1) * 100);
  const currentRatePct = (c.currentRate    * 100).toFixed(2);
  const histRatePct    = (c.historicalRate * 100).toFixed(2);
  const moreBurdensome = c.stressMultiplier >= 1.0;

  // ── Inline styling helpers ────────────────────────────────────────────────
  // !important guards against sreality's card :hover CSS fighting our styles.
  const hero       = (v: string) => `<span class="su-pp-num-hero">${v}</span>`;
  const supp       = (v: string) => `<span class="su-pp-num-support">${v}</span>`;
  const muted      = (v: string) => `<span class="su-pp-climax-muted">${v}</span>`;
  const burden     = (v: string) => `<span class="su-pp-climax-burden">${v}</span>`;
  const punchPrice = (v: string) => `<span class="su-pp-punchline-price">${v}</span>`;

  // ── Story narrative ───────────────────────────────────────────────────────
  let storyHtml: string;

  if (lang === 'cs') {
    const climaxLine = moreBurdensome
      ? `${muted('Z')} ${burden(formatBurdenPercent(c.historicalBurdenRatio))} ${muted('na')} ${burden(formatBurdenPercent(c.currentBurdenRatio))}. Bydlení je dnes ${hero(formatMultiplier(c.stressMultiplier))} náročnější než v roce ${c.comparisonYear}.`
      : `${muted('Z')} ${burden(formatBurdenPercent(c.historicalBurdenRatio))} ${muted('na')} ${burden(formatBurdenPercent(c.currentBurdenRatio))}. Bydlení je dnes mírně dostupnější než v roce ${c.comparisonYear}.`;

    storyHtml = `
      ${isEstimated ? `<p class="su-pp-region-warn">Region nebyl rozpoznán — počítáme s daty pro Prahu</p>` : ''}
      <p class="su-pp-story-p">
        Představte si mladý pár v ${displayRegion}. Oba vydělávají průměrnou mzdu — dohromady si čistě přinesou domů asi ${supp(formatCZK(c.currentHouseholdNetIncome))} měsíčně.
      </p>
      <p class="su-pp-story-p">
        Chtějí si koupit tento byt za ${supp(formatCZK(c.currentPrice))}. Mají naspořeno na 10% zálohu, zbytek řeší hypotékou na 30 let se sazbou ${supp(currentRatePct + '%')}. Měsíční splátka: ${hero(formatCZK(c.currentMonthlyPayment))} — tedy ${hero(formatBurdenPercent(c.currentBurdenRatio))} jejich příjmu.
      </p>
      <p class="su-pp-story-p">
        Teď si představte stejný pár v roce ${c.comparisonYear}. Oba taky vydělávají průměrnou mzdu té doby — čistě dohromady ${supp(formatCZK(c.historicalHouseholdNetIncome))}. Stejný byt by je tehdy stál asi ${supp(formatCZK(c.historicalPrice))} (ceny nemovitostí v ${displayRegion} od té doby vzrostly o ${priceGrowthPct}%). Hypotéka se sazbou ${supp(histRatePct + '%')} by je vyšla na ${supp(formatCZK(c.historicalMonthlyPayment))} měsíčně — to je ${hero(formatBurdenPercent(c.historicalBurdenRatio))} jejich příjmu.
      </p>
      <p class="su-pp-climax">${climaxLine}</p>
      <p class="su-pp-punchline">
        Aby dnešní pár platil stejný podíl příjmu jako ten v ${c.comparisonYear}, musel by byt stát ${punchPrice(formatCZK(c.burdenEquivalentPrice))} místo ${supp(formatCZK(c.currentPrice))}.
      </p>
      <span class="su-pp-sources-line">Mzdy: ČSÚ · Sazby: Hypoindex/ČNB · Ceny: ČSÚ realizované transakce · v2026-04</span>
    `;
  } else {
    const climaxLine = moreBurdensome
      ? `${muted('From')} ${burden(formatBurdenPercent(c.historicalBurdenRatio))} ${muted('to')} ${burden(formatBurdenPercent(c.currentBurdenRatio))}. Housing today is ${hero(formatMultiplier(c.stressMultiplier))} more burdensome than in ${c.comparisonYear}.`
      : `${muted('From')} ${burden(formatBurdenPercent(c.historicalBurdenRatio))} ${muted('to')} ${burden(formatBurdenPercent(c.currentBurdenRatio))}. Housing today is slightly more affordable than in ${c.comparisonYear}.`;

    storyHtml = `
      ${isEstimated ? `<p class="su-pp-region-warn">Region not detected — using Prague data</p>` : ''}
      <p class="su-pp-story-p">
        Imagine a young couple in ${displayRegion}. Both earn average wages — together they take home about ${supp(formatCZK(c.currentHouseholdNetIncome))} per month.
      </p>
      <p class="su-pp-story-p">
        They want to buy this apartment for ${supp(formatCZK(c.currentPrice))}. They have saved for a 10% down payment, financing the rest with a 30-year mortgage at ${supp(currentRatePct + '%')}. Monthly payment: ${hero(formatCZK(c.currentMonthlyPayment))} — that's ${hero(formatBurdenPercent(c.currentBurdenRatio))} of their income.
      </p>
      <p class="su-pp-story-p">
        Now imagine the same couple in ${c.comparisonYear}. Both earn the average wage of that time — together ${supp(formatCZK(c.historicalHouseholdNetIncome))} net. The same apartment would have cost about ${supp(formatCZK(c.historicalPrice))} (property prices in ${displayRegion} have grown by ${priceGrowthPct}% since then). At a ${supp(histRatePct + '%')} rate, their mortgage would be ${supp(formatCZK(c.historicalMonthlyPayment))}/month — that's ${hero(formatBurdenPercent(c.historicalBurdenRatio))} of their income.
      </p>
      <p class="su-pp-climax">${climaxLine}</p>
      <p class="su-pp-punchline">
        For today's couple to carry the same burden as in ${c.comparisonYear}, this apartment would need to cost ${punchPrice(formatCZK(c.burdenEquivalentPrice))} instead of ${supp(formatCZK(c.currentPrice))}.
      </p>
      <span class="su-pp-sources-line">Wages: ČSÚ · Rates: Hypoindex/ČNB · Prices: ČSÚ realized transactions · v2026-04</span>
    `;
  }

  const body = popup.querySelector<HTMLElement>('#su-popup-body')!;
  body.innerHTML = storyHtml;
}

function positionPopup(anchor: HTMLElement): void {
  const popup = infoPopupEl!;
  const rect  = anchor.getBoundingClientRect();
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;
  const pW    = popup.offsetWidth  || 440;
  const pH    = popup.offsetHeight || 500;

  // Horizontal: open to the right of the anchor (doesn't cover the widget);
  // fall back to left side if not enough room to the right.
  const spaceRight = vw - rect.right - 8;
  const left = spaceRight >= pW
    ? rect.right + 8
    : Math.max(8, rect.left - pW - 8);

  // Vertical: prefer below anchor; flip above if not enough room; always clamp.
  const spaceBelow = vh - rect.bottom - 6;
  let top: number;
  if (spaceBelow >= pH) {
    top = rect.bottom + 6;                     // fits below
  } else if (rect.top - 6 >= pH) {
    top = rect.top - 6 - pH;                   // fits above
  } else {
    top = Math.max(8, vh - pH - 8);            // doesn't fit either way — best effort
  }
  top = Math.max(8, Math.min(top, vh - pH - 8));

  popup.style.left   = `${left}px`;
  popup.style.top    = `${top}px`;
  popup.style.bottom = '';
  popup.style.transformOrigin = spaceBelow >= pH ? 'top right' : 'bottom right';
}

function showInfoPopup(anchor: HTMLElement, ctx: PopupCtx): void {
  // Cancel any pending close animation — user re-opened before it finished.
  if (_hideTimer !== null) { clearTimeout(_hideTimer); _hideTimer = null; }
  ensureComparisonCSS();
  if (!infoPopupEl) infoPopupEl = buildInfoPopup();

  renderPopupContent(ctx);

  // Make visible but invisible so offsetHeight is measurable before positioning.
  infoPopupEl.classList.remove('su-popup-hidden');
  infoPopupEl.style.animation = 'none';
  infoPopupEl.style.opacity   = '0';
  void infoPopupEl.offsetHeight;  // force layout so dimensions are real

  positionPopup(anchor);          // now has true offsetWidth/offsetHeight

  // Re-trigger entrance animation.
  infoPopupEl.style.opacity = '';
  void infoPopupEl.offsetHeight;
  infoPopupEl.style.animation = '';
}

function hideInfoPopup(): void {
  if (!infoPopupEl || infoPopupEl.classList.contains('su-popup-hidden')) return;
  if (_hideTimer !== null) { clearTimeout(_hideTimer); _hideTimer = null; }
  infoPopupEl.style.animation = 'su-popup-out 0.1s ease-in forwards';
  const el = infoPopupEl;
  _hideTimer = setTimeout(() => {
    _hideTimer = null;
    if (el && !el.classList.contains('su-popup-hidden')) {
      el.classList.add('su-popup-hidden');
      el.style.animation = '';
    }
  }, 110);
}

// ─── Listing page comparison (inline widgets) ─────────────────────────────────

function clearListingComparisons() {
  for (const el of comparisonEls) el.remove();
  comparisonEls = [];
}

function renderListingComparisons() {
  // Pause the MutationObserver for the entire render pass.
  // Without this, removing old widgets + inserting new ones triggers the
  // observer, which re-fires applyHighlights() → renderListingComparisons()
  // 400 ms later — causing a feedback loop that also swallows the first ⓘ click.
  observer?.disconnect();
  try {
  // Suppress re-renders while the ⓘ pulse animation is playing (3 s window).
  // Destroying + recreating the button mid-animation causes visible flickering.
  // Widget data doesn't change in 3 s so skipping is safe.
  if (infoPulseActive) return;
  latestPopupCtx = null;   // reset so it gets re-populated from fresh widgets below
  clearListingComparisons();
  if (activeYear === null) return;

  // If the overlay exists but year section is unchecked, suppress widgets.
  const yearChk = mainOverlayEl?.querySelector<HTMLInputElement>("#su-mo-year-chk");
  if (mainOverlayEl && yearChk && !yearChk.checked) return;

  ensureComparisonCSS();

  for (const priceEl of highlightedEls) {
    // Skip elements inside our own overlays/popups.
    if (mainOverlayEl?.contains(priceEl) || debugOverlayEl?.contains(priceEl) || infoPopupEl?.contains(priceEl)) continue;

    // Skip rental prices — only purchase prices for now.
    const priceText = normalizePrice(priceEl.textContent ?? "");
    if (priceText.includes("/měs")) continue;

    const currentPrice = parseCzechPrice(priceText);
    if (currentPrice === null || currentPrice === 0) continue;

    const widget = document.createElement("div");
    widget.className = "su-comp-widget";

    try {
      // Per-card location → page location → Praha fallback.
      const cardLoc = extractLocationFromCard(priceEl);
      const region: CzechRegion = (cardLoc ?? detectedLocation)?.region ?? "praha";
      const isEstimated = !cardLoc && !detectedLocation;

      const c = computeBurdenComparison(currentPrice, activeYear, region);

      // Regional indices and wages for the info popup walkthrough.
      const nowRegional  = getRegionalData(CURRENT.year, region);
      const histRegional = getRegionalData(activeYear, region);

      // Deltas — all vs. current (line 1) values.
      const histPriceDeltaPct  = ((c.historicalPrice           - currentPrice)            / currentPrice)            * 100;
      const histPayDeltaPct    = ((c.historicalMonthlyPayment  - c.currentMonthlyPayment) / c.currentMonthlyPayment) * 100;
      const equivPriceDeltaPct = ((c.burdenEquivalentPrice     - currentPrice)            / currentPrice)            * 100;
      const equivPayDeltaPct   = ((c.burdenEquivalentPayment   - c.currentMonthlyPayment) / c.currentMonthlyPayment) * 100;

      if (isInMap(priceEl)) {
        // ── Map pin variant: equiv section only, no ⓘ ─────────────────────
        widget.classList.add('su-comp-widget-map');
        widget.innerHTML =
          `<div class="su-cw-equiv-block">` +
            `<span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>` +
            `${cwDelta(equivPriceDeltaPct)}` +
            `<span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `<span class="su-cw-mort">${formatCZK(c.burdenEquivalentPayment)}${t('widgetPerMonth')}</span>` +
          `</div>`;
      } else {
        // ── Full 3-section variant ─────────────────────────────────────────
        const infoSvg =
          `<svg width="18" height="18" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">` +
            `<path fill="#bbbbbb" fill-rule="nonzero" d="M256 0c70.691 0 134.695 28.656 181.021 74.979C483.344 121.305 512 185.309 512 256c0 70.691-28.656 134.695-74.979 181.018C390.695 483.344 326.691 512 256 512c-70.691 0-134.695-28.656-181.018-74.982C28.656 390.695 0 326.691 0 256S28.656 121.305 74.982 74.979C121.305 28.656 185.309 0 256 0zm-10.029 160.379c0-4.319.761-8.315 2.282-11.988 1.515-3.66 3.797-6.994 6.836-9.98 3.028-2.98 6.341-5.241 9.916-6.758 3.593-1.511 7.463-2.282 11.603-2.282 4.143 0 8.006.771 11.564 2.278 3.561 1.521 6.828 3.782 9.808 6.779 2.976 2.987 5.212 6.31 6.695 9.973 1.489 3.663 2.236 7.659 2.236 11.978 0 4.195-.739 8.128-2.229 11.767-1.483 3.631-3.709 6.993-6.692 10.046-2.965 3.043-6.232 5.342-9.79 6.878-3.569 1.528-7.432 2.306-11.592 2.306-4.259 0-8.206-.764-11.834-2.278-3.604-1.522-6.913-3.807-9.892-6.832-2.973-3.046-5.209-6.383-6.685-10.032-1.486-3.646-2.226-7.596-2.226-11.855zm13.492 179.381c-1.118 4.002-3.375 11.837 3.316 11.837 1.451 0 3.299-.81 5.5-2.412 2.387-1.721 5.125-4.336 8.192-7.799 3.116-3.53 6.362-7.701 9.731-12.507 3.358-4.795 6.888-10.292 10.561-16.419a1.39 1.39 0 011.907-.484l12.451 9.237c.593.434.729 1.262.34 1.878-5.724 9.952-11.512 18.642-17.362 26.056-5.899 7.466-11.879 13.66-17.936 18.553l-.095.07c-6.057 4.908-12.269 8.602-18.634 11.077-17.713 6.86-45.682 5.742-53.691-14.929-5.062-13.054-.897-27.885 3.085-40.651l20.089-60.852c1.286-4.617 2.912-9.682 3.505-14.439.974-7.915-2.52-13.032-11.147-13.032h-17.562a1.402 1.402 0 01-1.395-1.399l.077-.484 4.617-16.801a1.39 1.39 0 011.356-1.02l89.743-2.815a1.39 1.39 0 011.434 1.34l-.063.445-38.019 125.55zm151.324-238.547C371.178 61.606 316.446 37.101 256 37.101c-60.446 0-115.174 24.501-154.784 64.112C61.606 140.822 37.101 195.554 37.101 256c0 60.446 24.505 115.178 64.115 154.784 39.606 39.61 94.338 64.115 154.784 64.115s115.178-24.505 154.787-64.115c39.611-39.61 64.112-94.338 64.112-154.784s-24.505-115.178-64.112-154.787z"/>` +
          `</svg>`;

        widget.innerHTML =
          // ── Section 1: today ──────────────────────────────────────────────
          `<div class="su-cw-row">` +
            `<span class="su-cw-year">${CURRENT.year}</span>` +
            `<span class="su-cw-price">${formatCZK(currentPrice)}</span>` +
            `<span class="su-cw-burden">(${t('widgetBurden')} ${formatBurdenPercent(c.currentBurdenRatio)})</span>` +
            `<button class="su-cw-info" title="${t('widgetInfoTooltip')}">${infoSvg}</button>` +
          `</div>` +
          `<div class="su-cw-row">` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `<span class="su-cw-mort">${formatCZK(c.currentMonthlyPayment)}${t('widgetPerMonth')}</span>` +
          `</div>` +

          // ── Section 2: historical reality ─────────────────────────────────
          `<hr class="su-cw-divider" />` +
          `<div class="su-cw-row">` +
            `<span class="su-cw-year su-cw-year-hist">${activeYear}</span>` +
            `${cwDelta(histPriceDeltaPct)}` +
            `<span class="su-cw-price-hist">${formatCZK(c.historicalPrice)}</span>` +
            `<span class="su-cw-burden">(${t('widgetBurden')} ${formatBurdenPercent(c.historicalBurdenRatio)})</span>` +
          `</div>` +
          `<div class="su-cw-row">` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `${cwDelta(histPayDeltaPct)}` +
            `<span class="su-cw-mort">${formatCZK(c.historicalMonthlyPayment)}${t('widgetPerMonth')}</span>` +
          `</div>` +

          // ── Section 3: burden-equivalent — the punchline ──────────────────
          `<hr class="su-cw-divider" />` +
          `<div class="su-cw-equiv-sep">${t('widgetEquivSep')}</div>` +
          `<div class="su-cw-equiv-block">` +
            `<span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>` +
            `${cwDelta(equivPriceDeltaPct)}` +
            `<span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `<span class="su-cw-mort">${formatCZK(c.burdenEquivalentPayment)}${t('widgetPerMonth')}</span>` +
          `</div>`;

        // Attach popup context to the ⓘ button and wire up the click handler.
        const infoBtn = widget.querySelector<HTMLElement>('.su-cw-info')!;
        const popupCtx: PopupCtx = {
          c, region, isEstimated,
          nowIndex:  nowRegional.priceIndex,
          histIndex: histRegional.priceIndex,
          nowWage:   nowRegional.avgWage,
          histWage:  histRegional.avgWage,
        };
        _popupCtx.set(infoBtn, popupCtx);
        // Mark + schedule the pulse sequence for the first widget on detail pages.
        // Always re-stamp the ID so the timer finds the current DOM node after re-renders.
        // Only start a new sequence when the URL changes (new listing).
        if (isDetailPage() && !infoIconSeen && latestPopupCtx === null) {
          infoBtn.id = 'su-pulse-target';
          if (location.href !== infoPulseHref) {
            // New listing — start a fresh sequence.
            cancelPulseSequence();
            infoPulseHref = location.href;
            startPulseSequence();
          }
        }
        // Track the most recent context so the main overlay ⓘ button can use it.
        if (latestPopupCtx === null) latestPopupCtx = popupCtx;
        // Stop both mousedown and click so sreality's card navigation
        // (which can fire on mousedown in React SPAs) never reaches the <a>.
        infoBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Stop the pulse sequence and mark as permanently seen.
          infoBtn.classList.remove('su-info-pulse');
          cancelPulseSequence();
          if (!infoIconSeen) {
            infoIconSeen = true;
            chrome.storage.local.set({ infoIconSeen: true });
          }
          const ctx = _popupCtx.get(infoBtn);
          if (ctx) showInfoPopup(infoBtn, ctx);
        });
      }
    } catch {
      widget.innerHTML =
        `<span class="su-cw-year">${activeYear}</span>` +
        `<span style="font-size:11px;font-style:italic;color:#9a8268;">${t('widgetNoData')}</span>`;
    }

    priceEl.after(widget);
    comparisonEls.push(widget);
  }
  } finally {
    observer?.observe(document.body, { childList: true, subtree: true });
  }
}

// ─── Detail page comparison (inside main overlay) ─────────────────────────────

function updateDetailComparison() {
  if (!mainOverlayEl) return;
  const section  = mainOverlayEl.querySelector<HTMLElement>("#su-mo-comparison");
  const content  = mainOverlayEl.querySelector<HTMLElement>("#su-mo-comp-content");
  if (!section || !content) return;

  const yearChk = mainOverlayEl.querySelector<HTMLInputElement>("#su-mo-year-chk");

  if (!isDetailPage() || !yearChk?.checked || activeYear === null) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";

  const prices    = scanDetailPage();
  const mainEntry = prices.find((p) => p.source === "Hlavní cena")
                 ?? prices.find((p) => p.source === "Celková cena")
                 ?? prices[0];

  if (!mainEntry) {
    content.innerHTML = `<div class="su-comp-nodata">${t('compNoPrice')}</div>`;
    return;
  }

  const currentPrice = parseCzechPrice(mainEntry.value);
  if (currentPrice === null || currentPrice === 0) {
    content.innerHTML = `<div class="su-comp-nodata">${t('compCantParse')}</div>`;
    return;
  }

  const region: CzechRegion = detectedLocation?.region ?? "praha";
  const isEstimated = !detectedLocation;

  try {
    const c = computeBurdenComparison(currentPrice, activeYear, region);

    // Keep latestPopupCtx current so the main overlay ⓘ button works on detail pages.
    const nowRegional  = getRegionalData(CURRENT.year, region);
    const histRegional = getRegionalData(activeYear, region);
    latestPopupCtx = {
      c, region, isEstimated,
      nowIndex:  nowRegional.priceIndex,
      histIndex: histRegional.priceIndex,
      nowWage:   nowRegional.avgWage,
      histWage:  histRegional.avgWage,
    };

    const histPriceDeltaPct  = ((c.historicalPrice           - currentPrice)            / currentPrice)            * 100;
    const histPayDeltaPct    = ((c.historicalMonthlyPayment  - c.currentMonthlyPayment) / c.currentMonthlyPayment) * 100;
    const equivPriceDeltaPct = ((c.burdenEquivalentPrice     - currentPrice)            / currentPrice)            * 100;
    const equivPayDeltaPct   = ((c.burdenEquivalentPayment   - c.currentMonthlyPayment) / c.currentMonthlyPayment) * 100;

    content.innerHTML = `
      <div class="su-pp-widget-preview">
        <div class="su-cw-row">
          <span class="su-cw-year">${CURRENT.year}</span>
          <span class="su-cw-price">${formatCZK(currentPrice)}</span>
          <span class="su-cw-burden">(${t('widgetBurden')} ${formatBurdenPercent(c.currentBurdenRatio)})</span>
        </div>
        <div class="su-cw-row">
          <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
          <span class="su-cw-mort">${formatCZK(c.currentMonthlyPayment)}${t('widgetPerMonth')}</span>
        </div>
        <hr class="su-cw-divider" />
        <div class="su-cw-row">
          <span class="su-cw-year su-cw-year-hist">${activeYear}</span>
          ${cwDelta(histPriceDeltaPct)}
          <span class="su-cw-price-hist">${formatCZK(c.historicalPrice)}</span>
          <span class="su-cw-burden">(${t('widgetBurden')} ${formatBurdenPercent(c.historicalBurdenRatio)})</span>
        </div>
        <div class="su-cw-row">
          <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
          ${cwDelta(histPayDeltaPct)}
          <span class="su-cw-mort">${formatCZK(c.historicalMonthlyPayment)}${t('widgetPerMonth')}</span>
        </div>
        <hr class="su-cw-divider" />
        <div class="su-cw-equiv-sep">${t('widgetEquivSep')}</div>
        <div class="su-cw-equiv-block">
          <span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>
          ${cwDelta(equivPriceDeltaPct)}
          <span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>
          <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
          <span class="su-cw-mort">${formatCZK(c.burdenEquivalentPayment)}${t('widgetPerMonth')}</span>
        </div>
        ${isEstimated
          ? `<div class="su-comp-nodata" style="margin-top:4px;">${t('compRegionEst')}</div>`
          : ""}
      </div>
    `;
  } catch {
    content.innerHTML = `<div class="su-comp-nodata">${t('compNoData', activeYear!)}</div>`;
  }
}

// ─── Ad removal ──────────────────────────────────────────────────────────────

// Walks up from el until parent has 3+ children (i.e. we're inside a grid/list item).
// minDepth prevents stopping too early — e.g. when el itself is already inside a
// multi-child row (which would return el before reaching the actual card root).
function findCardContainer(el: Element, minDepth = 4): Element | null {
  let current: Element = el;
  for (let i = 0; i < 14; i++) {
    const parent = current.parentElement;
    if (!parent || parent === document.body) return null;
    if (i >= minDepth && parent.children.length >= 3) return current;
    current = parent;
  }
  return null;
}

function removeAdCards() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    const parent = walker.currentNode.parentElement;
    if (!parent) continue;

    // "TIP:" promoted cards
    if (text === "TIP:") {
      const card = findCardContainer(parent);
      card?.remove();
      continue;
    }

    // "Reklama" ad listings — anchor on the link text to avoid false positives
    if (text === "Reklama" && parent.tagName === "A") {
      const card = findCardContainer(parent);
      card?.remove();
    }
  }
}

removeAdCards();

// ─── MutationObserver (SPA navigation / lazy-loaded content) ─────────────────

let debounceTimer: ReturnType<typeof setTimeout>;

observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    removeAdCards();
    if (debugVisible) {
      applyHighlights();  // populates highlightedEls + detectedLocation
      renderDebugFull();
    } else if (mainVisible) {
      applyHighlights();  // includes renderListingComparisons
    }
    // Re-run detail comparison if DOM changed (e.g. lazy-loaded content).
    if (mainVisible && isDetailPage()) updateDetailComparison();
  }, 400);
});

observer.observe(document.body, { childList: true, subtree: true });

// ─── Auto-open on page load ───────────────────────────────────────────────────

chrome.storage.sync.get({ autoOpen: true, lang: 'cs' }, (settings) => {
  setLang((settings.lang as Lang) ?? 'cs');
  if (settings.autoOpen) {
    activeYear = 2015;  // default comparison year on page load
    showMainOverlay();
    mainOverlayEl!.classList.add("su-minimized");  // start collapsed on auto-open
  }
});

// Dismiss the info popup when clicking anywhere outside it.
// Uses capture phase for broad coverage, but explicitly ignores clicks on the
// ⓘ button itself — those are handled by the button's own click listener.
// (bubble-phase stopPropagation cannot cancel a capture-phase listener.)
document.addEventListener('click', (e) => {
  if (infoPopupEl && !infoPopupEl.classList.contains('su-popup-hidden')) {
    const target = e.target as Node;
    const onInfoBtn = target instanceof Element && !!target.closest('.su-cw-info');
    if (!infoPopupEl.contains(target) && !onInfoBtn) hideInfoPopup();
  }
}, true);

// Close info popup and/or about overlay on Escape key.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideInfoPopup(); hideAboutOverlay(); }
});

// ─── About overlay ────────────────────────────────────────────────────────────

let aboutCSSInjected = false;

function ensureAboutCSS() {
  if (aboutCSSInjected) return;
  aboutCSSInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    #su-about-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 2147483646;
      animation: su-about-bd-in 0.15s ease-out;
    }
    @keyframes su-about-bd-in {
      from { opacity: 0; } to { opacity: 1; }
    }
    #su-about-backdrop.su-hidden { display: none !important; }
    #su-about-panel {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 520px; max-width: 92vw;
      max-height: 82vh; overflow-y: auto;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 16px;
      color: #111111;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 13px; font-weight: 600; line-height: 1.7;
      z-index: 2147483647;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08);
      animation: su-about-in 0.15s ease-out;
    }
    @keyframes su-about-in {
      from { opacity: 0; transform: translate(-50%, calc(-50% + 6px)); }
      to   { opacity: 1; transform: translate(-50%, -50%); }
    }
    #su-about-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px 11px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      flex-shrink: 0;
    }
    #su-about-title {
      font-size: 13px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: #888888;
    }
    #su-about-close {
      background: none; border: none; color: #aaaaaa; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0 0 0 12px;
      transition: color 0.15s; font-family: inherit;
    }
    #su-about-close:hover { color: #111111; }
    #su-about-body { padding: 16px 20px 20px; }
    .su-ab-section-title {
      font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: #dc2626;
      border-bottom: 1px solid rgba(220,38,38,0.15);
      padding-bottom: 4px; margin-bottom: 9px;
    }
    .su-ab-section { margin-bottom: 20px; }
    .su-ab-section:last-child { margin-bottom: 0; }
    .su-ab-p {
      margin-bottom: 9px; color: #333333;
      font-size: 13px; font-weight: 600; line-height: 1.7;
    }
    .su-ab-p:last-child { margin-bottom: 0; }
    .su-ab-credits {
      margin-top: 12px; padding: 11px 14px;
      background: rgba(220,38,38,0.04);
      border: 1px solid rgba(220,38,38,0.14);
      border-radius: 10px;
      font-size: 12px; color: #555555;
    }
    .su-ab-credits strong { color: #111111; }
    .su-ab-list {
      margin: 6px 0 9px 0; padding-left: 16px;
      font-size: 13px; font-weight: 600; color: #333333; line-height: 1.7;
    }
    .su-ab-list li { margin-bottom: 2px; }
  `;
  document.head.appendChild(style);
}

function buildAboutOverlay(): HTMLElement {
  ensureAboutCSS();
  const lang = getLang();

  const backdrop = document.createElement('div');
  backdrop.id = 'su-about-backdrop';

  const panel = document.createElement('div');
  panel.id = 'su-about-panel';

  if (lang === 'cs') {
    panel.innerHTML = `
      <div id="su-about-header">
        <span id="su-about-title">O projektu</span>
        <button id="su-about-close" title="Zavřít">✕</button>
      </div>
      <div id="su-about-body">
        <div class="su-ab-section">
          <div class="su-ab-section-title">Jak se to počítá?</div>
          <p class="su-ab-p">Porovnáváme "zátížení bydlením" — jaký podíl svého čistého příjmu by domácnost dvou průměrně vydělávajících lidí věnovala splátce hypotéky. Tehdy a dnes.</p>
          <p class="su-ab-p">Pro každý byt vypočítáme splátku 30leté hypotéky s 10% zálohou při aktuální průměrné sazbě. Pak ji porovnáme s čistým příjmem domácnosti (2 × regionální průměrná mzda × 0,77). Výsledný podíl je "zátížení".</p>
          <p class="su-ab-p">"Ekvivalentní cena" je taková cena, při níž by dnešní domácnost platila stejný podíl příjmu jako domácnost v porovnávaném roce — tím ukazuje, jak moc jsou dnešní ceny mimo dosah.</p>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Data a omezení</div>
          <ul class="su-ab-list">
            <li><strong>Cenové indexy:</strong> ČSÚ — realizované transakce bytů</li>
            <li><strong>Průměrné mzdy:</strong> ČSÚ — regionální průměry</li>
            <li><strong>Hypoteční sazby:</strong> Hypoindex / ČNB</li>
          </ul>
          <p class="su-ab-p">Ceny jsou regionální průměry — prémiové čtvrti mohou být výrazně dražší. Historické ceny jsou odhady na základě indexů, ne skutečné ceny konkrétního bytu. Data za rok 2024 jsou předběžná. Model nezohledňuje různé doby splatnosti, bonitu žadatele ani daňové odpočty.</p>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Proč to vzniklo</div>
          <p class="su-ab-p">Spousta lidí popírá, jak vážná situace s dostupností bydlení je — nebo přičítá krizi osobnímu selhání. Tato aplikace nechává promluvit čísla: kolik procent průměrného příjmu spolkla splátka tehdy a kolik dnes.</p>
          <div class="su-ab-credits">
            Udělali jsme to společně: <strong>Wild</strong> (myšlenka, testování, frustrace z trhu) a <strong>Claude</strong> (kódování, modelování, matematika). Věříme, že data jasně ukazují — bydlení je krize, ne osobní problém.
          </div>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Upozornění</div>
          <p class="su-ab-p">Toto rozšíření není žádným způsobem spojeno se Sreality.cz ani Seznam.cz. Jde o nezávislý projekt třetí strany. Data ČSÚ jsou použita pouze pro informační účely.</p>
        </div>
      </div>
    `;
  } else {
    panel.innerHTML = `
      <div id="su-about-header">
        <span id="su-about-title">About</span>
        <button id="su-about-close" title="Close">✕</button>
      </div>
      <div id="su-about-body">
        <div class="su-ab-section">
          <div class="su-ab-section-title">How is it calculated?</div>
          <p class="su-ab-p">We compare "housing burden" — the share of net household income (two average earners) that would go toward mortgage payments. Then vs. now.</p>
          <p class="su-ab-p">For each property we calculate a 30-year mortgage with 10% down at the average rate for that year. We compare that to net household income (2 × regional average wage × 0.77). The resulting ratio is the "burden".</p>
          <p class="su-ab-p">The "equivalent price" is the price at which today's household would carry the same burden as in the comparison year — showing just how far prices have drifted beyond reach.</p>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Data & Limitations</div>
          <ul class="su-ab-list">
            <li><strong>Price indices:</strong> ČSÚ — realized apartment transactions</li>
            <li><strong>Average wages:</strong> ČSÚ — regional averages</li>
            <li><strong>Mortgage rates:</strong> Hypoindex / ČNB</li>
          </ul>
          <p class="su-ab-p">Prices are regional averages — premium neighborhoods may be significantly higher. Historical prices are index-based estimates, not actual prices for this specific property. 2024 data are preliminary. The model doesn't account for varying loan terms, creditworthiness, or tax deductions.</p>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Why it exists</div>
          <p class="su-ab-p">Many people deny how severe the housing affordability crisis is — or attribute it to personal failure. This app lets the numbers speak: what share of average income did a mortgage consume back then, and what share does it consume today.</p>
          <div class="su-ab-credits">
            Built together: <strong>Wild</strong> (idea, testing, frustration with the market) and <strong>Claude</strong> (coding, modelling, maths). We believe the data is clear — housing is a crisis, not a personal failure.
          </div>
        </div>
        <div class="su-ab-section">
          <div class="su-ab-section-title">Disclaimer</div>
          <p class="su-ab-p">This extension is not affiliated with, endorsed by, or connected to Sreality.cz or Seznam.cz in any way. It is an independent third-party project. ČSÚ data is used for informational purposes only.</p>
        </div>
      </div>
    `;
  }

  backdrop.appendChild(panel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideAboutOverlay();
  });
  panel.querySelector('#su-about-close')!.addEventListener('click', hideAboutOverlay);

  // Pause observer so appending the backdrop doesn't trigger a widget re-render loop.
  observer?.disconnect();
  document.body.appendChild(backdrop);
  observer?.observe(document.body, { childList: true, subtree: true });

  return backdrop;
}

function showAboutOverlay() {
  if (aboutOverlayEl) {
    // Rebuild fresh (language may have changed, content is static).
    aboutOverlayEl.remove();
    aboutOverlayEl = null;
  }
  aboutOverlayEl = buildAboutOverlay();
}

function hideAboutOverlay() {
  if (!aboutOverlayEl) return;
  aboutOverlayEl.remove();
  aboutOverlayEl = null;
}

// ─── Language switching ────────────────────────────────────────────────────────

/** Destroy and rebuild all injected UI so translations take effect immediately. */
function rebuildAllUI(): void {
  // Reset info popup singleton — rebuilt fresh on next ⓘ click.
  if (infoPopupEl) { infoPopupEl.remove(); infoPopupEl = null; }

  // Rebuild about overlay if it was open (content is language-sensitive).
  if (aboutOverlayEl) { aboutOverlayEl.remove(); aboutOverlayEl = null; }

  // Rebuild main overlay (showMainOverlay re-renders widgets via applyHighlights).
  if (mainOverlayEl) {
    const wasVisible = mainVisible;
    mainOverlayEl.remove();
    mainOverlayEl = null;
    mainVisible = false;
    clearListingComparisons();
    if (wasVisible) showMainOverlay();
  }

  // Rebuild debug overlay.
  if (debugOverlayEl) {
    const wasVisible = debugVisible;
    debugOverlayEl.remove();
    debugOverlayEl = null;
    debugVisible = false;
    if (wasVisible) showDebugOverlay();
  }
}

// Picks up language changes written by popup.ts to chrome.storage.sync.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.lang) return;
  setLang((changes.lang.newValue as Lang) ?? 'cs');
  rebuildAllUI();
});

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "toggle-overlay")                       toggleDebugOverlay();
  if (msg.type === "show-overlay")                         showMainOverlay();
  if (msg.type === "show-debugger" && DEBUGGER_FEATURE_ENABLED) showDebugOverlay();
  if (msg.type === "show-about")                           showAboutOverlay();
});
