import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useCase } from "@/data/hooks";
import { settingsRepo } from "@/data/repo";
import { isEncrypted } from "@/data/seal";
import { useApp } from "@/store/app";
import { useUnlocked } from "@/store/unlocked";
import { SealedGate } from "@/components/seal/SealedGate";

export const Route = createFileRoute("/case/$id")({
  component: CaseLayout,
});

function CaseLayout() {
  const { id } = Route.useParams();
  const c = useCase(id);
  const setCurrent = useApp((s) => s.setCurrentCase);
  const bundle = useUnlocked((s) => s.bundle);
  const clearBundle = useUnlocked((s) => s.clear);
  const encrypted = isEncrypted(c);
  const open = !!c && bundle?.caseId === id && bundle.keyRef === c.encryptionKeyRef;

  useEffect(() => {
    setCurrent(id);
    return () => setCurrent(null);
  }, [id, setCurrent]);

  useEffect(() => {
    if (c?.status === "active") void settingsRepo.set("lastActiveCaseId", id);
  }, [c?.status, id]);

  // Unsealed or deleted: the readable records (or nothing) are on screen now, so the in-memory copy goes.
  useEffect(() => {
    if (c !== undefined && !encrypted && bundle?.caseId === id) clearBundle();
  }, [c, encrypted, bundle, id, clearBundle]);

  if (c === undefined) return <div className="min-h-dvh" />;
  if (c === null)
    return (
      <div className="px-6 py-24 text-center">
        <p className="font-serif text-2xl">This case no longer exists.</p>
        <Link to="/" className="btn btn-outline mt-6">
          Return to the vault
        </Link>
      </div>
    );
  if (encrypted && !open) return <SealedGate key={c.encryptionKeyRef} c={c} />;
  return <Outlet />;
}
