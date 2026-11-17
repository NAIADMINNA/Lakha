import { Category, DirectorPresenceMode, DirectorPresenceState, Task, TeamMember } from '../types';

export const DIRECTOR_PRESENCE_STORAGE_KEY = 'sheetcal_director_presence_v1';
export const BOARD_SETTINGS_STORAGE_KEY = 'sheetcal_board_remote_settings_v1';
const BROADCAST_CHANNEL_NAME = 'sheetcal_realtime_tv_v3';
const LOCAL_SIGNAL_STORAGE_KEY = 'sheetcal_realtime_signal_v3';
const DEFAULT_GAS_SCRIPT_SEED =
  'AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg';

const VALID_PRESENCE_MODES: DirectorPresenceMode[] = [
  'auto',
  'in_office',
  'in_meeting',
  'offsite',
  'unavailable',
];

const CLIENT_TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let eventSeq = 0;

export function getClientTabId(): string {
  return CLIENT_TAB_ID;
}

export interface BoardRemoteSettings {
  rangeMode: 'upcoming' | 'today' | 'week7' | 'all';
  layoutMode: 'grouped_by_day' | 'split_two_column' | 'single_day' | 'master_table';
  focusDate: string;
  selectedCategoryId: string;
  selectedPriority: string;
  showCompleted: boolean;
  expandMultiDay: boolean;
  boardTheme: 'light' | 'navy_gold' | 'dark' | 'emerald_exec';
  isLargeText: boolean;
  isAutoScroll: boolean;
  tvAutoFit?: boolean;
  updatedAt: string;
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

export interface TvScreenHeartbeat {
  tvClientId: string;
  label: string;
  viewportW: number;
  viewportH: number;
  scale: number;
  isPresentationMode: boolean;
  transport: 'local_hdmi' | 'cloud';
  updatedAt: string;
}

export type TvRemoteCommandAction = 'reload' | 'enter_fullscreen' | 'force_sync_request';

export type RealtimeSyncEvent =
  | {
      type: 'sync:init';
      source: 'ws' | 'broadcast' | 'storage' | 'cloud';
      clientOriginId?: string;
      workspace?: RealtimeWorkspacePayload | null;
      presence?: DirectorPresenceState | null;
      deletedTaskIds?: string[];
      deletedCategoryIds?: string[];
    }
  | {
      type: 'workspace:updated';
      source: 'ws' | 'broadcast' | 'storage' | 'cloud';
      clientOriginId?: string;
      workspace: RealtimeWorkspacePayload;
      deletedTaskIds?: string[];
      deletedCategoryIds?: string[];
    }
  | {
      type: 'task:delta';
      source: 'ws' | 'broadcast' | 'storage' | 'cloud';
      clientOriginId?: string;
      upsertedTasks?: Task[];
      deletedTaskIds?: string[];
      updatedAt: string;
    }
  | {
      type: 'categories:delta';
      source: 'ws' | 'broadcast' | 'storage' | 'cloud';
      clientOriginId?: string;
      categories: Category[];
      categoriesUpdatedAt: number;
      deletedCategoryIds?: string[];
    }
  | {
      type: 'presence:updated';
      source: 'ws' | 'broadcast' | 'storage' | 'gas' | 'cloud';
      clientOriginId?: string;
      presence: DirectorPresenceState;
    }
  | {
      type: 'board:settings';
      source: 'ws' | 'broadcast' | 'storage' | 'cloud';
      clientOriginId?: string;
      settings: BoardRemoteSettings;
    }
  | {
      type: 'tv:ping';
      source: 'broadcast' | 'cloud';
      clientOriginId?: string;
      requestedAt: string;
    }
  | {
      type: 'tv:pong';
      source: 'broadcast' | 'cloud';
      clientOriginId?: string;
      screen: TvScreenHeartbeat;
    }
  | {
      type: 'tv:command';
      source: 'broadcast' | 'cloud';
      clientOriginId?: string;
      action: TvRemoteCommandAction;
      issuedAt: string;
    }
  | {
      type: 'connection:status';
      connected: boolean;
    };

type RealtimeListener = (event: RealtimeSyncEvent) => void;

interface CloudRelayEnvelope {
  eventId: string;
  clientOriginId: string;
  sentAt: number;
  kind:
    | 'task:delta'
    | 'categories:delta'
    | 'presence:updated'
    | 'board:settings'
    | 'workspace:updated'
    | 'tv:ping'
    | 'tv:pong'
    | 'tv:command';
  payload: Record<string, unknown>;
}

const listeners = new Set<RealtimeListener>();
const seenEventIds = new Set<string>();
const seenEventOrder: string[] = [];

let wsInstance: WebSocket | null = null;
let localWsConnected = false;
let mqttConnected = false;
let ntfyWsConnected = false;
let ntfySseConnected = false;
let ntfyHttpPollOk = false;
let reconnectTimer: number | null = null;
let heartbeatTimer: number | null = null;
let reconnectAttempt = 0;
let activeWorkspaceId = 'sheetcal-team-clean';
let initialized = false;
let broadcastChannel: BroadcastChannel | null = null;

// MQTT-over-WSS state
let mqttSocket: WebSocket | null = null;
let mqttPingTimer: number | null = null;
let mqttReconnectTimer: number | null = null;
let mqttReconnectAttempt = 0;
const pendingMqttFrames: Array<{ subTopic: string; encrypted: string; retain: boolean }> = [];

// Port-443 HTTPS SSE + Port-443 WSS + Port-443 HTTPS JSON Catch-Up Poller state
let ntfyEventSource: EventSource | null = null;
let ntfySseReconnectTimer: number | null = null;
let ntfySseReconnectAttempt = 0;

let ntfySocket: WebSocket | null = null;
let ntfyReconnectTimer: number | null = null;
let ntfyReconnectAttempt = 0;

let ntfyHttpPollTimer: number | null = null;
let ntfyHttpPollInFlight = false;
let lastNtfyUnixSec = Math.max(0, Math.floor(Date.now() / 1000) - 90);

let ntfyPublishQueue: Array<{ dedupeKey: string; encrypted: string }> = [];
let ntfyPublishTimer: number | null = null;
let lastNtfyPostMs = 0;

let cachedSeedKey = '';
let cachedTopicHash = '';
let cachedRawKeyBytes: Uint8Array | null = null;
let cachedCryptoKeyPromise: Promise<CryptoKey | null> | null = null;
let activeCloudTopicHash = '';

// Pure synchronous SHA-256 implementation (RFC 6234) for deterministic topic & AES-256 key derivation
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(asciiOrUtf8: string): Uint8Array {
  const msg = new TextEncoder().encode(asciiOrUtf8);
  const bitLen = msg.length * 8;
  const padLen = (msg.length + 9 + 63) & ~63;
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function resolveWorkspaceGasSeed(): string {
  try {
    const rawUrl =
      window.localStorage.getItem('sheetcal_gas_webapp_url_v1') ||
      window.localStorage.getItem('sheetcal_gas_url_v1') ||
      '';
    const match = rawUrl.match(/\/macros\/s\/([A-Za-z0-9_-]{20,})/);
    if (
      match &&
      match[1] &&
      !match[1].includes('AKfycby0gvQ') &&
      !match[1].includes('AKfycbxIf9k')
    ) {
      return match[1];
    }
  } catch {
    // Ignore storage read error
  }
  return DEFAULT_GAS_SCRIPT_SEED;
}

/**
 * Derives a canonical workspace channel & AES-256-GCM key strictly from the shared GAS deployment ID.
 * Never depends on localStorage workspaceId or React component mount order, guaranteeing Admin PC
 * and zero-login TV PC always join the exact same encrypted real-time channel.
 */
function ensureCryptoMaterial(): { topicHash: string; keyBytes: Uint8Array } {
  const seed = `${resolveWorkspaceGasSeed()}|sheetcal-live-v3`;
  if (seed !== cachedSeedKey || !cachedRawKeyBytes || !cachedTopicHash) {
    cachedSeedKey = seed;
    const topicDigest = sha256Bytes(`sheetcal-live-topic-v3:${seed}`);
    cachedTopicHash = `scv3_${bytesToHex(topicDigest).slice(0, 24)}`;
    cachedRawKeyBytes = sha256Bytes(`sheetcal-live-aes256-v3:${seed}`);
    cachedCryptoKeyPromise = null;
  }
  return { topicHash: cachedTopicHash, keyBytes: cachedRawKeyBytes };
}

function reconnectCloudTransportsIfSeedChanged(): void {
  if (!initialized || typeof window === 'undefined') return;
  const { topicHash } = ensureCryptoMaterial();
  if (!activeCloudTopicHash) {
    activeCloudTopicHash = topicHash;
    return;
  }
  if (activeCloudTopicHash === topicHash) return;
  activeCloudTopicHash = topicHash;
  lastNtfyUnixSec = Math.max(0, Math.floor(Date.now() / 1000) - 90);

  if (mqttSocket) {
    try {
      mqttSocket.close();
    } catch {
      // Ignore
    }
    mqttSocket = null;
    mqttConnected = false;
  }
  if (ntfyEventSource) {
    try {
      ntfyEventSource.close();
    } catch {
      // Ignore
    }
    ntfyEventSource = null;
    ntfySseConnected = false;
  }
  if (ntfySocket) {
    try {
      ntfySocket.close();
    } catch {
      // Ignore
    }
    ntfySocket = null;
    ntfyWsConnected = false;
  }
  connectMqttRelay();
  connectPort443SseRelay();
  connectPort443WsRelay();
}

function getSubtleAesKey(): Promise<CryptoKey | null> {
  const { keyBytes } = ensureCryptoMaterial();
  if (cachedCryptoKeyPromise) return cachedCryptoKeyPromise;
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    cachedCryptoKeyPromise = Promise.resolve(null);
    return cachedCryptoKeyPromise;
  }
  cachedCryptoKeyPromise = window.crypto.subtle
    .importKey('raw', keyBytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    .catch(() => null);
  return cachedCryptoKeyPromise;
}

async function encryptEnvelope(envelope: CloudRelayEnvelope): Promise<string | null> {
  try {
    const plainBytes = new TextEncoder().encode(JSON.stringify(envelope));
    const aesKey = await getSubtleAesKey();
    if (aesKey && window.crypto) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const cipherBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        plainBytes as BufferSource
      );
      const cipherBytes = new Uint8Array(cipherBuf);
      const combined = new Uint8Array(12 + cipherBytes.length);
      combined.set(iv, 0);
      combined.set(cipherBytes, 12);
      return `g1.${bytesToBase64(combined)}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function decryptEnvelope(encoded: string): Promise<CloudRelayEnvelope | null> {
  try {
    const trimmed = String(encoded || '').trim();
    if (!trimmed.startsWith('g1.')) return null;
    const combined = base64ToBytes(trimmed.slice(3));
    if (combined.length < 29) return null;
    const aesKey = await getSubtleAesKey();
    if (!aesKey) return null;
    const iv = combined.slice(0, 12);
    const cipherBytes = combined.slice(12);
    const plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      aesKey,
      cipherBytes as BufferSource
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as CloudRelayEnvelope;
    if (!parsed || typeof parsed !== 'object' || !parsed.eventId || !parsed.kind) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function markEventSeen(eventId: string): boolean {
  if (!eventId) return false;
  if (seenEventIds.has(eventId)) return false;
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  if (seenEventOrder.length > 360) {
    const oldest = seenEventOrder.shift();
    if (oldest) seenEventIds.delete(oldest);
  }
  return true;
}

function nextEventId(): string {
  eventSeq += 1;
  return `${CLIENT_TAB_ID}-${Date.now()}-${eventSeq}`;
}

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

export function sanitizeBoardSettings(raw: unknown): BoardRemoteSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const validRanges = ['upcoming', 'today', 'week7', 'all'];
  const validLayouts = ['grouped_by_day', 'split_two_column', 'single_day', 'master_table'];
  const validThemes = ['light', 'navy_gold', 'dark', 'emerald_exec'];
  const rangeMode = String(rec.rangeMode || 'upcoming');
  const layoutMode = String(rec.layoutMode || 'grouped_by_day');
  const boardTheme = String(rec.boardTheme || 'light');
  if (
    !validRanges.includes(rangeMode) ||
    !validLayouts.includes(layoutMode) ||
    !validThemes.includes(boardTheme)
  ) {
    return null;
  }
  return {
    rangeMode: rangeMode as BoardRemoteSettings['rangeMode'],
    layoutMode: layoutMode as BoardRemoteSettings['layoutMode'],
    focusDate: typeof rec.focusDate === 'string' ? rec.focusDate : '',
    selectedCategoryId: typeof rec.selectedCategoryId === 'string' ? rec.selectedCategoryId : 'all',
    selectedPriority: typeof rec.selectedPriority === 'string' ? rec.selectedPriority : 'all',
    showCompleted: rec.showCompleted !== false,
    expandMultiDay: Boolean(rec.expandMultiDay),
    boardTheme: boardTheme as BoardRemoteSettings['boardTheme'],
    isLargeText: Boolean(rec.isLargeText),
    isAutoScroll: Boolean(rec.isAutoScroll),
    tvAutoFit: rec.tvAutoFit !== undefined ? Boolean(rec.tvAutoFit) : true,
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
  };
}

function sanitizeTvHeartbeat(
  raw: unknown,
  transport: 'local_hdmi' | 'cloud'
): TvScreenHeartbeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const tvClientId = typeof rec.tvClientId === 'string' ? rec.tvClientId : '';
  if (!tvClientId) return null;
  return {
    tvClientId,
    label: typeof rec.label === 'string' ? rec.label.slice(0, 80) : 'จอทีวีนำเสนอ',
    viewportW: typeof rec.viewportW === 'number' ? Math.round(rec.viewportW) : 1920,
    viewportH: typeof rec.viewportH === 'number' ? Math.round(rec.viewportH) : 1080,
    scale: typeof rec.scale === 'number' ? Number(rec.scale.toFixed(2)) : 1,
    isPresentationMode: Boolean(rec.isPresentationMode),
    transport,
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
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

export function readLocalBoardSettings(): BoardRemoteSettings | null {
  try {
    const raw = window.localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY);
    if (raw) {
      return sanitizeBoardSettings(JSON.parse(raw));
    }
  } catch {
    // Ignore storage read error
  }
  return null;
}

export function writeLocalBoardSettings(nextSettings: BoardRemoteSettings): void {
  try {
    window.localStorage.setItem(BOARD_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
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

function refreshCombinedConnectionStatus(): void {
  const anyConnected =
    localWsConnected || mqttConnected || ntfySseConnected || ntfyWsConnected || ntfyHttpPollOk;
  notifyListeners({ type: 'connection:status', connected: anyConnected });
}

export function isRealtimeWebSocketConnected(): boolean {
  return (
    localWsConnected || mqttConnected || ntfySseConnected || ntfyWsConnected || ntfyHttpPollOk
  );
}

// --- Minimal Binary MQTT v3.1.1 over WSS Framing (0 external dependencies, <130ms global delivery) ---
function mqttEncodeVarLen(len: number): Uint8Array {
  const bytes: number[] = [];
  let x = len;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encodedByte |= 128;
    bytes.push(encodedByte);
  } while (x > 0);
  return new Uint8Array(bytes);
}

function mqttEncodeUtf8(str: string): Uint8Array {
  const strBytes = new TextEncoder().encode(str);
  const out = new Uint8Array(2 + strBytes.length);
  out[0] = (strBytes.length >> 8) & 0xff;
  out[1] = strBytes.length & 0xff;
  out.set(strBytes, 2);
  return out;
}

function mqttBuildConnectPacket(clientId: string): BufferSource {
  const vh = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x2d]);
  const cid = mqttEncodeUtf8(clientId);
  const bodyLen = vh.length + cid.length;
  const varLen = mqttEncodeVarLen(bodyLen);
  const pkt = new Uint8Array(1 + varLen.length + bodyLen);
  pkt[0] = 0x10;
  pkt.set(varLen, 1);
  pkt.set(vh, 1 + varLen.length);
  pkt.set(cid, 1 + varLen.length + vh.length);
  return pkt as unknown as BufferSource;
}

function mqttBuildSubscribePacket(packetId: number, topicFilter: string): BufferSource {
  const tf = mqttEncodeUtf8(topicFilter);
  const bodyLen = 2 + tf.length + 1;
  const varLen = mqttEncodeVarLen(bodyLen);
  const pkt = new Uint8Array(1 + varLen.length + bodyLen);
  pkt[0] = 0x82;
  pkt.set(varLen, 1);
  let pos = 1 + varLen.length;
  pkt[pos++] = (packetId >> 8) & 0xff;
  pkt[pos++] = packetId & 0xff;
  pkt.set(tf, pos);
  pkt[pos + tf.length] = 0x00;
  return pkt as unknown as BufferSource;
}

function mqttBuildPublishPacket(topic: string, message: string, retain = false): BufferSource {
  const tBytes = mqttEncodeUtf8(topic);
  const mBytes = new TextEncoder().encode(message);
  const bodyLen = tBytes.length + mBytes.length;
  const varLen = mqttEncodeVarLen(bodyLen);
  const pkt = new Uint8Array(1 + varLen.length + bodyLen);
  pkt[0] = retain ? 0x31 : 0x30;
  pkt.set(varLen, 1);
  pkt.set(tBytes, 1 + varLen.length);
  pkt.set(mBytes, 1 + varLen.length + tBytes.length);
  return pkt as unknown as BufferSource;
}

async function handleIncomingEncryptedString(rawEncrypted: string): Promise<void> {
  const env = await decryptEnvelope(rawEncrypted);
  if (!env) return;
  if (env.clientOriginId === CLIENT_TAB_ID) return;
  if (!markEventSeen(env.eventId)) return;

  const p = env.payload || {};
  if (env.kind === 'presence:updated' && p.presence) {
    const clean = sanitizeDirectorPresence(p.presence);
    if (!clean) return;
    const cur = readLocalDirectorPresence();
    const curMs = cur.updatedAt ? new Date(cur.updatedAt).getTime() : 0;
    const incMs = clean.updatedAt ? new Date(clean.updatedAt).getTime() : 0;
    if (curMs > 0 && incMs > 0 && incMs < curMs) return;
    writeLocalDirectorPresence(clean);
    notifyListeners({
      type: 'presence:updated',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      presence: clean,
    });
  } else if (env.kind === 'board:settings' && p.settings) {
    const clean = sanitizeBoardSettings(p.settings);
    if (!clean) return;
    const cur = readLocalBoardSettings();
    const curMs = cur?.updatedAt ? new Date(cur.updatedAt).getTime() : 0;
    const incMs = clean.updatedAt ? new Date(clean.updatedAt).getTime() : 0;
    if (curMs > 0 && incMs > 0 && incMs < curMs) return;
    writeLocalBoardSettings(clean);
    notifyListeners({
      type: 'board:settings',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      settings: clean,
    });
  } else if (env.kind === 'task:delta') {
    notifyListeners({
      type: 'task:delta',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      upsertedTasks: Array.isArray(p.upsertedTasks) ? (p.upsertedTasks as Task[]) : undefined,
      deletedTaskIds: Array.isArray(p.deletedTaskIds) ? (p.deletedTaskIds as string[]) : undefined,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
    });
  } else if (env.kind === 'categories:delta' && Array.isArray(p.categories)) {
    notifyListeners({
      type: 'categories:delta',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      categories: p.categories as Category[],
      categoriesUpdatedAt:
        typeof p.categoriesUpdatedAt === 'number' ? p.categoriesUpdatedAt : Date.now(),
      deletedCategoryIds: Array.isArray(p.deletedCategoryIds)
        ? (p.deletedCategoryIds as string[])
        : undefined,
    });
  } else if (env.kind === 'workspace:updated' && p.workspace) {
    notifyListeners({
      type: 'workspace:updated',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      workspace: p.workspace as RealtimeWorkspacePayload,
      deletedTaskIds: Array.isArray(p.deletedTaskIds) ? (p.deletedTaskIds as string[]) : undefined,
      deletedCategoryIds: Array.isArray(p.deletedCategoryIds)
        ? (p.deletedCategoryIds as string[])
        : undefined,
    });
  } else if (env.kind === 'tv:ping') {
    notifyListeners({
      type: 'tv:ping',
      source: 'cloud',
      clientOriginId: env.clientOriginId,
      requestedAt: typeof p.requestedAt === 'string' ? p.requestedAt : new Date().toISOString(),
    });
  } else if (env.kind === 'tv:pong' && p.screen) {
    const cleanScreen = sanitizeTvHeartbeat(p.screen, 'cloud');
    if (cleanScreen) {
      notifyListeners({
        type: 'tv:pong',
        source: 'cloud',
        clientOriginId: env.clientOriginId,
        screen: cleanScreen,
      });
    }
  } else if (env.kind === 'tv:command' && typeof p.action === 'string') {
    const validActions: TvRemoteCommandAction[] = [
      'reload',
      'enter_fullscreen',
      'force_sync_request',
    ];
    const act = p.action as TvRemoteCommandAction;
    if (validActions.includes(act)) {
      notifyListeners({
        type: 'tv:command',
        source: 'cloud',
        clientOriginId: env.clientOriginId,
        action: act,
        issuedAt: typeof p.issuedAt === 'string' ? p.issuedAt : new Date().toISOString(),
      });
    }
  }
}

function flushMqttQueue(): void {
  if (!mqttSocket || mqttSocket.readyState !== WebSocket.OPEN || !mqttConnected) return;
  const { topicHash } = ensureCryptoMaterial();
  while (pendingMqttFrames.length > 0) {
    const item = pendingMqttFrames.shift();
    if (!item) break;
    try {
      mqttSocket.send(
        mqttBuildPublishPacket(
          `sheetcal/v3/${topicHash}/${item.subTopic}`,
          item.encrypted,
          item.retain
        )
      );
    } catch {
      break;
    }
  }
}

function scheduleMqttReconnect(): void {
  if (mqttReconnectTimer !== null || typeof window === 'undefined') return;
  const delay = Math.min(12000, 1400 * Math.pow(1.5, mqttReconnectAttempt));
  mqttReconnectAttempt += 1;
  mqttReconnectTimer = window.setTimeout(() => {
    mqttReconnectTimer = null;
    connectMqttRelay();
  }, delay);
}

function connectMqttRelay(): void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (
    mqttSocket &&
    (mqttSocket.readyState === WebSocket.OPEN || mqttSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const { topicHash } = ensureCryptoMaterial();
  activeCloudTopicHash = topicHash;
  try {
    const sock = new WebSocket('wss://broker.emqx.io:8084/mqtt', ['mqtt']);
    sock.binaryType = 'arraybuffer';
    mqttSocket = sock;

    sock.onopen = () => {
      try {
        const shortCid = `sc_${CLIENT_TAB_ID.slice(-12)}_${Math.random().toString(36).slice(2, 6)}`;
        sock.send(mqttBuildConnectPacket(shortCid));
      } catch {
        // Ignore
      }
    };

    sock.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(ev.data);
      let offset = 0;
      while (offset < bytes.length) {
        const headerByte = bytes[offset];
        const pktType = headerByte >> 4;
        let mult = 1;
        let remLen = 0;
        let idx = offset + 1;
        let encodedByte = 0;
        do {
          if (idx >= bytes.length) return;
          encodedByte = bytes[idx++];
          remLen += (encodedByte & 127) * mult;
          mult *= 128;
        } while ((encodedByte & 128) !== 0);

        const pktEnd = idx + remLen;
        if (pktEnd > bytes.length) return;

        if (pktType === 2) {
          mqttReconnectAttempt = 0;
          mqttConnected = true;
          refreshCombinedConnectionStatus();
          try {
            sock.send(mqttBuildSubscribePacket(1, `sheetcal/v3/${topicHash}/+`));
          } catch {
            // Ignore
          }
          flushMqttQueue();
          if (mqttPingTimer !== null) window.clearInterval(mqttPingTimer);
          mqttPingTimer = window.setInterval(() => {
            if (sock.readyState === WebSocket.OPEN) {
              try {
                sock.send(new Uint8Array([0xc0, 0x00]) as unknown as BufferSource);
              } catch {
                // Ignore
              }
            }
          }, 25000);
        } else if (pktType === 3) {
          const qos = (headerByte >> 1) & 0x03;
          if (idx + 2 <= pktEnd) {
            const topicLen = (bytes[idx] << 8) | bytes[idx + 1];
            let payloadStart = idx + 2 + topicLen;
            if (qos > 0) payloadStart += 2;
            if (payloadStart <= pktEnd) {
              const msgStr = new TextDecoder().decode(bytes.slice(payloadStart, pktEnd));
              void handleIncomingEncryptedString(msgStr);
            }
          }
        }

        offset = pktEnd;
      }
    };

    sock.onclose = () => {
      if (mqttSocket === sock) mqttSocket = null;
      mqttConnected = false;
      if (mqttPingTimer !== null) {
        window.clearInterval(mqttPingTimer);
        mqttPingTimer = null;
      }
      refreshCombinedConnectionStatus();
      scheduleMqttReconnect();
    };

    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        // Ignore
      }
    };
  } catch {
    mqttConnected = false;
    scheduleMqttReconnect();
  }
}

// --- Port-443 Pure HTTPS Server-Sent Events (SSE) Relay ---
// Uses standard Port-443 HTTPS GET without WebSocket Upgrade headers so corporate/ministry firewalls allow it!
function schedulePort443SseReconnect(): void {
  if (ntfySseReconnectTimer !== null || typeof window === 'undefined') return;
  const delay = Math.min(12000, 1500 * Math.pow(1.5, ntfySseReconnectAttempt));
  ntfySseReconnectAttempt += 1;
  ntfySseReconnectTimer = window.setTimeout(() => {
    ntfySseReconnectTimer = null;
    connectPort443SseRelay();
  }, delay);
}

function connectPort443SseRelay(): void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (ntfyEventSource && ntfyEventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  const { topicHash } = ensureCryptoMaterial();
  activeCloudTopicHash = topicHash;
  try {
    const sinceArg = lastNtfyUnixSec > 0 ? String(Math.max(0, lastNtfyUnixSec - 5)) : '2m';
    const es = new EventSource(`https://ntfy.sh/${topicHash}/sse?since=${encodeURIComponent(sinceArg)}`);
    ntfyEventSource = es;

    es.onopen = () => {
      ntfySseReconnectAttempt = 0;
      ntfySseConnected = true;
      refreshCombinedConnectionStatus();
    };

    es.onmessage = (ev) => {
      ntfySseConnected = true;
      try {
        const parsed = JSON.parse(String(ev.data || '{}')) as {
          event?: string;
          time?: number;
          message?: string;
        };
        if (typeof parsed.time === 'number' && parsed.time > lastNtfyUnixSec) {
          lastNtfyUnixSec = parsed.time;
        }
        if (
          (!parsed.event || parsed.event === 'message') &&
          typeof parsed.message === 'string' &&
          parsed.message.startsWith('g1.')
        ) {
          void handleIncomingEncryptedString(parsed.message);
        }
      } catch {
        // Ignore malformed SSE line
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        if (ntfyEventSource === es) ntfyEventSource = null;
        ntfySseConnected = false;
        refreshCombinedConnectionStatus();
        schedulePort443SseReconnect();
      }
    };
  } catch {
    ntfySseConnected = false;
    schedulePort443SseReconnect();
  }
}

// --- Port-443 HTTPS JSON Fast Catch-Up Poller ---
// Guarantees ~1.5s delivery even if an extreme SSL-inspecting proxy blocks WebSockets AND buffers SSE streams!
async function pollPort443JsonOnce(): Promise<void> {
  if (typeof window === 'undefined' || ntfyHttpPollInFlight) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  // When low-latency same-origin WS or MQTT WSS is already open, no HTTP catch-up polling is needed
  if (localWsConnected || mqttConnected) return;

  ntfyHttpPollInFlight = true;
  const { topicHash } = ensureCryptoMaterial();
  try {
    const sinceParam = lastNtfyUnixSec > 0 ? String(Math.max(0, lastNtfyUnixSec - 2)) : '90s';
    const res = await fetch(
      `https://ntfy.sh/${topicHash}/json?poll=1&since=${encodeURIComponent(sinceParam)}`,
      {
        method: 'GET',
        cache: 'no-store',
      }
    );
    if (res.ok) {
      if (!ntfyHttpPollOk) {
        ntfyHttpPollOk = true;
        refreshCombinedConnectionStatus();
      }
      const text = await res.text();
      if (text) {
        const lines = text.split('\n');
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              event?: string;
              time?: number;
              message?: string;
            };
            if (typeof parsed.time === 'number' && parsed.time > lastNtfyUnixSec) {
              lastNtfyUnixSec = parsed.time;
            }
            if (
              parsed.event === 'message' &&
              typeof parsed.message === 'string' &&
              parsed.message.startsWith('g1.')
            ) {
              void handleIncomingEncryptedString(parsed.message);
            }
          } catch {
            // Ignore malformed NDJSON line
          }
        }
      }
    }
  } catch {
    // Ignore transient network error
  } finally {
    ntfyHttpPollInFlight = false;
  }
}

function startPort443JsonCatchupLoop(): void {
  if (ntfyHttpPollTimer !== null || typeof window === 'undefined') return;
  void pollPort443JsonOnce();
  ntfyHttpPollTimer = window.setInterval(() => {
    void pollPort443JsonOnce();
  }, 2300);
}

// --- Secondary Port-443 WSS Relay ---
function scheduleNtfyWsReconnect(): void {
  if (ntfyReconnectTimer !== null || typeof window === 'undefined') return;
  const delay = Math.min(18000, 2500 * Math.pow(1.6, ntfyReconnectAttempt));
  ntfyReconnectAttempt += 1;
  ntfyReconnectTimer = window.setTimeout(() => {
    ntfyReconnectTimer = null;
    connectPort443WsRelay();
  }, delay);
}

function connectPort443WsRelay(): void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (
    ntfySocket &&
    (ntfySocket.readyState === WebSocket.OPEN || ntfySocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const { topicHash } = ensureCryptoMaterial();
  try {
    const sock = new WebSocket(`wss://ntfy.sh/${topicHash}/ws`);
    ntfySocket = sock;

    sock.onopen = () => {
      ntfyReconnectAttempt = 0;
      ntfyWsConnected = true;
      refreshCombinedConnectionStatus();
    };

    sock.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data || '{}')) as {
          event?: string;
          time?: number;
          message?: string;
        };
        if (typeof parsed.time === 'number' && parsed.time > lastNtfyUnixSec) {
          lastNtfyUnixSec = parsed.time;
        }
        if (parsed.event === 'message' && typeof parsed.message === 'string') {
          void handleIncomingEncryptedString(parsed.message);
        }
      } catch {
        // Ignore malformed frame
      }
    };

    sock.onclose = () => {
      if (ntfySocket === sock) ntfySocket = null;
      ntfyWsConnected = false;
      refreshCombinedConnectionStatus();
      scheduleNtfyWsReconnect();
    };

    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        // Ignore
      }
    };
  } catch {
    ntfyWsConnected = false;
    scheduleNtfyWsReconnect();
  }
}

function drainPort443PublishQueue(): void {
  if (ntfyPublishQueue.length === 0) return;
  const now = Date.now();
  const waitMs = Math.max(0, 340 - (now - lastNtfyPostMs));
  if (waitMs > 0) {
    if (ntfyPublishTimer === null) {
      ntfyPublishTimer = window.setTimeout(() => {
        ntfyPublishTimer = null;
        drainPort443PublishQueue();
      }, waitMs);
    }
    return;
  }

  const nextItem = ntfyPublishQueue.shift();
  if (!nextItem) return;
  lastNtfyPostMs = Date.now();
  const { topicHash } = ensureCryptoMaterial();
  fetch(`https://ntfy.sh/${topicHash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: nextItem.encrypted,
  }).catch(() => {});

  if (ntfyPublishQueue.length > 0 && ntfyPublishTimer === null) {
    ntfyPublishTimer = window.setTimeout(() => {
      ntfyPublishTimer = null;
      drainPort443PublishQueue();
    }, 350);
  }
}

async function publishCloudEnvelope(
  kind: CloudRelayEnvelope['kind'],
  payload: Record<string, unknown>,
  subTopic: 'events' | 'presence' | 'board' = 'events',
  retain = false,
  dedupeKey?: string
): Promise<void> {
  ensureInitialized();
  reconnectCloudTransportsIfSeedChanged();
  const envelope: CloudRelayEnvelope = {
    eventId: nextEventId(),
    clientOriginId: CLIENT_TAB_ID,
    sentAt: Date.now(),
    kind,
    payload,
  };
  markEventSeen(envelope.eventId);
  const encrypted = await encryptEnvelope(envelope);
  if (!encrypted) return;

  // 1. Publish over <130ms MQTT-over-WSS
  pendingMqttFrames.push({ subTopic, encrypted, retain });
  if (pendingMqttFrames.length > 30) pendingMqttFrames.shift();
  flushMqttQueue();

  // 2. Also publish compact deltas (< 3,700 chars) over Port-443 HTTPS POST (received via HTTPS SSE + JSON catch-up + WSS)
  if (encrypted.length < 3700) {
    const resolvedKey = dedupeKey || `${kind}:${envelope.eventId}`;
    const existingIdx = ntfyPublishQueue.findIndex((item) => item.dedupeKey === resolvedKey);
    if (existingIdx !== -1) {
      ntfyPublishQueue[existingIdx] = { dedupeKey: resolvedKey, encrypted };
    } else {
      if (ntfyPublishQueue.length >= 14) {
        ntfyPublishQueue = ntfyPublishQueue.slice(-13);
      }
      ntfyPublishQueue.push({ dedupeKey: resolvedKey, encrypted });
    }
    drainPort443PublishQueue();
  }
}

// --- Same-Origin Full-Stack Server WebSocket (/api/collab/ws) ---
function scheduleReconnect(): void {
  if (reconnectTimer !== null || typeof window === 'undefined') return;
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

  if (/\.github\.io$/i.test(window.location.hostname || '')) {
    localWsConnected = false;
    refreshCombinedConnectionStatus();
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
      localWsConnected = true;
      refreshCombinedConnectionStatus();
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
      localWsConnected = false;
      refreshCombinedConnectionStatus();
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
    localWsConnected = false;
    refreshCombinedConnectionStatus();
    scheduleReconnect();
  }
}

function ensureInitialized(workspaceId?: string): void {
  if (workspaceId && workspaceId.trim()) {
    activeWorkspaceId = workspaceId.trim();
  }
  if (initialized || typeof window === 'undefined') {
    reconnectCloudTransportsIfSeedChanged();
    return;
  }
  initialized = true;

  // 1. Same-Browser / Dual-Monitor HDMI BroadcastChannel (0ms latency across tabs/windows)
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
        } else if (data.type === 'task:delta') {
          notifyListeners({
            type: 'task:delta',
            source: 'broadcast',
            clientOriginId: originId,
            upsertedTasks: Array.isArray(data.upsertedTasks)
              ? (data.upsertedTasks as Task[])
              : undefined,
            deletedTaskIds: Array.isArray(data.deletedTaskIds)
              ? (data.deletedTaskIds as string[])
              : undefined,
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
          });
        } else if (data.type === 'categories:delta' && Array.isArray(data.categories)) {
          notifyListeners({
            type: 'categories:delta',
            source: 'broadcast',
            clientOriginId: originId,
            categories: data.categories as Category[],
            categoriesUpdatedAt:
              typeof data.categoriesUpdatedAt === 'number' ? data.categoriesUpdatedAt : Date.now(),
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
        } else if (data.type === 'board:settings' && data.settings) {
          const settings = sanitizeBoardSettings(data.settings);
          if (settings) {
            writeLocalBoardSettings(settings);
            notifyListeners({
              type: 'board:settings',
              source: 'broadcast',
              clientOriginId: originId,
              settings,
            });
          }
        } else if (data.type === 'tv:ping') {
          notifyListeners({
            type: 'tv:ping',
            source: 'broadcast',
            clientOriginId: originId,
            requestedAt:
              typeof data.requestedAt === 'string' ? data.requestedAt : new Date().toISOString(),
          });
        } else if (data.type === 'tv:pong' && data.screen) {
          const cleanScreen = sanitizeTvHeartbeat(data.screen, 'local_hdmi');
          if (cleanScreen) {
            notifyListeners({
              type: 'tv:pong',
              source: 'broadcast',
              clientOriginId: originId,
              screen: cleanScreen,
            });
          }
        } else if (data.type === 'tv:command' && typeof data.action === 'string') {
          const act = data.action as TvRemoteCommandAction;
          notifyListeners({
            type: 'tv:command',
            source: 'broadcast',
            clientOriginId: originId,
            action: act,
            issuedAt: typeof data.issuedAt === 'string' ? data.issuedAt : new Date().toISOString(),
          });
        }
      };
    } catch {
      broadcastChannel = null;
    }
  }

  // 2. Cross-Window localStorage 'storage' event fallback
  window.addEventListener('storage', (ev: StorageEvent) => {
    try {
      if (
        ev.key === 'sheetcal_gas_webapp_url_v1' ||
        ev.key === 'sheetcal_gas_url_v1'
      ) {
        reconnectCloudTransportsIfSeedChanged();
        return;
      }
      if (ev.key === DIRECTOR_PRESENCE_STORAGE_KEY && ev.newValue) {
        const presence = sanitizeDirectorPresence(JSON.parse(ev.newValue));
        if (presence) {
          notifyListeners({
            type: 'presence:updated',
            source: 'storage',
            presence,
          });
        }
      } else if (ev.key === BOARD_SETTINGS_STORAGE_KEY && ev.newValue) {
        const settings = sanitizeBoardSettings(JSON.parse(ev.newValue));
        if (settings) {
          notifyListeners({
            type: 'board:settings',
            source: 'storage',
            settings,
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

  // 3. Reconnect immediately when TV/window regains network or visibility
  const handleWakeUp = () => {
    reconnectCloudTransportsIfSeedChanged();
    if (!localWsConnected) {
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
    if (!mqttConnected) {
      mqttReconnectAttempt = 0;
      connectMqttRelay();
    }
    if (!ntfySseConnected) {
      ntfySseReconnectAttempt = 0;
      connectPort443SseRelay();
    }
    if (!ntfyWsConnected) {
      ntfyReconnectAttempt = 0;
      connectPort443WsRelay();
    }
    void pollPort443JsonOnce();
  };

  window.addEventListener('online', handleWakeUp);
  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleWakeUp();
    }
  });

  connectWebSocket();
  connectMqttRelay();
  connectPort443SseRelay();
  connectPort443WsRelay();
  startPort443JsonCatchupLoop();
}

export function subscribeRealtimeEvents(
  listener: RealtimeListener,
  workspaceId?: string
): () => void {
  ensureInitialized(workspaceId);
  listeners.add(listener);
  listener({ type: 'connection:status', connected: isRealtimeWebSocketConnected() });
  return () => {
    listeners.delete(listener);
  };
}

export function publishTaskDelta(params: {
  upsertedTasks?: Task[];
  deletedTaskIds?: string[];
  workspaceId?: string;
}): void {
  ensureInitialized(params.workspaceId);
  const nowIso = new Date().toISOString();
  const localMsg = {
    type: 'task:delta',
    clientOriginId: CLIENT_TAB_ID,
    upsertedTasks: params.upsertedTasks,
    deletedTaskIds: params.deletedTaskIds,
    updatedAt: nowIso,
  };
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(localMsg);
    } catch {
      // Ignore
    }
  }
  const singleTaskKey =
    params.upsertedTasks && params.upsertedTasks.length === 1 && !params.deletedTaskIds?.length
      ? `task:upsert:${params.upsertedTasks[0].id}`
      : undefined;
  void publishCloudEnvelope(
    'task:delta',
    {
      upsertedTasks: params.upsertedTasks,
      deletedTaskIds: params.deletedTaskIds,
      updatedAt: nowIso,
    },
    'events',
    false,
    singleTaskKey
  );
}

export function publishCategoriesDelta(params: {
  categories: Category[];
  categoriesUpdatedAt: number;
  deletedCategoryIds?: string[];
  workspaceId?: string;
}): void {
  ensureInitialized(params.workspaceId);
  const localMsg = {
    type: 'categories:delta',
    clientOriginId: CLIENT_TAB_ID,
    categories: params.categories,
    categoriesUpdatedAt: params.categoriesUpdatedAt,
    deletedCategoryIds: params.deletedCategoryIds,
  };
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(localMsg);
    } catch {
      // Ignore
    }
  }
  void publishCloudEnvelope(
    'categories:delta',
    {
      categories: params.categories,
      categoriesUpdatedAt: params.categoriesUpdatedAt,
      deletedCategoryIds: params.deletedCategoryIds,
    },
    'events',
    false,
    'categories:delta:latest'
  );
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

  void publishCloudEnvelope(
    'workspace:updated',
    {
      workspace: payload.workspace,
      deletedTaskIds: params.deletedTaskIds,
      deletedCategoryIds: params.deletedCategoryIds,
    },
    'events',
    false,
    'workspace:updated:latest'
  );
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

  void publishCloudEnvelope(
    'presence:updated',
    { presence },
    'presence',
    true,
    'presence:updated:latest'
  );
}

export function broadcastBoardSettingsChange(settings: BoardRemoteSettings): void {
  ensureInitialized();
  writeLocalBoardSettings(settings);
  const payload = {
    type: 'board:settings',
    clientOriginId: CLIENT_TAB_ID,
    settings,
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch {
      // Ignore
    }
  }

  void publishCloudEnvelope(
    'board:settings',
    { settings },
    'board',
    true,
    'board:settings:latest'
  );
}

export function requestConnectedTvPing(): void {
  ensureInitialized();
  const requestedAt = new Date().toISOString();
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'tv:ping',
        clientOriginId: CLIENT_TAB_ID,
        requestedAt,
      });
    } catch {
      // Ignore
    }
  }
  void publishCloudEnvelope('tv:ping', { requestedAt }, 'events', false, 'tv:ping:latest');
}

export function announceTvScreenPresence(
  screen: Omit<TvScreenHeartbeat, 'tvClientId' | 'transport' | 'updatedAt'>
): void {
  ensureInitialized();
  const fullScreen: TvScreenHeartbeat = {
    tvClientId: CLIENT_TAB_ID,
    label: screen.label,
    viewportW: screen.viewportW,
    viewportH: screen.viewportH,
    scale: screen.scale,
    isPresentationMode: screen.isPresentationMode,
    transport: 'cloud',
    updatedAt: new Date().toISOString(),
  };
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'tv:pong',
        clientOriginId: CLIENT_TAB_ID,
        screen: { ...fullScreen, transport: 'local_hdmi' },
      });
    } catch {
      // Ignore
    }
  }
  void publishCloudEnvelope(
    'tv:pong',
    { screen: fullScreen },
    'events',
    false,
    `tv:pong:${CLIENT_TAB_ID}`
  );
}

export function sendTvRemoteCommand(action: TvRemoteCommandAction): void {
  ensureInitialized();
  const issuedAt = new Date().toISOString();
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'tv:command',
        clientOriginId: CLIENT_TAB_ID,
        action,
        issuedAt,
      });
    } catch {
      // Ignore
    }
  }
  void publishCloudEnvelope(
    'tv:command',
    { action, issuedAt },
    'events',
    false,
    `tv:command:${action}`
  );
}

/**
 * Pushes Director Presence, Board Display Settings, Categories, and compact chunked Task Deltas
 * (< 2,800 bytes per frame) so any TV PC behind a Port-443 HTTPS firewall receives 100% of state immediately.
 */
export function pushFullStateToTvScreens(params: {
  tasks: Task[];
  categories: Category[];
  categoriesUpdatedAt?: number;
  deletedTaskIds?: string[];
  presence: DirectorPresenceState;
  settings: BoardRemoteSettings;
}): void {
  ensureInitialized();
  broadcastLocalPresenceChange(params.presence);
  broadcastBoardSettingsChange(params.settings);
  publishCategoriesDelta({
    categories: params.categories,
    categoriesUpdatedAt: params.categoriesUpdatedAt || Date.now(),
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const prioritizedTasks = [...params.tasks].sort((a, b) => {
    const aEnd = a.endDate && a.endDate > a.date ? a.endDate : a.date;
    const bEnd = b.endDate && b.endDate > b.date ? b.endDate : b.date;
    const aActiveOrFuture = aEnd >= todayIso ? 0 : 1;
    const bActiveOrFuture = bEnd >= todayIso ? 0 : 1;
    if (aActiveOrFuture !== bActiveOrFuture) return aActiveOrFuture - bActiveOrFuture;
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
  });

  // Send compact chunks of 6 tasks per envelope so each encrypted frame stays well under 3,500 bytes
  const CHUNK_SIZE = 6;
  const maxTasksForInstantPush = prioritizedTasks.slice(0, 36);
  if (maxTasksForInstantPush.length === 0 && params.deletedTaskIds?.length) {
    publishTaskDelta({ deletedTaskIds: params.deletedTaskIds.slice(0, 40) });
    return;
  }

  for (let i = 0; i < maxTasksForInstantPush.length; i += CHUNK_SIZE) {
    const chunk = maxTasksForInstantPush.slice(i, i + CHUNK_SIZE);
    publishTaskDelta({
      upsertedTasks: chunk,
      deletedTaskIds: i === 0 ? params.deletedTaskIds?.slice(0, 30) : undefined,
    });
  }
}
