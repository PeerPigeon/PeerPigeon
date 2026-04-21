// Command tui is a full-screen terminal dashboard for a PeerPigeon Go node.
// Use Tab to switch focus between the event log and the send/put forms.
// Press Ctrl+C or q to quit.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/peerpigeon/peerpigeon-go/pkg/gossip"
	"github.com/peerpigeon/peerpigeon-go/pkg/mesh"
	"github.com/peerpigeon/peerpigeon-go/pkg/storage"
)

// ── styles ─────────────────────────────────────────────────────────────────

var (
	purple    = lipgloss.Color("#7C3AED")
	green     = lipgloss.Color("#22C55E")
	cyan      = lipgloss.Color("#06B6D4")
	yellow    = lipgloss.Color("#F59E0B")
	red       = lipgloss.Color("#EF4444")
	dim       = lipgloss.Color("#4B5563")
	light     = lipgloss.Color("#E2E8F0")
	bgDark    = lipgloss.Color("#0F1117")
	bgCard    = lipgloss.Color("#1E2130")
	bgBorder  = lipgloss.Color("#2D3148")

	titleStyle = lipgloss.NewStyle().
			Foreground(purple).
			Bold(true).
			PaddingLeft(1)

	cardStyle = lipgloss.NewStyle().
			Background(bgCard).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(bgBorder)

	cardFocused = lipgloss.NewStyle().
			Background(bgCard).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(purple)

	labelStyle = lipgloss.NewStyle().
			Foreground(dim).
			Bold(true).
			MarginBottom(0)

	statStyle = lipgloss.NewStyle().
			Foreground(purple).
			Bold(true).
			PaddingLeft(1)

	idStyle = lipgloss.NewStyle().
		Foreground(dim).
		PaddingLeft(1)

	peerStyle = lipgloss.NewStyle().
			Foreground(green).
			PaddingLeft(2)

	logGossip = lipgloss.NewStyle().
			Foreground(purple).
			PaddingLeft(1)

	logStorage = lipgloss.NewStyle().
			Foreground(cyan).
			PaddingLeft(1)

	logPeer = lipgloss.NewStyle().
		Foreground(green).
		PaddingLeft(1)

	logSig = lipgloss.NewStyle().
		Foreground(yellow).
		PaddingLeft(1)

	logErr = lipgloss.NewStyle().
		Foreground(red).
		PaddingLeft(1)

	badgeStyle = lipgloss.NewStyle().
			Foreground(bgCard).
			Background(purple).
			Bold(true).
			Padding(0, 1)

	helpStyle = lipgloss.NewStyle().Foreground(dim).PaddingLeft(1)

	inputLabelStyle = lipgloss.NewStyle().Foreground(dim).Bold(true).PaddingLeft(1)
)

// ── event types for tea.Msg ────────────────────────────────────────────────

type (
	logMsg struct {
		kind string // "gossip" "storage" "peer" "sig" "err"
		text string
		ts   time.Time
	}
	heartbeatMsg struct {
		clientID   string
		connected  []string
		discovered []string
	}
)

// ── model ──────────────────────────────────────────────────────────────────

type focus int

const (
	focusMsg focus = iota
	focusStore
)

const maxLogLines = 200

type model struct {
	// mesh state
	clientID   string
	connected  []string
	discovered []string
	network    string

	// log
	logLines []logMsg

	// inputs
	msgInput   textinput.Model
	storeKey   textinput.Model
	storeVal   textinput.Model
	focus      focus
	storeField int // 0=key 1=val

	// terminal size
	width  int
	height int

	// callbacks to send into the mesh (set after Init)
	sendGossip  func(string)
	sendStorage func(string, string)

	// status
	status string
}

func initialModel(network string, sendGossip func(string), sendStorage func(string, string)) model {
	msg := textinput.New()
	msg.Placeholder = "type a message…"
	msg.CharLimit = 200
	msg.Focus()

	key := textinput.New()
	key.Placeholder = "key"
	key.CharLimit = 100

	val := textinput.New()
	val.Placeholder = "value"
	val.CharLimit = 300

	return model{
		network:     network,
		msgInput:    msg,
		storeKey:    key,
		storeVal:    val,
		focus:       focusMsg,
		sendGossip:  sendGossip,
		sendStorage: sendStorage,
		status:      "connecting to signaling server…",
	}
}

// ── update ─────────────────────────────────────────────────────────────────

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch v := msg.(type) {

	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height

	case tea.KeyMsg:
		switch v.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "tab":
			if m.focus == focusMsg {
				m.focus = focusStore
				m.msgInput.Blur()
				m.storeField = 0
				m.storeKey.Focus()
				m.storeVal.Blur()
			} else {
				if m.storeField == 0 {
					m.storeField = 1
					m.storeKey.Blur()
					m.storeVal.Focus()
				} else {
					m.focus = focusMsg
					m.storeKey.Blur()
					m.storeVal.Blur()
					m.msgInput.Focus()
				}
			}
		case "enter":
			if m.focus == focusMsg {
				txt := strings.TrimSpace(m.msgInput.Value())
				if txt != "" && m.sendGossip != nil {
					m.sendGossip(txt)
					m.msgInput.SetValue("")
				}
			} else if m.focus == focusStore && m.storeField == 1 {
				k := strings.TrimSpace(m.storeKey.Value())
				v2 := strings.TrimSpace(m.storeVal.Value())
				if k != "" && m.sendStorage != nil {
					m.sendStorage(k, v2)
					m.storeKey.SetValue("")
					m.storeVal.SetValue("")
					m.storeField = 0
					m.storeKey.Focus()
					m.storeVal.Blur()
				}
			}
		}

	case logMsg:
		m.logLines = append(m.logLines, v)
		if len(m.logLines) > maxLogLines {
			m.logLines = m.logLines[len(m.logLines)-maxLogLines:]
		}

	case heartbeatMsg:
		m.clientID = v.clientID
		m.connected = v.connected
		m.discovered = v.discovered
		if len(v.connected) > 0 {
			m.status = fmt.Sprintf("mesh active · %d peer(s)", len(v.connected))
		} else {
			m.status = "connected to signaling · waiting for peers…"
		}
	}

	var c tea.Cmd
	m.msgInput, c = m.msgInput.Update(msg)
	cmds = append(cmds, c)
	m.storeKey, c = m.storeKey.Update(msg)
	cmds = append(cmds, c)
	m.storeVal, c = m.storeVal.Update(msg)
	cmds = append(cmds, c)

	return m, tea.Batch(cmds...)
}

// ── view ───────────────────────────────────────────────────────────────────

func (m model) View() string {
	if m.width == 0 {
		return "loading…"
	}

	totalH := m.height - 3 // title + status + help rows

	// ── title bar ──────────────────────────────────────────────────────────
	title := titleStyle.Render("🐦 PeerPigeon Go")
	net   := idStyle.Render("network: " + m.network)
	title = lipgloss.JoinHorizontal(lipgloss.Center, title, "  ", net)

	// ── left column ────────────────────────────────────────────────────────
	leftW := 30
	rightW := m.width - leftW - 3

	leftH := totalH

	// node card
	nodeLines := []string{
		labelStyle.Render("NODE"),
		statStyle.Render(fmt.Sprintf("%d peer(s)", len(m.connected))),
		idStyle.Render(truncate(m.clientID, leftW-4)),
	}
	nodeCard := cardStyle.
		Width(leftW - 2).
		Height(5).
		Render(strings.Join(nodeLines, "\n"))

	// connected peers
	var peerItems []string
	peerItems = append(peerItems, labelStyle.Render("CONNECTED"))
	if len(m.connected) == 0 {
		peerItems = append(peerItems, idStyle.Render("none"))
	} else {
		for _, p := range m.connected {
			peerItems = append(peerItems, peerStyle.Render("● "+truncate(p, leftW-6)))
		}
	}
	connH := clamp(len(m.connected)+3, 4, (leftH-7)/2)
	connCard := cardStyle.
		Width(leftW - 2).
		Height(connH).
		Render(strings.Join(peerItems, "\n"))

	// discovered peers
	var discItems []string
	discItems = append(discItems, labelStyle.Render("DISCOVERED"))
	if len(m.discovered) == 0 {
		discItems = append(discItems, idStyle.Render("none"))
	} else {
		for _, p := range m.discovered {
			discItems = append(discItems, idStyle.Render("○ "+truncate(p, leftW-6)))
		}
	}
	discH := leftH - 7 - connH
	if discH < 4 {
		discH = 4
	}
	discCard := cardStyle.
		Width(leftW - 2).
		Height(discH).
		Render(strings.Join(discItems, "\n"))

	left := lipgloss.JoinVertical(lipgloss.Left, nodeCard, connCard, discCard)

	// ── right column ───────────────────────────────────────────────────────
	logH := totalH - 8 // leave room for inputs

	// event log
	logLines := make([]string, 0, logH)
	start := 0
	if len(m.logLines) > logH {
		start = len(m.logLines) - logH
	}
	for _, l := range m.logLines[start:] {
		ts := idStyle.Render(l.ts.Format("15:04:05"))
		var styled string
		switch l.kind {
		case "gossip":
			styled = logGossip.Render(badgeStyle.Render("GOSSIP") + " " + l.text)
		case "storage":
			styled = logStorage.Render(badgeStyle.Copy().Background(cyan).Render("STORE") + " " + l.text)
		case "peer":
			styled = logPeer.Render(badgeStyle.Copy().Background(green).Render("PEER") + " " + l.text)
		case "sig":
			styled = logSig.Render(badgeStyle.Copy().Background(yellow).Render("SIG") + " " + l.text)
		default:
			styled = logErr.Render(l.text)
		}
		logLines = append(logLines, lipgloss.JoinHorizontal(lipgloss.Top, styled, " ", ts))
	}
	logContent := strings.Join(logLines, "\n")
	logStyle := cardStyle
	if m.focus == focusMsg {
		logStyle = cardFocused
	}
	logCard := logStyle.
		Width(rightW - 2).
		Height(logH).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			labelStyle.Render("EVENT LOG"),
			logContent,
		))

	// broadcast input
	msgStyle := cardStyle
	if m.focus == focusMsg {
		msgStyle = cardFocused
	}
	msgCard := msgStyle.
		Width(rightW - 2).
		Height(4).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			inputLabelStyle.Render("BROADCAST GOSSIP  (Enter to send)"),
			m.msgInput.View(),
		))

	// storage input
	storeStyle := cardStyle
	if m.focus == focusStore {
		storeStyle = cardFocused
	}
	storeCard := storeStyle.
		Width(rightW - 2).
		Height(5).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			inputLabelStyle.Render("PUT PUBLIC STORAGE  (Tab→value, Enter to save)"),
			m.storeKey.View(),
			m.storeVal.View(),
		))

	right := lipgloss.JoinVertical(lipgloss.Left, logCard, msgCard, storeCard)

	// ── status bar ─────────────────────────────────────────────────────────
	statusBar := lipgloss.NewStyle().
		Foreground(light).
		Background(bgCard).
		Width(m.width).
		PaddingLeft(1).
		Render("⬡ " + m.status)

	help := helpStyle.Render("Tab: switch focus   Enter: send   q / Ctrl+C: quit")

	body := lipgloss.JoinHorizontal(lipgloss.Top,
		left,
		lipgloss.NewStyle().Width(1).Render(""),
		right,
	)

	return lipgloss.NewStyle().Background(bgDark).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			title,
			statusBar,
			body,
			help,
		))
}

// ── helpers ────────────────────────────────────────────────────────────────

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n < 4 {
		return s[:n]
	}
	return s[:n-1] + "…"
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ── main ───────────────────────────────────────────────────────────────────

func main() {
	signalURL := flag.String("signal", "wss://freewebrtc.cloud", "Signaling server WebSocket URL")
	networkID := flag.String("network", "peerpigeon-tui-go", "Network / session ID")
	flag.Parse()

	// channel bridge: mesh events → bubbletea messages
	send := func(prog *tea.Program) func(tea.Msg) {
		return func(msg tea.Msg) { prog.Send(msg) }
	}

	var emit func(tea.Msg)

	// ── mesh ──────────────────────────────────────────────────────────────
	m := mesh.New(mesh.Config{
		SignalingServer: *signalURL,
		SessionID:      *networkID,
		MinPeers:       2,
		MaxPeers:       6,
		AutoDiscover:   true,
		AutoConnect:    true,
	})

	// ── gossip ────────────────────────────────────────────────────────────
	g := gossip.New(m, gossip.Options{MaxHops: 6})

	// ── storage ───────────────────────────────────────────────────────────
	ga := &gossipAdapter{g}
	st, err := storage.New(storage.Options{
		UserID:     "tui-user",
		SessionID:  *networkID,
		SyncSecret: "tui-demo-secret",
		Gossip:     ga,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "storage:", err)
		os.Exit(1)
	}
	if err := st.Init(); err != nil {
		fmt.Fprintln(os.Stderr, "storage init:", err)
		os.Exit(1)
	}

	// callbacks wired before Init so we never miss events
	m.OnSignalingConnected(func(id string) {
		if emit != nil {
			emit(logMsg{kind: "sig", text: "signaling connected  id=" + id, ts: time.Now()})
			emit(heartbeatMsg{clientID: id, connected: m.GetConnectedPeers(), discovered: m.GetDiscoveredPeers()})
		}
	})
	m.OnSignalingDisconnected(func() {
		if emit != nil {
			emit(logMsg{kind: "sig", text: "signaling disconnected", ts: time.Now()})
		}
	})
	m.OnMeshReady(func() {
		if emit != nil {
			emit(logMsg{kind: "sig", text: "mesh ready  id=" + m.GetClientID(), ts: time.Now()})
			emit(heartbeatMsg{clientID: m.GetClientID(), connected: m.GetConnectedPeers(), discovered: m.GetDiscoveredPeers()})
		}
	})
	m.OnPeerConnected(func(id string) {
		if emit != nil {
			emit(logMsg{kind: "peer", text: "+ " + id, ts: time.Now()})
			emit(heartbeatMsg{clientID: m.GetClientID(), connected: m.GetConnectedPeers(), discovered: m.GetDiscoveredPeers()})
		}
	})
	m.OnPeerDisconnected(func(id string) {
		if emit != nil {
			emit(logMsg{kind: "peer", text: "- " + id, ts: time.Now()})
			emit(heartbeatMsg{clientID: m.GetClientID(), connected: m.GetConnectedPeers(), discovered: m.GetDiscoveredPeers()})
		}
	})
	m.OnPeerDiscovered(func(id string) {
		if emit != nil {
			emit(heartbeatMsg{clientID: m.GetClientID(), connected: m.GetConnectedPeers(), discovered: m.GetDiscoveredPeers()})
		}
	})

	g.OnMessageReceived(func(e gossip.MessageReceivedEvent) {
		if emit != nil {
			local := ""
			if e.Local {
				local = " [local]"
			}
			emit(logMsg{kind: "gossip", text: truncate(fmt.Sprintf("%v", e.Message.Data), 60) + local, ts: time.Now()})
		}
	})

	st.OnChange(func(e storage.ChangeEvent) {
		if emit != nil {
			emit(logMsg{kind: "storage", text: fmt.Sprintf("[%s] %s %s", e.Space, e.Op, e.Key), ts: time.Now()})
		}
	})

	m.Init()

	// heartbeat ticker
	go func() {
		for range time.NewTicker(2 * time.Second).C {
			if emit != nil {
				emit(heartbeatMsg{
					clientID:   m.GetClientID(),
					connected:  m.GetConnectedPeers(),
					discovered: m.GetDiscoveredPeers(),
				})
			}
		}
	}()

	// action callbacks for the UI
	sendGossip := func(msg string) {
		g.Broadcast(msg, nil)
	}
	sendStorage := func(key, val string) {
		if _, err := st.Put(storage.SpacePublic, key, val); err != nil && emit != nil {
			emit(logMsg{kind: "err", text: "storage put: " + err.Error(), ts: time.Now()})
		}
	}

	// build program
	prog := tea.NewProgram(
		initialModel(*networkID, sendGossip, sendStorage),
		tea.WithAltScreen(),
	)

	// wire emit now that prog exists
	emit = send(prog)

	if _, err := prog.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	// clean shutdown
	st.Close()
	g.Destroy()
	m.Destroy()
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
