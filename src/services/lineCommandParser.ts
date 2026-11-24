import { Category, LineMessageLog, LineSettings, Task, TaskPriority, TaskStatus, TeamMember } from '../types';
import { getInternetNow } from './internetTimeService';

export interface ParsedLineCommandResult {
  action: 'add_task' | 'complete_task' | 'delete_task' | 'query_today' | 'query_pending' | 'help';
  replyText: string;
  createdTask?: Task;
  targetTaskId?: string;
  targetTaskTitle?: string;
  flexSummary?: LineMessageLog['flexSummary'];
}

export const REMINDER_TIMING_OPTIONS: {
  minutes: number;
  label: string;
  shortLabel: string;
}[] = [
  { minutes: 1, label: 'เมื่อถึงเวลาที่กำหนดพอดี (ตรงเวลา)', shortLabel: 'ตรงเวลา' },
  { minutes: 5, label: 'ก่อนเริ่มงาน 5 นาที', shortLabel: '5 นาที' },
  { minutes: 15, label: 'ก่อนเริ่มงาน 15 นาที', shortLabel: '15 นาที' },
  { minutes: 30, label: 'ก่อนเริ่มงาน 30 นาที', shortLabel: '30 นาที' },
  { minutes: 60, label: 'ก่อนเริ่มงาน 1 ชั่วโมง', shortLabel: '1 ชั่วโมง' },
  { minutes: 180, label: 'ก่อนเริ่มงาน 3 ชั่วโมง', shortLabel: '3 ชั่วโมง' },
  { minutes: 1440, label: 'ล่วงหน้า 1 วัน (24 ชั่วโมง)', shortLabel: '1 วันก่อนเริ่ม' },
  { minutes: 2880, label: 'ล่วงหน้า 2 วัน (48 ชั่วโมง)', shortLabel: '2 วันก่อนเริ่ม' },
];

export function formatRemindMinutesLabel(minutes: number): string {
  if (minutes <= 0) return 'ไม่แจ้งเตือนอัตโนมัติ';
  if (minutes === 1) return 'เมื่อถึงเวลาที่กำหนดพอดี (ตรงเวลา)';
  if (minutes === 5) return '5 นาทีก่อนเริ่มงาน';
  if (minutes === 15) return '15 นาทีก่อนเริ่มงาน';
  if (minutes === 30) return '30 นาทีก่อนเริ่มงาน';
  if (minutes === 60) return '1 ชั่วโมงก่อนเริ่มงาน';
  if (minutes === 180) return '3 ชั่วโมงก่อนเริ่มงาน';
  if (minutes === 1440) return '1 วันก่อนเริ่มงาน (24 ชม.)';
  if (minutes === 2880) return '2 วันก่อนเริ่มงาน (48 ชม.)';
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return `${minutes / 1440} วันก่อนเริ่มงาน`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60} ชั่วโมงก่อนเริ่มงาน`;
  }
  return `${minutes} นาทีก่อนเริ่มงาน`;
}

export function renderCustomLineMessage(
  template: string,
  task: Task,
  categoryName: string,
  includeDescription = true,
  summaryStats?: { total: number; pending: number; completed: number }
): string {
  const priorityLabel =
    task.priority === TaskPriority.HIGH
      ? 'ความสำคัญสูง'
      : task.priority === TaskPriority.MEDIUM
      ? 'ความสำคัญปานกลาง'
      : 'ทั่วไป';
  const remindLabel = formatRemindMinutesLabel(task.remindMinutesBefore || 60);

  let rendered = (
    template ||
    '🔔 แจ้งเตือนงาน [{priority}]\n📌 {title}\n🗓️ วันที่ {date} เวลา {time} น.\n🗂️ หมวดหมู่: {category}\n⏳ แจ้งเตือนล่วงหน้า: {remindBefore}'
  )
    .replace(/\{title\}/g, task.title)
    .replace(/\{date\}/g, formatTaskDateRangeLabel(task))
    .replace(/\{time\}/g, task.time)
    .replace(/\{category\}/g, categoryName || 'ทั่วไป')
    .replace(/\{priority\}/g, priorityLabel)
    .replace(/\{remindBefore\}/g, remindLabel)
    .replace(/\{description\}/g, task.description || '-');

  if (
    includeDescription &&
    task.description &&
    !(template || '').includes('{description}')
  ) {
    rendered += `\n📝 รายละเอียด: ${task.description}`;
  }

  if (summaryStats) {
    rendered += `\n━━━━━━━━━━━━━━\n📊 สรุปตารางงาน: ทั้งหมด ${summaryStats.total} งาน (รอทำ ${summaryStats.pending} · เสร็จแล้ว ${summaryStats.completed})`;
  }
  return rendered.trim();
}

export function doesTaskTriggerNotification(
  task: Task,
  settings: LineSettings
): { allowed: boolean; reason?: string } {
  if (task.status === TaskStatus.COMPLETED) {
    return {
      allowed: false,
      reason: `สถานะงาน "${task.status}" ดำเนินการเสร็จสิ้นแล้ว`,
    };
  }

  // If the task explicitly has automatic reminder minutes configured (> 0), always allow it to notify
  if (typeof task.remindMinutesBefore === 'number' && task.remindMinutesBefore > 0) {
    return { allowed: true };
  }

  const allowedStatuses =
    Array.isArray(settings.triggerStatuses) && settings.triggerStatuses.length > 0
      ? settings.triggerStatuses
      : [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
  if (!allowedStatuses.includes(task.status)) {
    return {
      allowed: false,
      reason: `สถานะงาน "${task.status}" ไม่อยู่ในเกณฑ์ที่เปิดแจ้งเตือน`,
    };
  }

  return { allowed: true };
}

/**
 * Returns YYYY-MM-DD in Thailand timezone (Asia/Bangkok) so both server-side
 * LINE Webhooks and client-side browsers always resolve the exact same date.
 */
export function formatLocalDateYMD(date: Date = getInternetNow()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) {
      return `${y}-${m}-${d}`;
    }
  } catch {
    // Fallback
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLocalTimeHM(date: Date = getInternetNow()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hh = parts.find((p) => p.type === 'hour')?.value;
    const mm = parts.find((p) => p.type === 'minute')?.value;
    if (hh && mm) {
      return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    }
  } catch {
    // Fallback
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function getBangkokDateObject(offsetDays = 0): Date {
  const todayYMD = formatLocalDateYMD(new Date());
  const [y, m, d] = todayYMD.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  if (offsetDays !== 0) {
    dt.setDate(dt.getDate() + offsetDays);
  }
  return dt;
}

function formatPlainDateObjYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeYear(rawYear: number): number {
  if (rawYear >= 2400) {
    return rawYear - 543;
  }
  if (rawYear < 100) {
    if (rawYear >= 60) {
      return 2500 + rawYear - 543;
    }
    return 2000 + rawYear;
  }
  return rawYear;
}

const THAI_MONTH_ALIASES: { monthIndex: number; patterns: string[] }[] = [
  { monthIndex: 1, patterns: ['มกราคม', 'ม.ค.', 'มค'] },
  { monthIndex: 2, patterns: ['กุมภาพันธ์', 'กุมภา', 'ก.พ.', 'กพ'] },
  { monthIndex: 3, patterns: ['มีนาคม', 'มีนา', 'มี.ค.', 'มีค'] },
  { monthIndex: 4, patterns: ['เมษายน', 'เมษา', 'เม.ย.', 'เมย'] },
  { monthIndex: 5, patterns: ['พฤษภาคม', 'พฤษภา', 'พ.ค.', 'พค'] },
  { monthIndex: 6, patterns: ['มิถุนายน', 'มิถุนา', 'มิ.ย.', 'มิย'] },
  { monthIndex: 7, patterns: ['กรกฎาคม', 'กรกฎา', 'ก.ค.', 'กค'] },
  { monthIndex: 8, patterns: ['สิงหาคม', 'สิงหา', 'ส.ค.', 'สค'] },
  { monthIndex: 9, patterns: ['กันยายน', 'กันยา', 'ก.ย.', 'กย'] },
  { monthIndex: 10, patterns: ['ตุลาคม', 'ตุลา', 'ต.ค.', 'ตค'] },
  { monthIndex: 11, patterns: ['พฤศจิกายน', 'พฤศจิกา', 'พ.ย.', 'พย'] },
  { monthIndex: 12, patterns: ['ธันวาคม', 'ธันวา', 'ธ.ค.', 'ธค'] },
];

const THAI_WEEKDAYS: { dayOfWeek: number; patterns: string[] }[] = [
  { dayOfWeek: 0, patterns: ['วันอาทิตย์', 'อาทิตย์นี้'] },
  { dayOfWeek: 1, patterns: ['วันจันทร์', 'จันทร์นี้', 'จันทร์หน้า'] },
  { dayOfWeek: 2, patterns: ['วันอังคาร', 'อังคารนี้', 'อังคารหน้า'] },
  { dayOfWeek: 3, patterns: ['วันพุธ', 'พุธนี้', 'พุธหน้า'] },
  { dayOfWeek: 4, patterns: ['วันพฤหัสบดี', 'วันพฤหัส', 'พฤหัสนี้', 'พฤหัสหน้า'] },
  { dayOfWeek: 5, patterns: ['วันศุกร์', 'ศุกร์นี้', 'ศุกร์หน้า'] },
  { dayOfWeek: 6, patterns: ['วันเสาร์', 'เสาร์นี้', 'เสาร์หน้า'] },
];

export function isTaskActiveOnDate(
  task: Pick<Task, 'date' | 'endDate'>,
  targetDateStr: string
): boolean {
  if (!task.date || !targetDateStr) return false;
  if (task.endDate && task.endDate > task.date) {
    return targetDateStr >= task.date && targetDateStr <= task.endDate;
  }
  return task.date === targetDateStr;
}

export function getTaskDurationDays(startDate: string, endDate?: string): number {
  if (!endDate || endDate <= startDate) return 1;
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
  const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
}

const THAI_MONTH_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const THAI_MONTH_LONG = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

/**
 * Formats a YYYY-MM-DD string (e.g. "2026-11-04") into Thai Buddhist Era format:
 * - style = 'short' (default): "4 พ.ย. 2569"
 * - style = 'long': "4 พฤศจิกายน 2569"
 */
export function formatThaiDateDisplay(
  ymd: string | undefined | null,
  style: 'short' | 'long' = 'short'
): string {
  const raw = String(ymd || '').trim();
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return raw;
  const yearNum = parseInt(match[1], 10);
  const monthNum = parseInt(match[2], 10);
  const dayNum = parseInt(match[3], 10);
  if (isNaN(yearNum) || isNaN(monthNum) || isNaN(dayNum) || monthNum < 1 || monthNum > 12) {
    return raw;
  }
  const beYear = yearNum >= 2400 ? yearNum : yearNum + 543;
  const monthLabel =
    style === 'long' ? THAI_MONTH_LONG[monthNum - 1] : THAI_MONTH_SHORT[monthNum - 1];
  return `${dayNum} ${monthLabel} ${beYear}`;
}

export function formatTaskDateRangeLabel(
  task: Pick<Task, 'date' | 'endDate'>,
  style: 'short' | 'long' = 'short'
): string {
  if (task.endDate && task.endDate > task.date) {
    const days = getTaskDurationDays(task.date, task.endDate);
    const startMatch = String(task.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const endMatch = String(task.endDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (startMatch && endMatch) {
      const sY = parseInt(startMatch[1], 10);
      const sM = parseInt(startMatch[2], 10);
      const sD = parseInt(startMatch[3], 10);
      const eY = parseInt(endMatch[1], 10);
      const eM = parseInt(endMatch[2], 10);
      const eD = parseInt(endMatch[3], 10);
      if (sY === eY && sM === eM && sM >= 1 && sM <= 12) {
        const beYear = sY >= 2400 ? sY : sY + 543;
        const monthLabel =
          style === 'long' ? THAI_MONTH_LONG[sM - 1] : THAI_MONTH_SHORT[sM - 1];
        return style === 'long'
          ? `${sD} - ${eD} ${monthLabel} ${beYear} (รวม ${days} วัน)`
          : `${sD} - ${eD} ${monthLabel} ${beYear} (${days} วัน)`;
      }
    }
    return style === 'long'
      ? `${formatThaiDateDisplay(task.date, 'long')} - ${formatThaiDateDisplay(
          task.endDate,
          'long'
        )} (รวม ${days} วัน)`
      : `${formatThaiDateDisplay(task.date, 'short')} - ${formatThaiDateDisplay(
          task.endDate,
          'short'
        )} (${days} วัน)`;
  }
  return formatThaiDateDisplay(task.date, style);
}

function addDaysToYMD(ymd: string, daysToAdd: number): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + daysToAdd);
  return formatPlainDateObjYMD(dt);
}

export function inferTaskEndDate(
  task: Pick<Task, 'date' | 'endDate' | 'title' | 'description'>
): string | undefined {
  if (task.endDate && task.endDate > task.date) {
    return task.endDate;
  }
  const combinedText = `${task.title || ''} ${task.description || ''}`;
  const durationMatch = combinedText.match(
    /(?:(?<!อีก\s*)(?:เป็นเวลา|ระยะเวลา|จำนวน|รวม|ตลอด)\s*(\d{1,2})\s*วัน|(?<!อีก\s*)(?<!วันที่\s*)(\d{1,2})\s*วัน(?:\s*เต็ม)?)/i
  );
  if (durationMatch && !/อีก\s*\d+\s*วัน/.test(durationMatch[0])) {
    const parsedDays = parseInt(durationMatch[1] || durationMatch[2], 10);
    if (parsedDays >= 2 && parsedDays <= 60 && /^\d{4}-\d{2}-\d{2}$/.test(task.date)) {
      return addDaysToYMD(task.date, parsedDays - 1);
    }
  }
  const rangeMatch = combinedText.match(
    /(?:ระหว่าง\s*)?(?:วันที่\s*)?(\d{1,2})\s*(?:-|–|—|ถึง)\s*(?:วันที่\s*)?(\d{1,2})/
  );
  if (rangeMatch && /^\d{4}-\d{2}-\d{2}$/.test(task.date)) {
    const d1 = parseInt(rangeMatch[1], 10);
    const d2 = parseInt(rangeMatch[2], 10);
    const startDay = parseInt(task.date.slice(8, 10), 10);
    if (d1 === startDay && d2 > d1 && d2 - d1 <= 60) {
      return addDaysToYMD(task.date, d2 - d1);
    }
  }
  return undefined;
}

/**
 * Consolidates continuous multi-day tasks (both single tasks with endDate > date and
 * consecutive/overlapping tasks with identical title & category) into 1 unified task entry.
 */
export function consolidateContinuousTasks(tasks: Task[]): Task[] {
  const normalized = tasks.map((t) => {
    const inferredEnd = inferTaskEndDate(t);
    return inferredEnd && (!t.endDate || inferredEnd > t.endDate)
      ? { ...t, endDate: inferredEnd }
      : t;
  });

  const sorted = [...normalized].sort((a, b) =>
    `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`)
  );

  const consolidated: Task[] = [];
  for (const task of sorted) {
    const normTitle = String(task.title || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const existing = consolidated.find((prev) => {
      const prevTitle = String(prev.title || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
      if (!normTitle || prevTitle !== normTitle || prev.categoryId !== task.categoryId) {
        return false;
      }
      const prevEnd = prev.endDate && prev.endDate > prev.date ? prev.endDate : prev.date;
      const nextDayAfterPrev = addDaysToYMD(prevEnd, 1);
      return task.date >= prev.date && task.date <= nextDayAfterPrev;
    });

    if (existing) {
      const prevEnd =
        existing.endDate && existing.endDate > existing.date ? existing.endDate : existing.date;
      const currEnd = task.endDate && task.endDate > task.date ? task.endDate : task.date;
      if (currEnd > prevEnd) {
        existing.endDate = currEnd;
      }
    } else {
      consolidated.push({ ...task });
    }
  }

  return consolidated;
}

/**
 * Formats the Header Date of a Summary Card ("หัวการ์ดสรุปงาน"):
 * - If the card's task(s) span a continuous multi-day range (e.g. 9 - 12 Nov), summarizes into a single range:
 *   "วันที่ 9 - 12 พฤศจิกายน 2569 (รวม 4 วัน)"
 * - Otherwise formats as full Thai weekday + date:
 *   "วันศุกร์ที่ 6 พฤศจิกายน 2569"
 */
export function formatSummaryCardHeaderDate(
  targetDate: string,
  tasksOnCard?: Array<{
    date?: string;
    endDate?: string;
    title?: string;
    description?: string;
  }>
): string {
  const thaiDays = [
    'วันอาทิตย์ที่',
    'วันจันทร์ที่',
    'วันอังคารที่',
    'วันพุธที่',
    'วันพฤหัสบดีที่',
    'วันศุกร์ที่',
    'วันเสาร์ที่',
  ];

  const cleanYmd = String(targetDate || '').slice(0, 10);
  const list = Array.isArray(tasksOnCard) ? tasksOnCard : [];
  if (list.length > 0) {
    let uniformStart = '';
    let uniformEnd = '';
    let allSameMultiDayRange = true;
    let validCount = 0;

    for (const item of list) {
      const s = String(item.date || cleanYmd || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
      const inferredEnd = inferTaskEndDate({
        date: s,
        endDate: item.endDate ? String(item.endDate).slice(0, 10) : undefined,
        title: item.title || '',
        description: item.description || '',
      });
      const e = inferredEnd && inferredEnd > s ? inferredEnd : s;
      validCount++;

      if (validCount === 1) {
        uniformStart = s;
        uniformEnd = e;
        if (e <= s) {
          allSameMultiDayRange = false;
        }
      } else if (s !== uniformStart || e !== uniformEnd) {
        allSameMultiDayRange = false;
      }
    }

    if (
      validCount > 0 &&
      allSameMultiDayRange &&
      uniformEnd > uniformStart &&
      (!cleanYmd || uniformStart === cleanYmd)
    ) {
      return `วันที่ ${formatTaskDateRangeLabel(
        { date: uniformStart, endDate: uniformEnd },
        'long'
      )}`;
    }
  }

  const parts = cleanYmd.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return `${thaiDays[dt.getDay()] || 'วันที่'} ${formatThaiDateDisplay(cleanYmd, 'long')}`;
  }
  return formatThaiDateDisplay(cleanYmd, 'long');
}

export interface PriorityHeaderTheme {
  priorityKey: 'high' | 'medium' | 'low';
  headerBg: string;
  headerStripBg: string;
  badgeBg: string;
  badgeText: string;
  badgeLabel: string;
  shortLabel: string;
  borderAccent: string;
}

/**
 * Returns the executive header color theme based on task priority ("หัวตารางเน้นสีตามความสำคัญของงาน"):
 * - high (ด่วนมาก / สำคัญสูง): Deep Crimson Red (#B91C1C)
 * - medium (ความสำคัญปานกลาง): Rich Amber-Gold (#D97706)
 * - low (ทั่วไป / ตามกำหนดการ): Deep Emerald-Teal (#0F766E)
 */
export function getPriorityHeaderTheme(
  priority?: string,
  priorityLabelHint?: string
): PriorityHeaderTheme {
  const p = String(priority || '').toLowerCase();
  const hint = String(priorityLabelHint || '').toLowerCase();
  if (
    p === 'high' ||
    hint.includes('สูง') ||
    hint.includes('ด่วน') ||
    hint.includes('high')
  ) {
    return {
      priorityKey: 'high',
      headerBg: '#B91C1C',
      headerStripBg: '#991B1B',
      badgeBg: '#FEF2F2',
      badgeText: '#991B1B',
      badgeLabel: '🔥 ด่วนมาก • ความสำคัญสูง',
      shortLabel: 'ความสำคัญสูง (ด่วนมาก)',
      borderAccent: '#FCA5A5',
    };
  }
  if (p === 'low' || hint.includes('ทั่วไป') || hint.includes('ต่ำ') || hint.includes('low')) {
    return {
      priorityKey: 'low',
      headerBg: '#0F766E',
      headerStripBg: '#115E59',
      badgeBg: '#F0FDFA',
      badgeText: '#115E59',
      badgeLabel: '📌 งานทั่วไป • ตามกำหนดการ',
      shortLabel: 'ความสำคัญทั่วไป',
      borderAccent: '#99F6E4',
    };
  }
  return {
    priorityKey: 'medium',
    headerBg: '#D97706',
    headerStripBg: '#B45309',
    badgeBg: '#FFFBEB',
    badgeText: '#92400E',
    badgeLabel: '⚡ ความสำคัญปานกลาง',
    shortLabel: 'ความสำคัญปานกลาง',
    borderAccent: '#FDE68A',
  };
}

export function extractThaiDate(input: string): {
  dateStr: string;
  endDateStr?: string;
  cleanedText: string;
} {
  let text = input;
  const nowBangkok = getBangkokDateObject(0);
  const todayStr = formatPlainDateObjYMD(nowBangkok);

  // Extract optional multi-day duration phrase e.g. "จำนวน 3 วัน", "เป็นเวลา 4 วัน", "ระยะเวลา 2 วัน", "3 วัน" (when not "อีก 3 วัน")
  let durationDays = 1;
  const durationMatch = text.match(
    /(?:(?<!อีก\s*)(?:เป็นเวลา|ระยะเวลา|จำนวน|รวม|ตลอด)\s*(\d{1,2})\s*วัน|(?<!อีก\s*)(?<!วันที่\s*)(\d{1,2})\s*วัน(?:\s*เต็ม)?)/i
  );
  if (durationMatch && !/อีก\s*\d+\s*วัน/.test(durationMatch[0])) {
    const parsedDays = parseInt(durationMatch[1] || durationMatch[2], 10);
    if (parsedDays >= 2 && parsedDays <= 60) {
      durationDays = parsedDays;
      text = text.replace(durationMatch[0], ' ');
    }
  }

  const finalizeResult = (startStr: string, explicitEndStr?: string, cleaned = text) => {
    let finalEnd = explicitEndStr;
    if (!finalEnd && durationDays > 1) {
      finalEnd = addDaysToYMD(startStr, durationDays - 1);
    }
    if (finalEnd && finalEnd <= startStr) {
      finalEnd = undefined;
    }
    return {
      dateStr: startStr,
      endDateStr: finalEnd,
      cleanedText: cleaned,
    };
  };

  // 0A. Check YYYY-MM-DD range: "2026-11-05 ถึง 2026-11-07" or "2026-11-05 - 2026-11-07"
  const isoRangeMatch = text.match(
    /(?:วันที่\s*)?(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:ถึง|-|–|~)\s*(?:วันที่\s*)?(\d{4})-(\d{1,2})-(\d{1,2})/
  );
  if (isoRangeMatch) {
    const y1 = normalizeYear(parseInt(isoRangeMatch[1], 10));
    const m1 = String(Math.min(12, Math.max(1, parseInt(isoRangeMatch[2], 10)))).padStart(2, '0');
    const d1 = String(Math.min(31, Math.max(1, parseInt(isoRangeMatch[3], 10)))).padStart(2, '0');
    const y2 = normalizeYear(parseInt(isoRangeMatch[4], 10));
    const m2 = String(Math.min(12, Math.max(1, parseInt(isoRangeMatch[5], 10)))).padStart(2, '0');
    const d2 = String(Math.min(31, Math.max(1, parseInt(isoRangeMatch[6], 10)))).padStart(2, '0');
    text = text.replace(isoRangeMatch[0], ' ');
    return finalizeResult(`${y1}-${m1}-${d1}`, `${y2}-${m2}-${d2}`, text);
  }

  // 0B. Check Thai month range in same month: e.g. "วันที่ 5 - 7 พ.ย. 69" or "5 ถึง 7 พฤศจิกายน"
  for (const monthEntry of THAI_MONTH_ALIASES) {
    for (const pat of monthEntry.patterns) {
      const escapedPat = pat.replace(/\./g, '\\.');
      const rangeRegex = new RegExp(
        `(?:วันที่\\s*)?(\\d{1,2})\\s*(?:ถึง|-|–|~)\\s*(\\d{1,2})\\s*${escapedPat}(?:\\s*(\\d{2,4}))?`,
        'i'
      );
      const rMatch = text.match(rangeRegex);
      if (rMatch) {
        const d1Num = Math.min(31, Math.max(1, parseInt(rMatch[1], 10)));
        const d2Num = Math.min(31, Math.max(1, parseInt(rMatch[2], 10)));
        const y = rMatch[3]
          ? normalizeYear(parseInt(rMatch[3], 10))
          : nowBangkok.getFullYear();
        const m = String(monthEntry.monthIndex).padStart(2, '0');
        const d1 = String(d1Num).padStart(2, '0');
        const d2 = String(d2Num).padStart(2, '0');
        text = text.replace(rMatch[0], ' ');
        return finalizeResult(`${y}-${m}-${d1}`, `${y}-${m}-${d2}`, text);
      }
    }
  }

  // 0C. Check DD/MM/YYYY range: e.g. "5/11/69 - 7/11/69" or "5/11 ถึง 7/11"
  const slashRangeMatch = text.match(
    /(?:วันที่\s*)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*(?:ถึง|-|–|~)\s*(?:วันที่\s*)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/
  );
  if (slashRangeMatch) {
    const d1Num = parseInt(slashRangeMatch[1], 10);
    const m1Num = parseInt(slashRangeMatch[2], 10);
    const d2Num = parseInt(slashRangeMatch[4], 10);
    const m2Num = parseInt(slashRangeMatch[5], 10);
    if (
      d1Num >= 1 &&
      d1Num <= 31 &&
      m1Num >= 1 &&
      m1Num <= 12 &&
      d2Num >= 1 &&
      d2Num <= 31 &&
      m2Num >= 1 &&
      m2Num <= 12
    ) {
      const y2 = slashRangeMatch[6]
        ? normalizeYear(parseInt(slashRangeMatch[6], 10))
        : nowBangkok.getFullYear();
      const y1 = slashRangeMatch[3]
        ? normalizeYear(parseInt(slashRangeMatch[3], 10))
        : y2;
      const startStr = `${y1}-${String(m1Num).padStart(2, '0')}-${String(d1Num).padStart(2, '0')}`;
      const endStr = `${y2}-${String(m2Num).padStart(2, '0')}-${String(d2Num).padStart(2, '0')}`;
      text = text.replace(slashRangeMatch[0], ' ');
      return finalizeResult(startStr, endStr, text);
    }
  }

  // 0D. Check "วันที่ 5-7" or "วันที่ 5 ถึง 7" (current month)
  const dayRangeOnlyMatch = text.match(
    /วันที่\s*(\d{1,2})\s*(?:ถึง|-|–|~)\s*(\d{1,2})(?!\s*[/:.-])/
  );
  if (dayRangeOnlyMatch) {
    const d1Num = Math.min(31, Math.max(1, parseInt(dayRangeOnlyMatch[1], 10)));
    const d2Num = Math.min(31, Math.max(1, parseInt(dayRangeOnlyMatch[2], 10)));
    const y = nowBangkok.getFullYear();
    const m = String(nowBangkok.getMonth() + 1).padStart(2, '0');
    text = text.replace(dayRangeOnlyMatch[0], ' ');
    return finalizeResult(
      `${y}-${m}-${String(d1Num).padStart(2, '0')}`,
      `${y}-${m}-${String(d2Num).padStart(2, '0')}`,
      text
    );
  }

  // 1. Check YYYY-MM-DD
  const isoMatch = text.match(/(?:วันที่\s*)?(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = normalizeYear(parseInt(isoMatch[1], 10));
    const m = String(Math.min(12, Math.max(1, parseInt(isoMatch[2], 10)))).padStart(2, '0');
    const d = String(Math.min(31, Math.max(1, parseInt(isoMatch[3], 10)))).padStart(2, '0');
    text = text.replace(isoMatch[0], ' ');
    return finalizeResult(`${y}-${m}-${d}`, undefined, text);
  }

  // 2. Check DD/MM/YYYY or DD/MM/YY or DD-MM-YYYY
  const slashMatch = text.match(/(?:วันที่\s*)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (slashMatch) {
    const dNum = parseInt(slashMatch[1], 10);
    const mNum = parseInt(slashMatch[2], 10);
    if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
      const y = slashMatch[3]
        ? normalizeYear(parseInt(slashMatch[3], 10))
        : nowBangkok.getFullYear();
      const m = String(mNum).padStart(2, '0');
      const d = String(dNum).padStart(2, '0');
      text = text.replace(slashMatch[0], ' ');
      return finalizeResult(`${y}-${m}-${d}`, undefined, text);
    }
  }

  // 3. Check Thai month names
  for (const monthEntry of THAI_MONTH_ALIASES) {
    for (const pat of monthEntry.patterns) {
      const escapedPat = pat.replace(/\./g, '\\.');
      const regex = new RegExp(
        `(?:วันที่\\s*)?(\\d{1,2})\\s*${escapedPat}(?:\\s*(\\d{2,4}))?`,
        'i'
      );
      const match = text.match(regex);
      if (match) {
        const dNum = Math.min(31, Math.max(1, parseInt(match[1], 10)));
        const y = match[2]
          ? normalizeYear(parseInt(match[2], 10))
          : nowBangkok.getFullYear();
        const m = String(monthEntry.monthIndex).padStart(2, '0');
        const d = String(dNum).padStart(2, '0');
        text = text.replace(match[0], ' ');
        return finalizeResult(`${y}-${m}-${d}`, undefined, text);
      }
    }
  }

  // 4. Check "วันที่ DD"
  const dayOnlyMatch = text.match(/วันที่\s*(\d{1,2})(?!\s*[/:.-])/);
  if (dayOnlyMatch) {
    const dNum = Math.min(31, Math.max(1, parseInt(dayOnlyMatch[1], 10)));
    const y = nowBangkok.getFullYear();
    const m = String(nowBangkok.getMonth() + 1).padStart(2, '0');
    const d = String(dNum).padStart(2, '0');
    text = text.replace(dayOnlyMatch[0], ' ');
    return finalizeResult(`${y}-${m}-${d}`, undefined, text);
  }

  // 5. Relative Thai date words
  const inDaysMatch = text.match(/อีก\s*(\d{1,3})\s*วัน/);
  if (inDaysMatch) {
    const offsetDays = Math.max(0, parseInt(inDaysMatch[1], 10));
    const d = getBangkokDateObject(offsetDays);
    text = text.replace(inDaysMatch[0], ' ');
    return finalizeResult(formatPlainDateObjYMD(d), undefined, text);
  }
  if (text.includes('มะรืนนี้') || text.includes('มะรืน')) {
    const d = getBangkokDateObject(2);
    text = text.replace(/มะรืนนี้|มะรืน/g, ' ');
    return finalizeResult(formatPlainDateObjYMD(d), undefined, text);
  }
  if (text.includes('พรุ่งนี้')) {
    const d = getBangkokDateObject(1);
    text = text.replace(/พรุ่งนี้/g, ' ');
    return finalizeResult(formatPlainDateObjYMD(d), undefined, text);
  }
  if (text.includes('สัปดาห์หน้า') || text.includes('อาทิตย์หน้า')) {
    const d = getBangkokDateObject(7);
    text = text.replace(/สัปดาห์หน้า|อาทิตย์หน้า/g, ' ');
    return finalizeResult(formatPlainDateObjYMD(d), undefined, text);
  }
  if (text.includes('วันนี้')) {
    text = text.replace(/วันนี้/g, ' ');
    return finalizeResult(todayStr, undefined, text);
  }

  // 6. Thai weekdays
  for (const wd of THAI_WEEKDAYS) {
    for (const pat of wd.patterns) {
      if (text.includes(pat)) {
        const d = getBangkokDateObject(0);
        const currentDay = d.getDay();
        let diff = (wd.dayOfWeek - currentDay + 7) % 7;
        if (diff === 0) diff = 7;
        d.setDate(d.getDate() + diff);
        text = text.replace(pat, ' ');
        return finalizeResult(formatPlainDateObjYMD(d), undefined, text);
      }
    }
  }

  return finalizeResult(todayStr, undefined, text);
}

export function extractThaiTime(input: string): { timeStr: string; cleanedText: string } {
  let text = input;

  const stdTimeMatch = text.match(/(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:\s*น\.?)?/);
  if (stdTimeMatch) {
    const hh = parseInt(stdTimeMatch[1], 10);
    const mm = parseInt(stdTimeMatch[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      text = text.replace(stdTimeMatch[0], ' ');
      return {
        timeStr: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
        cleanedText: text,
      };
    }
  }

  if (text.includes('เที่ยงครึ่ง')) {
    text = text.replace('เที่ยงครึ่ง', ' ');
    return { timeStr: '12:30', cleanedText: text };
  }
  if (text.includes('เที่ยง')) {
    text = text.replace('เที่ยง', ' ');
    return { timeStr: '12:00', cleanedText: text };
  }

  const thaiNums: Record<string, number> = {
    หนึ่ง: 1,
    สอง: 2,
    สาม: 3,
    สี่: 4,
    ห้า: 5,
  };
  if (text.includes('บ่ายโมงครึ่ง')) {
    text = text.replace('บ่ายโมงครึ่ง', ' ');
    return { timeStr: '13:30', cleanedText: text };
  }
  if (text.includes('บ่ายโมง')) {
    text = text.replace('บ่ายโมง', ' ');
    return { timeStr: '13:00', cleanedText: text };
  }
  const afternoonMatch = text.match(
    /บ่าย\s*(\d|หนึ่ง|สอง|สาม|สี่)(?:\s*โมง)?(\s*ครึ่ง)?/
  );
  if (afternoonMatch) {
    const rawNum = afternoonMatch[1];
    const hourOffset = thaiNums[rawNum] || parseInt(rawNum, 10) || 1;
    const hh = Math.min(23, 12 + hourOffset);
    const mm = afternoonMatch[2] ? '30' : '00';
    text = text.replace(afternoonMatch[0], ' ');
    return { timeStr: `${String(hh).padStart(2, '0')}:${mm}`, cleanedText: text };
  }

  const nightMatch = text.match(/(\d|หนึ่ง|สอง|สาม|สี่|ห้า)\s*ทุ่ม(\s*ครึ่ง)?/);
  if (nightMatch) {
    const rawNum = nightMatch[1];
    const num = thaiNums[rawNum] || parseInt(rawNum, 10) || 1;
    const hh = Math.min(23, 18 + num);
    const mm = nightMatch[2] ? '30' : '00';
    text = text.replace(nightMatch[0], ' ');
    return { timeStr: `${String(hh).padStart(2, '0')}:${mm}`, cleanedText: text };
  }

  const mongMatch = text.match(/(\d{1,2})\s*โมง(เช้า|เย็น)?(\s*ครึ่ง)?/);
  if (mongMatch) {
    let hh = parseInt(mongMatch[1], 10);
    const period = mongMatch[2];
    const isHalf = Boolean(mongMatch[3]);
    if (period === 'เย็น' && hh < 12) {
      hh += 12;
    } else if (!period && hh >= 1 && hh <= 5) {
      hh += 12;
    }
    hh = Math.min(23, Math.max(0, hh));
    text = text.replace(mongMatch[0], ' ');
    return {
      timeStr: `${String(hh).padStart(2, '0')}:${isHalf ? '30' : '00'}`,
      cleanedText: text,
    };
  }

  return { timeStr: '09:00', cleanedText: text };
}

export function parseLineChatMessage(
  rawInput: string,
  existingTasks: Task[],
  categories: Category[],
  defaultRemindMinutes: number,
  _teamMembers: TeamMember[] = []
): ParsedLineCommandResult {
  const text = rawInput.trim();
  const lower = text.toLowerCase();
  const todayStr = formatLocalDateYMD();

  // 1. Check summary / time-split commands (รองรับทั้ง "สรุปงานตามเวลา", "เช็คเวลางาน", "สรุปงานวันนี้", "สรุปงาน <วันที่/เวลา>")
  const isTimeSplitOrSummaryCommand =
    lower === 'งานวันนี้' ||
    lower === 'สรุปงานวันนี้' ||
    lower === 'สรุปงาน' ||
    lower === 'สรุปตารางงาน' ||
    lower === 'สรุปงานทั้งหมด' ||
    lower === 'สรุปงานตามเวลา' ||
    lower === 'เช็คเวลางาน' ||
    lower === 'ตารางงานวันนี้' ||
    lower === 'today' ||
    /^(สรุปงานตามเวลา|เช็คเวลางาน|สรุปงานวันนี้|สรุปตารางงาน|สรุปงาน|ตารางงานวันนี้|ดูงานวันที่|งานวันที่)\s+(.+)$/i.test(
      text
    );

  if (isTimeSplitOrSummaryCommand) {
    const nowTimeHM = formatLocalTimeHM();
    const { dateStr: parsedDate } = extractThaiDate(text);
    const hasCustomTimeInCommand = /(?:เวลา\s*)?(\d{1,2})[:.](\d{2})/.test(text);
    const refTimeStr = hasCustomTimeInCommand ? extractThaiTime(text).timeStr : nowTimeHM;
    const targetDate = parsedDate || todayStr;

    const consolidatedTasks = consolidateContinuousTasks(existingTasks);
    const dateMatchingTasks = consolidatedTasks
      .filter((t) => isTaskActiveOnDate(t, targetDate))
      .sort((a, b) => a.time.localeCompare(b.time));

    const isAllSummaryCommand = lower === 'สรุปงานทั้งหมด';

    const targetTasks = isAllSummaryCommand
      ? [...consolidatedTasks].sort((a, b) =>
          `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
        )
      : dateMatchingTasks;

    const isShowingAllBecauseTodayEmpty = isAllSummaryCommand;

    // แยกงานตามเวลา: 1) งานที่ผ่านเวลาที่กำหนดมาแล้ว (passed) vs 2) งานที่ยังไม่ถึงเวลาที่กำหนด (upcoming)
    const classifyTimePhase = (t: Task): 'passed' | 'upcoming' => {
      if (hasCustomTimeInCommand) {
        return t.time <= refTimeStr ? 'passed' : 'upcoming';
      }
      if (t.date < todayStr) return 'passed';
      if (t.date > todayStr) return 'upcoming';
      return t.time <= refTimeStr ? 'passed' : 'upcoming';
    };

    const passedTasks = targetTasks.filter((t) => classifyTimePhase(t) === 'passed');
    const upcomingTasks = targetTasks.filter((t) => classifyTimePhase(t) === 'upcoming');

    const passedCompletedCount = passedTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const passedOverdueCount = passedTasks.length - passedCompletedCount;

    const pendingCount = targetTasks.filter((t) => t.status !== TaskStatus.COMPLETED).length;
    const completedCount = targetTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const highCount = targetTasks.filter(
      (t) => t.priority === TaskPriority.HIGH && t.status !== TaskStatus.COMPLETED
    ).length;

    const digestItems = targetTasks.map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return {
        title: t.title,
        description: t.description || '',
        date: t.date,
        endDate: t.endDate,
        time: t.time,
        categoryName: cat?.name || 'ทั่วไป',
        categoryColor: cat?.color || '#2563EB',
        priority: t.priority,
        status: t.status,
        assigneeName: t.assigneeName,
        timePhase: classifyTimePhase(t),
      };
    });

    const targetDateThai = formatThaiDateDisplay(targetDate);

    if (targetTasks.length === 0) {
      return {
        action: 'query_today',
        replyText: `📅 วันที่ ${targetDateThai} (เวลา ${refTimeStr} น.) ไม่มีรายการงานในตารางครับ`,
        flexSummary: {
          badge: '📋 สรุปตารางงานประจำวัน',
          title: formatSummaryCardHeaderDate(targetDate, []),
          subtitle: `อัปเดตเวลา ${refTimeStr} น. · ไม่มีรายการงานในตาราง`,
          dateTime: `เวลา ${refTimeStr} น.`,
          date: targetDate,
          time: refTimeStr,
          categoryName: 'สรุปตารางงานประจำวัน',
          categoryColor: '#10B981',
          priorityLabel: 'ไม่มีงานค้าง',
          digestItems: [],
          stats: { total: 0, pending: 0, completed: 0 },
          timeSplitStats: {
            referenceTime: refTimeStr,
            passedCount: 0,
            passedCompletedCount: 0,
            passedOverdueCount: 0,
            upcomingCount: 0,
          },
        },
      };
    }

    const agendaLines = targetTasks.map((t, i) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      const statusText =
        t.status === TaskStatus.COMPLETED
          ? '✓ เสร็จแล้ว'
          : t.priority === TaskPriority.HIGH
          ? '🔥 ด่วนมาก'
          : '⏳ รอดำเนินการ';
      const rangeSuffix =
        t.endDate && t.endDate > t.date ? ` [🗓️ ${formatTaskDateRangeLabel(t, 'short')}]` : '';
      const descLine =
        t.description &&
        !t.description.startsWith('เพิ่มผ่านแชท LINE') &&
        !t.description.startsWith('เพิ่มผ่านหน้าปฏิทิน')
          ? `\n      ↳ ${t.description}`
          : '';
      return `   ${i + 1}. ⏰ ${t.time} น. — ${t.title}${rangeSuffix} (${cat?.name || 'ทั่วไป'} · ${statusText})${descLine}`;
    });

    const headerTitle = isShowingAllBecauseTodayEmpty
      ? `ตารางงานทั้งหมด (${targetTasks.length} งาน)`
      : formatSummaryCardHeaderDate(targetDate, targetTasks);

    const replyText = [
      `📋 ${headerTitle}`,
      `📌 ทั้งหมด ${targetTasks.length} งาน · รอดำเนินการ ${pendingCount} · เสร็จแล้ว ${completedCount}`,
      `━━━━━━━━━━━━━━`,
      ...agendaLines,
    ].join('\n');

    return {
      action: 'query_today',
      replyText,
      flexSummary: {
        badge: '📋 สรุปตารางงานประจำวัน',
        title: headerTitle,
        subtitle: `ทั้งหมด ${targetTasks.length} งาน · รอดำเนินการ ${pendingCount} · เสร็จแล้ว ${completedCount}${
          highCount > 0 ? ` (งานด่วน ${highCount})` : ''
        }`,
        dateTime: `เวลา ${refTimeStr} น.`,
        date: targetDate,
        time: refTimeStr,
        categoryName: 'สรุปตารางงานประจำวัน',
        categoryColor: '#0F172A',
        priorityLabel: `ทั้งหมด ${targetTasks.length} งาน`,
        digestItems,
        stats: {
          total: targetTasks.length,
          pending: pendingCount,
          completed: completedCount,
        },
        timeSplitStats: {
          referenceTime: refTimeStr,
          passedCount: passedTasks.length,
          passedCompletedCount,
          passedOverdueCount,
          upcomingCount: upcomingTasks.length,
        },
      },
    };
  }

  // 2. Check pending / overdue commands
  if (lower === 'งานค้าง' || lower === 'ดูงานค้างทั้งหมด' || lower === 'pending') {
    const pendingTasks = existingTasks
      .filter((t) => t.status !== TaskStatus.COMPLETED)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const completedCount = existingTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;

    if (pendingTasks.length === 0) {
      return {
        action: 'query_pending',
        replyText: '🎉 ยอดเยี่ยม! ไม่มีงานค้างในระบบทั้งหมดแล้วครับ',
        flexSummary: {
          badge: '📋 สรุปงานค้างทั้งหมด',
          title: 'ไม่มีงานค้างในระบบ!',
          subtitle: `ทำงานเสร็จครบทั้ง ${completedCount} รายการเรียบร้อยแล้ว`,
          dateTime: formatThaiDateDisplay(todayStr),
          date: todayStr,
          categoryName: 'สรุปงานค้างทั้งหมด',
          categoryColor: '#10B981',
          priorityLabel: 'ครบ 100%',
          digestItems: [],
          stats: {
            total: existingTasks.length,
            pending: 0,
            completed: completedCount,
          },
        },
      };
    }

    const topTasks = pendingTasks.slice(0, 8);
    const lines = topTasks.map(
      (t, i) => `${i + 1}. ${formatTaskDateRangeLabel(t)} (${t.time} น.) — ${t.title}`
    );

    const digestItems = topTasks.map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return {
        title: t.title,
        description: t.description || '',
        date: t.date,
        endDate: t.endDate,
        time: t.time,
        categoryName: cat?.name || 'ทั่วไป',
        categoryColor: cat?.color || '#D97706',
        priority: t.priority,
        status: t.status,
      };
    });

    return {
      action: 'query_pending',
      replyText: `⏳ สรุปรายการงานค้างทั้งหมด (${pendingTasks.length} งาน จากทั้งหมด ${existingTasks.length} งาน):\n${lines.join('\n')}${
        pendingTasks.length > 8 ? `\n...และอีก ${pendingTasks.length - 8} รายการ` : ''
      }`,
      flexSummary: {
        badge: 'PENDING TASKS SUMMARY',
        title: `สรุปงานค้างทั้งหมด ${pendingTasks.length} รายการ`,
        subtitle: `งานด่วนสำคัญสูง ${
          pendingTasks.filter((t) => t.priority === TaskPriority.HIGH).length
        } รายการ · เสร็จแล้ว ${completedCount} งาน`,
        dateTime: formatThaiDateDisplay(todayStr),
        date: todayStr,
        categoryName: 'ระบบติดตามงานค้าง',
        categoryColor: '#D97706',
        priorityLabel: `รอทำ ${pendingTasks.length} งาน`,
        digestItems,
        stats: {
          total: existingTasks.length,
          pending: pendingTasks.length,
          completed: completedCount,
        },
      },
    };
  }

  // 3. Complete task command
  if (lower.startsWith('เสร็จแล้ว') || lower.startsWith('ทำเสร็จ') || lower.startsWith('done ')) {
    const keyword = text
      .replace(/^(เสร็จแล้ว|ทำเสร็จ|done)\s*/i, '')
      .trim();
    const matched = existingTasks.find(
      (t) =>
        t.status !== TaskStatus.COMPLETED &&
        t.title.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!matched) {
      return {
        action: 'help',
        replyText: `ไม่พบงานค้างที่ตรงกับคำว่า "${keyword}" ลองพิมพ์ "งานค้าง" เพื่อดูชื่องานทั้งหมดครับ`,
      };
    }

    const cat = categories.find((c) => c.id === matched.categoryId) || categories[0];
    const remainingPending = existingTasks.filter(
      (t) => t.id !== matched.id && t.status !== TaskStatus.COMPLETED
    ).length;
    const newCompleted =
      existingTasks.filter((t) => t.status === TaskStatus.COMPLETED).length + 1;

    return {
      action: 'complete_task',
      targetTaskId: matched.id,
      targetTaskTitle: matched.title,
      replyText: `✅ อัปเดตสถานะงาน "${matched.title}" เป็นเสร็จสิ้นเรียบร้อย และซิงค์ลงปฏิทิน + Google Sheets แล้วครับ\n📊 สรุปงานล่าสุด: เสร็จแล้ว ${newCompleted} งาน · ค้าง ${remainingPending} งาน`,
      flexSummary: {
        badge: 'COMPLETED VIA LINE',
        title: matched.title,
        subtitle: 'เปลี่ยนสถานะเป็นเสร็จสมบูรณ์แล้ว',
        dateTime: `${formatTaskDateRangeLabel(matched)} · ${matched.time} น.`,
        date: matched.date,
        time: matched.time,
        categoryName: cat?.name || 'ทั่วไป',
        categoryColor: '#16A34A',
        priorityLabel: 'เสร็จสิ้น',
        stats: {
          total: existingTasks.length,
          pending: remainingPending,
          completed: newCompleted,
        },
      },
    };
  }

  // 4. Delete task command
  if (lower.startsWith('ลบงาน')) {
    const keyword = text.replace(/^ลบงาน\s*/i, '').trim();
    const matched = existingTasks.find((t) =>
      t.title.toLowerCase().includes(keyword.toLowerCase())
    );
    if (!matched) {
      return {
        action: 'help',
        replyText: `ไม่พบรายการงานชื่อ "${keyword}" ในปฏิทินครับ`,
      };
    }
    return {
      action: 'delete_task',
      targetTaskId: matched.id,
      targetTaskTitle: matched.title,
      replyText: `🗑️ เตรียมลบงาน "${matched.title}" ออกจากปฏิทินและ Google Sheets`,
    };
  }

  // 5. Help or Group ID check command
  if (
    lower === 'เชื่อมกลุ่ม' ||
    lower === 'รหัสกลุ่ม' ||
    lower === 'เช็คกลุ่ม' ||
    lower === 'เช็ครหัส' ||
    lower === 'groupid' ||
    lower === 'group id'
  ) {
    return {
      action: 'help',
      replyText:
        '👥 วิธีเชื่อมต่อ "รูปแบบที่ 2: แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม (Group Chat)":\n' +
        '1. เปิดเว็บ LINE Official Account Manager (manager.line.biz) > ตั้งค่า (Settings) > การตั้งค่าบัญชี > หัวข้อ "แชทกลุ่มและแชทแบบหลายคน" เลือกเป็น "อนุญาตให้บัญชีเข้าร่วมกลุ่ม"\n' +
        '2. เชิญบอท LINE OA เข้ากลุ่ม LINE ของทีม\n' +
        '3. พิมพ์คำว่า "เชื่อมกลุ่ม" หรือข้อความใดก็ได้ในห้องแชทกลุ่ม LINE 1 ครั้ง บอทจะตอบกลับพร้อมรหัส Group ID (C... 33 ตัวอักษร) และระบบจะดึงรหัสกลุ่มมาผูกให้อัตโนมัติทันที!',
    };
  }

  if (lower === 'วิธีใช้' || lower === 'help' || lower === 'คำสั่ง') {
    return {
      action: 'help',
      replyText:
        '💡 พิมพ์ข้อความบันทึกงานลงปฏิทินร่วมกันของทีมได้ทุกรูปแบบ เช่น:\n' +
        '• "ประชุมทีมการตลาด พรุ่งนี้ 10:30 #สูง"\n' +
        '• "ส่งมอบโปรเจกต์ 28/10/69 เวลา 14:00"\n' +
        '• "นัดลูกค้า 5 พ.ย. บ่ายสอง #ด่วน"\n' +
        '• พิมพ์ "สรุปงานวันนี้" หรือ "งานค้าง" เพื่อดูการ์ดสรุปตารางงาน\n' +
        '• พิมพ์ "เชื่อมกลุ่ม" หรือ "รหัสกลุ่ม" ในกลุ่ม LINE เพื่อผูกการแจ้งเตือนเข้าห้องแชทกลุ่มของทีม\n' +
        '• พิมพ์ "เสร็จแล้ว [ชื่องาน]" เพื่อขีดฆ่างานที่ทำเสร็จ',
    };
  }

  // 6. Default / Add task command
  let cleanText = text
    .replace(/^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\s*[:：-]?\s*/i, '')
    .replace(/\r?\n/g, ' ');

  const dateResult = extractThaiDate(cleanText);
  const targetDate = dateResult.dateStr;
  const targetEndDate = dateResult.endDateStr;
  cleanText = dateResult.cleanedText;

  const timeResult = extractThaiTime(cleanText);
  const targetTime = timeResult.timeStr;
  cleanText = timeResult.cleanedText;

  let priority = TaskPriority.MEDIUM;
  if (/(?:#|\b)(สูง|ด่วนมาก|ด่วน|สำคัญมาก|high|urgent)/i.test(cleanText)) {
    priority = TaskPriority.HIGH;
    cleanText = cleanText.replace(/(?:#|\b)(สูง|ด่วนมาก|ด่วน|สำคัญมาก|high|urgent)/gi, ' ');
  } else if (/(?:#|\b)(ต่ำ|ทั่วไป|low)/i.test(cleanText)) {
    priority = TaskPriority.LOW;
    cleanText = cleanText.replace(/(?:#|\b)(ต่ำ|ทั่วไป|low)/gi, ' ');
  } else if (/(?:#|\b)(กลาง|ปกติ|medium)/i.test(cleanText)) {
    priority = TaskPriority.MEDIUM;
    cleanText = cleanText.replace(/(?:#|\b)(กลาง|ปกติ|medium)/gi, ' ');
  }

  let remindMinutes = defaultRemindMinutes;
  const remindMatch = cleanText.match(/เตือน(?:ล่วงหน้า)?\s*(\d+)\s*นาที/);
  if (remindMatch) {
    remindMinutes = parseInt(remindMatch[1], 10) || defaultRemindMinutes;
    cleanText = cleanText.replace(remindMatch[0], ' ');
  }

  let selectedCategory = categories[0] || {
    id: 'cat-work',
    name: 'งานบริหาร & โปรเจกต์',
    color: '#2563EB',
  };

  for (const cat of categories) {
    if (cleanText.includes(`หมวด${cat.name}`) || cleanText.includes(cat.name)) {
      selectedCategory = cat;
      cleanText = cleanText
        .replace(`หมวด${cat.name}`, ' ')
        .replace(cat.name, ' ');
      break;
    }
  }

  if (selectedCategory.id === categories[0]?.id) {
    if (/ลูกค้า|การตลาด|ขาย|เสนอราคา/.test(cleanText)) {
      selectedCategory = categories.find((c) => c.id === 'cat-client') || selectedCategory;
    } else if (/วางบิล|บัญชี|งบประมาณ|การเงิน|ภาษี/.test(cleanText)) {
      selectedCategory = categories.find((c) => c.id === 'cat-finance') || selectedCategory;
    } else if (/ด่วน|เร่งด่วน|แก้ไข/.test(cleanText)) {
      selectedCategory = categories.find((c) => c.id === 'cat-urgent') || selectedCategory;
    }
  }

  const finalTitle =
    cleanText
      .replace(/\b(เวลา|วันที่|ตอน|น\.)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || text;

  const newTask: Task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: finalTitle,
    description: `บันทึกอัตโนมัติผ่าน LINE OA ("${text}")`,
    date: targetDate,
    endDate: targetEndDate,
    time: targetTime,
    categoryId: selectedCategory.id,
    priority,
    status: TaskStatus.PENDING,
    remindMinutesBefore: remindMinutes,
    lineNotified: false,
    source: 'line',
    updatedAt: new Date().toISOString(),
  };

  const priorityText =
    priority === TaskPriority.HIGH
      ? 'ความสำคัญสูง'
      : priority === TaskPriority.LOW
      ? 'ทั่วไป'
      : 'ความสำคัญปานกลาง';

  const dateDisplayLabel = formatTaskDateRangeLabel(newTask);
  const updatedAllTasks = [newTask, ...existingTasks];
  const sameDayTasks = updatedAllTasks.filter((t) => isTaskActiveOnDate(t, newTask.date));
  const sameDayPending = sameDayTasks.filter((t) => t.status !== TaskStatus.COMPLETED).length;
  const sameDayCompleted = sameDayTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;

  return {
    action: 'add_task',
    createdTask: newTask,
    replyText: `✅ บันทึกงานลงปฏิทินร่วมกันและฐานข้อมูลเรียบร้อยแล้ว!\n📌 ชื่องาน: ${newTask.title}\n🗓️ วันที่: ${dateDisplayLabel} เวลา ${newTask.time} น.\n🗂️ หมวดหมู่: ${selectedCategory.name}\n🔔 แจ้งเตือนล่วงหน้า: ${formatRemindMinutesLabel(remindMinutes)}\n📊 สรุปงานวันที่ ${formatThaiDateDisplay(newTask.date)}: ทั้งหมด ${sameDayTasks.length} งาน (รอทำ ${sameDayPending} · เสร็จแล้ว ${sameDayCompleted})`,
    flexSummary: {
      badge: 'SAVED TO CALENDAR',
      title: newTask.title,
      subtitle: `บันทึกลงปฏิทินวันที่ ${dateDisplayLabel} เวลา ${newTask.time} น.`,
      dateTime: `${dateDisplayLabel} · ${newTask.time} น.`,
      date: newTask.date,
      endDate: newTask.endDate,
      time: newTask.time,
      categoryName: selectedCategory.name,
      categoryColor: selectedCategory.color,
      priority: newTask.priority,
      priorityLabel: priorityText,
      remindLabel: formatRemindMinutesLabel(remindMinutes),
      description: newTask.description,
      stats: {
        total: sameDayTasks.length,
        pending: sameDayPending,
        completed: sameDayCompleted,
      },
    },
  };
}

export function resolveTeamCalendarAppUrl(options?: {
  customPublicUrl?: string;
  workspaceId?: string;
  spreadsheetId?: string;
  date?: string;
}): string {
  const custom = (options?.customPublicUrl || '').trim();
  const isInvalidOrLoginGated = (u: string) =>
    !u ||
    !/^https?:\/\//i.test(u) ||
    /^https:\/\/ais-(dev|pre)-/i.test(u) ||
    u.includes('docs.google.com/spreadsheets') ||
    u.includes('AKfycby0gvQ') ||
    u.includes('AKfycbxIf9k');

  let rawBase = '';
  if (!isInvalidOrLoginGated(custom)) {
    rawBase = custom;
  } else if (
    typeof window !== 'undefined' &&
    !isInvalidOrLoginGated(window.location.origin)
  ) {
    rawBase = `${window.location.origin}${window.location.pathname}`;
  } else {
    rawBase = 'https://naiadminna.github.io/Lakha/';
  }

  try {
    const parsedUrl = new URL(rawBase);
    const host = parsedUrl.hostname.toLowerCase();

    if (host.includes('calendar.google.com')) {
      return parsedUrl.toString();
    }

    if (host.includes('script.google.com')) {
      parsedUrl.searchParams.set('view', 'calendar');
      if (options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date.trim())) {
        parsedUrl.searchParams.set('date', options.date.trim());
      }
      parsedUrl.searchParams.set('openExternalBrowser', '1');
      return parsedUrl.toString();
    }

    parsedUrl.searchParams.set('section', 'calendar');
    parsedUrl.searchParams.set(
      'workspace',
      options?.workspaceId?.trim() || 'sheetcal-team-clean'
    );
    parsedUrl.searchParams.set(
      'sheet',
      options?.spreadsheetId?.trim() || '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc'
    );
    if (options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date.trim())) {
      parsedUrl.searchParams.set('date', options.date.trim());
    }
    const defaultPublicGas =
      'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';
    let effectiveGas = defaultPublicGas;
    try {
      const savedGas =
        typeof localStorage !== 'undefined'
          ? (localStorage.getItem('sheetcal_gas_url_v1') || '').trim()
          : '';
      if (
        savedGas.startsWith('https://script.google.com/macros/s/') &&
        !savedGas.includes('AKfycby0gvQ') &&
        !savedGas.includes('AKfycbxIf9k')
      ) {
        effectiveGas = savedGas;
      }
    } catch {
      // Ignore storage access
    }
    parsedUrl.searchParams.set('gas', effectiveGas);
    parsedUrl.searchParams.set('openExternalBrowser', '1');
    return parsedUrl.toString();
  } catch {
    return 'https://naiadminna.github.io/Lakha/?section=calendar&openExternalBrowser=1';
  }
}

export function resolvePublicTvShareUrl(options?: {
  customPublicUrl?: string;
  workspaceId?: string;
  spreadsheetId?: string;
}): string {
  const isLoginGatedOrInvalidForTv = (u: string) =>
    !u ||
    !/^https?:\/\//i.test(u) ||
    /^https:\/\/ais-(dev|pre)-/i.test(u) ||
    u.includes('docs.google.com/spreadsheets') ||
    u.includes('calendar.google.com') ||
    u.includes('script.google.com/macros/s/') ||
    u.includes('AKfycby0gvQ') ||
    u.includes('AKfycbxIf9k');

  let savedTvBase = '';
  let savedLinePublicUrl = '';
  let savedWorkspaceId = 'sheetcal-team-clean';
  let savedSheetId = '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc';
  const defaultPublicGas =
    'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';
  let effectiveGas = defaultPublicGas;

  try {
    if (typeof localStorage !== 'undefined') {
      savedTvBase = (localStorage.getItem('sheetcal_public_tv_base_url_v1') || '').trim();
      const rawLineCfg = localStorage.getItem('sheetcal_line_settings_v2');
      if (rawLineCfg) {
        const parsedCfg = JSON.parse(rawLineCfg);
        if (typeof parsedCfg?.publicCalendarUrl === 'string') {
          savedLinePublicUrl = parsedCfg.publicCalendarUrl.trim();
        }
      }
      const ws = (localStorage.getItem('sheetcal_workspace_id_v3_clean') || '').trim();
      if (ws) savedWorkspaceId = ws;

      const rawMeta = localStorage.getItem('sheetcal_sheet_meta_v1');
      if (rawMeta) {
        const parsedMeta = JSON.parse(rawMeta);
        if (typeof parsedMeta?.spreadsheetId === 'string' && parsedMeta.spreadsheetId.trim()) {
          savedSheetId = parsedMeta.spreadsheetId.trim();
        }
      }

      const savedGas = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
      if (
        savedGas.startsWith('https://script.google.com/macros/s/') &&
        !savedGas.includes('AKfycby0gvQ') &&
        !savedGas.includes('AKfycbxIf9k')
      ) {
        effectiveGas = savedGas;
      }
    }
  } catch {
    // Ignore storage read errors
  }

  const explicitCustom = (options?.customPublicUrl || '').trim();
  const currentBrowserUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';

  let rawBase = 'https://naiadminna.github.io/Lakha/';
  if (!isLoginGatedOrInvalidForTv(explicitCustom)) {
    rawBase = explicitCustom;
  } else if (!isLoginGatedOrInvalidForTv(savedTvBase)) {
    rawBase = savedTvBase;
  } else if (!isLoginGatedOrInvalidForTv(currentBrowserUrl)) {
    rawBase = currentBrowserUrl;
  } else if (!isLoginGatedOrInvalidForTv(savedLinePublicUrl)) {
    rawBase = savedLinePublicUrl;
  }

  try {
    const parsedUrl = new URL(rawBase);
    parsedUrl.searchParams.delete('view');
    parsedUrl.searchParams.delete('date');
    parsedUrl.searchParams.delete('openExternalBrowser');
    parsedUrl.searchParams.delete('_v');
    parsedUrl.searchParams.set('section', 'schedule');
    parsedUrl.searchParams.set('tv', '1');
    parsedUrl.searchParams.set('workspace', options?.workspaceId?.trim() || savedWorkspaceId);
    parsedUrl.searchParams.set('sheet', options?.spreadsheetId?.trim() || savedSheetId);
    parsedUrl.searchParams.set('gas', effectiveGas);
    return parsedUrl.toString();
  } catch {
    return `https://naiadminna.github.io/Lakha/?section=schedule&tv=1&workspace=${encodeURIComponent(
      savedWorkspaceId
    )}&sheet=${encodeURIComponent(savedSheetId)}&gas=${encodeURIComponent(effectiveGas)}`;
  }
}

export function resolveShortTvBrowserUrl(options?: { customPublicUrl?: string }): string {
  const isLoginGatedOrInvalidForTv = (u: string) =>
    !u ||
    !/^https?:\/\//i.test(u) ||
    /^https:\/\/ais-(dev|pre)-/i.test(u) ||
    u.includes('docs.google.com/spreadsheets') ||
    u.includes('calendar.google.com') ||
    u.includes('script.google.com/macros/s/') ||
    u.includes('AKfycby0gvQ') ||
    u.includes('AKfycbxIf9k');

  let savedTvBase = '';
  let savedLinePublicUrl = '';
  try {
    if (typeof localStorage !== 'undefined') {
      savedTvBase = (localStorage.getItem('sheetcal_public_tv_base_url_v1') || '').trim();
      const rawLineCfg = localStorage.getItem('sheetcal_line_settings_v2');
      if (rawLineCfg) {
        const parsedCfg = JSON.parse(rawLineCfg);
        if (typeof parsedCfg?.publicCalendarUrl === 'string') {
          savedLinePublicUrl = parsedCfg.publicCalendarUrl.trim();
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }

  const explicitCustom = (options?.customPublicUrl || '').trim();
  const currentBrowserUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';

  let rawBase = 'https://naiadminna.github.io/Lakha/';
  if (!isLoginGatedOrInvalidForTv(explicitCustom)) {
    rawBase = explicitCustom;
  } else if (!isLoginGatedOrInvalidForTv(savedTvBase)) {
    rawBase = savedTvBase;
  } else if (!isLoginGatedOrInvalidForTv(currentBrowserUrl)) {
    rawBase = currentBrowserUrl;
  } else if (!isLoginGatedOrInvalidForTv(savedLinePublicUrl)) {
    rawBase = savedLinePublicUrl;
  }

  try {
    const parsedUrl = new URL(rawBase);
    parsedUrl.search = '';
    parsedUrl.hash = '';
    parsedUrl.searchParams.set('tv', '1');
    return parsedUrl.toString();
  } catch {
    return 'https://naiadminna.github.io/Lakha/?tv=1';
  }
}

export function hasCustomAgencyTvConfig(): boolean {
  const defaultWorkspace = 'sheetcal-team-clean';
  const defaultSheet = '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc';
  const defaultGas =
    'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';
  try {
    if (typeof localStorage === 'undefined') return false;
    const ws = (localStorage.getItem('sheetcal_workspace_id_v3_clean') || '').trim();
    if (ws && ws !== defaultWorkspace) return true;
    const rawMeta = localStorage.getItem('sheetcal_sheet_meta_v1');
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      const sheetId = typeof parsed?.spreadsheetId === 'string' ? parsed.spreadsheetId.trim() : '';
      if (sheetId && sheetId !== defaultSheet) return true;
    }
    const savedGas = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
    if (
      savedGas &&
      savedGas.startsWith('https://script.google.com/macros/s/') &&
      savedGas !== defaultGas &&
      !savedGas.includes('AKfycby0gvQ') &&
      !savedGas.includes('AKfycbxIf9k')
    ) {
      return true;
    }
  } catch {
    // Ignore storage read errors
  }
  return false;
}

export function isLineQuotaLimitError(rawError: unknown): boolean {
  const text = String(rawError || '').toLowerCase();
  return (
    text.includes('monthly limit') ||
    text.includes('reached your monthly limit') ||
    text.includes('โควต้าข้อความรายเดือน') ||
    text.includes('โควต้าส่งข้อความ')
  );
}

export function formatLineDeliveryErrorThai(
  rawError: unknown,
  bridgeLabel = 'LINE Messaging API'
): string {
  const rawStr = String(rawError || '').trim();
  if (isLineQuotaLimitError(rawStr)) {
    return 'โควต้าส่งข้อความอัตโนมัติ (Push/Broadcast) รายเดือนของบัญชี LINE OA เต็มแล้ว (แพ็กเกจฟรีส่งได้ 300 ข้อความ/เดือน นับตามจำนวนผู้รับ และรีเซ็ตวันที่ 1 ของเดือนถัดไป) — สมาชิกยังพิมพ์ถามบอทใน LINE เช่น "สรุปงานวันนี้" หรือ "งานพรุ่งนี้" ได้ฟรีไม่จำกัดตามปกติครับ';
  }
  if (!rawStr) {
    return `ส่งผ่าน ${bridgeLabel} ไม่สำเร็จ กรุณาตรวจสอบ LINE Channel Access Token`;
  }
  return `ส่งผ่าน ${bridgeLabel} ไม่สำเร็จ: ${rawStr}`;
}

export function generateGoogleAppsScriptCode(
  spreadsheetId: string,
  channelAccessToken?: string,
  appUrl?: string,
  telegramOptions?: {
    botToken?: string;
    chatId?: string;
    headerTitle?: string;
    reminderTimings?: number[];
    dailyDigestEnabled?: boolean;
    dailyDigestTime?: string;
    showStats?: boolean;
    showButtons?: boolean;
    deliveryMode?: 'photo_card' | 'text_html';
  }
): string {
  let effectiveSheetId = (spreadsheetId || '').trim();
  let effectiveGroupId = '';
  let effectiveTgToken = (telegramOptions?.botToken || '').trim();
  let effectiveTgChatId = (telegramOptions?.chatId || '').trim();
  let effectiveTgHeader = (
    telegramOptions?.headerTitle || 'สำนักบริหารแรงงานต่างด้าว · ระบบน้องเลขา'
  ).trim();
  let effectiveReminderTimings: number[] =
    Array.isArray(telegramOptions?.reminderTimings) && telegramOptions.reminderTimings.length > 0
      ? telegramOptions.reminderTimings
      : [0, 15, 60];
  let effectiveDailyDigestEnabled = telegramOptions?.dailyDigestEnabled !== false;
  let effectiveDailyDigestTime = (telegramOptions?.dailyDigestTime || '08:00').trim();
  let effectiveShowStats = telegramOptions?.showStats !== false;
  const effectiveShowButtons = false;
  let effectiveDeliveryMode: 'photo_card' | 'text_html' =
    telegramOptions?.deliveryMode === 'text_html' ? 'text_html' : 'photo_card';
  let initialTasksJson = '[]';
  try {
    if (typeof localStorage !== 'undefined') {
      if (!effectiveSheetId || effectiveSheetId.includes('วาง_SPREADSHEET_ID')) {
        const rawMeta = localStorage.getItem('sheetcal_sheet_meta_v1');
        if (rawMeta) {
          const parsedMeta = JSON.parse(rawMeta);
          if (parsedMeta?.spreadsheetId) {
            effectiveSheetId = String(parsedMeta.spreadsheetId).trim();
          }
        }
      }
      const rawLineSettings = localStorage.getItem('sheetcal_line_settings_v2');
      if (rawLineSettings) {
        const parsedSettings = JSON.parse(rawLineSettings);
        const candidateGrp = String(
          parsedSettings?.targetGroupId || parsedSettings?.targetUserId || ''
        ).trim();
        if (/^[CR][0-9a-fA-F]{32}$/.test(candidateGrp)) {
          effectiveGroupId = candidateGrp;
        }
        if (!effectiveTgToken && typeof parsedSettings?.telegramBotToken === 'string') {
          effectiveTgToken = parsedSettings.telegramBotToken.trim();
        }
        if (!effectiveTgChatId && typeof parsedSettings?.telegramChatId === 'string') {
          effectiveTgChatId = parsedSettings.telegramChatId.trim();
        }
        if (
          !telegramOptions?.headerTitle &&
          typeof parsedSettings?.telegramHeaderTitle === 'string' &&
          parsedSettings.telegramHeaderTitle.trim()
        ) {
          effectiveTgHeader = parsedSettings.telegramHeaderTitle.trim();
        }
        if (
          !telegramOptions?.reminderTimings &&
          Array.isArray(parsedSettings?.reminderTimings) &&
          parsedSettings.reminderTimings.length > 0
        ) {
          effectiveReminderTimings = parsedSettings.reminderTimings;
        }
        if (
          telegramOptions?.dailyDigestTime === undefined &&
          typeof parsedSettings?.dailyDigestTime === 'string' &&
          /^\d{1,2}:\d{2}$/.test(parsedSettings.dailyDigestTime.trim())
        ) {
          effectiveDailyDigestTime = parsedSettings.dailyDigestTime.trim();
        }
        if (
          telegramOptions?.dailyDigestEnabled === undefined &&
          typeof parsedSettings?.dailyDigestEnabled === 'boolean'
        ) {
          effectiveDailyDigestEnabled = parsedSettings.dailyDigestEnabled;
        }
        if (
          telegramOptions?.deliveryMode === undefined &&
          (parsedSettings?.telegramDeliveryMode === 'photo_card' ||
            parsedSettings?.telegramDeliveryMode === 'text_html')
        ) {
          effectiveDeliveryMode = parsedSettings.telegramDeliveryMode;
        }
      }
      const rawTasks = localStorage.getItem('sheetcal_tasks_v3_clean');
      if (rawTasks) {
        const parsedTasks = JSON.parse(rawTasks);
        if (Array.isArray(parsedTasks)) {
          initialTasksJson = JSON.stringify(
            parsedTasks.map((t: Record<string, unknown>) => ({
              id: String(t.id || ''),
              title: String(t.title || ''),
              description: String(t.description || ''),
              date: String(t.date || ''),
              time: String(t.time || '09:00'),
              categoryId: String(t.categoryId || 'cat-work'),
              priority: String(t.priority || 'medium'),
              status: String(t.status || 'pending'),
              remindMinutesBefore: Number(t.remindMinutesBefore || 1),
              lineNotified: Boolean(t.lineNotified),
              source: String(t.source || 'web'),
              updatedAt: String(t.updatedAt || new Date().toISOString()),
            }))
          );
        }
      }
    }
  } catch {
    // Ignore localStorage error
  }

  const sheetIdDisplay = (
    effectiveSheetId || '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc'
  )
    .replace(/[\r\n']/g, '')
    .trim();
  const groupIdDisplay = (
    effectiveGroupId || 'Cff150b586a4f91c883b40ae7d76b2ec9'
  )
    .replace(/[\r\n']/g, '')
    .trim();
  const tokenDisplay = channelAccessToken?.trim()
    ? channelAccessToken.trim().replace(/^Bearer\s+/i, '').replace(/[\r\n']/g, '').trim()
    : 'วาง_LINE_CHANNEL_ACCESS_TOKEN_ของคุณที่นี่';
  const rawWindowOrigin = (
    typeof window !== 'undefined' ? window.location.origin : ''
  )
    .split('?')[0]
    .replace(/\/+$/, '')
    .replace(/[\r\n']/g, '')
    .trim();
  const mainServerOrigin = /^https:\/\/ais-(dev|pre)-/i.test(rawWindowOrigin)
    ? 'https://naiadminna.github.io/Lakha'
    : rawWindowOrigin || 'https://naiadminna.github.io/Lakha';
  const cleanPassedAppUrl = (appUrl || '').replace(/[\r\n']/g, '').trim();
  const safePassedAppUrl = /^https:\/\/ais-(dev|pre)-/i.test(cleanPassedAppUrl)
    ? ''
    : cleanPassedAppUrl;
  const rawAppUrl =
    safePassedAppUrl || mainServerOrigin || 'https://naiadminna.github.io/Lakha';
  const webAppUrl = rawAppUrl.includes('script.google.com/macros/s/')
    ? rawAppUrl.split('?')[0].replace(/\/+$/, '')
    : mainServerOrigin || rawAppUrl.split('?')[0].replace(/\/+$/, '');

  return `/**
 * ============================================================================
 * ระบบน้องเลขา (v3.4) — การ์ดภาพ Telegram 24 ชม. + LINE การ์ดผู้บริหาร + ซิงค์ 2 ทาง 100%
 * ============================================================================
 * วิธีติดตั้ง / อัปเดตโค้ด:
 * 1. เปิดไฟล์ Google Sheets > Extensions (ส่วนขยาย) > Apps Script
 * 2. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดนี้ลงไป กด Save (แผ่นดิสก์)
 * 3. กดปุ่ม "Deploy" > "Manage deployments" > กดรูปดินสอ (Edit)
 *    - ช่อง Version: เลือก "New version" (สำคัญมากเพื่อให้โค้ดใหม่อัปเดตขึ้นเว็บ)
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 4. กด Deploy แล้วใช้งานลิงก์ Web app URL เดิมหรือลิงก์ใหม่ได้ทันที
 */

const SPREADSHEET_ID = '${sheetIdDisplay}';
const LINE_CHANNEL_ACCESS_TOKEN = '${tokenDisplay}';
const TELEGRAM_BOT_TOKEN = '${effectiveTgToken.replace(/[\r\n']/g, '')}';
const TELEGRAM_CHAT_ID = '${effectiveTgChatId.replace(/[\r\n']/g, '')}';
const TELEGRAM_HEADER_TITLE = '${effectiveTgHeader.replace(/[\r\n']/g, '')}';
const TELEGRAM_REMINDER_TIMINGS = ${JSON.stringify(effectiveReminderTimings)};
const TELEGRAM_DAILY_DIGEST_ENABLED = ${effectiveDailyDigestEnabled ? 'true' : 'false'};
const TELEGRAM_DAILY_DIGEST_TIME = '${effectiveDailyDigestTime.replace(/[\r\n']/g, '')}';
const TELEGRAM_SHOW_STATS = ${effectiveShowStats ? 'true' : 'false'};
const TELEGRAM_SHOW_BUTTONS = ${effectiveShowButtons ? 'true' : 'false'};
const TELEGRAM_DELIVERY_MODE = '${effectiveDeliveryMode}';
const MAIN_SERVER_URL = '${mainServerOrigin}';
const WEB_APP_URL = '${webAppUrl}';
const INITIAL_GROUP_ID = '${groupIdDisplay}';
const INITIAL_WEB_TASKS = ${initialTasksJson};

function getSelfWebAppUrl() {
  try {
    var u = ScriptApp.getService().getUrl();
    if (u && String(u).indexOf('https://script.google.com/macros/s/') === 0) {
      return String(u).trim();
    }
  } catch (err) {}
  return '';
}

function getCalendarDeepLink(overrideBaseUrl, dateStr) {
  var selfGasUrl = getSelfWebAppUrl();
  var candidate = String(overrideBaseUrl || '').trim();
  if (candidate.indexOf('https://ais-dev-') === 0 || candidate.indexOf('https://ais-pre-') === 0) {
    candidate = '';
  }
  var base = String(candidate || selfGasUrl || WEB_APP_URL || '').trim();
  if (base.indexOf('https://ais-dev-') === 0 || base.indexOf('https://ais-pre-') === 0) {
    base = selfGasUrl || 'https://naiadminna.github.io/Lakha/?section=calendar';
  }
  var sheetDirect = getSpreadsheetDirectUrl();
  if (!base || base.indexOf('http') !== 0) {
    base = selfGasUrl || sheetDirect || 'https://naiadminna.github.io/Lakha/?section=calendar';
  }
  if (base.indexOf('calendar.google.com') !== -1 || base.indexOf('docs.google.com') !== -1) {
    return base;
  }
  var sep = base.indexOf('?') === -1 ? '?' : '&';
  var url = base;
  if (url.indexOf('script.google.com/macros/s/') !== -1 && url.indexOf('view=') === -1) {
    url += sep + 'view=calendar';
    sep = '&';
  } else if (url.indexOf('section=') === -1) {
    url += sep + 'section=calendar';
    sep = '&';
  }
  if (url.indexOf('workspace=') === -1 && url.indexOf('script.google.com/macros/s/') === -1) {
    url += sep + 'workspace=sheetcal-team-clean';
    sep = '&';
  }
  if (dateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateStr)) && url.indexOf('date=') === -1) {
    url += sep + 'date=' + encodeURIComponent(String(dateStr));
    sep = '&';
  }
  var effectiveSheet = getEffectiveSpreadsheetId();
  if (effectiveSheet && url.indexOf('sheet=') === -1) {
    url += sep + 'sheet=' + encodeURIComponent(effectiveSheet);
    sep = '&';
  }
  if (url.indexOf('openExternalBrowser=') === -1) {
    url += sep + 'openExternalBrowser=1';
  }
  return url;
}

function getEffectiveSpreadsheetId() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('วาง_SPREADSHEET_ID') === -1 && SPREADSHEET_ID.indexOf('PUT_YOUR_') === -1) {
    return SPREADSHEET_ID;
  }
  try {
    var autoId = PropertiesService.getScriptProperties().getProperty('AUTO_CREATED_SHEET_ID') || '';
    if (autoId) return autoId;
  } catch (err) {}
  return '';
}

function getSpreadsheetDirectUrl() {
  var sid = getEffectiveSpreadsheetId();
  if (sid) {
    return 'https://docs.google.com/spreadsheets/d/' + sid + '/edit';
  }
  return '';
}

function normalizeYearNum(yRaw, fallbackYear) {
  var yNum = yRaw ? parseInt(yRaw, 10) : fallbackYear;
  if (isNaN(yNum)) return fallbackYear;
  if (yNum >= 2400) return yNum - 543;
  if (yNum >= 60 && yNum < 100) return 2500 + yNum - 543;
  if (yNum > 0 && yNum < 60) return 2000 + yNum;
  return yNum;
}

function parseThaiCommand(rawText) {
  var text = String(rawText || '').trim();
  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var currentYear = parseInt(Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy'), 10);
  var currentMonth = parseInt(Utilities.formatDate(now, 'Asia/Bangkok', 'MM'), 10);
  var clean = text.replace(/^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\\s*[:：-]?\\s*/i, '');

  var targetDate = todayStr;
  var dateMatched = false;

  // 1. รูปแบบมาตรฐาน YYYY-MM-DD (เช่น 2026-11-05 หรือ 2569-11-05)
  var isoMatch = clean.match(/(?:วันที่\\s*)?(\\d{4})-(\\d{1,2})-(\\d{1,2})/);
  if (isoMatch) {
    var yIso = normalizeYearNum(isoMatch[1], currentYear);
    targetDate = yIso + '-' + ('0' + isoMatch[2]).slice(-2) + '-' + ('0' + isoMatch[3]).slice(-2);
    clean = clean.replace(isoMatch[0], ' ');
    dateMatched = true;
  }

  // 2. รูปแบบ DD/MM/YYYY หรือ DD/MM/YY หรือ DD/MM หรือ DD-MM-YYYY (เช่น 5/11, 5/11/69, 05/11/2569)
  if (!dateMatched) {
    var slashMatch = clean.match(/(?:วันที่\\s*)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?/);
    if (slashMatch) {
      var dNum = parseInt(slashMatch[1], 10);
      var mNum = parseInt(slashMatch[2], 10);
      if (dNum >= 1 && dNum <= 31 && mNum >= 1 && mNum <= 12) {
        var ySlash = normalizeYearNum(slashMatch[3], currentYear);
        targetDate = ySlash + '-' + ('0' + mNum).slice(-2) + '-' + ('0' + dNum).slice(-2);
        clean = clean.replace(slashMatch[0], ' ');
        dateMatched = true;
      }
    }
  }

  // 3. รูปแบบชื่อเดือนภาษาไทย ทั้งแบบย่อและแบบเต็ม (เช่น 5 พ.ย., 12 พย 69, วันที่ 15 พฤศจิกายน 2569)
  if (!dateMatched) {
    var thaiMonths = [
      { m: 1, pats: ['มกราคม', 'ม\\.ค\\.', 'ม\\.ค', 'มค'] },
      { m: 2, pats: ['กุมภาพันธ์', 'กุมภา', 'ก\\.พ\\.', 'ก\\.พ', 'กพ'] },
      { m: 3, pats: ['มีนาคม', 'มีนา', 'มี\\.ค\\.', 'มี\\.ค', 'มีค'] },
      { m: 4, pats: ['เมษายน', 'เมษา', 'เม\\.ย\\.', 'เม\\.ย', 'เมย'] },
      { m: 5, pats: ['พฤษภาคม', 'พฤษภา', 'พ\\.ค\\.', 'พ\\.ค', 'พค'] },
      { m: 6, pats: ['มิถุนายน', 'มิถุนา', 'มิ\\.ย\\.', 'มิ\\.ย', 'มิย'] },
      { m: 7, pats: ['กรกฎาคม', 'กรกฎา', 'ก\\.ค\\.', 'ก\\.ค', 'กค'] },
      { m: 8, pats: ['สิงหาคม', 'สิงหา', 'ส\\.ค\\.', 'ส\\.ค', 'สค'] },
      { m: 9, pats: ['กันยายน', 'กันยา', 'ก\\.ย\\.', 'ก\\.ย', 'กย'] },
      { m: 10, pats: ['ตุลาคม', 'ตุลา', 'ต\\.ค\\.', 'ต\\.ค', 'ตค'] },
      { m: 11, pats: ['พฤศจิกายน', 'พฤศจิกา', 'พ\\.ย\\.', 'พ\\.ย', 'พย'] },
      { m: 12, pats: ['ธันวาคม', 'ธันวา', 'ธ\\.ค\\.', 'ธ\\.ค', 'ธค'] }
    ];
    for (var mi = 0; mi < thaiMonths.length && !dateMatched; mi++) {
      var mEntry = thaiMonths[mi];
      for (var pi = 0; pi < mEntry.pats.length; pi++) {
        var rgx = new RegExp('(?:วันที่\\\\s*)?(\\\\d{1,2})\\\\s*' + mEntry.pats[pi] + '(?:\\\\s*(\\\\d{2,4}))?', 'i');
        var mMatch = clean.match(rgx);
        if (mMatch) {
          var dThai = Math.min(31, Math.max(1, parseInt(mMatch[1], 10)));
          var yThai = normalizeYearNum(mMatch[2], currentYear);
          targetDate = yThai + '-' + ('0' + mEntry.m).slice(-2) + '-' + ('0' + dThai).slice(-2);
          clean = clean.replace(mMatch[0], ' ');
          dateMatched = true;
          break;
        }
      }
    }
  }

  // 4. รูปแบบ "วันที่ DD" ของเดือนปัจจุบัน (เช่น วันที่ 15, วันที่ 25)
  if (!dateMatched) {
    var dayOnlyMatch = clean.match(/วันที่\\s*(\\d{1,2})(?!\\s*[/:.-])/);
    if (dayOnlyMatch) {
      var dOnly = Math.min(31, Math.max(1, parseInt(dayOnlyMatch[1], 10)));
      targetDate = currentYear + '-' + ('0' + currentMonth).slice(-2) + '-' + ('0' + dOnly).slice(-2);
      clean = clean.replace(dayOnlyMatch[0], ' ');
      dateMatched = true;
    }
  }

  // 5. คำระบุวันสัมพัทธ์ (พรุ่งนี้, มะรืน, อีก X วัน, สัปดาห์หน้า, วันนี้)
  if (!dateMatched) {
    var inDaysMatch = clean.match(/อีก\\s*(\\d{1,3})\\s*วัน/);
    if (inDaysMatch) {
      var addDays = Math.max(0, parseInt(inDaysMatch[1], 10));
      var dNext = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
      targetDate = Utilities.formatDate(dNext, 'Asia/Bangkok', 'yyyy-MM-dd');
      clean = clean.replace(inDaysMatch[0], ' ');
      dateMatched = true;
    } else if (clean.indexOf('มะรืน') !== -1) {
      var d2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      targetDate = Utilities.formatDate(d2, 'Asia/Bangkok', 'yyyy-MM-dd');
      clean = clean.replace(/มะรืนนี้|มะรืน/g, ' ');
      dateMatched = true;
    } else if (clean.indexOf('พรุ่งนี้') !== -1) {
      var d1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
      targetDate = Utilities.formatDate(d1, 'Asia/Bangkok', 'yyyy-MM-dd');
      clean = clean.replace(/พรุ่งนี้/g, ' ');
      dateMatched = true;
    } else if (clean.indexOf('สัปดาห์หน้า') !== -1 || clean.indexOf('อาทิตย์หน้า') !== -1) {
      var d7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      targetDate = Utilities.formatDate(d7, 'Asia/Bangkok', 'yyyy-MM-dd');
      clean = clean.replace(/สัปดาห์หน้า|อาทิตย์หน้า/g, ' ');
      dateMatched = true;
    } else if (clean.indexOf('วันนี้') !== -1) {
      clean = clean.replace(/วันนี้/g, ' ');
      dateMatched = true;
    }
  }

  // 6. ชื่อวันในสัปดาห์ (วันจันทร์ - วันอาทิตย์, จันทร์หน้า, ศุกร์นี้ ฯลฯ)
  if (!dateMatched) {
    var weekdays = [
      { dow: 0, pats: ['วันอาทิตย์', 'อาทิตย์นี้'] },
      { dow: 1, pats: ['วันจันทร์', 'จันทร์นี้', 'จันทร์หน้า'] },
      { dow: 2, pats: ['วันอังคาร', 'อังคารนี้', 'อังคารหน้า'] },
      { dow: 3, pats: ['วันพุธ', 'พุธนี้', 'พุธหน้า'] },
      { dow: 4, pats: ['วันพฤหัสบดี', 'วันพฤหัส', 'พฤหัสนี้', 'พฤหัสหน้า'] },
      { dow: 5, pats: ['วันศุกร์', 'ศุกร์นี้', 'ศุกร์หน้า'] },
      { dow: 6, pats: ['วันเสาร์', 'เสาร์นี้', 'เสาร์หน้า'] }
    ];
    var bkkParts = todayStr.split('-');
    var bkkDateObj = new Date(parseInt(bkkParts[0], 10), parseInt(bkkParts[1], 10) - 1, parseInt(bkkParts[2], 10));
    var currentDow = bkkDateObj.getDay();
    for (var wi = 0; wi < weekdays.length && !dateMatched; wi++) {
      var wEntry = weekdays[wi];
      for (var wpi = 0; wpi < wEntry.pats.length; wpi++) {
        var wPat = wEntry.pats[wpi];
        if (clean.indexOf(wPat) !== -1) {
          var diff = (wEntry.dow - currentDow + 7) % 7;
          if (diff === 0) diff = 7;
          var dDow = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
          targetDate = Utilities.formatDate(dDow, 'Asia/Bangkok', 'yyyy-MM-dd');
          clean = clean.replace(wPat, ' ');
          dateMatched = true;
          break;
        }
      }
    }
  }

  var targetTime = '09:00';
  var timeMatch = clean.match(/(?:เวลา\\s*)?(\\d{1,2})[:.](\\d{2})(?:\\s*น\\.?)?/);
  if (timeMatch) {
    targetTime = ('0' + timeMatch[1]).slice(-2) + ':' + ('0' + timeMatch[2]).slice(-2);
    clean = clean.replace(timeMatch[0], ' ');
  } else {
    var hourOnlyMatch = clean.match(/เวลา\\s*(\\d{1,2})\\s*(?:โมง|น\\.?)/);
    if (hourOnlyMatch) {
      targetTime = ('0' + hourOnlyMatch[1]).slice(-2) + ':00';
      clean = clean.replace(hourOnlyMatch[0], ' ');
    } else if (clean.indexOf('บ่ายสาม') !== -1 || clean.indexOf('บ่าย 3') !== -1) {
      targetTime = '15:00';
      clean = clean.replace(/บ่ายสาม|บ่าย\\s*3/g, ' ');
    } else if (clean.indexOf('บ่ายสอง') !== -1 || clean.indexOf('บ่าย 2') !== -1) {
      targetTime = '14:00';
      clean = clean.replace(/บ่ายสอง|บ่าย\\s*2/g, ' ');
    } else if (clean.indexOf('บ่ายโมง') !== -1) {
      targetTime = '13:00';
      clean = clean.replace(/บ่ายโมง/g, ' ');
    } else if (clean.indexOf('เที่ยงคืน') !== -1) {
      targetTime = '00:00';
      clean = clean.replace(/เที่ยงคืน/g, ' ');
    } else if (clean.indexOf('เที่ยง') !== -1) {
      targetTime = '12:00';
      clean = clean.replace(/เที่ยง/g, ' ');
    }
  }

  var priority = 'medium';
  if (/#(สูง|ด่วนมาก|ด่วน|high)/i.test(clean)) {
    priority = 'high';
    clean = clean.replace(/#(สูง|ด่วนมาก|ด่วน|high)/gi, ' ');
  } else if (/#(ต่ำ|low)/i.test(clean)) {
    priority = 'low';
    clean = clean.replace(/#(ต่ำ|low)/gi, ' ');
  }

  var title = clean.replace(/\\b(เวลา|วันที่|ตอน|น\\.)\\b/g, ' ').replace(/\\s+/g, ' ').trim() || text;
  return { title: title, date: targetDate, time: targetTime, priority: priority };
}

function formatThaiFullDateInGas(ymdStr) {
  var thaiDays = ['วันอาทิตย์ที่', 'วันจันทร์ที่', 'วันอังคารที่', 'วันพุธที่', 'วันพฤหัสบดีที่', 'วันศุกร์ที่', 'วันเสาร์ที่'];
  var thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var clean = String(ymdStr || '').slice(0, 10);
  var parts = clean.split('-');
  if (parts.length !== 3) return String(ymdStr || '');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12) return String(ymdStr || '');
  var dt = new Date(y, m - 1, d);
  return (thaiDays[dt.getDay()] || 'วันที่') + ' ' + d + ' ' + thaiMonths[m - 1] + ' ' + (y + 543);
}

function formatThaiRangeHeaderInGas(startYmd, endYmd) {
  var thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var sParts = String(startYmd || '').slice(0, 10).split('-');
  var eParts = String(endYmd || '').slice(0, 10).split('-');
  if (sParts.length !== 3 || eParts.length !== 3) return formatThaiFullDateInGas(startYmd);
  var sY = parseInt(sParts[0], 10), sM = parseInt(sParts[1], 10), sD = parseInt(sParts[2], 10);
  var eY = parseInt(eParts[0], 10), eM = parseInt(eParts[1], 10), eD = parseInt(eParts[2], 10);
  var dtS = new Date(sY, sM - 1, sD);
  var dtE = new Date(eY, eM - 1, eD);
  var spanDays = Math.max(1, Math.round((dtE.getTime() - dtS.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  if (sY === eY && sM === eM && sM >= 1 && sM <= 12) {
    return 'วันที่ ' + sD + ' - ' + eD + ' ' + thaiMonths[sM - 1] + ' ' + (sY + 543) + ' (รวม ' + spanDays + ' วัน)';
  }
  return 'วันที่ ' + sD + ' ' + thaiMonths[sM - 1] + ' ' + (sY + 543) + ' - ' + eD + ' ' + thaiMonths[eM - 1] + ' ' + (eY + 543) + ' (รวม ' + spanDays + ' วัน)';
}

function buildSummaryFlexBubble(titleText, dateLabel, rowsList, customOriginUrl) {
  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var nowHM = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  var cleanDateYMD = /^\\d{4}-\\d{2}-\\d{2}/.test(String(dateLabel || '')) ? String(dateLabel).slice(0, 10) : todayStr;
  var fullThaiDate = formatThaiFullDateInGas(cleanDateYMD);
  if (rowsList && rowsList.length > 0) {
    var minS = '';
    var maxE = '';
    var hasMulti = false;
    for (var ri = 0; ri < rowsList.length; ri++) {
      var rowItem = rowsList[ri];
      var rS = String(rowItem[3] || cleanDateYMD).replace(/^'/, '').slice(0, 10);
      var rE = rS;
      var combinedRowText = String(rowItem[1] || '') + ' ' + String(rowItem[2] || '');
      var durM = combinedRowText.match(/(?:เป็นเวลา|ระยะเวลา|จำนวน|รวม|ตลอด)?\\s*(\\d{1,2})\\s*วัน/);
      if (durM) {
        var dCount = parseInt(durM[1], 10);
        if (dCount >= 2 && dCount <= 60) {
          var sp = rS.split('-');
          if (sp.length === 3) {
            var dtEnd = new Date(parseInt(sp[0], 10), parseInt(sp[1], 10) - 1, parseInt(sp[2], 10) + dCount - 1);
            rE = Utilities.formatDate(dtEnd, 'Asia/Bangkok', 'yyyy-MM-dd');
          }
        }
      }
      var rngM = combinedRowText.match(/(?:ระหว่าง\\s*)?(?:วันที่\\s*)?(\\d{1,2})\\s*(?:-|–|—|ถึง)\\s*(?:วันที่\\s*)?(\\d{1,2})/);
      if (rngM && rE === rS) {
        var d1 = parseInt(rngM[1], 10), d2 = parseInt(rngM[2], 10);
        var sp2 = rS.split('-');
        if (sp2.length === 3 && parseInt(sp2[2], 10) === d1 && d2 > d1 && (d2 - d1) <= 60) {
          var dtEnd2 = new Date(parseInt(sp2[0], 10), parseInt(sp2[1], 10) - 1, parseInt(sp2[2], 10) + (d2 - d1));
          rE = Utilities.formatDate(dtEnd2, 'Asia/Bangkok', 'yyyy-MM-dd');
        }
      }
      if (rE > rS) hasMulti = true;
      if (!minS || rS < minS) minS = rS;
      if (!maxE || rE > maxE) maxE = rE;
    }
    if (hasMulti && minS && maxE && maxE > minS) {
      fullThaiDate = formatThaiRangeHeaderInGas(minS, maxE);
    }
  }
  var total = rowsList.length;
  var completed = rowsList.filter(function(r) { return String(r[7]) === 'completed'; }).length;
  var pending = total - completed;

  var sortedRows = rowsList.slice().sort(function(a, b) {
    var tA = String(a[4] || '09:00').replace(/^'/, '');
    var tB = String(b[4] || '09:00').replace(/^'/, '');
    return tA.localeCompare(tB);
  });

  function mapGasCategoryName(rawCat) {
    var c = String(rawCat || '').trim();
    if (!c || c === 'cat-work') return 'งานบริหาร & โปรเจกต์';
    if (c === 'cat-client') return 'นัดหมาย & ประสานงาน';
    if (c === 'cat-urgent') return 'ภารกิจเร่งด่วน';
    if (c === 'cat-finance') return 'เอกสาร & งบประมาณ';
    if (c === 'cat-personal') return 'ภารกิจทั่วไป';
    return c;
  }

  function renderAgendaCard(r, isFirstInGroup) {
    var rTime = String(r[4] || '09:00').replace(/^'/, '');
    var rawStatus = String(r[7] || 'pending');
    var isDone = rawStatus === 'completed';
    var isInProg = rawStatus === 'in_progress';
    var isHigh = String(r[6]) === 'high';
    var catName = mapGasCategoryName(r[5]);

    var badgeLabel = isDone
      ? 'เสร็จสิ้น'
      : (isInProg ? 'กำลังดำเนินการ' : (isHigh ? 'ด่วนมาก' : 'ตามกำหนดการ'));
    var badgeColor = isDone
      ? '#047857'
      : (isInProg ? '#1D4ED8' : (isHigh ? '#B91C1C' : '#475569'));
    var badgeBg = isDone
      ? '#ECFDF5'
      : (isInProg ? '#EFF6FF' : (isHigh ? '#FEF2F2' : '#F1F5F9'));

    var descText = String(r[2] || '').trim();
    var hasDesc = Boolean(descText) &&
      descText !== String(r[1] || '').trim() &&
      descText.indexOf('เพิ่มผ่านแชท LINE') !== 0 &&
      descText.indexOf('บันทึกผ่านแชท LINE') !== 0 &&
      descText.indexOf('เพิ่มผ่านหน้าปฏิทิน') !== 0;

    var innerContents = [
      {
        type: 'box',
        layout: 'horizontal',
        alignItems: 'center',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: isDone ? '#E2E8F0' : '#0F172A',
            cornerRadius: '5px',
            paddingStart: '9px',
            paddingEnd: '9px',
            paddingTop: '3px',
            paddingBottom: '3px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: rTime + ' น.',
                weight: 'bold',
                size: 'xs',
                color: isDone ? '#64748B' : '#FFFFFF'
              }
            ]
          },
          {
            type: 'text',
            text: catName,
            size: 'xxs',
            color: '#64748B',
            flex: 1,
            wrap: false
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: badgeBg,
            cornerRadius: '5px',
            paddingStart: '7px',
            paddingEnd: '7px',
            paddingTop: '3px',
            paddingBottom: '3px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: badgeLabel,
                size: 'xxs',
                weight: 'bold',
                color: badgeColor
              }
            ]
          }
        ]
      },
      {
        type: 'text',
        text: String(r[1] || 'รายการภารกิจ'),
        weight: 'bold',
        size: 'md',
        lineSpacing: '3px',
        color: isDone ? '#94A3B8' : '#0F172A',
        wrap: true,
        margin: 'sm'
      }
    ];

    if (hasDesc) {
      innerContents.push({
        type: 'separator',
        color: '#F1F5F9',
        margin: 'sm'
      });
      innerContents.push({
        type: 'text',
        text: descText,
        size: 'xs',
        lineSpacing: '3px',
        color: isDone ? '#94A3B8' : '#475569',
        wrap: true,
        margin: 'xs'
      });
    }

    return {
      type: 'box',
      layout: 'vertical',
      margin: isFirstInGroup ? 'sm' : 'md',
      backgroundColor: '#FFFFFF',
      cornerRadius: '10px',
      borderWidth: '1px',
      borderColor: (!isDone && isHigh) ? '#FECACA' : '#E2E8F0',
      paddingAll: '13px',
      contents: innerContents
    };
  }

  function appendPeriodGroup(targetArr, periodLabel, items, isFirstSection) {
    if (!items || items.length === 0) return;
    targetArr.push({
      type: 'box',
      layout: 'horizontal',
      alignItems: 'center',
      margin: isFirstSection ? 'none' : 'lg',
      contents: [
        {
          type: 'text',
          text: periodLabel,
          size: 'xs',
          weight: 'bold',
          color: '#334155',
          flex: 1
        },
        {
          type: 'text',
          text: String(items.length) + ' รายการ',
          size: 'xxs',
          weight: 'bold',
          color: '#64748B',
          align: 'end',
          flex: 0
        }
      ]
    });
    for (var pi = 0; pi < items.length; pi++) {
      targetArr.push(renderAgendaCard(items[pi], pi === 0));
    }
  }

  var sectionContents = [];
  if (total === 0) {
    sectionContents.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      backgroundColor: '#FFFFFF',
      cornerRadius: '10px',
      borderWidth: '1px',
      borderColor: '#E2E8F0',
      contents: [
        {
          type: 'text',
          text: 'ไม่มีภารกิจหรือนัดหมายในวันนี้',
          size: 'sm',
          color: '#475569',
          align: 'center',
          weight: 'bold'
        }
      ]
    });
  } else {
    var morningRows = sortedRows.filter(function(r) {
      return String(r[4] || '09:00').replace(/^'/, '') < '12:00';
    });
    var afternoonRows = sortedRows.filter(function(r) {
      return String(r[4] || '09:00').replace(/^'/, '') >= '12:00';
    });
    appendPeriodGroup(sectionContents, 'ภารกิจภาคเช้า (ก่อน 12:00 น.)', morningRows, true);
    appendPeriodGroup(sectionContents, 'ภารกิจภาคบ่าย (ตั้งแต่ 12:00 น.)', afternoonRows, morningRows.length === 0);
  }

  var isPendingQuery = String(titleText || '').indexOf('งานค้าง') !== -1;

  return {
    type: 'flex',
    altText: 'กำหนดการปฏิบัติราชการ (' + fullThaiDate + ') — รวม ' + total + ' ภารกิจ',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0B192C',
        paddingAll: '18px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'text',
                text: isPendingQuery ? 'สรุปภารกิจค้างดำเนินการ' : 'กำหนดการปฏิบัติราชการ',
                color: '#FBBF24',
                size: 'xxs',
                weight: 'bold',
                flex: 1
              },
              {
                type: 'text',
                text: 'รวม ' + String(total) + ' ภารกิจ',
                color: '#94A3B8',
                size: 'xxs',
                align: 'end',
                weight: 'bold',
                flex: 0
              }
            ]
          },
          {
            type: 'text',
            text: fullThaiDate,
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            margin: 'xs',
            wrap: true
          },
          {
            type: 'text',
            text: 'สำนักบริหารแรงงานต่างด้าว',
            color: '#94A3B8',
            size: 'xxs',
            margin: 'xs'
          },
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#132640',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'md',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(total), weight: 'bold', size: 'md', color: '#FFFFFF', align: 'center' },
                  { type: 'text', text: 'ทั้งหมด', size: 'xxs', color: '#94A3B8', align: 'center' }
                ]
              },
              { type: 'separator', color: '#1E3A5F' },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(pending), weight: 'bold', size: 'md', color: '#FBBF24', align: 'center' },
                  { type: 'text', text: 'รอดำเนินการ', size: 'xxs', color: '#94A3B8', align: 'center' }
                ]
              },
              { type: 'separator', color: '#1E3A5F' },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(completed), weight: 'bold', size: 'md', color: '#34D399', align: 'center' },
                  { type: 'text', text: 'เสร็จสิ้นแล้ว', size: 'xxs', color: '#94A3B8', align: 'center' }
                ]
              }
            ]
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F8FAFC',
        paddingAll: '16px',
        contents: sectionContents
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        backgroundColor: '#FFFFFF',
        borderWidth: '1px',
        borderColor: '#E2E8F0',
        contents: (function() {
          var targetCalUrl = getCalendarDeepLink(customOriginUrl, cleanDateYMD);
          var scheduleUrl = targetCalUrl.indexOf('section=calendar') !== -1
            ? targetCalUrl.replace('section=calendar', 'section=schedule')
            : targetCalUrl;
          return [
            {
              type: 'button',
              style: 'primary',
              color: '#0F172A',
              height: 'sm',
              action: { type: 'uri', label: 'เปิดตารางงานนำเสนอ (รายวัน)', uri: scheduleUrl }
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'uri', label: 'เปิดดูปฏิทินและจัดการงาน', uri: targetCalUrl }
            }
          ];
        })()
      }
    }
  };
}

function formatCellDateYMD(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  var s = String(val).replace(/^'/, '').trim();
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
  var m = s.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  return s;
}

function formatCellTimeHM(val, sheetTz) {
  if (!val) return '09:00';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    var tz = (val.getFullYear && val.getFullYear() < 1905 && sheetTz) ? sheetTz : 'Asia/Bangkok';
    return Utilities.formatDate(val, tz, 'HH:mm');
  }
  var s = String(val).replace(/^'/, '').trim();
  var m = s.match(/(\\d{1,2})[:.](\\d{2})/);
  if (m) {
    var hh = parseInt(m[1], 10);
    if (/pm/i.test(s) && hh < 12) hh += 12;
    if (/am/i.test(s) && hh === 12) hh = 0;
    return ('0' + hh).slice(-2) + ':' + m[2];
  }
  return '09:00';
}

function getSavedTasksFromProperties() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('SAVED_TASKS_JSON');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {}
  return null;
}

function saveTasksToProperties(tasksList) {
  try {
    if (Array.isArray(tasksList)) {
      PropertiesService.getScriptProperties().setProperty('SAVED_TASKS_JSON', JSON.stringify(tasksList));
    }
  } catch (err) {}
}

function getCleanServerOrigin() {
  var raw = String((typeof MAIN_SERVER_URL !== 'undefined' && MAIN_SERVER_URL) ? MAIN_SERVER_URL : (WEB_APP_URL || '')).trim();
  if (!raw || raw.indexOf('http') !== 0 || raw.indexOf('calendar.google.com') !== -1 || raw.indexOf('script.google.com') !== -1) {
    return '';
  }
  var base = raw.split('?')[0];
  while (base.length > 0 && base.charAt(base.length - 1) === '/') {
    base = base.slice(0, -1);
  }
  return base;
}

function fetchTasksFromMainWebApp() {
  try {
    var cleanBase = getCleanServerOrigin();
    if (!cleanBase) return null;
    var resp = UrlFetchApp.fetch(cleanBase + '/api/collab/workspace/sheetcal-team-clean', {
      method: 'get',
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      var data = JSON.parse(resp.getContentText() || '{}');
      if (data && data.workspace && Array.isArray(data.workspace.tasks) && data.workspace.tasks.length > 0) {
        return data.workspace.tasks;
      }
    }
  } catch (err) {}
  return null;
}

function pushTasksToMainWebApp(tasksList) {
  try {
    var cleanBase = getCleanServerOrigin();
    if (!cleanBase) return;
    UrlFetchApp.fetch(cleanBase + '/api/collab/workspace/sheetcal-team-clean', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        updatedBy: 'LINE Group Portal',
        tasks: tasksList
      }),
      muteHttpExceptions: true
    });
  } catch (err) {}
}

function readSheetTasksForWeb() {
  var sheetTasks = null;
  var hasTasksSheet = false;
  try {
    var ss = openSafeSpreadsheet();
    if (ss) {
      var sheetTz = ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Bangkok';
      var taskSheet = ss.getSheetByName('Tasks');
      if (taskSheet) {
        hasTasksSheet = true;
        if (taskSheet.getLastRow() > 1) {
          var range = taskSheet.getDataRange();
          var rows = range.getValues().slice(1);
          var dispRows = range.getDisplayValues().slice(1);
          sheetTasks = rows.map(function(r, idx) {
            var dr = dispRows[idx] || [];
            var rawSourceStr = String(r[10] || 'sheets');
            var metaDate = '';
            var metaTime = '';
            var metaEnd = '';
            if (rawSourceStr.indexOf('#SCMETA#') !== -1) {
              try {
                var metaJson = rawSourceStr.split('#SCMETA#')[1];
                var parsedM = JSON.parse(metaJson);
                if (parsedM && parsedM.d) metaDate = String(parsedM.d);
                if (parsedM && parsedM.t) metaTime = String(parsedM.t);
                if (parsedM && parsedM.e) metaEnd = String(parsedM.e);
              } catch (e) {}
            }
            var startD = metaDate || formatCellDateYMD(dr[3] || r[3]);
            var endD = metaEnd || ((dr[14] || r[14]) ? formatCellDateYMD(dr[14] || r[14]) : '');
            var timeHM = metaTime || formatCellTimeHM(dr[4] || r[4], sheetTz);
            return {
              id: String(r[0] || ('sheet-task-' + idx)),
              title: String(r[1] || 'งาน'),
              description: String(r[2] || ''),
              date: startD,
              endDate: (endD && endD > startD) ? endD : undefined,
              time: timeHM,
              categoryId: String(r[5] || 'cat-work'),
              priority: String(r[6] || 'medium'),
              status: String(r[7] || 'pending'),
              remindMinutesBefore: Number(r[8] || 1),
              lineNotified: String(r[9]).toUpperCase() === 'TRUE',
              source: rawSourceStr,
              updatedAt: String(r[11] || new Date().toISOString())
            };
          }).filter(function(t) { return Boolean(t.title && t.date); });
        } else {
          sheetTasks = [];
        }
      }
    }
  } catch (err) {}

  var propTasks = getSavedTasksFromProperties();
  var hasSyncedBefore = false;
  try {
    hasSyncedBefore = PropertiesService.getScriptProperties().getProperty('HAS_SYNCED_TASKS') === 'true';
  } catch (err) {}

  if (Array.isArray(sheetTasks) && hasTasksSheet) {
    saveTasksToProperties(sheetTasks);
    return sheetTasks;
  }
  if (Array.isArray(propTasks)) {
    return propTasks;
  }
  var webTasks = fetchTasksFromMainWebApp();
  if (Array.isArray(webTasks)) {
    saveTasksToProperties(webTasks);
    return webTasks;
  }
  if (!hasSyncedBefore && typeof INITIAL_WEB_TASKS !== 'undefined' && Array.isArray(INITIAL_WEB_TASKS)) {
    return INITIAL_WEB_TASKS;
  }
  return [];
}

function writeSheetTasksFromWeb(tasksList) {
  var validList = Array.isArray(tasksList) ? tasksList.filter(function(t) { return Boolean(t && t.title); }) : [];
  try {
    PropertiesService.getScriptProperties().setProperty('HAS_SYNCED_TASKS', 'true');
  } catch (err) {}
  saveTasksToProperties(validList);
  pushTasksToMainWebApp(validList);
  try {
    var ss = openSafeSpreadsheet();
    if (!ss) return true;
    var taskSheet = ss.getSheetByName('Tasks') || ss.insertSheet('Tasks');
    taskSheet.clearContents();
    var rows = [
      ['ID', 'Title', 'Description', 'Date (YYYY-MM-DD)', 'Time (HH:mm)', 'CategoryID', 'Priority', 'Status', 'RemindMinutesBefore', 'LineNotified', 'Source', 'UpdatedAt', 'AssigneeID', 'AssigneeName', 'EndDate (YYYY-MM-DD)']
    ];
    validList.forEach(function(t) {
      rows.push([
        String(t.id || ('task-' + new Date().getTime())),
        String(t.title || ''),
        String(t.description || ''),
        "'" + String(t.date || ''),
        "'" + String(t.time || '09:00'),
        String(t.categoryId || 'cat-work'),
        String(t.priority || 'medium'),
        String(t.status || 'pending'),
        Number(t.remindMinutesBefore || 1),
        (t.lineNotified || String(t.status || '').trim().toLowerCase() === 'completed') ? 'TRUE' : 'FALSE',
        String(t.source || 'web'),
        String(t.updatedAt || new Date().toISOString()),
        String(t.assigneeId || ''),
        String(t.assigneeName || ''),
        (t.endDate && String(t.endDate) > String(t.date)) ? ("'" + String(t.endDate)) : ''
      ]);
    });
    taskSheet.getRange(1, 1, rows.length, 15).setValues(rows);
    return true;
  } catch (err) {
    return true;
  }
}

function clearAllRichMenusFromLine(rawToken, targetUserId) {
  var token = String(rawToken || LINE_CHANNEL_ACCESS_TOKEN || '').replace(/^Bearer\\s+/i, '').trim();
  if (!token || token.indexOf('วาง_LINE_') !== -1) {
    return { ok: false, deletedCount: 0, message: 'Missing LINE Channel Access Token' };
  }
  var deletedCount = 0;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/user/all/richmenu', {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (targetUserId && /^U[0-9a-fA-F]{32}$/.test(String(targetUserId).trim())) {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/user/' + encodeURIComponent(String(targetUserId).trim()) + '/richmenu', {
        method: 'delete',
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      });
    }
    var listResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/list', {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (listResp.getResponseCode() >= 200 && listResp.getResponseCode() < 300) {
      var listData = JSON.parse(listResp.getContentText() || '{}');
      var menus = listData.richmenus || [];
      for (var i = 0; i < menus.length; i++) {
        if (menus[i] && menus[i].richMenuId) {
          var delResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu/' + encodeURIComponent(menus[i].richMenuId), {
            method: 'delete',
            headers: { 'Authorization': 'Bearer ' + token },
            muteHttpExceptions: true
          });
          if (delResp.getResponseCode() >= 200 && delResp.getResponseCode() < 300) {
            deletedCount++;
          }
        }
      }
    }
    return { ok: true, deletedCount: deletedCount };
  } catch (err) {
    return { ok: false, deletedCount: deletedCount, message: String(err) };
  }
}

function getSavedLineToken() {
  var configured = String(LINE_CHANNEL_ACCESS_TOKEN || '').replace(/^Bearer\\s+/i, '').trim();
  if (configured && configured.indexOf('วาง_LINE_') === -1 && configured.indexOf('PUT_YOUR_') === -1) {
    return configured;
  }
  try {
    var saved = PropertiesService.getScriptProperties().getProperty('SAVED_LINE_TOKEN') || '';
    if (saved && saved.length > 40) return saved;
  } catch (err) {}
  return '';
}

function setSavedLineToken(rawToken) {
  try {
    var clean = String(rawToken || '').replace(/^Bearer\\s+/i, '').trim();
    if (clean && clean.length > 40 && clean.indexOf('วาง_LINE_') === -1) {
      PropertiesService.getScriptProperties().setProperty('SAVED_LINE_TOKEN', clean);
    }
  } catch (err) {}
}

function getSavedGroupId() {
  try {
    var gid = PropertiesService.getScriptProperties().getProperty('LAST_GROUP_ID') || '';
    if (/^[CR][0-9a-fA-F]{32}$/.test(gid)) return gid;
  } catch (err) {}
  if (typeof INITIAL_GROUP_ID !== 'undefined' && /^[CR][0-9a-fA-F]{32}$/.test(String(INITIAL_GROUP_ID).trim())) {
    return String(INITIAL_GROUP_ID).trim();
  }
  return '';
}

function setSavedGroupId(gid) {
  try {
    if (gid && /^[CR][0-9a-fA-F]{32}$/.test(String(gid).trim())) {
      PropertiesService.getScriptProperties().setProperty('LAST_GROUP_ID', String(gid).trim());
    }
  } catch (err) {}
}

function getSavedUserId() {
  try {
    var uid = PropertiesService.getScriptProperties().getProperty('LAST_USER_ID') || '';
    if (/^U[0-9a-fA-F]{32}$/.test(uid)) return uid;
  } catch (err) {}
  return '';
}

function setSavedUserId(uid) {
  try {
    if (uid && /^U[0-9a-fA-F]{32}$/.test(String(uid).trim())) {
      PropertiesService.getScriptProperties().setProperty('LAST_USER_ID', String(uid).trim());
    }
  } catch (err) {}
}

function getAllowAddTaskFromLine() {
  try {
    var val = PropertiesService.getScriptProperties().getProperty('ALLOW_ADD_TASK_FROM_LINE');
    if (val === 'false' || val === '0') return false;
  } catch (err) {}
  return true;
}

function setAllowAddTaskFromLine(allowed) {
  try {
    PropertiesService.getScriptProperties().setProperty('ALLOW_ADD_TASK_FROM_LINE', allowed === false ? 'false' : 'true');
  } catch (err) {}
}

function openSafeSpreadsheet() {
  try {
    if (
      SPREADSHEET_ID &&
      SPREADSHEET_ID.indexOf('PUT_YOUR_') === -1 &&
      SPREADSHEET_ID.indexOf('วาง_SPREADSHEET_ID') === -1
    ) {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    }
  } catch (err) {}
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err2) {}
  try {
    var savedAutoId = PropertiesService.getScriptProperties().getProperty('AUTO_CREATED_SHEET_ID') || '';
    if (savedAutoId) {
      return SpreadsheetApp.openById(savedAutoId);
    }
  } catch (err3) {}
  try {
    var created = SpreadsheetApp.create('ระบบน้องเลขา — ตารางงานของทีม');
    if (created && created.getId()) {
      PropertiesService.getScriptProperties().setProperty('AUTO_CREATED_SHEET_ID', created.getId());
      return created;
    }
  } catch (err4) {}
  return null;
}

function addTeamTaskFromPortal(title, dateStr, timeStr, priorityVal) {
  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var cleanTitle = String(title || '').trim();
  var currentTasks = readSheetTasksForWeb();
  if (!cleanTitle) return currentTasks;
  var cleanDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateStr || '').trim()) ? String(dateStr).trim() : todayStr;
  var cleanTime = /^\\d{2}:\\d{2}$/.test(String(timeStr || '').trim()) ? String(timeStr).trim() : '09:00';
  var cleanPrio = (priorityVal === 'high' || priorityVal === 'low') ? priorityVal : 'medium';
  var newTask = {
    id: 'task-' + now.getTime(),
    title: cleanTitle,
    description: 'เพิ่มผ่านหน้าปฏิทินทีม (LINE Group Portal)',
    date: cleanDate,
    time: cleanTime,
    categoryId: 'cat-work',
    priority: cleanPrio,
    status: 'pending',
    remindMinutesBefore: 1,
    lineNotified: false,
    source: 'web',
    updatedAt: now.toISOString()
  };
  var nextTasks = [newTask].concat(currentTasks);
  writeSheetTasksFromWeb(nextTasks);
  return nextTasks;
}

function toggleTeamTaskStatusFromPortal(taskId) {
  var currentTasks = readSheetTasksForWeb();
  if (!taskId) return currentTasks;
  var nowIso = new Date().toISOString();
  var nextTasks = currentTasks.map(function(t) {
    if (String(t.id) === String(taskId)) {
      return {
        id: t.id,
        title: t.title,
        description: t.description || '',
        date: t.date,
        time: t.time || '09:00',
        categoryId: t.categoryId || 'cat-work',
        priority: t.priority || 'medium',
        status: t.status === 'completed' ? 'pending' : 'completed',
        remindMinutesBefore: t.remindMinutesBefore || 1,
        lineNotified: Boolean(t.lineNotified),
        source: t.source || 'web',
        updatedAt: nowIso
      };
    }
    return t;
  });
  writeSheetTasksFromWeb(nextTasks);
  return nextTasks;
}

function deleteTeamTaskFromPortal(taskId) {
  var currentTasks = readSheetTasksForWeb();
  if (!taskId) return currentTasks;
  var nextTasks = currentTasks.filter(function(t) {
    return String(t.id) !== String(taskId);
  });
  writeSheetTasksFromWeb(nextTasks);
  return nextTasks;
}

function escapeServerHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function doGet(e) {
  var tasks = readSheetTasksForWeb();
  var params = (e && e.parameter) ? e.parameter : {};
  if (params.format === 'json' || params.action === 'get_tasks' || params.action === 'check_bridge') {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'verified',
        version: '3.4-telegram-photo-cards-24x7',
        cardDesignVersion: '3.4-telegram-photo-cards-24x7',
        capabilities: ['webhook', 'push_line', 'get_tasks', 'sync_tasks', 'clear_richmenu', 'group_chat', 'team_portal', 'executive_card_v3', 'telegram_photo_cards_24x7'],
        detectedGroupId: getSavedGroupId(),
        detectedUserId: getSavedUserId(),
        tasks: tasks,
        message: 'ระบบน้องเลขา Webhook & Telegram Photo Cards 24/7 Ready (v3.4)'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var initDate = (params.date && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(params.date))) ? String(params.date) : todayStr;
  var sheetUrl = getSpreadsheetDirectUrl();
  var selfGasUrl = getSelfWebAppUrl();
  var mainOrigin = getCleanServerOrigin();
  var totalCount = tasks.length;
  var doneCount = tasks.filter(function(t) { return t.status === 'completed'; }).length;
  var pendingCount = totalCount - doneCount;

  var sortedInitial = tasks.slice().sort(function(a, b) {
    return String(a.date + ' ' + a.time).localeCompare(String(b.date + ' ' + b.time));
  });
  var initialListHtml = sortedInitial.length === 0
    ? '<p class="empty-msg">ยังไม่มีรายการงานในระบบ</p>'
    : sortedInitial.map(function(t) {
        var isDone = t.status === 'completed';
        var isHigh = t.priority === 'high';
        return '<div class="task-item' + (isDone ? ' done' : '') + '">' +
          '<div><div class="task-title">' + escapeServerHtml(t.title) +
          (isHigh ? '<span class="badge-high">🔥 ด่วน</span>' : '') + '</div>' +
          '<div class="task-meta">🗓️ ' + escapeServerHtml(t.date) + ' · ⏰ ' + escapeServerHtml(t.time) + ' น. · ' +
          (isDone ? '✓ เสร็จแล้ว' : '⏳ รอดำเนินการ') + '</div></div>' +
          '<div class="actions">' +
          '<button class="btn-act btn-done" data-id="' + escapeServerHtml(t.id) + '" onclick="handleToggle(this.getAttribute(\\'data-id\\'))">' +
          (isDone ? '↩ ย้อนสถานะ' : '✓ เสร็จแล้ว') + '</button>' +
          '<button class="btn-act btn-del" data-id="' + escapeServerHtml(t.id) + '" onclick="handleDelete(this.getAttribute(\\'data-id\\'))">🗑️</button>' +
          '</div></div>';
      }).join('');

  var safeTasksJson = JSON.stringify(tasks).replace(/</g, '\\\\u003c');
  var isPublicMainOrigin = Boolean(
    mainOrigin &&
    mainOrigin.indexOf('https://ais-dev-') !== 0 &&
    mainOrigin.indexOf('https://ais-pre-') !== 0
  );

  var html = [
    '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">',
    '<title>ระบบน้องเลขา — ปฏิทินและจัดการงานของทีม</title>',
    '<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap" rel="stylesheet">',
    '<style>',
    '*{box-sizing:border-box;font-family:"Prompt",sans-serif;}',
    'body{margin:0;background:#F1F5F9;color:#0F172A;padding:12px;}',
    '.wrap{max-width:860px;margin:0 auto;}',
    '.header{background:linear-gradient(135deg,#06C755,#059669);color:#fff;padding:18px;border-radius:16px;box-shadow:0 6px 20px rgba(6,199,85,0.22);margin-bottom:14px;}',
    '.header h1{margin:0 0 4px 0;font-size:19px;font-weight:700;}',
    '.header p{margin:0;font-size:12px;opacity:0.95;}',
    '.top-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    '.btn-link{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;font-size:12px;font-weight:600;text-decoration:none;background:rgba(255,255,255,0.2);color:#fff;border:1px solid rgba(255,255,255,0.35);cursor:pointer;}',
    '.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}',
    '.stat-card{background:#fff;padding:12px;border-radius:14px;text-align:center;border:1px solid #E2E8F0;}',
    '.stat-num{font-size:20px;font-weight:700;}',
    '.stat-lbl{font-size:11px;color:#64748B;}',
    '.card{background:#fff;border-radius:16px;padding:16px;border:1px solid #E2E8F0;margin-bottom:14px;box-shadow:0 2px 8px rgba(15,23,42,0.04);}',
    '.card-title{font-size:14px;font-weight:700;margin:0 0 10px 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;}',
    '.cal-nav{display:flex;align-items:center;gap:6px;}',
    '.btn-nav{padding:5px 10px;border-radius:8px;border:1px solid #CBD5E1;background:#F8FAFC;font-size:12px;font-weight:600;cursor:pointer;color:#0F172A;}',
    '.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}',
    '.cal-dow{text-align:center;font-size:11px;font-weight:700;color:#64748B;padding:6px 0;}',
    '.cal-cell{min-height:68px;border:1px solid #E2E8F0;border-radius:10px;padding:5px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:2px;transition:all 0.15s;}',
    '.cal-cell:hover{border-color:#06C755;background:#F0FDF4;}',
    '.cal-cell.other{opacity:0.38;background:#F8FAFC;}',
    '.cal-cell.today{border-color:#06C755;background:#ECFDF5;}',
    '.cal-cell.selected{border:2px solid #059669;background:#DCFCE7;}',
    '.cal-daynum{font-size:11px;font-weight:700;color:#0F172A;display:flex;justify-content:space-between;align-items:center;}',
    '.cal-cnt{font-size:9px;background:#06C755;color:#fff;padding:1px 5px;border-radius:99px;}',
    '.cal-pill{font-size:9px;padding:1px 4px;border-radius:4px;background:#E0E7FF;color:#1E1B4B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.cal-pill.high{background:#FEE2E2;color:#991B1B;}',
    '.cal-pill.done{background:#DCFCE7;color:#166534;text-decoration:line-through;}',
    '.filter-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}',
    '.tab{padding:6px 12px;border-radius:9px;border:1px solid #CBD5E1;background:#F8FAFC;font-size:12px;font-weight:600;cursor:pointer;color:#334155;}',
    '.tab.active{background:#06C755;color:#fff;border-color:#06C755;}',
    '.form-grid{display:grid;grid-template-columns:1fr 130px 100px;gap:8px;margin-bottom:8px;}',
    '@media(max-width:520px){.form-grid{grid-template-columns:1fr 1fr;}.cal-cell{min-height:54px;padding:3px;}}',
    'input,select{width:100%;padding:9px 11px;border-radius:10px;border:1px solid #CBD5E1;font-size:13px;background:#fff;}',
    '.btn-add{width:100%;padding:10px;border-radius:10px;border:none;background:#06C755;color:#fff;font-size:13px;font-weight:700;cursor:pointer;}',
    '.btn-add:disabled{opacity:0.6;}',
    '.sync-banner{display:none;margin-top:8px;padding:8px 12px;border-radius:10px;background:#DCFCE7;border:1px solid #86EFAC;color:#14532D;font-size:12px;font-weight:600;}',
    '.empty-msg{text-align:center;color:#64748B;font-size:13px;padding:18px 0;margin:0;}',
    '.task-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-radius:12px;border:1px solid #E2E8F0;margin-bottom:8px;background:#F8FAFC;}',
    '.task-item.done{background:#F0FDF4;border-color:#BBF7D0;opacity:0.85;}',
    '.task-title{font-size:14px;font-weight:600;margin:0 0 3px 0;}',
    '.task-item.done .task-title{text-decoration:line-through;color:#15803D;}',
    '.task-meta{font-size:11px;color:#64748B;}',
    '.badge-high{display:inline-block;padding:2px 7px;border-radius:6px;background:#FEE2E2;color:#DC2626;font-size:10px;font-weight:700;margin-left:6px;}',
    '.actions{display:flex;gap:6px;flex-shrink:0;}',
    '.btn-act{padding:6px 10px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;font-size:11px;font-weight:600;cursor:pointer;}',
    '.btn-done{background:#DCFCE7;border-color:#86EFAC;color:#15803D;}',
    '.btn-del{background:#FEE2E2;border-color:#FCA5A5;color:#B91C1C;}',
    '</style></head><body><div class="wrap">',
    '<div class="header">',
    '<h1>📅 ปฏิทินและจัดการงานของทีม (ระบบน้องเลขา)</h1>',
    '<p>หน้าเว็บปฏิทินกลางสำหรับสมาชิกทุกคนในกลุ่ม LINE — คลิกเลือกวันบนปฏิทิน เพิ่มงานใหม่ และติ๊กงานเสร็จได้ทันที (ซิงค์ Google Sheets อัตโนมัติ)</p>',
    '<div class="top-links">',
    (sheetUrl ? '<a class="btn-link" href="' + sheetUrl + '" target="_blank">📊 เปิดตาราง Google Sheets</a>' : ''),
    (isPublicMainOrigin ? '<a class="btn-link" href="' + mainOrigin + '" target="_blank">💻 เปิดหน้าเว็บระบบหลัก</a>' : ''),
    '</div></div>',
    '<div class="stats">',
    '<div class="stat-card"><div class="stat-num" id="stTotal">' + totalCount + '</div><div class="stat-lbl">งานทั้งหมด</div></div>',
    '<div class="stat-card"><div class="stat-num" style="color:#D97706" id="stPending">' + pendingCount + '</div><div class="stat-lbl">รอดำเนินการ</div></div>',
    '<div class="stat-card"><div class="stat-num" style="color:#16A34A" id="stDone">' + doneCount + '</div><div class="stat-lbl">เสร็จแล้ว</div></div>',
    '</div>',
    '<div class="card">',
    '<div class="card-title">',
    '<span id="calMonthLabel">🗓️ ตารางปฏิทินรายเดือน</span>',
    '<div class="cal-nav">',
    '<button type="button" class="btn-nav" onclick="changeMonth(-1)">◀ เดือนก่อน</button>',
    '<button type="button" class="btn-nav" onclick="goToday()">วันนี้</button>',
    '<button type="button" class="btn-nav" onclick="changeMonth(1)">เดือนถัดไป ▶</button>',
    '</div></div>',
    '<div class="cal-grid" id="calHeader">',
    '<div class="cal-dow" style="color:#EF4444">อา</div><div class="cal-dow">จ</div><div class="cal-dow">อ</div><div class="cal-dow">พ</div><div class="cal-dow">พฤ</div><div class="cal-dow">ศ</div><div class="cal-dow" style="color:#6366F1">ส</div>',
    '</div>',
    '<div class="cal-grid" id="calGrid"></div>',
    '</div>',
    '<div class="card">',
    '<div class="card-title"><span>➕ เพิ่มงานใหม่เข้าปฏิทินของทีม</span></div>',
    '<div class="form-grid">',
    '<input type="text" id="inpTitle" placeholder="ชื่องาน เช่น ประชุมสรุปยอด..." onkeydown="if(event.key===\\'Enter\\')handleAdd()" />',
    '<input type="date" id="inpDate" value="' + initDate + '" />',
    '<input type="time" id="inpTime" value="09:00" />',
    '</div>',
    '<div style="display:flex;gap:8px;align-items:center;">',
    '<select id="inpPrio" style="max-width:160px;"><option value="medium">ความสำคัญ: ปกติ</option><option value="high">🔥 ด่วน (#สูง)</option></select>',
    '<button type="button" class="btn-add" id="btnAdd" onclick="handleAdd()">+ บันทึกงานลงปฏิทินทีม</button>',
    '</div>',
    '<div id="syncBanner" class="sync-banner"></div>',
    '</div>',
    '<div class="card">',
    '<div class="card-title"><span id="listHeaderTitle">📋 รายการงานในปฏิทิน</span>',
    '<div class="filter-bar">',
    '<button type="button" class="tab" id="tabDate" onclick="setMode(\\'date\\')">เฉพาะวันที่เลือก</button>',
    '<button type="button" class="tab active" id="tabAll" onclick="setMode(\\'all\\')">ดูงานทั้งหมด</button>',
    '<input type="date" id="filterDate" value="' + initDate + '" onchange="onDateChange()" style="width:auto;padding:5px 8px;font-size:12px;" />',
    '</div></div>',
    '<div id="taskList">' + initialListHtml + '</div>',
    '</div></div>',
    '<script>',
    'var tasks = ' + safeTasksJson + ';',
    'var mainWebAppUrl = ' + JSON.stringify(mainOrigin || '') + ';',
    'var selfGasUrl = ' + JSON.stringify(selfGasUrl || '') + ';',
    'var todayStr = "' + todayStr + '";',
    'var filterMode = "all";',
    'var selectedDate = "' + initDate + '";',
    'var initParts = selectedDate.split("-");',
    'var viewYear = parseInt(initParts[0], 10) || new Date().getFullYear();',
    'var viewMonth = (parseInt(initParts[1], 10) || (new Date().getMonth() + 1)) - 1;',
    'var thaiMonthsFull = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];',
    'function pad2(n){ return n < 10 ? "0" + n : String(n); }',
    'function showBanner(msg){',
    '  var b = document.getElementById("syncBanner");',
    '  if(!b) return;',
    '  b.textContent = msg;',
    '  b.style.display = "block";',
    '  setTimeout(function(){ b.style.display = "none"; }, 3500);',
    '}',
    'function getCleanOrigin(u){',
    '  var s = String(u || "").split("?")[0];',
    '  while(s.length > 0 && s.charAt(s.length - 1) === "/"){ s = s.slice(0, -1); }',
    '  return s;',
    '}',
    'function mergeClientTasks(localArr, remoteArr){',
    '  var map = {};',
    '  var order = [];',
    '  [localArr, remoteArr].forEach(function(arr){',
    '    if(!Array.isArray(arr)) return;',
    '    arr.forEach(function(item){',
    '      if(!item || !item.id || !item.title) return;',
    '      var k = String(item.id);',
    '      if(!map[k]){ map[k] = item; order.push(k); }',
    '      else {',
    '        var t1 = map[k].updatedAt ? new Date(map[k].updatedAt).getTime() : 0;',
    '        var t2 = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;',
    '        if(t2 >= t1) map[k] = item;',
    '      }',
    '    });',
    '  });',
    '  return order.map(function(k){ return map[k]; });',
    '}',
    'function syncWithMainServer(actionPayload){',
    '  var cleanOrigin = getCleanOrigin(mainWebAppUrl);',
    '  if(cleanOrigin && cleanOrigin.indexOf("http") === 0 && cleanOrigin.indexOf("calendar.google.com") === -1 && cleanOrigin.indexOf("script.google.com") === -1){',
    '    var apiUrl = cleanOrigin + "/api/collab/workspace/sheetcal-team-clean";',
    '    if(actionPayload){',
    '      fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actionPayload) }).then(function(r){ return r.json(); }).then(function(d){ if(d && d.workspace && Array.isArray(d.workspace.tasks)){ tasks = actionPayload.action === "delete_task" ? d.workspace.tasks : mergeClientTasks(tasks, d.workspace.tasks); render(); } }).catch(function(){});',
    '    } else {',
    '      fetch(apiUrl).then(function(r){ return r.json(); }).then(function(d){ if(d && d.workspace && Array.isArray(d.workspace.tasks) && d.workspace.tasks.length > 0){ tasks = mergeClientTasks(tasks, d.workspace.tasks); render(); } }).catch(function(){});',
    '    }',
    '  }',
    '  if(actionPayload && selfGasUrl && selfGasUrl.indexOf("https://script.google.com") === 0){',
    '    fetch(selfGasUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "sync_tasks", tasks: tasks }) }).catch(function(){});',
    '  }',
    '}',
    'function changeMonth(delta){',
    '  viewMonth += delta;',
    '  if(viewMonth < 0){ viewMonth = 11; viewYear--; }',
    '  if(viewMonth > 11){ viewMonth = 0; viewYear++; }',
    '  renderCalendarGrid();',
    '}',
    'function goToday(){',
    '  selectedDate = todayStr;',
    '  var p = todayStr.split("-");',
    '  viewYear = parseInt(p[0], 10);',
    '  viewMonth = parseInt(p[1], 10) - 1;',
    '  document.getElementById("inpDate").value = selectedDate;',
    '  document.getElementById("filterDate").value = selectedDate;',
    '  setMode("date");',
    '}',
    'function selectCalendarDate(ymd){',
    '  selectedDate = ymd;',
    '  document.getElementById("inpDate").value = ymd;',
    '  document.getElementById("filterDate").value = ymd;',
    '  setMode("date");',
    '}',
    'function renderCalendarGrid(){',
    '  var lbl = document.getElementById("calMonthLabel");',
    '  if(lbl) lbl.textContent = "🗓️ ปฏิทินเดือน " + thaiMonthsFull[viewMonth] + " " + (viewYear + 543);',
    '  var grid = document.getElementById("calGrid");',
    '  if(!grid) return;',
    '  grid.innerHTML = "";',
    '  var firstDay = new Date(viewYear, viewMonth, 1).getDay();',
    '  var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();',
    '  for(var i = 0; i < firstDay; i++){',
    '    var emptyCell = document.createElement("div");',
    '    emptyCell.className = "cal-cell other";',
    '    grid.appendChild(emptyCell);',
    '  }',
    '  for(var d = 1; d <= daysInMonth; d++){',
    '    (function(dayNum){',
    '      var ymd = viewYear + "-" + pad2(viewMonth + 1) + "-" + pad2(dayNum);',
    '      var dayTasks = tasks.filter(function(t){ return t.date === ymd; });',
    '      var cell = document.createElement("div");',
    '      var cls = "cal-cell";',
    '      if(ymd === todayStr) cls += " today";',
    '      if(ymd === selectedDate) cls += " selected";',
    '      cell.className = cls;',
    '      cell.onclick = function(){ selectCalendarDate(ymd); };',
    '      var topRow = document.createElement("div");',
    '      topRow.className = "cal-daynum";',
    '      var numSpan = document.createElement("span");',
    '      numSpan.textContent = String(dayNum);',
    '      topRow.appendChild(numSpan);',
    '      if(dayTasks.length > 0){',
    '        var cntSpan = document.createElement("span");',
    '        cntSpan.className = "cal-cnt";',
    '        cntSpan.textContent = String(dayTasks.length);',
    '        topRow.appendChild(cntSpan);',
    '      }',
    '      cell.appendChild(topRow);',
    '      dayTasks.slice(0, 2).forEach(function(tk){',
    '        var pill = document.createElement("div");',
    '        pill.className = "cal-pill" + (tk.status === "completed" ? " done" : (tk.priority === "high" ? " high" : ""));',
    '        pill.textContent = (tk.time ? tk.time + " " : "") + (tk.title || "งาน");',
    '        cell.appendChild(pill);',
    '      });',
    '      grid.appendChild(cell);',
    '    })(d);',
    '  }',
    '}',
    'function render(){',
    '  renderCalendarGrid();',
    '  var total = tasks.length;',
    '  var done = tasks.filter(function(t){return t.status==="completed";}).length;',
    '  document.getElementById("stTotal").textContent = String(total);',
    '  document.getElementById("stPending").textContent = String(total - done);',
    '  document.getElementById("stDone").textContent = String(done);',
    '  var hdr = document.getElementById("listHeaderTitle");',
    '  if(hdr) hdr.textContent = filterMode === "date" ? ("📋 รายการงานวันที่ " + selectedDate) : "📋 รายการงานทั้งหมดในปฏิทิน";',
    '  var list = filterMode === "date" ? tasks.filter(function(t){return t.date === selectedDate;}) : tasks.slice();',
    '  list.sort(function(a,b){ return String(a.date+" "+a.time).localeCompare(String(b.date+" "+b.time)); });',
    '  var el = document.getElementById("taskList");',
    '  el.innerHTML = "";',
    '  if(list.length === 0){',
    '    var p = document.createElement("p");',
    '    p.className = "empty-msg";',
    '    p.textContent = "ยังไม่มีรายการงานในวันที่เลือก";',
    '    el.appendChild(p);',
    '    return;',
    '  }',
    '  list.forEach(function(t){',
    '    var isDone = t.status === "completed";',
    '    var isHigh = t.priority === "high";',
    '    var row = document.createElement("div");',
    '    row.className = isDone ? "task-item done" : "task-item";',
    '    var left = document.createElement("div");',
    '    var titleDiv = document.createElement("div");',
    '    titleDiv.className = "task-title";',
    '    titleDiv.textContent = t.title || "งาน";',
    '    if(isHigh){',
    '      var b = document.createElement("span");',
    '      b.className = "badge-high";',
    '      b.textContent = "🔥 ด่วน";',
    '      titleDiv.appendChild(b);',
    '    }',
    '    var metaDiv = document.createElement("div");',
    '    metaDiv.className = "task-meta";',
    '    metaDiv.textContent = "🗓️ " + (t.date||"") + " · ⏰ " + (t.time||"09:00") + " น. · " + (isDone ? "✓ เสร็จแล้ว" : "⏳ รอดำเนินการ");',
    '    left.appendChild(titleDiv);',
    '    left.appendChild(metaDiv);',
    '    var acts = document.createElement("div");',
    '    acts.className = "actions";',
    '    var btnDone = document.createElement("button");',
    '    btnDone.type = "button";',
    '    btnDone.className = "btn-act btn-done";',
    '    btnDone.textContent = isDone ? "↩ ย้อนสถานะ" : "✓ เสร็จแล้ว";',
    '    btnDone.onclick = function(){ handleToggle(t.id); };',
    '    var btnDel = document.createElement("button");',
    '    btnDel.type = "button";',
    '    btnDel.className = "btn-act btn-del";',
    '    btnDel.textContent = "🗑️";',
    '    btnDel.onclick = function(){ handleDelete(t.id); };',
    '    acts.appendChild(btnDone);',
    '    acts.appendChild(btnDel);',
    '    row.appendChild(left);',
    '    row.appendChild(acts);',
    '    el.appendChild(row);',
    '  });',
    '}',
    'function setMode(m){ filterMode = m; document.getElementById("tabDate").className = "tab" + (m==="date"?" active":""); document.getElementById("tabAll").className = "tab" + (m==="all"?" active":""); render(); }',
    'function onDateChange(){ selectedDate = document.getElementById("filterDate").value; var p = selectedDate.split("-"); if(p.length===3){ viewYear = parseInt(p[0],10); viewMonth = parseInt(p[1],10)-1; } setMode("date"); }',
    'function handleAdd(){',
    '  var title = document.getElementById("inpTitle").value.trim();',
    '  if(!title) return;',
    '  var d = document.getElementById("inpDate").value;',
    '  var tm = document.getElementById("inpTime").value || "09:00";',
    '  var pr = document.getElementById("inpPrio").value;',
    '  var optimisticTask = { id: "task-" + new Date().getTime(), title: title, description: "เพิ่มผ่านหน้าปฏิทินทีม", date: d, time: tm, categoryId: "cat-work", priority: pr, status: "pending", remindMinutesBefore: 1, lineNotified: false, source: "web", updatedAt: new Date().toISOString() };',
    '  tasks = [optimisticTask].concat(tasks);',
    '  document.getElementById("inpTitle").value = "";',
    '  render();',
    '  showBanner("✅ บันทึกงาน [" + title + "] ลงปฏิทินทีมเรียบร้อยแล้ว!");',
    '  syncWithMainServer({ action: "add_task", task: optimisticTask, tasks: tasks });',
    '  if(typeof google !== "undefined" && google.script && google.script.run){',
    '    google.script.run.withSuccessHandler(function(updated){ if(Array.isArray(updated) && updated.length > 0){ tasks = updated; render(); } }).withFailureHandler(function(){}).addTeamTaskFromPortal(title, d, tm, pr);',
    '  }',
    '}',
    'function handleToggle(id){',
    '  tasks = tasks.map(function(t){ return String(t.id) === String(id) ? Object.assign({}, t, { status: t.status === "completed" ? "pending" : "completed" }) : t; });',
    '  render();',
    '  showBanner("✅ อัปเดตสถานะงานเรียบร้อยแล้ว!");',
    '  syncWithMainServer({ action: "toggle_task", taskId: id, tasks: tasks });',
    '  if(typeof google !== "undefined" && google.script && google.script.run){',
    '    google.script.run.withSuccessHandler(function(updated){ if(Array.isArray(updated) && updated.length > 0){ tasks = updated; render(); } }).withFailureHandler(function(){}).toggleTeamTaskStatusFromPortal(id);',
    '  }',
    '}',
    'function handleDelete(id){',
    '  tasks = tasks.filter(function(t){ return String(t.id) !== String(id); });',
    '  render();',
    '  showBanner("🗑️ ลบรายการงานออกจากปฏิทินเรียบร้อยแล้ว");',
    '  syncWithMainServer({ action: "delete_task", taskId: id, tasks: tasks });',
    '  if(typeof google !== "undefined" && google.script && google.script.run){',
    '    google.script.run.withSuccessHandler(function(updated){ if(Array.isArray(updated)){ tasks = updated; render(); } }).withFailureHandler(function(){}).deleteTeamTaskFromPortal(id);',
    '  }',
    '}',
    'render();',
    'syncWithMainServer();',
    '</script></body></html>'
  ].join('\\n');

  return HtmlService.createHtmlOutput(html)
    .setTitle('ระบบน้องเลขา — ปฏิทินและจัดการงานของทีม')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var rawContents = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(rawContents);

    if (payload.channelAccessToken) {
      setSavedLineToken(payload.channelAccessToken);
    }
    if (payload.targetGroupId && /^[CR][0-9a-fA-F]{32}$/.test(String(payload.targetGroupId).trim())) {
      setSavedGroupId(String(payload.targetGroupId).trim());
    }
    if (typeof payload.allowAddTaskFromLine === 'boolean') {
      setAllowAddTaskFromLine(payload.allowAddTaskFromLine);
    }
    if (typeof payload.telegramBotToken === 'string' && payload.telegramBotToken.trim()) {
      setSavedTelegramConfig(payload.telegramBotToken.trim(), payload.telegramChatId);
    } else if (typeof payload.telegramChatId === 'string' && payload.telegramChatId.trim()) {
      setSavedTelegramConfig('', payload.telegramChatId.trim());
    }
    setSavedTelegramScheduleConfig(payload);

    if (payload.action === 'set_config') {
      var savedSched = getSavedTelegramScheduleConfig();
      return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        mode: 'gas_set_config',
        version: '3.4-telegram-photo-cards-24x7',
        allowAddTaskFromLine: getAllowAddTaskFromLine(),
        hasTelegram: Boolean(getSavedTelegramToken() && getSavedTelegramChatId()),
        reminderTimings: savedSched.reminderTimings,
        dailyDigestEnabled: savedSched.dailyDigestEnabled,
        dailyDigestTime: savedSched.dailyDigestTime,
        deliveryMode: savedSched.deliveryMode
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // บันทึกว่าฝั่งเว็บ/เซิร์ฟเวอร์ส่งแจ้งเตือน Telegram แล้ว เพื่อไม่ให้ Trigger ส่งซ้ำ
    if (payload.action === 'mark_tg_sent') {
      if (payload.reminderKey) {
        markTelegramReminderSentInGas(String(payload.reminderKey).trim());
      }
      if (payload.digestDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(payload.digestDate).trim())) {
        try {
          PropertiesService.getScriptProperties().setProperty('LAST_TG_DIGEST_DATE', String(payload.digestDate).trim());
        } catch (e) {}
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', mode: 'gas_mark_tg_sent' })).setMimeType(ContentService.MimeType.JSON);
    }

    // ส่งแจ้งเตือนผ่าน Telegram Bot API (ฟรีไม่จำกัดข้อความ)
    if (payload.action === 'push_telegram') {
      var tgRes = sendTelegramMessageInGas({
        botToken: payload.botToken || getSavedTelegramToken(),
        chatId: payload.chatId || getSavedTelegramChatId(),
        htmlText: payload.htmlText || payload.text || '',
        buttons: payload.buttons,
        dedupKey: payload.dedupKey
      });
      return ContentService.createTextOutput(JSON.stringify({
        status: tgRes.ok ? 'ok' : 'error',
        mode: 'gas_push_telegram',
        version: '3.2-telegram-photo-card',
        ok: tgRes.ok,
        deliveredCount: tgRes.deliveredCount,
        failedCount: tgRes.failedCount,
        telegramError: tgRes.error || ''
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ส่งการ์ดภาพกราฟิก (sendPhoto) ผ่าน Telegram Bot API
    if (payload.action === 'push_telegram_photo') {
      var pToken = String(payload.botToken || getSavedTelegramToken() || '').trim();
      var pChatIds = parseTelegramChatIdsInGas(payload.chatId || getSavedTelegramChatId());
      var pBase64 = String(payload.photoBase64 || '').trim();
      var pCaption = String(payload.captionHtml || '').slice(0, 1000);
      var pButtons = payload.buttons && payload.buttons.length ? JSON.stringify({ inline_keyboard: payload.buttons }) : '';
      var pDelivered = 0;
      var pFailed = 0;
      var pLastErr = '';
      if (pToken && pChatIds.length > 0 && pBase64) {
        var imgBlob = Utilities.newBlob(Utilities.base64Decode(pBase64), 'image/png', 'lakha-schedule-card.png');
        for (var pi = 0; pi < pChatIds.length; pi++) {
          try {
            var photoPayload = {
              chat_id: pChatIds[pi],
              photo: imgBlob
            };
            if (pCaption) {
              photoPayload.caption = pCaption;
              photoPayload.parse_mode = 'HTML';
            }
            if (pButtons) {
              photoPayload.reply_markup = pButtons;
            }
            var photoRes = UrlFetchApp.fetch('https://api.telegram.org/bot' + pToken + '/sendPhoto', {
              method: 'post',
              payload: photoPayload,
              muteHttpExceptions: true
            });
            var photoJson = {};
            try { photoJson = JSON.parse(photoRes.getContentText() || '{}'); } catch (e) {}
            if (photoRes.getResponseCode() >= 200 && photoRes.getResponseCode() < 300 && photoJson.ok) {
              pDelivered++;
            } else {
              pFailed++;
              pLastErr = photoJson.description || ('HTTP ' + photoRes.getResponseCode());
            }
          } catch (e) {
            pFailed++;
            pLastErr = String(e);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: pDelivered > 0 ? 'ok' : 'error',
        mode: 'gas_push_telegram_photo',
        version: '3.2-telegram-photo-card',
        ok: pDelivered > 0,
        deliveredCount: pDelivered,
        failedCount: pFailed,
        telegramError: pLastErr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ค้นหา Telegram Chat ID / Group ID อัตโนมัติจาก getMe + getUpdates
    if (payload.action === 'telegram_get_updates') {
      var tgInfo = detectTelegramChatsInGas(payload.botToken || getSavedTelegramToken());
      return ContentService.createTextOutput(JSON.stringify(tgInfo)).setMimeType(ContentService.MimeType.JSON);
    }

    // คำสั่งลบ Rich Menu ทั้งหมดออกจาก LINE OA
    if (payload.action === 'clear_richmenu') {
      var rmRes = clearAllRichMenusFromLine(payload.channelAccessToken || getSavedLineToken(), payload.targetUserId);
      return ContentService.createTextOutput(JSON.stringify({
        status: rmRes.ok ? 'ok' : 'error',
        mode: 'gas_clear_richmenu',
        version: '3.0-executive-card',
        ok: rmRes.ok,
        deletedCount: rmRes.deletedCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ตรวจสอบเวอร์ชันสะพานเชื่อม (Bridge Check) หรือดึงข้อมูลตารางงาน + รหัสกลุ่ม LINE (Group ID C...)
    if (payload.action === 'check_bridge' || payload.action === 'get_tasks') {
      if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
        var existingTasks = getSavedTasksFromProperties();
        if (!Array.isArray(existingTasks) || existingTasks.length === 0) {
          writeSheetTasksFromWeb(payload.tasks);
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        mode: 'gas_bridge_ready',
        version: '3.4-telegram-photo-cards-24x7',
        cardDesignVersion: '3.4-telegram-photo-cards-24x7',
        capabilities: ['webhook', 'push_line', 'get_tasks', 'sync_tasks', 'clear_richmenu', 'group_chat', 'team_portal', 'executive_card_v3', 'telegram_photo_cards_24x7'],
        detectedGroupId: getSavedGroupId(),
        detectedUserId: getSavedUserId(),
        hasToken: Boolean(getSavedLineToken()),
        tasks: readSheetTasksForWeb()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // บันทึก/อัปเดตรายการงานลง Google Sheets ผ่าน Apps Script โดยผสานข้อมูลเดิมและตัดรายการซ้ำซ้อนอัตโนมัติ
    if (payload.action === 'sync_tasks') {
      var incomingTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      var delIdsList = Array.isArray(payload.deletedTaskIds) ? payload.deletedTaskIds : [];
      var delSet = {};
      for (var di = 0; di < delIdsList.length; di++) {
        if (delIdsList[di]) delSet[String(delIdsList[di]).trim()] = true;
      }
      var incomingHasCatsMeta = incomingTasks.some(function(it) {
        return it && typeof it.source === 'string' && it.source.indexOf('#SCMETA#') !== -1 && it.source.indexOf('"c":') !== -1;
      });
      var currentSheetTasks = (readSheetTasksForWeb() || []).map(function(st) {
        if (!incomingHasCatsMeta || !st || typeof st.source !== 'string' || st.source.indexOf('#SCMETA#') === -1) return st;
        var parts = st.source.split('#SCMETA#');
        try {
          var metaObj = JSON.parse(parts[1] || '{}');
          delete metaObj.c;
          delete metaObj.cu;
          delete metaObj.dc;
          delete metaObj.dt;
          delete metaObj.dp;
          delete metaObj.m;
          var cleanSrc = Object.keys(metaObj).length > 0 ? (parts[0] + '#SCMETA#' + JSON.stringify(metaObj)) : parts[0];
          var copySt = {};
          for (var k in st) copySt[k] = st[k];
          copySt.source = cleanSrc;
          return copySt;
        } catch (errMeta) {
          return st;
        }
      });
      var byIdMap = {};
      var combinedList = currentSheetTasks.concat(incomingTasks);
      for (var ci = 0; ci < combinedList.length; ci++) {
        var item = combinedList[ci];
        if (!item || !item.id || !item.title) continue;
        var itemId = String(item.id).trim();
        if (!itemId || delSet[itemId]) continue;
        var prevItem = byIdMap[itemId];
        if (!prevItem) {
          byIdMap[itemId] = item;
        } else {
          var prevMs = prevItem.updatedAt ? new Date(String(prevItem.updatedAt)).getTime() : 0;
          var nextMs = item.updatedAt ? new Date(String(item.updatedAt)).getTime() : 0;
          if (nextMs >= prevMs) {
            if (!item.endDate && prevItem.endDate) item.endDate = prevItem.endDate;
            byIdMap[itemId] = item;
          }
        }
      }
      var bySigMap = {};
      var idKeys = Object.keys(byIdMap);
      for (var ki = 0; ki < idKeys.length; ki++) {
        var tObj = byIdMap[idKeys[ki]];
        var normTitle = String(tObj.title || '').trim().toLowerCase().replace(/\\s+/g, ' ');
        var normDate = String(tObj.date || '').trim().slice(0, 10);
        var normTime = String(tObj.time || '09:00').trim().slice(0, 5);
        var sigKey = normTitle + '|' + normDate + '|' + normTime;
        var existingSig = bySigMap[sigKey];
        if (!existingSig) {
          bySigMap[sigKey] = tObj;
        } else {
          var exMs = existingSig.updatedAt ? new Date(String(existingSig.updatedAt)).getTime() : 0;
          var nwMs = tObj.updatedAt ? new Date(String(tObj.updatedAt)).getTime() : 0;
          if (nwMs >= exMs) {
            if (!tObj.endDate && existingSig.endDate) tObj.endDate = existingSig.endDate;
            bySigMap[sigKey] = tObj;
          }
        }
      }
      var mergedToSave = Object.keys(bySigMap).map(function(sk) { return bySigMap[sk]; });
      var savedOk = writeSheetTasksFromWeb(mergedToSave);
      return ContentService.createTextOutput(JSON.stringify({
        status: savedOk ? 'ok' : 'error',
        mode: 'gas_sync_tasks',
        version: '3.0-executive-card',
        detectedGroupId: getSavedGroupId(),
        ok: savedOk,
        count: mergedToSave.length
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ตรวจสอบโควต้าข้อความรายเดือนของ LINE OA (GET /v2/bot/message/quota ไม่เสียโควต้า)
    if (payload.action === 'check_quota') {
      var qToken = String(payload.channelAccessToken || getSavedLineToken() || '').replace(/^Bearer\\s+/i, '').trim();
      if (!qToken || qToken.indexOf('วาง_LINE_') !== -1) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          mode: 'gas_check_quota',
          ok: false,
          message: 'Missing LINE Channel Access Token'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var quotaResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + qToken },
        muteHttpExceptions: true
      });
      var usageResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        method: 'get',
        headers: { 'Authorization': 'Bearer ' + qToken },
        muteHttpExceptions: true
      });
      var qCode = quotaResp.getResponseCode();
      var qJson = {};
      var uJson = {};
      try { qJson = JSON.parse(quotaResp.getContentText() || '{}'); } catch (e) {}
      try { uJson = JSON.parse(usageResp.getContentText() || '{}'); } catch (e) {}
      var limitVal = typeof qJson.value === 'number' ? qJson.value : null;
      var usedVal = typeof uJson.totalUsage === 'number' ? uJson.totalUsage : 0;
      var remVal = limitVal !== null ? Math.max(0, limitVal - usedVal) : null;
      return ContentService.createTextOutput(JSON.stringify({
        status: qCode >= 200 && qCode < 300 ? 'ok' : 'error',
        mode: 'gas_check_quota',
        ok: qCode >= 200 && qCode < 300,
        quotaType: qJson.type || 'none',
        limit: limitVal,
        totalUsage: usedVal,
        remaining: remVal,
        isExhausted: limitVal !== null && usedVal >= limitVal
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // รองรับการส่งแจ้งเตือน LINE Push (ทั้งเข้าห้องแชทกลุ่ม Group ID C... และรายบุคคล U...) หรือ Broadcast
    if (payload.action === 'push_line') {
      var dedupKey = String(payload.dedupKey || '').trim();
      if (dedupKey) {
        try {
          var pushCache = CacheService.getScriptCache();
          if (pushCache.get('push_dedup_' + dedupKey)) {
            return ContentService.createTextOutput(JSON.stringify({
              status: 'ok',
              mode: 'gas_push_line',
              version: '3.0-executive-card',
              ok: true,
              deduplicated: true,
              deliveryMethod: 'deduplicated'
            })).setMimeType(ContentService.MimeType.JSON);
          }
          pushCache.put('push_dedup_' + dedupKey, '1', 2700);
        } catch (dedupErr) {}
      }

      var token = String(payload.channelAccessToken || getSavedLineToken() || '').replace(/^Bearer\\s+/i, '').trim();
      var targetId = String(payload.to || '').trim();
      var explicitGroupId = String(payload.targetGroupId || '').trim();

      if (/^[CR][0-9a-fA-F]{32}$/.test(explicitGroupId)) {
        setSavedGroupId(explicitGroupId);
      } else if (/^[CR][0-9a-fA-F]{32}$/.test(targetId)) {
        setSavedGroupId(targetId);
      }

      var effectiveGroupId = /^[CR][0-9a-fA-F]{32}$/.test(explicitGroupId)
        ? explicitGroupId
        : (/^[CR][0-9a-fA-F]{32}$/.test(targetId) ? targetId : getSavedGroupId());
      var notifyMode = String(payload.teamNotificationMode || (effectiveGroupId ? 'group' : 'broadcast'));

      clearAllRichMenusFromLine(token, targetId);
      var msgText = payload.text || 'แจ้งเตือนตารางงานจากระบบน้องเลขา';
      var isValidUserTarget = /^U[0-9a-fA-F]{32}$/.test(targetId);
      var sentSuccess = false;
      var sentGroupSuccess = false;
      var deliveryMethod = 'none';
      var lastCode = 0;
      var lastError = '';
      var botName = '';

      if (!token || token.indexOf('วาง_LINE_') !== -1) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          mode: 'gas_push_line',
          ok: false,
          lineHttpCode: 401,
          lineError: 'Missing LINE Channel Access Token'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      if (payload.diagnose) {
        var infoResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + token },
          muteHttpExceptions: true
        });
        lastCode = infoResp.getResponseCode();
        if (lastCode >= 200 && lastCode < 300) {
          try {
            var infoData = JSON.parse(infoResp.getContentText());
            botName = infoData.displayName || '';
          } catch (err) {}
        } else {
          return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            mode: 'gas_push_line',
            ok: false,
            lineHttpCode: lastCode,
            lineError: infoResp.getContentText()
          })).setMimeType(ContentService.MimeType.JSON);
        }
      }

      var messagesPayload = [{ type: 'text', text: msgText }];
      var calDeepLink = getCalendarDeepLink(payload.originUrl, payload.date || '');
      var sheetUrl = getSpreadsheetDirectUrl();

      if (payload.messageFormat !== 'text_custom' && Array.isArray(payload.tasksList) && payload.tasksList.length > 0) {
        var rowsForFlex = payload.tasksList.map(function(item) {
          return ['', item.title || 'งาน', item.description || '', item.date || '', item.time || '09:00', item.categoryName || 'ทั่วไป', item.priority || 'medium', item.status || 'pending', item.categoryColor || '#2563EB'];
        });
        messagesPayload = [buildSummaryFlexBubble('สรุปตารางงานประจำวัน', payload.date || '', rowsForFlex, payload.originUrl)];
      } else if (payload.messageFormat !== 'text_custom' && payload.taskTitle) {
        var schedDeepLink = calDeepLink.indexOf('section=calendar') !== -1
          ? calDeepLink.replace('section=calendar', 'section=schedule')
          : calDeepLink;
        var singleFooterButtons = [];
        if (calDeepLink.indexOf('script.google.com') === -1) {
          singleFooterButtons.push({
            type: 'button',
            style: 'primary',
            color: '#0F172A',
            height: 'sm',
            action: { type: 'uri', label: 'เปิดตารางงานนำเสนอ (รายวัน)', uri: schedDeepLink }
          });
        }
        singleFooterButtons.push({
          type: 'button',
          style: singleFooterButtons.length === 0 ? 'primary' : 'secondary',
          height: 'sm',
          action: { type: 'uri', label: 'เปิดดูปฏิทินและจัดการงาน', uri: calDeepLink }
        });

        var fontSizeMode = payload.cardFontSize || 'md';
        var titleSize = fontSizeMode === 'sm' ? 'md' : fontSizeMode === 'lg' ? 'xl' : 'lg';
        var bodySize = fontSizeMode === 'sm' ? 'xxs' : fontSizeMode === 'lg' ? 'sm' : 'xs';
        var titleWeight = payload.cardTitleWeight === 'regular' ? 'regular' : 'bold';
        var lineSpacingVal = payload.cardLineSpacing === 'tight' ? '2px' : payload.cardLineSpacing === 'normal' ? '4px' : '6px';

        var prioKey = String(payload.priority || 'medium').toLowerCase();
        var prioTagBg = prioKey === 'high' ? '#DC2626' : (prioKey === 'low' ? '#1E3A5F' : '#D97706');
        var prioShortLabel = prioKey === 'high' ? 'ภารกิจด่วนมาก' : (prioKey === 'low' ? 'ตามกำหนดการ' : 'ความสำคัญปานกลาง');
        var prioTextColor = prioKey === 'high' ? '#B91C1C' : (prioKey === 'low' ? '#334155' : '#B45309');

        var cleanTaskTime = String(payload.time || '09:00').replace(/^'/, '');
        var cleanTaskDateLabel = payload.date ? formatThaiFullDateInGas(String(payload.date)) : String(payload.dateTime || 'วันนี้').replace(/\\s*·?\\s*\\d{1,2}:\\d{2}\\s*น\\.?$/, '').trim();
        var rawDescText = String(payload.description || '').trim();
        var hasCleanDesc = Boolean(rawDescText) &&
          rawDescText !== String(payload.taskTitle || '').trim() &&
          rawDescText.indexOf('เพิ่มผ่านแชท LINE') !== 0 &&
          rawDescText.indexOf('บันทึกผ่านแชท LINE') !== 0 &&
          rawDescText.indexOf('เพิ่มผ่านหน้าปฏิทิน') !== 0;

        var detailCardContents = [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#0F172A',
                cornerRadius: '6px',
                paddingStart: '10px',
                paddingEnd: '10px',
                paddingTop: '4px',
                paddingBottom: '4px',
                flex: 0,
                contents: [
                  {
                    type: 'text',
                    text: 'เวลา ' + cleanTaskTime + ' น.',
                    size: 'xs',
                    weight: 'bold',
                    color: '#FFFFFF'
                  }
                ]
              },
              {
                type: 'text',
                text: cleanTaskDateLabel,
                size: 'xs',
                weight: 'bold',
                color: '#334155',
                align: 'end',
                flex: 1,
                wrap: true
              }
            ]
          },
          {
            type: 'separator',
            margin: 'md',
            color: '#F1F5F9'
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'md',
            contents: [
              { type: 'text', text: 'หมวดหมู่', size: bodySize, color: '#64748B', flex: 3 },
              { type: 'text', text: String(payload.categoryName || 'ภารกิจทั่วไป'), size: bodySize, weight: titleWeight, color: '#0F172A', flex: 7, wrap: true }
            ]
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'sm',
            contents: [
              { type: 'text', text: 'ความสำคัญ', size: bodySize, color: '#64748B', flex: 3 },
              { type: 'text', text: prioShortLabel, size: bodySize, weight: titleWeight, color: prioTextColor, flex: 7, wrap: true }
            ]
          }
        ];

        if (hasCleanDesc) {
          detailCardContents.push({
            type: 'separator',
            margin: 'md',
            color: '#F1F5F9'
          });
          detailCardContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F8FAFC',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              { type: 'text', text: 'รายละเอียดเพิ่มเติม', size: 'xxs', weight: 'bold', color: '#64748B' },
              { type: 'text', text: rawDescText, size: bodySize, color: '#1E293B', lineSpacing: lineSpacingVal, wrap: true, margin: 'xs' }
            ]
          });
        }

        var singleHeaderContents = [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'text',
                text: 'แจ้งเตือนกำหนดการปฏิบัติราชการ',
                color: '#FBBF24',
                size: 'xxs',
                weight: 'bold',
                flex: 1
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: prioTagBg,
                cornerRadius: '4px',
                paddingStart: '8px',
                paddingEnd: '8px',
                paddingTop: '3px',
                paddingBottom: '3px',
                flex: 0,
                contents: [
                  { type: 'text', text: prioShortLabel, color: '#FFFFFF', size: 'xxs', weight: 'bold' }
                ]
              }
            ]
          },
          {
            type: 'text',
            text: String(payload.taskTitle),
            color: '#FFFFFF',
            size: titleSize,
            weight: titleWeight,
            lineSpacing: lineSpacingVal,
            wrap: true,
            margin: 'md'
          },
          {
            type: 'text',
            text: cleanTaskDateLabel + ' · เวลา ' + cleanTaskTime + ' น.',
            color: '#CBD5E1',
            size: 'xs',
            margin: 'xs',
            wrap: true
          }
        ];

        if (payload.stats && typeof payload.stats.total === 'number') {
          singleHeaderContents.push({
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#132640',
            cornerRadius: '8px',
            paddingTop: '10px',
            paddingBottom: '10px',
            paddingStart: '8px',
            paddingEnd: '8px',
            margin: 'md',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(payload.stats.total), size: 'md', weight: 'bold', color: '#FFFFFF', align: 'center' },
                  { type: 'text', text: 'ทั้งหมด', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                width: '1px',
                height: '24px',
                backgroundColor: '#1E3A5F',
                contents: [{ type: 'filler' }]
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(payload.stats.pending || 0), size: 'md', weight: 'bold', color: '#FBBF24', align: 'center' },
                  { type: 'text', text: 'รอดำเนินการ', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                width: '1px',
                height: '24px',
                backgroundColor: '#1E3A5F',
                contents: [{ type: 'filler' }]
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  { type: 'text', text: String(payload.stats.completed || 0), size: 'md', weight: 'bold', color: '#34D399', align: 'center' },
                  { type: 'text', text: 'เสร็จสิ้นแล้ว', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                ]
              }
            ]
          });
        }

        messagesPayload = [{
          type: 'flex',
          altText: ('แจ้งเตือนภารกิจ: ' + String(payload.taskTitle) + ' (' + cleanTaskDateLabel + ' เวลา ' + cleanTaskTime + ' น.)').slice(0, 300),
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#0B192C',
              paddingAll: '18px',
              contents: singleHeaderContents
            },
            body: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F8FAFC',
              paddingAll: '16px',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#FFFFFF',
                  cornerRadius: '10px',
                  borderWidth: '1px',
                  borderColor: prioKey === 'high' ? '#FECDD3' : '#E2E8F0',
                  paddingAll: '14px',
                  contents: detailCardContents
                }
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '14px',
              backgroundColor: '#FFFFFF',
              borderWidth: '1px',
              borderColor: '#E2E8F0',
              contents: singleFooterButtons
            }
          }
        }];
      }

      var quotaExceeded = false;

      // 1. ส่งเข้าห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat C... / R...) หากมีรหัสกลุ่ม
      if (effectiveGroupId && (notifyMode === 'group' || notifyMode === 'both')) {
        var grpResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          payload: JSON.stringify({
            to: effectiveGroupId,
            messages: messagesPayload
          }),
          muteHttpExceptions: true
        });
        lastCode = grpResp.getResponseCode();
        if (lastCode >= 200 && lastCode < 300) {
          sentSuccess = true;
          sentGroupSuccess = true;
          deliveryMethod = 'group_push';
        } else {
          lastError = grpResp.getContentText();
          if (lastCode === 429 || String(lastError).toLowerCase().indexOf('monthly limit') !== -1) {
            quotaExceeded = true;
          }
        }
      }

      // 2. ส่งเข้าแชทส่วนตัว U... (กรณีระบุ User ID และโควต้ายังไม่เต็ม)
      if (!quotaExceeded && isValidUserTarget && notifyMode !== 'group') {
        var pushResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          payload: JSON.stringify({
            to: targetId,
            messages: messagesPayload
          }),
          muteHttpExceptions: true
        });
        lastCode = pushResp.getResponseCode();
        if (lastCode >= 200 && lastCode < 300) {
          sentSuccess = true;
          deliveryMethod = sentGroupSuccess ? 'group_and_user_push' : 'push';
        } else {
          lastError = pushResp.getContentText();
          if (lastCode === 429 || String(lastError).toLowerCase().indexOf('monthly limit') !== -1) {
            quotaExceeded = true;
          }
        }
      }

      // 3. ส่งแบบ Broadcast หาเพื่อนทุกคน (เฉพาะเมื่อโควต้ายังไม่เต็ม)
      if (!quotaExceeded && (!sentSuccess || (notifyMode === 'both' && !isValidUserTarget)) && notifyMode !== 'group') {
        var bcResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          payload: JSON.stringify({
            messages: messagesPayload
          }),
          muteHttpExceptions: true
        });
        lastCode = bcResp.getResponseCode();
        if (lastCode >= 200 && lastCode < 300) {
          sentSuccess = true;
          deliveryMethod = sentGroupSuccess ? 'group_and_broadcast' : 'broadcast';
        } else {
          lastError = bcResp.getContentText();
          if (lastCode === 429 || String(lastError).toLowerCase().indexOf('monthly limit') !== -1) {
            quotaExceeded = true;
          } else if (!sentSuccess) {
            var bcTextResp = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', {
              method: 'post',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
              },
              payload: JSON.stringify({
                messages: [{ type: 'text', text: msgText }]
              }),
              muteHttpExceptions: true
            });
            lastCode = bcTextResp.getResponseCode();
            if (lastCode >= 200 && lastCode < 300) {
              sentSuccess = true;
              deliveryMethod = 'broadcast_text';
            } else {
              lastError = bcTextResp.getContentText();
            }
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: sentSuccess ? 'ok' : 'error',
        mode: 'gas_push_line',
        version: '3.0-executive-card',
        cardDesignVersion: '3.0-executive-card',
        ok: sentSuccess,
        quotaExceeded: quotaExceeded,
        deliveryMethod: deliveryMethod,
        detectedGroupId: effectiveGroupId || getSavedGroupId(),
        botName: botName,
        lineHttpCode: lastCode,
        lineError: lastError
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var events = payload.events || [];
    if (events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'verified',
        version: '3.0-executive-card',
        cardDesignVersion: '3.0-executive-card',
        detectedGroupId: getSavedGroupId(),
        capabilities: ['webhook', 'push_line', 'group_chat', 'executive_card_v3']
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // เปิด Google Sheets อย่างปลอดภัย (แม้ยังไม่ผูกชีต บอทก็ยังตอบรหัส Group ID C... ได้ 100%)
    var ss = openSafeSpreadsheet();
    var taskSheet = null;
    var logSheet = null;
    if (ss) {
      try {
        taskSheet = ss.getSheetByName('Tasks') || ss.insertSheet('Tasks');
        if (taskSheet.getLastRow() === 0) {
          taskSheet.appendRow(['ID', 'Title', 'Description', 'Date (YYYY-MM-DD)', 'Time (HH:mm)', 'CategoryID', 'Priority', 'Status', 'RemindMinutesBefore', 'LineNotified', 'Source', 'UpdatedAt']);
        }
        logSheet = ss.getSheetByName('LineLogs') || ss.insertSheet('LineLogs');
      } catch (sheetErr) {}
    }

    events.forEach(function(event) {
      var evDedupId = String(event.webhookEventId || (event.message && event.message.id) || '').trim();
      if (evDedupId) {
        try {
          var scriptCache = CacheService.getScriptCache();
          if (scriptCache.get('wh_' + evDedupId)) {
            return;
          }
          scriptCache.put('wh_' + evDedupId, '1', 600);
        } catch (cacheErr) {}
      }

      var srcGroupId = (event.source && (event.source.groupId || event.source.roomId))
        ? String(event.source.groupId || event.source.roomId).trim()
        : '';
      var srcUserId = (event.source && event.source.userId)
        ? String(event.source.userId).trim()
        : '';

      if (srcGroupId) {
        setSavedGroupId(srcGroupId);
      }
      if (srcUserId) {
        setSavedUserId(srcUserId);
      }

      // 1. กรณีเชิญบอทเข้าห้องแชทกลุ่ม LINE (join / memberJoined) -> ตอบกลับพร้อมแสดง Group ID (C...) ทันที
      if ((event.type === 'join' || event.type === 'memberJoined') && srcGroupId && event.replyToken) {
        replyLineMessages(event.replyToken, [{
          type: 'text',
          text: '✅ เชื่อมต่อห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat) สำเร็จแล้ว!\\n\\n🔑 รหัส Group ID ของกลุ่มนี้คือ:\\n' + srcGroupId + '\\n\\n💡 พิมพ์เพิ่มงานในกลุ่มโดยขึ้นต้นด้วยคำว่า "เพิ่มงาน" หรือ "นัดหมาย" เช่น "เพิ่มงาน ประชุมทีม พรุ่งนี้ 10:00"'
        }]);
        return;
      }

      if (event.type === 'message' && event.message && event.message.type === 'text') {
        var userMessage = String(event.message.text || '').trim();
        var lowerMsg = userMessage.toLowerCase();
        var replyToken = event.replyToken;
        var now = new Date();
        var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');

        // 2. คำสั่งเชื่อมกลุ่ม / ขอรหัส Group ID (รองรับทั้งการพิมพ์ตรงๆ หรือมีข้อความอื่นปน เช่น "@บอท เชื่อมกลุ่ม")
        if (
          lowerMsg.indexOf('เชื่อมกลุ่ม') !== -1 ||
          lowerMsg.indexOf('รหัสกลุ่ม') !== -1 ||
          lowerMsg.indexOf('เช็คกลุ่ม') !== -1 ||
          lowerMsg.indexOf('เช็ครหัส') !== -1 ||
          lowerMsg.indexOf('groupid') !== -1 ||
          lowerMsg.indexOf('group id') !== -1
        ) {
          replyLineMessages(replyToken, [{
            type: 'text',
            text: srcGroupId
              ? '✅ เชื่อมต่อห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2) สำเร็จแล้ว!\\n\\n🔑 รหัส Group ID ของกลุ่มนี้คือ:\\n' + srcGroupId + '\\n\\n(คัดลอกรหัส C... ด้านบนไปวางในช่อง LINE Group ID บนหน้าเว็บ หรือกดปุ่ม "ดึงรหัสกลุ่ม C... อัตโนมัติ" บนหน้าเว็บได้เลยครับ)'
              : 'ℹ️ ขณะนี้คุณพิมพ์อยู่ในแชทส่วนตัว (1-on-1)\\n🔑 รหัส User ID ของคุณคือ:\\n' + (srcUserId || '-') + '\\n\\n💡 หากต้องการใช้ "รูปแบบที่ 2: แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม" กรุณาเชิญบอทเข้ากลุ่ม LINE ของทีม แล้วพิมพ์คำว่า "เชื่อมกลุ่ม" ในห้องแชทกลุ่มครับ'
          }]);
          return;
        }

        if (
          userMessage === 'สรุปงานตามเวลา' ||
          userMessage === 'เช็คเวลางาน' ||
          userMessage === 'สรุปงานวันนี้' ||
          userMessage === 'งานวันนี้' ||
          userMessage === 'งานพรุ่งนี้' ||
          userMessage === 'สรุปงานพรุ่งนี้' ||
          userMessage === 'งานมะรืน' ||
          userMessage === 'สรุปงานมะรืน' ||
          userMessage === 'สรุปงาน' ||
          userMessage === 'งานค้าง' ||
          /^(สรุปงานตามเวลา|เช็คเวลางาน|สรุปงานวันนี้|สรุปงาน|ดูงานวันที่|งานวันที่|ตารางงานวันที่|เช็คงานวันที่)\\s*(.+)$/i.test(userMessage)
        ) {
          var currentList = readSheetTasksForWeb();
          var queryDate = parseThaiCommand(userMessage).date || todayStr;
          var matchedTasks = userMessage === 'งานค้าง'
            ? currentList.filter(function(t) { return String(t.status || 'pending') !== 'completed'; })
            : currentList.filter(function(t) {
                var s = String(t.date || '').replace(/^'/, '').slice(0, 10);
                var e = String(t.endDate || s).replace(/^'/, '').slice(0, 10);
                if (e < s) e = s;
                return s <= queryDate && e >= queryDate;
              });
          var filtered = matchedTasks.map(function(t) {
            return [t.id, t.title, t.description || '', t.date, t.time || '09:00', t.categoryName || t.categoryId || 'cat-work', t.priority || 'medium', t.status || 'pending'];
          });
          var flexBubble = buildSummaryFlexBubble(
            userMessage === 'งานค้าง' ? 'สรุปงานค้างทั้งหมด' : ('สรุปตารางงานวันที่ ' + queryDate),
            queryDate,
            filtered
          );
          replyLineMessages(replyToken, [flexBubble]);
          return;
        }

        // ในห้องแชทกลุ่ม LINE บันทึกเฉพาะข้อความที่ขึ้นต้นด้วยคำสั่งเพิ่มงานเท่านั้น (ป้องกันข้อความคุยเล่นทั่วไปกลายเป็นตารางงาน)
        if (srcGroupId && !/^(?:@[^\\s]+\\s*)?(?:น้องเลขา\\s*[:：-]?\\s*)?(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\\b/i.test(userMessage)) {
          return;
        }

        if (!getAllowAddTaskFromLine()) {
          replyLineMessages(replyToken, [{
            type: 'text',
            text: '⛔ ขณะนี้ปิดฟังก์ชันการเพิ่มงานลงปฏิทินจาก LINE ชั่วคราวครับ\\n\\n💡 คุณยังสามารถพิมพ์ "สรุปงานวันนี้", "งานพรุ่งนี้" หรือ "งานค้าง" เพื่อดูตารางงานได้ตามปกติ หรือเพิ่มนัดหมายผ่านหน้าเว็บแอปได้โดยตรงครับ'
          }]);
          return;
        }

        var cleanedGroupMsg = userMessage.replace(/^(?:@[^\\s]+\\s*)?(?:น้องเลขา\\s*[:：-]?\\s*)?/i, '').trim();
        var parsed = parseThaiCommand(cleanedGroupMsg);
        var randSuffix = Math.random().toString(36).slice(2, 6);
        var newId = 'task-' + now.getTime() + '-' + randSuffix;
        var existingAll = readSheetTasksForWeb() || [];
        var normNewTitle = String(parsed.title || '').trim().toLowerCase().replace(/\\s+/g, ' ');
        var duplicateIdx = -1;
        for (var ei = 0; ei < existingAll.length; ei++) {
          var ex = existingAll[ei];
          if (!ex) continue;
          var exTitle = String(ex.title || '').trim().toLowerCase().replace(/\\s+/g, ' ');
          if (exTitle === normNewTitle && String(ex.date || '').slice(0, 10) === String(parsed.date || '').slice(0, 10) && String(ex.time || '09:00').slice(0, 5) === String(parsed.time || '09:00').slice(0, 5)) {
            duplicateIdx = ei;
            break;
          }
        }
        var createdObj = {
          id: duplicateIdx !== -1 ? existingAll[duplicateIdx].id : newId,
          title: parsed.title,
          description: 'บันทึกผ่านแชท LINE OA ("' + userMessage + '")',
          date: parsed.date,
          time: parsed.time,
          categoryId: 'cat-work',
          priority: parsed.priority,
          status: 'pending',
          remindMinutesBefore: 1,
          lineNotified: false,
          source: 'line',
          updatedAt: now.toISOString()
        };
        var updatedAll = duplicateIdx !== -1
          ? existingAll.map(function(item, idx) { return idx === duplicateIdx ? createdObj : item; })
          : [createdObj].concat(existingAll);
        writeSheetTasksFromWeb(updatedAll);
        pushTasksToMainWebApp(updatedAll);
        var sameDayAll = updatedAll.filter(function(t) { return String(t.date) === String(parsed.date); });
        var dayTotalCount = sameDayAll.length;
        var dayPendingCount = sameDayAll.filter(function(t) { return t.status !== 'completed'; }).length;

        if (logSheet) {
          try {
            logSheet.appendRow([
              'log-' + now.getTime(),
              now.toISOString(),
              'incoming_command',
              userMessage,
              parsed.title + (srcGroupId ? ' [Group:' + srcGroupId + ']' : ''),
              'line_messaging_api',
              'delivered'
            ]);
          } catch (logErr) {}
        }

        try {
          var startDt = new Date(parsed.date + 'T' + parsed.time + ':00+07:00');
          var endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
          CalendarApp.getDefaultCalendar().createEvent(parsed.title, startDt, endDt, {
            description: 'บันทึกอัตโนมัติจากระบบน้องเลขา LINE OA'
          });
        } catch (calErr) {}

        var fullSavedThaiDate = formatThaiFullDateInGas(parsed.date);
        var savedPrioTagBg = parsed.priority === 'high' ? '#DC2626' : '#1E3A5F';
        var savedPrioLabel = parsed.priority === 'high' ? 'ภารกิจด่วนมาก' : 'ตามกำหนดการ';
        var dayDoneCount = Math.max(0, dayTotalCount - dayPendingCount);

        var bodyContents = [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFFFFF',
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: parsed.priority === 'high' ? '#FECDD3' : '#E2E8F0',
            paddingAll: '14px',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                contents: [
                  {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#0F172A',
                    cornerRadius: '6px',
                    paddingStart: '10px',
                    paddingEnd: '10px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    flex: 0,
                    contents: [
                      { type: 'text', text: 'เวลา ' + parsed.time + ' น.', size: 'xs', weight: 'bold', color: '#FFFFFF' }
                    ]
                  },
                  {
                    type: 'text',
                    text: savedPrioLabel,
                    size: 'xs',
                    weight: 'bold',
                    color: parsed.priority === 'high' ? '#B91C1C' : '#334155',
                    align: 'end',
                    flex: 1
                  }
                ]
              },
              {
                type: 'text',
                text: fullSavedThaiDate,
                size: 'xs',
                weight: 'bold',
                color: '#0F172A',
                margin: 'md',
                wrap: true
              }
            ]
          }
        ];

        if (srcGroupId) {
          bodyContents.push({
            type: 'text',
            text: 'รหัสกลุ่มที่ซิงค์: ' + srcGroupId,
            size: 'xxs',
            color: '#64748B',
            wrap: true,
            margin: 'sm'
          });
        }

        var savedFlex = {
          type: 'flex',
          altText: 'บันทึกกำหนดการเรียบร้อย: ' + parsed.title,
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#0B192C',
              paddingAll: '18px',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  alignItems: 'center',
                  contents: [
                    {
                      type: 'text',
                      text: srcGroupId ? 'บันทึกกำหนดการจากกลุ่ม LINE สำเร็จ' : 'บันทึกกำหนดการลงปฏิทินสำเร็จ',
                      color: '#34D399',
                      size: 'xxs',
                      weight: 'bold',
                      flex: 1
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: savedPrioTagBg,
                      cornerRadius: '4px',
                      paddingStart: '8px',
                      paddingEnd: '8px',
                      paddingTop: '3px',
                      paddingBottom: '3px',
                      flex: 0,
                      contents: [
                        { type: 'text', text: savedPrioLabel, color: '#FFFFFF', size: 'xxs', weight: 'bold' }
                      ]
                    }
                  ]
                },
                {
                  type: 'text',
                  text: parsed.title,
                  color: '#FFFFFF',
                  size: 'lg',
                  weight: 'bold',
                  wrap: true,
                  margin: 'md'
                },
                {
                  type: 'box',
                  layout: 'horizontal',
                  backgroundColor: '#132640',
                  cornerRadius: '8px',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                  paddingStart: '8px',
                  paddingEnd: '8px',
                  margin: 'md',
                  alignItems: 'center',
                  contents: [
                    {
                      type: 'box',
                      layout: 'vertical',
                      flex: 1,
                      contents: [
                        { type: 'text', text: String(dayTotalCount), size: 'md', weight: 'bold', color: '#FFFFFF', align: 'center' },
                        { type: 'text', text: 'ทั้งหมดวันนี้', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      width: '1px',
                      height: '24px',
                      backgroundColor: '#1E3A5F',
                      contents: [{ type: 'filler' }]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      flex: 1,
                      contents: [
                        { type: 'text', text: String(dayPendingCount), size: 'md', weight: 'bold', color: '#FBBF24', align: 'center' },
                        { type: 'text', text: 'รอดำเนินการ', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      width: '1px',
                      height: '24px',
                      backgroundColor: '#1E3A5F',
                      contents: [{ type: 'filler' }]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      flex: 1,
                      contents: [
                        { type: 'text', text: String(dayDoneCount), size: 'md', weight: 'bold', color: '#34D399', align: 'center' },
                        { type: 'text', text: 'เสร็จสิ้นแล้ว', size: 'xxs', color: '#94A3B8', align: 'center', margin: 'xs' }
                      ]
                    }
                  ]
                }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F8FAFC',
              paddingAll: '16px',
              spacing: 'sm',
              contents: bodyContents
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '14px',
              backgroundColor: '#FFFFFF',
              borderWidth: '1px',
              borderColor: '#E2E8F0',
              contents: (function() {
                var targetCal = getCalendarDeepLink('', parsed.date);
                var schedUrl = targetCal.indexOf('section=calendar') !== -1
                  ? targetCal.replace('section=calendar', 'section=schedule')
                  : targetCal;
                var btns = [];
                if (targetCal.indexOf('script.google.com') === -1) {
                  btns.push({
                    type: 'button',
                    style: 'primary',
                    color: '#0F172A',
                    height: 'sm',
                    action: { type: 'uri', label: 'เปิดตารางงานนำเสนอ (รายวัน)', uri: schedUrl }
                  });
                }
                btns.push({
                  type: 'button',
                  style: btns.length === 0 ? 'primary' : 'secondary',
                  height: 'sm',
                  action: { type: 'uri', label: 'เปิดดูปฏิทินและจัดการงาน', uri: targetCal }
                });
                return btns;
              })()
            }
          }
        };
        replyLineMessages(replyToken, [savedFlex]);
      }
    });
  } catch (err) {}

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', version: '3.0-executive-card', cardDesignVersion: '3.0-executive-card', detectedGroupId: getSavedGroupId() })).setMimeType(ContentService.MimeType.JSON);
}

function replyLineMessages(replyToken, messages) {
  var activeToken = getSavedLineToken();
  if (!activeToken || !replyToken) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + activeToken
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: messages
      }),
      muteHttpExceptions: true
    });
  } catch (err) {}
}

// ============================================================================
// Telegram Bot Integration (ฟรีไม่จำกัดข้อความ · ส่งตรงจากเซิร์ฟเวอร์ Google)
// ============================================================================
function setSavedTelegramConfig(botToken, chatId) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (botToken && String(botToken).trim()) {
      props.setProperty('SAVED_TELEGRAM_BOT_TOKEN', String(botToken).trim());
    }
    if (chatId !== undefined && chatId !== null && String(chatId).trim()) {
      props.setProperty('SAVED_TELEGRAM_CHAT_ID', String(chatId).trim());
    }
  } catch (err) {}
}

function getSavedTelegramToken() {
  try {
    var saved = PropertiesService.getScriptProperties().getProperty('SAVED_TELEGRAM_BOT_TOKEN');
    if (saved && String(saved).trim()) return String(saved).trim();
  } catch (err) {}
  return String(TELEGRAM_BOT_TOKEN || '').trim();
}

function getSavedTelegramChatId() {
  try {
    var saved = PropertiesService.getScriptProperties().getProperty('SAVED_TELEGRAM_CHAT_ID');
    if (saved && String(saved).trim()) return String(saved).trim();
  } catch (err) {}
  return String(TELEGRAM_CHAT_ID || '').trim();
}

function parseTelegramChatIdsInGas(raw) {
  return String(raw || '')
    .split(/[\\s,;]+/)
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return Boolean(s); });
}

function setSavedTelegramScheduleConfig(payload) {
  if (!payload) return;
  try {
    var props = PropertiesService.getScriptProperties();
    if (typeof payload.telegramHeaderTitle === 'string' && payload.telegramHeaderTitle.trim()) {
      props.setProperty('SAVED_TG_HEADER_TITLE', payload.telegramHeaderTitle.trim());
    }
    if (Array.isArray(payload.reminderTimings) && payload.reminderTimings.length > 0) {
      var cleanTimings = payload.reminderTimings
        .map(function(n) { return Number(n); })
        .filter(function(n) { return !isNaN(n) && n >= 0 && n <= 10080; });
      if (cleanTimings.length > 0) {
        props.setProperty('SAVED_TG_REMINDER_TIMINGS', JSON.stringify(cleanTimings));
      }
    }
    if (typeof payload.dailyDigestEnabled === 'boolean') {
      props.setProperty('SAVED_TG_DIGEST_ENABLED', payload.dailyDigestEnabled ? 'true' : 'false');
    }
    if (typeof payload.dailyDigestTime === 'string' && /^\\d{1,2}:\\d{2}$/.test(payload.dailyDigestTime.trim())) {
      props.setProperty('SAVED_TG_DIGEST_TIME', payload.dailyDigestTime.trim());
    }
    if (typeof payload.telegramShowStats === 'boolean') {
      props.setProperty('SAVED_TG_SHOW_STATS', payload.telegramShowStats ? 'true' : 'false');
    }
    if (typeof payload.telegramShowButtons === 'boolean') {
      props.setProperty('SAVED_TG_SHOW_BUTTONS', payload.telegramShowButtons ? 'true' : 'false');
    }
    if (payload.telegramDeliveryMode === 'photo_card' || payload.telegramDeliveryMode === 'text_html') {
      props.setProperty('SAVED_TG_DELIVERY_MODE', payload.telegramDeliveryMode);
    }
  } catch (err) {}
}

function getSavedTelegramScheduleConfig() {
  var cfg = {
    headerTitle: String(TELEGRAM_HEADER_TITLE || 'สำนักบริหารแรงงานต่างด้าว · ระบบน้องเลขา'),
    reminderTimings: Array.isArray(TELEGRAM_REMINDER_TIMINGS) ? TELEGRAM_REMINDER_TIMINGS.slice() : [0, 15, 60],
    dailyDigestEnabled: Boolean(TELEGRAM_DAILY_DIGEST_ENABLED),
    dailyDigestTime: String(TELEGRAM_DAILY_DIGEST_TIME || '08:00'),
    showStats: Boolean(TELEGRAM_SHOW_STATS),
    showButtons: false,
    deliveryMode: String(TELEGRAM_DELIVERY_MODE || 'photo_card')
  };
  try {
    var props = PropertiesService.getScriptProperties();
    var h = props.getProperty('SAVED_TG_HEADER_TITLE');
    if (h && String(h).trim()) cfg.headerTitle = String(h).trim();
    var rt = props.getProperty('SAVED_TG_REMINDER_TIMINGS');
    if (rt) {
      var parsed = JSON.parse(rt);
      if (Array.isArray(parsed) && parsed.length > 0) cfg.reminderTimings = parsed;
    }
    var de = props.getProperty('SAVED_TG_DIGEST_ENABLED');
    if (de === 'true' || de === 'false') cfg.dailyDigestEnabled = (de === 'true');
    var dt = props.getProperty('SAVED_TG_DIGEST_TIME');
    if (dt && /^\\d{1,2}:\\d{2}$/.test(String(dt).trim())) cfg.dailyDigestTime = String(dt).trim();
    var ss = props.getProperty('SAVED_TG_SHOW_STATS');
    if (ss === 'true' || ss === 'false') cfg.showStats = (ss === 'true');
    var dm = props.getProperty('SAVED_TG_DELIVERY_MODE');
    if (dm === 'photo_card' || dm === 'text_html') cfg.deliveryMode = dm;
  } catch (err) {}
  return cfg;
}

function formatRemindMinutesInGas(mins) {
  var m = Number(mins || 0);
  if (m <= 0) return 'ตรงเวลาที่กำหนด';
  if (m < 60) return 'ล่วงหน้า ' + m + ' นาที';
  if (m === 60) return 'ล่วงหน้า 1 ชั่วโมง';
  if (m < 1440) {
    var hrs = Math.floor(m / 60);
    var rem = m % 60;
    return rem > 0 ? ('ล่วงหน้า ' + hrs + ' ชม. ' + rem + ' นาที') : ('ล่วงหน้า ' + hrs + ' ชั่วโมง');
  }
  var days = Math.round(m / 1440);
  return 'ล่วงหน้า ' + days + ' วัน';
}

function buildTelegramButtonsInGas() {
  return [];
}

function hasTelegramReminderBeenSentInGas(key) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('tgr_' + key)) return true;
  } catch (e) {}
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('TG_SENT_REMIND_KEYS');
    if (raw) {
      var list = JSON.parse(raw);
      if (Array.isArray(list) && list.indexOf(key) !== -1) return true;
    }
  } catch (e) {}
  return false;
}

function markTelegramReminderSentInGas(key) {
  try {
    CacheService.getScriptCache().put('tgr_' + key, '1', 21600);
  } catch (e) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('TG_SENT_REMIND_KEYS');
    var list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (list.indexOf(key) === -1) {
      list.push(key);
      if (list.length > 180) list = list.slice(list.length - 180);
      props.setProperty('TG_SENT_REMIND_KEYS', JSON.stringify(list));
    }
  } catch (e) {}
}

function escapeTelegramHtmlInGas(raw) {
  return String(raw || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendTelegramMessageInGas(opts) {
  var token = String((opts && opts.botToken) || getSavedTelegramToken() || '').trim();
  var rawChatIds = String((opts && opts.chatId) || getSavedTelegramChatId() || '').trim();
  var htmlText = String((opts && opts.htmlText) || '').trim();
  if (!token || !rawChatIds || !htmlText) {
    return { ok: false, deliveredCount: 0, failedCount: 1, error: 'Missing Telegram Bot Token, Chat ID, or message' };
  }
  if (opts && opts.dedupKey) {
    try {
      var cache = CacheService.getScriptCache();
      if (cache.get('tg_dedup_' + opts.dedupKey)) {
        return { ok: true, deliveredCount: 1, failedCount: 0, deduplicated: true };
      }
      cache.put('tg_dedup_' + opts.dedupKey, '1', 2700);
    } catch (e) {}
  }

  var chatIds = parseTelegramChatIdsInGas(rawChatIds);
  var delivered = 0;
  var failed = 0;
  var lastErr = '';
  for (var i = 0; i < chatIds.length; i++) {
    try {
      var body = {
        chat_id: chatIds[i],
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      if (opts && Array.isArray(opts.buttons) && opts.buttons.length > 0) {
        body.reply_markup = { inline_keyboard: opts.buttons };
      }
      var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      var parsed = {};
      try { parsed = JSON.parse(resp.getContentText() || '{}'); } catch (e) {}
      if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300 && parsed.ok) {
        delivered++;
      } else {
        failed++;
        lastErr = String(parsed.description || ('HTTP ' + resp.getResponseCode()));
      }
    } catch (err) {
      failed++;
      lastErr = String(err);
    }
  }
  return { ok: delivered > 0, deliveredCount: delivered, failedCount: failed, error: lastErr };
}

function sendTelegramPhotoBlobInGas(opts) {
  var token = String((opts && opts.botToken) || getSavedTelegramToken() || '').trim();
  var rawChatIds = String((opts && opts.chatId) || getSavedTelegramChatId() || '').trim();
  var photoBlob = opts && opts.photoBlob;
  if (!token || !rawChatIds || !photoBlob) {
    return { ok: false, deliveredCount: 0, failedCount: 1, error: 'Missing Telegram photo parameters' };
  }
  if (opts && opts.dedupKey) {
    try {
      var cache = CacheService.getScriptCache();
      if (cache.get('tg_dedup_' + opts.dedupKey)) {
        return { ok: true, deliveredCount: 1, failedCount: 0, deduplicated: true };
      }
      cache.put('tg_dedup_' + opts.dedupKey, '1', 2700);
    } catch (e) {}
  }

  var chatIds = parseTelegramChatIdsInGas(rawChatIds);
  var caption = String((opts && opts.captionHtml) || '').slice(0, 1000);
  var delivered = 0;
  var failed = 0;
  var lastErr = '';

  for (var i = 0; i < chatIds.length; i++) {
    try {
      var formPayload = {
        chat_id: chatIds[i],
        photo: photoBlob
      };
      if (caption) {
        formPayload.caption = caption;
        formPayload.parse_mode = 'HTML';
      }
      var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
        method: 'post',
        payload: formPayload,
        muteHttpExceptions: true
      });
      var parsed = {};
      try { parsed = JSON.parse(resp.getContentText() || '{}'); } catch (e) {}
      if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300 && parsed.ok) {
        delivered++;
      } else {
        failed++;
        lastErr = String(parsed.description || ('HTTP ' + resp.getResponseCode()));
      }
    } catch (err) {
      failed++;
      lastErr = String(err);
    }
  }
  return { ok: delivered > 0, deliveredCount: delivered, failedCount: failed, error: lastErr };
}

function styleSlideTextInGas(shape, text, fontSize, colorHex, isBold, align) {
  var tf = shape.getText();
  tf.setText(String(text || ''));
  var style = tf.getTextStyle();
  style.setFontFamily('Sarabun');
  style.setFontSize(fontSize);
  style.setForegroundColor(colorHex);
  style.setBold(Boolean(isBold));
  if (align) {
    tf.getParagraphStyle().setParagraphAlignment(align);
  }
}

// สร้างการ์ดภาพ PNG คมชัด (1600x900) ด้วย Google Slides ภายใน Google Cloud ฟรี 100% แล้วลบไฟล์ชั่วคราวทันที
function renderSingleTaskCardBlobInGas(task, remindText, cfg, stats) {
  var presId = '';
  try {
    var pres = SlidesApp.create('Lakha_TaskCard_Temp_' + Date.now());
    presId = pres.getId();
    var slide = pres.getSlides()[0];
    var pageId = slide.getObjectId();
    var existing = slide.getPageElements();
    for (var ei = 0; ei < existing.length; ei++) {
      existing[ei].remove();
    }

    var isHigh = String(task.priority || '') === 'high';
    var isLow = String(task.priority || '') === 'low';
    var prioLabel = isHigh ? 'ด่วนมาก' : (isLow ? 'ทั่วไป' : 'สำคัญปานกลาง');
    var prioBg = isHigh ? '#DC2626' : (isLow ? '#059669' : '#D97706');
    var accentHex = isHigh ? '#EF4444' : '#F59E0B';
    var heading = isHigh ? 'แจ้งเตือนภารกิจด่วนมาก' : 'แจ้งเตือนกำหนดการตามเวลา';
    var taskDate = String(task.date || '').slice(0, 10);
    var taskHM = String(task.time || '09:00').trim();
    var cleanTitle = String(task.title || 'รายการงาน').trim();
    var cleanDesc = String(task.description || '').trim();

    slide.getBackground().setSolidFill('#E2E8F0');

    // แถบหัวการ์ด Royal Navy
    var headerRect = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, 720, 96);
    headerRect.getFill().setSolidFill('#0F172A');
    headerRect.getBorder().setTransparent();

    var accentBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 92, 720, 5);
    accentBar.getFill().setSolidFill(accentHex);
    accentBar.getBorder().setTransparent();

    var agencyBox = slide.insertTextBox('', 24, 14, 520, 26);
    styleSlideTextInGas(agencyBox, cfg.headerTitle, 13, '#FCD34D', true);

    var titleHeaderBox = slide.insertTextBox('', 24, 38, 520, 44);
    styleSlideTextInGas(titleHeaderBox, heading, 24, '#FFFFFF', true);

    var badgeShape = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 566, 28, 128, 36);
    badgeShape.getFill().setSolidFill(prioBg);
    badgeShape.getBorder().setTransparent();
    styleSlideTextInGas(badgeShape, prioLabel, 14, '#FFFFFF', true, SlidesApp.ParagraphAlignment.CENTER);

    // การ์ดขาวหลักตรงกลาง
    var cardHeight = (cfg.showStats && stats) ? 218 : 268;
    var cardBox = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 24, 112, 672, cardHeight);
    cardBox.getFill().setSolidFill('#FFFFFF');
    cardBox.getBorder().getLineFill().setSolidFill('#CBD5E1');

    var leftStripe = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 24, 124, 6, 62);
    leftStripe.getFill().setSolidFill(prioBg);
    leftStripe.getBorder().setTransparent();

    var taskTitleBox = slide.insertTextBox('', 44, 120, 636, 56);
    styleSlideTextInGas(taskTitleBox, cleanTitle.length > 90 ? (cleanTitle.slice(0, 89) + '…') : cleanTitle, 21, '#0F172A', true);

    // กล่องวันเวลา
    var metaBox = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 44, 180, 632, 62);
    metaBox.getFill().setSolidFill('#F8FAFC');
    metaBox.getBorder().getLineFill().setSolidFill('#E2E8F0');
    var dateLine = 'วันที่: ' + formatThaiFullDateInGas(taskDate);
    var timeLine = 'เวลา: ' + taskHM + ' น.  (' + remindText + ')';
    styleSlideTextInGas(metaBox, dateLine + '\\n' + timeLine, 14, '#0369A1', true);

    // กล่องรายละเอียดเพิ่มเติม (ถ้ามี)
    if (cleanDesc) {
      var descBox = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 44, 250, 632, (cfg.showStats && stats) ? 68 : 112);
      descBox.getFill().setSolidFill('#F8FAFC');
      descBox.getBorder().getLineFill().setSolidFill('#E2E8F0');
      var clippedDesc = cleanDesc.length > 150 ? (cleanDesc.slice(0, 149) + '…') : cleanDesc;
      styleSlideTextInGas(descBox, 'รายละเอียด: ' + clippedDesc, 13, '#334155', false);
    }

    // แถบสรุป KPI ด้านล่าง
    if (cfg.showStats && stats) {
      var kpiBar = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 24, 342, 672, 46);
      kpiBar.getFill().setSolidFill('#0F172A');
      kpiBar.getBorder().setTransparent();
      var kpiText = 'สรุปงานทั้งหมด: ' + stats.total + ' งาน   |   รอดำเนินการ: ' + stats.pending + ' งาน   |   เสร็จสิ้นแล้ว: ' + stats.completed + ' งาน';
      styleSlideTextInGas(kpiBar, kpiText, 13, '#E2E8F0', true, SlidesApp.ParagraphAlignment.CENTER);
    }

    pres.saveAndClose();

    var pngUrl = 'https://docs.google.com/presentation/d/' + presId + '/export/png?id=' + presId + '&pageid=' + pageId;
    var pngResp = UrlFetchApp.fetch(pngUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var ct = String(pngResp.getHeaders()['Content-Type'] || pngResp.getHeaders()['content-type'] || '').toLowerCase();
    if (pngResp.getResponseCode() === 200 && ct.indexOf('image/') === 0) {
      return pngResp.getBlob().setName('lakha-task-card.png');
    }
    return null;
  } catch (err) {
    Logger.log('Single task card PNG render fallback: ' + err);
    return null;
  } finally {
    if (presId) {
      try { DriveApp.getFileById(presId).setTrashed(true); } catch (e) {}
    }
  }
}

function renderDailyDigestCardBlobInGas(todayYMD, nowHM, todayTasks, cfg) {
  var presId = '';
  try {
    var pres = SlidesApp.create('Lakha_DigestCard_Temp_' + Date.now());
    presId = pres.getId();
    var slide = pres.getSlides()[0];
    var pageId = slide.getObjectId();
    var existing = slide.getPageElements();
    for (var ei = 0; ei < existing.length; ei++) {
      existing[ei].remove();
    }

    var doneCnt = todayTasks.filter(function(t) { return t.status === 'completed'; }).length;
    var pendingCnt = todayTasks.length - doneCnt;

    slide.getBackground().setSolidFill('#E2E8F0');

    var headerRect = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, 720, 108);
    headerRect.getFill().setSolidFill('#0F172A');
    headerRect.getBorder().setTransparent();

    var accentBar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 104, 720, 4);
    accentBar.getFill().setSolidFill('#F59E0B');
    accentBar.getBorder().setTransparent();

    var agencyBox = slide.insertTextBox('', 24, 10, 460, 24);
    styleSlideTextInGas(agencyBox, cfg.headerTitle, 12, '#FCD34D', true);

    var headBox = slide.insertTextBox('', 24, 34, 430, 36);
    styleSlideTextInGas(headBox, 'สรุปตารางงานประจำวัน', 22, '#FFFFFF', true);

    var dateBox = slide.insertTextBox('', 24, 72, 430, 26);
    styleSlideTextInGas(dateBox, formatThaiFullDateInGas(todayYMD) + ' · อัปเดต ' + nowHM + ' น.', 12, '#CBD5E1', false);

    // 3 กล่อง KPI ขวาบน
    var kpi1 = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 466, 22, 74, 64);
    kpi1.getFill().setSolidFill('#1E293B');
    kpi1.getBorder().setTransparent();
    styleSlideTextInGas(kpi1, todayTasks.length + '\\nทั้งหมด', 13, '#FFFFFF', true, SlidesApp.ParagraphAlignment.CENTER);

    var kpi2 = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 548, 22, 74, 64);
    kpi2.getFill().setSolidFill('#1E293B');
    kpi2.getBorder().setTransparent();
    styleSlideTextInGas(kpi2, pendingCnt + '\\nรอทำ', 13, '#FDE68A', true, SlidesApp.ParagraphAlignment.CENTER);

    var kpi3 = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 630, 22, 74, 64);
    kpi3.getFill().setSolidFill('#1E293B');
    kpi3.getBorder().setTransparent();
    styleSlideTextInGas(kpi3, doneCnt + '\\nเสร็จแล้ว', 13, '#6EE7B7', true, SlidesApp.ParagraphAlignment.CENTER);

    var visible = todayTasks.slice(0, 5);
    var rowTop = 120;
    var rowH = 48;
    var rowGap = 7;

    for (var i = 0; i < visible.length; i++) {
      var item = visible[i];
      var y = rowTop + i * (rowH + rowGap);
      var isDone = item.status === 'completed';
      var isHigh = !isDone && item.priority === 'high';
      var barHex = isDone ? '#10B981' : (isHigh ? '#DC2626' : '#0284C7');
      var statusHex = isDone ? '#15803D' : (isHigh ? '#B91C1C' : '#0369A1');
      var statusBg = isDone ? '#DCFCE7' : (isHigh ? '#FEE2E2' : '#E0F2FE');
      var statusTxt = isDone ? 'เสร็จแล้ว' : (isHigh ? 'ด่วนมาก' : 'รอทำ');

      var rowCard = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 24, y, 672, rowH);
      rowCard.getFill().setSolidFill('#FFFFFF');
      rowCard.getBorder().getLineFill().setSolidFill('#CBD5E1');

      var bar = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 24, y + 6, 5, rowH - 12);
      bar.getFill().setSolidFill(barHex);
      bar.getBorder().setTransparent();

      var titleStr = String(item.title || '').trim();
      if (titleStr.length > 52) titleStr = titleStr.slice(0, 51) + '…';
      var rowLabel = (i + 1) + '. ' + String(item.time || '09:00') + ' น.  —  ' + titleStr;
      var txtBox = slide.insertTextBox('', 38, y + 7, 560, 34);
      styleSlideTextInGas(txtBox, rowLabel, 14, isDone ? '#64748B' : '#0F172A', true);

      var pill = slide.insertShape(SlidesApp.ShapeType.ROUND_RECTANGLE, 606, y + 11, 78, 26);
      pill.getFill().setSolidFill(statusBg);
      pill.getBorder().setTransparent();
      styleSlideTextInGas(pill, statusTxt, 11, statusHex, true, SlidesApp.ParagraphAlignment.CENTER);
    }

    if (todayTasks.length > visible.length) {
      var moreBox = slide.insertTextBox('', 24, 382, 672, 20);
      styleSlideTextInGas(moreBox, 'และอีก ' + (todayTasks.length - visible.length) + ' รายการในปฏิทินทีม · ระบบน้องเลขา', 11, '#475569', true, SlidesApp.ParagraphAlignment.CENTER);
    }

    pres.saveAndClose();

    var pngUrl = 'https://docs.google.com/presentation/d/' + presId + '/export/png?id=' + presId + '&pageid=' + pageId;
    var pngResp = UrlFetchApp.fetch(pngUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var ct = String(pngResp.getHeaders()['Content-Type'] || pngResp.getHeaders()['content-type'] || '').toLowerCase();
    if (pngResp.getResponseCode() === 200 && ct.indexOf('image/') === 0) {
      return pngResp.getBlob().setName('lakha-daily-digest.png');
    }
    return null;
  } catch (err) {
    Logger.log('Daily digest card PNG render fallback: ' + err);
    return null;
  } finally {
    if (presId) {
      try { DriveApp.getFileById(presId).setTrashed(true); } catch (e) {}
    }
  }
}

function detectTelegramChatsInGas(botToken) {
  var token = String(botToken || getSavedTelegramToken() || '').trim();
  if (!token) {
    return { status: 'error', mode: 'gas_telegram_updates', ok: false, chats: [], message: 'Missing Bot Token' };
  }
  try {
    var meResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true });
    var meData = JSON.parse(meResp.getContentText() || '{}');
    if (!meData.ok) {
      return { status: 'error', mode: 'gas_telegram_updates', ok: false, chats: [], message: String(meData.description || 'Invalid Bot Token') };
    }
    var botUsername = meData.result && meData.result.username ? '@' + meData.result.username : '';
    var botFirstName = meData.result && meData.result.first_name ? meData.result.first_name : '';

    var updResp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates?limit=50', { muteHttpExceptions: true });
    var updData = JSON.parse(updResp.getContentText() || '{}');
    var updates = Array.isArray(updData.result) ? updData.result : [];
    var byId = {};
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i] || {};
      var msg = u.message || u.channel_post || u.my_chat_member || u.edited_message;
      if (!msg || !msg.chat || msg.chat.id === undefined) continue;
      var cid = String(msg.chat.id);
      var title = String(msg.chat.title || '').trim() ||
        [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ').trim() ||
        (msg.chat.username ? '@' + msg.chat.username : 'Chat ' + cid);
      byId[cid] = {
        chatId: cid,
        type: String(msg.chat.type || 'private'),
        title: title,
        username: msg.chat.username ? '@' + msg.chat.username : undefined,
        lastMessageText: typeof msg.text === 'string' ? msg.text.slice(0, 60) : undefined
      };
    }
    var chats = Object.keys(byId).map(function(k) { return byId[k]; }).reverse();
    return {
      status: 'ok',
      mode: 'gas_telegram_updates',
      ok: true,
      botUsername: botUsername,
      botFirstName: botFirstName,
      chats: chats,
      message: chats.length > 0
        ? ('เชื่อมต่อบอท ' + (botUsername || botFirstName) + ' สำเร็จ! พบ ' + chats.length + ' ห้องแชทล่าสุด')
        : ('เชื่อมต่อบอท ' + (botUsername || botFirstName) + ' สำเร็จ แต่ยังไม่พบข้อความล่าสุด กรุณาพิมพ์ในกลุ่มหรือกด Start ในบอทแล้วลองใหม่')
    };
  } catch (err) {
    return { status: 'error', mode: 'gas_telegram_updates', ok: false, chats: [], message: String(err) };
  }
}

// ฟังก์ชัน 1: สรุปงานประจำวันตอนเช้าผ่าน Telegram ฟรี 24 ชม. (รองรับทั้งการ์ดภาพ PNG และข้อความ HTML)
function sendDailyTelegramDigest() {
  var token = getSavedTelegramToken();
  var chatId = getSavedTelegramChatId();
  if (!token || !chatId) return;
  var cfg = getSavedTelegramScheduleConfig();
  var now = new Date();
  var todayYMD = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var nowHM = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  var allTasks = readSheetTasksForWeb() || [];
  var todayTasks = allTasks.filter(function(t) {
    var sd = String(t.date || '').slice(0, 10);
    var ed = String(t.endDate || sd).slice(0, 10);
    return sd && sd <= todayYMD && ed >= todayYMD;
  }).sort(function(a, b) {
    return String(a.time || '09:00').localeCompare(String(b.time || '09:00'));
  });
  if (todayTasks.length === 0) return;

  var doneCnt = todayTasks.filter(function(t) { return t.status === 'completed'; }).length;
  var pendingCnt = todayTasks.length - doneCnt;
  var dedupKey = 'gas-tg-morning-' + todayYMD;

  if (cfg.deliveryMode !== 'text_html') {
    var digestBlob = renderDailyDigestCardBlobInGas(todayYMD, nowHM, todayTasks, cfg);
    if (digestBlob) {
      var captionLines = [
        '📋 <b>สรุปตารางงานประจำวัน</b>',
        '📅 ' + escapeTelegramHtmlInGas(formatThaiFullDateInGas(todayYMD)) + ' · อัปเดต <code>' + nowHM + ' น.</code>',
        '📊 ทั้งหมด <b>' + todayTasks.length + '</b> งาน · รอทำ <b>' + pendingCnt + '</b> · เสร็จแล้ว <b>' + doneCnt + '</b>'
      ];
      sendTelegramPhotoBlobInGas({
        botToken: token,
        chatId: chatId,
        photoBlob: digestBlob,
        captionHtml: captionLines.join('\\n'),
        dedupKey: dedupKey
      });
    } else {
      Logger.log('งดส่งข้อความธรรมดาเนื่องจากตั้งค่าโหมดการ์ดภาพเท่านั้น — กรุณารัน testSendTelegramReminderNow เพื่ออนุญาตสิทธิ์ Google Slides/Drive');
    }
    return;
  }

  var rows = [];
  for (var i = 0; i < Math.min(todayTasks.length, 15); i++) {
    var item = todayTasks[i];
    var icon = item.status === 'completed' ? '✅' : (item.priority === 'high' ? '🔴' : '▪️');
    var titleHtml = item.status === 'completed'
      ? ('<s>' + escapeTelegramHtmlInGas(item.title) + '</s>')
      : ('<b>' + escapeTelegramHtmlInGas(item.title) + '</b>');
    rows.push((i + 1) + '. ' + icon + ' <code>' + escapeTelegramHtmlInGas(item.time || '09:00') + ' น.</code> ' + titleHtml);
  }
  var lines = [
    '🏛 <b>' + escapeTelegramHtmlInGas(cfg.headerTitle) + '</b>',
    '☀️ <b>สรุปตารางงานประจำวัน</b>',
    '📅 ' + escapeTelegramHtmlInGas(formatThaiFullDateInGas(todayYMD)) + ' · ณ <code>' + nowHM + ' น.</code>'
  ];
  if (cfg.showStats) {
    lines.push('📊 ทั้งหมด <b>' + todayTasks.length + '</b> · รอทำ <b>' + pendingCnt + '</b> · เสร็จแล้ว <b>' + doneCnt + '</b>');
  }
  lines.push('<blockquote><b>📌 กำหนดการวันนี้ (' + todayTasks.length + ' รายการ)</b>\\n' + rows.join('\\n') + '</blockquote>');

  sendTelegramMessageInGas({
    botToken: token,
    chatId: chatId,
    htmlText: lines.join('\\n'),
    buttons: [],
    dedupKey: dedupKey
  });
}

// ฟังก์ชัน 2 (แนะนำให้ตั้ง Trigger ทุก 5 นาที): เช็กแจ้งเตือนงานล่วงหน้ารายงาน + สรุปงานเช้าอัตโนมัติ 24 ชม. แม้ปิดคอมพิวเตอร์
function checkTelegramTaskReminders() {
  var token = getSavedTelegramToken();
  var chatId = getSavedTelegramChatId();
  if (!token || !chatId) return;

  var cfg = getSavedTelegramScheduleConfig();
  var now = new Date();
  var nowMs = now.getTime();
  var todayYMD = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');

  // A) เช็กส่งสรุปงานประจำวันตอนเช้าตามเวลา dailyDigestTime เป๊ะๆ (วันละ 1 ครั้ง)
  if (cfg.dailyDigestEnabled && /^\\d{1,2}:\\d{2}$/.test(cfg.dailyDigestTime)) {
    var parts = cfg.dailyDigestTime.split(':');
    var paddedDigestHM = (parts[0].length === 1 ? '0' + parts[0] : parts[0]) + ':' + parts[1];
    var digestTarget = new Date(todayYMD + 'T' + paddedDigestHM + ':00+07:00');
    if (!isNaN(digestTarget.getTime())) {
      var diffDigestMin = (nowMs - digestTarget.getTime()) / 60000;
      if (diffDigestMin >= 0 && diffDigestMin <= 15) {
        var props = PropertiesService.getScriptProperties();
        var lastDigestDate = props.getProperty('LAST_TG_DIGEST_DATE') || '';
        if (lastDigestDate !== todayYMD) {
          sendDailyTelegramDigest();
          props.setProperty('LAST_TG_DIGEST_DATE', todayYMD);
        }
      }
    }
  }

  // B) เช็กแจ้งเตือนงานล่วงหน้ารายงาน (ทุกช่วงเวลาที่ตั้งไว้ เช่น ตรงเวลา / 15 นาที / 1 ชม. / 1 วัน)
  var allTasks = readSheetTasksForWeb() || [];
  if (allTasks.length === 0) return;

  var totalCount = allTasks.length;
  var completedCount = allTasks.filter(function(t) { return t.status === 'completed'; }).length;
  var pendingCount = totalCount - completedCount;

  for (var i = 0; i < allTasks.length; i++) {
    var task = allTasks[i];
    if (!task || String(task.status || '').trim().toLowerCase() === 'completed') continue;
    var taskDate = String(task.date || '').slice(0, 10);
    var rawTime = String(task.time || '09:00').trim();
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(taskDate) || !/^\\d{1,2}:\\d{2}$/.test(rawTime)) continue;
    var tParts = rawTime.split(':');
    var taskHM = (tParts[0].length === 1 ? '0' + tParts[0] : tParts[0]) + ':' + tParts[1];
    var taskStart = new Date(taskDate + 'T' + taskHM + ':00+07:00');
    if (isNaN(taskStart.getTime())) continue;
    var taskStartMs = taskStart.getTime();

    // รวมช่วงเตือนล่วงหน้าจากการตั้งค่าหลัก + ของงานนั้นๆ
    var timingMap = {};
    for (var ti = 0; ti < cfg.reminderTimings.length; ti++) {
      var m = Number(cfg.reminderTimings[ti]);
      if (!isNaN(m) && m >= 0) timingMap[String(m)] = m;
    }
    var ownRemind = Number(task.remindMinutesBefore);
    if (!isNaN(ownRemind) && ownRemind >= 0) {
      timingMap[String(ownRemind)] = ownRemind;
    }

    var offsets = Object.keys(timingMap).map(function(k) { return timingMap[k]; });
    for (var oi = 0; oi < offsets.length; oi++) {
      var rm = offsets[oi];
      var triggerMs = taskStartMs - rm * 60000;
      var deltaMin = (nowMs - triggerMs) / 60000;
      // หน้าต่าง 7 นาที (-1 ถึง +6 นาที) เพื่อให้ Trigger ทุก 5 นาทีไม่พลาดแม้แต่รายการเดียว
      if (deltaMin >= -1 && deltaMin <= 6) {
        var dedupKey = String(task.id || task.title).slice(0, 28) + '_' + taskDate + '_' + taskHM + '_' + rm;
        if (hasTelegramReminderBeenSentInGas(dedupKey)) continue;

        var remindText = formatRemindMinutesInGas(rm);
        var sendRes = { ok: false };

        if (cfg.deliveryMode !== 'text_html') {
          var cardBlob = renderSingleTaskCardBlobInGas(task, remindText, cfg, {
            total: totalCount,
            pending: pendingCount,
            completed: completedCount
          });
          if (cardBlob) {
            var capIcon = task.priority === 'high' ? '🚨' : '🔔';
            var photoCaption = [
              capIcon + ' <b>' + escapeTelegramHtmlInGas(task.title) + '</b>',
              '📅 ' + escapeTelegramHtmlInGas(formatThaiFullDateInGas(taskDate)) + ' · ⏰ <code>' + escapeTelegramHtmlInGas(taskHM) + ' น.</code> (' + escapeTelegramHtmlInGas(remindText) + ')'
            ].join('\\n');
            sendRes = sendTelegramPhotoBlobInGas({
              botToken: token,
              chatId: chatId,
              photoBlob: cardBlob,
              captionHtml: photoCaption,
              dedupKey: 'gas-tg-rem-' + dedupKey
            });
          } else {
            Logger.log('งดส่งแบบข้อความเนื่องจากตั้งค่าโหมดการ์ดภาพเท่านั้น — กรุณารัน testSendTelegramReminderNow เพื่ออนุญาตสิทธิ์ Slides/Drive');
          }
        } else {
          var prioBadge = task.priority === 'high'
            ? '🔴 ด่วนมาก'
            : (task.priority === 'low' ? '🟢 ทั่วไป' : '🟡 สำคัญปานกลาง');
          var alertHeading = task.priority === 'high'
            ? '🚨 แจ้งเตือนภารกิจด่วนมาก'
            : '⏰ แจ้งเตือนกำหนดการตามเวลา';
          var cardLines = [
            '<b>' + escapeTelegramHtmlInGas(task.title) + '</b>',
            '',
            '📅 <b>วันที่:</b> ' + escapeTelegramHtmlInGas(formatThaiFullDateInGas(taskDate)),
            '🕐 <b>เวลา:</b> <code>' + escapeTelegramHtmlInGas(taskHM) + ' น.</code> <i>(' + escapeTelegramHtmlInGas(remindText) + ')</i>',
            '⚡ <b>ระดับ:</b> ' + prioBadge
          ];
          var msgLines = [
            '🏛 <b>' + escapeTelegramHtmlInGas(cfg.headerTitle) + '</b>',
            '<b>' + alertHeading + '</b>',
            '<blockquote>' + cardLines.join('\\n') + '</blockquote>'
          ];
          if (task.description && String(task.description).trim()) {
            msgLines.push('<blockquote expandable>📝 <b>รายละเอียดเพิ่มเติม</b>\\n' + escapeTelegramHtmlInGas(String(task.description).trim()) + '</blockquote>');
          }
          if (cfg.showStats) {
            msgLines.push('📊 <i>สรุปงาน: ทั้งหมด ' + totalCount + ' · รอทำ ' + pendingCount + ' · เสร็จแล้ว ' + completedCount + '</i>');
          }

          sendRes = sendTelegramMessageInGas({
            botToken: token,
            chatId: chatId,
            htmlText: msgLines.join('\\n'),
            buttons: [],
            dedupKey: 'gas-tg-rem-' + dedupKey
          });
        }

        if (sendRes.ok) {
          markTelegramReminderSentInGas(dedupKey);
        }
      }
    }
  }
}

// ฟังก์ชัน 3 (กด Run เพียงครั้งเดียว!): ตั้งค่า Trigger อัตโนมัติทุก 5 นาทีให้ครบทั้งแจ้งเตือนล่วงหน้าและสรุปงานเช้า 24 ชม.
function setupTelegramAutoTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var fn = existing[i].getHandlerFunction();
    if (fn === 'checkTelegramTaskReminders' || fn === 'sendDailyTelegramDigest') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('checkTelegramTaskReminders')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('✅ ตั้งค่าแจ้งเตือน Telegram แบบการ์ดภาพอัตโนมัติ 24 ชม. สำเร็จ! (เช็กแจ้งเตือนงานล่วงหน้าและสรุปงานเช้าทุก 5 นาที แม้ปิดคอมพิวเตอร์)');
}

// ฟังก์ชันทดสอบส่งการ์ดภาพจากหน้า Apps Script โดยตรง (และใช้กดอนุญาตสิทธิ์ Slides/Drive ครั้งแรก)
function testSendTelegramReminderNow() {
  var token = getSavedTelegramToken();
  var chatId = getSavedTelegramChatId();
  var cfg = getSavedTelegramScheduleConfig();
  var nowHM = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
  var todayYMD = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var sampleTask = {
    title: 'ทดสอบส่งการ์ดภาพแจ้งเตือนอัตโนมัติ 24 ชม. (Apps Script)',
    description: 'ช่วงเตือนล่วงหน้า: ' + cfg.reminderTimings.map(formatRemindMinutesInGas).join(', ') + ' | สรุปงานเช้า: ' + cfg.dailyDigestTime + ' น.',
    date: todayYMD,
    time: nowHM,
    priority: 'medium'
  };
  if (cfg.deliveryMode !== 'text_html') {
    var testBlob = renderSingleTaskCardBlobInGas(sampleTask, 'ทดสอบระบบการ์ดภาพ', cfg, null);
    if (!testBlob) {
      throw new Error('ไม่สามารถสร้างการ์ดภาพได้ กรุณาตรวจสอบสิทธิ์ Google Slides / Drive ใน Apps Script แล้วกด Run อีกครั้ง');
    }
    var pRes = sendTelegramPhotoBlobInGas({
      botToken: token,
      chatId: chatId,
      photoBlob: testBlob,
      captionHtml: '✅ <b>ระบบส่งการ์ดภาพ Telegram อัตโนมัติ 24 ชม. พร้อมทำงานแล้ว!</b>'
    });
    if (!pRes.ok) {
      throw new Error('ส่งการ์ดภาพเข้า Telegram ไม่สำเร็จ: ' + (pRes.error || 'Unknown error'));
    }
    return;
  }
  sendTelegramMessageInGas({
    botToken: token,
    chatId: chatId,
    htmlText: [
      '🏛 <b>' + escapeTelegramHtmlInGas(cfg.headerTitle) + '</b>',
      '✅ <b>ระบบแจ้งเตือนอัตโนมัติ 24 ชม. (Apps Script) พร้อมทำงานแล้ว!</b>',
      '<blockquote>⏰ ช่วงแจ้งเตือนล่วงหน้า: <code>' + escapeTelegramHtmlInGas(cfg.reminderTimings.map(formatRemindMinutesInGas).join(', ')) + '</code>\\n☀️ สรุปงานประจำวัน: <code>' + escapeTelegramHtmlInGas(cfg.dailyDigestTime) + ' น.</code>\\n🕒 ทดสอบเมื่อ: <code>' + nowHM + ' น.</code></blockquote>'
    ].join('\\n'),
    buttons: []
  });
}`;
}

