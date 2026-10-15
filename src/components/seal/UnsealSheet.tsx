import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { CaseRec } from "@/data/db";
import { unsealCase } from "@/data/seal";
import { Sheet } from "@/components/at/ui";
import { cn } from "@/lib/utils";
import { stageLabel } from "./logic";
import { usePasscodeAttempt } from "./usePasscodeAttempt";

const noop = () => {};

/** Passcode, then decrypt every record back to storage and return the case to Active. */
export function UnsealSheet({ c, open, onClose }: { c: CaseRec; open: boolean; onClose: () => void }) {
  const [pass, setPass] = useState("");
  const attempt = usePasscodeAttempt(c.id);
  useEffect(() => {
    if (open) setPass("");
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass || attempt.busy || attempt.locked) return;
    const ok = await attempt.run(async (onStage) => {
      await unsealCase(c.id, pass, onStage);
      return true;
    });
    if (!ok) {
      setPass("");
      return;
    }
    toast.success("Case unsealed.");
    onClose();
  };

  return (
    <Sheet open={open} onClose={attempt.busy ? noop : onClose} title="Unseal case">
      <form className="space-y-4 px-5 pb-2" onSubmit={submit}>
        <p className="text-sm leading-relaxed text-ink-muted">Decrypts every record and file, stores them readable on this device again, and returns the case to Active.</p>
        <div>
          <label htmlFor="unseal-passcode" className="mono-label mb-1.5 block text-ink-muted">Passcode</label>
          <input
            id="unseal-passcode"
            type="password"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={attempt.busy}
            className="field font-mono text-[16px] tracking-[0.12em]"
            style={{ caretColor: "var(--amber)" }}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <p role="alert" className="mt-2 min-h-5 font-mono text-[12px] leading-5 text-pin">{attempt.message}</p>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn btn-ghost flex-1" disabled={attempt.busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary flex-1" disabled={!pass || attempt.busy || attempt.locked}>
            <span className={cn(attempt.busy && "animate-pulse")}>{attempt.busy ? stageLabel(attempt.stage) : "Unseal"}</span>
          </button>
        </div>
      </form>
    </Sheet>
  );
}
