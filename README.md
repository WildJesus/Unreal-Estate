# Srealitky Universes

> What would this flat have cost in 2015? What *should* it cost today for the burden to be the same?

A Chrome extension for [sreality.cz](https://www.sreality.cz) that overlays every property listing with mortgage affordability context — comparing today's prices against historical years using real wage, rate, and price-index data.

---

## What it does

Czech housing has become dramatically less affordable over the last two decades. A flat that was reachable on a median salary in 2010 might require 2× the relative income today. This extension makes that visible — on every listing, without leaving the page.

For each detected price it renders a three-section widget:

| Section | What it shows |
|---|---|
| **Today** | Listed price · mortgage burden % · monthly payment |
| **Historical** | What the flat likely cost in the selected year · burden then · payment then |
| **Equivalent** | What the flat *would need to cost today* for the burden to match the past |

The "equivalent price" is the one that sticks. If it says **↓58%** — the flat would need to cost 58% less today for your mortgage burden to match 2015.

Works on listing grids, detail pages, and the map view.

---

## Installation (developer mode)

1. Clone or download this repo
2. Run `npm install` then `npm run build` (or `npx vite build`)
3. Open Chrome → `chrome://extensions` → enable **Developer mode**
4. Click **Load unpacked** → select the `dist/` folder
5. Navigate to `sreality.cz` — the extension activates automatically

**Dev workflow:** `npx vite build --watch` keeps `dist/` live. After each rebuild, click the reload icon on `chrome://extensions`.

---

## How to use

**On page load** the extension starts minimized — a small bar in the bottom-left corner showing the active comparison year as a red pill. Click the year to expand.

**In the overlay** you can:
- Change the comparison year via the **slider** or the **quick-pick pills** (2000 / 2005 / 2010 / 2015 / 2020)
- Widgets update instantly on every listing visible on the page

**The ⓘ icon** on each widget opens a step-by-step walkthrough of exactly how the numbers were derived — every intermediate value shown.

**Debug mode** (via the popup → "Launch debugger") shows a raw list of all detected prices and their DOM sources — useful for diagnosing missed prices on unusual page layouts.

---

## The math

```
P_t  = P_now × (priceIndex_t / priceIndex_now)        // historical price estimate
pay_t = (1 − 0.10) × P_t × annuityFactor(rate_t, 360) // monthly payment at historical rate
income_t = 2 × regionalWage_t × 0.77                  // dual-earner household net income
B_t  = pay_t / income_t                               // burden ratio
stressMultiplier = B_now / B_t                        // "today is 1.68× more burdensome"
equivPrice = P_now × (B_t / B_now)                    // burden-neutral price today
```

**Data sources** (all Czech, regional where available):
- Wages: ČSÚ annual averages, 14 kraje
- Mortgage rates: Hypoindex / ČNB
- Price index: ČSÚ realized transaction price indices

**Assumptions:** 10% down payment, 30-year term, dual-earner household, 77% net take-home ratio.

---

## Language

Czech and English are both supported. Switch in the extension popup (flag buttons). The setting persists across sessions and the entire UI re-renders live — no page reload needed.

---

## Tech

- **TypeScript + Vite** — multi-entry build (content script, popup, background, sidebar)
- **Manifest V3** — no eval, no remote code, minimal permissions (`activeTab`, `storage`)
- **No framework** — vanilla DOM manipulation; all styles injected via `document.head`
- **Quicksand** (Google Fonts) — loaded via `@import` inside injected `<style>` blocks

All economic data is bundled as static JSON in `dist/data/` — no network requests after install.

---

## Status

`v0.5.3` — actively developed. Chrome Web Store submission planned once the UI stabilises.

Built as a learning project for LLM-driven development. The commit history reflects iterative AI-assisted feature work.
