// Preload (node --import): take crypto.subtle away, as a browser does on a plain-http page, keeping
// crypto.getRandomValues. `npm run test:no-webcrypto` runs the whole suite this way.
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (a) => webcrypto.getRandomValues(a) } });
