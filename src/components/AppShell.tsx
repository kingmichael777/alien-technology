import { useEffect, type ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { getSetting, setSetting } from "@/lib/db";
import { importEarlier } from "@/lib/earlier";
import { useSetting } from "@/lib/hooks";
import { registerServiceWorker } from "@/lib/pwa";
import { recoverInterrupted, useRecorder } from "@/lib/recorder";
import { startSync } from "@/lib/sync";
import { connectWith } from "./ConnectCard";
import { RecordingBanner } from "./RecordButton";

export type DisplayMode = "standard" | "contrast" | "night";

/** A link like https://alien-technology.netlify.app/#connect=ALIEN-... connects this phone in one tap. */
async function connectFromLink() {
  const m = location.hash.match(/^#connect=(.+)$/);
  if (!m) return;
  // Take the code out of the address bar and history right away.
  history.replaceState(null, "", location.pathname + location.search);
  const problem = await connectWith(decodeURIComponent(m[1]));
  if (problem) toast(problem);
  else toast("This phone is connected to your server.");
}

/** When a new version of the app takes over, reload into it, waiting until no recording is running. */
function reloadOnUpdate() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const reload = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    const busy = (s: string) => s === "starting" || s === "recording" || s === "paused" || s === "saving";
    if (!busy(useRecorder.getState().state)) return reload();
    const stop = useRecorder.subscribe((st) => {
      if (!busy(st.state)) {
        stop();
        reload();
      }
    });
  });
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;
  reloadOnUpdate();
  void registerServiceWorker();
  void connectFromLink();
  try {
    if (!(await getSetting("persistAsked", false))) {
      await setSetting("persistAsked", true);
      await navigator.storage?.persist?.().catch(() => false);
    }
  } catch {
    // Not available here; recordings are still saved.
  }
  const recovered = await recoverInterrupted().catch(() => null);
  if (recovered) toast("A recording that was cut off has been saved.");
  const earlier = await importEarlier().catch(() => 0);
  if (earlier > 0) toast(`${earlier} voice ${earlier === 1 ? "note" : "notes"} from the earlier version ${earlier === 1 ? "is" : "are"} now in your recordings.`);
  startSync();
}

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useSetting<DisplayMode>("displayMode", "standard");

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    document.documentElement.dataset["mode"] = mode;
  }, [mode]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-bg">
      <RecordingBanner />
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: "!bg-surface-raised !border !border-line-strong !text-ink !font-sans !rounded-[12px]",
            description: "!text-ink-muted",
          },
        }}
      />
    </div>
  );
}
