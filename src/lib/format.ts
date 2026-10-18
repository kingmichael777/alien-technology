// Every date, time and length shown in the app comes from here.

const pad = (n: number) => String(n).padStart(2, "0");

/** 9:27 PM */
export function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Today, 9:27 PM / Yesterday, 4:02 PM / Thu, Oct 15, 9:27 PM / Oct 15, 2025, 9:27 PM */
export function when(ts: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  const t = timeOfDay(ts);
  if (days === 0) return `Today, ${t}`;
  if (days === 1) return `Yesterday, ${t}`;
  const d = new Date(ts);
  if (days > 1 && days < 7) return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${t}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}, ${t}`;
}

/** Saturday, October 17, 2026 at 9:27 PM */
export function longWhen(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${timeOfDay(ts)}`;
}

/** 0:54 / 12:05 / 1:02:05 */
export function length(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Timer while recording: 00:54 / 12:05 / 1:02:05 */
export function timer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Transcript stamp from seconds, counted down like a clock: 7.9 s is 0:07. */
export function stamp(seconds: number): string {
  return length(Math.floor(Math.max(0, seconds)) * 1000);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
