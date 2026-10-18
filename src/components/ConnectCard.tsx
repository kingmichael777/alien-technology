import { useState } from "react";
import { ClipboardPaste, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, canonicalCode, looksLikeCode, setCode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Spinner, SW } from "./ui";

/** Saves the access code after the server accepts it. Returns an error message, or null when connected. */
export async function connectWith(input: string): Promise<string | null> {
  const code = canonicalCode(input);
  if (!looksLikeCode(code)) return "That doesn't look like an access code. It starts with ALIEN.";
  try {
    await api.ping(code);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return "Your server didn't accept that code. Check it and try again.";
    return e instanceof Error ? e.message : "Couldn't reach your server.";
  }
  setCode(code);
  return null;
}

export function ConnectCard({ className, compact }: { className?: string; compact?: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  const submit = async (input: string) => {
    setBusy(true);
    setError(null);
    const problem = await connectWith(input);
    setBusy(false);
    if (problem) setError(problem);
    else {
      setValue("");
      toast("This phone is connected to your server.");
    }
  };

  return (
    <div className={cn("card-at p-4", className)}>
      {!compact && (
        <div className="mb-3 flex items-start gap-3">
          <KeyRound size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
          <div>
            <p className="text-[15px] font-medium text-ink">Connect this phone</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
              Paste your access code once. Then every recording gets a transcript and notes from your server.
            </p>
          </div>
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
      >
        <input
          className="field font-mono text-[15px] tracking-wide"
          placeholder="ALIEN-XXXXX-XXXXX-XXXXX-XXXXX"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Access code"
        />
        {error && <p className="text-[13px] text-pin">{error}</p>}
        <div className="flex gap-2">
          {canPaste && (
            <button
              type="button"
              className="btn btn-ghost flex-1"
              disabled={busy}
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  setValue(text.trim());
                  if (looksLikeCode(text)) void submit(text);
                } catch {
                  setError("Couldn't read what you copied. Paste it into the box instead.");
                }
              }}
            >
              <ClipboardPaste size={18} strokeWidth={SW} />
              Paste
            </button>
          )}
          <button type="submit" className="btn btn-primary flex-1" disabled={busy || !value.trim()}>
            {busy ? <Spinner className="border-black/20 border-t-black" /> : null}
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
