import { useRef } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Archive, Camera, Crosshair, Mic, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/store/app";
import { useCapture } from "@/store/capture";
import { useCaptureTarget } from "@/data/hooks";
import { cn } from "@/lib/utils";
import { SW } from "./ui";

function NavDot({ on }: { on: boolean }) {
  return <span className={cn("absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-amber transition-opacity", on ? "opacity-100" : "opacity-0")} />;
}

const item = "tap relative inline-flex items-center justify-center rounded-full";

export function CapsuleBar() {
  const { pathname, search } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const navigate = useNavigate();
  const setPlusOpen = useApp((s) => s.setPlusOpen);
  const setPendingPhoto = useApp((s) => s.setPendingPhoto);
  const { target } = useCaptureTarget();
  const fileRef = useRef<HTMLInputElement>(null);

  const boardOn = pathname.startsWith("/case/") && search["tab"] === "board";
  const vaultOn = pathname === "/";
  const searchOn = pathname === "/search";

  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}>
      <div className="pointer-events-auto flex h-[60px] w-full max-w-[448px] items-center justify-between rounded-[28px] border border-amber-line bg-surface/92 px-2 backdrop-blur-xl">
        <Link to="/" aria-label="Vault" className={cn(item, vaultOn ? "text-amber" : "text-ink-muted")}>
          <Archive size={22} strokeWidth={SW} />
          <NavDot on={vaultOn} />
        </Link>
        <span className="h-7 w-px bg-line-strong" />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Voice capture" className={cn(item, "text-amber")} onClick={() => {
              // Start audio inside the tap itself; iOS refuses it otherwise.
              useCapture.getState().start();
              navigate({ to: "/capture/voice" });
            }}>
            <Mic size={24} strokeWidth={SW} />
          </button>
          <button type="button" aria-label="Photo capture" className={cn(item, "text-amber")} onClick={() => fileRef.current?.click()}>
            <Camera size={24} strokeWidth={SW} />
          </button>
          <button type="button" aria-label="New" className={cn(item, "text-amber")} onClick={() => setPlusOpen(true)}>
            <Plus size={26} strokeWidth={SW} />
          </button>
        </div>
        <span className="h-7 w-px bg-line-strong" />
        <Link to="/search" aria-label="Search" className={cn(item, searchOn ? "text-amber" : "text-ink-muted")}>
          <Search size={22} strokeWidth={SW} />
          <NavDot on={searchOn} />
        </Link>
        <button
          type="button"
          aria-label="Evidence board"
          className={cn(item, boardOn ? "text-amber" : "text-ink-muted")}
          onClick={() => {
            if (!target) {
              toast("Open an active case to view its board.");
              return;
            }
            navigate({ to: "/case/$id", params: { id: target.id }, search: { tab: "board" } });
          }}
        >
          <Crosshair size={22} strokeWidth={SW} />
          <NavDot on={boardOn} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setPendingPhoto(f);
          navigate({ to: "/capture/photo" });
        }}
      />
    </nav>
  );
}
