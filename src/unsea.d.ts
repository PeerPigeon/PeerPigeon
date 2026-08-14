declare module 'unsea' {
  export type UnseaKeyPair = {
    pub: string;
    priv: string;
    epub: string;
    epriv: string;
  };

  export function generateRandomPair(): Promise<UnseaKeyPair>;
  export function encryptMessageWithMeta(
    plaintext: string,
    recipient: { epub: string }
  ): Promise<unknown>;
  export function decryptMessageWithMeta(cipher: unknown, epriv: string): Promise<string>;
}
