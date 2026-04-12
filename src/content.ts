// Content script — injected into every sreality.cz page.

import {
  computeBurdenComparison,
  formatCZK,
  formatBurdenPercent,
  formatMultiplier,
  parseCzechPrice,
} from "./universes/calc";
import { getCurrentYearData } from "./universes/data";

// Snapshot of current-year economic data. Evaluated once at module load — the
// page doesn't live long enough for this to become stale.
const CURRENT = getCurrentYearData();
import { type CzechRegion, type LocationResult, extractLocationFromDetail, extractLocationFromCard } from "./universes/location";

const VERSION = "0.3.2";

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
  .su-hl {
    background-color: rgba(251, 146, 60, 0.22) !important;
    border-radius: 3px !important;
    outline: 1.5px solid rgba(251, 146, 60, 0.5) !important;
    outline-offset: 2px !important;
  }
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
      background: rgba(28, 18, 8, 0.96);
      border: 1px solid rgba(249, 115, 22, 0.22);
      border-radius: 16px;
      color: #fef3c7;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 13px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.07);
      backdrop-filter: blur(10px);
      overflow: hidden;
    }
    #su-debug-overlay.su-hidden { display: none !important; }

    #su-dbg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 11px 14px 10px;
      border-bottom: 1px solid rgba(249,115,22,0.13);
      flex-shrink: 0;
    }
    #su-dbg-title-wrap { display: flex; align-items: center; gap: 7px; }
    #su-dbg-name {
      font-size: 12px;
      font-weight: 700;
      color: #fef3c7;
      letter-spacing: 0.01em;
    }
    #su-dbg-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
      color: #c4a882; background: rgba(249,115,22,0.08);
      border: 1px solid rgba(249,115,22,0.2); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-dbg-version {
      font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
      color: #fb923c; background: rgba(249,115,22,0.12);
      border: 1px solid rgba(249,115,22,0.35); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-dbg-close {
      background: none; border: none; color: #9a8268; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 2px 0 2px 8px;
      transition: color 0.15s; font-family: inherit;
    }
    #su-dbg-close:hover { color: #fef3c7; }

    #su-dbg-price-list {
      overflow-y: auto; padding: 6px 14px; flex: 1;
    }
    #su-dbg-price-list::-webkit-scrollbar { width: 3px; }
    #su-dbg-price-list::-webkit-scrollbar-track { background: transparent; }
    #su-dbg-price-list::-webkit-scrollbar-thumb { background: rgba(249,115,22,0.25); border-radius: 2px; }

    .su-dbg-price-item {
      display: flex; flex-direction: column; gap: 4px;
      padding: 8px 0; border-bottom: 1px solid rgba(249,115,22,0.09);
    }
    .su-dbg-price-item:last-child { border-bottom: none; }
    .su-dbg-pi-top {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
    }
    .su-dbg-price-value {
      color: #fef3c7; font-size: 15px; font-weight: 700;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .su-dbg-price-source {
      font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: #c4a882;
      background: rgba(249,115,22,0.08); border: 1px solid rgba(249,115,22,0.15);
      border-radius: 4px; padding: 3px 7px; white-space: nowrap; flex-shrink: 0;
    }
    .su-dbg-pi-loc {
      display: flex; justify-content: space-between; align-items: center; gap: 6px;
    }
    .su-dbg-loc-text {
      font-size: 11px; font-weight: 600; color: #c4a882;
    }
    .su-dbg-loc-src {
      font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #826650; background: rgba(249,115,22,0.05);
      border: 1px solid rgba(249,115,22,0.1); border-radius: 3px;
      padding: 1px 5px; white-space: nowrap; flex-shrink: 0;
    }
    .su-dbg-loc-none {
      font-size: 10px; font-style: italic; color: #826650;
    }
    .su-dbg-empty {
      color: #9a8268; font-style: italic; font-size: 12px;
      text-align: center; margin: 12px 0;
    }
    #su-dbg-footer {
      padding: 8px 14px; border-top: 1px solid rgba(249,115,22,0.1);
      font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
      color: #9a8268; text-align: center; flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "su-debug-overlay";
  el.innerHTML = `
    <div id="su-dbg-header">
      <div id="su-dbg-title-wrap">
        <span id="su-dbg-name">Price Debugger</span>
        <span id="su-dbg-badge">debug</span>
        <span id="su-dbg-version">v${VERSION}</span>
      </div>
      <button id="su-dbg-close" title="Close">✕</button>
    </div>
    <div id="su-dbg-price-list">
      <p class="su-dbg-empty">Scanning…</p>
    </div>
    <div id="su-dbg-footer">0 prices found</div>
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
      list.innerHTML = `<p class="su-dbg-empty">No prices found on this page.</p>`;
      footer.textContent = "0 prices";
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
      ? `${prices.length} price${prices.length === 1 ? "" : "s"} · ${loc.region} [${loc.source}]`
      : `${prices.length} price${prices.length === 1 ? "" : "s"} · location unknown`;
    return;
  }

  // Listing page: per-card location from each highlighted price element.
  // highlightedEls is populated by applyHighlights() before this runs.
  if (highlightedEls.length === 0) {
    list.innerHTML = `<p class="su-dbg-empty">No prices found on this page.</p>`;
    footer.textContent = "0 prices";
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
        : `<div class="su-dbg-pi-loc"><span class="su-dbg-loc-none">location unknown</span></div>`;

      return `
        <div class="su-dbg-price-item">
          <div class="su-dbg-pi-top">
            <span class="su-dbg-price-value">${price}</span>
          </div>
          ${locRow}
        </div>`;
    })
    .join("");

  footer.textContent = `${highlightedEls.length} price${highlightedEls.length === 1 ? "" : "s"} · ${located}/${highlightedEls.length} located`;
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
      background: rgba(28, 18, 8, 0.96);
      border: 1px solid rgba(249, 115, 22, 0.22);
      border-radius: 16px;
      color: #fef3c7;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 13px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(249,115,22,0.07);
      backdrop-filter: blur(10px);
      overflow: hidden;
    }
    #su-main-overlay.su-mo-hidden { display: none !important; }

    /* ── Header ── */
    #su-mo-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 14px 10px;
      border-bottom: 1px solid rgba(249,115,22,0.13);
      flex-shrink: 0;
    }
    #su-mo-title-wrap { display: flex; align-items: center; gap: 7px; }
    #su-mo-name { font-size: 12px; font-weight: 700; color: #fef3c7; letter-spacing: 0.01em; }
    #su-mo-version {
      font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
      color: #fb923c; background: rgba(249,115,22,0.12);
      border: 1px solid rgba(249,115,22,0.35); border-radius: 4px;
      padding: 2px 5px; text-transform: uppercase;
    }
    #su-mo-controls { display: flex; gap: 2px; }
    .su-mo-btn {
      background: none; border: none; color: #b89878; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 2px 5px;
      transition: color 0.15s; font-family: inherit; border-radius: 4px;
    }
    .su-mo-btn:hover { color: #fef3c7; }

    /* ── Minimized bar ── */
    #su-mo-mini {
      display: none; align-items: center;
      padding: 10px 14px; gap: 0;
    }
    #su-main-overlay.su-minimized #su-mo-header { display: none; }
    #su-main-overlay.su-minimized #su-mo-mini   { display: flex; }
    #su-main-overlay.su-minimized #su-mo-body   { display: none; }

    #su-mo-mini-label { font-size: 12px; font-weight: 700; color: #fef3c7; white-space: nowrap; }
    #su-mo-mini-filters {
      font-size: 10px; font-weight: 700; color: #fb923c;
      flex: 1; padding: 0 8px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #su-mo-mini-controls { display: flex; gap: 2px; flex-shrink: 0; }

    /* ── Body ── */
    #su-mo-body { padding: 4px 14px 12px; display: flex; flex-direction: column; }

    .su-mo-section {
      padding: 10px 0;
      border-bottom: 1px solid rgba(249,115,22,0.1);
    }
    .su-mo-section:last-child { border-bottom: none; padding-bottom: 2px; }

    .su-mo-section-head { display: flex; align-items: center; gap: 8px; }
    .su-mo-section-title {
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      color: #eacc98; text-transform: uppercase; cursor: default;
    }

    /* Section checkbox */
    .su-mo-chk {
      appearance: none; -webkit-appearance: none;
      width: 14px; height: 14px;
      border: 1.5px solid rgba(249,115,22,0.35); border-radius: 3px;
      background: rgba(249,115,22,0.06); cursor: pointer;
      flex-shrink: 0; position: relative;
      transition: background 0.15s, border-color 0.15s; margin: 0;
    }
    .su-mo-chk:checked { background: #f97316; border-color: #f97316; }
    .su-mo-chk:checked::after {
      content: ''; position: absolute;
      left: 3px; top: 0px; width: 5px; height: 8px;
      border: 2px solid #1c1208; border-top: none; border-left: none;
      transform: rotate(45deg);
    }

    .su-mo-section-content { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .su-mo-section.su-disabled .su-mo-section-content {
      opacity: 0.28; pointer-events: none;
    }

    /* Year selected display */
    #su-year-selected-display {
      font-size: 11px; font-weight: 600; color: #b09070;
      letter-spacing: 0.02em; min-height: 18px;
    }
    #su-year-selected-display.su-has-year {
      display: flex; flex-direction: column; align-items: center;
      background: rgba(249, 115, 22, 0.13);
      border: 1px solid rgba(249, 115, 22, 0.38);
      border-radius: 10px; padding: 8px 0 10px; min-height: auto;
    }
    .su-year-display-label {
      font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
      color: #c4a882; text-transform: uppercase; margin-bottom: 2px;
    }
    .su-year-display-number {
      font-size: 32px; font-weight: 700; color: #fb923c;
      font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: 0.04em;
    }

    /* Year input row */
    #su-year-input-row { display: flex; gap: 6px; align-items: stretch; }

    /* Year input */
    #su-year-input {
      flex: 1; min-width: 0; padding: 8px 11px;
      background: rgba(249,115,22,0.06);
      border: 1px solid rgba(249,115,22,0.2); border-radius: 8px;
      color: #fef3c7; font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 15px; font-weight: 700;
      font-variant-numeric: tabular-nums; letter-spacing: 0.1em;
      outline: none; transition: border-color 0.15s, background 0.15s;
    }
    #su-year-input::placeholder {
      color: #826650; font-weight: 400; letter-spacing: 0.02em; font-size: 13px;
    }
    #su-year-input:focus {
      border-color: rgba(249,115,22,0.45); background: rgba(249,115,22,0.09);
    }
    #su-year-input.su-valid {
      border-color: #f97316; background: rgba(249,115,22,0.12);
    }
    #su-year-input.su-invalid {
      border-color: rgba(220,80,60,0.5); background: rgba(220,80,60,0.06);
    }

    /* Confirm button */
    #su-year-confirm {
      width: 42px; flex-shrink: 0;
      background: rgba(249,115,22,0.07);
      border: 1px solid rgba(249,115,22,0.18); border-radius: 8px;
      color: #9a8268; font-size: 17px; font-weight: 700;
      cursor: not-allowed; transition: all 0.15s; font-family: inherit;
    }
    #su-year-confirm:not([disabled]) {
      background: rgba(249,115,22,0.18); border-color: rgba(249,115,22,0.5);
      color: #fb923c; cursor: pointer;
    }
    #su-year-confirm:not([disabled]):hover { background: #f97316; color: #1c1208; }

    /* Year pills */
    #su-year-pills { display: flex; gap: 5px; }
    .su-year-pill {
      flex: 1; padding: 5px 0; text-align: center;
      background: rgba(249,115,22,0.07); border: 1px solid rgba(249,115,22,0.16);
      border-radius: 6px; color: #c4a882;
      font-family: 'Quicksand', system-ui, sans-serif;
      font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 0.01em;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .su-year-pill:hover {
      background: rgba(249,115,22,0.16); border-color: rgba(249,115,22,0.38); color: #fef3c7;
    }
    .su-year-pill.su-active {
      background: rgba(249,115,22,0.22); border-color: #f97316; color: #fb923c;
    }

    /* City section */
    #su-city-display { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #d4b896; }
    .su-city-badge {
      font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #c4a882; background: rgba(249,115,22,0.07); border: 1px solid rgba(249,115,22,0.15);
      border-radius: 4px; padding: 2px 6px;
    }

    /* ── Comparison section (detail page) ── */
    #su-mo-comparison { padding-top: 0; }
    .su-comp-grid { display: flex; flex-direction: column; gap: 5px; }
    .su-comp-row {
      display: flex; align-items: baseline; gap: 6px;
    }
    .su-comp-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: #b09070; white-space: nowrap; flex-shrink: 0; min-width: 72px;
    }
    .su-comp-value {
      font-size: 13px; font-weight: 700; color: #fef3c7;
      font-variant-numeric: tabular-nums; flex: 1; text-align: right;
    }
    .su-comp-value-adj { color: #fb923c; }
    .su-comp-pct-tag {
      font-size: 10px; font-weight: 700; padding: 2px 5px;
      border-radius: 4px; flex-shrink: 0; white-space: nowrap;
    }
    .su-comp-pct-down { color: #4ade80; background: rgba(74,222,128,0.13); }
    .su-comp-pct-up   { color: #fb923c; background: rgba(249,115,22,0.13); }
    .su-comp-divider  { border: none; border-top: 1px solid rgba(249,115,22,0.1); margin: 3px 0; }
    .su-comp-nodata   { font-size: 11px; font-style: italic; color: #9a8268; text-align: center; padding: 4px 0; }
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
        <button class="su-mo-btn" id="su-mo-minimize" title="Minimize">─</button>
        <button class="su-mo-btn" id="su-mo-close" title="Close">✕</button>
      </div>
    </div>

    <div id="su-mo-mini">
      <span id="su-mo-mini-label">Srealitky Universes</span>
      <span id="su-mo-mini-filters"></span>
      <div id="su-mo-mini-controls">
        <button class="su-mo-btn" id="su-mo-unminimize" title="Expand">□</button>
        <button class="su-mo-btn" id="su-mo-mini-close" title="Close">✕</button>
      </div>
    </div>

    <div id="su-mo-body">
      <div class="su-mo-section" id="su-mo-year-section">
        <div class="su-mo-section-head">
          <input type="checkbox" class="su-mo-chk" id="su-mo-year-chk" checked />
          <span class="su-mo-section-title">Compare to a different year</span>
        </div>
        <div class="su-mo-section-content">
          <div id="su-year-selected-display">No year selected</div>
          <div id="su-year-input-row">
            <input
              type="text" id="su-year-input" maxlength="4"
              placeholder="type a year, e.g. 2013"
              inputmode="numeric" autocomplete="off"
            />
            <button id="su-year-confirm" disabled title="Confirm year (Enter)">✓</button>
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
          <span class="su-mo-section-title">Compare to a different city</span>
        </div>
        <div class="su-mo-section-content">
          <div id="su-city-display">
            Praha <span class="su-city-badge">selected</span>
          </div>
        </div>
      </div>

      <div class="su-mo-section" id="su-mo-comparison" style="display:none;">
        <div class="su-mo-section-head">
          <span class="su-mo-section-title">Comparison</span>
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
  const yearInput   = el.querySelector("#su-year-input") as HTMLInputElement;
  const confirmBtn  = el.querySelector("#su-year-confirm") as HTMLButtonElement;
  const yearDisplay = el.querySelector("#su-year-selected-display")!;
  const miniFilters = el.querySelector("#su-mo-mini-filters")!;

  function updateMiniFilters() {
    const parts: string[] = [];
    if (yearChk.checked && selectedYear !== null) parts.push(String(selectedYear));
    if (cityChk.checked) parts.push("Praha");
    miniFilters.textContent = parts.length > 0 ? "· " + parts.join(" · ") : "";
  }

  function isValidYear(y: number): boolean {
    return y >= 1990 && y <= new Date().getFullYear() - 1;
  }

  function selectYear(year: number | null) {
    selectedYear = year;
    activeYear = year;  // sync module-level state for comparison renderers
    el.querySelectorAll<HTMLElement>(".su-year-pill").forEach((pill) => {
      pill.classList.toggle("su-active", parseInt(pill.dataset.year ?? "") === year);
    });
    if (year !== null) {
      yearDisplay.innerHTML = `
        <span class="su-year-display-label">Selected year</span>
        <span class="su-year-display-number">${year}</span>
      `;
      yearDisplay.classList.add("su-has-year");
    } else {
      yearDisplay.textContent = "No year selected";
      yearDisplay.classList.remove("su-has-year");
    }
    updateMiniFilters();
    updateDetailComparison();
    renderListingComparisons();
  }

  function confirmYear() {
    const y = parseInt(yearInput.value);
    if (yearInput.value.length === 4 && isValidYear(y)) selectYear(y);
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

  // Validate only on input — do NOT auto-select; require explicit confirm.
  yearInput.addEventListener("input", () => {
    yearInput.value = yearInput.value.replace(/\D/g, "").slice(0, 4);
    // Clear any existing selection while the user is editing.
    if (selectedYear !== null) selectYear(null);
    const y = parseInt(yearInput.value);
    const is4 = yearInput.value.length === 4;
    const valid = is4 && isValidYear(y);
    yearInput.classList.toggle("su-valid", valid);
    yearInput.classList.toggle("su-invalid", is4 && !valid);
    confirmBtn.disabled = !valid;
  });

  yearInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmYear();
  });
  confirmBtn.addEventListener("click", confirmYear);

  // Pills are already an explicit click — no confirm step needed.
  el.querySelectorAll<HTMLElement>(".su-year-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const year = parseInt(pill.dataset.year ?? "");
      yearInput.value = String(year);
      yearInput.classList.remove("su-invalid");
      yearInput.classList.add("su-valid");
      confirmBtn.disabled = false;
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
      background: rgba(28,18,8,0.97);
      border-left: 3px solid rgba(249,115,22,0.6);
      border-radius: 0 9px 9px 0;
      font-family: 'Quicksand', system-ui, sans-serif;
      line-height: 1;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      transition: opacity 0.2s;
    }
    .su-cw-row {
      display: flex; align-items: center; gap: 6px; white-space: nowrap;
    }
    .su-cw-divider {
      border: none; border-top: 1px solid rgba(249,115,22,0.12); margin: 2px 0;
    }
    .su-cw-year {
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
      color: #fef3c7; background: rgba(249,115,22,0.2);
      border: 1px solid rgba(249,115,22,0.4);
      padding: 2px 7px; border-radius: 4px;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .su-cw-year-hist {
      color: #c4a882; background: rgba(249,115,22,0.08);
      border-color: rgba(249,115,22,0.18);
    }
    .su-cw-price {
      font-size: 13px; font-weight: 700; color: #fef3c7;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-price-hist {
      font-size: 13px; font-weight: 700; color: #fb923c;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-burden {
      font-size: 10px; font-weight: 600; color: #c4a882;
    }
    .su-cw-mort-label {
      font-size: 9px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #826650; flex-shrink: 0;
    }
    .su-cw-mort {
      font-size: 12px; font-weight: 700; color: #c4a882;
      font-variant-numeric: tabular-nums;
    }
    .su-cw-delta {
      font-size: 9px; font-weight: 700; letter-spacing: 0.02em;
      padding: 1px 4px; border-radius: 3px;
      font-variant-numeric: tabular-nums; flex-shrink: 0;
    }
    .su-cw-dn { color: #4ade80; background: rgba(74,222,128,0.13); }
    .su-cw-up { color: #fb923c; background: rgba(249,115,22,0.13); }
    .su-cw-info {
      font-size: 11px; color: #826650; cursor: help;
      margin-left: auto; flex-shrink: 0;
      transition: color 0.15s;
    }
    .su-cw-info:hover { color: #c4a882; }
  `;
  document.head.appendChild(style);
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

      // priceDelta and burdenDelta are mathematically identical (equiv price IS
      // derived from the burden ratio), so we only show one delta.
      const priceDeltaPct = ((c.burdenEquivalentPrice    - currentPrice)            / currentPrice)            * 100;
      const payDeltaPct   = ((c.historicalMonthlyPayment - c.currentMonthlyPayment) / c.currentMonthlyPayment) * 100;

      function delta(pct: number): string {
        const arrow = pct <= 0 ? "↓" : "↑";
        const cls   = pct <= 0 ? "su-cw-dn" : "su-cw-up";
        return `<span class="su-cw-delta ${cls}">${arrow}${Math.abs(pct).toFixed(0)}%</span>`;
      }

      const tooltip = `${isEstimated ? "Praha (est.)" : region} · ${(c.currentRate * 100).toFixed(2)}% now → ${(c.historicalRate * 100).toFixed(2)}% in ${activeYear}`;

      widget.innerHTML =
        // Line 1: current year — price + burden
        `<div class="su-cw-row">` +
          `<span class="su-cw-year">${CURRENT.year}</span>` +
          `<span class="su-cw-price">${formatCZK(currentPrice)}</span>` +
          `<span class="su-cw-burden">(Burden ${formatBurdenPercent(c.currentBurdenRatio)})</span>` +
          `<span class="su-cw-info" title="${tooltip}">ⓘ</span>` +
        `</div>` +
        // Line 2: current mortgage
        `<div class="su-cw-row">` +
          `<span class="su-cw-mort-label">Mortgage</span>` +
          `<span class="su-cw-mort">${formatCZK(c.currentMonthlyPayment)}/měs</span>` +
        `</div>` +
        `<hr class="su-cw-divider" />` +
        // Line 3: comparison year — delta + equiv price + burden
        `<div class="su-cw-row">` +
          `<span class="su-cw-year su-cw-year-hist">${activeYear}</span>` +
          `${delta(priceDeltaPct)}` +
          `<span class="su-cw-price-hist">${formatCZK(c.burdenEquivalentPrice)}</span>` +
          `<span class="su-cw-burden">(Burden ${formatBurdenPercent(c.historicalBurdenRatio)})</span>` +
        `</div>` +
        // Line 4: historical mortgage + delta
        `<div class="su-cw-row">` +
          `<span class="su-cw-mort-label">Mortgage</span>` +
          `${delta(payDeltaPct)}` +
          `<span class="su-cw-mort">${formatCZK(c.historicalMonthlyPayment)}/měs</span>` +
        `</div>`;
    } catch {
      widget.innerHTML =
        `<span class="su-cw-year">${activeYear}</span>` +
        `<span style="font-size:10px;font-style:italic;color:#9a8268;">no data</span>`;
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
    content.innerHTML = `<div class="su-comp-nodata">No price detected on this page</div>`;
    return;
  }

  const currentPrice = parseCzechPrice(mainEntry.value);
  if (currentPrice === null || currentPrice === 0) {
    content.innerHTML = `<div class="su-comp-nodata">Could not parse price</div>`;
    return;
  }

  const region: CzechRegion = detectedLocation?.region ?? "praha";
  const isEstimated = !detectedLocation;

  try {
    const c = computeBurdenComparison(currentPrice, activeYear, region);

    const stressLabel = c.stressMultiplier >= 1.0
      ? `${formatMultiplier(c.stressMultiplier)} more burdensome`
      : `${formatMultiplier(1 / c.stressMultiplier)} less burdensome`;
    const stressCls = c.stressMultiplier >= 1.0 ? "su-comp-pct-up" : "su-comp-pct-down";

    const equivPct = ((c.burdenEquivalentPrice - currentPrice) / currentPrice) * 100;
    const equivSign = equivPct < 0 ? "−" : "+";
    const equivCls  = equivPct < 0 ? "su-comp-pct-down" : "su-comp-pct-up";

    content.innerHTML = `
      <div class="su-comp-grid">
        <div class="su-comp-row">
          <span class="su-comp-label">Burden now</span>
          <span class="su-comp-value">${formatBurdenPercent(c.currentBurdenRatio)}</span>
        </div>
        <div class="su-comp-row">
          <span class="su-comp-label">${activeYear}</span>
          <span class="su-comp-value su-comp-value-adj">${formatBurdenPercent(c.historicalBurdenRatio)}</span>
          <span class="su-comp-pct-tag ${stressCls}">${stressLabel}</span>
        </div>
        <hr class="su-comp-divider" />
        <div class="su-comp-row">
          <span class="su-comp-label">Equiv. price</span>
          <span class="su-comp-value su-comp-value-adj">${formatCZK(c.burdenEquivalentPrice)}</span>
          <span class="su-comp-pct-tag ${equivCls}">${equivSign}${Math.abs(equivPct).toFixed(1)}%</span>
        </div>
        <hr class="su-comp-divider" />
        <div class="su-comp-row">
          <span class="su-comp-label">Payment now</span>
          <span class="su-comp-value">${formatCZK(c.currentMonthlyPayment)}/měs</span>
        </div>
        <div class="su-comp-row">
          <span class="su-comp-label">Payment ${activeYear}</span>
          <span class="su-comp-value su-comp-value-adj">${formatCZK(c.historicalMonthlyPayment)}/měs</span>
        </div>
        ${isEstimated
          ? `<div style="font-size:10px;color:#9a8268;text-align:center;margin-top:4px;">⚡ region estimated as Praha</div>`
          : ""}
      </div>
    `;
  } catch {
    content.innerHTML = `<div class="su-comp-nodata">No data available for ${activeYear}</div>`;
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

chrome.storage.sync.get({ autoOpen: true }, (settings) => {
  if (settings.autoOpen) showMainOverlay();
});

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "toggle-overlay")  toggleDebugOverlay();
  if (msg.type === "show-overlay")    showMainOverlay();
  if (msg.type === "show-debugger")   showDebugOverlay();
});
