// Content script — injected into every sreality.cz page.

const VERSION = "0.1.9";

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

  // 2. "Celková cena:" — query <dt> by full textContent, read sibling <dd>.
  //    Uses querySelector("dd") on parent instead of nextElementSibling because
  //    Emotion injects a <style> tag between <dt> and <dd>.
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

  // 3. "Podobné inzeráty" — query heading tags by textContent, walk up 2 levels.
  const podobneEl = findElByContent("Podobné inzeráty", "h1,h2,h3,h4");
  if (podobneEl) add(collectPrices(nthAncestor(podobneEl, 2), "Podobné inzeráty", mortgageContainers));

  return results;
}

function scanPrices(): PriceEntry[] {
  return isDetailPage() ? scanDetailPage() : scanListingPage();
}

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
  // Always exclude the overlay itself so its price text doesn't get highlighted.
  const overlayExclusion = overlayEl ? [overlayEl] : [];

  if (isDetailPage()) {
    const mc = getMortgageContainers();
    mc.forEach((c) => highlightIn(c, overlayExclusion));

    const heading = document.querySelector("h1") ?? document.querySelector("h2");
    if (heading) highlightIn(nthAncestor(heading, 2), [...mc, ...overlayExclusion]);

    // Celková cena: directly highlight the <dd> — its content is obfuscated
    // character-by-character so the text-node walker won't match anything inside it.
    const celkovaDt = findElByContent("Celková cena:", "dt");
    if (celkovaDt) {
      const dd = celkovaDt.parentElement?.querySelector("dd");
      if (dd && !mc.some((ex) => ex.contains(dd)) && !overlayExclusion.some((ex) => ex.contains(dd))) {
        dd.classList.add(HIGHLIGHT_CLASS);
        highlightedEls.push(dd);
      }
    }

    const podobneEl = findElByContent("Podobné inzeráty", "h1,h2,h3,h4");
    if (podobneEl) highlightIn(nthAncestor(podobneEl, 2), [...mc, ...overlayExclusion]);
  } else {
    highlightIn(document.body, overlayExclusion);
  }
}

function removeHighlights() {
  for (const el of highlightedEls) el.classList.remove(HIGHLIGHT_CLASS);
  highlightedEls = [];
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

const OVERLAY_ID = "su-overlay";
let overlayEl: HTMLElement | null = null;
let visible = false;

function buildOverlay(): HTMLElement {
  const style = document.createElement("style");
  style.textContent = `
    #su-overlay {
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 300px;
      max-height: 440px;
      background: rgba(14, 12, 42, 0.93);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      overflow: hidden;
    }
    #su-overlay.su-hidden { display: none !important; }
    #su-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(56, 189, 248, 0.2);
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
      flex-shrink: 0;
    }
    #su-version {
      font-size: 10px;
      font-weight: 400;
      letter-spacing: 0.04em;
      color: #1354af;
      margin-left: 6px;
      text-transform: none;
    }
    #su-close {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 0 0 0 8px;
      transition: color 0.15s;
    }
    #su-close:hover { color: #f8fafc; }
    #su-price-list {
      overflow-y: auto;
      padding: 8px 14px;
      flex: 1;
    }
    .su-price-item {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 7px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      gap: 8px;
    }
    .su-price-item:last-child { border-bottom: none; }
    .su-price-value {
      color: #e2e8f0;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .su-price-source {
      color: #475569;
      font-size: 11px;
      text-align: right;
      flex-shrink: 0;
    }
    .su-empty {
      color: #475569;
      font-style: italic;
      margin: 6px 0;
    }
    #su-footer {
      padding: 7px 14px;
      border-top: 1px solid rgba(56, 189, 248, 0.15);
      font-size: 11px;
      color: #475569;
      flex-shrink: 0;
    }
    .su-hl {
      background-color: rgba(251, 146, 60, 0.28) !important;
      border-radius: 3px !important;
      outline: 1px solid rgba(251, 146, 60, 0.45) !important;
      outline-offset: 1px !important;
    }
  `;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.innerHTML = `
    <div id="su-header">
      <span>Srealitky Universes <span id="su-version">v${VERSION}</span></span>
      <button id="su-close" title="Close">✕</button>
    </div>
    <div id="su-price-list">
      <p class="su-empty">Scanning…</p>
    </div>
    <div id="su-footer">0 prices found</div>
  `;

  el.querySelector("#su-close")!.addEventListener("click", hideOverlay);
  return el;
}

function renderPrices(prices: PriceEntry[]) {
  if (!overlayEl) return;
  const list = overlayEl.querySelector("#su-price-list")!;
  const footer = overlayEl.querySelector("#su-footer")!;

  if (prices.length === 0) {
    list.innerHTML = `<p class="su-empty">No prices found on this page.</p>`;
    footer.textContent = "0 prices found";
    return;
  }

  list.innerHTML = prices
    .map(
      (p) => `
      <div class="su-price-item">
        <span class="su-price-value">${p.value}</span>
        <span class="su-price-source">${p.source}</span>
      </div>`
    )
    .join("");
  footer.textContent = `${prices.length} price${prices.length === 1 ? "" : "s"} found`;
}

function showOverlay() {
  if (!overlayEl) {
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
  }
  overlayEl.classList.remove("su-hidden");
  visible = true;
  renderPrices(scanPrices());
  applyHighlights();
}

function hideOverlay() {
  overlayEl?.classList.add("su-hidden");
  visible = false;
  removeHighlights();
}

function toggleOverlay() {
  visible ? hideOverlay() : showOverlay();
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
    if (visible) {
      renderPrices(scanPrices());
      applyHighlights();
    }
  }, 400);
});

observer.observe(document.body, { childList: true, subtree: true });

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "toggle-overlay") toggleOverlay();
});
