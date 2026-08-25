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
        (() => {
          const { icon, label } = weatherCodeToDisplay(weather.code);
          return (
            <div className="htw-weather">
              {icon} {Math.round(weather.tempC)}°C · {label}
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
