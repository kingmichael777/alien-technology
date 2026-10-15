import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useCase } from "@/data/hooks";
import { settingsRepo } from "@/data/repo";
import { useApp } from "@/store/app";

export const Route = createFileRoute("/case/$id")({
  component: CaseLayout,
});

function CaseLayout() {
  const { id } = Route.useParams();
  const c = useCase(id);
  const setCurrent = useApp((s) => s.setCurrentCase);

  useEffect(() => {
    setCurrent(id);
    return () => setCurrent(null);
  }, [id, setCurrent]);

  useEffect(() => {
    if (c?.status === "active") void settingsRepo.set("lastActiveCaseId", id);
  }, [c?.status, id]);

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
  return <Outlet />;
}
