import type { GeoPoint } from "@/data/db";
import { settingsRepo } from "@/data/repo";

/**
 * Begin a GPS fix for a capture. Never blocks: callers save first and attach the
 * fix when it resolves. The first call triggers the permission prompt once; the
 * outcome sets "attachLocation".
 */
export function startFix(timeoutMs = 8000): Promise<GeoPoint | null> {
  return (async () => {
    const pref = await settingsRepo.get<boolean | null>("attachLocation", null);
    if (pref === false || typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
    return new Promise<GeoPoint | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (pref === null) void settingsRepo.set("attachLocation", true);
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), source: "device" });
        },
        (err) => {
          if (err.code === 1 && pref === null) void settingsRepo.set("attachLocation", false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
      );
    });
  })();
}

/** A fix the caller waits for (location ping). */
export function getFixNow(timeoutMs = 8000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Location is not available on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), source: "device" }),
      (err) => reject(new Error(err.code === 1 ? "Location permission was denied." : "Could not get a location fix.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
