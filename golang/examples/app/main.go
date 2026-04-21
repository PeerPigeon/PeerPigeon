// Command app is a native desktop GUI for a PeerPigeon Go node.
// Built with Fyne — opens as a real macOS/Windows/Linux app window.
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/layout"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/peerpigeon/peerpigeon-go/pkg/gossip"
	"github.com/peerpigeon/peerpigeon-go/pkg/mesh"
	"github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

// ── colour palette ─────────────────────────────────────────────────────────

var (
	colPurple  = color32(0x7C, 0x3A, 0xED, 0xFF)
	colGreen   = color32(0x22, 0xC5, 0x5E, 0xFF)
	colCyan    = color32(0x06, 0xB6, 0xD4, 0xFF)
	colYellow  = color32(0xF5, 0x9E, 0x0B, 0xFF)
	colRed     = color32(0xEF, 0x44, 0x44, 0xFF)
	colFg      = color32(0xE2, 0xE8, 0xF0, 0xFF)
	colDim     = color32(0x6B, 0x72, 0x80, 0xFF)
)

func color32(r, g, b, a uint8) color { return color{r, g, b, a} }

type color struct{ R, G, B, A uint8 }

func (c color) RGBA() (r, g, b, a uint32) {
	return uint32(c.R) * 0x101, uint32(c.G) * 0x101, uint32(c.B) * 0x101, uint32(c.A) * 0x101
}

// ── state ──────────────────────────────────────────────────────────────────

type appState struct {
	mu           sync.Mutex
	clientID     string
	connected    []string
	discovered   []string
	logLines     []logEntry
	chatLines    []chatEntry
	debugCapture bool
}

type logEntry struct {
	ts   time.Time
	kind string // gossip storage peer sig err
	level string
	text string
}

type chatEntry struct {
	ts    time.Time
	local bool
	from  string
	text  string
}

const maxLog = 300

func (s *appState) addLog(kind, text string) {
	level := "INFO"
	if kind == "err" {
		level = "ERROR"
	}
	s.addLogLevel(kind, level, text)
}

func (s *appState) addLogLevel(kind, level, text string) {
	normLevel := strings.ToUpper(strings.TrimSpace(level))
	if normLevel == "DEBUG" && !s.isDebugCaptureEnabled() {
		return
	}

	s.mu.Lock()
	s.logLines = append(s.logLines, logEntry{ts: time.Now(), kind: kind, level: normLevel, text: text})
	if len(s.logLines) > maxLog {
		s.logLines = s.logLines[len(s.logLines)-maxLog:]
	}
	s.mu.Unlock()
}

func (s *appState) setDebugCaptureEnabled(enabled bool) {
	s.mu.Lock()
	s.debugCapture = enabled
	s.mu.Unlock()
}

func (s *appState) isDebugCaptureEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.debugCapture
}

func (s *appState) addChat(local bool, from, text string) {
	s.mu.Lock()
	s.chatLines = append(s.chatLines, chatEntry{ts: time.Now(), local: local, from: from, text: text})
	if len(s.chatLines) > maxLog {
		s.chatLines = s.chatLines[len(s.chatLines)-maxLog:]
	}
	s.mu.Unlock()
}

// ── main ───────────────────────────────────────────────────────────────────

func main() {
	signalURL := flag.String("signal", "wss://peer.ooo/ws", "Signaling server WebSocket URL")
	networkName := flag.String("networkName", "peerpigeon", "Logical network name (browser-compatible)")
	networkID := flag.String("network", "peerpigeon-app-go", "Room / session ID")
	syncSecret := flag.String("syncSecret", "", "Optional storage sync secret (must match browser)")
	flag.Parse()

	initialNetworkName := strings.TrimSpace(*networkName)
	initialRoomID := strings.TrimSpace(*networkID)
	initialEffectiveSessionID := buildEffectiveSessionID(initialNetworkName, initialRoomID)

	state := &appState{}

	// ── Fyne app ──────────────────────────────────────────────────────────
	a := app.New()
	a.Settings().SetTheme(theme.DarkTheme())
	w := a.NewWindow("🐦 PeerPigeon Go")
	w.Resize(fyne.NewSize(900, 620))

	// ── status label ──────────────────────────────────────────────────────
	statusLabel := widget.NewLabelWithStyle("⬡  Connecting to signaling server…",
		fyne.TextAlignLeading, fyne.TextStyle{})
	statusLabel.Wrapping = fyne.TextWrapWord

	// ── node info ─────────────────────────────────────────────────────────
	clientIDLabel := widget.NewLabelWithStyle("", fyne.TextAlignLeading, fyne.TextStyle{Monospace: true})
	clientIDLabel.Wrapping = fyne.TextWrapWord
	networkLabel := widget.NewLabelWithStyle("session: "+initialEffectiveSessionID,
		fyne.TextAlignLeading, fyne.TextStyle{Italic: true})

	peerCountLabel := widget.NewLabelWithStyle("0 peers", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
	networkEntry := widget.NewEntry()
	networkEntry.SetText(initialNetworkName)
	networkEntry.SetPlaceHolder("peerpigeon")
	roomEntry := widget.NewEntry()
	roomEntry.SetText(initialRoomID)
	roomEntry.SetPlaceHolder("room/session")

	var backendMu sync.Mutex
	var currentMesh *mesh.Mesh
	var currentGossip *gossip.GossipProtocol
	var currentStorage *storage.PeerPigeonStorage
	var currentStorageUnsub func()
	var heartbeatStop chan struct{}
	var backendGeneration int

	isCurrentBackend := func(gen int) bool {
		backendMu.Lock()
		defer backendMu.Unlock()
		return gen == backendGeneration
	}
	getCurrentGossip := func() *gossip.GossipProtocol {
		backendMu.Lock()
		defer backendMu.Unlock()
		return currentGossip
	}
	getCurrentStorage := func() *storage.PeerPigeonStorage {
		backendMu.Lock()
		defer backendMu.Unlock()
		return currentStorage
	}

	var cleanupBackend func(string)
	var startBackend func() error

	connList := widget.NewList(
		func() int { state.mu.Lock(); defer state.mu.Unlock(); return len(state.connected) },
		func() fyne.CanvasObject { return widget.NewLabel("") },
		func(i widget.ListItemID, o fyne.CanvasObject) {
			state.mu.Lock(); defer state.mu.Unlock()
			if i < len(state.connected) {
				o.(*widget.Label).SetText("● " + truncate(state.connected[i], 48))
			}
		},
	)

	discList := widget.NewList(
		func() int { state.mu.Lock(); defer state.mu.Unlock(); return len(state.discovered) },
		func() fyne.CanvasObject { return widget.NewLabel("") },
		func(i widget.ListItemID, o fyne.CanvasObject) {
			state.mu.Lock(); defer state.mu.Unlock()
			if i < len(state.discovered) {
				o.(*widget.Label).SetText("○ " + truncate(state.discovered[i], 48))
			}
		},
	)

	// ── event log tab ──────────────────────────────────────────────────────
	levelSelect := widget.NewSelect([]string{"DEBUG", "INFO", "WARN", "ERROR"}, nil)
	levelSelect.SetSelected("INFO")
	sourceSelect := widget.NewSelect([]string{"ALL", "sig", "peer", "storage", "gossip", "err"}, nil)
	sourceSelect.SetSelected("ALL")
	debugCaptureCheck := widget.NewCheck("Capture DEBUG", nil)
	debugCaptureCheck.SetChecked(false)

	filteredLogs := func() []logEntry {
		state.mu.Lock()
		defer state.mu.Unlock()

		minLevel := logLevelRank(levelSelect.Selected)
		source := strings.TrimSpace(sourceSelect.Selected)
		if source == "" {
			source = "ALL"
		}

		out := make([]logEntry, 0, len(state.logLines))
		for _, e := range state.logLines {
			if logLevelRank(e.level) < minLevel {
				continue
			}
			if source != "ALL" && e.kind != source {
				continue
			}
			out = append(out, e)
		}
		return out
	}

	logList := widget.NewList(
		func() int { return len(filteredLogs()) },
		func() fyne.CanvasObject {
			badge := canvas.NewText("", colFg)
			badge.TextStyle = fyne.TextStyle{Bold: true}
			badge.TextSize = 11
			level := canvas.NewText("", colDim)
			level.TextStyle = fyne.TextStyle{Bold: true}
			level.TextSize = 10
			msg := widget.NewLabel("")
			msg.Wrapping = fyne.TextWrapWord
			ts := widget.NewLabelWithStyle("", fyne.TextAlignTrailing, fyne.TextStyle{Italic: true})
			left := container.NewVBox(badge, level)
			return container.NewBorder(nil, nil, left, ts, msg)
		},
		func(i widget.ListItemID, o fyne.CanvasObject) {
			entries := filteredLogs()
			idx := len(entries) - 1 - i
			if idx < 0 || idx >= len(entries) {
				return
			}
			entry := entries[idx]

			box := o.(*fyne.Container)
			left := box.Objects[1].(*fyne.Container)
			badge := left.Objects[0].(*canvas.Text)
			level := left.Objects[1].(*canvas.Text)
			msg := box.Objects[0].(*widget.Label)
			ts := box.Objects[2].(*widget.Label)

			ts.SetText(entry.ts.Format("15:04:05"))
			msg.SetText(entry.text)
			level.Text = "[" + entry.level + "]"

			switch entry.kind {
			case "gossip":
				badge.Text = "[GOSSIP]"
				badge.Color = colPurple
			case "storage":
				badge.Text = "[STORE] "
				badge.Color = colCyan
			case "peer":
				badge.Text = "[PEER]  "
				badge.Color = colGreen
			case "sig":
				badge.Text = "[SIG]   "
				badge.Color = colYellow
			default:
				badge.Text = "[ERR]   "
				badge.Color = colRed
			}
			badge.Refresh()

			switch entry.level {
			case "DEBUG":
				level.Color = colDim
			case "INFO":
				level.Color = colCyan
			case "WARN":
				level.Color = colYellow
			case "ERROR":
				level.Color = colRed
			default:
				level.Color = colDim
			}
			level.Refresh()
		},
	)
	debugCaptureCheck.OnChanged = func(enabled bool) {
		state.setDebugCaptureEnabled(enabled)
		if !enabled && levelSelect.Selected == "DEBUG" {
			levelSelect.SetSelected("INFO")
		}
		logList.Refresh()
	}
	levelSelect.OnChanged = func(string) { logList.Refresh() }
	sourceSelect.OnChanged = func(string) { logList.Refresh() }

	// ── messages tab (chat-style list + composer) ─────────────────────────
	msgEntry := widget.NewEntry()
	msgEntry.SetPlaceHolder("Type a message...")
	chatList := widget.NewList(
		func() int { state.mu.Lock(); defer state.mu.Unlock(); return len(state.chatLines) },
		func() fyne.CanvasObject {
			sender := widget.NewLabelWithStyle("", fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
			sender.Wrapping = fyne.TextWrapOff
			body := widget.NewLabel("")
			body.Wrapping = fyne.TextWrapWord
			ts := widget.NewLabelWithStyle("", fyne.TextAlignTrailing, fyne.TextStyle{Italic: true})
			header := container.NewBorder(nil, nil, nil, ts, sender)
			return container.NewVBox(header, body)
		},
		func(i widget.ListItemID, o fyne.CanvasObject) {
			state.mu.Lock()
			if i < 0 || i >= len(state.chatLines) {
				state.mu.Unlock()
				return
			}
			entry := state.chatLines[i]
			state.mu.Unlock()

			box := o.(*fyne.Container)
			header := box.Objects[0].(*fyne.Container)
			sender := header.Objects[0].(*widget.Label)
			ts := header.Objects[1].(*widget.Label)
			body := box.Objects[1].(*widget.Label)

			if entry.local {
				sender.SetText("You (sent)")
			} else {
				src := entry.from
				if src == "" {
					src = "Peer"
					sender.SetText("Peer (recv)")
				} else {
					sender.SetText("Peer (recv) " + shortPeerLabel(src))
				}
			}
			body.SetText(entry.text)
			ts.SetText(entry.ts.Format("15:04:05"))
		},
	)
	msgEntry.OnSubmitted = func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		g := getCurrentGossip()
		if g == nil {
			state.addLog("err", "send failed: mesh is not running")
			fyne.Do(logList.Refresh)
			return
		}
		g.Broadcast(s, nil)
		fyne.Do(func() {
			msgEntry.SetText("")
		})
	}
	sendBtn := widget.NewButton("Send", func() { msgEntry.OnSubmitted(msgEntry.Text) })

	// ── storage tab (space-aware put/get/retrieve/subscribe) ───────────────
	spaceSelect := widget.NewSelect([]string{
		string(storage.SpacePublic),
		string(storage.SpaceUser),
		string(storage.SpaceFrozen),
		string(storage.SpacePrivate),
	}, nil)
	spaceSelect.SetSelected(string(storage.SpacePublic))

	storeKey := widget.NewEntry()
	storeKey.SetPlaceHolder("key")
	storeVal := widget.NewEntry()
	storeVal.SetPlaceHolder("value")
	storageOut := widget.NewLabelWithStyle("No result yet.", fyne.TextAlignLeading, fyne.TextStyle{Monospace: true})
	storageOut.Wrapping = fyne.TextWrapWord
	storageOutScroll := container.NewVScroll(storageOut)
	storageOutScroll.SetMinSize(fyne.NewSize(0, 220))

	selectedSpace := func() storage.Space {
		s := storage.Space(strings.TrimSpace(spaceSelect.Selected))
		if s == "" {
			return storage.SpacePublic
		}
		return s
	}
	formatRecord := func(r *storage.Record) string {
		if r == nil {
			return "(not found)"
		}
		return fmt.Sprintf("space=%s\nkey=%s\nowner=%s\nversion=%d\nvalue=%v",
			r.Space, r.Key, r.OwnerID, r.Version, r.Value)
	}

	watchMu := sync.Mutex{}
	watchSpace := storage.Space("")
	watchKey := ""

	putBtn := widget.NewButton("Put", func() {
		st := getCurrentStorage()
		if st == nil {
			state.addLog("err", "storage unavailable: mesh is not running")
			fyne.Do(logList.Refresh)
			return
		}
		k := strings.TrimSpace(storeKey.Text)
		if k == "" {
			return
		}
		sp := selectedSpace()
		rec, err := st.Put(sp, k, storeVal.Text)
		if err != nil {
			state.addLog("err", "storage put: "+err.Error())
			fyne.Do(logList.Refresh)
			return
		}
		state.addLog("storage", fmt.Sprintf("[%s] put %s", sp, k))
		fyne.Do(func() {
			storageOut.SetText(formatRecord(rec))
			logList.Refresh()
		})
	})
	getBtn := widget.NewButton("Get", func() {
		st := getCurrentStorage()
		if st == nil {
			state.addLog("err", "storage unavailable: mesh is not running")
			fyne.Do(logList.Refresh)
			return
		}
		k := strings.TrimSpace(storeKey.Text)
		if k == "" {
			return
		}
		sp := selectedSpace()
		go func() {
			rec, err := st.Get(sp, k)
			if err != nil {
				state.addLog("err", "storage get: "+err.Error())
				fyne.Do(logList.Refresh)
				return
			}
			if rec == nil {
				rec, err = st.Retrieve(sp, k, storage.RetrieveOptions{TimeoutMs: 3000})
				if err != nil {
					state.addLog("err", "storage get/retrieve: "+err.Error())
					fyne.Do(logList.Refresh)
					return
				}
			}
			fyne.Do(func() { storageOut.SetText(formatRecord(rec)) })
		}()
	})
	retrieveBtn := widget.NewButton("Retrieve", func() {
		st := getCurrentStorage()
		if st == nil {
			state.addLog("err", "storage unavailable: mesh is not running")
			fyne.Do(logList.Refresh)
			return
		}
		k := strings.TrimSpace(storeKey.Text)
		if k == "" {
			return
		}
		sp := selectedSpace()
		go func() {
			rec, err := st.Retrieve(sp, k, storage.RetrieveOptions{TimeoutMs: 3000})
			if err != nil {
				state.addLog("err", "storage retrieve: "+err.Error())
				fyne.Do(logList.Refresh)
				return
			}
			fyne.Do(func() { storageOut.SetText(formatRecord(rec)) })
		}()
	})
	listBtn := widget.NewButton("List Space", func() {
		st := getCurrentStorage()
		if st == nil {
			state.addLog("err", "storage unavailable: mesh is not running")
			fyne.Do(logList.Refresh)
			return
		}
		recs, err := st.List(selectedSpace())
		if err != nil {
			state.addLog("err", "storage list: "+err.Error())
			fyne.Do(logList.Refresh)
			return
		}
		if len(recs) == 0 {
			fyne.Do(func() { storageOut.SetText("(no records in this space)") })
			return
		}
		lines := make([]string, 0, len(recs))
		for _, r := range recs {
			lines = append(lines, fmt.Sprintf("%s = %v", r.Key, r.Value))
		}
		fyne.Do(func() { storageOut.SetText(strings.Join(lines, "\n")) })
	})
	subBtn := widget.NewButton("Subscribe Key", func() {
		k := strings.TrimSpace(storeKey.Text)
		if k == "" {
			return
		}
		watchMu.Lock()
		watchSpace = selectedSpace()
		watchKey = k
		watchMu.Unlock()
		fyne.Do(func() {
			storageOut.SetText(fmt.Sprintf("Subscribed to [%s] %s\nWaiting for changes...", watchSpace, watchKey))
		})
	})

	// ── refresh helper (always called on main thread via fyne.Do) ─────────
	refresh := func() {
		fyne.Do(func() {
			state.mu.Lock()
			n := len(state.connected)
			id := state.clientID
			state.mu.Unlock()

			peerCountLabel.SetText(fmt.Sprintf("%d peer(s) connected", n))
			if id != "" {
				clientIDLabel.SetText(id)
			}
			if n > 0 {
				statusLabel.SetText(fmt.Sprintf("⬡  Mesh active · %d peer(s)", n))
			}
			connList.Refresh()
			discList.Refresh()
			chatList.Refresh()
			logList.Refresh()
		})
	}

	cleanupBackend = func(status string) {
		backendMu.Lock()
		backendGeneration++
		oldMesh := currentMesh
		oldGossip := currentGossip
		oldStorage := currentStorage
		oldUnsub := currentStorageUnsub
		oldHeartbeatStop := heartbeatStop
		currentMesh = nil
		currentGossip = nil
		currentStorage = nil
		currentStorageUnsub = nil
		heartbeatStop = nil
		backendMu.Unlock()

		if oldHeartbeatStop != nil {
			close(oldHeartbeatStop)
		}
		if oldUnsub != nil {
			oldUnsub()
		}
		if oldStorage != nil {
			oldStorage.Close()
		}
		if oldGossip != nil {
			oldGossip.Destroy()
		}
		if oldMesh != nil {
			oldMesh.Destroy()
		}

		state.mu.Lock()
		state.clientID = ""
		state.connected = nil
		state.discovered = nil
		state.mu.Unlock()

		fyne.Do(func() {
			clientIDLabel.SetText("")
			peerCountLabel.SetText("0 peers")
			if status != "" {
				statusLabel.SetText(status)
			}
			connList.Refresh()
			discList.Refresh()
		})
	}

	startBackend = func() error {
		network := strings.TrimSpace(networkEntry.Text)
		room := strings.TrimSpace(roomEntry.Text)
		effectiveSessionID := buildEffectiveSessionID(network, room)
		if effectiveSessionID == "" {
			return fmt.Errorf("network name and room cannot both be empty")
		}

		state.setDebugCaptureEnabled(debugCaptureCheck.Checked)

		m := mesh.New(mesh.Config{
			SignalingServer: *signalURL,
			SessionID:       effectiveSessionID,
			MinPeers:        2,
			MaxPeers:        6,
			AutoDiscover:    true,
			AutoConnect:     true,
		})
		g := gossip.New(m, gossip.Options{MaxHops: 6})
		ga := &gossipAdapter{g}
		st, err := storage.New(storage.Options{
			UserID:     "app-user",
			SessionID:  effectiveSessionID,
			SyncSecret: strings.TrimSpace(*syncSecret),
			Gossip:     ga,
		})
		if err != nil {
			g.Destroy()
			m.Destroy()
			return err
		}
		if err := st.Init(); err != nil {
			st.Close()
			g.Destroy()
			m.Destroy()
			return err
		}

		backendMu.Lock()
		backendGeneration++
		gen := backendGeneration
		currentMesh = m
		currentGossip = g
		currentStorage = st
		currentStorageUnsub = nil
		heartbeatStop = make(chan struct{})
		localHeartbeatStop := heartbeatStop
		backendMu.Unlock()

		fyne.Do(func() {
			networkLabel.SetText("session: " + effectiveSessionID)
			statusLabel.SetText("⬡  Connecting to signaling server…")
			clientIDLabel.SetText("")
			peerCountLabel.SetText("0 peers")
		})

		m.OnSignalingLog(func(msg string) {
			if !isCurrentBackend(gen) {
				return
			}
			state.addLogLevel("sig", "DEBUG", msg)
			fyne.Do(logList.Refresh)
		})
		m.OnSignalingConnected(func(id string) {
			if !isCurrentBackend(gen) {
				return
			}
			state.mu.Lock(); state.clientID = id; state.mu.Unlock()
			state.addLogLevel("sig", "INFO", "signaling connected · id="+id)
			fyne.Do(func() { statusLabel.SetText("⬡  Signaling connected · waiting for peers…") })
			refresh()
		})
		m.OnSignalingDisconnected(func() {
			if !isCurrentBackend(gen) {
				return
			}
			state.addLogLevel("sig", "WARN", "signaling disconnected")
			fyne.Do(func() { statusLabel.SetText("⬡  Signaling disconnected — reconnecting…") })
			refresh()
		})
		m.OnMeshReady(func() {
			if !isCurrentBackend(gen) {
				return
			}
			id := m.GetClientID()
			state.mu.Lock(); state.clientID = id; state.mu.Unlock()
			state.addLogLevel("sig", "INFO", "mesh ready · id="+id)
			fyne.Do(func() { statusLabel.SetText("⬡  Mesh ready") })
			refresh()
		})
		m.OnPeerConnected(func(id string) {
			if !isCurrentBackend(gen) {
				return
			}
			state.mu.Lock()
			state.connected = m.GetConnectedPeers()
			state.discovered = m.GetDiscoveredPeers()
			state.mu.Unlock()
			state.addLog("peer", "+ "+id)
			refresh()
		})
		m.OnPeerDisconnected(func(id string) {
			if !isCurrentBackend(gen) {
				return
			}
			state.mu.Lock()
			state.connected = m.GetConnectedPeers()
			state.discovered = m.GetDiscoveredPeers()
			state.mu.Unlock()
			state.addLog("peer", "- "+id)
			refresh()
		})
		m.OnPeerDiscovered(func(id string) {
			if !isCurrentBackend(gen) {
				return
			}
			state.mu.Lock()
			state.discovered = m.GetDiscoveredPeers()
			state.mu.Unlock()
			refresh()
		})

		g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
			if !isCurrentBackend(gen) {
				return
			}
			if text, ok := extractChatText(e.Message.Data, effectiveSessionID); ok {
				state.addChat(e.Local, e.FromPeer, text)
				if e.Local {
					state.addLogLevel("gossip", "INFO", "you: "+truncate(text, 80))
				} else {
					state.addLogLevel("gossip", "INFO", truncate(text, 80))
				}
				fyne.Do(func() {
					chatList.Refresh()
					logList.Refresh()
				})
				return
			}

			state.addLogLevel("gossip", "DEBUG", fmt.Sprintf("system payload from %s (%T)", e.FromPeer, e.Message.Data))
			fyne.Do(logList.Refresh)
		})

		storageUnsub := st.OnChange(func(e storage.ChangeEvent) {
			if !isCurrentBackend(gen) {
				return
			}
			state.addLogLevel("storage", "INFO", fmt.Sprintf("[%s] %s %s", e.Space, e.Op, e.Key))

			watchMu.Lock()
			normWatch := strings.TrimSpace(watchKey)
			normKey := strings.TrimSpace(e.Key)
			match := normWatch != "" && e.Space == watchSpace &&
				(normKey == normWatch || strings.HasSuffix(normKey, "::"+normWatch))
			watchMu.Unlock()

			if match {
				rec, err := st.Get(e.Space, e.Key)
				if err == nil {
					fyne.Do(func() { storageOut.SetText(formatRecord(rec)) })
				}
			}

			fyne.Do(func() { logList.Refresh() })
		})

		backendMu.Lock()
		if gen == backendGeneration {
			currentStorageUnsub = storageUnsub
		}
		backendMu.Unlock()

		go func(localGen int, localMesh *mesh.Mesh, stop <-chan struct{}) {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-ticker.C:
					if !isCurrentBackend(localGen) {
						return
					}
					state.mu.Lock()
					state.connected = localMesh.GetConnectedPeers()
					state.discovered = localMesh.GetDiscoveredPeers()
					if state.clientID == "" {
						state.clientID = localMesh.GetClientID()
					}
					state.mu.Unlock()
					refresh()
				}
			}
		}(gen, m, localHeartbeatStop)

		m.Init()
		return nil
	}

	applySessionBtn := widget.NewButton("Apply Session", func() {
		cleanupBackend("⬡  Restarting mesh…")
		if err := startBackend(); err != nil {
			state.addLog("err", "restart failed: "+err.Error())
			fyne.Do(func() {
				statusLabel.SetText("⬡  Restart failed — see Event Log")
				logList.Refresh()
			})
		}
	})

	// ── layout ────────────────────────────────────────────────────────────
	//
	// Left panel: node info + peer lists
	// Right panel: messages/storage/events tabs

	nodeCard := container.NewVBox(
		widget.NewLabelWithStyle("NODE", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		peerCountLabel,
		clientIDLabel,
		networkLabel,
		widget.NewSeparator(),
		widget.NewLabelWithStyle("SESSION", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewForm(
			widget.NewFormItem("Network", networkEntry),
			widget.NewFormItem("Room", roomEntry),
		),
		applySessionBtn,
	)

	leftPanel := container.NewBorder(
		nodeCard, nil, nil, nil,
		container.New(layout.NewGridLayout(1),
			container.NewBorder(
				widget.NewLabelWithStyle("CONNECTED PEERS", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
				nil, nil, nil, connList,
			),
			container.NewBorder(
				widget.NewLabelWithStyle("DISCOVERED PEERS", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
				nil, nil, nil, discList,
			),
		),
	)

	chatTab := container.NewBorder(
		nil,
		container.NewBorder(nil, nil, nil, sendBtn, msgEntry),
		nil, nil,
		chatList,
	)

	storageControlsTop := container.NewGridWithColumns(
		2,
		widget.NewLabel("Space"),
		spaceSelect,
	)
	storageControlsKeyVal := container.NewGridWithColumns(2, storeKey, storeVal)
	storageButtons := container.NewGridWithColumns(3, putBtn, getBtn, retrieveBtn)
	storageButtons2 := container.NewGridWithColumns(2, subBtn, listBtn)
	storageTab := container.NewBorder(
		container.NewVBox(storageControlsTop, storageControlsKeyVal, storageButtons, storageButtons2, widget.NewSeparator()),
		nil,
		nil,
		nil,
		storageOutScroll,
	)

	eventControls := container.NewGridWithColumns(
		4,
		widget.NewLabel("Min Level"),
		levelSelect,
		widget.NewLabel("Source"),
		sourceSelect,
	)
	eventsHeader := container.NewVBox(eventControls, debugCaptureCheck)
	eventsTab := container.NewBorder(eventsHeader, nil, nil, nil, logList)

	tabs := container.NewAppTabs(
		container.NewTabItem("Messages", chatTab),
		container.NewTabItem("Storage", storageTab),
		container.NewTabItem("Event Log", eventsTab),
	)

	rightPanel := container.NewBorder(nil, nil, nil, nil, tabs)

	split := container.NewHSplit(leftPanel, rightPanel)
	split.SetOffset(0.3)

	content := container.NewBorder(
		container.NewVBox(statusLabel, widget.NewSeparator()),
		nil, nil, nil,
		split,
	)

	w.SetContent(content)
	w.SetOnClosed(func() {
		cleanupBackend("")
	})
	if err := startBackend(); err != nil {
		state.addLog("err", "startup failed: "+err.Error())
		fyne.Do(func() {
			statusLabel.SetText("⬡  Startup failed — see Event Log")
			logList.Refresh()
		})
	}
	w.ShowAndRun()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func buildEffectiveSessionID(networkName, room string) string {
	network := strings.TrimSpace(networkName)
	room = strings.TrimSpace(room)
	if network != "" {
		if room != "" {
			return network + ":" + room
		}
		return network
	}
	return room
}

func shortPeerLabel(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return "peer"
	}
	if len(id) <= 14 {
		return id
	}
	return id[:6] + "…" + id[len(id)-4:]
}

func logLevelRank(level string) int {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "DEBUG":
		return 0
	case "INFO":
		return 1
	case "WARN":
		return 2
	case "ERROR":
		return 3
	default:
		return 1
	}
}

func extractChatText(data interface{}, effectiveSessionID string) (string, bool) {
	switch v := data.(type) {
	case string:
		t := strings.TrimSpace(v)
		if t == "" {
			return "", false
		}
		if strings.Contains(t, "pp-storage-sync-v1") || strings.HasPrefix(t, "{pp-storage-") {
			return "", false
		}
		return t, true
	case map[string]interface{}:
		ppType, _ := v["__ppType"].(string)
		ppType = strings.TrimSpace(ppType)

		// Drop storage and crypto control envelopes from chat view.
		if strings.Contains(ppType, "pp-storage") ||
			(strings.Contains(ppType, "crypto") && v["roomCipher"] == nil && v["recipients"] == nil) {
			return "", false
		}

		if t, ok := v["text"].(string); ok && strings.TrimSpace(t) != "" {
			return strings.TrimSpace(t), true
		}
		if t, ok := v["message"].(string); ok && strings.TrimSpace(t) != "" {
			return strings.TrimSpace(t), true
		}

		if roomCipher, hasRoomCipher := v["roomCipher"].(map[string]interface{}); hasRoomCipher {
			plaintext, err := decryptRoomBroadcastText(roomCipher, effectiveSessionID)
			if err == nil {
				return plaintext, true
			}
			return "[unable to decrypt room message]", true
		}
		if _, hasRecipients := v["recipients"]; hasRecipients {
			return "[encrypted direct/broadcast envelope]", true
		}

		b, err := json.Marshal(v)
		if err != nil {
			return "", false
		}
		out := strings.TrimSpace(string(b))
		if out == "" || out == "{}" {
			return "", false
		}
		return out, true
	default:
		return "", false
	}
}

func decryptRoomBroadcastText(roomCipher map[string]interface{}, effectiveSessionID string) (string, error) {
	if strings.TrimSpace(effectiveSessionID) == "" {
		return "", fmt.Errorf("missing effective session id")
	}
	iv, ok := roomCipher["iv"].(string)
	if !ok || strings.TrimSpace(iv) == "" {
		return "", fmt.Errorf("missing room cipher iv")
	}
	ct, ok := roomCipher["ct"].(string)
	if !ok || strings.TrimSpace(ct) == "" {
		return "", fmt.Errorf("missing room cipher ciphertext")
	}

	seed := "peerpigeon:room-broadcast:v1:" + strings.TrimSpace(effectiveSessionID)
	key := sha256.Sum256([]byte(seed))

	ivBytes, err := base64.RawURLEncoding.DecodeString(iv)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	ctBytes, err := base64.RawURLEncoding.DecodeString(ct)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("gcm init: %w", err)
	}
	plaintext, err := gcm.Open(nil, ivBytes, ctBytes, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt room message: %w", err)
	}
	return string(plaintext), nil
}

type gossipAdapter struct{ g *gossip.GossipProtocol }

func (a *gossipAdapter) Broadcast(data interface{}, meta map[string]interface{}) string {
	return a.g.Broadcast(data, meta)
}
func (a *gossipAdapter) OnMessageReceived(fn func(interface{}, bool, string)) func() {
	return a.g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		fn(e.Message.Data, e.Local, e.FromPeer)
	})
}
