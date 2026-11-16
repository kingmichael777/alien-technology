import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { googleSignInUrl, looksLikeEmail, signIn } from "@/lib/account";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Spinner, SW } from "./ui";

/** Sign in with an email and the 6-digit code sent to it. */
export function SignInCard({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleId, setGoogleId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .authConfig()
      .then((c) => live && setGoogleId(c.google_client_id))
      .catch(() => undefined); // offline or not set up: email sign-in is still here
    return () => {
      live = false;
    };
  }, []);

  const sendCode = async () => {
    const to = email.trim().toLowerCase();
    if (!looksLikeEmail(to)) return setError("That doesn't look like an email address.");
    setBusy(true);
    setError(null);
    try {
      await api.authStart(to);
      setSentTo(to);
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!sentTo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await signIn(sentTo, value);
      toast(`Signed in as ${session.email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server.");
      setBusy(false);
    }
  };

  return (
    <div className={cn("card-at p-4", className)}>
      <div className="mb-3 flex items-start gap-3">
        <Mail size={20} strokeWidth={SW} className="mt-0.5 shrink-0 text-amber" />
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{sentTo ? "Enter your code" : "Sign in"}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
            {sentTo ? (
              <>
                If <span className="break-all text-ink">{sentTo}</span> has an account, a 6-digit code is on its way. It can take a
                minute. No email? Ask the owner to add you.
              </>
            ) : (
              googleId
                ? "Sign in to get a transcript and notes for every recording."
                : "Enter your email and we'll send you a 6-digit code. Then every recording gets a transcript and notes."
            )}
          </p>
        </div>
      </div>

      {sentTo ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <input
            className="field text-center font-mono text-[22px] tracking-[0.35em]"
            placeholder="000000"
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              setError(null);
              if (digits.length === 6) void verify(digits);
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoFocus
            aria-label="6-digit code"
          />
          {error && <p className="text-[13px] text-pin">{error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy || code.length !== 6}>
            {busy ? <Spinner className="border-on-amber/25 border-t-on-amber" /> : null}
            Sign in
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" disabled={busy} onClick={() => void sendCode()}>
              Send a new code
            </button>
            <button
              type="button"
              className="btn btn-ghost flex-1"
              disabled={busy}
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              Change email
            </button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          {googleId && (
            <>
              <button type="button" className="btn btn-primary w-full" onClick={() => location.assign(googleSignInUrl(googleId))}>
                <GoogleMark />
                Continue with Google
              </button>
              <p className="pt-1 text-center text-[12.5px] text-ink-muted">or get a code by email</p>
            </>
          )}
          <input
            className="field text-[16px]"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Email"
          />
          {error && <p className="text-[13px] text-pin">{error}</p>}
          <button type="submit" className={cn("btn w-full", googleId ? "btn-ghost" : "btn-primary")} disabled={busy || !email.trim()}>
            {busy ? <Spinner className={googleId ? undefined : "border-on-amber/25 border-t-on-amber"} /> : null}
            Send code
          </button>
        </form>
      )}
    </div>
  );
}

/** The Google "G", in one color so it sits on the button in every display mode. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.7-5.5 3.7-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.800 3.100 14.600 2.100 12 2.100 6.500 2.100 2.100 6.500 2.100 12s4.400 9.900 9.900 9.900c5.700 0 9.500-4 9.500-9.700 0-.7-.1-1.200-.2-1.700H12z" />
    </svg>
  );
}
