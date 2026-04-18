import { expect, test } from '@playwright/test';

const rtcPeerModulePath = '/@fs/Users/danraeder/Documents/GitHub/gossip-protocol/src/rtc-peer.ts';

test.describe('RtcPeer semantics', () => {
  test('connect waits for data channel open and ignores disconnected wobble', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? 'http://127.0.0.1:5183');

    const result = await page.evaluate(async (modulePath) => {
      class FakeRTCDataChannel {
        label: string;
        readyState = 'connecting';
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: any }) => void) | null = null;
        onerror: ((event: any) => void) | null = null;
        onclose: (() => void) | null = null;
        sent: any[] = [];

        constructor(label: string) {
          this.label = label;
        }

        send(data: any): void {
          this.sent.push(data);
        }

        close(): void {
          this.readyState = 'closed';
          this.onclose?.();
        }
      }

      class FakeRTCPeerConnection {
        static instances: FakeRTCPeerConnection[] = [];

        connectionState: RTCPeerConnectionState = 'new';
        iceConnectionState: RTCIceConnectionState = 'new';
        signalingState: RTCSignalingState = 'stable';
        iceGatheringState: RTCIceGatheringState = 'new';
        localDescription: RTCSessionDescriptionInit | null = null;
        remoteDescription: RTCSessionDescriptionInit | null = null;
        onicecandidate: ((event: { candidate: { toJSON: () => any } | null }) => void) | null = null;
        onconnectionstatechange: (() => void) | null = null;
        onsignalingstatechange: (() => void) | null = null;
        oniceconnectionstatechange: (() => void) | null = null;
        ondatachannel: ((event: { channel: FakeRTCDataChannel }) => void) | null = null;
        dataChannel: FakeRTCDataChannel | null = null;
        closed = false;
        private listeners = new Map<string, Set<() => void>>();

        constructor() {
          FakeRTCPeerConnection.instances.push(this);
        }

        createDataChannel(label: string): FakeRTCDataChannel {
          this.dataChannel = new FakeRTCDataChannel(label);
          return this.dataChannel;
        }

        async createOffer(): Promise<RTCSessionDescriptionInit> {
          return { type: 'offer', sdp: 'offer-sdp' };
        }

        async createAnswer(): Promise<RTCSessionDescriptionInit> {
          return { type: 'answer', sdp: 'answer-sdp' };
        }

        async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
          this.localDescription = description;
          this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
          this.onsignalingstatechange?.();
        }

        async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
          this.remoteDescription = description;
          this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
          this.onsignalingstatechange?.();
        }

        async addIceCandidate(): Promise<void> {
          return;
        }

        addEventListener(event: string, handler: () => void): void {
          const set = this.listeners.get(event) ?? new Set<() => void>();
          set.add(handler);
          this.listeners.set(event, set);
        }

        removeEventListener(event: string, handler: () => void): void {
          this.listeners.get(event)?.delete(handler);
        }

        dispatch(event: string): void {
          for (const handler of this.listeners.get(event) ?? []) {
            handler();
          }
        }

        close(): void {
          this.closed = true;
          this.connectionState = 'closed';
          this.onconnectionstatechange?.();
        }
      }

      (window as any).RTCPeerConnection = FakeRTCPeerConnection;
      (window as any).RTCSessionDescription = class {
        type: string;
        sdp?: string;

        constructor(init: RTCSessionDescriptionInit) {
          this.type = String(init.type);
          this.sdp = init.sdp;
        }
      };
      (window as any).RTCIceCandidate = class {
        constructor(public init: RTCIceCandidateInit) {}
      };

      const { RtcPeer } = await import(modulePath);
      const peer = new RtcPeer({ initiator: true, trickleIce: true });
      const events: string[] = [];
      peer.on('connect', () => events.push('connect'));
      peer.on('close', () => events.push('close'));

      const pc = FakeRTCPeerConnection.instances[0];
      pc.connectionState = 'connected';
      pc.onconnectionstatechange?.();

      const afterTransport = {
        events: [...events],
        destroyed: peer.destroyed,
        closed: pc.closed
      };

      pc.connectionState = 'disconnected';
      pc.onconnectionstatechange?.();

      const afterDisconnected = {
        events: [...events],
        destroyed: peer.destroyed,
        closed: pc.closed
      };

      if (!pc.dataChannel) {
        throw new Error('missing data channel');
      }

      pc.dataChannel.readyState = 'open';
      pc.dataChannel.onopen?.();

      return {
        afterTransport,
        afterDisconnected,
        afterOpen: {
          events: [...events],
          destroyed: peer.destroyed,
          closed: pc.closed
        }
      };
    }, rtcPeerModulePath);

    expect(result.afterTransport.events).toEqual([]);
    expect(result.afterTransport.destroyed).toBe(false);
    expect(result.afterDisconnected.events).toEqual([]);
    expect(result.afterDisconnected.destroyed).toBe(false);
    expect(result.afterDisconnected.closed).toBe(false);
    expect(result.afterOpen.events).toEqual(['connect']);
  });

  test('non-trickle answers wait for ICE gathering completion', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? 'http://127.0.0.1:5183');

    const result = await page.evaluate(async (modulePath) => {
      class FakeRTCPeerConnection {
        static instances: FakeRTCPeerConnection[] = [];

        connectionState: RTCPeerConnectionState = 'new';
        iceConnectionState: RTCIceConnectionState = 'new';
        signalingState: RTCSignalingState = 'stable';
        iceGatheringState: RTCIceGatheringState = 'gathering';
        localDescription: RTCSessionDescriptionInit | null = null;
        remoteDescription: RTCSessionDescriptionInit | null = null;
        onicecandidate: ((event: { candidate: { toJSON: () => any } | null }) => void) | null = null;
        onconnectionstatechange: (() => void) | null = null;
        onsignalingstatechange: (() => void) | null = null;
        oniceconnectionstatechange: (() => void) | null = null;
        ondatachannel: ((event: { channel: any }) => void) | null = null;
        private listeners = new Map<string, Set<() => void>>();

        constructor() {
          FakeRTCPeerConnection.instances.push(this);
        }

        async createOffer(): Promise<RTCSessionDescriptionInit> {
          return { type: 'offer', sdp: 'offer-sdp' };
        }

        async createAnswer(): Promise<RTCSessionDescriptionInit> {
          return { type: 'answer', sdp: 'answer-sdp' };
        }

        async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
          this.localDescription = description;
          this.onsignalingstatechange?.();
        }

        async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
          this.remoteDescription = description;
          this.onsignalingstatechange?.();
        }

        async addIceCandidate(): Promise<void> {
          return;
        }

        addEventListener(event: string, handler: () => void): void {
          const set = this.listeners.get(event) ?? new Set<() => void>();
          set.add(handler);
          this.listeners.set(event, set);
        }

        removeEventListener(event: string, handler: () => void): void {
          this.listeners.get(event)?.delete(handler);
        }

        dispatch(event: string): void {
          for (const handler of this.listeners.get(event) ?? []) {
            handler();
          }
        }

        close(): void {
          return;
        }
      }

      (window as any).RTCPeerConnection = FakeRTCPeerConnection;
      (window as any).RTCSessionDescription = class {
        type: string;
        sdp?: string;

        constructor(init: RTCSessionDescriptionInit) {
          this.type = String(init.type);
          this.sdp = init.sdp;
        }
      };
      (window as any).RTCIceCandidate = class {
        constructor(public init: RTCIceCandidateInit) {}
      };

      const { RtcPeer } = await import(modulePath);
      const peer = new RtcPeer({ initiator: false, trickleIce: false });
      const signals: any[] = [];
      peer.on('signal', (signal) => signals.push(signal));

      const pending = peer.signal({ type: 'offer', sdp: 'remote-offer' });
      await Promise.resolve();
      await Promise.resolve();

      const pc = FakeRTCPeerConnection.instances[0];
      const beforeComplete = signals.map((signal) => ({ ...signal }));

      pc.iceGatheringState = 'complete';
      pc.dispatch('icegatheringstatechange');
      await pending;

      return {
        beforeComplete,
        afterComplete: signals.map((signal) => ({ ...signal }))
      };
    }, rtcPeerModulePath);

    expect(result.beforeComplete).toEqual([]);
    expect(result.afterComplete).toEqual([{ type: 'answer', sdp: 'answer-sdp' }]);
  });
});