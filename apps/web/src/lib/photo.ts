"use client";
import { PHOTO_TARGET_BYTES, QUALITY_STEPS, fitWithin } from "@/lib/community";

const MAX_EDGE = 1280;

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode photo"))), "image/jpeg", quality),
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("could not read photo"));
    r.readAsDataURL(blob);
  });
}

/** Shrinks a phone photo before it is stored or sent. Drawing it onto a canvas and re-encoding it
 *  drops all EXIF data (camera, time, GPS); the rotation is applied first so it still looks right.
 *  The server strips metadata again and the database refuses any file that still has it. */
export async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("photo processing is not available in this browser");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let blob = await toBlob(canvas, QUALITY_STEPS[0]);
  for (const q of QUALITY_STEPS.slice(1)) {
    if (blob.size <= PHOTO_TARGET_BYTES) break;
    blob = await toBlob(canvas, q);
  }
  return blobToBase64(blob);
}
