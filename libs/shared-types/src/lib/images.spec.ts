import { BRAND_LOGO_RULE, STORE_PHOTO_RULE, imageMaxMegabytes, imageUploadProblem } from './images';

describe('image upload rules', () => {
  it('takes a JPEG, PNG or WebP store photo up to 5 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(imageUploadProblem({ type, size: 5 * 1024 * 1024 }, STORE_PHOTO_RULE)).toBeNull();
    }
    expect(imageUploadProblem({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }, STORE_PHOTO_RULE)).toBe('size');
  });

  it('refuses formats the apps cannot draw, whatever the size', () => {
    expect(imageUploadProblem({ type: 'image/avif', size: 10 }, STORE_PHOTO_RULE)).toBe('type');
    expect(imageUploadProblem({ type: 'image/svg+xml', size: 10 }, BRAND_LOGO_RULE)).toBe('type');
    expect(imageUploadProblem({ type: 'application/pdf', size: 9 * 1024 * 1024 }, BRAND_LOGO_RULE)).toBe('type');
    expect(imageUploadProblem({ type: '', size: 10 }, BRAND_LOGO_RULE)).toBe('type');
  });

  it('keeps logos smaller and square', () => {
    expect(imageUploadProblem({ type: 'image/png', size: 2 * 1024 * 1024 + 1 }, BRAND_LOGO_RULE)).toBe('size');
    expect(imageMaxMegabytes(BRAND_LOGO_RULE)).toBe(2);
    expect(imageMaxMegabytes(STORE_PHOTO_RULE)).toBe(5);
    expect(BRAND_LOGO_RULE.width).toBe(BRAND_LOGO_RULE.height);
    expect(STORE_PHOTO_RULE.width / STORE_PHOTO_RULE.height).toBeCloseTo(3 / 2);
  });
});
