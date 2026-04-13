# Srealitky Universes

> **See Czech property prices adjusted for historical affordability.**  
> Chrome extension for [sreality.cz](https://www.sreality.cz/) — not affiliated with Sreality.cz or Seznam.cz.

---

## What it does

When browsing Czech property listings, the extension injects an affordability widget next to every price. Instead of just showing today's asking price, it answers the question:

> *"What would this flat need to cost today for the monthly mortgage burden to feel the same as in 2015?"*

For most listings the answer is roughly half the asking price — which is the point.

### The core metric: Burden Ratio

```
Burden Ratio = Monthly Mortgage Payment ÷ Household Net Income
```

A burden ratio of 0.55 means "55% of take-home pay goes to the mortgage." Comparing this ratio across time strips out wage growth and interest rate changes, leaving only the structural affordability shift.

### What you see on a listing

Each price gets a 3-section widget:

| Section | What it shows |
|---|---|
| **Today** | Current price · Burden % · Monthly payment |
| **Historical** | Estimated past price · Past burden % · Past mortgage |
| **Equivalent** | What the flat *should* cost for today's buyer to feel like a 2015 buyer |

A year selector (2000–2025) lets you pick any comparison year. Default: **2015**.

---

## Architecture

### Extension Entry Points

| File | Role |
|---|---|
| `src/content.ts` | Heart of the extension (~1,800 lines). Injected into every sreality.cz page. Orchestrates scanning, calculation, and all UI rendering. |
| `src/popup.ts` + `popup.html` | Toolbar popup: auto-open toggle, language switcher, launch buttons, about link. Self-contained — cannot share code with content script (Manifest V3 chunking constraint). |
| `src/background.ts` | 9-line service worker. Relays toolbar button clicks to the active tab. |
| `src/i18n.ts` | ~80 translation keys for Czech and English. |

### Data Pipeline (runs per page / per year change)

```
① Detect Prices
   TreeWalker scans DOM for "X Kč" patterns.
   Strips U+200B zero-width spaces (sreality anti-scraping).
   Skips strikethrough and per-m² prices.
        ↓
② Detect Location
   Breadcrumb DOM → URL slug → card text walker.
   200+ city/district names → 14 Czech regions.
   Falls back to Praha if unknown.
        ↓
③ Compute (calc.ts)
   For each (price × year × region):
   historical price · mortgage payments · burden ratios
   stress multiplier · burden-equivalent price
        ↓
④ Render
   Inline widgets on listing cards.
   Detail comparison in main overlay.
   Story-based info popup on ⓘ click.
```

### Domain & Calculation Layer

**`src/universes/calc.ts`** — Pure math, no DOM.

```
P_t = P_now × (priceIndex_t / priceIndex_now)         // historical price
payment_t = (1 - 0.10) × P_t × annuityFactor(rate_t, 360)
income_t = 2 × regionalWage_t × 0.77
B_t = payment_t / income_t                            // burden ratio
stressMultiplier = B_now / B_t                        // e.g. 1.68× worse today
burdenEquivalentPrice = P_now × (B_t / B_now)         // the headline number
```

Model defaults: 10% down payment, 30-year term, 2-earner household, 77% gross-to-net ratio.

**`src/universes/data.ts`** — All data hardcoded. Zero external API calls. Bundled at build time.

- 27 years of data (2000–2026): mortgage rates (ČNB/Hypoindex), national price index (ČSÚ, 2015=100), national average wages (ČSÚ)
- 14 Czech regions: per-region price indices (ČSÚ/ČÚZK realized transactions), regional wages (ČSÚ 2025)

**`src/universes/location.ts`** — Maps any Czech locality string to one of 14 kraje.

- Extraction order: breadcrumb DOM → URL slug → card text walk
- 200+ entries: cities, districts, okresy; ASCII-folded for diacritics; longest-key-first matching

### UI Components

| Component | Description |
|---|---|
| **Main Overlay** | Fixed bottom-left, 360px. Year selector pills + range slider. Minimized mini-bar on auto-open. |
| **Inline Widgets** | 3-section stacked widget per price. Compact map variant. ⓘ info button on each. |
| **Info Popup** | Story-based "Jak se to počítá?" narrative. Dynamic numbers woven into a continuous prose walkthrough — not a formula sheet. Draggable, viewport-bounded. |
| **Pulse Animation** | On detail pages, the ⓘ button slowly glows red after 5 seconds to draw attention. Runs on 10s/20s intervals until the user opens it. Permanently disabled after first click via `chrome.storage.local`. |
| **About Overlay** | Project info, methodology, data sources, disclaimer. |
| **Debug Overlay** | Development tool (hidden via feature flag in production). |
| **Ad Removal** | Strips "TIP:" and "Reklama" sponsored cards from listing pages. |

### Communication Paths

| From | To | Mechanism | Carries |
|---|---|---|---|
| Popup | Content Script | `chrome.storage.sync` | Language preference, auto-open setting |
| Popup | Content Script | `chrome.tabs.sendMessage` | "show-overlay" / "show-about" |
| Service Worker | Content Script | `chrome.tabs.sendMessage` | "toggle-overlay" (toolbar button) |
| Sreality DOM | Content Script | `MutationObserver` (400ms debounce) | SPA navigation & lazy-loaded content |
| Content Script | Content Script | `storage.onChanged` | Language change → `rebuildAllUI()` |

### Build & Deployment

```bash
vite build --watch               # dev: rebuilds on save, load dist/ in Chrome
vite build                       # production bundle
node icons/generate-icons.mjs    # rasterize SVG icon → PNG at 16/32/48/128px
```

- **4 entry points**: content, background, popup, sidebar — all bundled inline (no dynamic imports)
- **Output**: `dist/` — load as unpacked extension in Chrome
- **Permissions**: `activeTab`, `storage` — nothing else

---

## Key Business Concepts

**Burden Ratio** — Monthly mortgage payment ÷ household net income. The core metric. Lets you compare affordability across decades despite changing wages and interest rates.

**Stress Multiplier** — Today's burden ÷ historical burden. "1.68×" means housing eats 68% more of your income today than in the comparison year.

**Burden-Equivalent Price** — "What would this flat need to cost today for the mortgage burden to feel like year X?" This is the headline insight: for most Prague listings in 2026, it is roughly 40–50% below the asking price.

**Regional Data** — Prague prices grew ~15% faster than the national average; Ústecký kraj ~25% slower. The extension uses per-region price indices and wages so the comparison is accurate for each listing's location, not just a national average.

**Anti-Scraping Handling** — Sreality injects zero-width spaces (U+200B) and per-character `<span>` obfuscation into price strings. The scanner normalizes these before any number parsing.

---

## Data Sources

| Data | Source |
|---|---|
| Mortgage rates | Fincentrum/Swiss Life Hypoindex + ČNB new-business rates |
| National price index | ČSÚ realized transaction price indices (2015 = 100) |
| Regional price indices | ČSÚ/ČÚZK regional realized transactions |
| National wages | ČSÚ annual average gross monthly wage |
| Regional wages | ČSÚ release March 2026 |

All data is static, hardcoded at build time. The extension makes no network requests.

---

## Tech Stack

- TypeScript + Vite (multi-entry ES module build)
- Manifest V3 Chrome Extension
- No external runtime dependencies (all bundled inline)
- `sharp` (dev dependency) for icon rasterization

---

## Disclaimer

This extension is not affiliated with, endorsed by, or connected to Sreality.cz or Seznam.cz in any way. It is an independent third-party project. ČSÚ data is used for informational purposes only.
