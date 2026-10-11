import type { TranslateService } from '@ngx-translate/core';
import { BRAND_LOGO_RULE, STORE_PHOTO_RULE } from '@takeaway/shared-types';

import { acceptFor, imageFileError, imageUploadRefusal } from './image-rules';

/** Echoes the key and its parameters, so the assertions see what would be translated. */
const translate = {
  instant: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
} as unknown as TranslateService;

const MB = 1024 * 1024;

describe('image rules in the admin', () => {
  it('offers only the formats the rule takes', () => {
    expect(acceptFor(STORE_PHOTO_RULE)).toBe('image/jpeg,image/png,image/webp');
  });

  it('accepts a fitting file and names the limit of one that is too big', () => {
    expect(
      imageFileError({ name: 'cafe.jpg', type: 'image/jpeg', size: 3 * MB }, STORE_PHOTO_RULE, translate),
    ).toBeNull();
    expect(imageFileError({ name: 'logo.png', type: 'image/png', size: 3 * MB }, BRAND_LOGO_RULE, translate)).toBe(
      'admin.images.errors.size {"maxMb":2,"width":512,"height":512,"aspect":"1:1","size":"3.0"}',
    );
  });

  it('refuses other formats, and judges a file without a type by its extension', () => {
    expect(imageFileError({ name: 'logo.svg', type: 'image/svg+xml', size: 10 }, BRAND_LOGO_RULE, translate)).toBe(
      'admin.images.errors.type',
    );
    expect(imageFileError({ name: 'photo.WEBP', type: '', size: 10 }, STORE_PHOTO_RULE, translate)).toBeNull();
    expect(imageFileError({ name: 'photo.heic', type: '', size: 10 }, STORE_PHOTO_RULE, translate)).toBe(
      'admin.images.errors.type',
    );
  });

  it("words the API's refusals of the picture, and leaves other failures to the caller", () => {
    expect(
      imageUploadRefusal({ status: 413, error: { code: 'IMAGE_TOO_LARGE' } }, BRAND_LOGO_RULE, translate),
    ).toContain('admin.images.errors.tooLarge');
    expect(imageUploadRefusal({ status: 415, error: { code: 'IMAGE_TYPE' } }, BRAND_LOGO_RULE, translate)).toBe(
      'admin.images.errors.type',
    );
    expect(imageUploadRefusal({ status: 503, error: {} }, BRAND_LOGO_RULE, translate)).toBeNull();
  });
});
