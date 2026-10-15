import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { CaptureFrame } from "@/components/at/CaptureFrame";
import { NoteEditor } from "@/components/at/notes";
import { useCaptureTarget } from "@/data/hooks";

export const Route = createFileRoute("/capture/text")({
  head: () => ({
    meta: [
      { title: "Text note · Alien Technology" },
      { name: "description", content: "Write a field note in Markdown and file it to a case." },
      { property: "og:title", content: "Text note · Alien Technology" },
      { property: "og:description", content: "Write a field note in Markdown and file it to a case." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TextCapture,
});

function TextCapture() {
  const { target } = useCaptureTarget();
  const navigate = useNavigate();
  const router = useRouter();
  return (
    <CaptureFrame label="Text note">
      <NoteEditor
        key={target?.id ?? "none"}
        caseId={target?.id ?? null}
        onSaved={(nid) => target && navigate({ to: "/case/$id/note/$nid", params: { id: target.id, nid }, replace: true })}
        onCancel={() => router.history.back()}
      />
    </CaptureFrame>
  );
}
