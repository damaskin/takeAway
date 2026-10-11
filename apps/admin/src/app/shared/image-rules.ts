import type { TranslateService } from '@ngx-translate/core';
import { type ImageUploadRule, imageMaxMegabytes, imageUploadProblem } from '@takeaway/shared-types';

import { apiErrorBody } from '../core/http/api-error';

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** The `accept` of a file input for the rule. */
export function acceptFor(rule: ImageUploadRule): string {
  return rule.types.join(',');
}

/** Parameters for the rule's hint and error texts. */
export function ruleParams(rule: ImageUploadRule): Record<string, string | number> {
  return { maxMb: imageMaxMegabytes(rule), width: rule.width, height: rule.height, aspect: rule.aspect };
}

/**
 * Why the picked file will not be accepted, in the admin's language, or
 * null when it fits. Some systems hand over a file without a type; its
 * extension decides then (the API reads the bytes anyway).
 */
export function imageFileError(
  file: { name: string; size: number; type: string },
  rule: ImageUploadRule,
  translate: TranslateService,
): string | null {
  const type = file.type || EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  const problem = imageUploadProblem({ size: file.size, type }, rule);
  if (problem === 'type') return translate.instant('admin.images.errors.type');
  if (problem === 'size') {
    const size = (file.size / (1024 * 1024)).toFixed(1);
    return translate.instant('admin.images.errors.size', { ...ruleParams(rule), size });
  }
  return null;
}

/** The API refused the picture itself (too big, wrong format): the text to show, or null for any other failure. */
export function imageUploadRefusal(err: unknown, rule: ImageUploadRule, translate: TranslateService): string | null {
  const body = apiErrorBody(err);
  const status = (err as { status?: unknown } | null)?.status;
  if (body?.code === 'IMAGE_TOO_LARGE' || status === 413) {
    return translate.instant('admin.images.errors.tooLarge', ruleParams(rule));
  }
  if (body?.code === 'IMAGE_TYPE' || status === 415) return translate.instant('admin.images.errors.type');
  return null;
}
