import { createContext, memo, useContext, useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, AudioWaveform, Clock, FileText, Image as ImageIcon, MapPin, MoreHorizontal, UserRound } from "lucide-react";
import { useBlobUrl } from "@/data/hooks";
import { noteHeadline } from "@/data/rules";
import { Silhouette, SW, ThreatDot } from "@/components/at/ui";
import { clock, compact, compactDate, coords, duration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CARD_W, cardTitle, excerpt, KIND_LABEL, type BoardCard, type CardKind } from "./model";

/** Visual state of a card during a gesture. */
export type Cue = "source" | "target" | "drag" | null;
export type CardData = { card: BoardCard; cue: Cue };
export type CardNodeT = Node<CardData, "card">;

/** Card actions provided by the board. */
export const BoardActions = createContext<{ openMenu: (id: string) => void }>({ openMenu: () => {} });

export const KIND_ICON: Record<CardKind, typeof FileText> = {
  photo: ImageIcon,
  location: MapPin,
  text: FileText,
  voice: AudioWaveform,
  subject: UserRound,
};

const cueClass: Record<Exclude<Cue, null>, string> = {
  source: "scale-[1.035] border-string shadow-[0_0_0_1px_var(--string),0_10px_30px_rgba(0,0,0,0.45)]",
  target: "border-pin shadow-[0_0_0_1px_var(--pin)]",
  drag: "border-line-strong shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
};

export const CardNode = memo(function CardNode({ data }: NodeProps<CardNodeT>) {
  const { card, cue } = data;
  const { openMenu } = useContext(BoardActions);
  const Icon = KIND_ICON[card.kind];
  return (
    <div
      role="group"
      aria-label={`${KIND_LABEL[card.kind]}: ${cardTitle(card)}`}
      className={cn("board-card rounded-[13px] border bg-surface", cue ? cueClass[cue] : "border-line")}
      style={{ width: CARD_W }}
    >
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <Handle type="target" position={Position.Bottom} isConnectable={false} />
      <div className="flex h-10 items-center gap-2 pl-3">
        <Icon size={15} strokeWidth={SW} className="shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium tracking-[0.14em] text-ink-muted uppercase">{KIND_LABEL[card.kind]}</span>
        {card.note?.flagged && <AlertTriangle size={13} strokeWidth={SW} className="shrink-0 text-amber" aria-label="Flagged" />}
        <button
          type="button"
          aria-label="Card options"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors active:text-amber"
          onClick={() => openMenu(card.id)}
        >
          <MoreHorizontal size={18} strokeWidth={SW} />
        </button>
      </div>
      {card.kind === "photo" && <PhotoBody card={card} />}
      {card.kind === "location" && <LocationBody card={card} />}
      {card.kind === "text" && <TextBody card={card} />}
      {card.kind === "voice" && <VoiceBody card={card} />}
      {card.kind === "subject" && <SubjectBody card={card} />}
    </div>
  );
});

function Stamp({ children, rule }: { children: React.ReactNode; rule?: boolean }) {
  return (
    <div className={cn("flex items-center gap-1.5 font-mono text-[11px] text-ink-muted", rule && "mt-3 border-t border-line pt-2.5")}>
      <Clock size={13} strokeWidth={SW} className="shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

function PhotoBody({ card }: { card: BoardCard }) {
  const e = card.evidence;
  const url = useBlobUrl(e ? (e.thumbBlobId ?? e.blobId) : null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const ts = e?.capturedAt ?? card.note?.createdAt ?? 0;
  const name = e?.fileName ?? (card.note ? noteHeadline(card.note) : "Photo");
  return (
    <div className="px-3 pb-3">
      <div className="h-[132px] overflow-hidden rounded-[7px] border border-line bg-surface-raised">
        {url && !broken ? (
          <img src={url} alt="" draggable={false} className="photo size-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex size-full items-center justify-center text-ink-faint">
            <ImageIcon size={22} strokeWidth={SW} />
          </div>
        )}
      </div>
      <div className="mt-2.5 truncate font-mono text-[12px] text-ink/80">{name}</div>
      <div className="mt-1 font-mono text-[11px] text-ink-muted">
        {clock(ts)} · {compactDate(ts)}
      </div>
    </div>
  );
}

function PinMark() {
  return (
    <svg viewBox="0 0 24 32" className="h-[52px] w-[39px]" aria-hidden>
      <path d="M12 .75C5.79.75.75 5.7.75 11.85c0 8.1 9.6 17.9 10.7 19a.75.75 0 0 0 1.1 0c1.1-1.1 10.7-10.9 10.7-19C23.25 5.7 18.21.75 12 .75Z" fill="var(--amber)" />
      <circle cx="12" cy="11.6" r="4.4" fill="var(--surface)" />
    </svg>
  );
}

function LocationBody({ card }: { card: BoardCard }) {
  const n = card.note!;
  const loc = n.location;
  return (
    <div className="flex flex-col items-center px-3 pt-1 pb-3.5 text-center">
      <PinMark />
      <div className="mt-3 line-clamp-2 text-[14px] leading-snug font-medium tracking-[0.1em] text-amber uppercase">{n.title.trim() || "Location ping"}</div>
      <div className="mt-1.5 font-mono text-[11px] text-ink-muted">{loc ? coords(loc.lat, loc.lng) : "No coordinates"}</div>
      <div className="mt-2.5">
        <Stamp>
          {clock(n.createdAt)} · {compactDate(n.createdAt)}
        </Stamp>
      </div>
    </div>
  );
}

function TextBody({ card }: { card: BoardCard }) {
  const n = card.note!;
  const title = n.title.trim();
  const body = excerpt(n.body || n.transcript);
  return (
    <div className="px-3 pb-3">
      {title && <div className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{title}</div>}
      {body ? (
        <p className={cn("line-clamp-3", title ? "mt-1 text-[12.5px] leading-[1.45] text-ink-muted" : "text-[15px] leading-[1.45] text-ink/90")}>{body}</p>
      ) : (
        !title && <p className="text-[13px] text-ink-faint">Untitled note</p>
      )}
      <Stamp rule>{compact(n.createdAt)}</Stamp>
    </div>
  );
}

const WAVE = [5, 9, 6, 13, 8, 17, 11, 7, 14, 6, 10, 15, 8, 5, 11, 7];

function VoiceBody({ card }: { card: BoardCard }) {
  const n = card.note!;
  const title = n.title.trim();
  const words = excerpt(n.transcript || n.body);
  return (
    <div className="px-3 pb-3">
      {title && <div className="mb-2 line-clamp-2 text-[14px] leading-snug font-medium text-ink">{title}</div>}
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 64 20" className="h-5 w-16 text-amber" aria-hidden>
          {WAVE.map((v, i) => (
            <rect key={i} x={i * 4} y={10 - v / 2} width="1.6" height={v} rx="0.8" fill="currentColor" />
          ))}
        </svg>
        <span className="font-mono text-[12px] text-ink">{duration(n.durationMs)}</span>
      </div>
      <p className={cn("mt-2 line-clamp-3 text-[12.5px] leading-[1.45]", words ? "text-ink-muted" : "text-ink-faint")}>{words || "No transcript."}</p>
      <Stamp rule>{compact(n.createdAt)}</Stamp>
    </div>
  );
}

function SubjectBody({ card }: { card: BoardCard }) {
  const s = card.subject!;
  const url = useBlobUrl(s.photoBlobId);
  const alias = s.aliases.find((_, i) => !s.redacted.includes(`alias:${i}`));
  return (
    <div className="flex gap-3 px-3 pb-3">
      {url ? (
        <img src={url} alt="" draggable={false} className="photo h-[66px] w-[54px] shrink-0 rounded-[7px] border border-amber/40 object-cover" />
      ) : (
        <Silhouette className="h-[66px] w-[54px] shrink-0 rounded-[7px] border border-line-strong" />
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="line-clamp-2 font-serif text-[21px] leading-[1.05] font-semibold text-ink">{s.name}</div>
        {alias && <div className="mt-1 truncate font-mono text-[11px] text-ink-muted">{alias}</div>}
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">
          <ThreatDot level={s.threatLevel} className="size-2" />
          {s.threatLevel}
        </div>
      </div>
    </div>
  );
}
