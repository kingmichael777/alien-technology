import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { looksLikeEmail } from "@/lib/account";
import { api, type AccountRow } from "@/lib/api";
import { when } from "@/lib/format";
import { ConfirmSheet, Sheet, SheetRow, Spinner, SW } from "./ui";

/** 4 min / 2 hr 10 min */
function recorded(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** The master's list of accounts: add, pause, turn back on, remove. */
export function AccountsPanel() {
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AccountRow | null>(null);
  const [removing, setRemoving] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    try {
      const { accounts } = await api.accounts();
      setRows(accounts);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't load the accounts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const to = email.trim().toLowerCase();
    if (!looksLikeEmail(to)) return setAddError("That doesn't look like an email address.");
    setAdding(true);
    setAddError(null);
    try {
      const { emailed } = await api.accountAdd(to);
      setEmail("");
      toast(emailed ? `Added. An invitation was sent to ${to}.` : `Added, but the invitation email didn't send. Tell them to sign in at alientek.org.`);
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't add that account.");
    } finally {
      setAdding(false);
    }
  };

  const change = async (row: AccountRow, status: "active" | "paused") => {
    try {
      await api.accountUpdate(row.id, status);
      toast(status === "paused" ? `${row.email} is paused.` : `${row.email} is back on.`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work. Try again.");
    }
  };

  return (
    <>
      <div className="card-at p-4">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          Only the emails listed here can sign in. Each person sees only their own recordings. Their transcripts and notes are paid from
          your accounts.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            className="field text-[16px]"
            type="email"
            placeholder="Email to add"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setAddError(null);
            }}
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Email to add"
          />
          {addError && <p className="text-[13px] text-pin">{addError}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={adding || !email.trim()}>
            {adding ? <Spinner className="border-on-amber/25 border-t-on-amber" /> : <UserPlus size={18} strokeWidth={SW} />}
            Add account
          </button>
        </form>
      </div>

      {problem && <p className="mt-3 px-1 text-[13.5px] text-pin">{problem}</p>}

      {rows && (
        <ul className="mt-3 space-y-2">
          {rows.map((a) => {
            const master = a.role === "master";
            const body = (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{a.email}</span>
                  <span className={a.status === "paused" ? "shrink-0 text-[12.5px] text-pin" : "shrink-0 text-[12.5px] text-ink-muted"}>
                    {master ? "Master" : a.status === "paused" ? "Paused" : "Active"}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-muted">
                  {a.recordings} {a.recordings === 1 ? "recording" : "recordings"} · {recorded(a.duration_ms)}
                  {" · "}
                  {a.last_seen_at ? `Last used ${when(Date.parse(a.last_seen_at))}` : "Hasn't signed in yet"}
                </p>
              </>
            );
            return (
              <li key={a.id}>
                {master ? (
                  <div className="card-at px-4 py-3">{body}</div>
                ) : (
                  <button type="button" className="card-at block w-full px-4 py-3 text-left active:bg-surface-raised" onClick={() => setPicked(a)}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked?.email}>
        {picked && (
          <div className="pb-3">
            {picked.status === "active" ? (
              <SheetRow
                label="Pause this account"
                hint="They can't upload or open recordings until you turn it back on. Nothing is deleted."
                onClick={() => {
                  setPicked(null);
                  void change(picked, "paused");
                }}
              />
            ) : (
              <SheetRow
                label="Turn this account back on"
                onClick={() => {
                  setPicked(null);
                  void change(picked, "active");
                }}
              />
            )}
            <SheetRow
              danger
              label="Remove this account"
              hint="Deletes the account and everything it recorded."
              onClick={() => {
                setRemoving(picked);
                setPicked(null);
              }}
            />
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.email ?? "this account"}?`}
        body={`The account and its ${removing?.recordings ?? 0} ${removing?.recordings === 1 ? "recording" : "recordings"} are deleted from the server, with the audio, transcripts and notes. This can't be undone.`}
        confirmLabel="Remove account"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api.accountRemove(removing.id);
            toast(`${removing.email} was removed.`);
          } catch (e) {
            toast(e instanceof Error ? e.message : "That didn't work. Try again.");
          }
          await load();
        }}
      />
    </>
  );
}
