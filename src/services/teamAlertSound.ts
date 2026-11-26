import { Task } from '../types';
import { formatTaskDateRangeLabel } from './lineCommandParser';

const SOUND_PREF_STORAGE_KEY = 'sheetcal_new_task_sound_v1';

export function readAlertSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_PREF_STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
  } catch {
    // Ignore storage error
  }
  return true;
}

export function saveAlertSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage error
  }
}

/**
 * Plays a gentle, executive 2-tone crystal chime (C6 -> E6) using Web Audio API.
 * Safe on all browsers & Smart TVs (silently no-ops if autoplay is locked).
 */
export function playExecutiveNewTaskChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const notes = [
      { freq: 1046.5, start: 0, dur: 0.22, gain: 0.065 }, // C6
      { freq: 1318.51, start: 0.14, dur: 0.34, gain: 0.075 }, // E6
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      amp.gain.setValueAtTime(0.0001, now + note.start);
      amp.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.025);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);

      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.03);
    }

    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        // Ignore close error
      }
    }, 900);
  } catch {
    // Ignore Web Audio restriction errors
  }
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function showBrowserNewTaskNotification(
  tasks: Task[],
  agencyName?: string
): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted' || tasks.length === 0) return;

  try {
    const first = tasks[0];
    const dateLabel = formatTaskDateRangeLabel(first, 'short');
    const title =
      tasks.length === 1
        ? `มีภารกิจใหม่เข้าตารางงาน${agencyName ? ` · ${agencyName}` : ''}`
        : `มีภารกิจใหม่เข้าตารางงาน ${tasks.length} รายการ`;
    const body =
      tasks.length === 1
        ? `${first.title}\n${dateLabel} เวลา ${first.time} น.${
            first.assigneeName ? ` · ผู้รับผิดชอบ: ${first.assigneeName}` : ''
          }`
        : `${first.title} (${dateLabel} ${first.time} น.) และอีก ${tasks.length - 1} รายการ`;

    const notif = new Notification(title, {
      body,
      tag: `lakha-new-task-${first.id}`,
      silent: false,
    });
    window.setTimeout(() => {
      try {
        notif.close();
      } catch {
        // Ignore
      }
    }, 10000);
  } catch {
    // Ignore notification errors in restricted iframes / TV browsers
  }
}
