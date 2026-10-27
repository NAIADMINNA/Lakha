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
  { minutes: 15, label: 'ก่อนเริ่มงาน 15 นาที', shortLabel: '15 นาที' },
  { minutes: 30, label: 'ก่อนเริ่มงาน 30 นาที', shortLabel: '30 นาที' },
  { minutes: 60, label: 'ก่อนเริ่มงาน 1 ชั่วโมง', shortLabel: '1 ชั่วโมง' },
  { minutes: 180, label: 'ก่อนเริ่มงาน 3 ชั่วโมง', shortLabel: '3 ชั่วโมง' },
  { minutes: 1440, label: 'ล่วงหน้า 1 วัน (24 ชั่วโมง)', shortLabel: '1 วันก่อนเริ่ม' },
  { minutes: 2880, label: 'ล่วงหน้า 2 วัน (48 ชั่วโมง)', shortLabel: '2 วันก่อนเริ่ม' },
];

export function formatRemindMinutesLabel(minutes: number): string {
  if (minutes <= 0) return 'ไม่แจ้งเตือนอัตโนมัติ';
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
    .replace(/\{date\}/g, task.date)
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

  const allowedPriorities =
    Array.isArray(settings.triggerPriorities) && settings.triggerPriorities.length > 0
      ? settings.triggerPriorities
      : [TaskPriority.HIGH, TaskPriority.MEDIUM, TaskPriority.LOW];
  if (!allowedPriorities.includes(task.priority)) {
    return {
      allowed: false,
      reason: `ระดับความสำคัญ "${task.priority}" ถูกปิดการแจ้งเตือนไว้`,
    };
  }

  if (
    Array.isArray(settings.triggerCategoryIds) &&
    settings.triggerCategoryIds.length > 0 &&
    !settings.triggerCategoryIds.includes(task.categoryId)
  ) {
    return {
      allowed: false,
      reason: 'หมวดหมู่งานนี้ไม่ได้เปิดรับการแจ้งเตือน',
    };
  }

  const allowedSources =
    Array.isArray(settings.triggerSources) && settings.triggerSources.length > 0
      ? settings.triggerSources
      : ['web', 'line', 'sheets'];
  if (!allowedSources.includes(task.source)) {
    return {
      allowed: false,
      reason: `แหล่งที่มา "${task.source}" ถูกปิดการแจ้งเตือนไว้`,
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

function extractThaiDate(input: string): { dateStr: string; cleanedText: string } {
  let text = input;
  const nowBangkok = getBangkokDateObject(0);
  const todayStr = formatPlainDateObjYMD(nowBangkok);

  // 1. Check YYYY-MM-DD
  const isoMatch = text.match(/(?:วันที่\s*)?(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = normalizeYear(parseInt(isoMatch[1], 10));
    const m = String(Math.min(12, Math.max(1, parseInt(isoMatch[2], 10)))).padStart(2, '0');
    const d = String(Math.min(31, Math.max(1, parseInt(isoMatch[3], 10)))).padStart(2, '0');
    text = text.replace(isoMatch[0], ' ');
    return { dateStr: `${y}-${m}-${d}`, cleanedText: text };
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
      return { dateStr: `${y}-${m}-${d}`, cleanedText: text };
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
        return { dateStr: `${y}-${m}-${d}`, cleanedText: text };
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
    return { dateStr: `${y}-${m}-${d}`, cleanedText: text };
  }

  // 5. Relative Thai date words
  if (text.includes('มะรืนนี้') || text.includes('มะรืน')) {
    const d = getBangkokDateObject(2);
    text = text.replace(/มะรืนนี้|มะรืน/g, ' ');
    return { dateStr: formatPlainDateObjYMD(d), cleanedText: text };
  }
  if (text.includes('พรุ่งนี้')) {
    const d = getBangkokDateObject(1);
    text = text.replace(/พรุ่งนี้/g, ' ');
    return { dateStr: formatPlainDateObjYMD(d), cleanedText: text };
  }
  if (text.includes('สัปดาห์หน้า') || text.includes('อาทิตย์หน้า')) {
    const d = getBangkokDateObject(7);
    text = text.replace(/สัปดาห์หน้า|อาทิตย์หน้า/g, ' ');
    return { dateStr: formatPlainDateObjYMD(d), cleanedText: text };
  }
  if (text.includes('วันนี้')) {
    text = text.replace(/วันนี้/g, ' ');
    return { dateStr: todayStr, cleanedText: text };
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
        return { dateStr: formatPlainDateObjYMD(d), cleanedText: text };
      }
    }
  }

  return { dateStr: todayStr, cleanedText: text };
}

function extractThaiTime(input: string): { timeStr: string; cleanedText: string } {
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

    const dateMatchingTasks = existingTasks
      .filter((t) => t.date === targetDate)
      .sort((a, b) => a.time.localeCompare(b.time));

    const hasExplicitDateInText =
      text.includes('พรุ่งนี้') ||
      text.includes('มะรืน') ||
      /(\d{1,2})[/-](\d{1,2})/.test(text) ||
      /(\d{4})-(\d{1,2})-(\d{1,2})/.test(text) ||
      /วันที่\s*\d{1,2}/.test(text);

    const targetTasks =
      dateMatchingTasks.length > 0 || hasExplicitDateInText
        ? dateMatchingTasks
        : [...existingTasks].sort((a, b) =>
            `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
          );

    const isShowingAllBecauseTodayEmpty =
      dateMatchingTasks.length === 0 && !hasExplicitDateInText && targetTasks.length > 0;

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

    const digestItems = targetTasks.slice(0, 12).map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return {
        title: t.title,
        date: t.date,
        time: t.time,
        categoryName: cat?.name || 'ทั่วไป',
        categoryColor: cat?.color || '#2563EB',
        priority: t.priority,
        status: t.status,
        assigneeName: t.assigneeName,
        timePhase: classifyTimePhase(t),
      };
    });

    if (targetTasks.length === 0) {
      return {
        action: 'query_today',
        replyText: `📅 วันที่ ${targetDate} (เทียบเวลา ณ ${refTimeStr} น.) ไม่มีรายการงานในตารางครับ\n• ⏮️ งานที่ผ่านเวลาที่กำหนดแล้ว: 0 งาน\n• ⏭️ งานที่ยังไม่ถึงเวลาที่กำหนด: 0 งาน`,
        flexSummary: {
          badge: 'TIME-SPLIT DAILY SUMMARY',
          title: `สรุปตารางงานแยกตามเวลา (${targetDate})`,
          subtitle: `เทียบเวลา ณ ${refTimeStr} น. · ไม่มีรายการงานในตาราง`,
          dateTime: `${targetDate} · ณ ${refTimeStr} น.`,
          date: targetDate,
          time: refTimeStr,
          categoryName: 'สรุปตารางงานแยกตามเวลา',
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

    const passedLines =
      passedTasks.length > 0
        ? passedTasks.map(
            (t, i) =>
              `   ${i + 1}. ${t.time} น.${t.date !== targetDate ? ` (${t.date})` : ''} — ${t.title} [${
                t.status === TaskStatus.COMPLETED
                  ? '✓ ดำเนินการเสร็จแล้ว'
                  : '⚠️ เลยเวลาแล้วยังค้างอยู่'
              }]`
          )
        : ['   • ไม่มีงานที่ผ่านเวลาที่กำหนด'];

    const upcomingLines =
      upcomingTasks.length > 0
        ? upcomingTasks.map(
            (t, i) =>
              `   ${i + 1}. ${t.time} น.${t.date !== targetDate ? ` (${t.date})` : ''} — ${t.title} [${
                t.status === TaskStatus.COMPLETED
                  ? '✓ ทำเสร็จล่วงหน้าแล้ว'
                  : t.priority === TaskPriority.HIGH
                  ? '⏳ รอถึงเวลา · 🔥 ด่วนมาก'
                  : '⏳ รอถึงเวลาที่กำหนด'
              }]`
          )
        : ['   • ไม่มีงานที่รอถึงเวลาอีกในวันนี้'];

    const headerTitle = isShowingAllBecauseTodayEmpty
      ? `สรุปตารางงานทั้งหมดแยกตามเวลา (${targetTasks.length} งาน)`
      : `สรุปงานวันที่ ${targetDate} แยกตามเวลา (${targetTasks.length} งาน)`;

    const replyText = [
      `📊 ${headerTitle}`,
      `⏰ เทียบเวลา ณ ปัจจุบัน: ${refTimeStr} น.`,
      `📌 รวมทั้งหมด ${targetTasks.length} งาน (รอทำ ${pendingCount} · เสร็จแล้ว ${completedCount})`,
      `━━━━━━━━━━━━━━`,
      `⏮️ 1. งานที่ผ่านเวลาที่กำหนดมาแล้ว (<= ${refTimeStr} น.) : ${passedTasks.length} งาน (เสร็จ ${passedCompletedCount} · ค้าง ${passedOverdueCount})`,
      ...passedLines,
      `━━━━━━━━━━━━━━`,
      `⏭️ 2. งานที่ยังไม่ถึงเวลาที่กำหนด (> ${refTimeStr} น.) : ${upcomingTasks.length} งาน`,
      ...upcomingLines,
    ].join('\n');

    return {
      action: 'query_today',
      replyText,
      flexSummary: {
        badge: 'TIME-SPLIT TASK SUMMARY',
        title: headerTitle,
        subtitle: `เทียบเวลา ${refTimeStr} น. · ผ่านเวลาแล้ว ${passedTasks.length} งาน · ยังไม่ถึงเวลา ${upcomingTasks.length} งาน${
          highCount > 0 ? ` (ด่วนสูง ${highCount})` : ''
        }`,
        dateTime: `${targetDate} · ณ ${refTimeStr} น.`,
        date: targetDate,
        time: refTimeStr,
        categoryName: 'สรุปตารางงานแยกตามเวลา',
        categoryColor: '#4F46E5',
        priorityLabel: `ผ่านเวลา ${passedTasks.length} · รอถึงเวลา ${upcomingTasks.length}`,
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
          badge: 'PENDING TASKS SUMMARY',
          title: 'ไม่มีงานค้างในระบบ!',
          subtitle: `ทำงานเสร็จครบทั้ง ${completedCount} รายการเรียบร้อยแล้ว`,
          dateTime: todayStr,
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
      (t, i) => `${i + 1}. ${t.date} (${t.time} น.) — ${t.title}`
    );

    const digestItems = topTasks.map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return {
        title: t.title,
        date: t.date,
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
        dateTime: todayStr,
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
        dateTime: `${matched.date} · ${matched.time} น.`,
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

  // 5. Help command
  if (lower === 'วิธีใช้' || lower === 'help' || lower === 'คำสั่ง') {
    return {
      action: 'help',
      replyText:
        '💡 พิมพ์ข้อความบันทึกงานลงปฏิทินร่วมกันของทีมได้ทุกรูปแบบ เช่น:\n' +
        '• "ประชุมทีมการตลาด พรุ่งนี้ 10:30 #สูง"\n' +
        '• "ส่งมอบโปรเจกต์ 28/10/69 เวลา 14:00"\n' +
        '• "นัดลูกค้า 5 พ.ย. บ่ายสอง #ด่วน"\n' +
        '• พิมพ์ "สรุปงานวันนี้" หรือ "งานค้าง" เพื่อดูการ์ดสรุปตารางงาน\n' +
        '• พิมพ์ "เสร็จแล้ว [ชื่องาน]" เพื่อขีดฆ่างานที่ทำเสร็จ',
    };
  }

  // 6. Default / Add task command
  let cleanText = text
    .replace(/^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\s*[:：-]?\s*/i, '')
    .replace(/\r?\n/g, ' ');

  const dateResult = extractThaiDate(cleanText);
  const targetDate = dateResult.dateStr;
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

  const updatedAllTasks = [newTask, ...existingTasks];
  const sameDayTasks = updatedAllTasks.filter((t) => t.date === newTask.date);
  const sameDayPending = sameDayTasks.filter((t) => t.status !== TaskStatus.COMPLETED).length;
  const sameDayCompleted = sameDayTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;

  return {
    action: 'add_task',
    createdTask: newTask,
    replyText: `✅ บันทึกงานลงปฏิทินร่วมกันและฐานข้อมูลเรียบร้อยแล้ว!\n📌 ชื่องาน: ${newTask.title}\n🗓️ วันที่: ${newTask.date} เวลา ${newTask.time} น.\n🗂️ หมวดหมู่: ${selectedCategory.name}\n🔔 แจ้งเตือนล่วงหน้า: ${formatRemindMinutesLabel(remindMinutes)}\n📊 สรุปงานวันที่ ${newTask.date}: ทั้งหมด ${sameDayTasks.length} งาน (รอทำ ${sameDayPending} · เสร็จแล้ว ${sameDayCompleted})`,
    flexSummary: {
      badge: 'SAVED TO CALENDAR',
      title: newTask.title,
      subtitle: `บันทึกลงปฏิทินวันที่ ${newTask.date} เวลา ${newTask.time} น.`,
      dateTime: `${newTask.date} · ${newTask.time} น.`,
      date: newTask.date,
      time: newTask.time,
      categoryName: selectedCategory.name,
      categoryColor: selectedCategory.color,
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
  let rawBase = '';

  if (custom && /^https?:\/\//i.test(custom)) {
    rawBase = custom;
  } else if (typeof window !== 'undefined') {
    rawBase = `${window.location.origin}${window.location.pathname}`;
  } else {
    rawBase = 'https://calendar.google.com';
  }

  // Convert private AI Studio dev container URL (ais-dev-*) to shared preview URL (ais-pre-*)
  rawBase = rawBase.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-');

  try {
    const parsedUrl = new URL(rawBase);
    const host = parsedUrl.hostname.toLowerCase();

    if (
      host.includes('calendar.google.com') ||
      host.includes('docs.google.com')
    ) {
      return parsedUrl.toString();
    }

    parsedUrl.searchParams.set('section', 'calendar');
    if (options?.workspaceId && options.workspaceId.trim()) {
      parsedUrl.searchParams.set('workspace', options.workspaceId.trim());
    }
    if (options?.spreadsheetId && options.spreadsheetId.trim()) {
      parsedUrl.searchParams.set('sheet', options.spreadsheetId.trim());
    }
    if (options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date.trim())) {
      parsedUrl.searchParams.set('date', options.date.trim());
    }
    try {
      const savedGas =
        typeof localStorage !== 'undefined'
          ? (localStorage.getItem('sheetcal_gas_url_v1') || '').trim()
          : '';
      if (savedGas.startsWith('https://script.google.com/macros/s/')) {
        parsedUrl.searchParams.set('gas', savedGas);
      }
    } catch {
      // Ignore storage access
    }
    // Force LINE app on iOS/Android to open in Safari/Chrome instead of storage-partitioned LINE WebView
    parsedUrl.searchParams.set('openExternalBrowser', '1');
    return parsedUrl.toString();
  } catch {
    return 'https://calendar.google.com';
  }
}

export function generateGoogleAppsScriptCode(
  spreadsheetId: string,
  channelAccessToken?: string,
  appUrl?: string
): string {
  const sheetIdDisplay = spreadsheetId || 'วาง_SPREADSHEET_ID_ของคุณที่นี่';
  const tokenDisplay = channelAccessToken?.trim()
    ? channelAccessToken.trim().replace(/^Bearer\s+/i, '')
    : 'วาง_LINE_CHANNEL_ACCESS_TOKEN_ของคุณที่นี่';
  const webAppUrl = (appUrl || 'https://calendar.google.com').replace(
    /^https:\/\/ais-dev-/i,
    'https://ais-pre-'
  );

  return `/**
 * ============================================================================
 * SheetCal LINE — โค้ดเชื่อมต่อแอป LINE จริง -> Google Sheets + ปฏิทินเว็บ + Flex Message สรุปงานสวยงาม
 * ============================================================================
 * วิธีติดตั้ง:
 * 1. เปิดไฟล์ Google Sheets > Extensions (ส่วนขยาย) > Apps Script
 * 2. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดนี้ลงไป
 * 3. กดปุ่ม "Deploy" > "New deployment" > เลือกประเภท "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (สำคัญมาก)
 * 4. คัดลอก Web app URL ไปวางในช่อง Webhook URL บน LINE Developers Console แล้วกด Verify
 */

const SPREADSHEET_ID = '${sheetIdDisplay}';
const LINE_CHANNEL_ACCESS_TOKEN = '${tokenDisplay}';
const WEB_APP_URL = '${webAppUrl}';

function getCalendarDeepLink(overrideBaseUrl, dateStr) {
  var base = String(overrideBaseUrl || WEB_APP_URL || 'https://calendar.google.com').trim();
  if (base.indexOf('http') !== 0) {
    base = 'https://calendar.google.com';
  }
  base = base.replace(/^https:\\/\\/ais-dev-/i, 'https://ais-pre-');
  if (base.indexOf('calendar.google.com') !== -1 || base.indexOf('docs.google.com') !== -1) {
    return base;
  }
  var sep = base.indexOf('?') === -1 ? '?' : '&';
  var url = base;
  if (url.indexOf('section=') === -1) {
    url += sep + 'section=calendar';
    sep = '&';
  }
  if (dateStr && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(dateStr)) && url.indexOf('date=') === -1) {
    url += sep + 'date=' + encodeURIComponent(String(dateStr));
    sep = '&';
  }
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('วาง_SPREADSHEET_ID') === -1 && url.indexOf('sheet=') === -1) {
    url += sep + 'sheet=' + encodeURIComponent(SPREADSHEET_ID);
    sep = '&';
  }
  if (url.indexOf('openExternalBrowser=') === -1) {
    url += sep + 'openExternalBrowser=1';
  }
  return url;
}

function getSpreadsheetDirectUrl() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('วาง_SPREADSHEET_ID') === -1 && SPREADSHEET_ID.indexOf('PUT_YOUR_') === -1) {
    return 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit';
  }
  return '';
}

function parseThaiCommand(rawText) {
  var text = String(rawText || '').trim();
  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var clean = text.replace(/^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\\s*[:：-]?\\s*/i, '');

  var targetDate = todayStr;
  var isoMatch = clean.match(/(\\d{4})-(\\d{1,2})-(\\d{1,2})/);
  var slashMatch = clean.match(/(?:วันที่\\s*)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?/);

  if (isoMatch) {
    var y = parseInt(isoMatch[1], 10);
    if (y >= 2400) y -= 543;
    targetDate = y + '-' + ('0' + isoMatch[2]).slice(-2) + '-' + ('0' + isoMatch[3]).slice(-2);
    clean = clean.replace(isoMatch[0], ' ');
  } else if (slashMatch) {
    var dNum = parseInt(slashMatch[1], 10);
    var mNum = parseInt(slashMatch[2], 10);
    var yNum = slashMatch[3] ? parseInt(slashMatch[3], 10) : parseInt(Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy'), 10);
    if (yNum >= 2400) yNum -= 543;
    else if (yNum >= 60 && yNum < 100) yNum = 2500 + yNum - 543;
    else if (yNum < 60) yNum = 2000 + yNum;
    targetDate = yNum + '-' + ('0' + mNum).slice(-2) + '-' + ('0' + dNum).slice(-2);
    clean = clean.replace(slashMatch[0], ' ');
  } else if (clean.indexOf('มะรืน') !== -1) {
    var d2 = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    targetDate = Utilities.formatDate(d2, 'Asia/Bangkok', 'yyyy-MM-dd');
    clean = clean.replace(/มะรืนนี้|มะรืน/g, ' ');
  } else if (clean.indexOf('พรุ่งนี้') !== -1) {
    var d1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    targetDate = Utilities.formatDate(d1, 'Asia/Bangkok', 'yyyy-MM-dd');
    clean = clean.replace(/พรุ่งนี้/g, ' ');
  } else if (clean.indexOf('วันนี้') !== -1) {
    clean = clean.replace(/วันนี้/g, ' ');
  }

  var targetTime = '09:00';
  var timeMatch = clean.match(/(?:เวลา\\s*)?(\\d{1,2})[:.](\\d{2})(?:\\s*น\\.?)?/);
  if (timeMatch) {
    targetTime = ('0' + timeMatch[1]).slice(-2) + ':' + ('0' + timeMatch[2]).slice(-2);
    clean = clean.replace(timeMatch[0], ' ');
  } else if (clean.indexOf('บ่ายสอง') !== -1 || clean.indexOf('บ่าย 2') !== -1) {
    targetTime = '14:00';
    clean = clean.replace(/บ่ายสอง|บ่าย\\s*2/g, ' ');
  } else if (clean.indexOf('บ่ายโมง') !== -1) {
    targetTime = '13:00';
    clean = clean.replace(/บ่ายโมง/g, ' ');
  } else if (clean.indexOf('เที่ยง') !== -1) {
    targetTime = '12:00';
    clean = clean.replace(/เที่ยง/g, ' ');
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

function buildSummaryFlexBubble(titleText, dateLabel, rowsList, customOriginUrl) {
  var now = new Date();
  var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var nowHM = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  var total = rowsList.length;
  var completed = rowsList.filter(function(r) { return String(r[7]) === 'completed'; }).length;
  var pending = total - completed;

  var sortedRows = rowsList.slice().sort(function(a, b) {
    var tA = String(a[4] || '09:00').replace(/^'/, '');
    var tB = String(b[4] || '09:00').replace(/^'/, '');
    return tA.localeCompare(tB);
  });

  var passedRows = [];
  var upcomingRows = [];
  sortedRows.forEach(function(r) {
    var rDate = String(r[3] || dateLabel || todayStr).replace(/^'/, '');
    var rTime = String(r[4] || '09:00').replace(/^'/, '');
    if (rDate < todayStr || (rDate === todayStr && rTime <= nowHM)) {
      passedRows.push(r);
    } else {
      upcomingRows.push(r);
    }
  });

  function renderRowBox(r, isPassedPhase) {
    var isDone = String(r[7]) === 'completed';
    var isHigh = String(r[6]) === 'high';
    var badgeLabel = isDone
      ? '✓ เสร็จแล้ว'
      : (isPassedPhase ? '⚠️ เลยเวลา' : (isHigh ? '🔥 ด่วน' : '⏳ รอถึงเวลา'));
    var badgeColor = isDone
      ? '#16A34A'
      : (isPassedPhase ? '#DC2626' : (isHigh ? '#EA580C' : '#2563EB'));

    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      margin: 'sm',
      paddingAll: '10px',
      backgroundColor: '#FFFFFF',
      cornerRadius: '8px',
      borderWidth: '1px',
      borderColor: (!isDone && isPassedPhase) ? '#FECACA' : '#E2E8F0',
      contents: [
        {
          type: 'text',
          text: String(r[4] || '09:00').replace(/^'/, ''),
          weight: 'bold',
          size: 'xs',
          color: isDone ? '#94A3B8' : '#4F46E5',
          flex: 2
        },
        {
          type: 'text',
          text: String(r[1] || 'งาน'),
          weight: 'bold',
          size: 'xs',
          color: isDone ? '#94A3B8' : '#0F172A',
          wrap: true,
          flex: 5
        },
        {
          type: 'text',
          text: badgeLabel,
          size: 'xxs',
          weight: 'bold',
          align: 'end',
          color: badgeColor,
          flex: 3
        }
      ]
    };
  }

  var sectionContents = [];
  if (total === 0) {
    sectionContents.push({
      type: 'text',
      text: '🎉 ไม่มีรายการงานในตารางของวันนี้',
      size: 'xs',
      color: '#64748B',
      align: 'center',
      margin: 'md'
    });
  } else {
    sectionContents.push({
      type: 'text',
      text: '⏮️ ผ่านเวลาที่กำหนดแล้ว (<= ' + nowHM + ' น.) · ' + passedRows.length + ' งาน',
      size: 'xxs',
      weight: 'bold',
      color: '#B45309',
      margin: 'md'
    });
    if (passedRows.length > 0) {
      passedRows.slice(0, 5).forEach(function(r) {
        sectionContents.push(renderRowBox(r, true));
      });
    } else {
      sectionContents.push({
        type: 'text',
        text: '• ไม่มีงานที่ผ่านเวลาที่กำหนด',
        size: 'xxs',
        color: '#94A3B8',
        margin: 'xs'
      });
    }

    sectionContents.push({
      type: 'text',
      text: '⏭️ ยังไม่ถึงเวลาที่กำหนด (> ' + nowHM + ' น.) · ' + upcomingRows.length + ' งาน',
      size: 'xxs',
      weight: 'bold',
      color: '#1D4ED8',
      margin: 'md'
    });
    if (upcomingRows.length > 0) {
      upcomingRows.slice(0, 5).forEach(function(r) {
        sectionContents.push(renderRowBox(r, false));
      });
    } else {
      sectionContents.push({
        type: 'text',
        text: '• ไม่มีงานที่รอถึงเวลาอีกในวันนี้',
        size: 'xxs',
        color: '#94A3B8',
        margin: 'xs'
      });
    }
  }

  return {
    type: 'flex',
    altText: titleText + ' (' + total + ' งาน · ผ่านเวลา ' + passedRows.length + ' / ยังไม่ถึง ' + upcomingRows.length + ')',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#312E81',
        paddingAll: '18px',
        contents: [
          {
            type: 'text',
            text: 'TIME-SPLIT TASK SUMMARY',
            color: '#34D399',
            size: 'xxs',
            weight: 'bold'
          },
          {
            type: 'text',
            text: titleText,
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            margin: 'xs'
          },
          {
            type: 'text',
            text: 'วันที่ ' + dateLabel + ' (เทียบเวลา ' + nowHM + ' น.) · รวม ' + total + ' งาน',
            color: '#C7D2FE',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F8FAFC',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#FEF3C7',
                cornerRadius: '8px',
                paddingAll: '8px',
                contents: [
                  { type: 'text', text: String(passedRows.length), weight: 'bold', size: 'lg', color: '#B45309', align: 'center' },
                  { type: 'text', text: 'ผ่านเวลาแล้ว', size: 'xxs', color: '#92400E', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#DBEAFE',
                cornerRadius: '8px',
                paddingAll: '8px',
                contents: [
                  { type: 'text', text: String(upcomingRows.length), weight: 'bold', size: 'lg', color: '#1D4ED8', align: 'center' },
                  { type: 'text', text: 'ยังไม่ถึงเวลา', size: 'xxs', color: '#1E40AF', align: 'center' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#ECFDF5',
                cornerRadius: '8px',
                paddingAll: '8px',
                contents: [
                  { type: 'text', text: String(completed) + '/' + String(total), weight: 'bold', size: 'lg', color: '#059669', align: 'center' },
                  { type: 'text', text: 'เสร็จแล้ว', size: 'xxs', color: '#047857', align: 'center' }
                ]
              }
            ]
          }
        ].concat(sectionContents)
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: (function() {
          var targetCalUrl = getCalendarDeepLink(customOriginUrl, dateLabel || todayStr);
          var sheetDirectUrl = getSpreadsheetDirectUrl();
          var btns = [
            {
              type: 'button',
              style: 'primary',
              color: '#4F46E5',
              height: 'sm',
              action: { type: 'uri', label: 'เปิดดูปฏิทินของทีม', uri: targetCalUrl }
            }
          ];
          if (sheetDirectUrl && targetCalUrl !== sheetDirectUrl) {
            btns.push({
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'uri', label: '📊 เปิดตาราง Google Sheets', uri: sheetDirectUrl }
            });
          }
          return btns;
        })()
      }
    }
  };
}

function readSheetTasksForWeb() {
  try {
    var ss = (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PUT_YOUR_') === -1 && SPREADSHEET_ID.indexOf('วาง_SPREADSHEET_ID') === -1)
      ? SpreadsheetApp.openById(SPREADSHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    var taskSheet = ss.getSheetByName('Tasks');
    if (!taskSheet || taskSheet.getLastRow() <= 1) return [];
    var rows = taskSheet.getDataRange().getValues().slice(1);
    return rows.map(function(r, idx) {
      return {
        id: String(r[0] || ('sheet-task-' + idx)),
        title: String(r[1] || 'งาน'),
        description: String(r[2] || ''),
        date: String(r[3] || '').replace(/^'/, ''),
        time: String(r[4] || '09:00').replace(/^'/, ''),
        categoryId: String(r[5] || 'cat-work'),
        priority: String(r[6] || 'medium'),
        status: String(r[7] || 'pending'),
        remindMinutesBefore: Number(r[8] || 30),
        lineNotified: String(r[9]).toUpperCase() === 'TRUE',
        source: String(r[10] || 'sheets'),
        updatedAt: String(r[11] || new Date().toISOString())
      };
    }).filter(function(t) { return Boolean(t.title && t.date); });
  } catch (err) {
    return [];
  }
}

function doGet(e) {
  var tasks = readSheetTasksForWeb();
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'verified',
      version: '2.5-gas-bridge',
      capabilities: ['webhook', 'push_line', 'get_tasks'],
      tasks: tasks,
      message: 'SheetCal LINE Webhook & Push Bridge Ready'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var rawContents = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(rawContents);

    // ตรวจสอบเวอร์ชันสะพานเชื่อม (Bridge Check) หรือดึงข้อมูลตารางงานจาก Google Sheets โดยไม่ต้องล็อกอิน Gmail
    if (payload.action === 'check_bridge' || payload.action === 'get_tasks') {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        mode: 'gas_bridge_ready',
        version: '2.5-gas-bridge',
        capabilities: ['webhook', 'push_line', 'get_tasks'],
        tasks: readSheetTasksForWeb()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // รองรับการส่งแจ้งเตือน LINE Push / Broadcast จากหน้าเว็บโดยตรง (กรณีรันบน GitHub Pages / Static Hosting)
    if (payload.action === 'push_line') {
      var token = String(payload.channelAccessToken || LINE_CHANNEL_ACCESS_TOKEN || '').replace(/^Bearer\s+/i, '').trim();
      var targetId = String(payload.to || '').trim();
      var msgText = payload.text || 'แจ้งเตือนตารางงานจาก SheetCal LINE';
      var isValidTarget = /^[UCR][0-9a-fA-F]{32}$/.test(targetId);
      var sentSuccess = false;
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
          return ['', item.title || 'งาน', '', item.date || '', item.time || '09:00', item.categoryName || 'ทั่วไป', item.priority || 'medium', item.status || 'pending'];
        });
        messagesPayload = [buildSummaryFlexBubble('สรุปตารางงานประจำวัน', payload.date || '', rowsForFlex, payload.originUrl)];
      } else if (payload.messageFormat !== 'text_custom' && payload.taskTitle) {
        var singleFooterButtons = [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            height: 'sm',
            action: { type: 'uri', label: 'เปิดดูปฏิทินของทีม', uri: calDeepLink }
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
        messagesPayload = [{
          type: 'flex',
          altText: msgText.slice(0, 300),
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: payload.categoryColor || '#06C755',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: payload.categoryName || 'SHEETCAL NOTIFICATION', color: '#FFFFFF', size: 'xxs', weight: 'bold' },
                { type: 'text', text: String(payload.taskTitle), color: '#FFFFFF', size: 'md', weight: 'bold', wrap: true, margin: 'xs' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: String(payload.dateTime || payload.date || 'วันนี้'), size: 'xs', weight: 'bold', color: '#334155' },
                { type: 'text', text: String(payload.description || msgText), size: 'xs', color: '#475569', wrap: true, margin: 'sm' }
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '12px',
              contents: singleFooterButtons
            }
          }
        }];
      }

      if (isValidTarget) {
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
          deliveryMethod = 'push';
        } else {
          lastError = pushResp.getContentText();
        }
      }

      if (!sentSuccess) {
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
          deliveryMethod = 'broadcast';
        } else {
          // Retry plain text if Flex failed
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
        version: '2.5-gas-bridge',
        ok: sentSuccess,
        deliveryMethod: deliveryMethod,
        botName: botName,
        lineHttpCode: lastCode,
        lineError: lastError
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var events = payload.events || [];
    if (events.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'verified',
        version: '2.5-gas-bridge',
        capabilities: ['webhook', 'push_line']
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var ss = (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PUT_YOUR_') === -1)
      ? SpreadsheetApp.openById(SPREADSHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    var taskSheet = ss.getSheetByName('Tasks') || ss.insertSheet('Tasks');
    if (taskSheet.getLastRow() === 0) {
      taskSheet.appendRow(['ID', 'Title', 'Description', 'Date (YYYY-MM-DD)', 'Time (HH:mm)', 'CategoryID', 'Priority', 'Status', 'RemindMinutesBefore', 'LineNotified', 'Source', 'UpdatedAt']);
    }
    var logSheet = ss.getSheetByName('LineLogs') || ss.insertSheet('LineLogs');

    events.forEach(function(event) {
      if (event.type === 'message' && event.message.type === 'text') {
        var userMessage = event.message.text.trim();
        var replyToken = event.replyToken;
        var now = new Date();
        var todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');

        if (
          userMessage === 'สรุปงานตามเวลา' ||
          userMessage === 'เช็คเวลางาน' ||
          userMessage === 'สรุปงานวันนี้' ||
          userMessage === 'งานวันนี้' ||
          userMessage === 'สรุปงาน' ||
          userMessage === 'งานค้าง' ||
          /^(สรุปงานตามเวลา|เช็คเวลางาน|สรุปงานวันนี้|สรุปงาน|ดูงานวันที่)\s+(.+)$/i.test(userMessage)
        ) {
          var rows = taskSheet.getDataRange().getValues().slice(1);
          var queryDate = parseThaiCommand(userMessage).date || todayStr;
          var filtered = userMessage === 'งานค้าง'
            ? rows.filter(function(r) { return String(r[7]) !== 'completed'; })
            : rows.filter(function(r) { return String(r[3]).replace(/^'/, '') === queryDate; });
          if (filtered.length === 0 && queryDate === todayStr) filtered = rows;
          var flexBubble = buildSummaryFlexBubble(
            userMessage === 'งานค้าง' ? 'สรุปงานค้างทั้งหมด' : 'สรุปตารางงานแยกตามเวลา',
            queryDate,
            filtered
          );
          replyLineMessages(replyToken, [flexBubble]);
          return;
        }

        var parsed = parseThaiCommand(userMessage);
        var newId = 'task-' + now.getTime();

        taskSheet.appendRow([
          newId,
          parsed.title,
          'บันทึกผ่านแชท LINE OA ("' + userMessage + '")',
          "'" + parsed.date,
          "'" + parsed.time,
          'cat-work',
          parsed.priority,
          'pending',
          30,
          'FALSE',
          'line',
          now.toISOString()
        ]);

        if (logSheet) {
          logSheet.appendRow([
            'log-' + now.getTime(),
            now.toISOString(),
            'incoming_command',
            userMessage,
            parsed.title,
            'line_messaging_api',
            'delivered'
          ]);
        }

        try {
          var startDt = new Date(parsed.date + 'T' + parsed.time + ':00+07:00');
          var endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
          CalendarApp.getDefaultCalendar().createEvent(parsed.title, startDt, endDt, {
            description: 'บันทึกอัตโนมัติจาก SheetCal LINE OA'
          });
        } catch (calErr) {}

        var allRows = taskSheet.getDataRange().getValues().slice(1);
        var dayRows = allRows.filter(function(r) { return String(r[3]).replace(/^'/, '') === parsed.date; });
        var dayPending = dayRows.filter(function(r) { return String(r[7]) !== 'completed'; }).length;

        var savedFlex = {
          type: 'flex',
          altText: '✅ บันทึกงาน: ' + parsed.title + ' (' + parsed.date + ' ' + parsed.time + ' น.)',
          contents: {
            type: 'bubble',
            size: 'mega',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: parsed.priority === 'high' ? '#DC2626' : '#059669',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: '✅ บันทึกลงปฏิทินเรียบร้อย', color: '#FFFFFF', size: 'xs', weight: 'bold' },
                { type: 'text', text: parsed.title, color: '#FFFFFF', size: 'lg', weight: 'bold', wrap: true, margin: 'xs' }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '16px',
              spacing: 'sm',
              contents: [
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
                    { type: 'text', text: 'รวมทั้งหมด ' + dayRows.length + ' งาน · รอดำเนินการ ' + dayPending + ' งาน', size: 'xs', weight: 'bold', color: '#1E1B4B', margin: 'xs' }
                  ]
                }
              ]
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '12px',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: '#06C755',
                  height: 'sm',
                  action: { type: 'uri', label: 'เปิดดูปฏิทินของทีม', uri: getCalendarDeepLink('', parsed.date) }
                }
              ]
            }
          }
        };
        replyLineMessages(replyToken, [savedFlex]);
      }
    });
  } catch (err) {}

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
}

function replyLineMessages(replyToken, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: messages
    })
  });
}`;
}
