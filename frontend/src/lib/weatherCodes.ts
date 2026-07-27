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
