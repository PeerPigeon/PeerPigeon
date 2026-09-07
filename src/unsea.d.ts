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
  export function signMessage(msg: string, privB64: string): Promise<string>;
  export function verifyMessage(msg: string, sigB64: string, pubJwk: string): Promise<boolean>;
}

