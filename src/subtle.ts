import { getSubtle } from 'unsea';

/**
 * SubtleCrypto for every hash, key and AES-GCM call here: WebCrypto's own, or, on a page that has none
 * (browsers give crypto.subtle only to https and localhost pages, so not to a dev server reached by its
 * LAN IP), unsea's stand-in on noble, which gives the same bytes.
 */
export const subtle = (): SubtleCrypto => getSubtle();
