// Getting notes and audio out of the app: the phone's share sheet when it has
// one, otherwise copy or download.

export type ShareResult = "shared" | "copied" | "downloaded" | "cancelled";

export async function shareTextOut(title: string, text: string): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  if (await copyText(text)) return "copied";
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${title}.txt`);
  return "downloaded";
}

export async function shareFileOut(file: File): Promise<ShareResult> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(file, file.name);
  return "downloaded";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies text that is still on its way from the server. iPhones only allow a
 * copy that starts with the tap itself, so the clipboard is handed the promise
 * right away and fills in when the text arrives.
 */
export async function copyWhenReady(text: Promise<string>): Promise<boolean> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Older browsers want the text itself: try that below.
    }
  }
  try {
    return await copyText(await text);
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
