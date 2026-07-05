import { useEffect, useState } from "react";
import { api } from "../api";

/** Load a project asset as a data URI (offline image display). */
export function useAsset(projectPath: string | null, name: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!projectPath || !name) {
      setSrc(null);
      return;
    }
    api
      .readAssetBase64(projectPath, name)
      .then((b64) => {
        if (cancelled) return;
        const ext = name.split(".").pop()?.toLowerCase() ?? "png";
        const mime = ext === "jpg" ? "jpeg" : ext;
        setSrc(`data:image/${mime};base64,${b64}`);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [projectPath, name]);
  return src;
}

/** Convert any imported image asset to a JPEG asset (for PDF embedding). */
export async function convertAssetToJpeg(projectPath: string, assetName: string): Promise<string> {
  if (/\.jpe?g$/i.test(assetName)) return assetName;
  const b64 = await api.readAssetBase64(projectPath, assetName);
  const ext = assetName.split(".").pop()?.toLowerCase() ?? "png";
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = `data:image/${ext};base64,${b64}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // White background: JPEG has no alpha.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  const jpegB64 = dataUrl.split(",")[1];
  const jpegName = assetName.replace(/\.[^.]+$/, "") + ".jpg";
  return api.saveAssetBase64(projectPath, jpegName, jpegB64);
}
