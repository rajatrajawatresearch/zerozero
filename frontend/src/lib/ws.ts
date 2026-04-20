import { useEffect, useRef, useState } from 'react';
import { env } from './env';
import { WS_CONFIG } from './constants';
import { useAuthStore } from '@/store/auth';
import type { OrderStatus, OrderWsEvent } from '@/types';

/* -------------------------------------------------------------------------- */
/*                                Public types                                */
/* -------------------------------------------------------------------------- */
export type WsState =
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'reconnecting';

export interface ReconnectingWSOptions {
  token?: string;
  onMessage: (msg: unknown) => void;
  onOpen?: () => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  /** Override the default heartbeat interval for tests. */
  heartbeatIntervalMs?: number;
}

/* -------------------------------------------------------------------------- */
/*                               ReconnectingWS                               */
/* -------------------------------------------------------------------------- */
/**
 * Tiny native-WS wrapper with:
 *  - exponential backoff reconnect (500ms base, x2, capped at 30s)
 *  - periodic `{type:'ping'}` heartbeat; closes the socket if no response
 *    within `HEARTBEAT_TIMEOUT_MS` (the onclose handler then triggers the
 *    usual reconnect path, so no special handling needed here)
 *  - token appended as `?token=<jwt>` on each connection attempt so a
 *    fresh access token is picked up on reconnect after a refresh
 *  - explicit `close()` that marks the instance as intentionally closed
 *    and suppresses further reconnects
 *
 * Not a React hook — for React integration use `useOrderSocket()` below
 * or wrap in your own hook at the feature layer.
 */
export class ReconnectingWS {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: WsState = 'closed';

  constructor(
    private readonly url: string,
    private readonly opts: ReconnectingWSOptions,
  ) {
    this.connect();
  }

  get state(): WsState {
    return this._state;
  }

  /** Send a JSON-serialisable payload; no-op if socket is not open. */
  send(obj: unknown): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(obj));
    }
  }

  /** Close the socket and stop all reconnect attempts. */
  close(): void {
    this.intentionalClose = true;
    this.clearTimers();
    this._state = 'closing';
    if (this.socket) {
      try {
        this.socket.close(1000, 'client_close');
      } catch {
        // ignore
      }
    }
    this._state = 'closed';
  }

  /* -------------------------------- private ------------------------------- */

  private connect(): void {
    this._state = this.attempts === 0 ? 'connecting' : 'reconnecting';

    const sep = this.url.includes('?') ? '&' : '?';
    const target = this.opts.token
      ? `${this.url}${sep}token=${encodeURIComponent(this.opts.token)}`
      : this.url;

    let ws: WebSocket;
    try {
      ws = new WebSocket(target);
    } catch (err) {
      // Constructor throws synchronously on invalid URL etc. — schedule retry.
      this.opts.onError?.(err as Event);
      this.scheduleReconnect();
      return;
    }

    this.socket = ws;

    ws.addEventListener('open', () => {
      this.attempts = 0;
      this._state = 'open';
      this.startHeartbeat();
      this.opts.onOpen?.();
    });

    ws.addEventListener('message', (ev: MessageEvent<string>) => {
      let parsed: unknown = ev.data;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        // Allow raw string frames to flow through.
      }

      // Any inbound frame counts as a heartbeat reply.
      this.clearHeartbeatTimeout();

      // Swallow pong frames — consumers don't need them.
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { type?: unknown }).type === 'pong'
      ) {
        return;
      }

      this.opts.onMessage(parsed);
    });

    ws.addEventListener('close', (ev) => {
      this.stopHeartbeat();
      this.opts.onClose?.(ev);
      this.socket = null;
      if (this.intentionalClose) {
        this._state = 'closed';
        return;
      }
      this.scheduleReconnect();
    });

    ws.addEventListener('error', (ev) => {
      this.opts.onError?.(ev);
      // Error is always followed by `close` — don't schedule here.
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    this._state = 'reconnecting';
    const delay = Math.min(
      WS_CONFIG.BACKOFF_BASE_MS * WS_CONFIG.BACKOFF_FACTOR ** this.attempts,
      WS_CONFIG.BACKOFF_CAP_MS,
    );
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval =
      this.opts.heartbeatIntervalMs ?? WS_CONFIG.HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
        // If no frame arrives within HEARTBEAT_TIMEOUT_MS, force-close so
        // the reconnect pipeline takes over.
        this.heartbeatTimeoutTimer = setTimeout(() => {
          try {
            this.socket?.close(4000, 'heartbeat_timeout');
          } catch {
            // ignore
          }
        }, WS_CONFIG.HEARTBEAT_TIMEOUT_MS);
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }
}

/* -------------------------------------------------------------------------- */
/*                            React hook: useOrderSocket                      */
/* -------------------------------------------------------------------------- */
export interface OrderSocketSnapshot {
  status: OrderStatus | null;
  events: OrderWsEvent[];
  state: WsState;
}

/**
 * Subscribe to `/ws/orders/{orderId}` for a single order.
 *
 * Phase 1 keeps this minimal; Phase 4 will replace the local `events`
 * array with `queryClient.setQueryData` writes so order detail queries
 * stay in sync with live updates (per ZeroZero rule #10).
 */
export function useOrderSocket(orderId: string | null): OrderSocketSnapshot {
  const [snapshot, setSnapshot] = useState<OrderSocketSnapshot>({
    status: null,
    events: [],
    state: 'closed',
  });
  const wsRef = useRef<ReconnectingWS | null>(null);

  useEffect(() => {
    if (!orderId) return;
    const token = useAuthStore.getState().accessToken ?? undefined;

    const ws = new ReconnectingWS(`${env.WS_BASE_URL}/orders/${orderId}`, {
      ...(token ? { token } : {}),
      onOpen: () =>
        setSnapshot((s) => ({ ...s, state: 'open' })),
      onClose: () =>
        setSnapshot((s) => ({ ...s, state: 'closed' })),
      onError: () =>
        setSnapshot((s) => ({ ...s, state: 'reconnecting' })),
      onMessage: (raw) => {
        const msg = raw as OrderWsEvent;
        setSnapshot((s) => {
          const events = [...s.events, msg];
          const status = msg.type === 'status' ? msg.status : s.status;
          return { ...s, events, status };
        });
      },
    });
    wsRef.current = ws;

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [orderId]);

  return snapshot;
}
