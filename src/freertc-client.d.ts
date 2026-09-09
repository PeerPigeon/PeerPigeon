declare module 'freertc/client' {
  export function createSignalingClient(options?: any): any;
  export function withdrawSignalingIdentity(options?: any): { close(): void };
}
