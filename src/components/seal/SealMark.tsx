import { Lock } from "lucide-react";
import { SW } from "@/components/at/ui";
import { cn } from "@/lib/utils";

export const SEALED_ENCRYPTED = "Sealed · Encrypted";

/** Lock in a thin amber ring, over the "SEALED · ENCRYPTED" label. */
export function SealMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <span className="inline-flex size-[60px] items-center justify-center rounded-full border border-amber-line bg-amber-fill text-amber">
        <Lock size={24} strokeWidth={SW} aria-hidden />
      </span>
      <span className="mono-label mt-5 tracking-[0.18em]">{SEALED_ENCRYPTED}</span>
    </div>
  );
}
