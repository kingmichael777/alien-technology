import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useApp } from "@/store/app";
import { FilingChip } from "./CaseSheets";
import { SW } from "./ui";

export function CaptureFrame({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const navigate = useNavigate();
  const setOverride = useApp((s) => s.setFilingOverride);
  useEffect(() => () => setOverride(null), [setOverride]);
  const close = () => (window.history.length > 1 ? router.history.back() : navigate({ to: "/" }));
  return (
    <div className="pt-safe min-h-dvh px-5 pb-10">
      <div className="flex min-h-14 items-center justify-between">
        <div className="section-label">{label}</div>
        <button aria-label="Close" onClick={close} className="tap -mr-2 inline-flex items-center justify-center text-ink-muted">
          <X size={24} strokeWidth={SW} />
        </button>
      </div>
      <div className="mb-6">
        <FilingChip />
      </div>
      {children}
    </div>
  );
}
