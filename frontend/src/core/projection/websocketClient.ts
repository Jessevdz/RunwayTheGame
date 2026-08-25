import { projectionStore } from './projectionStore';
import { WS_BASE_URL } from '../api/client';
import { syncEngine } from './syncEngine';

class WebsocketClient {
  private ws: WebSocket | null = null;
  private gameId: string | null = null;
  private token: string | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectInterval = 3000; // 3 seconds

  /** Initializes the WebSocket connection for a game session token. */
  init(gameId: string, token: string) {
    if (!gameId) {
      console.warn('[WebsocketClient] init called without a gameId — not connecting');
      return;
    }
    if (
      this.gameId === gameId &&
      this.token === token &&
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.disconnect();
    if (!token) {
      console.warn('[WebsocketClient] init called without a token — the gateway will refuse the upgrade');
    }
    this.gameId = gameId;
    this.token = token;
    projectionStore.reset();
    projectionStore.setGameId(gameId);
    console.log('[WebsocketClient] Initializing in LIVE WEBSOCKET mode');
    this.connectLive();
  }

  // Receives push-only GameStateProjection snapshots from backend.
  private connectLive() {
    if (!this.gameId) return;

    projectionStore.setConnectionState('connecting');

    // Auth token is passed via WebSocket subprotocol headers to avoid URL leakage.
    const url = `${WS_BASE_URL}/api/games/${this.gameId}/ws`;
    const protocols = ['runway.v1', `runway.token.${this.token || ''}`];

    try {
      this.ws = new WebSocket(url, protocols);

      this.ws.onopen = () => {
        console.log('[WebsocketClient] WebSocket connected');
        projectionStore.setConnectionState(this.reconnectInterval > 3000 ? 'catching_up' : 'connected');
        this.reconnectInterval = 3000;
      };

      this.ws.onmessage = (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          projectionStore.applySnapshot(snapshot);
          projectionStore.setConnectionState('connected');
          // A reconnect might have missed offline queue flush events; nudge sync.
          syncEngine.triggerSync();
        } catch (err) {
          console.error('[WebsocketClient] Error parsing message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.warn(`[WebsocketClient] Connection closed (code: ${event.code})`);
        projectionStore.setConnectionState('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WebsocketClient] WebSocket error:', err);
        projectionStore.setConnectionState('disconnected');
      };
    } catch (err) {
      console.error('[WebsocketClient] Error establishing socket:', err);
      projectionStore.setConnectionState('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = window.setTimeout(() => {
      console.log('[WebsocketClient] Attempting reconnect...');
      // Slowly back off reconnect frequency
      this.reconnectInterval = Math.min(this.reconnectInterval * 1.5, 30000);
      this.connectLive();
    }, this.reconnectInterval);
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    projectionStore.setConnectionState('disconnected');
  }
}

export const websocketClient = new WebsocketClient();
