import { OrganizationSettings } from '../types';

export const ORG_SETTINGS_STORAGE_KEY = 'sheetcal_org_settings_v1';
const ORG_BROADCAST_CHANNEL = 'sheetcal_org_settings_sync_v1';

export const DEFAULT_ORG_SETTINGS: OrganizationSettings = {
  appName: 'ระบบน้องเลขา',
  boardTitle: 'กำหนดการภารกิจของผู้อำนวยการ',
  agencyName: 'สำนักบริหารแรงงานต่างด้าว',
  departmentName: 'กรมการจัดหางาน',
  directorLabel: 'ผู้อำนวยการ',
  footerDescription:
    'ระบบปฏิทินตารางงานร่วมกันของทีม แจ้งเตือนผ่าน LINE OA, Telegram และฐานข้อมูล Google Sheets',
  updatedAt: '',
};

export function normalizeOrgSettings(
  raw?: Partial<OrganizationSettings> | null
): OrganizationSettings {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const cleanStr = (val: unknown, fallback: string, allowEmpty = false): string => {
    if (typeof val !== 'string') return fallback;
    const trimmed = val.trim();
    if (!trimmed && !allowEmpty) return fallback;
    return trimmed;
  };
  return {
    appName: cleanStr(safe.appName, DEFAULT_ORG_SETTINGS.appName),
    boardTitle: cleanStr(safe.boardTitle, DEFAULT_ORG_SETTINGS.boardTitle),
    agencyName: cleanStr(safe.agencyName, DEFAULT_ORG_SETTINGS.agencyName),
    departmentName: cleanStr(safe.departmentName, DEFAULT_ORG_SETTINGS.departmentName, true),
    directorLabel: cleanStr(safe.directorLabel, DEFAULT_ORG_SETTINGS.directorLabel),
    footerDescription: cleanStr(
      safe.footerDescription,
      DEFAULT_ORG_SETTINGS.footerDescription
    ),
    updatedAt: typeof safe.updatedAt === 'string' ? safe.updatedAt : '',
  };
}

export function readLocalOrgSettings(): OrganizationSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_ORG_SETTINGS };
  try {
    const raw = window.localStorage.getItem(ORG_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ORG_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<OrganizationSettings>;
    return normalizeOrgSettings(parsed);
  } catch {
    return { ...DEFAULT_ORG_SETTINGS };
  }
}

export function writeLocalOrgSettings(
  next: Partial<OrganizationSettings>,
  preserveTimestamp = false
): OrganizationSettings {
  const merged = normalizeOrgSettings({
    ...readLocalOrgSettings(),
    ...next,
    updatedAt:
      preserveTimestamp && typeof next.updatedAt === 'string' && next.updatedAt
        ? next.updatedAt
        : new Date().toISOString(),
  });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(ORG_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota errors
    }
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const ch = new BroadcastChannel(ORG_BROADCAST_CHANNEL);
        ch.postMessage({ type: 'org:updated', settings: merged });
        ch.close();
      }
    } catch {
      // Ignore BroadcastChannel errors
    }
  }
  return merged;
}

export function subscribeOrgSettingsBroadcast(
  onUpdate: (settings: OrganizationSettings) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const cleanups: Array<() => void> = [];

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(ORG_BROADCAST_CHANNEL);
      const handler = (ev: MessageEvent) => {
        if (ev.data?.type === 'org:updated' && ev.data?.settings) {
          onUpdate(normalizeOrgSettings(ev.data.settings));
        }
      };
      ch.addEventListener('message', handler);
      cleanups.push(() => {
        ch.removeEventListener('message', handler);
        ch.close();
      });
    }
  } catch {
    // Ignore
  }

  const onStorage = (ev: StorageEvent) => {
    if (ev.key === ORG_SETTINGS_STORAGE_KEY && ev.newValue) {
      try {
        onUpdate(normalizeOrgSettings(JSON.parse(ev.newValue)));
      } catch {
        // Ignore
      }
    }
  };
  window.addEventListener('storage', onStorage);
  cleanups.push(() => window.removeEventListener('storage', onStorage));

  return () => {
    cleanups.forEach((fn) => fn());
  };
}

export function formatOrgSubtitle(org: OrganizationSettings): string {
  const parts = [org.agencyName.trim(), org.departmentName.trim()].filter(Boolean);
  return parts.join(' · ') || DEFAULT_ORG_SETTINGS.agencyName;
}

export function buildDefaultTelegramHeader(org: OrganizationSettings): string {
  const agency = org.agencyName.trim() || DEFAULT_ORG_SETTINGS.agencyName;
  const app = org.appName.trim() || DEFAULT_ORG_SETTINGS.appName;
  return `${agency} · ${app}`;
}
