// Package rtcpeer provides a WebRTC peer abstraction over pion/webrtc.
// It is a faithful Go port of src/rtc-peer.ts.
package rtcpeer

import (
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/pion/webrtc/v3"
)

// Signal is an SDP or ICE-candidate exchange message.
type Signal struct {
	Type      string         `json:"type,omitempty"`
	SDP       string         `json:"sdp,omitempty"`
	Candidate *CandidateInit `json:"candidate,omitempty"`
}

// CandidateInit mirrors RTCIceCandidateInit from the browser WebRTC API.
type CandidateInit struct {
	Candidate        string  `json:"candidate"`
	SDPMid           *string `json:"sdpMid,omitempty"`
	SDPMLineIndex    *uint16 `json:"sdpMLineIndex,omitempty"`
	UsernameFragment *string `json:"usernameFragment,omitempty"`
}

// DebugSnapshot captures connection state at a diagnostic moment.
type DebugSnapshot struct {
	Reason           string
	SignalingState   string
	ICEConnState     string
	ConnectionState  string
	DataChannelState string
}

// Options configures a new RtcPeer.
type Options struct {
	// Initiator creates the data channel and sends the initial WebRTC offer.
	Initiator bool
	// TrickleICE enables sending ICE candidates as they arrive rather than
	// waiting for ICE gathering to complete before emitting the SDP.
	TrickleICE bool
	// Config is the pion WebRTC configuration (ICE servers, etc.).
	Config *webrtc.Configuration
}

// RtcPeer wraps a pion PeerConnection and mirrors the TS RtcPeer event interface.
type RtcPeer struct {
	destroyed atomic.Bool
	initiator bool
	trickle   bool
	pc        *webrtc.PeerConnection

	mu              sync.Mutex
	dc              *webrtc.DataChannel
	connectedOnce   bool
	iceGatherDone   chan struct{}
	iceGatherClosed atomic.Bool

	// event callbacks
	signalCBs  []func(Signal)
	connectCBs []func()
	dataCBs    []func([]byte)
	closeCBs   []func()
	errorCBs   []func(error)
	debugCBs   []func(DebugSnapshot)
}

// New creates and returns a new RtcPeer.
// If Initiator is true, it immediately creates the data channel and starts
// generating the WebRTC offer.
func New(opts Options) (*RtcPeer, error) {
	cfg := webrtc.Configuration{}
	if opts.Config != nil {
		cfg = *opts.Config
	}

	pc, err := webrtc.NewPeerConnection(cfg)
	if err != nil {
		return nil, fmt.Errorf("rtcpeer: new peer connection: %w", err)
	}

	p := &RtcPeer{
		initiator:     opts.Initiator,
		trickle:       opts.TrickleICE,
		pc:            pc,
		iceGatherDone: make(chan struct{}),
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			// nil signals gathering complete
			if p.iceGatherClosed.CompareAndSwap(false, true) {
				close(p.iceGatherDone)
			}
			return
		}
		if !p.trickle {
			return
		}
		init := c.ToJSON()
		p.fireSignal(Signal{
			Candidate: &CandidateInit{
				Candidate:        init.Candidate,
				SDPMid:           init.SDPMid,
				SDPMLineIndex:    init.SDPMLineIndex,
				UsernameFragment: init.UsernameFragment,
			},
		})
	})

	pc.OnSignalingStateChange(func(webrtc.SignalingState) {
		p.fireDebug("signalingstatechange")
	})
	pc.OnICEConnectionStateChange(func(webrtc.ICEConnectionState) {
		p.fireDebug("iceconnectionstatechange")
	})
	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		p.fireDebug("connectionstatechange")
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			p.Destroy()
		}
	})
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		p.attachDataChannel(dc)
	})

	if opts.Initiator {
		dc, err := pc.CreateDataChannel("gossip", nil)
		if err != nil {
			_ = pc.Close()
			return nil, fmt.Errorf("rtcpeer: create data channel: %w", err)
		}
		p.attachDataChannel(dc)
		go func() {
			if err := p.createOffer(); err != nil {
				p.fireError(fmt.Errorf("rtcpeer: create offer: %w", err))
			}
		}()
	}

	p.fireDebug("constructed")
	return p, nil
}

// OnSignal registers a callback invoked when a local signal is ready to send.
func (p *RtcPeer) OnSignal(fn func(Signal)) {
	p.mu.Lock()
	p.signalCBs = append(p.signalCBs, fn)
	p.mu.Unlock()
}

// OnConnect registers a callback invoked when the data channel opens.
func (p *RtcPeer) OnConnect(fn func()) {
	p.mu.Lock()
	p.connectCBs = append(p.connectCBs, fn)
	p.mu.Unlock()
}

// OnData registers a callback invoked when data arrives on the data channel.
func (p *RtcPeer) OnData(fn func([]byte)) {
	p.mu.Lock()
	p.dataCBs = append(p.dataCBs, fn)
	p.mu.Unlock()
}

// OnClose registers a callback invoked when the peer connection closes.
func (p *RtcPeer) OnClose(fn func()) { p.mu.Lock(); p.closeCBs = append(p.closeCBs, fn); p.mu.Unlock() }

// OnError registers a callback invoked on peer errors.
func (p *RtcPeer) OnError(fn func(error)) {
	p.mu.Lock()
	p.errorCBs = append(p.errorCBs, fn)
	p.mu.Unlock()
}

// OnDebug registers a callback invoked on state-change debug snapshots.
func (p *RtcPeer) OnDebug(fn func(DebugSnapshot)) {
	p.mu.Lock()
	p.debugCBs = append(p.debugCBs, fn)
	p.mu.Unlock()
}

// Signal processes an incoming WebRTC signal (offer, answer, or ICE candidate).
func (p *RtcPeer) Signal(sig Signal) error {
	if p.destroyed.Load() {
		return nil
	}

	if sig.Type == "offer" || sig.Type == "answer" {
		sdpType := webrtc.SDPTypeOffer
		if sig.Type == "answer" {
			sdpType = webrtc.SDPTypeAnswer
		}
		if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{Type: sdpType, SDP: sig.SDP}); err != nil {
			return fmt.Errorf("rtcpeer: set remote description: %w", err)
		}
		p.fireDebug("remote-" + sig.Type)

		if sig.Type == "offer" {
			answer, err := p.pc.CreateAnswer(nil)
			if err != nil {
				return fmt.Errorf("rtcpeer: create answer: %w", err)
			}
			if err := p.pc.SetLocalDescription(answer); err != nil {
				return fmt.Errorf("rtcpeer: set local answer: %w", err)
			}
			// emitLocalDescription blocks for non-trickle – run in goroutine
			go p.emitLocalDescription("answer")
		}
		return nil
	}

	if sig.Candidate != nil {
		init := webrtc.ICECandidateInit{
			Candidate:        sig.Candidate.Candidate,
			SDPMid:           sig.Candidate.SDPMid,
			SDPMLineIndex:    sig.Candidate.SDPMLineIndex,
			UsernameFragment: sig.Candidate.UsernameFragment,
		}
		if err := p.pc.AddICECandidate(init); err != nil {
			return fmt.Errorf("rtcpeer: add ICE candidate: %w", err)
		}
	}
	return nil
}

// Send sends raw bytes over the data channel.
func (p *RtcPeer) Send(data []byte) error {
	p.mu.Lock()
	dc := p.dc
	p.mu.Unlock()
	if dc == nil {
		return fmt.Errorf("rtcpeer: data channel not open")
	}
	return dc.Send(data)
}

// Destroy closes the peer connection and fires the close callbacks.
func (p *RtcPeer) Destroy() {
	if !p.destroyed.CompareAndSwap(false, true) {
		return
	}
	p.mu.Lock()
	dc := p.dc
	p.mu.Unlock()
	if dc != nil {
		_ = dc.Close()
	}
	_ = p.pc.Close()
	// Ensure iceGatherDone is closed so non-trickle goroutines unblock.
	if p.iceGatherClosed.CompareAndSwap(false, true) {
		close(p.iceGatherDone)
	}
	p.fireClose()
}

// Destroyed returns true if Destroy has been called.
func (p *RtcPeer) Destroyed() bool { return p.destroyed.Load() }

// ── internals ──────────────────────────────────────────────────────────────

func (p *RtcPeer) attachDataChannel(dc *webrtc.DataChannel) {
	p.mu.Lock()
	p.dc = dc
	p.mu.Unlock()
	p.fireDebug("datachannel-attached")

	dc.OnOpen(func() {
		p.fireDebug("datachannel-open")
		p.mu.Lock()
		first := !p.connectedOnce
		p.connectedOnce = true
		p.mu.Unlock()
		if first {
			p.fireConnect()
		}
	})
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		p.fireData(msg.Data)
	})
	dc.OnError(func(err error) {
		p.fireDebug("datachannel-error")
		p.fireError(err)
	})
	dc.OnClose(func() {
		p.fireDebug("datachannel-close")
		p.Destroy()
	})
}

func (p *RtcPeer) createOffer() error {
	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		return err
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		return err
	}
	p.emitLocalDescription("offer")
	return nil
}

func (p *RtcPeer) emitLocalDescription(kind string) {
	if p.trickle {
		ld := p.pc.LocalDescription()
		if ld != nil {
			p.fireSignal(Signal{Type: ld.Type.String(), SDP: ld.SDP})
		}
		p.fireDebug("local-" + kind)
		return
	}
	// Non-trickle: wait for ICE gathering to complete before emitting SDP.
	<-p.iceGatherDone
	ld := p.pc.LocalDescription()
	if ld != nil {
		p.fireSignal(Signal{Type: ld.Type.String(), SDP: ld.SDP})
	}
	p.fireDebug("local-" + kind + "-ice-complete")
}

// ── event firing helpers ───────────────────────────────────────────────────

func (p *RtcPeer) fireSignal(s Signal) {
	p.mu.Lock()
	cbs := append(([]func(Signal))(nil), p.signalCBs...)
	p.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(s) })
	}
}

func (p *RtcPeer) fireConnect() {
	p.mu.Lock()
	cbs := append(([]func())(nil), p.connectCBs...)
	p.mu.Unlock()
	for _, fn := range cbs {
		safeCall(fn)
	}
}

func (p *RtcPeer) fireData(data []byte) {
	p.mu.Lock()
	cbs := append(([]func([]byte))(nil), p.dataCBs...)
	p.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(data) })
	}
}

func (p *RtcPeer) fireClose() {
	p.mu.Lock()
	cbs := append(([]func())(nil), p.closeCBs...)
	p.mu.Unlock()
	for _, fn := range cbs {
		safeCall(fn)
	}
}

func (p *RtcPeer) fireError(err error) {
	p.mu.Lock()
	cbs := append(([]func(error))(nil), p.errorCBs...)
	p.mu.Unlock()
	for _, fn := range cbs {
		safeCall(func() { fn(err) })
	}
}

func (p *RtcPeer) fireDebug(reason string) {
	p.mu.Lock()
	cbs := append(([]func(DebugSnapshot))(nil), p.debugCBs...)
	dc := p.dc
	p.mu.Unlock()

	snap := DebugSnapshot{
		Reason:          reason,
		SignalingState:  p.pc.SignalingState().String(),
		ICEConnState:    p.pc.ICEConnectionState().String(),
		ConnectionState: p.pc.ConnectionState().String(),
	}
	if dc != nil {
		snap.DataChannelState = dc.ReadyState().String()
	} else {
		snap.DataChannelState = "closed"
	}
	for _, fn := range cbs {
		safeCall(func() { fn(snap) })
	}
}

func safeCall(fn func()) {
	defer func() { recover() }() //nolint:errcheck
	fn()
}
