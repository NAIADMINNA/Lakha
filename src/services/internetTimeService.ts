// Precision Internet Time Synchronization Service (NTP-style RTT/2 offset + monotonic performance.now() clock)
// Ensures the Digital Clock and Schedule Board always display true Internet Time (Asia/Bangkok, UTC+7)
// even if a Smart TV, kiosk PC, or client device has an inaccurate internal system clock.

let syncedEpochMs: number | null = null;
let syncedPerfNow = 0;
let inFlightPromise: Promise<number | null> | null = null;
let autoSyncStarted = false;

const listeners = new Set<(epochMs: number) => void>();

function getMonotonicMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function recordSyncedEpoch(epochMs: number, perfAtReceive: number): void {
  if (!Number.isFinite(epochMs) || epochMs < 1_700_000_000_000) return;
  syncedEpochMs = epochMs;
  syncedPerfNow = perfAtReceive;
  listeners.forEach((cb) => {
    try {
      cb(epochMs);
    } catch {
      // Ignore listener errors
    }
  });
}

export function getInternetNowMs(): number {
  if (syncedEpochMs !== null) {
    return Math.round(syncedEpochMs + (getMonotonicMs() - syncedPerfNow));
  }
  return Date.now();
}

export function getInternetNow(): Date {
  return new Date(getInternetNowMs());
}

export function onInternetTimeSync(listener: (epochMs: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function fetchFromBackendTimeEndpoint(): Promise<{ epochMs: number; perfNow: number } | null> {
  const t0 = getMonotonicMs();
  const res = await fetch(`/api/time?_t=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3500),
  });
  const t1 = getMonotonicMs();
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  const data = (await res.json()) as { epochMs?: number };
  if (typeof data?.epochMs === 'number' && data.epochMs > 1_700_000_000_000) {
    const oneWayLatency = (t1 - t0) / 2;
    return { epochMs: data.epochMs + oneWayLatency, perfNow: t1 };
  }
  return null;
}

async function fetchFromTimeApiIo(): Promise<{ epochMs: number; perfNow: number } | null> {
  const t0 = getMonotonicMs();
  const res = await fetch(
    'https://timeapi.io/api/time/current/zone?timeZone=Asia%2FBangkok',
    {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    }
  );
  const t1 = getMonotonicMs();
  if (!res.ok) return null;
  const data = (await res.json()) as {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    seconds?: number;
    milliSeconds?: number;
  };
  if (
    typeof data.year === 'number' &&
    typeof data.month === 'number' &&
    typeof data.day === 'number' &&
    typeof data.hour === 'number' &&
    typeof data.minute === 'number' &&
    typeof data.seconds === 'number'
  ) {
    // Convert Asia/Bangkok (UTC+7) fields directly to exact UTC epoch milliseconds
    const utcMs = Date.UTC(
      data.year,
      data.month - 1,
      data.day,
      data.hour - 7,
      data.minute,
      data.seconds,
      typeof data.milliSeconds === 'number' ? data.milliSeconds : 0
    );
    const oneWayLatency = (t1 - t0) / 2;
    return { epochMs: utcMs + oneWayLatency, perfNow: t1 };
  }
  return null;
}

async function fetchFromCloudflareTrace(): Promise<{ epochMs: number; perfNow: number } | null> {
  const t0 = getMonotonicMs();
  const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
    cache: 'no-store',
    signal: AbortSignal.timeout(3500),
  });
  const t1 = getMonotonicMs();
  if (!res.ok) return null;
  const text = await res.text();
  const match = text.match(/^ts=(\d+(?:\.\d+)?)/m);
  if (match && match[1]) {
    const epochSec = parseFloat(match[1]);
    if (Number.isFinite(epochSec) && epochSec > 1_700_000_000) {
      const oneWayLatency = (t1 - t0) / 2;
      return { epochMs: epochSec * 1000 + oneWayLatency, perfNow: t1 };
    }
  }
  return null;
}

export function syncInternetTime(): Promise<number | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(Date.now());
  }
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    const providers = [
      fetchFromBackendTimeEndpoint,
      fetchFromTimeApiIo,
      fetchFromCloudflareTrace,
    ];

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result && Number.isFinite(result.epochMs)) {
          recordSyncedEpoch(result.epochMs, result.perfNow);
          return getInternetNowMs();
        }
      } catch {
        // Try next internet time provider
      }
    }
    return syncedEpochMs !== null ? getInternetNowMs() : null;
  })().finally(() => {
    inFlightPromise = null;
  });

  return inFlightPromise;
}

export function ensureInternetTimeAutoSync(): void {
  if (typeof window === 'undefined' || autoSyncStarted) return;
  autoSyncStarted = true;

  syncInternetTime().catch(() => {});

  // Periodically re-calibrate every 5 minutes to prevent any hardware crystal drift on 24/7 TVs
  window.setInterval(() => {
    syncInternetTime().catch(() => {});
  }, 5 * 60 * 1000);

  window.addEventListener('online', () => {
    syncInternetTime().catch(() => {});
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncInternetTime().catch(() => {});
    }
  });
}

if (typeof window !== 'undefined') {
  ensureInternetTimeAutoSync();
}
