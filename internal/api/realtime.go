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

	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

const (
	wsWriteTimeout = 10 * time.Second
	wsPingInterval = 30 * time.Second

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
	conn *websocket.Conn
	send chan []byte
	// viewer scopes the snapshots this socket receives.
	viewer subscriber
}

// enqueue hands payload to the socket's writer, dropping it if the client is slow or dead.
func (c *wsClient) enqueue(payload []byte) {
	select {
	case c.send <- payload:
	default:
	}
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
		return // best-effort projection rebuild
	}

	// One render per distinct viewer, not per socket: teammates share a payload.
	rendered := make(map[subscriber][]byte, len(clients))
	for _, c := range clients {
		payload, ok := rendered[c.viewer]
		if !ok {
			payload, err = json.Marshal(proj.RedactFor(c.viewer.TeamID, c.viewer.isHost()))
			if err != nil {
				continue
			}
			rendered[c.viewer] = payload
		}
		c.enqueue(payload)
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

	viewer, err := s.authorizeSubscriber(r.Context(), gameID, websocketToken(r))
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

	client := &wsClient{conn: conn, send: make(chan []byte, 16), viewer: viewer}
	s.Hub.join(gameID, client)
	defer func() {
		s.Hub.leave(gameID, client)
		conn.Close()
	}()

	// Push current state immediately on connect.
	if proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0); err == nil {
		if payload, err := json.Marshal(proj.RedactFor(viewer.TeamID, viewer.isHost())); err == nil {
			client.enqueue(payload)
		}
	}

	// Read messages to detect client disconnects and control frames.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				conn.Close()
				return
			}
		}
	}()

	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()

	for {
		select {
		case payload := <-client.send:
			conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
