import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, EyeOff, LayoutGrid, Maximize2, Minimize2, Moon, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { linkRepo } from "@/data/repo";
import { ConfirmSheet, Sheet, SheetRow, SW } from "@/components/at/ui";
import { cn } from "@/lib/utils";
import { KIND_ICON } from "./CardNode";
import { cardTitle, KIND_LABEL, type BoardCard, type BoardString } from "./model";

const READ_ONLY = "This case is read only.";

/** Two record names joined by a short pinned string. */
function Ends({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-ink-muted">{a}</span>
      <span className="relative h-px w-10 shrink-0 bg-string" aria-hidden>
        <span className="absolute -top-[2px] -left-[2.5px] size-[5px] rounded-full bg-pin" />
        <span className="absolute -top-[2px] -right-[2.5px] size-[5px] rounded-full bg-pin" />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">{b}</span>
    </div>
  );
}

export function BoardMenuSheet({
  open,
  onClose,
  editable,
  hiddenCount,
  night,
  full,
  onAdd,
  onArrange,
  onNight,
  onFull,
}: {
  open: boolean;
  onClose: () => void;
  editable: boolean;
  hiddenCount: number;
  night: boolean;
  full: boolean;
  onAdd: () => void;
  onArrange: () => void;
  onNight: () => void;
  onFull: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Evidence board">
      <SheetRow
        icon={<Plus size={20} strokeWidth={SW} />}
        label="Add to board"
        hint={!editable ? READ_ONLY : hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? "item" : "items"} off the board.` : "Every item is on the board."}
        disabled={!editable || hiddenCount === 0}
        onClick={onAdd}
      />
      <SheetRow
        icon={<LayoutGrid size={20} strokeWidth={SW} />}
        label="Auto arrange"
        hint={editable ? "Lay out every card again and save the layout." : READ_ONLY}
        disabled={!editable}
        onClick={onArrange}
      />
      <SheetRow icon={<Moon size={20} strokeWidth={SW} />} label="Night vision" hint={night ? "On" : "Off"} onClick={onNight} />
      <SheetRow
        icon={full ? <Minimize2 size={20} strokeWidth={SW} /> : <Maximize2 size={20} strokeWidth={SW} />}
        label={full ? "Exit full canvas" : "Full canvas"}
        hint={full ? "Return to the case." : "The board alone, edge to edge."}
        onClick={onFull}
      />
    </Sheet>
  );
}

export function HiddenSheet({ open, onClose, cards, onRestore }: { open: boolean; onClose: () => void; cards: BoardCard[]; onRestore: (id: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add to board">
      {cards.length === 0 && <p className="px-5 pb-5 text-sm text-ink-muted">Every item is on the board.</p>}
      {cards.map((k) => {
        const Icon = KIND_ICON[k.kind];
        return <SheetRow key={k.id} icon={<Icon size={20} strokeWidth={SW} />} label={cardTitle(k)} hint={KIND_LABEL[k.kind]} onClick={() => onRestore(k.id)} />;
      })}
    </Sheet>
  );
}

export function CardMenuSheet({ card, onClose, editable, onOpen, onHide }: { card: BoardCard | null; onClose: () => void; editable: boolean; onOpen: () => void; onHide: () => void }) {
  return (
    <Sheet open={!!card} onClose={onClose} title={card ? KIND_LABEL[card.kind] : undefined}>
      {card && (
        <>
          <p className={cn("px-5 pb-4 text-ink", card.kind === "subject" ? "font-serif text-[24px] leading-tight" : card.kind === "photo" ? "font-mono text-[15px]" : "text-[16px] leading-snug")}>
            {cardTitle(card)}
          </p>
          <SheetRow icon={<ArrowUpRight size={20} strokeWidth={SW} />} label="Open" onClick={onOpen} />
          <SheetRow
            icon={<EyeOff size={20} strokeWidth={SW} />}
            label="Remove from board"
            hint={editable ? "The record stays in the case." : READ_ONLY}
            disabled={!editable}
            onClick={onHide}
          />
        </>
      )}
    </Sheet>
  );
}

/** A string's label, with Edit and Delete for Active cases. */
export function StringSheet({ string, nameOf, editable, onClose }: { string: BoardString | null; nameOf: (cardId: string) => string; editable: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const openId = string?.id ?? null;

  useEffect(() => {
    setEditing(null);
  }, [openId]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await linkRepo.update(editing, draft);
      setEditing(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={!!string && !confirm} onClose={onClose} title="Connection">
        {string && (
          <div className="px-5 pb-3">
            <Ends a={nameOf(string.source)} b={nameOf(string.target)} />
            {string.links.map((l) => (
              <div key={l.id} className="mt-5 border-t border-line pt-4">
                <div className="mono-label mb-2 text-ink-muted">Label</div>
                {editing === l.id ? (
                  <form onSubmit={save} className="space-y-3">
                    <input
                      autoFocus
                      aria-label="Label"
                      className="field"
                      placeholder="No label"
                      value={draft}
                      maxLength={120}
                      autoComplete="off"
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="flex gap-3">
                      <button type="button" className="btn btn-ghost flex-1" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className={cn("leading-snug", l.label ? "text-[18px] text-ink" : "text-[15px] text-ink-faint")}>{l.label || "No label"}</p>
                )}
                {editable && editing !== l.id && (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      className="btn btn-ghost flex-1"
                      onClick={() => {
                        setEditing(l.id);
                        setDraft(l.label);
                      }}
                    >
                      <Pencil size={16} strokeWidth={SW} /> Edit
                    </button>
                    <button type="button" className="btn btn-danger flex-1" onClick={() => setConfirm(l.id)}>
                      <Trash2 size={16} strokeWidth={SW} /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!editable && <p className="mt-5 font-mono text-[11px] tracking-[0.12em] text-ink-faint uppercase">Read only</p>}
          </div>
        )}
      </Sheet>
      <ConfirmSheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete connection"
        body="The string between these two items is removed. Both items stay in the case."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await linkRepo.remove(confirm);
          } catch (err) {
            toast.error((err as Error).message);
          }
          onClose();
        }}
      />
    </>
  );
}

/** Names a new string after a long-press link. The label may stay empty. */
export function NewLinkSheet({ pending, nameOf, onClose, onSave }: { pending: { from: string; to: string } | null; nameOf: (cardId: string) => string; onClose: () => void; onSave: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const key = pending ? `${pending.from}|${pending.to}` : "";
  useEffect(() => {
    setLabel("");
  }, [key]);
  return (
    <Sheet open={!!pending} onClose={onClose} title="New connection">
      {pending && (
        <form
          className="space-y-5 px-5 pb-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSave(label);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Ends a={nameOf(pending.from)} b={nameOf(pending.to)} />
          <div>
            <label htmlFor="board-new-label" className="mono-label mb-2 block text-ink-muted">
              Label
            </label>
            <input
              id="board-new-label"
              autoFocus
              className="field"
              placeholder="Optional"
              value={label}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
