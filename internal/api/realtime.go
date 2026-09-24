package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

const (
	wsWriteTimeout  = 10 * time.Second
	wsPingInterval  = 30 * time.Second
	wsReadLimit     = 4 * 1024
	wsClientSendCap = 16

	// wsProtocol is the WebSocket subprotocol negotiated by the gateway.
	wsProtocol = "runway.v1"
	// wsTokenProtocolPrefix is the subprotocol prefix carrying authentication tokens.
	wsTokenProtocolPrefix = "runway.token."
)

// websocketToken extracts the capability token from the Authorization header or WebSocket subprotocol.
func websocketToken(r *http.Request) string {
	if token := bearerToken(r); token != "" {
		return token
	}
	for _, proto := range websocket.Subprotocols(r) {
		if strings.HasPrefix(proto, wsTokenProtocolPrefix) {
			return strings.TrimPrefix(proto, wsTokenProtocolPrefix)
		}
	}
	return ""
}

// wsClient is one connected socket subscribed to a single game's channel.
type wsClient struct {
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	tokenHash string

	stateMu      sync.Mutex
	viewer       subscriber
	authRevision uint64
	lastSequence int
	closed       bool
	closeOnce    sync.Once
}

func (c *wsClient) beginAuthorization() uint64 {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	c.authRevision++
	return c.authRevision
}

// enqueue keeps only the newest queued snapshot and rejects snapshots from an older projection or authorization check.
func (c *wsClient) enqueue(revision uint64, sequence int, viewer subscriber, payload []byte) bool {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if c.closed || revision != c.authRevision {
		return false
	}
	select {
	case <-c.done:
		return false
	default:
	}

	scopeChanged := viewer != c.viewer
	if scopeChanged {
		c.discardQueuedSnapshots()
		c.viewer = viewer
	}
	if sequence < c.lastSequence || (sequence == c.lastSequence && !scopeChanged) {
		return false
	}
	if sequence > c.lastSequence {
		c.lastSequence = sequence
	}

	select {
	case c.send <- payload:
		return true
	default:
		c.discardQueuedSnapshots()
		select {
		case c.send <- payload:
			return true
		default:
			return false
		}
	}
}

func (c *wsClient) discardQueuedSnapshots() {
	for {
		select {
		case <-c.send:
		default:
			return
		}
	}
}

func (c *wsClient) closeIfCurrentAuthorization(revision uint64, code int, reason string) bool {
	c.stateMu.Lock()
	if c.closed || revision != c.authRevision {
		c.stateMu.Unlock()
		return false
	}
	c.closed = true
	c.stateMu.Unlock()
	c.closeSocket(code, reason)
	return true
}

func (c *wsClient) closeSocket(code int, reason string) {
	c.stateMu.Lock()
	c.closed = true
	c.stateMu.Unlock()
	c.closeOnce.Do(func() {
		if code != 0 {
			_ = c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(code, reason), time.Now().Add(wsWriteTimeout))
		}
		_ = c.conn.Close()
		close(c.done)
	})
}

// Hub manages WebSocket client rooms and broadcasts projection snapshots for active games.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*wsClient]struct{}
}

func newHub() *Hub {
	return &Hub{rooms: make(map[string]map[*wsClient]struct{})}
}

func (h *Hub) join(gameID string, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[gameID] == nil {
		h.rooms[gameID] = make(map[*wsClient]struct{})
	}
	h.rooms[gameID][c] = struct{}{}
}

func (h *Hub) leave(gameID string, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms[gameID], c)
	if len(h.rooms[gameID]) == 0 {
		delete(h.rooms, gameID)
	}
}

// clients snapshots the sockets subscribed to gameID so rendering happens off the lock.
func (h *Hub) clients(gameID string) []*wsClient {
	h.mu.RLock()
	defer h.mu.RUnlock()
	room := h.rooms[gameID]
	out := make([]*wsClient, 0, len(room))
	for c := range room {
		out = append(out, c)
	}
	return out
}

// broadcastProjection rebuilds the projection for gameID and pushes each client the
// snapshot its own capability is allowed to see.
func (s *Server) broadcastProjection(ctx context.Context, gameID string) {
	h := s.Hub
	if h == nil {
		return
	}
	clients := h.clients(gameID)
	if len(clients) == 0 {
		return
	}

	proj, err := projections.RebuildProjection(ctx, s.DB.Pool, gameID, 0)
	if err != nil {
		logger.Error(ctx, "failed to rebuild projection for websocket broadcast", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
		return
	}

	// One render per distinct viewer, not per socket: teammates share a payload.
	rendered := make(map[subscriber][]byte, len(clients))
	for _, c := range clients {
		revision := c.beginAuthorization()
		viewer, err := s.authorizeSubscriberHash(ctx, gameID, c.tokenHash)
		if err != nil {
			code, reason := websocket.CloseInternalServerErr, "authorization could not be refreshed"
			if errors.Is(err, errGameNotFound) || errors.Is(err, errInvalidSubscriberToken) {
				code, reason = websocket.ClosePolicyViolation, "authorization is no longer valid"
			}
			if c.closeIfCurrentAuthorization(revision, code, reason) {
				logger.Error(ctx, "failed to refresh websocket authorization", map[string]interface{}{
					"game_id": gameID,
					"error":   err.Error(),
				})
			}
			continue
		}

		payload, ok := rendered[viewer]
		if !ok {
			payload, err = json.Marshal(proj.RedactFor(viewer.TeamID, viewer.isHost()))
			if err != nil {
				logger.Error(ctx, "failed to encode websocket projection", map[string]interface{}{
					"game_id": gameID,
					"error":   err.Error(),
				})
				continue
			}
			rendered[viewer] = payload
		}
		c.enqueue(revision, proj.LastSequence, viewer, payload)
	}
}

// BroadcastGameState re-renders and pushes the current projection for gameID to every subscribed client.
func (s *Server) BroadcastGameState(ctx context.Context, gameID string) {
	s.broadcastProjection(ctx, gameID)
}

// handleWebSocket upgrades HTTP connections to stream game state snapshots to authorized subscribers.
// Access requires host or team authorization for the specified game.
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	token := websocketToken(r)
	viewer, err := s.authorizeSubscriber(r.Context(), gameID, token)
	if err != nil {
		if errors.Is(err, errGameNotFound) {
			writeError(r.Context(), w, http.StatusNotFound, "game not found")
			return
		}
		writeError(r.Context(), w, http.StatusUnauthorized, "a team or host token is required to follow this race")
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(wsReadLimit)

	client := &wsClient{
		conn:         conn,
		send:         make(chan []byte, wsClientSendCap),
		done:         make(chan struct{}),
		tokenHash:    hashToken(token),
		viewer:       viewer,
		lastSequence: -1,
	}
	s.Hub.join(gameID, client)
	defer func() {
		s.Hub.leave(gameID, client)
		client.closeSocket(0, "")
	}()

	// Push current state immediately on connect. Report a projection failure as
	// a websocket error instead of leaving the client connected without state.
	revision := client.beginAuthorization()
	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		logger.Error(r.Context(), "failed to rebuild projection for websocket connection", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
		client.closeSocket(websocket.CloseInternalServerErr, "failed to load game state")
		return
	}
	viewer, err = s.authorizeSubscriberHash(r.Context(), gameID, client.tokenHash)
	if err != nil {
		code, reason := websocket.CloseInternalServerErr, "authorization could not be refreshed"
		if errors.Is(err, errGameNotFound) || errors.Is(err, errInvalidSubscriberToken) {
			code, reason = websocket.ClosePolicyViolation, "authorization is no longer valid"
		}
		logger.Error(r.Context(), "failed to refresh websocket authorization", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
		client.closeSocket(code, reason)
		return
	}
	initialPayload, err := json.Marshal(proj.RedactFor(viewer.TeamID, viewer.isHost()))
	if err != nil {
		logger.Error(r.Context(), "failed to encode projection for websocket connection", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
		client.closeSocket(websocket.CloseInternalServerErr, "failed to encode game state")
		return
	}
	client.enqueue(revision, proj.LastSequence, viewer, initialPayload)

	// Read messages to detect client disconnects and control frames.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				client.closeSocket(0, "")
				return
			}
		}
	}()

	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-client.done:
			return
		case payload := <-client.send:
			conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				client.closeSocket(0, "")
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				client.closeSocket(0, "")
				return
			}
		}
	}
}
