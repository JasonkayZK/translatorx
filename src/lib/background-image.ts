import { t as tr } from "./i18n";

export const BACKGROUND_PREFIX = "data:image/png;base64,";
export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 32_000_000;
const MAX_SIDE = 2560;
const fail = (key: string): never => { throw new Error(tr(`errors.${key}`)); };

/** Header-only preflight, before asking the browser to allocate decoded pixels.
 * This is not a replacement for decoding: native storage also validates the PNG. */
export function inspectImage(bytes: Uint8Array): { width: number; height: number; mime: string } {
  if (bytes.length > MAX_INPUT_BYTES) fail("backgroundSize");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
  const checked = (width: number, height: number, mime: string) => {
    if (!width || !height || width * height > MAX_PIXELS) fail("backgroundDimensions");
    return { width, height, mime };
  };
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) {
    if (view.getUint32(8) !== 13 || text(12, 4) !== "IHDR") fail("backgroundDecode");
    const result = checked(view.getUint32(16), view.getUint32(20), "image/png");
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at);
      if (size > bytes.length - at - 12) fail("backgroundDecode");
      const kind = text(at + 4, 4);
      if (kind === "acTL") fail("backgroundAnimation");
      if (kind === "IEND") return result;
      at += size + 12;
    }
    return fail("backgroundDecode");
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 3 < bytes.length) {
      if (bytes[at++] !== 255) fail("backgroundDecode");
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218 || at + 2 > bytes.length) break;
      const size = view.getUint16(at);
      if (size < 2 || at + size > bytes.length) fail("backgroundDecode");
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (size < 8) fail("backgroundDecode");
        return checked(view.getUint16(at + 5), view.getUint16(at + 3), "image/jpeg");
      }
      at += size;
    }
    return fail("backgroundDecode");
  }
  if (bytes.length >= 20 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) fail("backgroundDecode");
    let dimensions: { width: number; height: number; mime: string } | undefined;
    const setDimensions = (width: number, height: number) => {
      const next = checked(width, height, "image/webp");
      if (dimensions && (dimensions.width !== width || dimensions.height !== height)) fail("backgroundDecode");
      dimensions = next;
    };
    for (let at = 12; at + 8 <= bytes.length;) {
      const kind = text(at, 4), size = view.getUint32(at + 4, true), start = at + 8;
      if (size > bytes.length - start) fail("backgroundDecode");
      if (kind === "ANIM" || kind === "ANMF") fail("backgroundAnimation");
      if (kind === "VP8X" && size >= 10) {
        if (bytes[start] & 2) fail("backgroundAnimation");
        const u24 = (p: number) => bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16;
        setDimensions(u24(start + 4) + 1, u24(start + 7) + 1);
      } else if (kind === "VP8L" && size >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        setDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      } else if (kind === "VP8 " && size >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
        setDimensions(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
      }
      at = start + size + (size % 2);
    }
    if (dimensions) return dimensions;
    return fail("backgroundDecode");
  }
  return fail("backgroundType");
}

function dataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(tr("errors.backgroundDecode")));
    reader.readAsDataURL(blob);
  });
}

export async function normalizeBackgroundImage(file: File): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) fail("backgroundSize");
  const buffer = await file.arrayBuffer();
  const info = inspectImage(new Uint8Array(buffer));
  const url = URL.createObjectURL(new Blob([buffer], { type: info.mime }));
  const canvas = document.createElement("canvas");
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { fail("backgroundDecode"); }
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > MAX_PIXELS) fail("backgroundDimensions");
    let scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const context = canvas.getContext("2d");
    if (!context) return fail("backgroundDecode");
    for (let attempt = 0; attempt < 10; attempt++) {
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return fail("backgroundDecode");
      if (blob.size <= MAX_BACKGROUND_BYTES) return await dataURL(blob);
      // PNG ignores a quality argument, so reduce dimensions instead.
      scale *= .8;
    }
    return fail("backgroundSize");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

/** Browser mock equivalent of native validation, without trusting an IPC MIME label. */
export async function validateBackgroundData(data: string): Promise<void> {
  if (!data.startsWith(BACKGROUND_PREFIX)) fail("backgroundType");
  const encoded = data.slice(BACKGROUND_PREFIX.length);
  if (encoded.length > Math.ceil(MAX_BACKGROUND_BYTES / 3) * 4) fail("backgroundSize");
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail("backgroundDecode");
  let bytes: Uint8Array;
  try {
    const decoded = atob(encoded);
    if (btoa(decoded) !== encoded) return fail("backgroundDecode");
    bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
  } catch { return fail("backgroundDecode"); }
  if (bytes.length > MAX_BACKGROUND_BYTES) fail("backgroundSize");
  const info = inspectImage(bytes);
  if (info.mime !== "image/png") fail("backgroundType");
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) fail("backgroundDimensions");
  const image = new Image();
  image.src = data;
  try { await image.decode(); } catch { fail("backgroundDecode"); }
}
