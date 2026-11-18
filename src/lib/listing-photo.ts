export const MAX_LISTING_PHOTO_BYTES = 3 * 1024 * 1024;

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function listingPhotoMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function prepareListingPhoto(
  file: File,
  minDimension: number,
  maxBytes: number,
): Promise<{ file: File; width: number; height: number }> {
  const limit = Math.min(maxBytes, MAX_LISTING_PHOTO_BYTES);
  if (file.size > limit) throw new Error(`Use a photo no larger than ${Math.floor(limit / 1048576)} MB.`);
  const mimeType = listingPhotoMimeType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mimeType || (file.type && file.type !== mimeType) || !MIME_TYPES.has(mimeType)) {
    throw new Error('Choose JPEG, PNG, or WebP.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This file is not a readable image. Choose a valid JPEG, PNG, or WebP photo.');
  }

  try {
    const { width, height } = bitmap;
    if (width < minDimension || height < minDimension) {
      throw new Error(`This photo is too small (${width} x ${height} pixels). Choose a larger original photo, at least ${minDimension} x ${minDimension} pixels, then upload it again.`);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this photo. Try a different image.');
    context.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
    if (!blob || blob.type !== mimeType) throw new Error('Could not prepare this photo. Try a different image.');
    if (blob.size > limit) throw new Error(`The prepared photo is larger than ${Math.floor(limit / 1048576)} MB. Choose a smaller image.`);

    return {
      file: new File([blob], file.name, { type: mimeType, lastModified: file.lastModified }),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
