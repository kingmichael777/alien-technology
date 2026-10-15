import { useCallback, useEffect, useState } from "react";
import { lockoutMessage, lockoutRemaining, type OpenStage } from "@/data/seal";

/** Busy state, stage, error and the live lockout countdown for one passcode form. */
export function usePasscodeAttempt(caseId: string) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<OpenStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(() => lockoutRemaining(caseId));
  const locked = wait > 0;

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => {
      const w = lockoutRemaining(caseId);
      setWait(w);
      if (w <= 0) setError(null);
    }, 250);
    return () => clearInterval(t);
  }, [locked, caseId]);

  const run = useCallback(
    async <T,>(fn: (onStage: (s: OpenStage) => void) => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(setStage);
      } catch (e) {
        setError((e as Error).message);
        setWait(lockoutRemaining(caseId));
        return null;
      } finally {
        setBusy(false);
        setStage(null);
      }
    },
    [caseId],
  );

  return { busy, stage, locked, message: locked ? lockoutMessage(wait) : error, run };
}
