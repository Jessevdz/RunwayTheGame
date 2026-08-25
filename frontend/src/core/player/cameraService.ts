/** Utilities for photo upload processing and image rescaling. */

/** Encapsulates a captured photo frame blob and its encoded dimensions. */
export interface CapturedFrame {
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}

/** Maximum image dimension (px) allowed on the longest edge. */
const MAX_CAPTURE_EDGE = 1600;

const CAPTURE_QUALITY = 0.85;

/** Loads a file into an HTMLImageElement for dimension inspection and canvas drawing. */
const decode = (objectUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be opened as a photo.'));
    img.src = objectUrl;
  });

const encodeJpeg = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be encoded.'))),
      'image/jpeg',
      CAPTURE_QUALITY
    );
  });

/** Normalizes and rescales a captured file blob into a JPEG frame for upload. */
export const frameFromFile = async (file: File): Promise<CapturedFrame> => {
  const sourceUrl = URL.createObjectURL(file);

  let image: HTMLImageElement;
  try {
    image = await decode(sourceUrl);
  } catch (err) {
    URL.revokeObjectURL(sourceUrl);
    throw err;
  }

  const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const capturedAt = new Date().toISOString();

  if (file.type === 'image/jpeg' && longEdge <= MAX_CAPTURE_EDGE) {
    return {
      blob: file,
      objectUrl: sourceUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
      capturedAt
    };
  }

  const shrink = Math.min(1, MAX_CAPTURE_EDGE / longEdge);
  const width = Math.max(1, Math.round(image.naturalWidth * shrink));
  const height = Math.max(1, Math.round(image.naturalHeight * shrink));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { blob: file, objectUrl: sourceUrl, width: image.naturalWidth, height: image.naturalHeight, capturedAt };
  }
  ctx.drawImage(image, 0, 0, width, height);

  let blob: Blob;
  try {
    blob = await encodeJpeg(canvas);
  } catch (err) {
    URL.revokeObjectURL(sourceUrl);
    throw err;
  }

  URL.revokeObjectURL(sourceUrl);
  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    width,
    height,
    capturedAt
  };
};
