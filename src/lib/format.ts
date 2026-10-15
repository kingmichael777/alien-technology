// Single source for every date and coordinate shown in the app.
const pad = (n: number) => String(n).padStart(2, "0");

export function clock(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${pad(d.getMinutes())} ${ap}`;
}

/** 11.08.24 (month first) */
export function compactDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}.${String(d.getFullYear()).slice(-2)}`;
}

/** 11.08.24 · 02:17 AM */
export function compact(ts: number): string {
  return `${compactDate(ts)} · ${clock(ts)}`;
}

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Today, 02:17 AM / Yesterday, 11:43 PM / 3 Days Ago, 08:09 PM / 1 Week Ago, 04:22 PM */
export function relative(ts: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  let label: string;
  if (days <= 0) label = "Today";
  else if (days === 1) label = "Yesterday";
  else if (days < 7) label = `${days} Days Ago`;
  else if (days < 30) {
    const w = Math.floor(days / 7);
    label = `${w} Week${w > 1 ? "s" : ""} Ago`;
  } else if (days < 365) {
    const m = Math.floor(days / 30);
    label = `${m} Month${m > 1 ? "s" : ""} Ago`;
  } else {
    const y = Math.floor(days / 365);
    label = `${y} Year${y > 1 ? "s" : ""} Ago`;
  }
  return `${label}, ${clock(ts)}`;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export function dayHeader(ts: number): string {
  return `${WEEKDAYS[new Date(ts).getDay()]} ${compactDate(ts)}`;
}

/** 39.7425° N, 105.1786° W */
export function coords(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** For datetime-local inputs */
export function toLocalInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
