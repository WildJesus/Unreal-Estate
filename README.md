# Srealitky Universes

A Chrome extension that adds affordability context to every property listing on [sreality.cz](https://www.sreality.cz/).

---

## What it shows

You're looking at a flat in Prague for **8 500 000 Kč**. The extension adds this widget next to the price:

```
┌──────────────────────────────────────────┐
│  2026   8 500 000 Kč   (Burden 58%)      │
│         Splátka: 41 200 Kč/měs           │
│ ─────────────────────────────────────── │
│  2015 ↓51%  4 175 000 Kč   (Burden 27%) │
│         Splátka: ↓47%  21 900 Kč/měs    │
│ ─────────────────────────────────────── │
│  Equiv ↓54%  3 900 000 Kč               │
│         Splátka: 18 900 Kč/měs          │
└──────────────────────────────────────────┘
```

**What these numbers mean:**

- **2026 row** — today's asking price. A couple earning average Prague wages would spend 58% of their take-home pay on the mortgage. That's the reality.
- **2015 row** — what the same flat would have cost in 2015, estimated using ČSÚ price indices. Back then, the same couple spent 27% of their income.
- **Equiv row** — what the flat would need to cost *today* for the burden to feel like 2015. In this case: **3 900 000 Kč** instead of 8 500 000 Kč.

The comparison year is adjustable (2000–2025). Default is 2015.

---

## How it works

The extension compares mortgage burden — the share of household income eaten by a monthly mortgage payment — across time. It accounts for today's higher wages, today's interest rates, and regional price growth. The result is a single honest number: *what should this actually cost?*

Click the **ⓘ** icon on any widget for a full plain-language explanation of the math for that specific listing.

---

## How to install

The extension is not yet on the Chrome Web Store. To use it:

1. Download or clone this repo
2. Run `npm install && npx vite build`
3. Open Chrome → `chrome://extensions` → enable **Developer mode**
4. Click **Load unpacked** → select the `dist/` folder

---

## Data sources

All data is static and bundled inside the extension. No network requests are made.

| | Source |
|---|---|
| Mortgage rates | Fincentrum/Swiss Life Hypoindex + ČNB |
| Property prices | ČSÚ realized transaction price indices |
| Wages | ČSÚ annual statistics, regional breakdowns March 2026 |

14 Czech regions are tracked separately — Praha, Jihomoravský kraj, Moravskoslezský kraj, and so on — because wages and price growth differ significantly across the country.

---

## For developers

Built with TypeScript + Vite, Manifest V3. See [`docs/architecture-diagram.html`](docs/architecture-diagram.html) for a full architecture overview.

---

*Not affiliated with Sreality.cz or Seznam.cz. Independent third-party project.*
