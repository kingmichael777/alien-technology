import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useBlobUrl, useEvidence } from "@/data/hooks";
import { evidenceRepo } from "@/data/repo";
import { BackLink, MonoField, PageHeader, SW } from "@/components/at/ui";
import { bytes, compact, coords } from "@/lib/format";

export const Route = createFileRoute("/evidence/$eid")({
  head: () => ({
    meta: [
      { title: "Evidence detail · Alien Technology" },
      { name: "description", content: "Image, SHA-256 hash, EXIF summary and chain of custody for one item of evidence." },
      { property: "og:title", content: "Evidence detail · Alien Technology" },
      { property: "og:description", content: "Image, SHA-256 hash, EXIF summary and chain of custody." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EvidenceDetail,
});

function EvidenceDetail() {
  const { eid } = Route.useParams();
  const e = useEvidence(eid);
  const url = useBlobUrl(e?.blobId);
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [checking, setChecking] = useState(false);

  if (e === undefined) return null;
  if (e === null)
    return (
      <div className="px-6 py-24 text-center">
        <p className="font-serif text-2xl">This evidence is no longer on file.</p>
        <Link to="/" className="btn btn-outline mt-6">Return to the vault</Link>
      </div>
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e.sha256);
      toast.success("Hash copied.");
    } catch {
      toast.error("Clipboard is not available.");
    }
  };

  return (
    <div>
      <PageHeader back={<BackLink to="/case/$id" params={{ id: e.caseId }} search={{ tab: "evidence" }} label="Back to case" />} title={<div className="truncate font-mono text-[14px] text-ink">{e.fileName}</div>} />
      <div className="anim-fade">
        {e.kind === "photo" ? (
          url ? <img src={url} alt={e.fileName} className="photo w-full border-b border-line object-contain" /> : <div className="aspect-[4/3] bg-surface-raised" />
        ) : (
          url && <audio controls src={url} className="mx-5 mt-4 w-[calc(100%-2.5rem)]" />
        )}
        <div className="px-5 pt-4">
          <div className="section-label mb-1">Evidence</div>
          <MonoField label="File">{e.fileName} · {e.mimeType} · {bytes(e.size)}</MonoField>
          <MonoField label="SHA-256">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={e.sha256}>{e.sha256 ? `${e.sha256.slice(0, 16)}…${e.sha256.slice(-8)}` : "Not computed"}</span>
              {e.sha256 && (
                <button aria-label="Copy hash" onClick={copy} className="tap inline-flex items-center justify-center text-amber">
                  <Copy size={18} strokeWidth={SW} />
                </button>
              )}
            </div>
          </MonoField>
          <MonoField label="Camera">{e.exif["Camera"] ?? "Unknown"}</MonoField>
          <MonoField label="Captured">{compact(e.capturedAt)}</MonoField>
          <MonoField label="GPS">{e.gps ? coords(e.gps.lat, e.gps.lng) : "No position recorded"}</MonoField>
          {Object.entries(e.exif).filter(([k]) => k !== "Camera").length > 0 && (
            <MonoField label="EXIF">
              {Object.entries(e.exif).filter(([k]) => k !== "Camera").map(([k, v]) => (
                <div key={k}><span className="text-ink-muted">{k}</span> {v}</div>
              ))}
            </MonoField>
          )}

          <button
            className="btn btn-outline mt-5 w-full font-mono tracking-[0.12em]"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                setVerdict(await evidenceRepo.verify(e.id));
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? "HASHING" : "VERIFY INTEGRITY"}
          </button>
          {verdict !== null && (
            <div className={verdict ? "anim-fade mt-3 flex items-center justify-center gap-2 font-mono text-[13px] tracking-[0.14em] text-amber" : "anim-fade mt-3 flex items-center justify-center gap-2 font-mono text-[13px] tracking-[0.14em] text-pin"}>
              {verdict ? <ShieldCheck size={18} strokeWidth={SW} /> : <ShieldAlert size={18} strokeWidth={SW} />}
              {verdict ? "INTEGRITY VERIFIED" : "HASH MISMATCH"}
            </div>
          )}

          <div className="section-label mt-7 mb-3">Chain of custody</div>
          <ol className="relative space-y-4 border-l border-amber-line pl-5">
            {[...e.custody].reverse().map((c, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[23.5px] size-2 rounded-full border border-amber bg-bg" />
                <div className="font-mono text-[11px] text-ink-muted">{compact(c.at)}</div>
                <div className="font-mono text-[13px] uppercase tracking-[0.06em] text-amber">{c.action}</div>
                <div className="text-sm text-ink">{c.detail}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
