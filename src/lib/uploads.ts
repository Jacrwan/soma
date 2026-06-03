// Turn a user-picked file (image or PDF) into a model attachment, entirely in
// the browser — images are downscaled so the request stays well under the API
// body limit, PDFs are base64-encoded with a hard size cap. Nothing is stored.

export interface Attachment {
  kind: 'image' | 'pdf';
  mediaType: string;
  base64: string; // no data: prefix
  name: string;
}

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf';

// Anthropic reads images best at ≤1568px on the long edge; keep PDFs small
// enough that the base64 payload fits the serverless body limit (~4.5 MB).
const MAX_IMAGE_EDGE = 1568;
const IMAGE_QUALITY = 0.85;
const MAX_PDF_BYTES = 3 * 1024 * 1024;

export class UploadError extends Error {}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function imageToAttachment(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError("Couldn't process that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
  return { kind: 'image', mediaType: 'image/jpeg', base64: dataUrl.split(',')[1], name: file.name };
}

async function pdfToAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_PDF_BYTES) {
    throw new UploadError('That PDF is too large (max 3 MB). Try a shorter section or export fewer pages.');
  }
  const base64 = bufferToBase64(await file.arrayBuffer());
  return { kind: 'pdf', mediaType: 'application/pdf', base64, name: file.name };
}

export async function fileToAttachment(file: File): Promise<Attachment> {
  if (file.type === 'application/pdf') return pdfToAttachment(file);
  if (file.type.startsWith('image/')) return imageToAttachment(file);
  throw new UploadError('Unsupported file. Upload a photo (JPG/PNG/WebP) or a PDF.');
}
