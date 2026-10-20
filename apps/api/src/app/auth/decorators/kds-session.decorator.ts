import { SetMetadata } from '@nestjs/common';

export const KDS_SESSION_KEY = 'kdsSession';

/** Where a route takes the store it acts on from, so the guard can hold a PIN session to its own stores. */
export type KdsSessionStoreSource =
  | { from: 'query'; key: string }
  | { from: 'param'; key: string }
  | { from: 'body'; key: string }
  /** The route acts on no single store, or narrows its result to the session's stores itself. */
  | { from: 'none' };

/**
 * Lets a kitchen PIN session (one that carries `kdsBrandId`) reach this
 * route or controller. Every other route answers such a session 403
 * `KDS_SESSION_LIMITED` — see KdsSessionGuard. `store` names where the
 * route reads its store id from; a store outside the session's
 * `kdsStoreIds` is refused with 403 `KDS_SESSION_STORE`.
 */
export const KdsSessionAllowed = (store: KdsSessionStoreSource = { from: 'none' }): ReturnType<typeof SetMetadata> =>
  SetMetadata(KDS_SESSION_KEY, store);
