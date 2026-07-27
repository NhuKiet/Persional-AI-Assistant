# Home Time + Weather Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small clock + current-weather card to the empty top-left corner of the HomePage idle hero view.

**Architecture:** Two pure/testable helper modules (weather-code → icon/label mapping, `Date` → display-string formatting) feed a small hook (`useTimeAndWeather`) that owns a once-a-minute clock tick and a one-shot geolocation → Open-Meteo fetch (with a hardcoded Hanoi fallback on any failure). A presentational component consumes the hook and renders inside `HomePage.tsx`'s existing idle branch, positioned via CSS as an absolutely-positioned card so it sits in the corner independent of the centered hero column.

**Tech Stack:** React 18 + TypeScript (frontend), Vitest + `@testing-library/react`, plain CSS (no new libraries — Open-Meteo is called with the built-in `fetch`, no SDK).

## Global Constraints

- No backend changes, no API key — Open-Meteo's `current_weather=true` endpoint is called directly from the browser.
- No new npm dependencies.
- All user-visible copy is Vietnamese (weekday names, weather labels), matching the rest of the app.
- Widget renders only in `HomePage.tsx`'s `!chatActive` branch — never in the compact chat-active header, never on other pages.
- Geolocation failure of any kind (denied, unsupported, timeout) falls back to Hanoi (`21.0285, 105.8542`) silently — no error UI for that case.
- Weather *fetch* failure (after a valid or fallback coordinate) omits the weather row entirely — clock still renders. No error banners anywhere in this feature.
- Follow existing file conventions: hooks are named exports in `frontend/src/hooks/`, standalone presentational components are default exports in `frontend/src/components/`, small pure helpers live in `frontend/src/lib/`.
- Test files sit next to the file they test (`Foo.ts` → `Foo.test.ts`, in the same directory) — this matches `useTheme.ts`/`useTheme.test.tsx` and `SourceChips.tsx`/`SourceChips.test.tsx` already in the repo.
- Run frontend tests with `npx vitest run <path>` from `frontend/` (matches how this repo's other sessions have run it — `npm test` maps to the same `vitest run` script).

---

### Task 1: Weather-code → display mapping

**Files:**
- Create: `frontend/src/lib/weatherCodes.ts`
- Test: `frontend/src/lib/weatherCodes.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies)
- Produces: `weatherCodeToDisplay(code: number): { icon: string; label: string }` — used by Task 4's `TimeWeatherWidget.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/weatherCodes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { weatherCodeToDisplay } from "./weatherCodes";

describe("weatherCodeToDisplay", () => {
  it("maps clear sky", () => {
    expect(weatherCodeToDisplay(0)).toEqual({ icon: "☀️", label: "Nắng" });
  });

  it("maps mainly-clear and partly-cloudy to the same bucket", () => {
    expect(weatherCodeToDisplay(1)).toEqual({ icon: "🌤️", label: "Ít mây" });
    expect(weatherCodeToDisplay(2)).toEqual({ icon: "🌤️", label: "Ít mây" });
  });

  it("maps overcast", () => {
    expect(weatherCodeToDisplay(3)).toEqual({ icon: "☁️", label: "Nhiều mây" });
  });

  it("maps fog codes", () => {
    expect(weatherCodeToDisplay(45)).toEqual({ icon: "🌫️", label: "Sương mù" });
    expect(weatherCodeToDisplay(48)).toEqual({ icon: "🌫️", label: "Sương mù" });
  });

  it("maps rain/drizzle codes", () => {
    for (const code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "🌧️", label: "Mưa" });
    }
  });

  it("maps snow codes", () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "❄️", label: "Tuyết" });
    }
  });

  it("maps thunderstorm codes", () => {
    for (const code of [95, 96, 99]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "⛈️", label: "Dông" });
    }
  });

  it("falls back to a generic cloud for unrecognized codes", () => {
    expect(weatherCodeToDisplay(999)).toEqual({ icon: "☁️", label: "—" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/weatherCodes.test.ts`
Expected: FAIL — `Cannot find module './weatherCodes'` (or similar resolution error), since `weatherCodes.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/weatherCodes.ts`:

```ts
/** Maps Open-Meteo's numeric WMO weather codes down to the handful of
 *  icon/label buckets this app's minimal weather display actually shows.
 *  Reference: https://open-meteo.com/en/docs (current_weather.weathercode). */

export interface WeatherDisplay {
  icon: string;
  label: string;
}

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const THUNDER_CODES = new Set([95, 96, 99]);

export function weatherCodeToDisplay(code: number): WeatherDisplay {
  if (code === 0) return { icon: "☀️", label: "Nắng" };
  if (code === 1 || code === 2) return { icon: "🌤️", label: "Ít mây" };
  if (code === 3) return { icon: "☁️", label: "Nhiều mây" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "Sương mù" };
  if (RAIN_CODES.has(code)) return { icon: "🌧️", label: "Mưa" };
  if (SNOW_CODES.has(code)) return { icon: "❄️", label: "Tuyết" };
  if (THUNDER_CODES.has(code)) return { icon: "⛈️", label: "Dông" };
  return { icon: "☁️", label: "—" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/weatherCodes.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/weatherCodes.ts frontend/src/lib/weatherCodes.test.ts
git commit -m "feat(home): add weather-code to icon/label mapping"
```

---

### Task 2: Clock formatting

**Files:**
- Create: `frontend/src/lib/formatClock.ts`
- Test: `frontend/src/lib/formatClock.test.ts`

**Interfaces:**
- Consumes: nothing (pure function of a `Date`)
- Produces: `formatClock(date: Date): { time: string; dateLabel: string }` — used by Task 4's `TimeWeatherWidget.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/formatClock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatClock } from "./formatClock";

describe("formatClock", () => {
  it("pads hours/minutes and labels a known Monday (2024-01-01)", () => {
    const date = new Date(2024, 0, 1, 9, 5);
    expect(formatClock(date)).toEqual({ time: "09:05", dateLabel: "Thứ Hai, 01/01" });
  });

  it("labels the day before as Sunday (2023-12-31) and pads midnight-adjacent minutes", () => {
    const date = new Date(2023, 11, 31, 23, 59);
    expect(formatClock(date)).toEqual({ time: "23:59", dateLabel: "Chủ Nhật, 31/12" });
  });

  it("pads single-digit hour and minute", () => {
    const date = new Date(2024, 0, 3, 5, 3);
    expect(formatClock(date)).toEqual({ time: "05:03", dateLabel: "Thứ Tư, 03/01" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/formatClock.test.ts`
Expected: FAIL — `Cannot find module './formatClock'`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/formatClock.ts`:

```ts
/** `Date` → display strings for the home hero clock. Pure/local — no
 *  Intl.DateTimeFormat locale dependency, so output is deterministic across
 *  environments (CI, different OS locales, etc.). */

export interface ClockDisplay {
  time: string;
  dateLabel: string;
}

const WEEKDAYS = [
  "Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClock(date: Date): ClockDisplay {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dateLabel = `${WEEKDAYS[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  return { time, dateLabel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/formatClock.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/formatClock.ts frontend/src/lib/formatClock.test.ts
git commit -m "feat(home): add clock display formatting"
```

---

### Task 3: `useTimeAndWeather` hook

**Files:**
- Create: `frontend/src/hooks/useTimeAndWeather.ts`
- Test: `frontend/src/hooks/useTimeAndWeather.test.ts`

**Interfaces:**
- Consumes: global `fetch`, global `navigator.geolocation` (both mocked in tests)
- Produces:
  ```ts
  export interface WeatherState {
    tempC: number;
    code: number;
    loading: boolean;
    failed: boolean;
  }
  export interface TimeAndWeather {
    now: Date;
    weather: WeatherState;
  }
  export function useTimeAndWeather(): TimeAndWeather
  ```
  — used by Task 4's `TimeWeatherWidget.tsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useTimeAndWeather.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTimeAndWeather } from "./useTimeAndWeather";

function mockGeolocation(behavior: "success" | "error") {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback) => {
      if (behavior === "success") {
        success({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition);
      } else {
        error?.(new Error("denied") as unknown as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

describe("useTimeAndWeather", () => {
  it("fetches weather using the real geolocation coords on success", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 28, weathercode: 1 } }),
    }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather).toEqual({ tempC: 28, code: 1, loading: false, failed: false });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("latitude=10&longitude=20"));
  });

  it("falls back to Hanoi coords when geolocation errors", async () => {
    mockGeolocation("error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 30, weathercode: 3 } }),
    }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("latitude=21.0285&longitude=105.8542"));
  });

  it("marks weather as failed when the fetch rejects, without touching the clock", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather.failed).toBe(true);
    expect(result.current.now).toBeInstanceOf(Date);
  });

  it("marks weather as failed when Open-Meteo returns a non-ok response", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather.failed).toBe(true);
  });

  it("ticks the clock forward once a minute", () => {
    vi.useFakeTimers();
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const { result } = renderHook(() => useTimeAndWeather());
    const first = result.current.now;

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(result.current.now.getTime()).toBe(first.getTime() + 60_000);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useTimeAndWeather.test.ts`
Expected: FAIL — `Cannot find module './useTimeAndWeather'`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/useTimeAndWeather.ts`:

```ts
import { useEffect, useState } from "react";

/** No API key, no backend proxy — Open-Meteo's current_weather endpoint is
 *  free and CORS-enabled, so the browser calls it directly. */
const HANOI_FALLBACK = { latitude: 21.0285, longitude: 105.8542 };
const GEOLOCATION_TIMEOUT_MS = 5000;

export interface WeatherState {
  tempC: number;
  code: number;
  loading: boolean;
  failed: boolean;
}

export interface TimeAndWeather {
  now: Date;
  weather: WeatherState;
}

interface Coords {
  latitude: number;
  longitude: number;
}

async function fetchWeather(coords: Coords): Promise<{ tempC: number; code: number } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current_weather;
    if (!current || typeof current.temperature !== "number" || typeof current.weathercode !== "number") {
      return null;
    }
    return { tempC: current.temperature, code: current.weathercode };
  } catch {
    return null;
  }
}

/** Clock ticks every minute (no need for second-resolution next to a chat
 *  input); weather is fetched once on mount via geolocation, falling back to
 *  Hanoi on ANY failure (denied, unsupported, timeout, or the fetch itself
 *  failing) — see docs/superpowers/specs/2026-07-27-home-time-weather-widget-design.md. */
export function useTimeAndWeather(): TimeAndWeather {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherState>({
    tempC: 0, code: 0, loading: true, failed: false,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyResult = (coords: Coords) => {
      fetchWeather(coords).then((result) => {
        if (cancelled) return;
        if (result) {
          setWeather({ tempC: result.tempC, code: result.code, loading: false, failed: false });
        } else {
          setWeather((w) => ({ ...w, loading: false, failed: true }));
        }
      });
    };

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      applyResult(HANOI_FALLBACK);
      return () => { cancelled = true; };
    }

    navigator.geolocation.getCurrentPosition(
      (position) => applyResult({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      () => applyResult(HANOI_FALLBACK),
      { timeout: GEOLOCATION_TIMEOUT_MS },
    );

    return () => { cancelled = true; };
  }, []);

  return { now, weather };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useTimeAndWeather.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTimeAndWeather.ts frontend/src/hooks/useTimeAndWeather.test.ts
git commit -m "feat(home): add useTimeAndWeather hook (clock tick + geolocation weather)"
```

---

### Task 4: `TimeWeatherWidget` component, styling, and HomePage wiring

**Files:**
- Create: `frontend/src/components/TimeWeatherWidget.tsx`
- Test: `frontend/src/components/TimeWeatherWidget.test.tsx`
- Modify: `frontend/src/pages/HomePage.tsx` (render the widget in the idle branch)
- Modify: `frontend/src/styles/base.css` (add `.home-time-weather` and its children)
- Modify: `frontend/src/test/routes.contract.test.jsx` (default `fetch` stub — see Step 7)

**Interfaces:**
- Consumes: `useTimeAndWeather` (Task 3), `formatClock` (Task 2), `weatherCodeToDisplay` (Task 1)
- Produces: `export default function TimeWeatherWidget(): JSX.Element` — a self-contained component taking no props, rendered by `HomePage.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TimeWeatherWidget.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TimeWeatherWidget from "./TimeWeatherWidget";

function mockGeolocation(behavior: "success" | "error") {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback) => {
      if (behavior === "success") {
        success({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition);
      } else {
        error?.(new Error("denied") as unknown as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

describe("TimeWeatherWidget", () => {
  it("always renders the clock, and shows weather once the fetch resolves", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 28, weathercode: 0 } }),
    }));

    render(<TimeWeatherWidget />);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/28°C/)).toBeInTheDocument());
    expect(screen.getByText(/Nắng/)).toBeInTheDocument();
  });

  it("omits the weather row (keeping the clock) when the fetch fails", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<TimeWeatherWidget />);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("…")).not.toBeInTheDocument());
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TimeWeatherWidget.test.tsx`
Expected: FAIL — `Cannot find module './TimeWeatherWidget'`

- [ ] **Step 3: Write the component**

Create `frontend/src/components/TimeWeatherWidget.tsx`:

```tsx
import { formatClock } from "../lib/formatClock";
import { weatherCodeToDisplay } from "../lib/weatherCodes";
import { useTimeAndWeather } from "../hooks/useTimeAndWeather";

export default function TimeWeatherWidget() {
  const { now, weather } = useTimeAndWeather();
  const { time, dateLabel } = formatClock(now);

  return (
    <div className="home-time-weather">
      <div className="htw-time">{time}</div>
      <div className="htw-date">{dateLabel}</div>
      {weather.loading ? (
        <div className="htw-weather htw-weather-loading">…</div>
      ) : !weather.failed ? (
        <div className="htw-weather">
          {weatherCodeToDisplay(weather.code).icon} {Math.round(weather.tempC)}°C
          {" · "}
          {weatherCodeToDisplay(weather.code).label}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/TimeWeatherWidget.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the CSS**

Open `frontend/src/styles/base.css` and find this existing block (used earlier to confirm `.home-center`'s layout):

```css
.home-center {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
```

Immediately after it (before the `@keyframes rise` comment block), insert:

```css

/* ── Time + weather widget — idle hero, top-left corner ─────
   Absolutely positioned relative to .page (already position:relative — see
   the .page rule above), independent of .home-idle's own centered flex
   column, so it sits in the empty corner next to the logo instead of
   stacking above/inside the centered hero content. Idle-only: HomePage.tsx
   only renders it in the !chatActive branch. */
.home-time-weather {
  position: absolute;
  top: 20px;
  left: var(--page-padding-x);
  z-index: 5;
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 14px 18px;
}
.htw-time    { font-family: var(--display); font-size: 28px; font-weight: 600; color: var(--text); line-height: 1.1; }
.htw-date    { font-size: 12px; color: var(--text2); margin-top: 2px; }
.htw-weather { font-size: 13px; color: var(--text2); margin-top: 8px; }
.htw-weather-loading { opacity: 0.5; }

/* Mirrors the .sb-open-btn + .page .tool-header fix in sidebar.css — when
   the sidebar is closed, its reopen chevron (left:14px, width:28px) would
   otherwise sit under/against this widget's default left offset. */
.sb-open-btn + .page .home-time-weather { left: calc(var(--page-padding-x) + 32px); }
```

- [ ] **Step 6: Wire the widget into HomePage.tsx**

Open `frontend/src/pages/HomePage.tsx`. Add the import alongside the other component imports near the top:

```tsx
import TimeWeatherWidget from "../components/TimeWeatherWidget";
```

Then find this existing block (the idle hero section):

```tsx
          {/* Idle */}
          {!chatActive && (
            <div className="home-idle">
```

Add the widget as a sibling immediately before it, still inside `.page` and still gated on `!chatActive`:

```tsx
          {!chatActive && <TimeWeatherWidget />}

          {/* Idle */}
          {!chatActive && (
            <div className="home-idle">
```

- [ ] **Step 7: Stop `routes.contract.test.jsx` from making a real network call**

HomePage's idle branch (`/` and `/chat` routes) is rendered by four existing tests in `frontend/src/test/routes.contract.test.jsx` (the `test.each` "keeps public route %s renderable" case, plus all three tests in `describe.each(...)("sidebar reopen control on %s"` for `/chat`), and none of them currently stub `fetch`. Once `TimeWeatherWidget` is wired in, mounting HomePage's idle view calls `fetchWeather`, which calls the real global `fetch` — jsdom has no `navigator.geolocation`, so the hook already takes its "unsupported → Hanoi fallback" path automatically, but the Open-Meteo HTTP call itself would still go out over the real network unless stubbed. Fix this by stubbing `fetch` for every test in the file by default, before wiring the widget into HomePage.

Open `frontend/src/test/routes.contract.test.jsx`. Change the import line:

```jsx
import { vi } from "vitest";
```

to:

```jsx
import { beforeEach, vi } from "vitest";
```

Then add this block immediately after the imports, before `function mockPdfUpload() {`:

```jsx
// HomePage's idle view (rendered by several tests below) now mounts
// TimeWeatherWidget, which calls fetch() once on mount (Open-Meteo). Give
// every test in this file a harmless default response so none of them hit
// the real network; tests that need a specific fetch behavior (see
// mockPdfUpload below) call vi.stubGlobal("fetch", ...) again afterward,
// which overrides this default for that test.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
});
```

- [ ] **Step 8: Run `routes.contract.test.jsx` to verify the fetch stub doesn't break it**

Run: `cd frontend && npx vitest run src/test/routes.contract.test.jsx`
Expected: PASS (23 tests) — same count as before this step; the default stub is a no-op for every test that doesn't care about `fetch`, and `mockPdfUpload()`'s own `vi.stubGlobal` call still wins for the PDF-upload tests.

- [ ] **Step 9: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — all suites green, including the new `weatherCodes.test.ts`, `formatClock.test.ts`, `useTimeAndWeather.test.ts`, and `TimeWeatherWidget.test.tsx`, plus every pre-existing test (no regressions in `HomePage`-adjacent tests from the new import/render, and no real network call from `routes.contract.test.jsx`).

- [ ] **Step 10: Manual visual verification**

Start the dev server (`cd frontend && npm run dev`, or via the Browser-pane `preview_start` tool with the `frontend` launch config already in `.claude/launch.json`) and open the home page (`/`) with no active chat. Confirm:
- The clock + date + weather card renders in the top-left corner, not overlapping the centered logo/input.
- With the sidebar open, the card's left edge lines up with the rest of the page content (same inset as the logo column).
- Close the sidebar (chevron reopen button appears) and confirm the card shifts right enough to clear it, matching the `.sb-open-btn + .page .home-time-weather` rule.
- If browser geolocation permission is denied, the weather row still appears after a moment (Hanoi fallback) rather than staying blank forever.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/TimeWeatherWidget.tsx frontend/src/components/TimeWeatherWidget.test.tsx frontend/src/pages/HomePage.tsx frontend/src/styles/base.css frontend/src/test/routes.contract.test.jsx
git commit -m "feat(home): render time + weather widget in the idle hero corner"
```
