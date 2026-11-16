import { Category, DirectorPresenceMode, DirectorPresenceState, Task, TeamMember } from '../types';

export const DIRECTOR_PRESENCE_STORAGE_KEY = 'sheetcal_director_presence_v1';
const BROADCAST_CHANNEL_NAME = 'sheetcal_realtime_tv_v1';
const LOCAL_SIGNAL_STORAGE_KEY = 'sheetcal_realtime_signal_v1';

const VALID_PRESENCE_MODES: DirectorPresenceMode[] = [
  'auto',
  'in_office',
  'in_meeting',
  'offsite',
  'unavailable',
];

const CLIENT_TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function getClientTabId(): string {
  return CLIENT_TAB_ID;
}

export interface RealtimeWorkspacePayload {
  workspaceId: string;
  updatedAt: string;
  updatedBy?: string;
  tasks: Task[];
  categories?: Category[];
  categoriesUpdatedAt?: number;
  teamMembers?: TeamMember[];
}

export type RealtimeSyncEvent =
  | {
      type: 'sync:init';
      source: 'ws' | 'broadcast' | 'storage';
      clientOriginId?: string;
      workspace?: RealtimeWorkspacePayload | null;
      presence?: DirectorPresenceState | null;
      deletedTaskIds?: string[];
      deletedCategoryIds?: string[];
    }
  | {
      type: 'workspace:updated';
      source: 'ws' | 'broadcast' | 'storage';
      clientOriginId?: string;
      workspace: RealtimeWorkspacePayload;
      deletedTaskIds?: string[];
      deletedCategoryIds?: string[];
    }
  | {
      type: 'presence:updated';
      source: 'ws' | 'broadcast' | 'storage' | 'gas';
      clientOriginId?: string;
      presence: DirectorPresenceState;
    }
  | {
      type: 'connection:status';
      connected: boolean;
    };

type RealtimeListener = (event: RealtimeSyncEvent) => void;

const listeners = new Set<RealtimeListener>();
let wsInstance: WebSocket | null = null;
let wsConnected = false;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let reconnectAttempt = 0;
let activeWorkspaceId = 'sheetcal-team-clean';
let initialized = false;
let broadcastChannel: BroadcastChannel | null = null;

export function sanitizeDirectorPresence(raw: unknown): DirectorPresenceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const mode = rec.mode as DirectorPresenceMode;
  if (!VALID_PRESENCE_MODES.includes(mode)) return null;
  return {
    mode,
    customNote: typeof rec.customNote === 'string' ? rec.customNote.slice(0, 160) : '',
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
  };
}

export function readLocalDirectorPresence(): DirectorPresenceState {
  try {
    const raw = window.localStorage.getItem(DIRECTOR_PRESENCE_STORAGE_KEY);
    if (raw) {
      const parsed = sanitizeDirectorPresence(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // Ignore storage read error
  }
  return { mode: 'auto', customNote: '', updatedAt: '' };
}

export function writeLocalDirectorPresence(nextState: DirectorPresenceState): void {
  try {
    window.localStorage.setItem(DIRECTOR_PRESENCE_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore storage write error
  }
}

function notifyListeners(event: RealtimeSyncEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Prevent single listener error from breaking other subscribers
    }
  });
}

export function emitRemotePresenceFromGas(rawPresence: unknown): void {
  const clean = sanitizeDirectorPresence(rawPresence);
  if (!clean || !clean.updatedAt) return;
  const current = readLocalDirectorPresence();
  const curMs = current.updatedAt ? new Date(current.updatedAt).getTime() : 0;
  const nextMs = new Date(clean.updatedAt).getTime();
  if (!Number.isFinite(nextMs) || nextMs <= curMs) return;
  writeLocalDirectorPresence(clean);
  notifyListeners({
    type: 'presence:updated',
    source: 'gas',
    presence: clean,
  });
}

function setWsConnected(next: boolean): void {
  if (wsConnected === next) return;
  wsConnected = next;
  notifyListeners({ type: 'connection:status', connected: next });
}

export function isRealtimeWebSocketConnected(): boolean {
  return wsConnected;
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || typeof window === 'undefined') return;
  // Avoid aggressive reconnect spam on pure static hosts (e.g. github.io) while still retrying gently
  const isStaticGithubHost = /\.github\.io$/i.test(window.location.hostname || '');
  if (isStaticGithubHost && reconnectAttempt >= 1) {
    return;
  }
  const delayMs = Math.min(8000, 1000 * Math.pow(1.6, reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delayMs);
}

function connectWebSocket(): void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (
    wsInstance &&
    (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  // Pure static hosts like github.io have no /api/collab/ws WebSocket server
  if (/\.github\.io$/i.test(window.location.hostname || '')) {
    setWsConnected(false);
    return;
  }

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/collab/ws?workspace=${encodeURIComponent(
      activeWorkspaceId
    )}&clientId=${encodeURIComponent(CLIENT_TAB_ID)}`;

    const socket = new WebSocket(wsUrl);
    wsInstance = socket;

    socket.onopen = () => {
      reconnectAttempt = 0;
      setWsConnected(true);
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      heartbeatTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(
              JSON.stringify({
                type: 'ping',
                workspaceId: activeWorkspaceId,
                clientOriginId: CLIENT_TAB_ID,
              })
            );
          } catch {
            // Ignore send error
          }
        }
      }, 22000);
    };

    socket.onmessage = (msgEvent) => {
      try {
        const parsed = JSON.parse(String(msgEvent.data || '{}')) as Record<string, unknown>;
        const msgType = String(parsed.type || '');
        const originId =
          typeof parsed.clientOriginId === 'string' ? parsed.clientOriginId : undefined;

        if (msgType === 'sync:init') {
          const presence = sanitizeDirectorPresence(parsed.presence);
          if (presence && presence.updatedAt) {
            writeLocalDirectorPresence(presence);
          }
          notifyListeners({
            type: 'sync:init',
            source: 'ws',
            clientOriginId: originId,
            workspace: (parsed.workspace as RealtimeWorkspacePayload) || null,
            presence,
            deletedTaskIds: Array.isArray(parsed.deletedTaskIds)
              ? (parsed.deletedTaskIds as string[])
              : undefined,
            deletedCategoryIds: Array.isArray(parsed.deletedCategoryIds)
              ? (parsed.deletedCategoryIds as string[])
              : undefined,
          });
        } else if (msgType === 'workspace:updated' && parsed.workspace) {
          notifyListeners({
            type: 'workspace:updated',
            source: 'ws',
            clientOriginId: originId,
            workspace: parsed.workspace as RealtimeWorkspacePayload,
            deletedTaskIds: Array.isArray(parsed.deletedTaskIds)
              ? (parsed.deletedTaskIds as string[])
              : undefined,
            deletedCategoryIds: Array.isArray(parsed.deletedCategoryIds)
              ? (parsed.deletedCategoryIds as string[])
              : undefined,
          });
        } else if (msgType === 'presence:updated' && parsed.presence) {
          const presence = sanitizeDirectorPresence(parsed.presence);
          if (presence) {
            if (originId !== CLIENT_TAB_ID) {
              writeLocalDirectorPresence(presence);
            }
            notifyListeners({
              type: 'presence:updated',
              source: 'ws',
              clientOriginId: originId,
              presence,
            });
          }
        }
      } catch {
        // Ignore malformed message
      }
    };

    socket.onclose = () => {
      if (wsInstance === socket) {
        wsInstance = null;
      }
      setWsConnected(false);
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // Ignore
      }
    };
  } catch {
    setWsConnected(false);
    scheduleReconnect();
  }
}

function ensureInitialized(workspaceId?: string): void {
  if (workspaceId && workspaceId.trim()) {
    activeWorkspaceId = workspaceId.trim();
  }
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // 1. Setup Same-Browser / Dual-Monitor HDMI BroadcastChannel (0ms latency across tabs/windows)
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannel.onmessage = (ev) => {
        const data = ev.data as Record<string, unknown> | null;
        if (!data || typeof data !== 'object') return;
        const originId = typeof data.clientOriginId === 'string' ? data.clientOriginId : '';
        if (originId === CLIENT_TAB_ID) return;

        if (data.type === 'workspace:updated' && data.workspace) {
          notifyListeners({
            type: 'workspace:updated',
            source: 'broadcast',
            clientOriginId: originId,
            workspace: data.workspace as RealtimeWorkspacePayload,
            deletedTaskIds: Array.isArray(data.deletedTaskIds)
              ? (data.deletedTaskIds as string[])
              : undefined,
            deletedCategoryIds: Array.isArray(data.deletedCategoryIds)
              ? (data.deletedCategoryIds as string[])
              : undefined,
          });
        } else if (data.type === 'presence:updated' && data.presence) {
          const presence = sanitizeDirectorPresence(data.presence);
          if (presence) {
            writeLocalDirectorPresence(presence);
            notifyListeners({
              type: 'presence:updated',
              source: 'broadcast',
              clientOriginId: originId,
              presence,
            });
          }
        }
      };
    } catch {
      broadcastChannel = null;
    }
  }

  // 2. Setup Cross-Window localStorage 'storage' event fallback (works even if BroadcastChannel is restricted)
  window.addEventListener('storage', (ev: StorageEvent) => {
    try {
      if (ev.key === DIRECTOR_PRESENCE_STORAGE_KEY && ev.newValue) {
        const presence = sanitizeDirectorPresence(JSON.parse(ev.newValue));
        if (presence) {
          notifyListeners({
            type: 'presence:updated',
            source: 'storage',
            presence,
          });
        }
      } else if (ev.key === LOCAL_SIGNAL_STORAGE_KEY && ev.newValue) {
        const signal = JSON.parse(ev.newValue) as Record<string, unknown>;
        if (!signal || signal.clientOriginId === CLIENT_TAB_ID) return;
        if (signal.type === 'workspace:updated' && signal.workspace) {
          notifyListeners({
            type: 'workspace:updated',
            source: 'storage',
            clientOriginId: String(signal.clientOriginId || ''),
            workspace: signal.workspace as RealtimeWorkspacePayload,
            deletedTaskIds: Array.isArray(signal.deletedTaskIds)
              ? (signal.deletedTaskIds as string[])
              : undefined,
            deletedCategoryIds: Array.isArray(signal.deletedCategoryIds)
              ? (signal.deletedCategoryIds as string[])
              : undefined,
          });
        }
      }
    } catch {
      // Ignore storage parse error
    }
  });

  // 3. Reconnect / Request fresh sync immediately when TV/window regains network or visibility
  const handleWakeUp = () => {
    if (!wsConnected) {
      reconnectAttempt = 0;
      connectWebSocket();
    } else if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
      try {
        wsInstance.send(
          JSON.stringify({
            type: 'request:sync',
            workspaceId: activeWorkspaceId,
            clientOriginId: CLIENT_TAB_ID,
          })
        );
      } catch {
        // Ignore
      }
    }
  };

  window.addEventListener('online', handleWakeUp);
  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleWakeUp();
    }
  });

  connectWebSocket();
}

export function subscribeRealtimeEvents(
  listener: RealtimeListener,
  workspaceId?: string
): () => void {
  ensureInitialized(workspaceId);
  listeners.add(listener);
  // Immediately inform subscriber of current WebSocket connection status
  listener({ type: 'connection:status', connected: wsConnected });
  return () => {
    listeners.delete(listener);
  };
}

export function broadcastLocalWorkspaceChange(params: {
  workspaceId: string;
  tasks: Task[];
  categories: Category[];
  categoriesUpdatedAt?: number;
  teamMembers: TeamMember[];
  deletedTaskIds?: string[];
  deletedCategoryIds?: string[];
}): void {
  ensureInitialized(params.workspaceId);
  const payload = {
    type: 'workspace:updated',
    clientOriginId: CLIENT_TAB_ID,
    workspace: {
      workspaceId: params.workspaceId,
      updatedAt: new Date().toISOString(),
      tasks: params.tasks,
      categories: params.categories,
      categoriesUpdatedAt: params.categoriesUpdatedAt,
      teamMembers: params.teamMembers,
    },
    deletedTaskIds: params.deletedTaskIds,
    deletedCategoryIds: params.deletedCategoryIds,
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch {
      // Ignore
    }
  }

  try {
    window.localStorage.setItem(
      LOCAL_SIGNAL_STORAGE_KEY,
      JSON.stringify({ ...payload, nonce: Math.random() })
    );
  } catch {
    // Ignore quota errors
  }
}

export function broadcastLocalPresenceChange(presence: DirectorPresenceState): void {
  ensureInitialized();
  writeLocalDirectorPresence(presence);
  const payload = {
    type: 'presence:updated',
    clientOriginId: CLIENT_TAB_ID,
    presence,
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch {
      // Ignore
    }
  }
}
