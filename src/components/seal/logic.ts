import type { OpenStage } from "@/data/seal";
import { MIN_PASSCODE } from "@/data/seal";

/** What stops a new passcode from being used, or null when it can seal. */
export function passcodeProblem(pass: string, confirm: string): string | null {
  if (pass.length < MIN_PASSCODE) return `Use at least ${MIN_PASSCODE} characters.`;
  if (confirm !== pass) return "Passcodes do not match.";
  return null;
}

/** Progress line under the seal bar: the key comes first, then every record and file. */
export function progressLabel(done: number, total: number): string {
  return done <= 0 ? "Deriving key" : `Encrypting ${Math.min(done, total)} of ${total}`;
}

export function stageLabel(stage: OpenStage | null): string {
  return stage === "decrypt" ? "Decrypting" : stage === "write" ? "Writing records" : "Deriving key";
}

/** The decrypted bundle stays in memory only on its own case screens and on its own evidence pages. */
export function routeKeepsBundle(b: { caseId: string; evidence: { id: string }[] }, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "");
  const base = `/case/${b.caseId}`;
  if (p === base || p.startsWith(`${base}/`)) return true;
  const m = /^\/evidence\/([^/]+)$/.exec(p);
  if (!m) return false;
  let eid = m[1]!;
  try {
    eid = decodeURIComponent(eid);
  } catch {
    return false;
  }
  return b.evidence.some((e) => e.id === eid);
}
