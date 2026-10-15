import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ensureSeeded } from "@/data/seed";
import { useSetting } from "@/data/hooks";
import { settingsRepo } from "@/data/repo";
import { registerServiceWorker } from "@/lib/pwa";
import { CapsuleBar } from "./CapsuleBar";
import { NewCaseSheet, PlusSheet } from "./CaseSheets";

export type DisplayMode = "standard" | "contrast" | "night";

export function AppShell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const mode = useSetting<DisplayMode>("displayMode", "standard");
  const grain = useSetting<boolean>("grain", true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const capture = pathname.startsWith("/capture");

  useEffect(() => {
    ensureSeeded().finally(() => setReady(true));
    void registerServiceWorker();
    void (async () => {
      if (await settingsRepo.get("persistRequested", false)) return;
      await settingsRepo.set("persistRequested", true);
      await navigator.storage?.persist?.().catch(() => false);
    })();
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset["mode"] = mode;
    el.dataset["grain"] = grain ? "on" : "off";
  }, [mode, grain]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-bg">
      {ready ? <div className={capture ? "" : "pb-28"}>{children}</div> : <div className="min-h-dvh" />}
      {ready && !capture && <CapsuleBar />}
      <PlusSheet />
      <NewCaseSheet />
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
