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
import { t, setLang, type Lang } from "./i18n";

// Snapshot of current-year economic data. Evaluated once at module load — the
// page doesn't live long enough for this to become stale.
const CURRENT = getCurrentYearData();
import { type CzechRegion, type LocationResult, extractLocationFromDetail, extractLocationFromCard } from "./universes/location";

const VERSION = "0.5.0";

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

// Context object stored per ⓘ button — carries everything needed to render
// the full Czech walkthrough popup without re-computing anything.
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
  // Exclude both overlay panels so their price text doesn't get highlighted.
  const overlayExclusions: Element[] = [];
  if (mainOverlayEl) overlayExclusions.push(mainOverlayEl);
  if (debugOverlayEl) overlayExclusions.push(debugOverlayEl);

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
  clearListingComparisons();
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
      width: 320px;
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

    /* ── Minimized bar ── */
    #su-mo-mini {
      display: none; align-items: center;
      padding: 10px 14px; gap: 0;
    }
    #su-main-overlay.su-minimized #su-mo-header { display: none; }
    #su-main-overlay.su-minimized #su-mo-mini   { display: flex; }
    #su-main-overlay.su-minimized #su-mo-body   { display: none; }

    #su-mo-mini-label { font-size: 13px; font-weight: 700; color: #111111; white-space: nowrap; }
    #su-mo-mini-filters {
      font-size: 11px; font-weight: 700; color: #dc2626;
      flex: 1; padding: 0 8px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
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
        <span id="su-mo-name">Srealitky Universes</span>
        <span id="su-mo-version">v${VERSION}</span>
      </div>
      <div id="su-mo-controls">
        <button class="su-mo-btn" id="su-mo-minimize" title="${t('moMinimize')}">─</button>
        <button class="su-mo-btn" id="su-mo-close" title="${t('moClose')}">✕</button>
      </div>
    </div>

    <div id="su-mo-mini">
      <span id="su-mo-mini-label">Srealitky Universes</span>
      <span id="su-mo-mini-filters"></span>
      <div id="su-mo-mini-controls">
        <button class="su-mo-btn" id="su-mo-unminimize" title="${t('moExpand')}">□</button>
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

      <div class="su-mo-section su-disabled" id="su-mo-city-section">
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
    const parts: string[] = [];
    if (yearChk.checked && selectedYear !== null) parts.push(String(selectedYear));
    if (cityChk.checked) parts.push("Praha");
    miniFilters.textContent = parts.length > 0 ? "· " + parts.join(" · ") : "";
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

  cityChk.addEventListener("change", () => {
    citySection.classList.toggle("su-disabled", !cityChk.checked);
    updateMiniFilters();
  });

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
  el.querySelector("#su-mo-unminimize")!.addEventListener("click", () => {
    el.classList.remove("su-minimized");
  });
  el.querySelector("#su-mo-close")!.addEventListener("click", hideMainOverlay);
  el.querySelector("#su-mo-mini-close")!.addEventListener("click", hideMainOverlay);

  // Restore selected year if one was active before a rebuild (e.g. language switch).
  if (activeYear !== null) {
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
    .su-cw-delta {
      font-size: 10px; font-weight: 700 !important; letter-spacing: 0.02em;
      padding: 1px 4px; border-radius: 3px;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .su-cw-dn { color: #16a34a !important; background: rgba(22,163,74,0.10) !important; }
    .su-cw-up { color: #dc2626 !important; background: rgba(220,38,38,0.10) !important; }
    .su-cw-info {
      color: #bbbbbb !important; cursor: pointer;
      margin-left: auto; flex-shrink: 0;
      background: none !important; border: none; padding: 0; line-height: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: color 0.15s;
    }
    .su-cw-info:hover { color: #555555 !important; }

    /* ── Info popup ── */
    #su-info-popup {
      position: fixed;
      width: 550px;
      max-width: 96vw;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      color: #111111;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.6;
      z-index: 2147483647;
      box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
      transform-origin: top right;
      animation: su-popup-in 0.15s ease-out;
    }
    #su-info-popup.su-popup-hidden { display: none; }
    @keyframes su-popup-in {
      from { opacity: 0; transform: scale(0.95); }
      to   { opacity: 1; transform: scale(1); }
    }
    #su-popup-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px 9px;
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
      transition: color 0.15s; font-family: inherit;
    }
    #su-popup-close:hover { color: #111111; }
    #su-popup-body { padding: 12px 14px; }
    .su-pp-listing {
      font-size: 15px; font-weight: 700; color: #111111; margin-bottom: 12px;
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px;
    }
    .su-pp-listing-hist {
      font-size: 14px; font-weight: 700; color: #444444;
    }
    .su-pp-listing-region { font-size: 13px; font-weight: 600; color: #777777; }
    .su-pp-step { margin-bottom: 13px; }
    .su-pp-step-head {
      font-size: 14px; font-weight: 700; color: #111111; margin-bottom: 5px;
    }
    .su-pp-step-body {
      font-size: 14px; font-weight: 600; color: #222222; line-height: 1.65;
    }
    .su-pp-step-note {
      font-size: 12px; font-style: italic; color: #777777;
    }
    .su-pp-em { color: #dc2626; font-weight: 700; white-space: nowrap; }
    .su-pp-formula {
      font-family: 'Quicksand', monospace; font-weight: 700; font-size: 13px;
      background: rgba(0,0,0,0.04); border-radius: 5px;
      padding: 5px 9px; margin: 4px 0; display: block;
      color: #111111; line-height: 1.5;
    }
    .su-pp-widget-ref {
      display: inline-block; font-size: 11px; font-weight: 700;
      color: #888888; background: rgba(0,0,0,0.06);
      border-radius: 4px; padding: 1px 5px; margin-left: 4px;
      letter-spacing: 0.02em; vertical-align: middle;
    }
    .su-pp-result {
      margin-top: 12px; padding: 9px 12px;
      background: rgba(220,38,38,0.05);
      border: 1px solid rgba(220,38,38,0.20);
      border-radius: 7px;
      font-size: 14px; font-weight: 700; color: #111111; text-align: center;
    }
    .su-pp-warn {
      font-size: 12px; font-style: italic; color: #aaaaaa;
      margin-bottom: 10px;
    }
    .su-pp-widget-label {
      font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #aaaaaa; margin-top: 14px; margin-bottom: 6px;
    }
    .su-pp-widget-preview {
      display: flex; flex-direction: column; gap: 4px;
      padding: 7px 12px 7px 10px;
      background: #f7f7f7;
      border-left: 3px solid #dc2626;
      border-radius: 0 8px 8px 0;
    }
    #su-popup-data {
      border-top: 1px solid rgba(0,0,0,0.07);
      padding: 0;
    }
    #su-popup-data summary {
      padding: 8px 14px;
      font-size: 12px; font-weight: 700; letter-spacing: 0.03em;
      color: #aaaaaa; cursor: pointer; list-style: none;
      transition: color 0.15s;
    }
    #su-popup-data summary::-webkit-details-marker { display: none; }
    #su-popup-data[open] summary { color: #555555; }
    #su-popup-data summary:hover { color: #555555; }
    .su-pp-table {
      width: 100%; border-collapse: collapse;
      margin: 0 0 10px; font-size: 12px;
    }
    .su-pp-table th {
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: #aaaaaa;
      text-align: right; padding: 3px 14px 5px;
    }
    .su-pp-table th:first-child { text-align: left; }
    .su-pp-table td {
      padding: 3px 14px; color: #555555;
      text-align: right; font-variant-numeric: tabular-nums;
      border-top: 1px solid rgba(0,0,0,0.05);
    }
    .su-pp-table td:first-child { text-align: left; }
    .su-pp-table td.su-pp-td-em { color: #dc2626; font-weight: 700; }
    .su-pp-sources {
      padding: 0 14px 10px;
      font-size: 11px; color: #aaaaaa; line-height: 1.5;
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
      popup.style.left   = `${startLeft + e.clientX - startX}px`;
      popup.style.top    = `${startTop  + e.clientY - startY}px`;
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
    <details id="su-popup-data">
      <summary>${t('popupDataSummary')}</summary>
      <div id="su-popup-table-wrap"></div>
      <p class="su-pp-sources" id="su-popup-sources"></p>
    </details>
  `;
  el.querySelector('#su-popup-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    hideInfoPopup();
  });
  makePopupDraggable(el, el.querySelector('#su-popup-header')!);
  document.body.appendChild(el);
  return el;
}

function renderPopupContent(ctx: PopupCtx): void {
  const popup = infoPopupEl!;
  const { c, region, isEstimated, nowIndex, histIndex, nowWage, histWage } = ctx;

  const regionName  = REGION_DISPLAY_NAMES[region];
  const priceRatioN = nowIndex / histIndex;
  const priceRatioStr    = priceRatioN.toFixed(2);
  const priceGrowthPct   = ((priceRatioN - 1) * 100).toFixed(0);
  const histRatePct      = (c.historicalRate * 100).toFixed(2);
  const nowRatePct       = (c.currentRate    * 100).toFixed(2);

  // ── Derived deltas for the widget preview and walkthrough ────────────────
  // Section 2 (historical): hist price/payment vs. current
  const histPriceDeltaPct  = ((c.historicalPrice           - c.currentPrice)            / c.currentPrice)            * 100;
  const histPayDeltaPct    = ((c.historicalMonthlyPayment  - c.currentMonthlyPayment)   / c.currentMonthlyPayment)   * 100;
  // Section 3 (equiv): burden-equivalent price/payment vs. current
  const equivPriceDeltaPct = ((c.burdenEquivalentPrice     - c.currentPrice)            / c.currentPrice)            * 100;
  const equivPayDeltaPct   = ((c.burdenEquivalentPayment   - c.currentMonthlyPayment)   / c.currentMonthlyPayment)   * 100;

  // ── Body: step-by-step walkthrough ────────────────────────────────────────
  const body = popup.querySelector<HTMLElement>('#su-popup-body')!;

  const histPayArrow       = histPayDeltaPct    <= 0 ? '↓' : '↑';
  const absHistPayDelta    = Math.abs(histPayDeltaPct).toFixed(0);
  const equivPriceArrow    = equivPriceDeltaPct <= 0 ? '↓' : '↑';
  const absEquivPriceDelta = Math.abs(equivPriceDeltaPct).toFixed(0);
  const equivPayArrow      = equivPayDeltaPct   <= 0 ? '↓' : '↑';
  const absEquivPayDelta   = Math.abs(equivPayDeltaPct).toFixed(0);

  body.innerHTML = `
    ${isEstimated
      ? `<p class="su-pp-warn">${t('ppEstimatedRegion')}</p>`
      : ''}
    <div class="su-pp-listing">
      🏠 <span>${formatCZK(c.currentPrice)}</span>
      <span class="su-pp-listing-hist">${t('ppHistLabel', c.comparisonYear)} ${formatCZK(c.burdenEquivalentPrice)}</span>
      <span class="su-pp-listing-region">· ${regionName}</span>
    </div>

    <div class="su-pp-step">
      <div class="su-pp-step-head">${t('ppStep1Head')}</div>
      <div class="su-pp-step-body">
        ${t('ppStep1Payment', formatCZK(c.currentPrice), nowRatePct, formatCZK(c.currentMonthlyPayment))}<br>
        ${t('ppStep1Income', regionName, CURRENT.year, formatCZK(c.currentHouseholdNetIncome))}<br>
        <code class="su-pp-formula">
          ${t('ppBurdenFormula')} = ${formatCZK(c.currentMonthlyPayment)} ÷ ${formatCZK(c.currentHouseholdNetIncome)}
          = <span class="su-pp-em">${formatBurdenPercent(c.currentBurdenRatio)}</span>
        </code>
      </div>
    </div>

    <div class="su-pp-step">
      <div class="su-pp-step-head">${t('ppStep2Head', c.comparisonYear)}</div>
      <div class="su-pp-step-body">
        ${t('ppStep2Growth', regionName, c.comparisonYear, priceGrowthPct, formatCZK(c.historicalPrice))}<br>
        ${t('ppStep2Payment', formatCZK(c.historicalPrice), histRatePct, formatCZK(c.historicalMonthlyPayment))}
        <span class="su-pp-widget-ref">${t('ppWidgetMortRef', histPayArrow, absHistPayDelta)}</span><br>
        ${t('ppStep2Income', regionName, c.comparisonYear, formatCZK(c.historicalHouseholdNetIncome))}<br>
        <code class="su-pp-formula">
          ${t('ppBurdenFormula')} = ${formatCZK(c.historicalMonthlyPayment)} ÷ ${formatCZK(c.historicalHouseholdNetIncome)}
          = <span class="su-pp-em">${formatBurdenPercent(c.historicalBurdenRatio)}</span>
          <span class="su-pp-widget-ref">${t('ppWidgetBurdenRef', formatBurdenPercent(c.historicalBurdenRatio))}</span>
        </code>
      </div>
    </div>

    <div class="su-pp-step">
      <div class="su-pp-step-head">${t('ppStep3Head')}</div>
      <div class="su-pp-step-body">
        ${t('ppStep3Body', formatBurdenPercent(c.historicalBurdenRatio))}<br>
        <code class="su-pp-formula">
          ${formatCZK(c.currentPrice)} × (${formatBurdenPercent(c.historicalBurdenRatio)} ÷ ${formatBurdenPercent(c.currentBurdenRatio)})
          = <span class="su-pp-em">${formatCZK(c.burdenEquivalentPrice)}</span>
          <span class="su-pp-widget-ref">${t('ppWidgetPriceRef', equivPriceArrow, absEquivPriceDelta)}</span>
        </code>
        ${t('ppStep3Payment', formatCZK(c.burdenEquivalentPrice), nowRatePct, formatCZK(c.burdenEquivalentPayment))}
        <span class="su-pp-widget-ref">${t('ppWidgetMortRef', equivPayArrow, absEquivPayDelta)}</span><br>
        <span class="su-pp-step-note">${t('ppStep3Conclusion', formatCZK(c.burdenEquivalentPayment), formatCZK(c.currentMonthlyPayment))}</span>
      </div>
    </div>

    <div class="su-pp-result">
      ${t('ppResult', formatMultiplier(c.stressMultiplier), c.comparisonYear)}
    </div>

    <p class="su-pp-widget-label">${t('ppWidgetLabel')}</p>
    <div class="su-pp-widget-preview">
      <div class="su-cw-row">
        <span class="su-cw-year">${CURRENT.year}</span>
        <span class="su-cw-price">${formatCZK(c.currentPrice)}</span>
        <span class="su-cw-burden">(${t('widgetBurden')} ${formatBurdenPercent(c.currentBurdenRatio)})</span>
      </div>
      <div class="su-cw-row">
        <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
        <span class="su-cw-mort">${formatCZK(c.currentMonthlyPayment)}${t('widgetPerMonth')}</span>
      </div>
      <hr class="su-cw-divider" />
      <div class="su-cw-row">
        <span class="su-cw-year su-cw-year-hist">${c.comparisonYear}</span>
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
      <div class="su-cw-row">
        <span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>
        ${cwDelta(equivPriceDeltaPct)}
        <span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>
      </div>
      <div class="su-cw-row">
        <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
        ${cwDelta(equivPayDeltaPct)}
        <span class="su-cw-mort">${formatCZK(c.burdenEquivalentPayment)}${t('widgetPerMonth')}</span>
      </div>
    </div>
  `;

  // ── Data sources table ─────────────────────────────────────────────────────
  const tableWrap = popup.querySelector<HTMLElement>('#su-popup-table-wrap')!;
  tableWrap.innerHTML = `
    <table class="su-pp-table">
      <thead>
        <tr>
          <th></th>
          <th>${c.comparisonYear}</th>
          <th>${CURRENT.year}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${t('tableWageRow', regionName)}</td>
          <td>${formatCZK(histWage)}</td>
          <td class="su-pp-td-em">${formatCZK(nowWage)}</td>
        </tr>
        <tr>
          <td>${t('tableRateRow')}</td>
          <td>${histRatePct}%</td>
          <td class="su-pp-td-em">${nowRatePct}%</td>
        </tr>
        <tr>
          <td>${t('tablePriceIndexRow')}</td>
          <td>${Math.round(histIndex)}</td>
          <td class="su-pp-td-em">${Math.round(nowIndex)}</td>
        </tr>
      </tbody>
    </table>
  `;

  const sources = popup.querySelector<HTMLElement>('#su-popup-sources')!;
  sources.textContent = t('tableSources', DATA_VERSION);
}

function positionPopup(anchor: HTMLElement): void {
  const popup = infoPopupEl!;
  const rect  = anchor.getBoundingClientRect();
  const vw    = window.innerWidth;
  const vh    = window.innerHeight;
  const pW    = 550;  // max popup width

  // Prefer showing popup to the left of the anchor; flip right if too close to left edge.
  const leftIfLeft = rect.right - pW;
  const left = leftIfLeft >= 8 ? leftIfLeft : rect.left;

  // Prefer below; flip above if not enough space below.
  const spaceBelow = vh - rect.bottom;
  const top = spaceBelow >= 40 ? rect.bottom + 6 : rect.top - 6;
  const transformOrigin = spaceBelow >= 40 ? 'top right' : 'bottom right';

  popup.style.left   = `${Math.max(8, Math.min(left, vw - pW - 8))}px`;
  popup.style.top    = spaceBelow >= 40 ? `${top}px` : '';
  popup.style.bottom = spaceBelow < 40  ? `${vh - rect.top + 6}px` : '';
  popup.style.transformOrigin = transformOrigin;
}

function showInfoPopup(anchor: HTMLElement, ctx: PopupCtx): void {
  ensureComparisonCSS();
  if (!infoPopupEl) infoPopupEl = buildInfoPopup();

  renderPopupContent(ctx);
  positionPopup(anchor);

  // Re-trigger animation by removing and re-adding the element's animation.
  infoPopupEl.classList.remove('su-popup-hidden');
  infoPopupEl.style.animation = 'none';
  // Force reflow so the re-applied animation actually fires.
  void infoPopupEl.offsetHeight;
  infoPopupEl.style.animation = '';
}

function hideInfoPopup(): void {
  infoPopupEl?.classList.add('su-popup-hidden');
}

// ─── Listing page comparison (inline widgets) ─────────────────────────────────

function clearListingComparisons() {
  for (const el of comparisonEls) el.remove();
  comparisonEls = [];
}

function renderListingComparisons() {
  clearListingComparisons();
  if (activeYear === null) return;

  // If the overlay exists but year section is unchecked, suppress widgets.
  const yearChk = mainOverlayEl?.querySelector<HTMLInputElement>("#su-mo-year-chk");
  if (mainOverlayEl && yearChk && !yearChk.checked) return;

  ensureComparisonCSS();

  for (const priceEl of highlightedEls) {
    // Skip elements inside our own overlays.
    if (mainOverlayEl?.contains(priceEl) || debugOverlayEl?.contains(priceEl)) continue;

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
          `<div class="su-cw-row">` +
            `<span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>` +
            `${cwDelta(equivPriceDeltaPct)}` +
            `<span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>` +
          `</div>` +
          `<div class="su-cw-row">` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `${cwDelta(equivPayDeltaPct)}` +
            `<span class="su-cw-mort">${formatCZK(c.burdenEquivalentPayment)}${t('widgetPerMonth')}</span>` +
          `</div>`;
      } else {
        // ── Full 3-section variant ─────────────────────────────────────────
        const infoSvg =
          `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">` +
            `<circle cx="7" cy="7" r="6.25" stroke="currentColor" stroke-width="1.5"/>` +
            `<line x1="7" y1="6.5" x2="7" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` +
            `<circle cx="7" cy="4.25" r="0.85" fill="currentColor"/>` +
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
          `<div class="su-cw-row">` +
            `<span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>` +
            `${cwDelta(equivPriceDeltaPct)}` +
            `<span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>` +
          `</div>` +
          `<div class="su-cw-row">` +
            `<span class="su-cw-mort-label">${t('widgetMortgage')}</span>` +
            `${cwDelta(equivPayDeltaPct)}` +
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
        infoBtn.addEventListener('click', (e) => {
          e.stopPropagation();
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
        <div class="su-cw-row">
          <span class="su-cw-equiv-label">${t('widgetEquivLabel')}</span>
          ${cwDelta(equivPriceDeltaPct)}
          <span class="su-cw-price">${formatCZK(c.burdenEquivalentPrice)}</span>
        </div>
        <div class="su-cw-row">
          <span class="su-cw-mort-label">${t('widgetMortgage')}</span>
          ${cwDelta(equivPayDeltaPct)}
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

const observer = new MutationObserver(() => {
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

// ─── Language switching ────────────────────────────────────────────────────────

/** Destroy and rebuild all injected UI so translations take effect immediately. */
function rebuildAllUI(): void {
  // Reset info popup singleton — rebuilt fresh on next ⓘ click.
  if (infoPopupEl) { infoPopupEl.remove(); infoPopupEl = null; }

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
  if (msg.type === "toggle-overlay")  toggleDebugOverlay();
  if (msg.type === "show-overlay")    showMainOverlay();
  if (msg.type === "show-debugger")   showDebugOverlay();
});
