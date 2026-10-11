import { SetMetadata, applyDecorators } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const OPTIONAL_AUTH_KEY = 'optionalAuth';

export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Public, but signed-in callers are recognised: a request without a bearer
 * token goes through anonymously (`request.user` undefined), one with a
 * token is authenticated as usual — and refused with 401 when the token is
 * bad, so a client with an expired session refreshes it instead of silently
 * writing as a stranger.
 */
export const OptionalAuth = (): ReturnType<typeof applyDecorators> =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), SetMetadata(OPTIONAL_AUTH_KEY, true));
