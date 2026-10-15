import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CaseRec } from "@/data/db";
import { MIN_PASSCODE, sealCase } from "@/data/seal";
import { Sheet } from "@/components/at/ui";
import { cn } from "@/lib/utils";
import { passcodeProblem, progressLabel } from "./logic";

const noop = () => {};

/** Choose a passcode, then encrypt the whole case. Cannot be dismissed while it runs. */
export function SealSheet({ c, open, onClose }: { c: CaseRec; open: boolean; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPass("");
    setConfirm("");
    setProgress(null);
    setError(null);
  }, [open]);

  const problem = passcodeProblem(pass, confirm);
  const hint = pass.length < MIN_PASSCODE ? `At least ${MIN_PASSCODE} characters.` : confirm && confirm !== pass ? "Passcodes do not match." : "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sealCase(c.id, pass, (done, total) => setProgress({ done, total }));
      toast.success("Case sealed and encrypted.");
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const field = "field font-mono text-[16px] tracking-[0.12em]";
  return (
    <Sheet open={open} onClose={busy ? noop : onClose} title="Seal case">
      <form className="space-y-4 px-5 pb-2" onSubmit={submit}>
        <p className="text-sm leading-relaxed text-ink-muted">
          Encrypts every note, subject, link, evidence record and file in this case with a key derived from this passcode. The case becomes read only. Its codename stays visible in the vault.
        </p>
        <div>
          <label htmlFor="seal-passcode" className="mono-label mb-1.5 block text-ink-muted">Passcode</label>
          <input id="seal-passcode" type="password" autoFocus autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} className={field} style={{ caretColor: "var(--amber)" }} value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>
        <div>
          <label htmlFor="seal-confirm" className="mono-label mb-1.5 block text-ink-muted">Confirm passcode</label>
          <input id="seal-confirm" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} className={field} style={{ caretColor: "var(--amber)" }} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <p className={cn("mt-1.5 min-h-4 font-mono text-[11.5px]", confirm && confirm !== pass && pass.length >= MIN_PASSCODE ? "text-pin" : "text-ink-faint")}>{hint}</p>
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-amber">There is no way to recover a sealed case without this passcode.</p>
        {error && <p role="alert" className="font-mono text-[12px] text-pin">{error}</p>}
        {busy ? (
          <div className="pt-1 pb-2" aria-live="polite">
            <div className="h-[2px] overflow-hidden rounded-full bg-line">
              <div className="h-full bg-amber transition-[width] duration-150 ease-out" style={{ width: `${progress ? (100 * progress.done) / Math.max(progress.total, 1) : 0}%` }} />
            </div>
            <div className="mt-2.5 font-mono text-[11.5px] tracking-[0.08em] text-ink-muted">{progressLabel(progress?.done ?? 0, progress?.total ?? 0)}</div>
          </div>
        ) : (
          <div className="flex gap-3 pt-1">
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={!!problem}>Seal case</button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
