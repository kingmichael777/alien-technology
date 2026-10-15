import { useEffect, useRef, useState } from "react";
import type { CaseRec } from "@/data/db";
import { openSealed } from "@/data/seal";
import { useUnlocked } from "@/store/unlocked";
import { BackLink, PageHeader } from "@/components/at/ui";
import { cn } from "@/lib/utils";
import { SealMark } from "./SealMark";
import { stageLabel } from "./logic";
import { usePasscodeAttempt } from "./usePasscodeAttempt";

/** Shown in place of an encrypted case until its passcode opens it into memory. */
export function SealedGate({ c }: { c: CaseRec }) {
  const [pass, setPass] = useState("");
  const attempt = usePasscodeAttempt(c.id);
  const setBundle = useUnlocked((s) => s.set);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass || attempt.busy || attempt.locked) return;
    const bundle = await attempt.run((onStage) => openSealed(c.id, pass, onStage));
    if (!bundle) {
      setPass("");
      input.current?.focus();
      return;
    }
    // Left the case or sent the app to the background while the key was deriving: keep it locked.
    if (!mounted.current || document.visibilityState === "hidden") return;
    setBundle(bundle);
  };

  return (
    <div>
      <PageHeader back={<BackLink to="/" label="Vault" />} title={<span className="sr-only">Sealed case</span>} />
      <div className="anim-fade flex flex-col items-center px-8 pt-[11vh] text-center">
        <SealMark />
        <h1 className="codename mt-2.5 text-[30px] leading-[1.1] break-words text-ink">{c.codename}</h1>
        <span className="mt-6 h-px w-12 bg-amber-line" aria-hidden />
        <form className="mt-8 w-full max-w-[320px] text-left" onSubmit={submit}>
          <label htmlFor="case-passcode" className="mono-label mb-1.5 block text-ink-muted">
            Passcode
          </label>
          <input
            ref={input}
            id="case-passcode"
            name="case-passcode"
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
          <p role="alert" className="mt-2 min-h-5 font-mono text-[12px] leading-5 text-pin">
            {attempt.message}
          </p>
          <button type="submit" className="btn btn-primary mt-2 w-full" disabled={!pass || attempt.busy || attempt.locked}>
            <span className={cn(attempt.busy && "animate-pulse")}>{attempt.busy ? stageLabel(attempt.stage) : "Open case"}</span>
          </button>
        </form>
        <p className="mt-8 max-w-[34ch] font-mono text-[10.5px] leading-relaxed tracking-[0.04em] text-ink-faint">
          Read only, decrypted in memory. Locks again when you leave the case or the app goes to the background.
        </p>
      </div>
    </div>
  );
}
