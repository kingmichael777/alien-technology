import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { isEncrypted } from "@/data/seal";
import { useUnlocked } from "@/store/unlocked";
import { routeKeepsBundle } from "./logic";

const drop = () => useUnlocked.getState().clear();

/**
 * Drops the decrypted case from memory when the route leaves that case (its screens and its evidence
 * pages), when the app goes to the background, and when the case is deleted or sealed under another key.
 * Unsealing is handled by the case layout itself, after its screen has moved on to the readable records.
 */
export function useUnlockGuard() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bundle = useUnlocked((s) => s.bundle);

  useEffect(() => {
    if (bundle && (document.visibilityState === "hidden" || !routeKeepsBundle(bundle, pathname))) drop();
  }, [bundle, pathname]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") drop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", drop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", drop);
    };
  }, []);

  const caseId = bundle?.caseId;
  // Tagged with the case it was read for, so a result still pending for another case is never acted on.
  const stored = useLiveQuery(async () => (caseId ? { caseId, rec: (await db.cases.get(caseId)) ?? null } : null), [caseId]);
  useEffect(() => {
    if (!bundle || !stored || stored.caseId !== bundle.caseId) return;
    const rec = stored.rec;
    if (!rec || (isEncrypted(rec) && rec.encryptionKeyRef !== bundle.keyRef)) drop();
  }, [bundle, stored]);
}
