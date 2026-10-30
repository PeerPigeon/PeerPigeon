declare module 'freertc/client' {
  export function createSignalingClient(options?: any): any;
  export function withdrawSignalingIdentity(options?: any): { close(): void };
  export function isDirectRelayUrl(value: string): boolean;
  export function lookupDirectRelays(options?: {
    name?: string;
    network?: string;
    room?: string;
    dohUrls?: string[];
    fetchImpl?: typeof fetch;
  }): Promise<Array<{ node_id: string; direct: string; tunnel: string | null; capacity: number; name: string | null }>>;
  export const DEFAULT_DIRECTORY_NAME: string;
}
