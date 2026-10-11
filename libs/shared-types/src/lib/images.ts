/**
 * What an uploaded picture may be, per kind of picture. The API enforces
 * `maxBytes` and `types`; the admin checks the same rule before uploading
 * and prints it as the hint next to the button. The size and aspect are a
 * recommendation, not a check: they are what the customer apps crop to.
 */

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

export interface ImageUploadRule {
  maxBytes: number;
  types: readonly ImageMimeType[];
  /** Recommended size in pixels. */
  width: number;
  height: number;
  /** The same as `width`:`height`, for the hint. */
  aspect: string;
}

/**
 * Raster formats every client draws. AVIF stays out of the rules below: the
 * Flutter app cannot decode it, and a store photo it cannot show is a grey
 * box on the stores map.
 */
const WIDELY_SUPPORTED: readonly ImageMimeType[] = ['image/jpeg', 'image/png', 'image/webp'];

/** A store's cover and gallery photos — the picture on the store card. */
export const STORE_PHOTO_RULE: ImageUploadRule = {
  maxBytes: 5 * 1024 * 1024,
  types: WIDELY_SUPPORTED,
  width: 1200,
  height: 800,
  aspect: '3:2',
};

/** A brand's logo. Shown fitted into a square tile, so square works best. */
export const BRAND_LOGO_RULE: ImageUploadRule = {
  maxBytes: 2 * 1024 * 1024,
  types: WIDELY_SUPPORTED,
  width: 512,
  height: 512,
  aspect: '1:1',
};

export type ImageUploadProblem = 'type' | 'size';

/**
 * Why a file breaks the rule, or null when it fits. Type first: a 9 MB PDF
 * is wrong because it is a PDF.
 */
export function imageUploadProblem(
  file: { size: number; type: string },
  rule: ImageUploadRule,
): ImageUploadProblem | null {
  if (!(rule.types as readonly string[]).includes(file.type)) return 'type';
  if (file.size > rule.maxBytes) return 'size';
  return null;
}

/** `maxBytes` in whole megabytes, for messages: 5242880 → 5. */
export function imageMaxMegabytes(rule: ImageUploadRule): number {
  return Math.floor(rule.maxBytes / (1024 * 1024));
}
