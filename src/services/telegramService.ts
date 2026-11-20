import {
  FlexDigestItem,
  Task,
  TaskPriority,
  TaskStatus,
  TelegramTemplateStyle,
} from '../types';
import {
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  resolvePublicTvShareUrl,
} from './lineCommandParser';
import { getEffectiveGasUrl } from '../data/initialData';

export interface TelegramInlineButton {
  text: string;
  url: string;
}

export interface TelegramFormatOptions {
  style?: TelegramTemplateStyle;
  headerTitle?: string;
  showStats?: boolean;
  showButtons?: boolean;
}

export interface TelegramDetectedChat {
  chatId: string;
  type: 'private' | 'group' | 'supergroup' | 'channel' | string;
  title: string;
  username?: string;
  lastMessageText?: string;
  lastDate?: string;
}

export interface TelegramSendResult {
  ok: boolean;
  deliveredCount: number;
  failedCount: number;
  transport: 'server' | 'gas' | 'direct' | 'none';
  message: string;
  botUsername?: string;
}

export interface TelegramDetectResult {
  ok: boolean;
  botUsername?: string;
  botFirstName?: string;
  chats: TelegramDetectedChat[];
  message: string;
}

export const DEFAULT_TELEGRAM_HEADER_TITLE = 'สำนักบริหารแรงงานต่างด้าว · ระบบน้องเลขา';

export function escapeTelegramHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function parseTelegramChatIds(rawChatId: string): string[] {
  return String(rawChatId || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^-?\d{5,20}$/.test(s) || /^@[A-Za-z0-9_]{4,}$/.test(s));
}

export function isTelegramConfigured(settings: {
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
}): boolean {
  const token = (settings.telegramBotToken || '').trim();
  const chatIds = parseTelegramChatIds(settings.telegramChatId || '');
  return Boolean(
    settings.telegramEnabled &&
      /^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(token) &&
      chatIds.length > 0
  );
}

export function buildTelegramActionButtons(options: {
  calendarUrl?: string;
  googleCalendarUrl?: string;
  includeCalendarButton?: boolean;
  includeTvButton?: boolean;
  showButtons?: boolean;
}): TelegramInlineButton[][] {
  if (options.showButtons === false) return [];
  const rows: TelegramInlineButton[][] = [];
  const primaryRow: TelegramInlineButton[] = [];

  if (
    options.includeCalendarButton !== false &&
    options.calendarUrl &&
    /^https?:\/\//i.test(options.calendarUrl)
  ) {
    primaryRow.push({
      text: '📅 เปิดปฏิทินทีม',
      url: options.calendarUrl,
    });
  }

  if (options.includeTvButton !== false) {
    const tvUrl = resolvePublicTvShareUrl();
    if (tvUrl && /^https?:\/\//i.test(tvUrl)) {
      primaryRow.push({
        text: '📺 เปิดหน้าจอ TV',
        url: tvUrl,
      });
    }
  }

  if (primaryRow.length > 0) {
    rows.push(primaryRow);
  }

  if (options.googleCalendarUrl && /^https?:\/\//i.test(options.googleCalendarUrl)) {
    rows.push([
      {
        text: '🗓 เพิ่มลง Google Calendar',
        url: options.googleCalendarUrl,
      },
    ]);
  }

  return rows;
}

export function formatSingleTaskTelegramHtml(params: {
  task: Task;
  categoryName: string;
  remindLabel: string;
  includeDescription?: boolean;
  summaryStats?: { total: number; pending: number; completed: number };
  isManualTrigger?: boolean;
  format?: TelegramFormatOptions;
}): string {
  const {
    task,
    categoryName,
    remindLabel,
    includeDescription = true,
    summaryStats,
    isManualTrigger,
    format,
  } = params;

  const style: TelegramTemplateStyle = format?.style || 'executive_card';
  const headerTitle = (format?.headerTitle || DEFAULT_TELEGRAM_HEADER_TITLE).trim();
  const showStats = format?.showStats !== false;

  const prioBadge =
    task.priority === TaskPriority.HIGH
      ? '🔴 ด่วนมาก'
      : task.priority === TaskPriority.MEDIUM
      ? '🟡 สำคัญปานกลาง'
      : '🟢 ทั่วไป';
  const statusBadge =
    task.status === TaskStatus.COMPLETED
      ? '✅ เสร็จสิ้น'
      : task.status === TaskStatus.IN_PROGRESS
      ? '🔵 กำลังดำเนินการ'
      : '⏳ รอดำเนินการ';

  const dateRange = formatTaskDateRangeLabel(task, 'long');
  const timeStr = (task.time || '09:00').trim();
  const cleanTitle = escapeTelegramHtml(task.title);
  const cleanCat = escapeTelegramHtml(categoryName);
  const cleanDate = escapeTelegramHtml(dateRange);
  const cleanTime = escapeTelegramHtml(timeStr);
  const cleanRemind = escapeTelegramHtml(remindLabel);
  const cleanDesc = task.description?.trim() ? escapeTelegramHtml(task.description.trim()) : '';
  const cleanAssignee = task.assigneeName?.trim()
    ? escapeTelegramHtml(task.assigneeName.trim())
    : '';

  // Style 2: Compact Brief (กระชับ อ่านไวใน 3 วินาที)
  if (style === 'compact_brief') {
    const icon = task.priority === TaskPriority.HIGH ? '🚨' : '🔔';
    const lines: string[] = [
      `${icon} <b>${cleanTitle}</b>`,
      `<code>${cleanTime} น.</code> · ${cleanDate}`,
      `🗂 ${cleanCat} · ${prioBadge}`,
    ];
    if (cleanAssignee) {
      lines.push(`👤 ${cleanAssignee}`);
    }
    if (includeDescription && cleanDesc) {
      lines.push(`<blockquote>${cleanDesc}</blockquote>`);
    }
    if (showStats && summaryStats) {
      lines.push(
        `<i>รวม ${summaryStats.total} · รอทำ ${summaryStats.pending} · เสร็จแล้ว ${summaryStats.completed}</i>`
      );
    }
    return lines.join('\n');
  }

  // Style 3: Timeline Style (เน้นเวลาและขั้นตอนชัดเจน)
  if (style === 'timeline_digest') {
    const alertLabel = isManualTrigger
      ? 'แจ้งเตือนกำหนดการ'
      : task.priority === TaskPriority.HIGH
      ? 'ภารกิจด่วนมาก'
      : 'แจ้งเตือนล่วงหน้า';
    const cardInner: string[] = [
      `<b>📌 ${cleanTitle}</b>`,
      `🕐 <code>${cleanTime} น.</code>  |  📅 ${cleanDate}`,
      `🗂 ${cleanCat}  ·  ${prioBadge}  ·  ${statusBadge}`,
    ];
    if (cleanAssignee) {
      cardInner.push(`👤 ผู้รับผิดชอบ: ${cleanAssignee}`);
    }
    if (includeDescription && cleanDesc) {
      cardInner.push('');
      cardInner.push(`📝 ${cleanDesc}`);
    }
    const out: string[] = [
      `🏛 <b>${escapeTelegramHtml(headerTitle)}</b>`,
      `⏱ <i>${alertLabel} (${cleanRemind})</i>`,
      `<blockquote>${cardInner.join('\n')}</blockquote>`,
    ];
    if (showStats && summaryStats) {
      out.push(
        `📊 ภาพรวม: ทั้งหมด <b>${summaryStats.total}</b> · รอทำ <b>${summaryStats.pending}</b> · เสร็จแล้ว <b>${summaryStats.completed}</b>`
      );
    }
    return out.join('\n');
  }

  // Style 1 (Default): Executive Card (การ์ดผู้บริหารพรีเมียมใช้ Native Blockquote ของ Telegram)
  const alertTitle = isManualTrigger
    ? '🔔 แจ้งเตือนกำหนดการ'
    : task.priority === TaskPriority.HIGH
    ? '🚨 แจ้งเตือนภารกิจด่วนมาก'
    : '⏰ แจ้งเตือนกำหนดการตามเวลา';

  const detailCardLines: string[] = [
    `<b>${cleanTitle}</b>`,
    '',
    `📅 <b>วันที่:</b> ${cleanDate}`,
    `🕐 <b>เวลา:</b> <code>${cleanTime} น.</code> <i>(${cleanRemind})</i>`,
    `🗂 <b>หมวดหมู่:</b> ${cleanCat}`,
    `⚡ <b>สถานะ:</b> ${prioBadge} · ${statusBadge}`,
  ];
  if (cleanAssignee) {
    detailCardLines.push(`👤 <b>ผู้รับผิดชอบ:</b> ${cleanAssignee}`);
  }

  const lines: string[] = [
    `🏛 <b>${escapeTelegramHtml(headerTitle)}</b>`,
    `<b>${alertTitle}</b>`,
    `<blockquote>${detailCardLines.join('\n')}</blockquote>`,
  ];

  if (includeDescription && cleanDesc) {
    lines.push(`<blockquote expandable>📝 <b>รายละเอียดเพิ่มเติม</b>\n${cleanDesc}</blockquote>`);
  }

  if (showStats && summaryStats) {
    lines.push(
      `📊 <i>สรุปงาน: ทั้งหมด <b>${summaryStats.total}</b> · รอทำ <b>${summaryStats.pending}</b> · เสร็จแล้ว <b>${summaryStats.completed}</b></i>`
    );
  }

  return lines.join('\n');
}

function getTimePeriodBucket(timeStr: string): 'morning' | 'afternoon' | 'evening' {
  const hour = parseInt(String(timeStr || '09:00').split(':')[0] || '9', 10);
  if (isNaN(hour) || hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function formatDailyDigestTelegramHtml(params: {
  dateYMD: string;
  referenceTimeHM: string;
  items: FlexDigestItem[];
  heading?: string;
  format?: TelegramFormatOptions;
}): string {
  const { dateYMD, referenceTimeHM, items, heading, format } = params;
  const style: TelegramTemplateStyle = format?.style || 'executive_card';
  const headerTitle = (format?.headerTitle || DEFAULT_TELEGRAM_HEADER_TITLE).trim();
  const showStats = format?.showStats !== false;

  const thaiDate = formatThaiDateDisplay(dateYMD, 'long');
  const total = items.length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const pending = total - completed;
  const highCount = items.filter(
    (i) => i.status !== 'completed' && i.priority === 'high'
  ).length;

  const sortedItems = [...items].sort((a, b) =>
    String(a.time || '09:00').localeCompare(String(b.time || '09:00'))
  );

  const renderDigestRow = (item: FlexDigestItem, idx: number, showDesc = true) => {
    const icon =
      item.status === 'completed'
        ? '✅'
        : item.priority === 'high'
        ? '🔴'
        : item.status === 'in_progress'
        ? '🔵'
        : '▪️';
    const timeBadge = `<code>${escapeTelegramHtml(item.time || '09:00')} น.</code>`;
    const titleStr =
      item.status === 'completed'
        ? `<s>${escapeTelegramHtml(item.title)}</s>`
        : `<b>${escapeTelegramHtml(item.title)}</b>`;
    const descStr =
      showDesc && item.description?.trim()
        ? `\n     <i>${escapeTelegramHtml(item.description.trim().slice(0, 75))}${
            item.description.trim().length > 75 ? '…' : ''
          }</i>`
        : '';
    return `${idx + 1}. ${icon} ${timeBadge} ${titleStr}${descStr}`;
  };

  // Style 2: Compact Brief
  if (style === 'compact_brief') {
    const lines: string[] = [
      `📅 <b>${escapeTelegramHtml(heading || 'สรุปตารางงาน')} · ${escapeTelegramHtml(thaiDate)}</b>`,
    ];
    if (showStats) {
      lines.push(
        `<i>ณ ${escapeTelegramHtml(referenceTimeHM)} น. · ทั้งหมด ${total} งาน (รอทำ ${pending} / เสร็จแล้ว ${completed})</i>`
      );
    }
    if (total === 0) {
      lines.push('<blockquote>✨ ยังไม่มีกำหนดการในวันนี้</blockquote>');
      return lines.join('\n');
    }
    const rows = sortedItems.slice(0, 18).map((it, i) => renderDigestRow(it, i, false));
    if (sortedItems.length > 18) {
      rows.push(`<i>…และอีก ${sortedItems.length - 18} รายการ</i>`);
    }
    lines.push(`<blockquote>${rows.join('\n')}</blockquote>`);
    return lines.join('\n');
  }

  // Style 3: Timeline (แบ่งช่วง เช้า / บ่าย / เย็น)
  if (style === 'timeline_digest') {
    const morning = sortedItems.filter((i) => getTimePeriodBucket(i.time) === 'morning');
    const afternoon = sortedItems.filter((i) => getTimePeriodBucket(i.time) === 'afternoon');
    const evening = sortedItems.filter((i) => getTimePeriodBucket(i.time) === 'evening');

    const lines: string[] = [
      `🏛 <b>${escapeTelegramHtml(headerTitle)}</b>`,
      `🗓 <b>${escapeTelegramHtml(heading || 'ไทม์ไลน์กำหนดการประจำวัน')}</b>`,
      `📅 ${escapeTelegramHtml(thaiDate)} · อัปเดต <code>${escapeTelegramHtml(referenceTimeHM)} น.</code>`,
    ];

    if (showStats) {
      lines.push(
        `📊 ทั้งหมด <b>${total}</b> งาน · รอทำ <b>${pending}</b> · เสร็จแล้ว <b>${completed}</b>${
          highCount > 0 ? ` · ด่วนมาก <b>${highCount}</b>` : ''
        }`
      );
    }

    if (total === 0) {
      lines.push('<blockquote>✨ ยังไม่มีกำหนดการในวันนี้</blockquote>');
      return lines.join('\n');
    }

    const pushBucket = (label: string, bucket: FlexDigestItem[]) => {
      if (bucket.length === 0) return;
      const body = [
        `<b>${label} (${bucket.length})</b>`,
        ...bucket.slice(0, 10).map((it, idx) => renderDigestRow(it, idx, true)),
      ];
      lines.push(`<blockquote>${body.join('\n')}</blockquote>`);
    };

    pushBucket('🌅 ช่วงเช้า (ก่อน 12:00 น.)', morning);
    pushBucket('☀️ ช่วงบ่าย (12:00 – 16:59 น.)', afternoon);
    pushBucket('🌆 ช่วงเย็น (17:00 น. เป็นต้นไป)', evening);
    return lines.join('\n');
  }

  // Style 1 (Default): Executive Card (แยก กำลังจะมาถึง / ผ่านเวลาแล้ว ใน Native Blockquote Cards)
  const passedItems = sortedItems.filter((i) => i.timePhase === 'passed');
  const upcomingItems = sortedItems.filter((i) => i.timePhase !== 'passed');

  const lines: string[] = [
    `🏛 <b>${escapeTelegramHtml(headerTitle)}</b>`,
    `☀️ <b>${escapeTelegramHtml(heading || 'สรุปตารางงานประจำวัน')}</b>`,
    `📅 ${escapeTelegramHtml(thaiDate)} · ณ <code>${escapeTelegramHtml(referenceTimeHM)} น.</code>`,
  ];

  if (showStats) {
    lines.push(
      `📊 ทั้งหมด <b>${total}</b> · รอทำ <b>${pending}</b> · เสร็จแล้ว <b>${completed}</b>${
        highCount > 0 ? ` · 🔴 ด่วน <b>${highCount}</b>` : ''
      }`
    );
  }

  if (total === 0) {
    lines.push('<blockquote>✨ ยังไม่มีกำหนดการในวันนี้</blockquote>');
    return lines.join('\n');
  }

  if (upcomingItems.length > 0) {
    const upRows = [
      `<b>📌 กำลังจะมาถึง (${upcomingItems.length} รายการ)</b>`,
      ...upcomingItems.slice(0, 14).map((it, i) => renderDigestRow(it, i, true)),
    ];
    if (upcomingItems.length > 14) {
      upRows.push(`<i>…และอีก ${upcomingItems.length - 14} รายการ</i>`);
    }
    lines.push(`<blockquote>${upRows.join('\n')}</blockquote>`);
  }

  if (passedItems.length > 0) {
    const passRows = [
      `<b>🕒 ผ่านเวลาแล้ว (${passedItems.length} รายการ)</b>`,
      ...passedItems.slice(0, 10).map((it, i) => renderDigestRow(it, i, false)),
    ];
    if (passedItems.length > 10) {
      passRows.push(`<i>…และอีก ${passedItems.length - 10} รายการ</i>`);
    }
    lines.push(`<blockquote expandable>${passRows.join('\n')}</blockquote>`);
  }

  return lines.join('\n');
}

export function formatTelegramErrorThai(rawError: unknown): string {
  const err = String(rawError || '').trim();
  const lower = err.toLowerCase();
  if (!err) return 'ส่งข้อความเข้า Telegram ไม่สำเร็จ กรุณาตรวจสอบ Bot Token และ Chat ID';
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('not found')) {
    return 'Bot Token ไม่ถูกต้อง กรุณาคัดลอก Token จาก @BotFather ใน Telegram ใหม่อีกครั้ง';
  }
  if (lower.includes('chat not found')) {
    return 'ไม่พบ Chat ID นี้ — กรุณากดปุ่ม Start ในแชทบอท หรือดึงบอทเข้ากลุ่ม Telegram แล้วพิมพ์ข้อความอย่างน้อย 1 ครั้งก่อนกด "ค้นหา Chat ID อัตโนมัติ"';
  }
  if (lower.includes('bot was blocked') || lower.includes('kicked')) {
    return 'บอทถูกบล็อกหรือถูกนำออกจากกลุ่ม Telegram — กรุณาปลดบล็อกหรือดึงบอทเข้ากลุ่มอีกครั้ง';
  }
  if (lower.includes('group chat was upgraded to a supergroup')) {
    return 'กลุ่ม Telegram ถูกอัปเกรดเป็น Supergroup ทำให้ Chat ID เปลี่ยน (ขึ้นต้นด้วย -100...) — กดปุ่ม "ค้นหา Chat ID อัตโนมัติ" เพื่ออัปเดตเลขกลุ่มใหม่ครับ';
  }
  return `ส่งเข้า Telegram ไม่สำเร็จ: ${err}`;
}

export async function sendTelegramNotification(params: {
  botToken: string;
  chatId: string;
  htmlText: string;
  buttons?: TelegramInlineButton[][];
  dedupKey?: string;
  gasUrl?: string;
}): Promise<TelegramSendResult> {
  const cleanToken = (params.botToken || '').trim();
  const chatIds = parseTelegramChatIds(params.chatId || '');

  if (chatIds.length === 0) {
    return {
      ok: false,
      deliveredCount: 0,
      failedCount: 1,
      transport: 'none',
      message: 'กรุณาระบุ Telegram Chat ID (หรือกดปุ่ม "ค้นหา Chat ID อัตโนมัติ")',
    };
  }

  const replyMarkup =
    params.buttons && params.buttons.length > 0
      ? { inline_keyboard: params.buttons }
      : undefined;

  // 1. Try Full-Stack Express Backend (/api/telegram/send) — also supports server-saved token
  try {
    const res = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: cleanToken || undefined,
        chatId: chatIds.join(','),
        htmlText: params.htmlText,
        buttons: params.buttons,
        dedupKey: params.dedupKey,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(data.ok),
        deliveredCount: Number(data.deliveredCount || (data.ok ? chatIds.length : 0)),
        failedCount: Number(data.failedCount || (data.ok ? 0 : chatIds.length)),
        transport: 'server',
        message: data.ok
          ? String(data.message || `ส่งแจ้งเตือนเข้า Telegram สำเร็จ (${chatIds.length} แชท)`)
          : formatTelegramErrorThai(data.error || data.message),
      };
    }
  } catch {
    // Fallback on static web (e.g. GitHub Pages)
  }

  if (!cleanToken || !/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(cleanToken)) {
    return {
      ok: false,
      deliveredCount: 0,
      failedCount: 1,
      transport: 'none',
      message: 'กรุณากรอก Telegram Bot Token จาก @BotFather ให้ถูกต้องก่อนส่งแจ้งเตือน',
    };
  }

  // 2. Try Google Apps Script Bridge (action: 'push_telegram')
  const effectiveGasUrl = (params.gasUrl || getEffectiveGasUrl() || '').trim();
  if (effectiveGasUrl.startsWith('https://script.google.com/macros/s/')) {
    try {
      const gasRes = await fetch(effectiveGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'push_telegram',
          botToken: cleanToken,
          chatId: chatIds.join(','),
          htmlText: params.htmlText,
          buttons: params.buttons,
          dedupKey: params.dedupKey,
        }),
      });
      const gasText = await gasRes.text();
      const gasData = JSON.parse(gasText || '{}');
      if (gasData && gasData.mode === 'gas_push_telegram') {
        return {
          ok: Boolean(gasData.ok),
          deliveredCount: Number(gasData.deliveredCount || 0),
          failedCount: Number(gasData.failedCount || 0),
          transport: 'gas',
          message: gasData.ok
            ? `ส่งแจ้งเตือนเข้า Telegram สำเร็จ (${gasData.deliveredCount || chatIds.length} แชท ผ่าน Apps Script)`
            : formatTelegramErrorThai(gasData.telegramError || gasData.message),
        };
      }
    } catch {
      // Older GAS version or network error -> fall through to direct Telegram Bot API
    }
  }

  // 3. Direct HTTPS call to Telegram Bot API (works directly from Static Web / GitHub Pages)
  let deliveredCount = 0;
  let failedCount = 0;
  let lastError = '';

  for (const cid of chatIds) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cid,
          text: params.htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      const tgData = await tgRes.json().catch(() => ({}));
      if (tgRes.ok && tgData.ok) {
        deliveredCount += 1;
      } else {
        failedCount += 1;
        lastError = String(tgData.description || `HTTP ${tgRes.status}`);
      }
    } catch (err) {
      failedCount += 1;
      lastError = err instanceof Error ? err.message : 'Network error';
    }
  }

  if (deliveredCount > 0) {
    return {
      ok: true,
      deliveredCount,
      failedCount,
      transport: 'direct',
      message:
        failedCount > 0
          ? `ส่งเข้า Telegram สำเร็จ ${deliveredCount} แชท (ไม่สำเร็จ ${failedCount} แชท: ${formatTelegramErrorThai(lastError)})`
          : `ส่งแจ้งเตือนเข้า Telegram สำเร็จ (${deliveredCount} แชท)!`,
    };
  }

  return {
    ok: false,
    deliveredCount: 0,
    failedCount,
    transport: 'direct',
    message: formatTelegramErrorThai(lastError),
  };
}

function dataUrlToPngBlob(dataUrl: string): { blob: Blob; base64: string } | null {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return null;
  const mime = `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`;
  const base64 = match[2];
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { blob: new Blob([bytes], { type: mime }), base64 };
  } catch {
    return null;
  }
}

export function buildShortTaskPhotoCaption(params: {
  task: Task;
  categoryName: string;
  remindLabel?: string;
}): string {
  const dateRange = formatTaskDateRangeLabel(params.task, 'long');
  const timeStr = (params.task.time || '09:00').trim();
  const title = escapeTelegramHtml(params.task.title);
  const cat = escapeTelegramHtml(params.categoryName || 'งานตารางทีม');
  const remindPart = params.remindLabel ? ` · <i>${escapeTelegramHtml(params.remindLabel)}</i>` : '';
  return [
    `🔔 <b>${title}</b>`,
    `📅 ${escapeTelegramHtml(dateRange)} · <code>${escapeTelegramHtml(timeStr)} น.</code>${remindPart}`,
    `🗂 ${cat}`,
  ]
    .join('\n')
    .slice(0, 980);
}

export function buildShortDigestPhotoCaption(params: {
  dateYMD: string;
  referenceTimeHM: string;
  total: number;
  pending: number;
  completed: number;
  heading?: string;
}): string {
  const thaiDate = formatThaiDateDisplay(params.dateYMD, 'long');
  return [
    `📋 <b>${escapeTelegramHtml(params.heading || 'สรุปตารางงานประจำวัน')}</b>`,
    `📅 ${escapeTelegramHtml(thaiDate)} · อัปเดต <code>${escapeTelegramHtml(params.referenceTimeHM)} น.</code>`,
    `📊 ทั้งหมด <b>${params.total}</b> งาน · รอทำ <b>${params.pending}</b> · เสร็จแล้ว <b>${params.completed}</b>`,
  ]
    .join('\n')
    .slice(0, 980);
}

export async function sendTelegramPhotoCard(params: {
  botToken: string;
  chatId: string;
  photoDataUrl: string | null;
  captionHtml: string;
  fallbackHtmlText: string;
  buttons?: TelegramInlineButton[][];
  gasUrl?: string;
  dedupKey?: string;
}): Promise<TelegramSendResult> {
  const cleanToken = (params.botToken || '').trim();
  const chatIds = parseTelegramChatIds(params.chatId);

  if (chatIds.length === 0) {
    return {
      ok: false,
      deliveredCount: 0,
      failedCount: 1,
      transport: 'none',
      message: 'กรุณาระบุ Telegram Chat ID (หรือกดปุ่ม "ค้นหา Chat ID อัตโนมัติ")',
    };
  }

  const parsedPhoto = params.photoDataUrl ? dataUrlToPngBlob(params.photoDataUrl) : null;
  if (!parsedPhoto || !params.photoDataUrl) {
    return sendTelegramNotification({
      botToken: cleanToken,
      chatId: params.chatId,
      htmlText: params.fallbackHtmlText,
      buttons: params.buttons,
      gasUrl: params.gasUrl,
      dedupKey: params.dedupKey,
    });
  }

  const safeCaption = String(params.captionHtml || '').slice(0, 1000);
  const replyMarkup =
    params.buttons && params.buttons.length > 0
      ? { inline_keyboard: params.buttons }
      : undefined;

  // 1. Try Full-Stack Express Backend (/api/telegram/send-photo) — supports server-saved token
  try {
    const res = await fetch('/api/telegram/send-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: cleanToken || undefined,
        chatId: chatIds.join(','),
        photoDataUrl: params.photoDataUrl,
        captionHtml: safeCaption,
        buttons: params.buttons,
        dedupKey: params.dedupKey,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data.ok) {
        return {
          ok: true,
          deliveredCount: Number(data.deliveredCount || chatIds.length),
          failedCount: Number(data.failedCount || 0),
          transport: 'server',
          message: String(
            data.message || `ส่งการ์ดแจ้งเตือนเข้า Telegram สำเร็จ (${chatIds.length} แชท)`
          ),
        };
      }
      // If server responded cleanly with a Telegram error (e.g. wrong chatId/token), return it
      if (data.error) {
        return {
          ok: false,
          deliveredCount: 0,
          failedCount: chatIds.length,
          transport: 'server',
          message: formatTelegramErrorThai(data.error),
        };
      }
    }
  } catch {
    // Fallback on static web (GitHub Pages)
  }

  if (!cleanToken || !/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(cleanToken)) {
    return {
      ok: false,
      deliveredCount: 0,
      failedCount: 1,
      transport: 'none',
      message: 'กรุณากรอก Telegram Bot Token จาก @BotFather ให้ถูกต้องก่อนส่งแจ้งเตือน',
    };
  }

  // 2. Try Direct Browser HTTPS multipart upload to Telegram Bot API (/sendPhoto)
  let deliveredCount = 0;
  let failedCount = 0;
  let lastError = '';

  for (const cid of chatIds) {
    try {
      const form = new FormData();
      form.append('chat_id', cid);
      form.append('photo', parsedPhoto.blob, 'lakha-schedule-card.png');
      if (safeCaption) {
        form.append('caption', safeCaption);
        form.append('parse_mode', 'HTML');
      }
      if (replyMarkup) {
        form.append('reply_markup', JSON.stringify(replyMarkup));
      }

      const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const tgData = await tgRes.json().catch(() => ({}));
      if (tgRes.ok && tgData.ok) {
        deliveredCount += 1;
      } else {
        failedCount += 1;
        lastError = String(tgData.description || `HTTP ${tgRes.status}`);
      }
    } catch (err) {
      failedCount += 1;
      lastError = err instanceof Error ? err.message : 'Network error';
    }
  }

  if (deliveredCount > 0) {
    return {
      ok: true,
      deliveredCount,
      failedCount,
      transport: 'direct',
      message:
        failedCount > 0
          ? `ส่งการ์ดภาพเข้า Telegram สำเร็จ ${deliveredCount} แชท (ไม่สำเร็จ ${failedCount} แชท: ${formatTelegramErrorThai(lastError)})`
          : `ส่งการ์ดภาพแจ้งเตือนเข้า Telegram สำเร็จ (${deliveredCount} แชท)!`,
    };
  }

  // 3. Try Google Apps Script Bridge (action: 'push_telegram_photo')
  const effectiveGasUrl = (params.gasUrl || getEffectiveGasUrl() || '').trim();
  if (effectiveGasUrl.startsWith('https://script.google.com/macros/s/')) {
    try {
      const gasRes = await fetch(effectiveGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'push_telegram_photo',
          botToken: cleanToken,
          chatId: chatIds.join(','),
          photoBase64: parsedPhoto.base64,
          captionHtml: safeCaption,
          buttons: params.buttons,
          dedupKey: params.dedupKey,
        }),
      });
      const gasData = JSON.parse((await gasRes.text()) || '{}');
      if (gasData && gasData.mode === 'gas_push_telegram_photo' && gasData.ok) {
        return {
          ok: true,
          deliveredCount: Number(gasData.deliveredCount || chatIds.length),
          failedCount: Number(gasData.failedCount || 0),
          transport: 'gas',
          message: `ส่งการ์ดภาพแจ้งเตือนเข้า Telegram สำเร็จ (${gasData.deliveredCount || chatIds.length} แชท ผ่าน Apps Script)`,
        };
      }
    } catch {
      // Fallback to text message below
    }
  }

  // 4. Final graceful fallback to rich HTML text message so notification is never lost
  return sendTelegramNotification({
    botToken: cleanToken,
    chatId: params.chatId,
    htmlText: params.fallbackHtmlText,
    buttons: params.buttons,
    gasUrl: params.gasUrl,
    dedupKey: params.dedupKey,
  });
}

export async function detectTelegramChats(
  botToken: string,
  gasUrl?: string
): Promise<TelegramDetectResult> {
  const cleanToken = (botToken || '').trim();

  // 1. Try Full-Stack Express Backend (also supports server-saved token when cleanToken is blank)
  try {
    const res = await fetch('/api/telegram/detect-chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken || undefined }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(data.ok),
        botUsername: data.botUsername,
        botFirstName: data.botFirstName,
        chats: Array.isArray(data.chats) ? data.chats : [],
        message: String(data.message || ''),
      };
    }
  } catch {
    // Fallback on static web
  }

  if (!/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(cleanToken)) {
    return {
      ok: false,
      chats: [],
      message: 'รูปแบบ Bot Token ไม่ถูกต้อง (ตัวอย่าง: 1234567890:AAHxxxx...)',
    };
  }

  // 2. Try Google Apps Script Bridge
  const effectiveGasUrl = (gasUrl || getEffectiveGasUrl() || '').trim();
  if (effectiveGasUrl.startsWith('https://script.google.com/macros/s/')) {
    try {
      const gasRes = await fetch(effectiveGasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'telegram_get_updates',
          botToken: cleanToken,
        }),
      });
      const gasData = JSON.parse((await gasRes.text()) || '{}');
      if (gasData && gasData.mode === 'gas_telegram_updates') {
        return {
          ok: Boolean(gasData.ok),
          botUsername: gasData.botUsername,
          botFirstName: gasData.botFirstName,
          chats: Array.isArray(gasData.chats) ? gasData.chats : [],
          message: String(gasData.message || ''),
        };
      }
    } catch {
      // Fallback to direct Telegram API
    }
  }

  // 3. Direct Telegram API (getMe + getUpdates)
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const meData = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !meData.ok) {
      return {
        ok: false,
        chats: [],
        message: formatTelegramErrorThai(meData.description || `HTTP ${meRes.status}`),
      };
    }

    const botUsername = meData.result?.username || '';
    const botFirstName = meData.result?.first_name || '';

    const updRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=40`);
    const updData = await updRes.json().catch(() => ({}));
    const updates: Array<Record<string, unknown>> = Array.isArray(updData.result)
      ? updData.result
      : [];

    const chatMap = new Map<string, TelegramDetectedChat>();
    for (const u of updates) {
      const msg = (u.message || u.channel_post || u.my_chat_member || u.edited_message) as
        | Record<string, unknown>
        | undefined;
      const chat = msg?.chat as Record<string, unknown> | undefined;
      if (!chat || chat.id === undefined) continue;
      const cid = String(chat.id);
      const chatType = String(chat.type || 'private');
      const title =
        String(chat.title || '').trim() ||
        [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
        (chat.username ? `@${chat.username}` : `Chat ${cid}`);
      const text = typeof msg?.text === 'string' ? msg.text : '';
      const dateSec = typeof msg?.date === 'number' ? msg.date : 0;

      chatMap.set(cid, {
        chatId: cid,
        type: chatType,
        title,
        username: chat.username ? `@${chat.username}` : undefined,
        lastMessageText: text ? text.slice(0, 50) : undefined,
        lastDate: dateSec > 0 ? new Date(dateSec * 1000).toISOString() : undefined,
      });
    }

    const chats = Array.from(chatMap.values()).reverse();
    return {
      ok: true,
      botUsername: botUsername ? `@${botUsername}` : undefined,
      botFirstName,
      chats,
      message:
        chats.length > 0
          ? `เชื่อมต่อบอท ${botUsername ? `@${botUsername}` : botFirstName} สำเร็จ! พบ ${chats.length} ห้องแชทล่าสุด — กดเลือกห้องที่ต้องการรับแจ้งเตือนได้เลย`
          : `เชื่อมต่อบอท ${botUsername ? `@${botUsername}` : botFirstName} สำเร็จ แต่ยังไม่พบข้อความล่าสุด — กรุณาดึงบอทเข้ากลุ่ม Telegram แล้วพิมพ์ "สวัสดี" (หรือกด Start ในแชทบอท) แล้วกดค้นหาอีกครั้ง`,
    };
  } catch (err) {
    return {
      ok: false,
      chats: [],
      message: `ไม่สามารถเชื่อมต่อ api.telegram.org ได้โดยตรง (${
        err instanceof Error ? err.message : 'เครือข่ายอาจบล็อก Telegram'
      }) — แนะนำอัปเดตโค้ด Google Apps Script เพื่อให้ส่งผ่านเซิร์ฟเวอร์ Google แทนครับ`,
    };
  }
}
