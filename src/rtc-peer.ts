type PeerEvents = {
  signal: (signal: any) => void;
  connect: () => void;
  data: (data: any) => void;
  close: () => void;
  error: (err: any) => void;
  debug: (snapshot: { reason: string; signalingState: string; iceConnectionState: string; connectionState: string; dataChannelState: string }) => void;
};

interface RtcPeerOptions {
  initiator: boolean;
  trickle?: boolean;
  trickleIce?: boolean;
  config?: RTCConfiguration;
}

class TinyEmitter {
  private handlers = new Map<string, Set<Function>>();

  on(event: string, handler: Function): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  emit(event: string, ...args: any[]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(...args);
      } catch {
        // ignore handler errors
      }
    }
  }
}

export class RtcPeer {
  public destroyed = false;

  private readonly initiator: boolean;
  private readonly trickleIce: boolean;
  private readonly pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly emitter = new TinyEmitter();
  private connectedEmitted = false;

  constructor(options: RtcPeerOptions) {
    this.initiator = options.initiator;
    this.trickleIce = options.trickleIce ?? options.trickle ?? true;
    this.pc = new RTCPeerConnection(options.config ?? {});

    this.pc.onicecandidate = (event) => {
      if (!event.candidate || !this.trickleIce) {
        return;
      }
      this.emitter.emit('signal', { candidate: event.candidate.toJSON() });
    };

    this.pc.onsignalingstatechange = () => {
      this.emitDebugSnapshot('signalingstatechange');
    };

    this.pc.oniceconnectionstatechange = () => {
      this.emitDebugSnapshot('iceconnectionstatechange');
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.emitDebugSnapshot('connectionstatechange');
      if (s === 'failed' || s === 'closed') {
        this.destroy();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.attachDataChannel(event.channel);
    };

    if (this.initiator) {
      this.attachDataChannel(this.pc.createDataChannel('gossip'));
      this.createOffer().catch((err) => this.emitter.emit('error', err));
    }

    this.emitDebugSnapshot('constructed');
  }

  on<K extends keyof PeerEvents>(event: K, handler: PeerEvents[K]): void {
    this.emitter.on(event, handler as unknown as Function);
  }

  async signal(signal: any): Promise<void> {
    if (this.destroyed || !signal) return;

    if (signal.type === 'offer' || signal.type === 'answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
      this.emitDebugSnapshot(`remote-${signal.type}`);

      if (signal.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.emitLocalDescription('answer');
      }
      return;
    }

    const candidate = signal.candidate ?? signal;
    if (candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('Data channel not open');
    }
    this.dc.send(data as any);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      if (this.dc && this.dc.readyState !== 'closed') this.dc.close();
    } catch {
      // ignore
    }

    try {
      this.pc.close();
    } catch {
      // ignore
    }

    this.emitter.emit('close');
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dc = channel;
    this.emitDebugSnapshot('datachannel-attached');

    channel.onopen = () => {
      this.emitDebugSnapshot('datachannel-open');
      if (!this.connectedEmitted) {
        this.connectedEmitted = true;
        this.emitter.emit('connect');
      }
    };

    channel.onmessage = (event) => {
      this.emitter.emit('data', event.data);
    };

    channel.onerror = (event) => {
      this.emitDebugSnapshot('datachannel-error');
      this.emitter.emit('error', event);
    };

    channel.onclose = () => {
      this.emitDebugSnapshot('datachannel-close');
      this.destroy();
    };
  }

  private async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.emitLocalDescription('offer');
  }

  private async emitLocalDescription(kind: 'offer' | 'answer'): Promise<void> {
    if (this.trickleIce) {
      this.emitter.emit('signal', this.pc.localDescription);
      this.emitDebugSnapshot(`local-${kind}`);
      return;
    }

    await this.waitForIceGatheringComplete();

    this.emitter.emit('signal', this.pc.localDescription);
    this.emitDebugSnapshot(`local-${kind}-ice-complete`);
  }

  private async waitForIceGatheringComplete(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const onIce = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', onIce);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', onIce);
    });
  }

  private emitDebugSnapshot(reason: string): void {
    this.emitter.emit('debug', {
      reason,
      signalingState: this.pc.signalingState,
      iceConnectionState: this.pc.iceConnectionState,
      connectionState: this.pc.connectionState,
      dataChannelState: this.dc?.readyState ?? 'missing'
    });
  }
}

export type RtcPeerInstance = RtcPeer;
