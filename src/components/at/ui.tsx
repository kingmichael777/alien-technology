import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ShieldHalf } from "lucide-react";
import type { CaseStatus, Threat } from "@/data/db";
import { useOnline } from "@/data/hooks";
import { cn } from "@/lib/utils";

export const SW = 1.5;

export function Hexagon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("text-amber", className)} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M20 3.5 34.3 11.75v16.5L20 36.5 5.7 28.25v-16.5Z" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("section-label", className)}>{children}</div>;
}

export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card-at", className)} {...rest}>
      {children}
    </div>
  );
}

const pill: Record<CaseStatus, string> = {
  active: "bg-amber-fill text-amber border-amber/40",
  sealed: "bg-surface-raised text-ink-muted border-line-strong",
  archived: "text-ink-muted border-line",
};

export function StatusPill({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-sans text-[11px] font-medium uppercase tracking-[0.1em]", pill[status], className)}>
      {status !== "archived" && <span className={cn("size-2 rounded-full", status === "active" ? "bg-amber" : "bg-ink-muted")} />}
      {status}
    </span>
  );
}

export const threatColor: Record<Threat, string> = {
  undetermined: "bg-amber",
  low: "bg-ink-muted",
  elevated: "bg-amber",
  high: "bg-pin",
};

export function ThreatDot({ level, className }: { level: Threat; className?: string }) {
  return <span className={cn("inline-block size-2.5 rounded-full", threatColor[level], className)} />;
}

export function MonoField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-b border-line py-2.5 last:border-b-0", className)}>
      <div className="mono-label mb-1">{label}</div>
      <div className="font-mono text-[13.5px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/** Visual redaction: a solid bar. Press and hold to reveal while held. Not encryption. */
export function Redact({ text, redacted, className }: { text: string; redacted: boolean; className?: string }) {
  const [shown, setShown] = useState(false);
  if (!redacted) return <span className={className}>{text}</span>;
  const hide = () => setShown(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Redacted value. Press and hold to reveal."
      onPointerDown={(e) => {
        e.preventDefault();
        setShown(true);
      }}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => e.key === " " && setShown(true)}
      onKeyUp={hide}
      className={cn("inline-block min-h-[1.25em] select-none align-middle", shown ? "text-ink" : "bg-redact text-transparent", className)}
      style={{ minWidth: `${Math.max(10, text.length + 2)}ch`, WebkitTouchCallout: "none" }}
    >
      {text}
    </span>
  );
}

export function IconButton({ label, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn("tap inline-flex items-center justify-center rounded-full text-ink-muted transition-colors active:text-amber", className)} {...rest}>
      {children}
    </button>
  );
}

export function PageHeader({ back, title, right, sub }: { back?: ReactNode; title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/92 backdrop-blur-md">
      <div className="flex min-h-14 items-center gap-1 px-2">
        {back}
        <div className="min-w-0 flex-1 px-1">{title}</div>
        <OfflineChip />
        {right}
      </div>
      {sub}
    </header>
  );
}

export function BackLink({ to, params, search, label = "Back" }: { to: string; params?: Record<string, string>; search?: Record<string, unknown>; label?: string }) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} params={params as any} search={search as any} aria-label={label} className="tap inline-flex items-center justify-center text-ink-muted active:text-amber">
      <ChevronLeft size={24} strokeWidth={SW} />
    </Link>
  );
}

export function ShieldLink() {
  return (
    <Link to="/settings" aria-label="Settings" className="tap inline-flex items-center justify-center text-amber">
      <ShieldHalf size={26} strokeWidth={SW} />
    </Link>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="anim-fade flex flex-col items-center px-6 py-14 text-center">
      <Hexagon className="mb-4 size-9 opacity-60" />
      <p className="font-serif text-xl text-ink">{title}</p>
      {body && <p className="mt-2 max-w-[30ch] text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="anim-fade absolute inset-0 bg-bg/75" onClick={onClose} />
      <div className="anim-slide-up pb-safe absolute inset-x-0 bottom-0 mx-auto max-h-[86vh] max-w-[480px] overflow-y-auto rounded-t-[20px] border border-b-0 border-line-strong bg-surface-raised">
        <div className="mx-auto mt-2.5 mb-3 h-1 w-10 rounded-full bg-line-strong" />
        {title && <div className="section-label px-5 pb-3">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function SheetRow({ icon, label, hint, onClick, danger, disabled }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn("flex min-h-14 w-full items-center gap-4 border-t border-line px-5 text-left transition-colors active:bg-surface disabled:opacity-40", danger ? "text-pin" : "text-ink")}
    >
      {icon && <span className={cn("shrink-0", danger ? "text-pin" : "text-amber")}>{icon}</span>}
      <span className="flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  requireText,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  requireText?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);
  const ok = !requireText || typed.trim() === requireText;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 px-5 pb-2">
        <p className="text-sm text-ink-muted">{body}</p>
        {requireText && (
          <div>
            <label className="mono-label mb-1.5 block text-ink-muted">Type {requireText} to confirm</label>
            <input autoFocus className="field font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger flex-1"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function TextPromptSheet({ open, onClose, title, label, initial, placeholder, submitLabel, onSubmit }: { open: boolean; onClose: () => void; title: string; label: string; initial?: string; placeholder?: string; submitLabel: string; onSubmit: (v: string) => void | Promise<void> }) {
  const [v, setV] = useState(initial ?? "");
  useEffect(() => {
    if (open) setV(initial ?? "");
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4 px-5 pb-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!v.trim()) return;
          await onSubmit(v);
        }}
      >
        <div>
          <label className="mono-label mb-1.5 block text-ink-muted">{label}</label>
          <input autoFocus className="field codename text-lg" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} autoCapitalize="characters" />
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={!v.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Long-press detector for touch and mouse. */
export function useLongPress(onLong: () => void, ms = 480) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
  };
  return {
    fired,
    handlers: {
      onPointerDown: () => {
        fired.current = false;
        clear();
        t.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, ms);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        clear();
        fired.current = true;
        onLong();
      },
    },
  };
}

export function Silhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 125" className={cn("bg-surface-raised text-line-strong", className)} aria-hidden>
      <circle cx="50" cy="46" r="19" fill="currentColor" />
      <path d="M12 125c2-26 18-40 38-40s36 14 38 40Z" fill="currentColor" />
    </svg>
  );
}

export function QuietState({ label }: { label: string }) {
  return (
    <div className="anim-fade px-6 py-20 text-center">
      <div className="mono-label text-ink-faint">{label}</div>
      <p className="mt-3 font-serif text-xl text-ink-muted">Available in the next build.</p>
    </div>
  );
}

export function OfflineChip({ className }: { className?: string }) {
  const online = useOnline();
  if (online) return null;
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 font-mono text-[10px] tracking-[0.14em] text-ink-muted", className)}>OFFLINE</span>;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wraps matched terms in amber. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const t = terms.filter((x) => x.length > 1);
  if (!t.length) return <>{text}</>;
  const re = new RegExp(`(${t.map(esc).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i} className="bg-transparent text-amber">{part}</mark> : <span key={i}>{part}</span>))}
    </>
  );
}

/** One-time disclosure before live transcription is enabled. */
export function TranscriptionDisclosure({ open, onEnable, onDecline }: { open: boolean; onEnable: () => void; onDecline: () => void }) {
  return (
    <Sheet open={open} onClose={onDecline} title="Live transcription">
      <div className="space-y-5 px-5 pb-2">
        <p className="text-[15px] leading-relaxed text-ink">
          Live transcription uses your phone's speech service, which may process audio on Apple or Google servers. Your recording itself stays on this device.
        </p>
        <div className="flex gap-3">
          <button className="btn btn-ghost flex-1" onClick={onDecline}>Not now</button>
          <button className="btn btn-primary flex-1" onClick={onEnable}>Enable</button>
        </div>
      </div>
    </Sheet>
  );
}
