# Srealitky Universes - Chrome Extension

## Project Purpose
Primary goal: Learning LLM-driven development through active exercises.
Secondary goal: Actually build and ship this extension.
→ Give extra transparency about how you operate and why you make decisions.

## What It Does
Chrome extension for srealitky.cz that shows alternative "price universes" — 
what properties would cost under different affordability conditions, so users 
can viscerally understand how bad Prague housing affordability has become.

## Price Universe Logic
Formula: displayed_price = today_price × (affordability_ratio_YEAR / affordability_ratio_TODAY)
Where affordability_ratio = median_property_price / median_salary
Goal: not showing old prices — showing "what would today's price be if the 
salary-to-housing burden was still what it was in YEAR"

## Universes Planned
- Historical Prague (year slider, e.g. 2013)
- Cross-city comparison (e.g. "what if Prague had Krakow's affordability ratio today")
- MVP uses static hardcoded JSON data (Czech Statistical Office), live API later

## Salary Input Options (in order of complexity)
1. Prague median salary (default)
2. Salary percentile/quantile selector
3. Enter profession/field
4. Enter exact salary

## UI Design
- Sidebar/toolbar injected into the srealitky page (not a popup)
- Original price stays visible with % change shown alongside
- Gamified visual feedback: color palettes + slight font scaling based on how dramatic the drop is
- Universe switcher lives inside the injected sidebar

## Tech Stack
- TypeScript + Vite (clean abstraction for multi-site support later)
- Manifest V3
- Dev workflow: vite build --watch (file watcher, auto-rebuild on save, manual Chrome reload)

## Architecture Notes
- Abstract enough to support other real estate sites beyond srealitky in future
- Start with srealitky only for MVP
- Static multiplier JSON file bundled with extension, wired to live API later

## Repo
- New private GitHub repo, dedicated to this app (not inside llm-lab)
- May go public + Chrome Web Store eventually

## Current Status
- Planning phase complete, ready to scaffold
- gh CLI needs to be set up before repo creation (auth errors encountered)
- Next step: fix gh auth, create repo, scaffold extension structure

## User Background
Java + C# background, former Product Owner, no strong frontend preferences.
Prefers TypeScript when it makes architecture cleaner.
Hates re-doing work — save decisions as they're made.
