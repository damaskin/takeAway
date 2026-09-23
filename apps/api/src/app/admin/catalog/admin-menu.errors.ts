import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Stable codes on the menu editor's domain errors. The admin translates the
 * code, not the English sentence, so the wording here can change without
 * breaking the screen that explains the problem to a café owner.
 */
export type MenuErrorCode =
  | 'SLUG_TAKEN'
  | 'CATEGORY_NOT_EMPTY'
  | 'CATEGORY_MOVE_TARGET'
  | 'MIXED_CATEGORIES'
  | 'MODIFIER_RANGE'
  | 'TOO_MANY_IMAGES'
  | 'IMAGE_NOT_ON_PRODUCT'
  | 'IMAGES_CHANGED';

export function menuConflict(
  code: MenuErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', code, message, ...extra });
}

export function menuBadRequest(code: MenuErrorCode, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });
}

export function menuNotFound(code: MenuErrorCode, message: string): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', code, message });
}

/** Prisma's error code — `P2002` unique, `P2003` foreign key, `P2025` missing row — or null. */
export function prismaCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * A unique violation on a menu row is the slug (the external-POS keys are
 * never written from the admin). Without this it surfaced as a bare 500.
 */
export function rethrowSlugTaken(err: unknown, slug: string | undefined): never {
  if (prismaCode(err) === 'P2002') {
    throw menuConflict(
      'SLUG_TAKEN',
      slug ? `The address "${slug}" is already taken` : 'This address is already taken',
      slug ? { slug } : {},
    );
  }
  throw err;
}
