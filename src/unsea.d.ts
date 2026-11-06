declare module 'unsea' {
  export type UnseaKeyPair = {
    pub: string;
    priv: string;
    epub: string;
    epriv: string;
    /** ML-DSA-65 public key and seed (unsea 3). */
    qpub?: string;
    qpriv?: string;
    /** ML-KEM-768 public key and seed (unsea 3). */
    kpub?: string;
    kpriv?: string;
  };

  export function generateRandomPair(options?: { postQuantum?: boolean }): Promise<UnseaKeyPair>;
  export function hasPostQuantumKeys(pair: unknown): boolean;
  export function upgradePair<T extends UnseaKeyPair>(pair: T): T & Required<Pick<UnseaKeyPair, 'qpub' | 'qpriv' | 'kpub' | 'kpriv'>>;
  export function encryptMessageWithMeta(
    plaintext: string,
    recipient: { epub: string; kpub?: string }
  ): Promise<unknown>;
  export function signMessage(message: string, privOrPair: string | { priv: string; qpriv?: string }): Promise<string>;
  export function verifyMessage(message: string, signature: string, pubOrKeys: string | { pub: string; qpub?: string }): Promise<boolean>;
  export function decryptMessageWithMeta(cipher: unknown, privOrPair: string | { epriv: string; kpriv?: string }): Promise<string>;
}
