import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useOnline } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export const SW = 1.5;

export function Hexagon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("text-amber", className)} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M20 3.5 34.3 11.75v16.5L20 36.5 5.7 28.25v-16.5Z" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-amber/30 border-t-amber", className)}
    />
  );
}

export function IconButton({ label, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("tap inline-flex items-center justify-center rounded-full text-ink-muted transition-colors active:text-amber", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function BackLink({ label = "Back" }: { label?: string }) {
  return (
    <Link to="/" aria-label={label} className="tap inline-flex items-center justify-center text-ink-muted active:text-amber">
      <ChevronLeft size={26} strokeWidth={SW} />
    </Link>
  );
}

export function PageHeader({ left, title, right }: { left?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/92 backdrop-blur-md">
      <div className="flex min-h-14 items-center gap-1 px-2">
        {left}
        <div className="min-w-0 flex-1 px-1">{title}</div>
        <OfflineChip />
        {right}
      </div>
    </header>
  );
}

export function OfflineChip({ className }: { className?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full border border-line-strong px-2 font-mono text-[10px] tracking-[0.14em] text-ink-muted", className)}>
      OFFLINE
    </span>
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

export function SheetRow({
  icon,
  label,
  hint,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-4 border-t border-line px-5 text-left transition-colors active:bg-surface disabled:opacity-40",
        danger ? "text-pin" : "text-ink",
      )}
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
  cancelLabel = "Cancel",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 px-5 pb-2">
        <p className="text-[15px] leading-relaxed text-ink-muted">{body}</p>
        <div className="flex gap-3 pt-1">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className="btn btn-danger flex-1"
            disabled={busy}
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

export function TextSheet({
  open,
  onClose,
  title,
  label,
  initial,
  placeholder,
  submitLabel,
  hint,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  hint?: string;
  onSubmit: (v: string) => void | Promise<void>;
}) {
  const [v, setV] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setV(initial ?? "");
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        className="space-y-4 px-5 pb-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(v);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <label className="mb-1.5 block text-[13px] text-ink-muted">{label}</label>
          <input autoFocus className="field text-[16px]" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
          {hint && <p className="mt-2 text-xs text-ink-muted">{hint}</p>}
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Wraps matched words in amber. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const t = terms.filter((x) => x.length > 0);
  if (!t.length) return <>{text}</>;
  const re = new RegExp(`(${t.map(esc).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-transparent text-amber">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
