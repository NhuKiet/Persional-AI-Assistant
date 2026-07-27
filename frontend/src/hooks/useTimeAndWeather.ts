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
      // Current-weather forecasts don't need house-level GPS precision —
      // round to ~1.1km before it leaves the browser in a URL query string
      // to a third party (Open-Meteo). Same forecast, far less precise
      // location leaked.
      (position) => applyResult({
        latitude: Math.round(position.coords.latitude * 100) / 100,
        longitude: Math.round(position.coords.longitude * 100) / 100,
      }),
      () => applyResult(HANOI_FALLBACK),
      { timeout: GEOLOCATION_TIMEOUT_MS },
    );

    return () => { cancelled = true; };
  }, []);

  return { now, weather };
}
