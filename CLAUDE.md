# Srealitky Universes - Chrome Extension

## Project Purpose
Primary goal: Learning LLM-driven development through active exercises.
Secondary goal: Actually build and ship this extension.
→ Give extra transparency about how you operate and why you make decisions.

## What It Does
Chrome extension for sreality.cz that injects affordability context onto property listings.
Shows what a property would need to cost today for the mortgage burden to match a selected historical year.
Goal: viscerally communicate how bad Prague (and Czech) housing affordability has become.

## Current Status (2026-04-14): v1.0.3 — submitted to Chrome Web Store

### What's built and working
- Vite + TypeScript multi-entry build (content.ts, background.ts, popup.ts, i18n.ts)
- Manifest V3: popup, content script on sreality.cz, service worker
- Price detection: TreeWalker scan, handles sreality anti-scraping (U+200B, per-char obfuscated spans)
- No price highlights (`su-hl` class kept for tracking, visually invisible since v0.5.0)
- Main overlay (bottom-left, 360px wide):
  - Disclaimer at top: "Burden calculated for a couple where both partners earn the regional median wage."
  - Year selector pills (2000/2005/2010/2015/2020) + range slider; default year 2015 on auto-open
    - No checkbox — year section is always enabled
  - Auto-opens **minimized** on page load; mini bar shows year as red clickable pill
  - Mini bar: clicking anywhere expands; ✕ is the only way to fully close
  - Header X button minimizes (does NOT close); ─ also minimizes
  - Mini bar cursor: `pointer` when minimized
  - Burden chart section (between year selector and comparison):
    - SVG inline chart, X=2000–2026, Y=0–100% burden
    - Reference: `CHART_REF_PRICE = 13_000_000` CZK + `CHART_REF_REGION = 'praha'` (Praha 2+kk median)
    - Left of selected year: solid red line + red fill; right: dashed + lower opacity
    - Vertical divider at selected year; horizontal dashed reference line at 2026 burden level
    - Section title: "Zátěž hypotéky (Medián bytu)" / "Mortgage burden (Median Flat)"
    - Head badge below title: "YEAR: X% · 2026: Y%" — updates on every slider move
    - Legend below chart: "Bydlení je dnes 1.68× náročnější než v 2015" (red bold multiplier), i18n'd
  - Comparison section (detail page only): shows burden-equivalent price and payments
- Debug overlay (bottom-right): raw detected prices with source labels. **Hidden behind `DEBUGGER_FEATURE_ENABLED = false`.**
- About overlay: project info, math explanation, data sources, **disclaimer** (not affiliated with Sreality/Seznam), accessible via "O projektu" button in popup
- Inline comparison widgets: 4-line stacked widget per price
  - Line 1: year + price + (Burden X%) + ⓘ
  - Line 2: Mortgage: payment/měs
  - Divider
  - Line 3: histYear + ↓X% + equiv-price + (Burden Y%)
  - Line 4: Mortgage: ↓X% + hist-payment/měs
  - Map view: compact equiv-only variant stacked below price label
- Info popup (ⓘ icon):
  - Story-based "Jak se to počítá?" narrative — smart friend explaining the math, not a textbook
  - Dynamic numbers woven into a continuous story: young couple in {region}, wages, price, mortgage payment, burden ratio, stress multiplier, burden-equivalent price
  - Hero numbers (orange, large): current monthly payment, burden ratios, stress multiplier, equiv price
  - Supporting numbers (white, bold): current/historical price, household income, rates, historical payment
  - Comparison climax line + punchline line with left border
  - Source footnote (ČSÚ · Hypoindex/ČNB · ČSÚ · v2026-04)
  - Opens to the RIGHT of the widget (never covers it); falls back to left if no room
  - Positions using real offsetHeight (shown at opacity:0 first); always fits in viewport
  - Drag bounded to viewport — can't be pulled off screen
  - SVG stroke/fill hardcoded (#bbbbbb), no currentColor; transition removed — breaks sreality hover inheritance loop that caused flicker
- Detail comparison panel: matches inline widget layout exactly
- ⓘ pulse animation (detail page only, first main price only):
  - 5s initial delay after widget render, then red glow pulse (3s animation)
  - Runs 3 times on 10s cooldown, then switches to 20s interval forever
  - Stops permanently once user clicks ⓘ; `infoIconSeen` persisted via `chrome.storage.local`
  - Resets on SPA navigation to new listing (tracked by `infoPulseHref = location.href`)
- Ad card removal: strips "TIP:" and "Reklama" cards from listing pages
- MutationObserver (debounced 400ms): handles SPA navigation and lazy-loaded content
- Location detection: CSS selector + text-node walker, 14 Czech kraje, longest-key-first `mapToRegion()`
- i18n: Czech/English switcher in popup via `chrome.storage.sync`; live re-render via `storage.onChanged`
- Module-level state: `highlightedEls`, `comparisonEls`, `mainOverlayEl`, `debugOverlayEl`, `activeYear`, `infoPopupEl`
- Widget immune to parent card :hover via `!important` on all color/text/pointer-events properties
- Extension icon: geometric house SVG — dark `#1c1208` bg, red `#dc2626` roof + chimney, cream `#fef3c7` body. Rasterized by `icons/generate-icons.mjs`
- Popup: segmented ON/OFF overlay control; language switcher (CS/EN); auto-open toggle; Sreality.cz launch link

### Burden chart constants
```typescript
const CHART_REF_PRICE  = 13_000_000;   // Praha 2+kk median — produces ~60% burden in 2026
const CHART_REF_REGION: CzechRegion = 'praha';  // NOTE: lowercase! 'Praha' silently returns NaN
const CHART_ALL_COMPARISONS = computeAllComparisons(CHART_REF_PRICE, CHART_REF_REGION);
```
Pre-computed at module load — static data, no runtime cost. `CzechRegion` keys are ALL lowercase
(`'praha'`, `'jihomoravsky'`, etc.) — passing a capitalized string silently produces `NaN` burden
because the wage lookup returns `undefined`.

### Regional price data (v2026-04-regional-v2)
- `REGIONAL_PRICE_INDICES` in `data.ts`: 27 years (2000–2026), 14 Czech kraje, base 2015=100
- Built with `rpi()` positional builder helper — compact row-per-year format
- `getRegionalData()` resolves two sources: price index from `REGIONAL_PRICE_INDICES`, wage from `entry.regions[region]?.avgWage` or national × stable ratio
- `DATA_VERSION = '2026-04-regional-v2'` exported for version tracking

### Known pitfalls
**Two year variables** — `buildMainOverlay()` has local `selectedYear` + module-level `activeYear`.
`selectYear()` updates both. The restore block must set `selectedYear = activeYear` before calling
`updateMiniFilters()` or the mini bar renders nothing. Burned in v0.5.2.

**Template literals + variable cleanup** — When removing a computed variable (e.g. `equivPayDeltaPct`),
grep ALL template literals for derived variables (`equivPayArrow`, `absEquivPayDelta`) that reference it.
Vite does not catch undefined template literal variable references at build time. Burned in v0.5.5→v0.5.7.

**Sreality card pointer-events** — Our widgets land inside sreality's card `<a>` tags via `priceEl.after()`.
Sreality applies `pointer-events: none` to anchor descendants. Any interactive element in our widget needs
`pointer-events: auto !important` to stay clickable.

**SVG currentColor + transition = flicker loop** — Any SVG that uses `currentColor` inherits `color` from its
button parent. If that button is inside a sreality card, sreality's `:hover` keeps fighting our `!important`
color. With `transition: color` on the button, this becomes a visible animation loop. Fix: hardcode SVG
stroke/fill values; remove color transition; target SVG elements directly with `:hover` CSS.

**MutationObserver + CSS animation = two-guard pattern** — When a CSS animation runs on a widget element,
the MutationObserver re-render cycle will destroy and recreate the animated element mid-animation (instant
flicker/restart). The fix requires guards at BOTH ends:
  1. `removeHighlights()`: skip `clearListingComparisons()` when `infoPulseActive`
  2. `renderListingComparisons()`: early-return at the very start when `infoPulseActive`
  This prevents both the DOM teardown AND the rebuild during the animation window.
  Guarding only one side causes either blank widgets (guard 2 only) or horror-movie flickering (guard 1 only).
  Burned in v0.5.14→v0.5.15. The `infoPulseActive` flag is set `true` on `triggerPulse()` and cleared after 3.2s.

**SPA navigation click-through on ⓘ button** — Sreality uses React and navigates on `mousedown`, not `click`.
Adding `stopPropagation()` only to `click` handler is not enough — the browser will still navigate before
the click fires. Both `mousedown` (with `preventDefault()` too) and `click` handlers need `stopPropagation()`.
Burned in v0.5.13.

**infoPopupEl not in overlayExclusions** — The overlay exclusion list in `applyHighlights()` and
`renderListingComparisons()` must include `infoPopupEl`. Without it, prices inside the info popup
get highlighted and receive injected comparison widgets. Burned in v0.5.13.

**CSS `!important` blocks animation keyframes** — The rule `.su-cw-info svg path { fill: #bbbbbb !important; }`
overrides animation fill keyframes. Fix: use `.su-cw-info:not(.su-info-pulse) svg path { fill: #bbbbbb !important; }`
to exclude the pulsing button. `!important` in a selector with lower specificity still wins at runtime.
The `:not()` exclusion is the clean escape hatch. Burned in v0.5.14.

**CzechRegion keys are lowercase** — `CzechRegion` type values are `'praha'`, `'jihomoravsky'`, etc.
Passing `'Praha'` (capital P) compiles fine (TypeScript type erasure via esbuild) but silently returns
`undefined` from wage lookups, cascading to `NaN` in all burden calculations. Always verify against the
type definition in `location.ts`. Burned in v1.0.3 burden chart.

## Math Model (v0.3.0 — burden ratio)
```
P_t = P_now × (priceIndex_t / priceIndex_now)          // historical price estimate
payment_t = (1 - downPayment) × P_t × annuityFactor(rate_t, 360)
householdNetIncome_t = 2 × regionalWage_t × takeHomeRatio
B_t = payment_t / householdNetIncome_t                 // burden ratio (0-1)
stressMultiplier = B_now / B_t                         // e.g. 1.68× worse
burdenEquivalentPrice = P_now × (B_t / B_now)          // "would need to cost X"
burdenEquivalentPayment = (1-dp) × burdenEquivalentPrice × annuityFactor(rate_now, 360)
```
MODEL_DEFAULTS: downPaymentRatio=0.10, loanTermMonths=360, householdEarners=2, takeHomeRatio=0.77

## Tech Stack
- TypeScript + Vite (multi-entry, ES module format, all deps bundled inline — no dynamic imports)
- Manifest V3, no eval, no remote code
- Dev workflow: `vite build --watch` + manual Chrome reload from dist/
- Icon generation: `node icons/generate-icons.mjs` (uses `sharp` to rasterize SVG → PNG)

## Architecture Notes
- Abstract enough to support other real estate sites beyond sreality.cz later
- All overlay IDs/classes prefixed `su-` to avoid collision with sreality styles
- Content script injects styles into `document.head`; no shadow DOM
- `normalizePrice()` strips U+200B and NBSP before any price parsing
- **i18n**: `src/i18n.ts` exports `t(key, ...args)` + `setLang(lang)`. Only imported by `content.ts`.
  `popup.ts` has its own inline POPUP_STRINGS to avoid a shared Rollup chunk (content scripts
  are classic scripts and cannot import from external chunk files).
- Language stored as `lang: 'cs' | 'en'` in `chrome.storage.sync` (default `'cs'`).
  `chrome.storage.onChanged` in content.ts drives live re-render via `rebuildAllUI()`.
- `rebuildAllUI()` destroys and rebuilds all active overlays; restores `activeYear` into the new overlay.
- **Feature flags**: `DEBUGGER_FEATURE_ENABLED` and `CITY_FEATURE_ENABLED` are both `false` in production.
  Must be kept in sync between `content.ts` and `popup.ts`.
- **`chrome.storage.local`**: used for `infoIconSeen: boolean` (pulse animation kill-switch, permanent).
  `chrome.storage.sync` is for user preferences (lang, autoOpen).
- **`infoPopupEl`**: must be tracked as a module-level variable and added to `overlayExclusions` in both
  `applyHighlights()` and `renderListingComparisons()`, just like `mainOverlayEl` and `debugOverlayEl`.
- **Burden chart**: `buildBurdenChartSVG(selectedYear)` is a pure function (no DOM); `updateBurdenChart(year)`
  is a closure inside `buildMainOverlay()`. Chart data pre-computed once at module load.

## Design System
- Font: Quicksand 400/600/700 via Google Fonts @import in injected style blocks
- **Widget dark palette**: bg `rgba(28,18,8,0.97)`, orange accent `#f97316`/`#fb923c`,
  cream text `#fef3c7`, muted `#c4a882`/`#a38d72`, very muted `#826650`
- **Info popup dark palette**: bg `#1c1208` (0.98), border `#3d2e1a`, title cream, body cream `#fef3c7`
  Hero numbers: orange `#f97316`, supporting numbers: white `#ffffff`, source line: `#a89070`
- **Main overlay palette**: white bg `#ffffff`, primary text `#111111`, red accent `#dc2626`, muted `#888888`/`#aaaaaa`
- **Popup palette**: white bg `#ffffff`, red accent `#dc2626`, muted grey `#888888` title
- Vibe: artisanal minimalism — boutique café menu meets mortgage calculator
- No entrance animations on widgets; subtle hover transitions only; `tabular-nums` for all prices

## Repo & Distribution
- Public GitHub repo: **WildJesus/Unreal-Estate** (renamed from srealitky-universes)
- Privacy policy: `PRIVACY.md` in repo root — linked from Chrome Web Store listing
- **Chrome Web Store**: submitted v1.0.3 for review (2026-04-14)
- Packaging: `npm run build` → `Compress-Archive dist\* unreal-estate-vX.Y.Z.zip` → upload ZIP
- **manifest `description` field hard limit: 132 characters** — Chrome Web Store rejects on upload if exceeded

## Chrome Web Store notes
- Store icon: `icons/icon128.png` (128×128, from SVG via `generate-icons.mjs`)
- Screenshots must be exactly 1280×800 or 640×400 — use `sharp` with `fit:'contain'` + white bg to resize
- Privacy: no data collected; `chrome.storage` used only for UI prefs (lang, autoOpen, infoIconSeen)

## User Background
Java + C# background, former Product Owner, no strong frontend preferences.
Prefers TypeScript when it makes architecture cleaner.
Primary goal is learning LLM-driven development — explain decisions and trade-offs.
