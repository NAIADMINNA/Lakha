import { Category, LineMessageLog, LineSettings, Task, TaskPriority, TaskStatus, TeamMember } from '../types';

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
export function formatLocalDateYMD(date: Date = new Date()): string {
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

export function formatLocalTimeHM(date: Date = new Date()): string {
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

export function generateGoogleAppsScriptCode(
  spreadsheetId: string,
  channelAccessToken?: string,
  appUrl?: string
): string {
  let effectiveSheetId = (spreadsheetId || '').trim();
  let effectiveGroupId = '';
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
 * ระบบน้องเลขา (v2.7) — โค้ดเชื่อมต่อแอป LINE จริง + เว็บปฏิทินทีม Apps Script (ซิงค์ 2 ทาง 100%)
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

  function renderAgendaCard(r, idx) {
    var rDate = String(r[3] || cleanDateYMD).replace(/^'/, '');
    var rTime = String(r[4] || '09:00').replace(/^'/, '');
    var isPassedPhase = (rDate < todayStr) || (rDate === todayStr && rTime <= nowHM);
    var isDone = String(r[7]) === 'completed';
    var isHigh = String(r[6]) === 'high';
    var catName = String(r[5] || 'ทั่วไป');
    var catColor = /^#[0-9A-Fa-f]{6}$/.test(String(r[8] || '')) ? String(r[8]) : (isHigh ? '#DC2626' : '#2563EB');

    var badgeLabel = isDone
      ? '✓ เสร็จแล้ว'
      : (isHigh ? '🔥 ด่วนมาก' : (isPassedPhase ? '⚠️ เลยเวลา' : '⏳ รอถึงเวลา'));
    var badgeColor = isDone
      ? '#15803D'
      : (isHigh ? '#B91C1C' : (isPassedPhase ? '#B45309' : '#1D4ED8'));
    var badgeBg = isDone
      ? '#DCFCE7'
      : (isHigh ? '#FEE2E2' : (isPassedPhase ? '#FEF3C7' : '#DBEAFE'));

    var descText = String(r[2] || '').trim();
    var hasDesc = Boolean(descText) &&
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
            cornerRadius: '6px',
            paddingStart: '8px',
            paddingEnd: '8px',
            paddingTop: '3px',
            paddingBottom: '3px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: '⏰ ' + rTime + ' น.',
                weight: 'bold',
                size: 'xs',
                color: isDone ? '#64748B' : '#FFFFFF'
              }
            ]
          },
          {
            type: 'text',
            text: '• ' + catName,
            size: 'xxs',
            weight: 'bold',
            color: isDone ? '#94A3B8' : catColor,
            flex: 1,
            wrap: false
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: badgeBg,
            cornerRadius: '6px',
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
        text: (idx + 1) + '. ' + String(r[1] || 'งาน'),
        weight: 'bold',
        size: 'md',
        color: isDone ? '#94A3B8' : '#0F172A',
        wrap: true,
        margin: 'sm'
      }
    ];

    if (hasDesc) {
      innerContents.push({
        type: 'text',
        text: descText,
        size: 'xs',
        color: isDone ? '#94A3B8' : '#475569',
        wrap: true,
        margin: 'xs'
      });
    }

    return {
      type: 'box',
      layout: 'horizontal',
      margin: idx === 0 ? 'none' : 'md',
      backgroundColor: '#FFFFFF',
      cornerRadius: '12px',
      borderWidth: '1px',
      borderColor: (!isDone && isHigh) ? '#FCA5A5' : '#E2E8F0',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '6px',
          flex: 0,
          backgroundColor: isDone ? '#CBD5E1' : catColor,
          contents: [{ type: 'filler' }]
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          paddingAll: '12px',
          contents: innerContents
        }
      ]
    };
  }

  var sectionContents = [];
  if (total === 0) {
    sectionContents.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '20px',
      backgroundColor: '#FFFFFF',
      cornerRadius: '12px',
      borderWidth: '1px',
      borderColor: '#E2E8F0',
      contents: [
        {
          type: 'text',
          text: '🎉 วันนี้ไม่มีรายการงานในตารางของคุณ',
          size: 'sm',
          color: '#475569',
          align: 'center',
          weight: 'bold'
        }
      ]
    });
  } else {
    sortedRows.forEach(function(r, idx) {
      sectionContents.push(renderAgendaCard(r, idx));
    });
  }

  return {
    type: 'flex',
    altText: '📋 ตารางงานประจำวัน (' + fullThaiDate + ') — รวม ' + total + ' งาน',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F172A',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#06C755',
                cornerRadius: '6px',
                paddingStart: '8px',
                paddingEnd: '8px',
                paddingTop: '4px',
                paddingBottom: '4px',
                flex: 0,
                contents: [
                  {
                    type: 'text',
                    text: '📋 สรุปตารางงานประจำวัน',
                    color: '#FFFFFF',
                    size: 'xxs',
                    weight: 'bold'
                  }
                ]
              },
              {
                type: 'text',
                text: 'เวลา ' + nowHM + ' น.',
                color: '#94A3B8',
                size: 'xxs',
                align: 'end',
                weight: 'bold'
              }
            ]
          },
          {
            type: 'text',
            text: fullThaiDate,
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            margin: 'md',
            wrap: true
          },
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#1E293B',
            cornerRadius: '10px',
            paddingAll: '10px',
            margin: 'md',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ทั้งหมด ' + String(total), weight: 'bold', size: 'xs', color: '#38BDF8', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'รอดำเนินการ ' + String(pending), weight: 'bold', size: 'xs', color: '#FBBF24', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'เสร็จแล้ว ' + String(completed), weight: 'bold', size: 'xs', color: '#34D399', align: 'center' }
                ]
              }
            ]
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F1F5F9',
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
              color: '#06C755',
              height: 'sm',
              action: { type: 'uri', label: '📅 เปิดดูปฏิทินและจัดการงาน', uri: targetCalUrl }
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'uri', label: '📺 เปิดตารางงานนำเสนอ (รายวัน)', uri: scheduleUrl }
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
        t.lineNotified ? 'TRUE' : 'FALSE',
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
        version: '2.7-group-portal-clean',
        capabilities: ['webhook', 'push_line', 'get_tasks', 'sync_tasks', 'clear_richmenu', 'group_chat', 'team_portal'],
        detectedGroupId: getSavedGroupId(),
        detectedUserId: getSavedUserId(),
        tasks: tasks,
        message: 'ระบบน้องเลขา Webhook & Team Portal Ready (v2.7)'
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

    // คำสั่งลบ Rich Menu ทั้งหมดออกจาก LINE OA
    if (payload.action === 'clear_richmenu') {
      var rmRes = clearAllRichMenusFromLine(payload.channelAccessToken || getSavedLineToken(), payload.targetUserId);
      return ContentService.createTextOutput(JSON.stringify({
        status: rmRes.ok ? 'ok' : 'error',
        mode: 'gas_clear_richmenu',
        version: '2.7-group-portal-clean',
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
        version: '2.7-group-portal-clean',
        capabilities: ['webhook', 'push_line', 'get_tasks', 'sync_tasks', 'clear_richmenu', 'group_chat', 'team_portal'],
        detectedGroupId: getSavedGroupId(),
        detectedUserId: getSavedUserId(),
        hasToken: Boolean(getSavedLineToken()),
        tasks: readSheetTasksForWeb()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // บันทึก/อัปเดตรายการงานลง Google Sheets ผ่าน Apps Script โดยไม่ต้องล็อกอิน Gmail ซ้ำ
    if (payload.action === 'sync_tasks') {
      var savedOk = writeSheetTasksFromWeb(payload.tasks || []);
      return ContentService.createTextOutput(JSON.stringify({
        status: savedOk ? 'ok' : 'error',
        mode: 'gas_sync_tasks',
        version: '2.7-group-portal-clean',
        detectedGroupId: getSavedGroupId(),
        ok: savedOk
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // รองรับการส่งแจ้งเตือน LINE Push (ทั้งเข้าห้องแชทกลุ่ม Group ID C... และรายบุคคล U...) หรือ Broadcast
    if (payload.action === 'push_line') {
      var token = String(payload.channelAccessToken || getSavedLineToken() || '').replace(/^Bearer\\s+/i, '').trim();
      var targetId = String(payload.to || '').trim();
      var explicitGroupId = String(payload.targetGroupId || '').trim();
      var notifyMode = String(payload.teamNotificationMode || 'both');

      if (/^[CR][0-9a-fA-F]{32}$/.test(explicitGroupId)) {
        setSavedGroupId(explicitGroupId);
      } else if (/^[CR][0-9a-fA-F]{32}$/.test(targetId)) {
        setSavedGroupId(targetId);
      }

      var effectiveGroupId = /^[CR][0-9a-fA-F]{32}$/.test(explicitGroupId)
        ? explicitGroupId
        : (/^[CR][0-9a-fA-F]{32}$/.test(targetId) ? targetId : getSavedGroupId());

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
        var singleFooterButtons = [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            height: 'sm',
            action: { type: 'uri', label: '📅 เปิดดูปฏิทินของทีม', uri: calDeepLink }
          }
        ];
        if (sheetUrl && calDeepLink !== sheetUrl) {
          singleFooterButtons.push({
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'uri', label: '📊 เปิดตาราง Google Sheets', uri: sheetUrl }
          });
        }
        var fontSizeMode = payload.cardFontSize || 'md';
        var titleSize = fontSizeMode === 'sm' ? 'md' : fontSizeMode === 'lg' ? 'xl' : 'lg';
        var bodySize = fontSizeMode === 'sm' ? 'xxs' : fontSizeMode === 'lg' ? 'sm' : 'xs';
        var titleWeight = payload.cardTitleWeight === 'regular' ? 'regular' : 'bold';
        var lineSpacingVal = payload.cardLineSpacing === 'tight' ? '2px' : payload.cardLineSpacing === 'normal' ? '4px' : '6px';

        var prioKey = String(payload.priority || 'medium').toLowerCase();
        var prioHeaderBg = prioKey === 'high' ? '#B91C1C' : (prioKey === 'low' ? '#0F766E' : '#D97706');
        var prioStripBg = prioKey === 'high' ? '#991B1B' : (prioKey === 'low' ? '#115E59' : '#B45309');
        var prioBadgeBg = prioKey === 'high' ? '#FEF2F2' : (prioKey === 'low' ? '#F0FDFA' : '#FFFBEB');
        var prioBadgeColor = prioKey === 'high' ? '#991B1B' : (prioKey === 'low' ? '#115E59' : '#92400E');
        var prioBorderAccent = prioKey === 'high' ? '#FCA5A5' : (prioKey === 'low' ? '#99F6E4' : '#FCD34D');
        var prioBadgeText = prioKey === 'high' ? '🔥 ด่วนมาก • ความสำคัญสูง' : (prioKey === 'low' ? '📌 งานทั่วไป • ตามกำหนดการ' : '⚡ ความสำคัญปานกลาง');
        var prioShortLabel = prioKey === 'high' ? 'สูง (งานด่วนมาก)' : (prioKey === 'low' ? 'ทั่วไป (ตามกำหนดการ)' : 'ปานกลาง (มาตรฐาน)');

        var cleanTaskTime = String(payload.time || '09:00').replace(/^'/, '');
        var cleanTaskDateLabel = String(payload.dateTime || '').replace(/\\s*·?\\s*\\d{1,2}:\\d{2}\\s*น\\.?$/, '').trim();
        if (!cleanTaskDateLabel) {
          cleanTaskDateLabel = payload.date ? formatThaiFullDateInGas(String(payload.date)) : 'วันนี้';
        }
        var catColorHex = /^#[0-9A-Fa-f]{6}$/.test(String(payload.categoryColor || '')) ? String(payload.categoryColor) : prioHeaderBg;
        var rawDescText = String(payload.description || '').trim();
        var hasCleanDesc = Boolean(rawDescText) &&
          rawDescText !== String(payload.taskTitle || '').trim() &&
          rawDescText.indexOf('เพิ่มผ่านแชท LINE') !== 0 &&
          rawDescText.indexOf('บันทึกผ่านแชท LINE') !== 0 &&
          rawDescText.indexOf('เพิ่มผ่านหน้าปฏิทิน') !== 0;

        var detailCardContents = [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: prioBadgeBg,
            cornerRadius: '10px',
            borderWidth: '1px',
            borderColor: prioBorderAccent,
            paddingAll: '12px',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                contents: [
                  {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: prioHeaderBg,
                    cornerRadius: '6px',
                    paddingStart: '10px',
                    paddingEnd: '10px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    flex: 0,
                    contents: [
                      {
                        type: 'text',
                        text: '⏰ เวลา ' + cleanTaskTime + ' น.',
                        size: 'sm',
                        weight: 'bold',
                        color: '#FFFFFF'
                      }
                    ]
                  },
                  {
                    type: 'text',
                    text: 'กำหนดการนัดหมาย',
                    size: 'xxs',
                    weight: 'bold',
                    color: prioBadgeColor,
                    align: 'end',
                    flex: 1
                  }
                ]
              },
              {
                type: 'text',
                text: '🗓️ ' + cleanTaskDateLabel,
                size: fontSizeMode === 'sm' ? 'xs' : 'sm',
                weight: 'bold',
                color: '#0F172A',
                margin: 'sm',
                wrap: true
              }
            ]
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'md',
            contents: [
              { type: 'text', text: '🗂️ หมวดหมู่', size: bodySize, color: '#64748B', flex: 3 },
              { type: 'text', text: String(payload.categoryName || 'ทั่วไป'), size: bodySize, weight: 'bold', color: catColorHex, flex: 7, wrap: true }
            ]
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'sm',
            contents: [
              { type: 'text', text: '⚡ ความสำคัญ', size: bodySize, color: '#64748B', flex: 3 },
              { type: 'text', text: prioShortLabel, size: bodySize, weight: 'bold', color: prioBadgeColor, flex: 7, wrap: true }
            ]
          }
        ];

        if (hasCleanDesc) {
          detailCardContents.push({
            type: 'separator',
            margin: 'md',
            color: '#E2E8F0'
          });
          detailCardContents.push({
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F8FAFC',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              { type: 'text', text: '📝 รายละเอียดงาน', size: 'xxs', weight: 'bold', color: '#475569' },
              { type: 'text', text: rawDescText, size: bodySize, color: '#1E293B', lineSpacing: lineSpacingVal, wrap: true, margin: 'xs' }
            ]
          });
        }

        var singleBodyContents = [
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#FFFFFF',
            cornerRadius: '12px',
            borderWidth: '1px',
            borderColor: prioKey === 'high' ? '#FCA5A5' : '#E2E8F0',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                width: '6px',
                flex: 0,
                backgroundColor: prioHeaderBg,
                contents: [{ type: 'filler' }]
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                paddingAll: '14px',
                contents: detailCardContents
              }
            ]
          }
        ];

        if (payload.stats && typeof payload.stats.total === 'number') {
          singleBodyContents.push({
            type: 'box',
            layout: 'horizontal',
            backgroundColor: '#0F172A',
            cornerRadius: '10px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ทั้งหมด ' + String(payload.stats.total), size: 'xxs', weight: 'bold', color: '#38BDF8', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'รอทำ ' + String(payload.stats.pending || 0), size: 'xxs', weight: 'bold', color: '#FBBF24', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'เสร็จแล้ว ' + String(payload.stats.completed || 0), size: 'xxs', weight: 'bold', color: '#34D399', align: 'center' }
                ]
              }
            ]
          });
        }

        messagesPayload = [{
          type: 'flex',
          altText: ('🔔 แจ้งเตือนงาน: ' + String(payload.taskTitle) + ' (' + cleanTaskDateLabel + ' เวลา ' + cleanTaskTime + ' น.)').slice(0, 300),
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: prioHeaderBg,
              paddingAll: '18px',
              contents: [
                {
                  type: 'box',
                  layout: 'horizontal',
                  alignItems: 'center',
                  contents: [
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: prioBadgeBg,
                      cornerRadius: '6px',
                      paddingStart: '8px',
                      paddingEnd: '8px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      flex: 0,
                      contents: [
                        { type: 'text', text: prioBadgeText, color: prioBadgeColor, size: 'xxs', weight: 'bold' }
                      ]
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: prioStripBg,
                      cornerRadius: '6px',
                      paddingStart: '8px',
                      paddingEnd: '8px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      flex: 0,
                      margin: 'sm',
                      contents: [
                        { type: 'text', text: '🗂️ ' + String(payload.categoryName || 'ทั่วไป'), color: '#FFFFFF', size: 'xxs', weight: 'bold' }
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
                  type: 'box',
                  layout: 'horizontal',
                  backgroundColor: '#FFFFFF',
                  cornerRadius: '10px',
                  paddingStart: '10px',
                  paddingEnd: '12px',
                  paddingTop: '8px',
                  paddingBottom: '8px',
                  margin: 'md',
                  alignItems: 'center',
                  spacing: 'sm',
                  contents: [
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: '#0F172A',
                      cornerRadius: '6px',
                      paddingStart: '8px',
                      paddingEnd: '8px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      flex: 0,
                      contents: [
                        { type: 'text', text: '⏰ ' + cleanTaskTime + ' น.', color: '#FFFFFF', size: 'xs', weight: 'bold' }
                      ]
                    },
                    {
                      type: 'text',
                      text: '🗓️ ' + cleanTaskDateLabel,
                      color: prioBadgeColor,
                      size: 'xs',
                      weight: 'bold',
                      flex: 1,
                      wrap: true
                    }
                  ]
                }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F1F5F9',
              paddingAll: '16px',
              contents: singleBodyContents
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
        }
      }

      // 2. ส่งเข้าแชทส่วนตัว U... (กรณีระบุ User ID)
      if (isValidUserTarget && notifyMode !== 'group') {
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
        }
      }

      // 3. ส่งแบบ Broadcast หาเพื่อนทุกคน (รูปแบบที่ 1 หรือเมื่อยังไม่ได้ส่งสำเร็จ)
      if ((!sentSuccess || (notifyMode === 'both' && !isValidUserTarget)) && notifyMode !== 'group') {
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

      return ContentService.createTextOutput(JSON.stringify({
        status: sentSuccess ? 'ok' : 'error',
        mode: 'gas_push_line',
        version: '2.6-group-bridge',
        ok: sentSuccess,
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
        version: '2.6-group-bridge',
        detectedGroupId: getSavedGroupId(),
        capabilities: ['webhook', 'push_line', 'group_chat']
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
          text: '✅ เชื่อมต่อห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat) สำเร็จแล้ว!\\n\\n🔑 รหัส Group ID ของกลุ่มนี้คือ:\\n' + srcGroupId + '\\n\\n💡 คุณสามารถคัดลอกรหัส C... ด้านบนไปวางในหน้าเว็บ หรือกดปุ่ม "ดึงรหัสกลุ่ม C... อัตโนมัติ" บนหน้าเว็บได้ทันทีครับ!'
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
          var rows = currentList.map(function(t) {
            return [t.id, t.title, t.description || '', t.date, t.time || '09:00', t.categoryId || 'cat-work', t.priority || 'medium', t.status || 'pending'];
          });
          var queryDate = parseThaiCommand(userMessage).date || todayStr;
          var filtered = userMessage === 'งานค้าง'
            ? rows.filter(function(r) { return String(r[7]) !== 'completed'; })
            : rows.filter(function(r) { return String(r[3]).replace(/^'/, '') === queryDate; });
          var flexBubble = buildSummaryFlexBubble(
            userMessage === 'งานค้าง' ? 'สรุปงานค้างทั้งหมด' : ('สรุปตารางงานวันที่ ' + queryDate),
            queryDate,
            filtered
          );
          replyLineMessages(replyToken, [flexBubble]);
          return;
        }

        var parsed = parseThaiCommand(userMessage);
        var newId = 'task-' + now.getTime();
        var existingAll = readSheetTasksForWeb();
        var createdObj = {
          id: newId,
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
        var updatedAll = [createdObj].concat(existingAll);
        writeSheetTasksFromWeb(updatedAll);
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

        var bodyContents = [
          { type: 'text', text: '🗓️ วันที่: ' + parsed.date + '   ⏰ เวลา: ' + parsed.time + ' น.', size: 'xs', weight: 'bold', color: '#0F172A' },
          { type: 'text', text: '⚡ ความสำคัญ: ' + (parsed.priority === 'high' ? 'สูง (เร่งด่วน)' : 'ปานกลาง'), size: 'xs', color: '#475569' },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#EEF2FF',
            cornerRadius: '8px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              { type: 'text', text: '📊 สรุปตารางวันที่ ' + parsed.date, size: 'xxs', weight: 'bold', color: '#4338CA' },
              { type: 'text', text: 'รวมทั้งหมด ' + dayTotalCount + ' งาน · รอดำเนินการ ' + dayPendingCount + ' งาน', size: 'xs', weight: 'bold', color: '#1E1B4B', margin: 'xs' }
            ]
          }
        ];

        if (srcGroupId) {
          bodyContents.push({
            type: 'text',
            text: '🔑 Group ID: ' + srcGroupId,
            size: 'xxs',
            color: '#059669',
            wrap: true,
            margin: 'sm'
          });
        }

        var savedFlex = {
          type: 'flex',
          altText: '✅ บันทึกงาน: ' + parsed.title + (srcGroupId ? ' (Group ID: ' + srcGroupId + ')' : ''),
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: parsed.priority === 'high' ? '#DC2626' : '#059669',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: srcGroupId ? '✅ บันทึกงานจากกลุ่ม LINE เรียบร้อย' : '✅ บันทึกลงปฏิทินเรียบร้อย', color: '#FFFFFF', size: 'xs', weight: 'bold' },
                { type: 'text', text: parsed.title, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true, margin: 'xs' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '16px',
              spacing: 'sm',
              contents: bodyContents
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '12px',
              contents: (function() {
                var targetCal = getCalendarDeepLink('', parsed.date);
                var backupPortal = getSelfWebAppUrl() ? (getSelfWebAppUrl() + '?view=calendar&openExternalBrowser=1') : '';
                var btns = [
                  {
                    type: 'button',
                    style: 'primary',
                    color: '#06C755',
                    height: 'sm',
                    action: { type: 'uri', label: 'เปิดดูปฏิทินและจัดการงาน', uri: targetCal }
                  }
                ];
                if (backupPortal && targetCal.indexOf('script.google.com') === -1) {
                  btns.push({
                    type: 'button',
                    style: 'secondary',
                    height: 'sm',
                    action: { type: 'uri', label: '📅 ปฏิทินทีมสำรอง (ไม่ต้องล็อกอิน)', uri: backupPortal }
                  });
                }
                return btns;
              })()
            }
          }
        };
        replyLineMessages(replyToken, [savedFlex]);
      }
    });
  } catch (err) {}

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', version: '2.6-group-bridge', detectedGroupId: getSavedGroupId() })).setMimeType(ContentService.MimeType.JSON);
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
}`;
}

