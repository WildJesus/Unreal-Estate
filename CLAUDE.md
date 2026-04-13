# Srealitky Universes - Chrome Extension

## Project Purpose
Primary goal: Learning LLM-driven development through active exercises.
Secondary goal: Actually build and ship this extension.
→ Give extra transparency about how you operate and why you make decisions.

## What It Does
Chrome extension for sreality.cz that injects affordability context onto property listings.
Shows what a property would need to cost today for the mortgage burden to match a selected historical year.
Goal: viscerally communicate how bad Prague (and Czech) housing affordability has become.

## Current Status (2026-04-13): v0.5.3 working

### What's built and working
- Vite + TypeScript multi-entry build (content.ts, background.ts, popup.ts, i18n.ts)
- Manifest V3: popup, content script on sreality.cz, service worker
- Price detection: TreeWalker scan, handles sreality anti-scraping (U+200B, per-char obfuscated spans)
- No price highlights (`su-hl` class kept for tracking, visually invisible since v0.5.0)
- Main overlay (bottom-left, 360px wide):
  - Year selector pills (2000/2005/2010/2015/2020) + range slider; default year 2015 on auto-open
  - Auto-opens **minimized** on page load; mini bar shows year as red clickable pill → click expands
  - Mini bar: "SREALITKY UNIVERSES · [2015]" — clicking the year pill expands the overlay
- Debug overlay (bottom-right): raw detected prices with source labels
- Inline comparison widgets: 3-section stacked widget per price — today / historical / burden-equivalent
  - Section 1: today's price + burden% + mortgage payment
  - Section 2: historical price (↓X%) + burden% + historical mortgage (↓X%)  
  - Section 3: burden-equivalent price (↓X%) + equivalent mortgage payment
  - Map view: compact equiv-only variant stacked below price label
- Info popup (ⓘ icon): Czech/English walkthrough tracing exact widget number derivation step-by-step
- Detail comparison panel: matches inline widget 3-section layout exactly
- Info popup header: `Price → EquivPrice · Region` (no house icon, uniform font)
- Ad card removal: strips "TIP:" and "Reklama" cards from listing pages
- MutationObserver (debounced 400ms): handles SPA navigation and lazy-loaded content
- Location detection: CSS selector + text-node walker, 14 Czech kraje, longest-key-first `mapToRegion()`
- i18n: Czech/English switcher in popup via `chrome.storage.sync`; live re-render via `storage.onChanged`
- Module-level state: `highlightedEls`, `comparisonEls`, `mainOverlayEl`, `debugOverlayEl`, `activeYear`
- Widget immune to parent card :hover via `!important` on all color/text properties

### Known state / two-variable pattern to watch
`buildMainOverlay()` has a local `selectedYear` and a module-level `activeYear` that must stay in sync.
`selectYear()` updates both. The restore block at the end of `buildMainOverlay()` must explicitly set
`selectedYear = activeYear` before calling `updateMiniFilters()`, or the mini bar renders nothing.

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

## Architecture Notes
- Abstract enough to support other real estate sites beyond sreality.cz later
- All overlay IDs/classes prefixed `su-` to avoid collision with sreality styles
- Content script injects styles into `document.head`; no shadow DOM
- `normalizePrice()` strips U+200B and NBSP before any price parsing
- **i18n**: `src/i18n.ts` exports `t(key, ...args)` + `setLang(lang)`. Only imported by `content.ts`.
  `popup.ts` has its own 5-key inline POPUP_STRINGS to avoid a shared Rollup chunk (content scripts
  are classic scripts and cannot import from external chunk files).
- Language stored as `lang: 'cs' | 'en'` in `chrome.storage.sync` (default `'cs'`).
  `chrome.storage.onChanged` in content.ts drives live re-render via `rebuildAllUI()`.
- `rebuildAllUI()` destroys and rebuilds all active overlays; restores `activeYear` into the new overlay.

## Design System
- Font: Quicksand 400/600/700 via Google Fonts @import in injected style blocks
- **Content script palette**: white bg `#ffffff`, primary text `#111111`, red accent `#dc2626`,
  green/red deltas `#16a34a`/`#dc2626`, muted greys `#777777`/`#aaaaaa`
- **Popup palette**: white bg `#ffffff`, red accent `#dc2626`, muted grey `#888888` title (redesigned v0.5.0 to match widget)
- Vibe: artisanal minimalism — boutique café menu meets mortgage calculator
- No entrance animations; subtle hover transitions only; `tabular-nums` for all prices; font-weight 600 for body text in info popup

## Repo
- Private GitHub repo: WildJesus/srealitky-universes (separate from llm-lab monorepo)
- May go public + Chrome Web Store eventually

## User Background
Java + C# background, former Product Owner, no strong frontend preferences.
Prefers TypeScript when it makes architecture cleaner.
Primary goal is learning LLM-driven development — explain decisions and trade-offs.
