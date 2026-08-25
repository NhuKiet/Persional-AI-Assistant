# Home Time + Weather Widget

**Date:** 2026-07-27

**Status:** Approved design; awaiting written-spec review

**Scope:** Add a small clock + current-weather widget to the empty top-left corner of the HomePage idle hero view (`.home-idle` in `frontend/src/pages/HomePage.tsx`). Client-only — no backend changes, no API key. Does not touch the chat-active layout, other tool pages, or the sidebar theme toggle (confirmed already present and unrelated to this work).

## 1. Problem

The idle hero screen (before the user sends a first message) has a large empty area in the top-left, next to the "KiNg" logo and mood prompt. The user wants that space filled with something informative rather than decorative: the current time and today's weather, inspired by a phone lock-screen-style flip-clock + forecast widget. Scope was narrowed during design to the minimal version: current time/date + today's weather only (no multi-day forecast, no flip-clock animation).

## 2. Requirements

Confirmed with the user during design:

1. **Minimal content**: large HH:MM + weekday/date line, plus one weather icon + temperature + short condition label. No 7-day forecast strip, no location name display beyond what's needed internally.
2. **Idle-only placement**: visible only in `.home-idle` (the pre-chat hero), not in the compact chat-active header. Positioned top-left of that section, where the user circled empty space.
3. **Geolocation-based weather**: request the browser's Geolocation API once on mount. If granted, use those coordinates. If denied, unsupported, or the request errors/times out, silently fall back to a hardcoded default city (Hanoi, `21.0285, 105.8542`) — no visible error, no retry prompt.
4. **Open-Meteo, called directly from the frontend**: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current_weather=true`. Free, no API key, CORS-enabled. No backend proxy, no server-side caching for this sub-project.
5. **Graceful degradation**: the clock renders unconditionally (pure local `Date`, no network dependency). The weather portion shows a lightweight loading state, then either the icon+temp+label or — on any fetch failure — nothing (the weather row is omitted entirely, clock stays). No error banners.
6. **No persistence**: no localStorage caching of the last-known weather/coords; every page load re-requests geolocation and re-fetches. (Small/free API, low-traffic single-user app — caching is not worth the added state for this scope.)

## 3. Component Design

### `frontend/src/hooks/useTimeAndWeather.ts`

A single hook combining both concerns (they're both "ambient info for the home hero," not independently reusable elsewhere yet — one hook keeps the widget's data logic in one place instead of two thin ones):

```ts
interface WeatherState {
  tempC: number;
  code: number;       // Open-Meteo weathercode, raw
  loading: boolean;
  failed: boolean;
}

function useTimeAndWeather(): { now: Date; weather: WeatherState }
```

- `now`: `useState<Date>`, updated via `setInterval(60_000)` (minute resolution is enough for a clock next to a chat input — no need for second-tick re-renders).
- `weather`: on mount, `navigator.geolocation.getCurrentPosition(success, failure, { timeout: 5000 })`. Both `success` and `failure` (including "geolocation unsupported" when `navigator.geolocation` is undefined) converge on the same fetch call, just with different coordinates (real vs. Hanoi fallback). Fetch failure sets `failed: true`; nothing is retried.

### `frontend/src/lib/weatherCodes.ts`

Pure mapping function, unit-testable in isolation:

```ts
function weatherCodeToDisplay(code: number): { icon: string; label: string }
```

Buckets Open-Meteo's ~28 numeric codes into the handful the widget actually shows: clear (☀️ "Nắng"), partly cloudy (🌤️ "Ít mây"), cloudy/overcast (☁️ "Nhiều mây"), fog (🌫️ "Sương mù"), rain/drizzle (🌧️ "Mưa"), thunderstorm (⛈️ "Dông"), snow (❄️ "Tuyết"). Unknown code falls back to ☁️ / "—".

### `frontend/src/components/TimeWeatherWidget.tsx`

Presentational only — takes no props, calls `useTimeAndWeather()` itself. Renders:

```
[HH:MM]
Thứ Hai, 27/07
🌤️ 28°C · Ít mây      (omitted entirely while loading fails)
```

Styled with the existing glass-card tokens (`--glass`, `--border`, `var(--blur)`) already used by `.suggestion-card` etc. in `chat.css`, so it visually matches the rest of the pastel/aurora hero without introducing a new visual language.

## 4. Placement in HomePage.tsx

Rendered inside the existing `!chatActive` branch (`.home-idle`), as a new sibling positioned before/alongside `.home-logo` — top-left of that flex column, matching where the user's circle sits relative to the logo in their screenshot. No changes to the `chatActive` (compact header) branch.

## 5. Error Handling Summary

| Scenario | Behavior |
|---|---|
| Geolocation permission denied | Fetch weather for Hanoi fallback coords, no error shown |
| Geolocation unsupported (old browser) | Same — Hanoi fallback |
| Geolocation times out (5s) | Same — Hanoi fallback |
| Open-Meteo fetch fails/network error | Weather row omitted; clock still shows |
| Open-Meteo returns unrecognized weathercode | Falls back to ☁️ / "—" rather than omitting |

## 6. Testing

1. `weatherCodes.test.ts` — table test covering each bucket boundary + an unknown code.
2. `TimeWeatherWidget.test.tsx` — mocks `navigator.geolocation.getCurrentPosition` (success and failure paths) and `global.fetch`; asserts the clock always renders, the weather row renders on fetch success, and is omitted on fetch failure.
3. No changes needed to existing `HomePage.test.tsx`-style suites beyond confirming the widget mounts without crashing when geolocation/fetch are unavailable in jsdom (jsdom has no real `navigator.geolocation` — hook must not throw when it's `undefined`).

## 7. Out of Scope

- Multi-day forecast, location name display, unit toggle (°C/°F), manual city search/override, weather on any other page, localStorage caching, backend proxy/caching layer.
