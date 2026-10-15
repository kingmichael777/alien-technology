import exifr from "exifr";

/** 480px JPEG preview. The original file is never touched. */
export async function makeThumb(file: Blob, max = 480): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.8));
  } catch {
    return null;
  }
}

export interface ExifSummary {
  exif: Record<string, string>;
  gps: { lat: number; lng: number } | null;
  capturedAt: number | null;
}

export async function readExif(file: Blob): Promise<ExifSummary> {
  try {
    const t = await exifr.parse(file, { gps: true, tiff: true, exif: true });
    if (!t) return { exif: {}, gps: null, capturedAt: null };
    const exif: Record<string, string> = {};
    const camera = [t.Make, t.Model].filter(Boolean).join(" ").trim();
    if (camera) exif["Camera"] = camera;
    if (t.LensModel) exif["Lens"] = String(t.LensModel);
    if (t.ExposureTime) exif["Exposure"] = t.ExposureTime < 1 ? `1/${Math.round(1 / t.ExposureTime)} s` : `${t.ExposureTime} s`;
    if (t.FNumber) exif["Aperture"] = `f/${t.FNumber}`;
    if (t.ISO) exif["ISO"] = String(t.ISO);
    if (t.FocalLength) exif["Focal length"] = `${t.FocalLength} mm`;
    if (t.ExifImageWidth && t.ExifImageHeight) exif["Dimensions"] = `${t.ExifImageWidth} x ${t.ExifImageHeight}`;
    const gps = typeof t.latitude === "number" && typeof t.longitude === "number" ? { lat: t.latitude, lng: t.longitude } : null;
    const d = t.DateTimeOriginal ?? t.CreateDate;
    return { exif, gps, capturedAt: d instanceof Date ? d.getTime() : null };
  } catch {
    return { exif: {}, gps: null, capturedAt: null };
  }
}
