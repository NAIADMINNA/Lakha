import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  extractThaiDate,
  extractThaiTime,
  formatSummaryCardHeaderDate,
  formatTaskDateRangeLabel,
  getPriorityHeaderTheme,
  inferTaskEndDate,
} from './src/services/lineCommandParser';

dotenv.config();
process.env.DISABLE_HMR = 'true';
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in server:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in server:', reason);
});

interface IncomingLineWebhookItem {
  id: string;
  text: string;
  userId?: string;
  timestamp: string;
}

interface DigestTaskItem {
  title: string;
  date: string;
  endDate?: string;
  time: string;
  categoryName: string;
  categoryColor: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  description?: string;
  assigneeName?: string;
  timePhase?: 'passed' | 'upcoming';
}

interface CollaborativeWorkspaceState {
  workspaceId: string;
  updatedAt: string;
  updatedBy?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  tasks: unknown[];
  categories: unknown[];
  teamMembers: unknown[];
}

function sanitizeToken(raw: string): string {
  return raw
    .replace(/^Bearer\s+/i, '')
    .replace(/[^\x21-\x7E]/g, '')
    .trim();
}

function formatThaiDateReadable(ymd: string): string {
  const thaiMonths = [
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
  const cleanYmd = String(ymd || '').slice(0, 10);
  const parts = cleanYmd.split('-');
  if (parts.length !== 3) return ymd;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12) return ymd;
  return `${d} ${thaiMonths[m - 1]} ${y + 543}`;
}

function formatThaiFullDateWithDay(ymd: string): string {
  const thaiDays = [
    'วันอาทิตย์ที่',
    'วันจันทร์ที่',
    'วันอังคารที่',
    'วันพุธที่',
    'วันพฤหัสบดีที่',
    'วันศุกร์ที่',
    'วันเสาร์ที่',
  ];
  const thaiMonths = [
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
  const cleanYmd = String(ymd || '').slice(0, 10);
  const parts = cleanYmd.split('-');
  if (parts.length !== 3) return ymd;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12) return ymd;
  const dt = new Date(y, m - 1, d);
  const dayName = thaiDays[dt.getDay()] || 'วันที่';
  return `${dayName} ${d} ${thaiMonths[m - 1]} ${y + 543}`;
}

function buildGoogleCalUrl(title: string, date: string, time: string, details: string): string {
  const cleanDate = (date || '2026-10-26').replace(/-/g, '');
  const [hhStr = '09', mmStr = '00'] = (time || '09:00').split(':');
  const startHH = String(parseInt(hhStr, 10) || 9).padStart(2, '0');
  const startMM = String(parseInt(mmStr, 10) || 0).padStart(2, '0');
  const endHour = Math.min(23, (parseInt(hhStr, 10) || 9) + 1);
  const endHH = String(endHour).padStart(2, '0');
  const datesParam = `${cleanDate}T${startHH}${startMM}00/${cleanDate}T${endHH}${startMM}00`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Task',
    dates: datesParam,
    details: details || 'ระบบน้องเลขา Task',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function getBangkokNowYMDAndHM(): { todayYMD: string; nowHM: string } {
  const now = new Date();
  try {
    const dParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const tParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const y = dParts.find((p) => p.type === 'year')?.value || '2026';
    const m = dParts.find((p) => p.type === 'month')?.value || '01';
    const d = dParts.find((p) => p.type === 'day')?.value || '01';
    const hh = tParts.find((p) => p.type === 'hour')?.value || '09';
    const mm = tParts.find((p) => p.type === 'minute')?.value || '00';
    return {
      todayYMD: `${y}-${m}-${d}`,
      nowHM: `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`,
    };
  } catch {
    return {
      todayYMD: now.toISOString().slice(0, 10),
      nowHM: now.toTimeString().slice(0, 5),
    };
  }
}

function buildDailyDigestFlexMessage(
  dateStr: string,
  tasksList: DigestTaskItem[],
  appUrl: string
) {
  const { todayYMD, nowHM } = getBangkokNowYMDAndHM();
  const cleanDateYMD = /^\d{4}-\d{2}-\d{2}/.test(String(dateStr || ''))
    ? String(dateStr).slice(0, 10)
    : todayYMD;
  const sortedTasks = [...tasksList].sort((a, b) =>
    String(a.time || '09:00').localeCompare(String(b.time || '09:00'))
  );
  const fullThaiDate = formatSummaryCardHeaderDate(cleanDateYMD, sortedTasks);
  const readableDate = formatThaiDateReadable(cleanDateYMD);

  const totalCount = sortedTasks.length;
  const completedCount = sortedTasks.filter((t) => t.status === 'completed').length;
  const pendingCount = totalCount - completedCount;

  const classifyItemPhase = (t: DigestTaskItem): 'passed' | 'upcoming' => {
    if (t.timePhase === 'passed' || t.timePhase === 'upcoming') {
      return t.timePhase;
    }
    const itemDate = t.date || cleanDateYMD;
    const itemTime = t.time || '09:00';
    if (itemDate < todayYMD) return 'passed';
    if (itemDate > todayYMD) return 'upcoming';
    return itemTime <= nowHM ? 'passed' : 'upcoming';
  };

  const renderAgendaTaskCard = (t: DigestTaskItem, index: number) => {
    const isDone = t.status === 'completed';
    const isHigh = t.priority === 'high';
    const isPassed = classifyItemPhase(t) === 'passed';
    const catColor = /^#[0-9A-Fa-f]{6}$/.test(t.categoryColor || '')
      ? t.categoryColor
      : '#2563EB';

    const statusLabel = isDone
      ? '✓ เสร็จแล้ว'
      : isHigh
      ? '🔥 ด่วนมาก'
      : isPassed
      ? '⚠️ เลยเวลา'
      : '⏳ รอถึงเวลา';

    const statusColor = isDone
      ? '#15803D'
      : isHigh
      ? '#B91C1C'
      : isPassed
      ? '#B45309'
      : '#1D4ED8';

    const statusBg = isDone
      ? '#DCFCE7'
      : isHigh
      ? '#FEE2E2'
      : isPassed
      ? '#FEF3C7'
      : '#DBEAFE';

    const cleanDesc = String(t.description || '').trim();
    const hasMeaningfulDesc =
      Boolean(cleanDesc) &&
      !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
      !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
      !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');

    const cardContents: Record<string, unknown>[] = [
      // Row 1: Time Badge + Category Pill + Status Badge
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
                text: `⏰ ${t.time || '09:00'} น.`,
                weight: 'bold',
                size: 'xs',
                color: isDone ? '#64748B' : '#FFFFFF',
              },
            ],
          },
          {
            type: 'text',
            text: `• ${t.categoryName || 'ทั่วไป'}`,
            size: 'xxs',
            weight: 'bold',
            color: isDone ? '#94A3B8' : catColor,
            flex: 1,
            wrap: false,
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: statusBg,
            cornerRadius: '6px',
            paddingStart: '7px',
            paddingEnd: '7px',
            paddingTop: '3px',
            paddingBottom: '3px',
            flex: 0,
            contents: [
              {
                type: 'text',
                text: statusLabel,
                size: 'xxs',
                weight: 'bold',
                color: statusColor,
              },
            ],
          },
        ],
      },
      // Row 2: Full-width Task Title
      {
        type: 'text',
        text: `${index + 1}. ${t.title || 'รายการงาน'}`,
        weight: 'bold',
        size: 'md',
        color: isDone ? '#94A3B8' : '#0F172A',
        wrap: true,
        margin: 'sm',
      },
    ];

    const itemStart = String(t.date || cleanDateYMD).slice(0, 10);
    const itemEnd =
      inferTaskEndDate({
        date: itemStart,
        endDate: t.endDate ? String(t.endDate).slice(0, 10) : undefined,
        title: t.title || '',
        description: t.description || '',
      }) || itemStart;

    if (itemEnd > itemStart) {
      cardContents.push({
        type: 'text',
        text: `🗓️ ต่อเนื่อง: ${formatTaskDateRangeLabel(
          { date: itemStart, endDate: itemEnd },
          'short'
        )}`,
        size: 'xxs',
        weight: 'bold',
        color: '#4338CA',
        wrap: true,
        margin: 'xs',
      });
    }

    if (hasMeaningfulDesc) {
      cardContents.push({
        type: 'text',
        text: cleanDesc,
        size: 'xs',
        color: isDone ? '#94A3B8' : '#475569',
        wrap: true,
        margin: 'xs',
      });
    }

    if (t.assigneeName) {
      cardContents.push({
        type: 'text',
        text: `👤 ผู้รับผิดชอบ: ${t.assigneeName}`,
        size: 'xxs',
        color: '#64748B',
        margin: 'xs',
        wrap: true,
      });
    }

    return {
      type: 'box',
      layout: 'horizontal',
      margin: index === 0 ? 'none' : 'md',
      backgroundColor: '#FFFFFF',
      cornerRadius: '12px',
      borderWidth: '1px',
      borderColor: !isDone && isHigh ? '#FCA5A5' : '#E2E8F0',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '6px',
          flex: 0,
          backgroundColor: isDone ? '#CBD5E1' : catColor,
          contents: [{ type: 'filler' }],
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          paddingAll: '12px',
          contents: cardContents,
        },
      ],
    };
  };

  const agendaCards: unknown[] =
    totalCount === 0
      ? [
          {
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
                weight: 'bold',
              },
            ],
          },
        ]
      : sortedTasks.map((t, idx) => renderAgendaTaskCard(t, idx));

  const scheduleBoardUrl = appUrl.includes('section=calendar')
    ? appUrl.replace('section=calendar', 'section=schedule')
    : appUrl;

  return {
    type: 'flex',
    altText: `📋 ตารางงานประจำวัน (${readableDate}) — รวม ${totalCount} งาน`,
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
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'text',
                text: `เวลา ${nowHM} น.`,
                color: '#94A3B8',
                size: 'xxs',
                align: 'end',
                weight: 'bold',
              },
            ],
          },
          {
            type: 'text',
            text: fullThaiDate,
            color: '#FFFFFF',
            size: 'lg',
            weight: 'bold',
            margin: 'md',
            wrap: true,
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
                  {
                    type: 'text',
                    text: `ทั้งหมด ${totalCount}`,
                    size: 'xs',
                    weight: 'bold',
                    color: '#38BDF8',
                    align: 'center',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: `รอดำเนินการ ${pendingCount}`,
                    size: 'xs',
                    weight: 'bold',
                    color: '#FBBF24',
                    align: 'center',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: `เสร็จแล้ว ${completedCount}`,
                    size: 'xs',
                    weight: 'bold',
                    color: '#34D399',
                    align: 'center',
                  },
                ],
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: '#F1F5F9',
        contents: agendaCards,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        backgroundColor: '#FFFFFF',
        borderWidth: '1px',
        borderColor: '#E2E8F0',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📅 เปิดดูปฏิทินและจัดการงาน',
              uri: appUrl,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📺 เปิดตารางงานนำเสนอ (รายวัน)',
              uri: scheduleBoardUrl,
            },
          },
        ],
      },
    },
  };
}

function buildSingleTaskReminderFlexMessage(params: {
  taskTitle: string;
  description?: string;
  date: string;
  endDate?: string;
  time: string;
  categoryName: string;
  categoryColor?: string;
  priority?: string;
  remindMinutesBefore?: number;
  appUrl: string;
  messageFormat?: 'executive_flex' | 'compact_flex' | 'text_custom';
  includeDescription?: boolean;
  includeGoogleCalendarButton?: boolean;
  includeOpenAppButton?: boolean;
  cardFontSize?: 'sm' | 'md' | 'lg';
  cardTitleWeight?: 'bold' | 'regular';
  cardLineSpacing?: 'tight' | 'normal' | 'relaxed';
  stats?: {
    total: number;
    pending: number;
    completed: number;
  };
}) {
  const inferredEnd = inferTaskEndDate({
    date: params.date,
    endDate: params.endDate,
    title: params.taskTitle,
    description: params.description || '',
  });
  const readableDate =
    inferredEnd && inferredEnd > params.date
      ? formatTaskDateRangeLabel({ date: params.date, endDate: inferredEnd }, 'short')
      : formatThaiDateReadable(params.date);
  const fullHeaderDate = formatSummaryCardHeaderDate(params.date, [
    {
      date: params.date,
      endDate: inferredEnd,
      title: params.taskTitle,
      description: params.description,
    },
  ]);

  const prioTheme = getPriorityHeaderTheme(params.priority, params.categoryName);
  const isCompact = params.messageFormat === 'compact_flex';
  const rawDesc = String(params.description || '').trim();
  const showDesc =
    params.includeDescription !== false &&
    Boolean(rawDesc) &&
    rawDesc !== String(params.taskTitle || '').trim() &&
    !rawDesc.startsWith('เพิ่มผ่านแชท LINE') &&
    !rawDesc.startsWith('บันทึกผ่านแชท LINE') &&
    !rawDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');
  const showCalBtn = params.includeGoogleCalendarButton !== false;
  const showAppBtn = params.includeOpenAppButton !== false;

  const fontScale = params.cardFontSize || 'md';
  const titleSize =
    fontScale === 'lg' ? 'xl' : fontScale === 'sm' ? 'md' : isCompact ? 'md' : 'lg';
  const bodySize = fontScale === 'lg' ? 'sm' : fontScale === 'sm' ? 'xxs' : 'xs';
  const timeValueSize = fontScale === 'lg' ? 'md' : fontScale === 'sm' ? 'xs' : 'sm';
  const textWeight = params.cardTitleWeight === 'regular' ? 'regular' : 'bold';
  const lineSpacingPx =
    params.cardLineSpacing === 'tight'
      ? '2px'
      : params.cardLineSpacing === 'normal'
      ? '4px'
      : '6px';

  const catColorHex =
    /^#[0-9A-Fa-f]{6}$/.test(params.categoryColor || '')
      ? params.categoryColor!
      : prioTheme.headerBg;
  const googleCalUrl = buildGoogleCalUrl(
    params.taskTitle,
    params.date,
    params.time,
    params.description || ''
  );

  const scheduleBoardUrl = params.appUrl.includes('section=calendar')
    ? params.appUrl.replace('section=calendar', 'section=schedule')
    : params.appUrl;

  const footerButtons: Record<string, unknown>[] = [];
  if (showAppBtn) {
    footerButtons.push({
      type: 'button',
      style: 'primary',
      color: '#06C755',
      height: 'sm',
      action: {
        type: 'uri',
        label: '📅 เปิดดูปฏิทินของทีม',
        uri: params.appUrl,
      },
    });
  }
  if (!params.appUrl.includes('script.google.com')) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '📺 เปิดตารางงานนำเสนอ (รายวัน)',
        uri: scheduleBoardUrl,
      },
    });
  } else if (showCalBtn && footerButtons.length < 2) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: '+ เพิ่มลงแอป Google Calendar',
        uri: googleCalUrl,
      },
    });
  }

  const detailCardContents: Record<string, unknown>[] = [
    // Prominent Date & Time Highlight Box inside Body
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: prioTheme.badgeBg,
      cornerRadius: '10px',
      paddingAll: '12px',
      borderWidth: '1px',
      borderColor: prioTheme.borderAccent,
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: prioTheme.headerBg,
              cornerRadius: '6px',
              paddingStart: '10px',
              paddingEnd: '10px',
              paddingTop: '4px',
              paddingBottom: '4px',
              flex: 0,
              contents: [
                {
                  type: 'text',
                  text: `⏰ เวลา ${params.time} น.`,
                  color: '#FFFFFF',
                  size: 'md',
                  weight: 'bold',
                },
              ],
            },
          ],
        },
        {
          type: 'text',
          text: `🗓️ ${fullHeaderDate}`,
          color: '#0F172A',
          size: 'sm',
          weight: 'bold',
          margin: 'sm',
          wrap: true,
        },
      ],
    },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '🗂️ หมวดหมู่',
          color: '#64748B',
          size: bodySize,
          flex: 3,
        },
        {
          type: 'text',
          text: params.categoryName || 'ทั่วไป',
          color: catColorHex,
          size: bodySize,
          weight: textWeight,
          flex: 7,
          wrap: true,
        },
      ],
    },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      margin: 'sm',
      contents: [
        {
          type: 'text',
          text: '⚡ ความสำคัญ',
          color: '#64748B',
          size: bodySize,
          flex: 3,
        },
        {
          type: 'text',
          text: prioTheme.shortLabel,
          color: prioTheme.badgeText,
          size: bodySize,
          weight: textWeight,
          flex: 7,
          wrap: true,
        },
      ],
    },
  ];

  if (showDesc) {
    detailCardContents.push({
      type: 'separator',
      margin: 'md',
      color: '#E2E8F0',
    });
    detailCardContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#F8FAFC',
      cornerRadius: '8px',
      paddingAll: '10px',
      margin: 'md',
      contents: [
        {
          type: 'text',
          text: '📝 รายละเอียดงาน',
          size: 'xxs',
          weight: 'bold',
          color: '#475569',
        },
        {
          type: 'text',
          text: rawDesc,
          size: bodySize,
          lineSpacing: lineSpacingPx,
          color: '#1E293B',
          margin: 'xs',
          wrap: true,
        },
      ],
    });
  }

  const summaryStats = params.stats;

  const bodyContents: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'horizontal',
      backgroundColor: '#FFFFFF',
      cornerRadius: '12px',
      borderWidth: '1px',
      borderColor: prioTheme.priorityKey === 'high' ? '#FCA5A5' : '#E2E8F0',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '6px',
          flex: 0,
          backgroundColor: prioTheme.headerBg,
          contents: [{ type: 'filler' }],
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          paddingAll: '14px',
          contents: detailCardContents,
        },
      ],
    },
  ];

  if (summaryStats) {
    bodyContents.push({
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
            {
              type: 'text',
              text: `ทั้งหมด ${summaryStats.total}`,
              size: 'xxs',
              weight: 'bold',
              color: '#38BDF8',
              align: 'center',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `รอทำ ${summaryStats.pending}`,
              size: 'xxs',
              weight: 'bold',
              color: '#FBBF24',
              align: 'center',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `เสร็จแล้ว ${summaryStats.completed}`,
              size: 'xxs',
              weight: 'bold',
              color: '#34D399',
              align: 'center',
            },
          ],
        },
      ],
    });
  }

  return {
    type: 'flex',
    altText: `🔔 แจ้งเตือนงาน: ${params.taskTitle} (${readableDate} เวลา ${params.time} น.)`,
    contents: {
      type: 'bubble',
      size: isCompact ? 'kilo' : 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: prioTheme.headerBg,
        paddingAll: isCompact ? '14px' : '18px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: prioTheme.badgeBg,
                cornerRadius: '6px',
                paddingStart: '8px',
                paddingEnd: '8px',
                paddingTop: '4px',
                paddingBottom: '4px',
                flex: 0,
                contents: [
                  {
                    type: 'text',
                    text: prioTheme.badgeLabel,
                    color: prioTheme.badgeText,
                    size: 'xxs',
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'text',
                text: `🗂️ ${params.categoryName || 'ทั่วไป'}`,
                color: '#FFFFFF',
                size: 'xs',
                weight: 'bold',
                align: 'end',
                wrap: false,
              },
            ],
          },
          {
            type: 'text',
            text: params.taskTitle || 'รายการงานแจ้งเตือน',
            color: '#FFFFFF',
            size: titleSize,
            weight: textWeight,
            lineSpacing: lineSpacingPx,
            wrap: true,
            margin: 'md',
          },
          // High-Contrast Date & Time Spotlight Banner inside Header
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFFFFF',
            cornerRadius: '10px',
            paddingAll: '10px',
            margin: 'md',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                alignItems: 'center',
                spacing: 'sm',
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
                        text: `⏰ ${params.time} น.`,
                        color: '#FFFFFF',
                        size: 'sm',
                        weight: 'bold',
                      },
                    ],
                  },
                  {
                    type: 'text',
                    text: `🗓️ ${readableDate}`,
                    color: prioTheme.badgeText,
                    size: 'sm',
                    weight: 'bold',
                    flex: 1,
                    wrap: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: isCompact ? '14px' : '16px',
        backgroundColor: '#F1F5F9',
        contents: bodyContents,
      },
      ...(footerButtons.length > 0
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: isCompact ? '12px' : '14px',
              backgroundColor: '#FFFFFF',
              borderWidth: '1px',
              borderColor: '#E2E8F0',
              contents: footerButtons,
            },
          }
        : {}),
    },
  };
}

const DEFAULT_TEAM_GAS_URL =
  'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';

function resolveCleanGasUrl(candidate?: string | null): string {
  const trimmed = String(candidate || '').trim();
  if (
    trimmed.startsWith('https://script.google.com/macros/s/') &&
    !trimmed.includes('AKfycby0gvQ') &&
    !trimmed.includes('AKfycbxIf9k')
  ) {
    return trimmed;
  }
  return DEFAULT_TEAM_GAS_URL;
}

let runtimeChannelAccessToken = sanitizeToken(process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
let runtimeDefaultUserId = (process.env.LINE_DEFAULT_USER_ID || '').trim();
let runtimeDetectedGroupId = (process.env.LINE_DEFAULT_GROUP_ID || '').trim();
let runtimeGasUrl = DEFAULT_TEAM_GAS_URL;
let lastMorningDigestSentDate = '';
let runtimeScheduleConfig: {
  enabled: boolean;
  dailyDigestEnabled: boolean;
  dailyDigestTime: string;
  defaultRemindMinutes: number;
  notifyOnOverdue: boolean;
  teamNotificationMode: 'broadcast' | 'group' | 'both';
  publicCalendarUrl: string;
  messageFormat: 'executive_flex' | 'compact_flex' | 'text_custom';
  includeDescriptionInNotification: boolean;
  includeGoogleCalendarButton: boolean;
  includeOpenAppButton: boolean;
  cardFontSize: 'sm' | 'md' | 'lg';
  cardTitleWeight: 'bold' | 'regular';
  cardLineSpacing: 'tight' | 'normal' | 'relaxed';
} = {
  enabled: true,
  dailyDigestEnabled: true,
  dailyDigestTime: '08:00',
  defaultRemindMinutes: 1,
  notifyOnOverdue: false,
  teamNotificationMode: 'both',
  publicCalendarUrl: 'https://naiadminna.github.io/Lakha/?section=calendar',
  messageFormat: 'executive_flex',
  includeDescriptionInNotification: true,
  includeGoogleCalendarButton: true,
  includeOpenAppButton: true,
  cardFontSize: 'md',
  cardTitleWeight: 'bold',
  cardLineSpacing: 'relaxed',
};
let runtimeDirectorPresence: {
  mode: 'auto' | 'in_office' | 'in_meeting' | 'offsite' | 'unavailable';
  customNote: string;
  updatedAt: string;
} = {
  mode: 'auto',
  customNote: '',
  updatedAt: new Date().toISOString(),
};
const pendingWebhookMessages: IncomingLineWebhookItem[] = [];
const sharedWorkspaces = new Map<string, CollaborativeWorkspaceState>();
const PERMANENTLY_PURGED_TASK_IDS = [
  'task-1793454460187',
  'task-1793455770914-ty0d',
  'task-1793455784374',
  'task-1793455747775',
  'task-1793544098273',
  'task-1793545518340',
  'task-1793545672609',
  'task-1793455703389',
  'task-1793455880542-gdhj',
  'task-1793611662385',
  'task-1793668054359',
  'task-1793630653911',
  'task-1793666764668',
];
const persistedDeletedTaskIds = new Set<string>(PERMANENTLY_PURGED_TASK_IDS);
const WORKSPACE_CACHE_FILE = path.join(process.cwd(), '.sheetcal-workspace-cache.json');

function loadPersistedWorkspaceCache(): void {
  try {
    if (!fs.existsSync(WORKSPACE_CACHE_FILE)) return;
    const raw = fs.readFileSync(WORKSPACE_CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.runtimeChannelAccessToken === 'string' && parsed.runtimeChannelAccessToken) {
        runtimeChannelAccessToken = sanitizeToken(parsed.runtimeChannelAccessToken);
      }
      if (typeof parsed.runtimeDefaultUserId === 'string' && parsed.runtimeDefaultUserId) {
        runtimeDefaultUserId = parsed.runtimeDefaultUserId.trim();
      }
      if (typeof parsed.runtimeDetectedGroupId === 'string' && parsed.runtimeDetectedGroupId) {
        runtimeDetectedGroupId = parsed.runtimeDetectedGroupId.trim();
      }
      if (typeof parsed.runtimeGasUrl === 'string' && parsed.runtimeGasUrl) {
        runtimeGasUrl = resolveCleanGasUrl(parsed.runtimeGasUrl);
      }
      if (typeof parsed.lastMorningDigestSentDate === 'string') {
        lastMorningDigestSentDate = parsed.lastMorningDigestSentDate;
      }
      if (parsed.runtimeScheduleConfig && typeof parsed.runtimeScheduleConfig === 'object') {
        runtimeScheduleConfig = {
          ...runtimeScheduleConfig,
          ...parsed.runtimeScheduleConfig,
        };
      }
      if (parsed.runtimeDirectorPresence && typeof parsed.runtimeDirectorPresence === 'object') {
        const dp = parsed.runtimeDirectorPresence as Record<string, unknown>;
        const validModes = ['auto', 'in_office', 'in_meeting', 'offsite', 'unavailable'];
        if (typeof dp.mode === 'string' && validModes.includes(dp.mode)) {
          runtimeDirectorPresence = {
            mode: dp.mode as typeof runtimeDirectorPresence.mode,
            customNote: typeof dp.customNote === 'string' ? dp.customNote : '',
            updatedAt:
              typeof dp.updatedAt === 'string' && dp.updatedAt
                ? dp.updatedAt
                : new Date().toISOString(),
          };
        }
      }
      if (Array.isArray(parsed.deletedTaskIds)) {
        for (const id of parsed.deletedTaskIds) {
          if (id) persistedDeletedTaskIds.add(String(id));
        }
      }
      if (parsed.workspaces && typeof parsed.workspaces === 'object') {
        for (const [k, v] of Object.entries(parsed.workspaces)) {
          if (v && typeof v === 'object') {
            const ws = v as CollaborativeWorkspaceState;
            if (Array.isArray(ws.tasks)) {
              ws.tasks = ws.tasks.filter((t) => {
                if (!t || typeof t !== 'object') return false;
                const tid = String((t as Record<string, unknown>).id || '').trim();
                return Boolean(tid && !persistedDeletedTaskIds.has(tid));
              });
            }
            sharedWorkspaces.set(k, ws);
          }
        }
      }
    }
  } catch {
    // Ignore cache read error
  }
}

function savePersistedWorkspaceCache(): void {
  try {
    const workspacesObj: Record<string, CollaborativeWorkspaceState> = {};
    for (const [k, v] of sharedWorkspaces.entries()) {
      workspacesObj[k] = v;
    }
    fs.writeFileSync(
      WORKSPACE_CACHE_FILE,
      JSON.stringify(
        {
          runtimeChannelAccessToken,
          runtimeDefaultUserId,
          runtimeDetectedGroupId,
          runtimeGasUrl: resolveCleanGasUrl(runtimeGasUrl),
          lastMorningDigestSentDate,
          runtimeScheduleConfig,
          runtimeDirectorPresence,
          deletedTaskIds: Array.from(persistedDeletedTaskIds),
          workspaces: workspacesObj,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {
    // Ignore cache write error
  }
}

loadPersistedWorkspaceCache();

async function postToGoogleAppsScript(
  scriptUrl: string,
  payloadObj: Record<string, unknown>
): Promise<{ status: number; bodyText: string; json: Record<string, unknown> }> {
  const postRes = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadObj),
    redirect: 'manual',
  });
  let bodyText = '';
  let finalStatus = postRes.status;
  if (
    (postRes.status === 301 ||
      postRes.status === 302 ||
      postRes.status === 303 ||
      postRes.status === 307) &&
    postRes.headers.get('location')
  ) {
    const redirectUrl = postRes.headers.get('location')!;
    const getRes = await fetch(redirectUrl, { method: 'GET' });
    finalStatus = getRes.status;
    bodyText = await getRes.text();
  } else {
    bodyText = await postRes.text();
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(bodyText);
  } catch {
    json = {};
  }
  return { status: finalStatus, bodyText, json };
}

async function purgeAllLineRichMenus(
  rawToken: string,
  targetUserId?: string
): Promise<{
  ok: boolean;
  deletedCount: number;
  deletedIds: string[];
  defaultUnlinked: boolean;
  userUnlinked: boolean;
  message: string;
}> {
  const token = sanitizeToken(rawToken || runtimeChannelAccessToken || '');
  if (!token) {
    return {
      ok: false,
      deletedCount: 0,
      deletedIds: [],
      defaultUnlinked: false,
      userUnlinked: false,
      message: 'กรุณาวาง LINE Channel Access Token ในแท็บ "LINE Token" ก่อนสั่งลบ Rich Menu',
    };
  }

  const deletedIds: string[] = [];
  let defaultUnlinked = false;
  let userUnlinked = false;

  try {
    // 1. Cancel default rich menu for all users
    const unlinkAllRes = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    defaultUnlinked = unlinkAllRes.ok || unlinkAllRes.status === 404;

    // 2. Unlink rich menu from specific user ID if provided
    const uidCandidates = Array.from(
      new Set(
        [targetUserId?.trim(), runtimeDefaultUserId?.trim()].filter(
          (id): id is string => Boolean(id && /^U[0-9a-fA-F]{32}$/.test(id))
        )
      )
    );
    for (const uid of uidCandidates) {
      const unlinkUserRes = await fetch(
        `https://api.line.me/v2/bot/user/${encodeURIComponent(uid)}/richmenu`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (unlinkUserRes.ok || unlinkUserRes.status === 404) {
        userUnlinked = true;
      }
    }

    // 3. List all rich menus created via Messaging API and delete every single one
    const listRes = await fetch('https://api.line.me/v2/bot/richmenu/list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!listRes.ok) {
      const errJson = await listRes.json().catch(() => ({}));
      return {
        ok: false,
        deletedCount: 0,
        deletedIds: [],
        defaultUnlinked,
        userUnlinked,
        message: `ไม่สามารถเชื่อมต่อ LINE Rich Menu API ได้ (${
          errJson?.message || `HTTP ${listRes.status}`
        }) — กรุณาตรวจสอบ LINE Channel Access Token`,
      };
    }

    const listData = (await listRes.json().catch(() => ({}))) as {
      richmenus?: { richMenuId?: string; name?: string }[];
    };
    const menus = Array.isArray(listData.richmenus) ? listData.richmenus : [];

    for (const rm of menus) {
      if (rm.richMenuId) {
        const delRes = await fetch(
          `https://api.line.me/v2/bot/richmenu/${encodeURIComponent(rm.richMenuId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (delRes.ok) {
          deletedIds.push(rm.richMenuId);
        }
      }
    }

    // 4. Also clear any rich menu aliases if present
    const aliasListRes = await fetch('https://api.line.me/v2/bot/richmenu/alias/list', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (aliasListRes && aliasListRes.ok) {
      const aliasData = (await aliasListRes.json().catch(() => ({}))) as {
        aliases?: { richMenuAliasId?: string }[];
      };
      for (const al of aliasData.aliases || []) {
        if (al.richMenuAliasId) {
          await fetch(
            `https://api.line.me/v2/bot/richmenu/alias/${encodeURIComponent(al.richMenuAliasId)}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          ).catch(() => {});
        }
      }
    }

    return {
      ok: true,
      deletedCount: deletedIds.length,
      deletedIds,
      defaultUnlinked,
      userUnlinked,
      message:
        deletedIds.length > 0
          ? `✅ ลบ Rich Menu ออกจากระบบ LINE OA สำเร็จแล้ว (${deletedIds.length} รายการ) และยกเลิกการผูกกับผู้ใช้ทั้งหมดเรียบร้อย! กรุณากดออกจากห้องแชทบอทในแอป LINE แล้วกดเข้าห้องแชทใหม่อีกครั้งเพื่อรีเฟรชหน้าจอ`
          : `✅ ยกเลิกการผูก Rich Menu ของ Messaging API ทั้งหมดแล้ว (ไม่พบ Rich Menu ค้างในฝั่ง API) — 💡 หมายเหตุ: หากในแอป LINE ยังเห็นริชเมนูอยู่ แปลว่าเป็นริชเมนูที่ตั้งค่าไว้ในเว็บ LINE Official Account Manager (manager.line.biz) ให้เข้าไปที่เว็บ manager.line.biz > เมนู "ริชเมนู (Rich menus)" แล้วกดปิดการใช้งาน (Inactive/ลบ) จากนั้นปิด-เปิดห้องแชทใน LINE ใหม่ครับ`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      ok: false,
      deletedCount: deletedIds.length,
      deletedIds,
      defaultUnlinked,
      userUnlinked,
      message: `เกิดข้อผิดพลาดขณะลบ Rich Menu: ${msg}`,
    };
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Enable CORS on /api/collab/* so external portals (including Google Apps Script Web App) can sync directly
  app.use('/api/collab', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const deletedTaskIds = persistedDeletedTaskIds;
  let lastGasPullMs = 0;
  let lastWorkspacePostMs = 0;

  const GAS_META_DELIM = '#SCMETA#';

  function attachGasMetadataToTasks(
    taskList: unknown[],
    categoriesList?: unknown[],
    teamMembersList?: unknown[]
  ): Record<string, unknown>[] {
    const cleanCats = Array.isArray(categoriesList) && categoriesList.length > 0 ? categoriesList : undefined;
    const cleanMembers = Array.isArray(teamMembersList) && teamMembersList.length > 0 ? teamMembersList : undefined;
    return taskList
      .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
      .map((t, idx) => {
        const rawSource = String(t.source || 'web').split(GAS_META_DELIM)[0] || 'web';
        const dateStr =
          typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
            ? t.date
            : undefined;
        const timeStr =
          typeof t.time === 'string' && /^\d{2}:\d{2}$/.test(t.time)
            ? t.time
            : undefined;
        const endDate =
          typeof t.endDate === 'string' && t.endDate > String(t.date || '')
            ? t.endDate
            : undefined;
        const metaObj: Record<string, unknown> = {};
        if (dateStr) metaObj.d = dateStr;
        if (timeStr) metaObj.t = timeStr;
        if (endDate) metaObj.e = endDate;
        if (idx === 0) {
          if (cleanCats) metaObj.c = cleanCats;
          if (cleanMembers) metaObj.m = cleanMembers;
        }
        const encodedSource =
          Object.keys(metaObj).length > 0
            ? `${rawSource}${GAS_META_DELIM}${JSON.stringify(metaObj)}`
            : rawSource;
        return {
          ...t,
          source: encodedSource,
        };
      });
  }

  function extractGasMetadataFromTasks(rawTasks: unknown[]): {
    tasks: Record<string, unknown>[];
    categories?: unknown[];
    teamMembers?: unknown[];
  } {
    let extractedCategories: unknown[] | undefined;
    let extractedMembers: unknown[] | undefined;
    const cleaned: Record<string, unknown>[] = [];

    for (const item of rawTasks) {
      if (!item || typeof item !== 'object') continue;
      const rec = { ...(item as Record<string, unknown>) };
      const rawSource = String(rec.source || 'web');
      if (rawSource.includes(GAS_META_DELIM)) {
        const [baseSource, metaJson] = rawSource.split(GAS_META_DELIM);
        rec.source = baseSource || 'web';
        if (metaJson) {
          try {
            const parsedMeta = JSON.parse(metaJson) as {
              d?: string;
              t?: string;
              e?: string;
              c?: unknown[];
              m?: unknown[];
            };
            if (typeof parsedMeta.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsedMeta.d)) {
              rec.date = parsedMeta.d;
            }
            if (typeof parsedMeta.t === 'string' && /^\d{2}:\d{2}$/.test(parsedMeta.t)) {
              rec.time = parsedMeta.t;
            }
            if (typeof parsedMeta.e === 'string' && parsedMeta.e && !rec.endDate) {
              rec.endDate = parsedMeta.e;
            }
            if (Array.isArray(parsedMeta.c) && parsedMeta.c.length > 0 && !extractedCategories) {
              extractedCategories = parsedMeta.c;
            }
            if (Array.isArray(parsedMeta.m) && parsedMeta.m.length > 0 && !extractedMembers) {
              extractedMembers = parsedMeta.m;
            }
          } catch {
            // Ignore malformed metadata
          }
        }
      }

      const dateStr = String(rec.date || '').trim();
      if (!rec.endDate && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const combinedText = `${String(rec.title || '')} ${String(rec.description || '')}`;
        const [y, m, d] = dateStr.split('-').map(Number);
        const durMatch = combinedText.match(/(\d{1,2})\s*วัน/);
        if (durMatch) {
          const days = parseInt(durMatch[1], 10);
          if (days >= 2 && days <= 60) {
            const dt = new Date(y, m - 1, d + (days - 1));
            const ey = dt.getFullYear();
            const em = String(dt.getMonth() + 1).padStart(2, '0');
            const ed = String(dt.getDate()).padStart(2, '0');
            rec.endDate = `${ey}-${em}-${ed}`;
          }
        } else {
          const rangeMatch = combinedText.match(/(?:วันที่\s*)?(\d{1,2})\s*[-–—ถึง]\s*(\d{1,2})/);
          if (rangeMatch) {
            const startDay = parseInt(rangeMatch[1], 10);
            const endDay = parseInt(rangeMatch[2], 10);
            if (startDay === d && endDay > startDay && endDay <= 31) {
              const dt = new Date(y, m - 1, endDay);
              const ey = dt.getFullYear();
              const em = String(dt.getMonth() + 1).padStart(2, '0');
              const ed = String(dt.getDate()).padStart(2, '0');
              rec.endDate = `${ey}-${em}-${ed}`;
            }
          }
        }
      }

      cleaned.push(rec);
    }

    return {
      tasks: cleaned,
      categories: extractedCategories,
      teamMembers: extractedMembers,
    };
  }

  function normalizeTaskSemanticKey(rec: Record<string, unknown>): string {
    const normTitle = String(rec.title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const normDate = String(rec.date || '').trim().slice(0, 10);
    const normTime = String(rec.time || '09:00').trim().slice(0, 5);
    return `${normTitle}|${normDate}|${normTime}`;
  }

  function mergeTasksById(
    primaryList: unknown[],
    secondaryList: unknown[]
  ): Record<string, unknown>[] {
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of [...secondaryList, ...primaryList]) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = String(rec.id || '').trim();
      const title = String(rec.title || '').trim();
      if (!id || !title || deletedTaskIds.has(id)) continue;
      const dateStr = String(rec.date || '').trim();
      if (dateStr === '2026-11-03' || dateStr === '2026-11-04') {
        const numMatch = id.match(/^task-(\d+)/);
        const createdMs = numMatch ? Number(numMatch[1]) : 0;
        const updatedMs = rec.updatedAt ? new Date(String(rec.updatedAt)).getTime() : 0;
        if (
          (createdMs > 0 && createdMs < 1793841300000) ||
          (updatedMs > 0 && updatedMs < 1793841300000)
        ) {
          deletedTaskIds.add(id);
          continue;
        }
      }
      const existingItem = byId.get(id);
      if (!existingItem) {
        byId.set(id, rec);
      } else {
        const existingTime = existingItem.updatedAt
          ? new Date(String(existingItem.updatedAt)).getTime()
          : 0;
        const incomingTime = rec.updatedAt
          ? new Date(String(rec.updatedAt)).getTime()
          : 0;
        if (incomingTime >= existingTime) {
          byId.set(id, {
            ...existingItem,
            ...rec,
            endDate: rec.endDate ?? existingItem.endDate,
          });
        } else if (!existingItem.endDate && rec.endDate) {
          byId.set(id, {
            ...existingItem,
            endDate: rec.endDate,
          });
        }
      }
    }

    // Semantic deduplication across distinct task IDs with identical (title + date + time)
    const bySemanticKey = new Map<string, Record<string, unknown>>();
    for (const candidate of byId.values()) {
      const sigKey = normalizeTaskSemanticKey(candidate);
      const existingDup = bySemanticKey.get(sigKey);
      if (!existingDup) {
        bySemanticKey.set(sigKey, candidate);
        continue;
      }

      const existingId = String(existingDup.id || '').trim();
      const candidateId = String(candidate.id || '').trim();
      const existingTime = existingDup.updatedAt
        ? new Date(String(existingDup.updatedAt)).getTime()
        : 0;
      const candidateTime = candidate.updatedAt
        ? new Date(String(candidate.updatedAt)).getTime()
        : 0;
      const existingDone = existingDup.status === 'completed';
      const candidateDone = candidate.status === 'completed';

      const preferCandidate =
        (candidateDone && !existingDone) ||
        (candidateDone === existingDone && candidateTime >= existingTime);

      const winner = preferCandidate ? candidate : existingDup;
      const loser = preferCandidate ? existingDup : candidate;
      const loserId = preferCandidate ? existingId : candidateId;

      const mergedWinner: Record<string, unknown> = {
        ...loser,
        ...winner,
        endDate: winner.endDate ?? loser.endDate,
        description:
          String(winner.description || '').trim() ||
          String(loser.description || '').trim(),
      };

      if (loserId && loserId !== String(mergedWinner.id || '').trim()) {
        deletedTaskIds.add(loserId);
      }
      bySemanticKey.set(sigKey, mergedWinner);
    }

    return Array.from(bySemanticKey.values()).sort((a, b) =>
      String(`${a.date || ''} ${a.time || ''}`).localeCompare(
        String(`${b.date || ''} ${b.time || ''}`)
      )
    );
  }

  // Deduplicate any pre-existing duplicate tasks in the loaded workspace cache on server startup
  {
    let cacheMutated = false;
    for (const [wsKey, wsVal] of sharedWorkspaces.entries()) {
      if (wsVal && Array.isArray(wsVal.tasks)) {
        const beforeCount = wsVal.tasks.length;
        const decoded = extractGasMetadataFromTasks(wsVal.tasks);
        const deduped = mergeTasksById(decoded.tasks, []);
        if (deduped.length !== beforeCount || JSON.stringify(deduped) !== JSON.stringify(wsVal.tasks)) {
          wsVal.tasks = deduped;
          sharedWorkspaces.set(wsKey, wsVal);
          cacheMutated = true;
        }
      }
    }
    if (cacheMutated) {
      savePersistedWorkspaceCache();
    }
  }

  let gasSyncChain: Promise<{ ok: boolean; version?: unknown; json?: Record<string, unknown> }> =
    Promise.resolve({ ok: true });

  function syncWorkspaceToGasSafely(
    targetGasUrl: string,
    workspaceId = 'sheetcal-team-clean'
  ): Promise<{ ok: boolean; version?: unknown; json?: Record<string, unknown> }> {
    const cleanGas = resolveCleanGasUrl(targetGasUrl);
    if (!cleanGas.startsWith('https://script.google.com/macros/s/')) {
      return Promise.resolve({ ok: false });
    }

    const nextOp = gasSyncChain.then(async () => {
      try {
        // 1. Pull latest tasks from GAS first so a web save NEVER wipes out a task just added in LINE Group
        try {
          const gasGetRes = await fetch(`${cleanGas}?action=get_tasks&format=json`, {
            method: 'GET',
            redirect: 'follow',
          });
          if (gasGetRes.ok) {
            const gasData = (await gasGetRes.json().catch(() => ({}))) as {
              tasks?: unknown[];
              categories?: unknown[];
              teamMembers?: unknown[];
              detectedGroupId?: string;
            };
            if (
              typeof gasData.detectedGroupId === 'string' &&
              /^[CR][0-9a-fA-F]{32}$/.test(gasData.detectedGroupId.trim())
            ) {
              runtimeDetectedGroupId = gasData.detectedGroupId.trim();
            }
            if (Array.isArray(gasData.tasks) && gasData.tasks.length > 0) {
              const decodedGas = extractGasMetadataFromTasks(gasData.tasks);
              const validRemoteGas = decodedGas.tasks.filter((rt) => {
                const rid = String(rt.id || '').trim();
                return Boolean(rid && !deletedTaskIds.has(rid));
              });
              const curState =
                sharedWorkspaces.get(workspaceId) ||
                sharedWorkspaces.get('sheetcal-team-clean') ||
                sharedWorkspaces.get('team-default');
              const curTasks = Array.isArray(curState?.tasks)
                ? extractGasMetadataFromTasks(curState.tasks).tasks
                : [];
              const merged = mergeTasksById(curTasks, validRemoteGas);
              if (curState && JSON.stringify(merged) !== JSON.stringify(curState.tasks)) {
                const updatedState: CollaborativeWorkspaceState = {
                  ...curState,
                  updatedAt: new Date().toISOString(),
                  tasks: merged,
                };
                sharedWorkspaces.set(workspaceId, updatedState);
                sharedWorkspaces.set('sheetcal-team-clean', updatedState);
                sharedWorkspaces.set('team-default', updatedState);
                savePersistedWorkspaceCache();
              }
            }
          }
        } catch {
          // Proceed with current server tasks if pre-pull fails transiently
        }

        // 2. Push the unified merged & deduplicated task list + tombstones to GAS
        const latestState =
          sharedWorkspaces.get(workspaceId) ||
          sharedWorkspaces.get('sheetcal-team-clean') ||
          sharedWorkspaces.get('team-default');
        const finalTasks = Array.isArray(latestState?.tasks) ? latestState.tasks : [];
        const finalCats = Array.isArray(latestState?.categories) ? latestState.categories : [];
        const finalMembers = Array.isArray(latestState?.teamMembers)
          ? latestState.teamMembers
          : [];
        const gasTasksWithMeta = attachGasMetadataToTasks(
          finalTasks,
          finalCats,
          finalMembers
        );
        const syncRes = await postToGoogleAppsScript(cleanGas, {
          action: 'sync_tasks',
          tasks: gasTasksWithMeta,
          categories: finalCats,
          teamMembers: finalMembers,
          deletedTaskIds: Array.from(deletedTaskIds),
        });
        savePersistedWorkspaceCache();
        return {
          ok: Boolean(syncRes.json.ok),
          version: syncRes.json.version,
          json: syncRes.json,
        };
      } catch {
        return { ok: false };
      }
    });

    gasSyncChain = nextOp.catch(() => ({ ok: false }));
    return nextOp;
  }

  // Real-time Director Front-Office Presence Status Endpoints
  app.get('/api/collab/director-presence', (_req, res) => {
    res.json({
      ok: true,
      presence: runtimeDirectorPresence,
    });
  });

  app.post('/api/collab/director-presence', (req, res) => {
    const { mode, customNote } = req.body || {};
    const validModes = ['auto', 'in_office', 'in_meeting', 'offsite', 'unavailable'];
    if (typeof mode === 'string' && validModes.includes(mode)) {
      runtimeDirectorPresence.mode = mode as typeof runtimeDirectorPresence.mode;
    }
    if (typeof customNote === 'string') {
      runtimeDirectorPresence.customNote = customNote.trim().slice(0, 160);
    }
    runtimeDirectorPresence.updatedAt = new Date().toISOString();
    savePersistedWorkspaceCache();
    res.json({
      ok: true,
      presence: runtimeDirectorPresence,
    });
  });

  // Real-time Collaborative Shared Calendar Workspace Endpoints
  app.get('/api/collab/workspace/:workspaceId', async (req, res) => {
    const workspaceId = String(req.params.workspaceId || 'sheetcal-team-clean').trim();
    let state =
      sharedWorkspaces.get(workspaceId) ||
      sharedWorkspaces.get('sheetcal-team-clean') ||
      sharedWorkspaces.get('team-default') ||
      Array.from(sharedWorkspaces.values())[0];

    const nowMs = Date.now();
    const cleanGas = resolveCleanGasUrl(runtimeGasUrl);
    if (
      cleanGas.startsWith('https://script.google.com/macros/s/') &&
      nowMs - lastGasPullMs > 3500 &&
      nowMs - lastWorkspacePostMs > 2500
    ) {
      lastGasPullMs = nowMs;
      try {
        const gasRes = await fetch(
          `${cleanGas}?action=get_tasks&format=json`,
          { method: 'GET', redirect: 'follow' }
        );
        if (gasRes.ok) {
          const gasData = (await gasRes.json().catch(() => ({}))) as {
            tasks?: unknown[];
            categories?: unknown[];
            teamMembers?: unknown[];
            detectedGroupId?: string;
          };
          if (
            typeof gasData.detectedGroupId === 'string' &&
            /^[CR][0-9a-fA-F]{32}$/.test(gasData.detectedGroupId.trim())
          ) {
            runtimeDetectedGroupId = gasData.detectedGroupId.trim();
          }
          if (Array.isArray(gasData.tasks)) {
            const decodedGas = extractGasMetadataFromTasks(gasData.tasks);
            const currentTasks = Array.isArray(state?.tasks) ? state.tasks : [];
            const gasTaskIds = new Set<string>();
            for (const gt of decodedGas.tasks) {
              const gid = String(gt.id || '').trim();
              if (gid) gasTaskIds.add(gid);
            }
            // Keep all local tasks that have not been explicitly deleted
            const validLocalTasks = currentTasks.filter((lt) => {
              if (!lt || typeof lt !== 'object') return false;
              const rec = lt as Record<string, unknown>;
              const lid = String(rec.id || '').trim();
              return Boolean(lid && !deletedTaskIds.has(lid));
            });
            const merged = mergeTasksById(validLocalTasks, decodedGas.tasks);
            const hasLocalTaskMissingInGas = merged.some((mt) => {
              const mid = String(mt.id || '').trim();
              return Boolean(mid && !gasTaskIds.has(mid));
            });
            const hasDeletedTaskStillInGas = Array.from(gasTaskIds).some((gid) =>
              deletedTaskIds.has(gid)
            );
            const remoteCats =
              Array.isArray(gasData.categories) && gasData.categories.length > 0
                ? gasData.categories
                : decodedGas.categories;
            const remoteMembers =
              Array.isArray(gasData.teamMembers) && gasData.teamMembers.length > 0
                ? gasData.teamMembers
                : decodedGas.teamMembers;

            const nextCats =
              remoteCats && (!Array.isArray(state?.categories) || state.categories.length === 0)
                ? remoteCats
                : state?.categories || [];
            const nextMembers =
              remoteMembers && (!Array.isArray(state?.teamMembers) || state.teamMembers.length === 0)
                ? remoteMembers
                : state?.teamMembers || [];

            if (!state || JSON.stringify(merged) !== JSON.stringify(currentTasks)) {
              state = {
                workspaceId: state?.workspaceId || workspaceId,
                updatedAt: new Date().toISOString(),
                updatedBy: state?.updatedBy || 'Google Apps Script Sync',
                spreadsheetId: state?.spreadsheetId,
                spreadsheetUrl: state?.spreadsheetUrl,
                tasks: merged,
                categories: nextCats,
                teamMembers: nextMembers,
              };
              sharedWorkspaces.set(workspaceId, state);
              sharedWorkspaces.set('sheetcal-team-clean', state);
              sharedWorkspaces.set('team-default', state);
              savePersistedWorkspaceCache();
            }

            if (hasLocalTaskMissingInGas || hasDeletedTaskStillInGas) {
              const gasTasksWithMeta = attachGasMetadataToTasks(
                merged,
                nextCats,
                nextMembers
              );
              postToGoogleAppsScript(cleanGas, {
                action: 'sync_tasks',
                tasks: gasTasksWithMeta,
                categories: nextCats,
                teamMembers: nextMembers,
                deletedTaskIds: Array.from(deletedTaskIds),
              }).catch(() => {});
            }
          }
        }
      } catch {
        // Ignore transient GAS pull error
      }
    }

    if (!state) {
      res.json({ exists: false, workspaceId });
      return;
    }
    res.json({
      exists: true,
      workspace: state,
      deletedTaskIds: Array.from(deletedTaskIds),
    });
  });

  app.post('/api/collab/workspace/:workspaceId', (req, res) => {
    lastWorkspacePostMs = Date.now();
    const workspaceId = String(req.params.workspaceId || 'sheetcal-team-clean').trim();
    const {
      action,
      task,
      taskId,
      deletedTaskId,
      deletedTaskIds: incomingDeletedTaskIds,
      updatedBy,
      spreadsheetId,
      spreadsheetUrl,
      tasks,
      categories,
      teamMembers,
    } = req.body || {};

    const existing =
      sharedWorkspaces.get(workspaceId) ||
      sharedWorkspaces.get('sheetcal-team-clean') ||
      sharedWorkspaces.get('team-default') ||
      Array.from(sharedWorkspaces.values())[0];

    const explicitDeletedIds = new Set<string>();
    const singleDeletedId = String(
      deletedTaskId || (action === 'delete_task' ? taskId : '') || ''
    ).trim();
    if (singleDeletedId) {
      explicitDeletedIds.add(singleDeletedId);
      deletedTaskIds.add(singleDeletedId);
    }
    if (Array.isArray(incomingDeletedTaskIds)) {
      for (const rawId of incomingDeletedTaskIds) {
        const cleanId = String(rawId || '').trim();
        if (cleanId) {
          explicitDeletedIds.add(cleanId);
          deletedTaskIds.add(cleanId);
        }
      }
    }

    const existingTasks = Array.isArray(existing?.tasks)
      ? extractGasMetadataFromTasks(existing.tasks).tasks
      : [];
    const incomingTasks = Array.isArray(tasks)
      ? extractGasMetadataFromTasks(tasks).tasks
      : [];

    // Merge incoming tasks with existing server tasks so newly added tasks are never lost across tabs/devices
    let nextTasks = mergeTasksById(incomingTasks, existingTasks);

    if (action === 'add_task' && task && typeof task === 'object') {
      const rec = task as Record<string, unknown>;
      if (rec.id) deletedTaskIds.delete(String(rec.id));
      nextTasks = mergeTasksById([task, ...incomingTasks], existingTasks);
    } else if (action === 'toggle_task' && taskId) {
      nextTasks = nextTasks.map((t) => {
        const rec = t as Record<string, unknown>;
        return String(rec.id) === String(taskId)
          ? {
              ...rec,
              status: rec.status === 'completed' ? 'pending' : 'completed',
              updatedAt: new Date().toISOString(),
            }
          : rec;
      });
    }

    if (explicitDeletedIds.size > 0 || deletedTaskIds.size > 0) {
      nextTasks = nextTasks.filter((t) => {
        const tid = String((t as Record<string, unknown>).id || '').trim();
        return Boolean(tid && !explicitDeletedIds.has(tid) && !deletedTaskIds.has(tid));
      });
    }

    const nextCategories =
      Array.isArray(categories) && categories.length > 0
        ? categories
        : existing?.categories || [];
    const nextTeamMembers =
      Array.isArray(teamMembers) && teamMembers.length > 0
        ? teamMembers
        : existing?.teamMembers || [];

    const nextState: CollaborativeWorkspaceState = {
      workspaceId,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || existing?.updatedBy || 'สมาชิกในทีม',
      spreadsheetId: spreadsheetId ?? existing?.spreadsheetId,
      spreadsheetUrl: spreadsheetUrl ?? existing?.spreadsheetUrl,
      tasks: nextTasks,
      categories: nextCategories,
      teamMembers: nextTeamMembers,
    };
    sharedWorkspaces.set(workspaceId, nextState);
    sharedWorkspaces.set('sheetcal-team-clean', nextState);
    sharedWorkspaces.set('team-default', nextState);
    savePersistedWorkspaceCache();

    const cleanGas = resolveCleanGasUrl(runtimeGasUrl);
    if (cleanGas.startsWith('https://script.google.com/macros/s/')) {
      syncWorkspaceToGasSafely(cleanGas, workspaceId).catch(() => {});
    }

    res.json({
      ok: true,
      workspace: nextState,
      deletedTaskIds: Array.from(deletedTaskIds),
    });
  });

  // Server-side proxy to sync tasks between Web App and Google Apps Script (immune to browser CORS/302 issues)
  app.post('/api/line/gas-bridge-sync', async (req, res) => {
    try {
      const {
        gasUrl,
        channelAccessToken,
        tasks,
        categories,
        teamMembers,
        deletedTaskIds: incomingDeletedIds,
        mode,
      } = req.body || {};
      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      if (token) runtimeChannelAccessToken = token;

      if (Array.isArray(incomingDeletedIds)) {
        for (const rawId of incomingDeletedIds) {
          const cid = String(rawId || '').trim();
          if (cid) deletedTaskIds.add(cid);
        }
      }

      const targetGasUrl = resolveCleanGasUrl(gasUrl || runtimeGasUrl);
      runtimeGasUrl = targetGasUrl;
      savePersistedWorkspaceCache();

      if (mode === 'push' && Array.isArray(tasks)) {
        lastWorkspacePostMs = Date.now();
        const decodedIncoming = extractGasMetadataFromTasks(tasks);
        const cleanPushTasks = decodedIncoming.tasks.filter((t) => {
          const id = String(t.id || '').trim();
          return Boolean(id && !deletedTaskIds.has(id));
        });
        const existingWs =
          sharedWorkspaces.get('sheetcal-team-clean') ||
          sharedWorkspaces.get('team-default');
        const existingTasks = Array.isArray(existingWs?.tasks)
          ? extractGasMetadataFromTasks(existingWs.tasks).tasks
          : [];
        const mergedTasks = mergeTasksById(cleanPushTasks, existingTasks);
        const effectiveCats =
          Array.isArray(categories) && categories.length > 0
            ? categories
            : decodedIncoming.categories || existingWs?.categories || [];
        const effectiveMembers =
          Array.isArray(teamMembers) && teamMembers.length > 0
            ? teamMembers
            : decodedIncoming.teamMembers || existingWs?.teamMembers || [];

        const updatedWs: CollaborativeWorkspaceState = {
          workspaceId: existingWs?.workspaceId || 'sheetcal-team-clean',
          updatedAt: new Date().toISOString(),
          updatedBy: existingWs?.updatedBy || 'สมาชิกทีม',
          spreadsheetId: existingWs?.spreadsheetId,
          spreadsheetUrl: existingWs?.spreadsheetUrl,
          tasks: mergedTasks,
          categories: effectiveCats,
          teamMembers: effectiveMembers,
        };
        sharedWorkspaces.set('sheetcal-team-clean', updatedWs);
        sharedWorkspaces.set('team-default', updatedWs);
        savePersistedWorkspaceCache();

        const syncRes = await syncWorkspaceToGasSafely(targetGasUrl, 'sheetcal-team-clean');
        res.json({
          ok: Boolean(syncRes.ok),
          gasUrl: targetGasUrl,
          version: syncRes.version,
          deletedTaskIds: Array.from(deletedTaskIds),
          categories: effectiveCats,
          teamMembers: effectiveMembers,
          response: syncRes.json,
        });
        return;
      }

      const pullRes = await postToGoogleAppsScript(targetGasUrl, {
        action: 'get_tasks',
      });
      const rawRemoteTasks = Array.isArray(pullRes.json.tasks) ? pullRes.json.tasks : [];
      const decodedRemote = extractGasMetadataFromTasks(rawRemoteTasks);
      const remoteTasks = decodedRemote.tasks.filter((t) => {
        const id = String(t.id || '').trim();
        return Boolean(id && !deletedTaskIds.has(id));
      });
      const existingWs = sharedWorkspaces.get('sheetcal-team-clean');
      const effectiveCats =
        Array.isArray(existingWs?.categories) && existingWs.categories.length > 0
          ? existingWs.categories
          : decodedRemote.categories || [];
      const effectiveMembers =
        Array.isArray(existingWs?.teamMembers) && existingWs.teamMembers.length > 0
          ? existingWs.teamMembers
          : decodedRemote.teamMembers || [];

      const detectedGrp =
        typeof pullRes.json.detectedGroupId === 'string' &&
        /^[CR][0-9a-fA-F]{32}$/.test(pullRes.json.detectedGroupId.trim())
          ? pullRes.json.detectedGroupId.trim()
          : '';
      if (detectedGrp) {
        runtimeDetectedGroupId = detectedGrp;
        savePersistedWorkspaceCache();
      }

      res.json({
        ok: true,
        gasUrl: targetGasUrl,
        version: pullRes.json.version,
        detectedGroupId: detectedGrp || runtimeDetectedGroupId || undefined,
        deletedTaskIds: Array.from(deletedTaskIds),
        tasks: remoteTasks,
        categories: effectiveCats,
        teamMembers: effectiveMembers,
      });
    } catch (err: unknown) {
      res.json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Save runtime LINE OA credentials & schedule settings from the Web UI so the Webhook & 24/7 Server Scheduler work automatically
  // Also automatically unlinks/purges any lingering Messaging API Rich Menus!
  app.post('/api/line/config', (req, res) => {
    const {
      channelAccessToken,
      targetUserId,
      targetGroupId,
      gasUrl,
      enabled,
      dailyDigestEnabled,
      dailyDigestTime,
      defaultRemindMinutes,
      notifyOnOverdue,
      teamNotificationMode,
      publicCalendarUrl,
      messageFormat,
      includeDescriptionInNotification,
      includeGoogleCalendarButton,
      includeOpenAppButton,
      cardFontSize,
      cardTitleWeight,
      cardLineSpacing,
    } = req.body || {};
    if (typeof channelAccessToken === 'string') {
      runtimeChannelAccessToken = sanitizeToken(channelAccessToken);
    }
    if (typeof targetUserId === 'string') {
      const trimmedTarget = targetUserId.trim();
      runtimeDefaultUserId = trimmedTarget;
      if (/^[CR][0-9a-fA-F]{32}$/.test(trimmedTarget)) {
        runtimeDetectedGroupId = trimmedTarget;
      }
    }
    if (typeof targetGroupId === 'string' && /^[CR][0-9a-fA-F]{32}$/.test(targetGroupId.trim())) {
      runtimeDetectedGroupId = targetGroupId.trim();
    }
    if (typeof gasUrl === 'string' && gasUrl.trim()) {
      runtimeGasUrl = resolveCleanGasUrl(gasUrl);
    }
    if (typeof enabled === 'boolean') runtimeScheduleConfig.enabled = enabled;
    if (typeof dailyDigestEnabled === 'boolean')
      runtimeScheduleConfig.dailyDigestEnabled = dailyDigestEnabled;
    if (typeof dailyDigestTime === 'string' && /^\d{1,2}:\d{2}$/.test(dailyDigestTime.trim())) {
      runtimeScheduleConfig.dailyDigestTime = dailyDigestTime.trim().padStart(5, '0');
    }
    if (typeof defaultRemindMinutes === 'number')
      runtimeScheduleConfig.defaultRemindMinutes = defaultRemindMinutes;
    if (typeof notifyOnOverdue === 'boolean')
      runtimeScheduleConfig.notifyOnOverdue = notifyOnOverdue;
    if (
      teamNotificationMode === 'broadcast' ||
      teamNotificationMode === 'group' ||
      teamNotificationMode === 'both'
    ) {
      runtimeScheduleConfig.teamNotificationMode = teamNotificationMode;
    }
    if (typeof publicCalendarUrl === 'string' && publicCalendarUrl.trim()) {
      runtimeScheduleConfig.publicCalendarUrl = publicCalendarUrl.trim();
    }
    if (
      messageFormat === 'executive_flex' ||
      messageFormat === 'compact_flex' ||
      messageFormat === 'text_custom'
    ) {
      runtimeScheduleConfig.messageFormat = messageFormat;
    }
    if (typeof includeDescriptionInNotification === 'boolean')
      runtimeScheduleConfig.includeDescriptionInNotification = includeDescriptionInNotification;
    if (typeof includeGoogleCalendarButton === 'boolean')
      runtimeScheduleConfig.includeGoogleCalendarButton = includeGoogleCalendarButton;
    if (typeof includeOpenAppButton === 'boolean')
      runtimeScheduleConfig.includeOpenAppButton = includeOpenAppButton;
    if (cardFontSize === 'sm' || cardFontSize === 'md' || cardFontSize === 'lg')
      runtimeScheduleConfig.cardFontSize = cardFontSize;
    if (cardTitleWeight === 'bold' || cardTitleWeight === 'regular')
      runtimeScheduleConfig.cardTitleWeight = cardTitleWeight;
    if (
      cardLineSpacing === 'tight' ||
      cardLineSpacing === 'normal' ||
      cardLineSpacing === 'relaxed'
    )
      runtimeScheduleConfig.cardLineSpacing = cardLineSpacing;

    savePersistedWorkspaceCache();
    if (runtimeChannelAccessToken) {
      purgeAllLineRichMenus(runtimeChannelAccessToken, runtimeDefaultUserId).catch(() => {});
    }
    res.json({
      ok: true,
      detectedGroupId: runtimeDetectedGroupId || undefined,
      detectedUserId: runtimeDefaultUserId || undefined,
      scheduleConfig: runtimeScheduleConfig,
    });
  });

  // Explicit endpoint to clear/delete all Rich Menus from the user's LINE Official Account
  app.post('/api/line/richmenu/clear', async (req, res) => {
    const { channelAccessToken, targetUserId } = req.body || {};
    const result = await purgeAllLineRichMenus(
      channelAccessToken || runtimeChannelAccessToken,
      targetUserId || runtimeDefaultUserId
    );
    res.status(200).json(result);
  });

  app.delete('/api/line/richmenu', async (req, res) => {
    const { channelAccessToken, targetUserId } = req.body || {};
    const result = await purgeAllLineRichMenus(
      channelAccessToken || runtimeChannelAccessToken,
      targetUserId || runtimeDefaultUserId
    );
    res.status(200).json(result);
  });

  const processedWebhookEventIds = new Set<string>();

  // Real LINE Official Account Webhook Endpoint (supports 1-on-1 AND Group Chat Format 2)
  app.post('/api/line/webhook', async (req, res) => {
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [];

      if (events.length === 0) {
        res.status(200).json({ status: 'verified' });
        return;
      }

      const rawEnvAppUrl = (process.env.APP_URL || '').trim();
      const appUrl =
        rawEnvAppUrl &&
        rawEnvAppUrl.startsWith('http') &&
        !/^https:\/\/ais-(dev|pre)-/i.test(rawEnvAppUrl)
          ? rawEnvAppUrl
          : 'https://naiadminna.github.io/Lakha/?section=calendar&openExternalBrowser=1';

      for (const event of events) {
        // Deduplicate LINE Webhook deliveries (prevents double task creation on webhook retries)
        const eventKey = String(
          event.webhookEventId || event.message?.id || ''
        ).trim();
        if (eventKey) {
          if (processedWebhookEventIds.has(eventKey)) {
            continue;
          }
          processedWebhookEventIds.add(eventKey);
          if (processedWebhookEventIds.size > 1000) {
            const oldest = processedWebhookEventIds.values().next().value;
            if (oldest) processedWebhookEventIds.delete(oldest);
          }
        }

        const senderGroupId = String(
          event.source?.groupId || event.source?.roomId || ''
        ).trim();
        const senderUserId = String(event.source?.userId || '').trim();

        if (senderGroupId) {
          runtimeDetectedGroupId = senderGroupId;
          runtimeDefaultUserId = senderGroupId;
          savePersistedWorkspaceCache();
        } else if (senderUserId && !runtimeDefaultUserId) {
          runtimeDefaultUserId = senderUserId;
          savePersistedWorkspaceCache();
        }

        if (runtimeChannelAccessToken && senderUserId) {
          purgeAllLineRichMenus(runtimeChannelAccessToken, senderUserId).catch(() => {});
        }

        // Case A: Bot is invited to a LINE Group Chat or Multi-person Room (event.type === 'join')
        if ((event.type === 'join' || event.type === 'memberJoined') && senderGroupId) {
          if (runtimeChannelAccessToken && event.replyToken) {
            const joinFlex = {
              type: 'flex',
              altText: `✅ เชื่อมต่อห้องแชทกลุ่ม LINE ของทีมสำเร็จ! Group ID: ${senderGroupId}`,
              contents: {
                type: 'bubble',
                size: 'mega',
                header: {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#06C755',
                  paddingAll: '16px',
                  contents: [
                    {
                      type: 'text',
                      text: '👥 TEAM LINE GROUP CONNECTED',
                      color: '#FFFFFF',
                      size: 'xxs',
                      weight: 'bold',
                    },
                    {
                      type: 'text',
                      text: 'เชื่อมต่อกลุ่ม LINE ของทีมสำเร็จ!',
                      color: '#FFFFFF',
                      size: 'lg',
                      weight: 'bold',
                      margin: 'xs',
                      wrap: true,
                    },
                  ],
                },
                body: {
                  type: 'box',
                  layout: 'vertical',
                  paddingAll: '16px',
                  spacing: 'sm',
                  contents: [
                    {
                      type: 'text',
                      text: 'ระบบบันทึก Group ID ของห้องแชทกลุ่มนี้สำหรับ "รูปแบบที่ 2: แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม" เรียบร้อยแล้ว',
                      size: 'xs',
                      color: '#334155',
                      wrap: true,
                    },
                    {
                      type: 'box',
                      layout: 'vertical',
                      backgroundColor: '#F1F5F9',
                      cornerRadius: '8px',
                      paddingAll: '10px',
                      margin: 'sm',
                      contents: [
                        {
                          type: 'text',
                          text: '🔑 รหัสกลุ่ม (LINE Group ID):',
                          size: 'xxs',
                          weight: 'bold',
                          color: '#475569',
                        },
                        {
                          type: 'text',
                          text: senderGroupId,
                          size: 'xs',
                          weight: 'bold',
                          color: '#0F172A',
                          wrap: true,
                          margin: 'xs',
                        },
                      ],
                    },
                    {
                      type: 'text',
                      text: '💡 พิมพ์สั่งเพิ่มงานในกลุ่มโดยขึ้นต้นด้วยคำว่า "เพิ่มงาน" หรือ "นัดหมาย" เช่น "เพิ่มงาน ประชุมทีม พรุ่งนี้ 10:00 #สูง" หรือพิมพ์ "สรุปงานวันนี้"',
                      size: 'xxs',
                      color: '#059669',
                      wrap: true,
                      margin: 'sm',
                    },
                  ],
                },
              },
            };

            await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtimeChannelAccessToken}`,
              },
              body: JSON.stringify({
                replyToken: event.replyToken,
                messages: [joinFlex],
              }),
            }).catch(() => {});
          }
          continue;
        }

        // Case B: Text message in 1-on-1 chat or Group Chat
        if (event.type === 'message' && event.message?.type === 'text') {
          const userText = String(event.message.text || '').trim();
          if (!userText) continue;
          const lowerText = userText.toLowerCase();

          // Special command to check/link Group ID in LINE Group Chat
          if (
            lowerText.includes('เชื่อมกลุ่ม') ||
            lowerText.includes('รหัสกลุ่ม') ||
            lowerText.includes('เช็คกลุ่ม') ||
            lowerText.includes('เช็ครหัส') ||
            lowerText.includes('groupid') ||
            lowerText.includes('group id')
          ) {
            if (runtimeChannelAccessToken && event.replyToken) {
              const idToShow = senderGroupId || senderUserId || 'ไม่พบรหัส';
              const isGroup = Boolean(senderGroupId);
              await fetch('https://api.line.me/v2/bot/message/reply', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${runtimeChannelAccessToken}`,
                },
                body: JSON.stringify({
                  replyToken: event.replyToken,
                  messages: [
                    {
                      type: 'text',
                      text: isGroup
                        ? `✅ เชื่อมต่อห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2) สำเร็จแล้ว!\n\n🔑 รหัส Group ID ของกลุ่มนี้คือ:\n${senderGroupId}\n\n(ระบบได้ส่งรหัส Group ID นี้ไปยังหน้าเว็บอัตโนมัติแล้ว หรือคุณสามารถคัดลอกรหัส C... ด้านบนไปวางในช่อง LINE Group ID บนหน้าเว็บได้เลยครับ)`
                        : `ℹ️ ขณะนี้คุณพิมพ์อยู่ในแชทส่วนตัว (1-on-1)\n🔑 รหัส User ID ของคุณคือ:\n${idToShow}\n\n💡 หากต้องการใช้ "รูปแบบที่ 2: แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม" กรุณาเชิญบอทเข้ากลุ่ม LINE ของทีม แล้วพิมพ์คำว่า "เชื่อมกลุ่ม" ในห้องแชทกลุ่มครับ`,
                    },
                  ],
                }),
              }).catch(() => {});
            }
            continue;
          }

          // Server-side Summary Query handling (works 24/7 even with 0 browser tabs open, and never creates a fake task)
          const isSummaryCommand =
            userText === 'สรุปงานตามเวลา' ||
            userText === 'เช็คเวลางาน' ||
            userText === 'สรุปงานวันนี้' ||
            userText === 'งานวันนี้' ||
            userText === 'งานพรุ่งนี้' ||
            userText === 'สรุปงานพรุ่งนี้' ||
            userText === 'งานมะรืน' ||
            userText === 'สรุปงานมะรืน' ||
            userText === 'สรุปงาน' ||
            userText === 'งานค้าง' ||
            /^(สรุปงานตามเวลา|เช็คเวลางาน|สรุปงานวันนี้|สรุปงาน|ดูงานวันที่|งานวันที่|ตารางงานวันที่|เช็คงานวันที่)\s*(.+)$/i.test(
              userText
            );

          if (isSummaryCommand) {
            if (runtimeChannelAccessToken && event.replyToken) {
              const { todayYMD } = getBangkokNowYMDAndHM();
              const queryDate = extractThaiDate(userText).dateStr || todayYMD;
              const ws =
                sharedWorkspaces.get('sheetcal-team-clean') ||
                sharedWorkspaces.get('team-default') ||
                Array.from(sharedWorkspaces.values())[0];
              const wsTasks = Array.isArray(ws?.tasks) ? ws.tasks : [];
              const wsCats = Array.isArray(ws?.categories)
                ? (ws.categories as Record<string, unknown>[])
                : [];
              const catMap = new Map<string, { name: string; color: string }>();
              for (const c of wsCats) {
                if (c && typeof c === 'object' && c.id) {
                  catMap.set(String(c.id), {
                    name: String(c.name || 'ทั่วไป'),
                    color: String(c.color || '#2563EB'),
                  });
                }
              }

              const matchingDigestItems: DigestTaskItem[] = [];
              for (const rawT of wsTasks) {
                if (!rawT || typeof rawT !== 'object') continue;
                const t = rawT as Record<string, unknown>;
                const tid = String(t.id || '').trim();
                if (!tid || deletedTaskIds.has(tid)) continue;
                const tDate = String(t.date || '').slice(0, 10);
                const tEnd = String(t.endDate || tDate).slice(0, 10);
                const statusVal = String(t.status || 'pending') as
                  | 'pending'
                  | 'in_progress'
                  | 'completed';
                const matches =
                  userText === 'งานค้าง'
                    ? statusVal !== 'completed'
                    : tDate <= queryDate && tEnd >= queryDate;
                if (!matches) continue;
                const catInfo = catMap.get(String(t.categoryId || ''));
                matchingDigestItems.push({
                  title: String(t.title || 'งาน'),
                  date: tDate,
                  endDate: t.endDate ? String(t.endDate).slice(0, 10) : undefined,
                  time: String(t.time || '09:00').slice(0, 5),
                  categoryName: catInfo?.name || 'ทั่วไป',
                  categoryColor: catInfo?.color || '#2563EB',
                  priority: (String(t.priority || 'medium') as 'low' | 'medium' | 'high'),
                  status: statusVal,
                  description: String(t.description || ''),
                  assigneeName: t.assigneeName ? String(t.assigneeName) : undefined,
                });
              }

              const digestFlex = buildDailyDigestFlexMessage(
                queryDate,
                matchingDigestItems,
                appUrl
              );
              await fetch('https://api.line.me/v2/bot/message/reply', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${runtimeChannelAccessToken}`,
                },
                body: JSON.stringify({
                  replyToken: event.replyToken,
                  messages: [digestFlex],
                }),
              }).catch(() => {});
            }
            continue;
          }

          // In LINE Group Chats, require an explicit task command keyword so casual group chat messages don't become bogus tasks
          if (
            senderGroupId &&
            !/^(?:@[^\s]+\s*)?(?:น้องเลขา\s*[:：-]?\s*)?(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\b/i.test(
              userText
            )
          ) {
            continue;
          }

          // Server-Authoritative Task Creation: persist directly on the server & GAS once (never via client browser polling!)
          const { todayYMD: todayStr } = getBangkokNowYMDAndHM();
          const strippedPrefix = userText
            .replace(/^(?:@[^\s]+\s*)?(?:น้องเลขา\s*[:：-]?\s*)?/i, '')
            .replace(
              /^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\s*[:：-]?\s*/i,
              ''
            )
            .trim();
          const dateResult = extractThaiDate(strippedPrefix);
          const timeResult = extractThaiTime(dateResult.cleanedText);
          const parsedTitle =
            timeResult.cleanedText
              .replace(/#(สูง|ด่วนมาก|ด่วน|high|ต่ำ|low|กลาง|ทั่วไป|medium)/gi, ' ')
              .replace(/\b(เวลา|วันที่|ตอน|น\.|ของ)\b/g, ' ')
              .replace(/\s+/g, ' ')
              .trim() ||
            strippedPrefix ||
            userText;
          const resolvedDate = dateResult.dateStr || todayStr;
          const resolvedTime = timeResult.timeStr || '09:00';
          const resolvedPriority =
            /#(สูง|ด่วนมาก|ด่วน|high)/i.test(userText)
              ? 'high'
              : /#(ต่ำ|low)/i.test(userText)
              ? 'low'
              : 'medium';
          const resolvedEndDate =
            dateResult.endDateStr ||
            inferTaskEndDate({
              date: resolvedDate,
              title: parsedTitle,
              description: userText,
            });

          const newServerTask: Record<string, unknown> = {
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: parsedTitle,
            description: senderGroupId
              ? `บันทึกผ่านห้องแชทกลุ่ม LINE ("${userText}")`
              : `บันทึกผ่านแชท LINE OA ("${userText}")`,
            date: resolvedDate,
            ...(resolvedEndDate && resolvedEndDate > resolvedDate
              ? { endDate: resolvedEndDate }
              : {}),
            time: resolvedTime,
            categoryId: 'cat-work',
            priority: resolvedPriority,
            status: 'pending',
            remindMinutesBefore: runtimeScheduleConfig.defaultRemindMinutes || 1,
            lineNotified: false,
            source: 'line',
            updatedAt: new Date().toISOString(),
          };

          const existingWs =
            sharedWorkspaces.get('sheetcal-team-clean') ||
            sharedWorkspaces.get('team-default') ||
            Array.from(sharedWorkspaces.values())[0];
          const existingTasks = Array.isArray(existingWs?.tasks)
            ? extractGasMetadataFromTasks(existingWs.tasks).tasks
            : [];
          const nextTasks = mergeTasksById([newServerTask], existingTasks);
          const nextWsState: CollaborativeWorkspaceState = {
            workspaceId: existingWs?.workspaceId || 'sheetcal-team-clean',
            updatedAt: new Date().toISOString(),
            updatedBy: senderGroupId ? 'สมาชิกกลุ่ม LINE' : 'LINE OA Webhook',
            spreadsheetId: existingWs?.spreadsheetId,
            spreadsheetUrl: existingWs?.spreadsheetUrl,
            tasks: nextTasks,
            categories: existingWs?.categories || [],
            teamMembers: existingWs?.teamMembers || [],
          };
          sharedWorkspaces.set('sheetcal-team-clean', nextWsState);
          sharedWorkspaces.set('team-default', nextWsState);
          savePersistedWorkspaceCache();

          const cleanGas = resolveCleanGasUrl(runtimeGasUrl);
          if (cleanGas.startsWith('https://script.google.com/macros/s/')) {
            syncWorkspaceToGasSafely(cleanGas, 'sheetcal-team-clean').catch(() => {});
          }

          if (runtimeChannelAccessToken && event.replyToken) {
            const dateLabelForCard = formatTaskDateRangeLabel({
              date: resolvedDate,
              endDate: resolvedEndDate,
            });
            const flexReply = buildSingleTaskReminderFlexMessage({
              taskTitle: parsedTitle,
              description: senderGroupId
                ? `บันทึกลงปฏิทินทีมเรียบร้อยแล้ว (${dateLabelForCard})`
                : 'บันทึกลงปฏิทินระบบน้องเลขา และซิงค์เข้า Google Sheets เรียบร้อยแล้ว',
              date: resolvedDate,
              time: resolvedTime,
              categoryName: senderGroupId ? 'งานกลุ่ม LINE ของทีม' : 'บันทึกผ่านแชท LINE OA',
              categoryColor: '#06C755',
              priority: resolvedPriority,
              appUrl,
            });

            await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtimeChannelAccessToken}`,
              },
              body: JSON.stringify({
                replyToken: event.replyToken,
                messages: [flexReply],
              }),
            }).catch(() => {});
          }
        }
      }

      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(200).json({ status: 'ok' });
    }
  });

  // Server-side Internet Standard Time endpoint (queries upstream HTTPS time authorities with RTT/2 latency compensation)
  let serverSyncedEpochMs: number | null = null;
  let serverSyncedMonoMs = 0;
  let serverLastSyncedAt = 0;

  async function resolveUpstreamInternetEpochMs(): Promise<{ epochMs: number; source: string }> {
    const nowMono = performance.now();
    if (serverSyncedEpochMs !== null && nowMono - serverLastSyncedAt < 60_000) {
      return {
        epochMs: Math.round(serverSyncedEpochMs + (nowMono - serverSyncedMonoMs)),
        source: 'internet_cached',
      };
    }

    // Primary: TimeAPI.io (millisecond precision in Asia/Bangkok)
    try {
      const t0 = performance.now();
      const res = await fetch(
        'https://timeapi.io/api/time/current/zone?timeZone=Asia%2FBangkok',
        { signal: AbortSignal.timeout(2500) }
      );
      const t1 = performance.now();
      if (res.ok) {
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
          const utcMs =
            Date.UTC(
              data.year,
              data.month - 1,
              data.day,
              data.hour - 7,
              data.minute,
              data.seconds,
              typeof data.milliSeconds === 'number' ? data.milliSeconds : 0
            ) +
            (t1 - t0) / 2;
          serverSyncedEpochMs = utcMs;
          serverSyncedMonoMs = t1;
          serverLastSyncedAt = t1;
          return { epochMs: Math.round(utcMs), source: 'timeapi.io' };
        }
      }
    } catch {
      // Fallback to Cloudflare edge timestamp
    }

    // Secondary: Cloudflare global edge trace timestamp
    try {
      const t0 = performance.now();
      const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        signal: AbortSignal.timeout(2500),
      });
      const t1 = performance.now();
      if (res.ok) {
        const text = await res.text();
        const match = text.match(/^ts=(\d+(?:\.\d+)?)/m);
        if (match && match[1]) {
          const utcMs = parseFloat(match[1]) * 1000 + (t1 - t0) / 2;
          serverSyncedEpochMs = utcMs;
          serverSyncedMonoMs = t1;
          serverLastSyncedAt = t1;
          return { epochMs: Math.round(utcMs), source: 'cloudflare_edge' };
        }
      }
    } catch {
      // Fallback to Cloud NTP clock
    }

    return { epochMs: Date.now(), source: 'cloud_ntp' };
  }

  app.get('/api/time', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const synced = await resolveUpstreamInternetEpochMs();
    res.json({
      epochMs: synced.epochMs,
      iso: new Date(synced.epochMs).toISOString(),
      source: synced.source,
    });
  });

  // Poll endpoint for the Web App to consume real LINE Webhook messages & detected Group ID
  app.get('/api/line/webhook-events', (_req, res) => {
    const items = pendingWebhookMessages.splice(0, pendingWebhookMessages.length);
    res.json({
      events: items,
      detectedUserId: runtimeDefaultUserId || undefined,
      detectedGroupId: runtimeDetectedGroupId || undefined,
    });
  });

  // Server-side proxy to send rich LINE Official Account Flex Messages or Custom Text (Push to Group/User or Broadcast)
  app.post('/api/line/push', async (req, res) => {
    try {
      const {
        channelAccessToken,
        to,
        targetGroupId,
        teamNotificationMode,
        text,
        taskTitle,
        description,
        date,
        time,
        dateTime,
        categoryName,
        categoryColor,
        priority,
        tasksList,
        stats,
        originUrl,
        messageFormat,
        includeDescription,
        includeGoogleCalendarButton,
        includeOpenAppButton,
        cardFontSize,
        cardTitleWeight,
        cardLineSpacing,
      } = req.body || {};

      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      const rawTo = String(to || '').trim();
      const rawGroupId = String(targetGroupId || '').trim();

      const effectiveGroupId = /^[CR][0-9a-fA-F]{32}$/.test(rawGroupId)
        ? rawGroupId
        : /^[CR][0-9a-fA-F]{32}$/.test(rawTo)
        ? rawTo
        : /^[CR][0-9a-fA-F]{32}$/.test(runtimeDetectedGroupId)
        ? runtimeDetectedGroupId
        : '';

      const effectiveUserId = /^U[0-9a-fA-F]{32}$/.test(rawTo)
        ? rawTo
        : /^U[0-9a-fA-F]{32}$/.test(runtimeDefaultUserId)
        ? runtimeDefaultUserId
        : '';

      if (token) runtimeChannelAccessToken = token;
      if (effectiveGroupId) runtimeDetectedGroupId = effectiveGroupId;
      if (rawTo) runtimeDefaultUserId = rawTo;

      if (!token) {
        res.status(200).json({
          ok: false,
          simulated: true,
          message:
            'แสดงการ์ดแจ้งเตือนและสรุปงานบนห้องแชท LINE OA หน้าเว็บเรียบร้อยแล้ว! (หากต้องการให้เด้งเข้าแอป LINE ในมือถือจริง กรุณาวาง LINE Channel Access Token ในช่องตั้งค่า)',
        });
        return;
      }

      // Automatically clean up any lingering Messaging API Rich Menu in the background
      purgeAllLineRichMenus(token, effectiveUserId || rawTo).catch(() => {});

      const defaultPublicAppUrl =
        'https://naiadminna.github.io/Lakha/?section=calendar&workspace=sheetcal-team-clean&sheet=1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc&gas=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FAKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg%2Fexec&openExternalBrowser=1';
      const refererHeader = String(req.headers.origin || req.headers.referer || '').trim();
      const rawAppUrl =
        originUrl && String(originUrl).startsWith('https://')
          ? String(originUrl)
          : refererHeader.startsWith('https://')
          ? refererHeader
          : process.env.APP_URL && process.env.APP_URL.startsWith('https://')
          ? process.env.APP_URL
          : defaultPublicAppUrl;
      const isBlockedUrl =
        /^https:\/\/ais-(dev|pre)-/i.test(rawAppUrl) ||
        rawAppUrl.includes('docs.google.com/spreadsheets') ||
        rawAppUrl.includes('AKfycby0gvQ') ||
        rawAppUrl.includes('AKfycbxIf9k');
      const appUrl = isBlockedUrl ? defaultPublicAppUrl : rawAppUrl;

      const { todayYMD: bangkokTodayStr } = getBangkokNowYMDAndHM();
      if (req.body?.isMorningDigest) {
        lastMorningDigestSentDate = bangkokTodayStr;
        savePersistedWorkspaceCache();
      }
      let flexMessage: unknown;
      if (Array.isArray(tasksList)) {
        flexMessage = buildDailyDigestFlexMessage(
          date || dateTime || bangkokTodayStr,
          tasksList,
          appUrl
        );
      } else if (messageFormat === 'text_custom' && !taskTitle) {
        flexMessage = {
          type: 'text',
          text: text || 'ข้อความแจ้งเตือนจากระบบน้องเลขา LINE OA',
        };
      } else if (taskTitle) {
        flexMessage = buildSingleTaskReminderFlexMessage({
          taskTitle,
          description: description || text,
          date:
            date ||
            (dateTime ? String(dateTime).slice(0, 10) : bangkokTodayStr),
          time: time || '09:00',
          categoryName: categoryName || 'ทั่วไป',
          categoryColor: categoryColor || '#4F46E5',
          priority: priority || 'medium',
          appUrl,
          messageFormat: messageFormat === 'compact_flex' ? 'compact_flex' : 'executive_flex',
          includeDescription,
          includeGoogleCalendarButton,
          includeOpenAppButton,
          cardFontSize,
          cardTitleWeight,
          cardLineSpacing,
          stats,
        });
      } else {
        flexMessage = {
          type: 'text',
          text: text || 'ข้อความแจ้งเตือนจากระบบน้องเลขา LINE OA',
        };
      }

      const fallbackTextMessage = {
        type: 'text',
        text:
          text ||
          (taskTitle
            ? `🔔 แจ้งเตือนงาน: ${taskTitle}\n🗓️ วันที่: ${date || ''} เวลา ${time || ''} น.\n${description || ''}`
            : 'ข้อความแจ้งเตือนจากระบบน้องเลขา LINE OA'),
      };

      const messages = [flexMessage];
      const mode: 'broadcast' | 'group' | 'both' =
        teamNotificationMode === 'group' || teamNotificationMode === 'broadcast'
          ? teamNotificationMode
          : 'both';

      let sentToGroupOk = false;
      let groupErrorDetail = '';

      // 1. Send to LINE Group Chat (Format 2: Group ID C... or Room ID R...) if configured/detected
      if (effectiveGroupId && (mode === 'group' || mode === 'both')) {
        const groupPushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: effectiveGroupId,
            messages,
          }),
        });

        if (groupPushRes.ok) {
          sentToGroupOk = true;
        } else {
          const groupErrJson = await groupPushRes.json().catch(() => ({}));
          groupErrorDetail = groupErrJson?.message || `HTTP ${groupPushRes.status}`;

          // Fallback plain text to Group Chat
          const groupTextRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              to: effectiveGroupId,
              messages: [fallbackTextMessage],
            }),
          });
          if (groupTextRes.ok) {
            sentToGroupOk = true;
          }
        }

        if (sentToGroupOk && mode === 'group') {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: 'group_push',
            detectedGroupId: effectiveGroupId,
            message: `ส่งการ์ดแจ้งเตือนเข้า "ห้องแชทกลุ่ม LINE ของทีม" (Group ID: ${effectiveGroupId.slice(
              0,
              8
            )}...) สำเร็จแล้ว!`,
          });
          return;
        }
      }

      // 2. Send to specific 1-on-1 User ID (U...) if specified and not purely broadcast
      let pushErrorDetail = groupErrorDetail;
      if (effectiveUserId && mode !== 'group') {
        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: effectiveUserId,
            messages,
          }),
        });

        if (pushRes.ok) {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: sentToGroupOk ? 'group_and_user_push' : 'push',
            detectedGroupId: effectiveGroupId || undefined,
            message: sentToGroupOk
              ? `ส่งการ์ดแจ้งเตือนเข้าทั้ง "ห้องแชทกลุ่ม LINE ของทีม" (${effectiveGroupId.slice(
                  0,
                  8
                )}...) และแชทส่วนตัวสำเร็จแล้ว!`
              : `ส่งการ์ดแจ้งเตือนเข้าแอป LINE Official Account (Push ไปยัง ${effectiveUserId.slice(
                  0,
                  8
                )}...) สำเร็จแล้ว!`,
          });
          return;
        }

        const pushErrJson = await pushRes.json().catch(() => ({}));
        pushErrorDetail = pushErrJson?.message || `HTTP ${pushRes.status}`;

        // Retry Push with plain text in case Flex JSON had any issue
        const pushTextRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: effectiveUserId,
            messages: [fallbackTextMessage],
          }),
        });

        if (pushTextRes.ok) {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: 'push_text',
            detectedGroupId: effectiveGroupId || undefined,
            message: `ส่งข้อความแจ้งเตือนเข้าแอป LINE Official Account สำเร็จแล้ว!`,
          });
          return;
        }
      }

      // 3. Fallback / Format 1: Broadcast API (sends to all 1-on-1 friends of the LINE OA)
      const broadcastRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages,
        }),
      });

      if (!broadcastRes.ok) {
        const errData = await broadcastRes.json().catch(() => ({}));
        const broadcastTextRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: [fallbackTextMessage],
          }),
        });

        if (broadcastTextRes.ok) {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: sentToGroupOk ? 'group_and_broadcast_text' : 'broadcast_text',
            detectedGroupId: effectiveGroupId || undefined,
            message: sentToGroupOk
              ? `ส่งแจ้งเตือนเข้าทั้ง "ห้องแชทกลุ่ม LINE ของทีม" (${effectiveGroupId.slice(
                  0,
                  8
                )}...) และแชทส่วนตัวทุกคน (Broadcast) สำเร็จแล้ว!`
              : 'ส่งข้อความแจ้งเตือนเข้าแอป LINE (Broadcast) สำเร็จแล้ว!',
          });
          return;
        }

        if (sentToGroupOk) {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: 'group_push',
            detectedGroupId: effectiveGroupId,
            message: `ส่งการ์ดแจ้งเตือนเข้า "ห้องแชทกลุ่ม LINE ของทีม" (${effectiveGroupId.slice(
              0,
              8
            )}...) สำเร็จแล้ว!`,
          });
          return;
        }

        res.status(200).json({
          ok: false,
          simulated: true,
          message: `ไม่สามารถส่งผ่าน LINE API ได้ (${
            pushErrorDetail || errData?.message || `HTTP ${broadcastRes.status}`
          }) — กรุณาตรวจสอบ Token หรือเชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์ "เชื่อมกลุ่ม"`,
        });
        return;
      }

      const missingGroupNotice =
        mode === 'group' && !effectiveGroupId
          ? ' (⚠️ หมายเหตุ: ขณะนี้ส่งเข้าแชทส่วนตัวแบบ Broadcast แทน เนื่องจากยังไม่ได้ผูก Group ID C... ของห้องแชทกลุ่ม — กรุณาเชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์คำว่า "เชื่อมกลุ่ม" ในกลุ่ม 1 ครั้ง)'
          : '';

      res.status(200).json({
        ok: true,
        simulated: false,
        mode: sentToGroupOk ? 'group_and_broadcast' : 'broadcast',
        detectedGroupId: effectiveGroupId || undefined,
        message: sentToGroupOk
          ? `ส่งการ์ดแจ้งเตือนเข้าทั้ง "ห้องแชทกลุ่ม LINE ของทีม" (${effectiveGroupId.slice(
              0,
              8
            )}...) และแชทส่วนตัวของสมาชิกทุกคนสำเร็จแล้ว!`
          : `ส่งการ์ดแจ้งเตือน Flex Message เข้าแอป LINE สำเร็จแล้ว!${missingGroupNotice}`,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      res.status(200).json({
        ok: false,
        simulated: true,
        message: `บันทึกข้อความทดสอบในห้องแชทจำลองแล้ว (หมายเหตุการเชื่อมต่อ LINE API: ${msg})`,
      });
    }
  });

  /**
   * Diagnose LINE Channel Access Token, Bot Info, User ID / Group ID format, and test delivery
   */
  app.post('/api/line/diagnose', async (req, res) => {
    try {
      const { channelAccessToken, targetUserId, targetGroupId, sendTest } = req.body || {};
      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      const rawUserId = String(targetUserId || '').trim();
      const rawGroupId = String(
        targetGroupId ||
          (/^[CR][0-9a-fA-F]{32}$/.test(rawUserId) ? rawUserId : '') ||
          runtimeDetectedGroupId ||
          ''
      ).trim();

      const steps: {
        step: string;
        status: 'ok' | 'warn' | 'error';
        detail: string;
      }[] = [];

      if (!token) {
        res.status(200).json({
          ok: false,
          steps: [
            {
              step: '1. ตรวจสอบ LINE Channel Access Token',
              status: 'error',
              detail:
                'ยังไม่ได้ระบุ LINE Channel Access Token กรุณานำ Token (Long-lived) จาก LINE Developers Console > Messaging API มาวาง',
            },
          ],
        });
        return;
      }

      // Step 1: Verify Bot Info via GET https://api.line.me/v2/bot/info
      const botInfoRes = await fetch('https://api.line.me/v2/bot/info', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!botInfoRes.ok) {
        const errBody = await botInfoRes.json().catch(() => ({}));
        steps.push({
          step: '1. ตรวจสอบ LINE Channel Access Token',
          status: 'error',
          detail: `Token ไม่ถูกต้องหรือหมดอายุ (${
            errBody?.message || `HTTP ${botInfoRes.status}`
          }) — กรุณาไปที่ LINE Developers Console > เลือก Channel แบบ Messaging API > ออก Channel access token (long-lived) ใหม่`,
        });
        res.status(200).json({ ok: false, steps });
        return;
      }

      const botInfo = (await botInfoRes.json()) as {
        displayName?: string;
        basicId?: string;
        userId?: string;
        chatMode?: string;
      };

      steps.push({
        step: '1. ตรวจสอบ LINE Channel Access Token',
        status: 'ok',
        detail: `เชื่อมต่อสำเร็จ! ชื่อบอท LINE OA: "${
          botInfo.displayName || 'ไม่ระบุ'
        }" (LINE ID บอท: ${botInfo.basicId || '-'})`,
      });

      // Step 2: Check Group ID (Format 2: Team Group Chat) & User ID (Format 1: Broadcast / 1-on-1)
      const isValidGroup = /^[CR][0-9a-fA-F]{32}$/.test(rawGroupId);
      if (isValidGroup) {
        const groupSummaryRes = await fetch(
          `https://api.line.me/v2/bot/group/${rawGroupId}/summary`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }
        ).catch(() => null);

        if (groupSummaryRes && groupSummaryRes.ok) {
          const groupSummary = (await groupSummaryRes.json().catch(() => ({}))) as {
            groupName?: string;
          };
          steps.push({
            step: '2. ตรวจสอบห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat)',
            status: 'ok',
            detail: `เชื่อมต่อกลุ่ม LINE "${
              groupSummary.groupName || rawGroupId
            }" (รหัสกลุ่ม: ${rawGroupId}) สำเร็จ! บอทอยู่ในกลุ่มพร้อมส่งแจ้งเตือนรวมให้สมาชิกทั้งทีม`,
          });
        } else {
          steps.push({
            step: '2. ตรวจสอบห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat)',
            status: 'warn',
            detail: `พบรหัสกลุ่ม ${rawGroupId} แต่บอทยังไม่ได้อยู่ในกลุ่มนี้ หรือถูกเตะออกจากกลุ่ม — กรุณาเชิญบอท "${
              botInfo.displayName || ''
            }" (${botInfo.basicId || ''}) เข้ากลุ่ม LINE อีกครั้ง`,
          });
        }
      } else {
        steps.push({
          step: '2. สถานะห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2: Group Chat)',
          status: 'warn',
          detail: `ยังไม่ได้ผูก Group ID (รหัส C... 33 ตัวอักษร) — 💡 สำคัญ: การส่งแบบ Broadcast ของ LINE จะส่งเข้าเฉพาะ "แชทส่วนตัว (1-on-1)" เท่านั้น ไม่สามารถส่งเข้ากลุ่มอัตโนมัติได้หากไม่มี Group ID! วิธีผูกกลุ่ม: 1) เปิดอนุญาตให้บอทเข้ากลุ่มใน manager.line.biz 2) เชิญบอท ${
            botInfo.basicId || ''
          } เข้ากลุ่ม LINE 3) พิมพ์คำว่า "เชื่อมกลุ่ม" ในกลุ่ม LINE แล้วกดปุ่ม "ดึงรหัสกลุ่ม C... อัตโนมัติ"`,
        });
      }

      // Step 3: Send actual test message if requested
      if (sendTest) {
        const testMsg = {
          type: 'text',
          text: `✅ [ระบบน้องเลขา Diagnostic]\nทดสอบการเชื่อมต่อแจ้งเตือนสำเร็จ!\n🤖 บอท: ${
            botInfo.displayName || 'LINE OA'
          } (${botInfo.basicId || ''})\n⏰ เวลาทดสอบ: ${new Date().toLocaleTimeString('th-TH')} น.`,
        };

        let sentOk = false;

        if (isValidGroup) {
          const groupPushRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              to: rawGroupId,
              messages: [testMsg],
            }),
          });
          if (groupPushRes.ok) {
            sentOk = true;
            steps.push({
              step: '3. ทดสอบยิงข้อความเข้า "ห้องแชทกลุ่ม LINE ของทีม" (Group Push)',
              status: 'ok',
              detail: `ส่งข้อความเข้าห้องแชทกลุ่ม LINE (${rawGroupId.slice(
                0,
                10
              )}...) สำเร็จแล้ว! สมาชิกทุกคนในกลุ่มเห็นข้อความพร้อมกันทันที`,
            });
          } else {
            const grpErr = await groupPushRes.json().catch(() => ({}));
            steps.push({
              step: '3. ทดสอบยิงข้อความเข้า "ห้องแชทกลุ่ม LINE ของทีม"',
              status: 'error',
              detail: `ส่งเข้ากลุ่ม ${rawGroupId.slice(0, 10)}... ไม่สำเร็จ (${
                grpErr?.message || `HTTP ${groupPushRes.status}`
              }) กรุณาตรวจสอบว่าบอทยังอยู่ในกลุ่ม LINE นี้`,
            });
          }
        }

        const isValidUser = /^U[0-9a-fA-F]{32}$/.test(rawUserId);
        if (isValidUser) {
          const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              to: rawUserId,
              messages: [testMsg],
            }),
          });

          if (pushRes.ok) {
            sentOk = true;
            steps.push({
              step: '3. ทดสอบส่งข้อความเข้าแชทส่วนตัว (Push API)',
              status: 'ok',
              detail: `ส่งข้อความเข้าแชทส่วนตัวสำเร็จแล้ว! กรุณาเช็กข้อความในแชทบอท "${
                botInfo.displayName || ''
              }"`,
            });
          }
        }

        if (!sentOk) {
          const bcRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              messages: [testMsg],
            }),
          });

          if (bcRes.ok) {
            sentOk = true;
            steps.push({
              step: '3. ทดสอบส่งข้อความเข้าแชทส่วนตัวทุกคน (Broadcast API)',
              status: 'ok',
              detail: `ส่งข้อความแบบ Broadcast เข้าแชทส่วนตัวของเพื่อนทุกคนสำเร็จแล้ว! (หมายเหตุ: Broadcast ของ LINE จะเข้าเฉพาะแชท 1-on-1 หากต้องการให้เข้ากลุ่ม LINE ด้วย กรุณาผูก Group ID C... ด้านบน)`,
            });
          } else {
            const bcErr = await bcRes.json().catch(() => ({}));
            steps.push({
              step: '3. ทดสอบส่งข้อความเข้าแอป LINE จริง',
              status: 'error',
              detail: `ส่งไม่สำเร็จ (${
                bcErr?.message || `HTTP ${bcRes.status}`
              }) กรุณาตรวจสอบโควต้าข้อความรายเดือนของ LINE OA หรือการตั้งค่า Messaging API`,
            });
          }
        }

        res.status(200).json({
          ok: sentOk,
          botInfo,
          detectedGroupId: runtimeDetectedGroupId || undefined,
          steps,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        botInfo,
        detectedGroupId: runtimeDetectedGroupId || undefined,
        steps,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(200).json({
        ok: false,
        steps: [
          {
            step: 'ข้อผิดพลาดในการเชื่อมต่อกับ LINE API',
            status: 'error',
            detail: msg,
          },
        ],
      });
    }
  });

  /**
   * Verify and test a user's Google Apps Script Web App URL (/exec) by sending a LINE webhook POST
   * and following Google's 302 redirect to script.googleusercontent.com with GET
   */
  app.post('/api/line/test-gas-webhook', async (req, res) => {
    try {
      const { scriptUrl, testText } = req.body as {
        scriptUrl?: string;
        testText?: string;
      };
      const url = (scriptUrl || '').trim();
      if (!url.startsWith('https://script.google.com/macros/s/')) {
        res.status(400).json({
          ok: false,
          message: 'กรุณาระบุลิงก์ Google Apps Script Web App URL ที่ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec',
        });
        return;
      }

      const payload = testText
        ? {
            events: [
              {
                type: 'message',
                replyToken: '00000000000000000000000000000000',
                message: { type: 'text', text: testText },
              },
            ],
          }
        : { events: [] };

      const postRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'manual',
      });

      let bodyText = '';
      if (
        (postRes.status === 301 || postRes.status === 302 || postRes.status === 303 || postRes.status === 307) &&
        postRes.headers.get('location')
      ) {
        const redirectUrl = postRes.headers.get('location')!;
        const getRes = await fetch(redirectUrl, { method: 'GET' });
        bodyText = await getRes.text();
      } else {
        bodyText = await postRes.text();
      }

      const isJsonOk =
        bodyText.includes('"status":"verified"') || bodyText.includes('"status":"ok"');
      const isV26 =
        bodyText.includes('2.6-group-bridge') || bodyText.includes('gas_bridge_ready');

      res.status(200).json({
        ok: isJsonOk,
        isV26,
        httpStatus: postRes.status,
        responsePreview: bodyText.slice(0, 300),
        message: isJsonOk
          ? testText
            ? `ส่งข้อความ "${testText}" เข้า Google Apps Script สำเร็จ (เขียนลง Google Sheets เรียบร้อย!)`
            : isV26
            ? '✅ ตรวจสอบสำเร็จ! ลิงก์ Google Apps Script ของคุณเป็นเวอร์ชันล่าสุด (v2.6 รองรับคำสั่ง "เชื่อมกลุ่ม" และการแจ้งเตือนกลุ่ม LINE ครบถ้วน 100%)'
            : '⚠️ ลิงก์เชื่อมต่อได้ แต่ยังเป็น "โค้ดเวอร์ชันเก่า" (จึงทำให้พิมพ์ "เชื่อมกลุ่ม" ในกลุ่ม LINE แล้วบอทไม่ตอบกลับรหัส C...) — กรุณากดปุ่ม "คัดลอกโค้ด Apps Script" ด้านล่าง ไปวางทับใน Apps Script แล้วกด Deploy > Manage deployments > แก้ไข (รูปดินสอ) > เลือก Version: New version > กด Deploy'
          : `ได้รับการตอบกลับจาก Apps Script: ${bodyText.slice(0, 140)}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(200).json({
        ok: false,
        message: `ไม่สามารถติดต่อลิงก์ Google Apps Script ได้: ${msg}`,
      });
    }
  });

  /**
   * Check Group ID & diagnose why typing "เชื่อมกลุ่ม" in LINE might not have replied
   * (Checks LINE's /v2/bot/channel/webhook/endpoint AND the Google Apps Script bridge version)
   */
  app.post('/api/line/check-group-webhook', async (req, res) => {
    try {
      const {
        channelAccessToken,
        gasUrl,
        autoBindWebhook,
        targetGroupId,
        tasks: incomingTasks,
      } = req.body || {};
      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      const cleanGasUrl = String(gasUrl || '').split('?')[0].trim();
      const cleanProvidedGroupId = String(targetGroupId || '').trim();
      if (/^[CR][0-9a-fA-F]{32}$/.test(cleanProvidedGroupId)) {
        runtimeDetectedGroupId = cleanProvidedGroupId;
        savePersistedWorkspaceCache();
      }
      let detectedGroupId = /^[CR][0-9a-fA-F]{32}$/.test(runtimeDetectedGroupId)
        ? runtimeDetectedGroupId
        : '';
      let webhookEndpoint = '';
      let webhookActive = true;
      let webhookBoundSuccess = false;
      let isOutdatedGas = false;
      let hasPortalSyntaxBug = false;
      let gasReachable = false;
      let gasVersion = '';
      let activeGasUrl = '';
      let botBasicId = '';
      let botDisplayName = '';

      if (token) {
        runtimeChannelAccessToken = token;

        // If user provided a valid Google Apps Script /exec URL and requested binding (or by default when gasUrl is passed),
        // automatically set it as the LINE Webhook Endpoint via PUT /v2/bot/channel/webhook/endpoint!
        if (
          cleanGasUrl.startsWith('https://script.google.com/macros/s/') &&
          cleanGasUrl.endsWith('/exec') &&
          autoBindWebhook !== false
        ) {
          runtimeGasUrl = cleanGasUrl;
          savePersistedWorkspaceCache();
          const putRes = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ endpoint: cleanGasUrl }),
          }).catch(() => null);
          if (putRes && putRes.ok) {
            webhookBoundSuccess = true;
          }
        }

        // 1. Check Bot Info & Webhook Endpoint configured in LINE Developers Console
        const [botRes, whRes] = await Promise.all([
          fetch('https://api.line.me/v2/bot/info', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
          fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
        ]);

        if (botRes && botRes.ok) {
          const bData = (await botRes.json().catch(() => ({}))) as {
            basicId?: string;
            displayName?: string;
          };
          botBasicId = bData.basicId || '';
          botDisplayName = bData.displayName || '';
        }

        if (whRes && whRes.ok) {
          const wData = (await whRes.json().catch(() => ({}))) as {
            endpoint?: string;
            active?: boolean;
          };
          webhookEndpoint = String(wData.endpoint || '').trim();
          webhookActive = Boolean(wData.active);
        }
      }

      // 2. Check Google Apps Script URL (prioritize webhookEndpoint & cleanGasUrl)
      const candidateGasUrls = Array.from(
        new Set(
          [cleanGasUrl, webhookEndpoint, runtimeGasUrl].filter((u) =>
            u && u.startsWith('https://script.google.com/macros/s/')
          )
        )
      );

      const workspaceTasks =
        Array.isArray(incomingTasks) && incomingTasks.length > 0
          ? incomingTasks
          : sharedWorkspaces.get('sheetcal-team-clean')?.tasks || [];

      for (const scriptUrl of candidateGasUrls) {
        try {
          const postRes = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'check_bridge',
              channelAccessToken: token || undefined,
              targetGroupId: detectedGroupId || undefined,
              tasks: workspaceTasks.length > 0 ? workspaceTasks : undefined,
              events: [],
            }),
            redirect: 'manual',
          });

          let bodyText = '';
          let finalStatus = postRes.status;
          if (
            (postRes.status === 301 ||
              postRes.status === 302 ||
              postRes.status === 303 ||
              postRes.status === 307) &&
            postRes.headers.get('location')
          ) {
            const redirectUrl = postRes.headers.get('location')!;
            const getRes = await fetch(redirectUrl, { method: 'GET' });
            finalStatus = getRes.status;
            bodyText = await getRes.text();
          } else {
            bodyText = await postRes.text();
          }

          if (finalStatus >= 200 && finalStatus < 300) {
            gasReachable = true;
            if (!activeGasUrl) activeGasUrl = scriptUrl;
          }

          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            parsed = {};
          }

          if (
            typeof parsed.detectedGroupId === 'string' &&
            /^[CR][0-9a-fA-F]{32}$/.test(parsed.detectedGroupId.trim())
          ) {
            detectedGroupId = parsed.detectedGroupId.trim();
            runtimeDetectedGroupId = detectedGroupId;
            savePersistedWorkspaceCache();
          }

          if (typeof parsed.version === 'string') {
            gasVersion = parsed.version;
          }

          if (
            parsed.status === 'verified' &&
            parsed.mode !== 'gas_bridge_ready' &&
            !String(parsed.version || '').includes('2.6') &&
            !String(parsed.version || '').includes('2.7')
          ) {
            isOutdatedGas = true;
          }

          // Merge remote tasks from GAS with workspaceTasks so neither side ever loses a task
          const gasTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
          const mergedTasks = mergeTasksById(workspaceTasks, gasTasks);
          if (mergedTasks.length > 0) {
            const currentWs = sharedWorkspaces.get('sheetcal-team-clean');
            if (currentWs) {
              const updatedWs: CollaborativeWorkspaceState = {
                ...currentWs,
                updatedAt: new Date().toISOString(),
                tasks: mergedTasks,
              };
              sharedWorkspaces.set('sheetcal-team-clean', updatedWs);
              sharedWorkspaces.set('team-default', updatedWs);
              savePersistedWorkspaceCache();
            }
            await fetch(scriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sync_tasks',
                targetGroupId: detectedGroupId || undefined,
                tasks: mergedTasks,
              }),
              redirect: 'follow',
            }).catch(() => null);
          }

          // Inspect the deployed ?view=calendar HTML to check if it has the v2.6 replace(//+$/ JS syntax bug
          const portalRes = await fetch(`${scriptUrl}?view=calendar`, {
            method: 'GET',
            redirect: 'follow',
          }).catch(() => null);
          if (portalRes && portalRes.ok) {
            const portalHtml = await portalRes.text().catch(() => '');
            if (portalHtml.includes('replace(//+$/')) {
              hasPortalSyntaxBug = true;
            }
          }
        } catch {
          // Ignore single URL error
        }
      }

      res.status(200).json({
        ok: Boolean(detectedGroupId),
        detectedGroupId: detectedGroupId || undefined,
        webhookEndpoint: webhookEndpoint || undefined,
        activeGasUrl: activeGasUrl || webhookEndpoint || cleanGasUrl || undefined,
        webhookActive,
        webhookBoundSuccess,
        gasReachable,
        isOutdatedGas,
        hasPortalSyntaxBug,
        gasVersion: gasVersion || undefined,
        botBasicId: botBasicId || undefined,
        botDisplayName: botDisplayName || undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.status(200).json({
        ok: false,
        error: msg,
      });
    }
  });

  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 24/7 Server-Side Background Notification Scheduler (runs every 20s in Asia/Bangkok time +07:00)
  // Handles both:
  // 1) Morning Daily Summary Digest (แจ้งเตือนสรุปงานตอนเช้าตามเวลา dailyDigestTime)
  // 2) Per-Task Scheduled Reminders (แจ้งเตือนทีละงานตามเวลาที่กำหนด)
  const deliverScheduledFlexToLine = async (flexMessage: unknown, fallbackText: string) => {
    const token = sanitizeToken(runtimeChannelAccessToken || '');
    if (!token) return false;
    const mode = runtimeScheduleConfig.teamNotificationMode || 'both';
    const effectiveGroupId = /^[CR][0-9a-fA-F]{32}$/.test(runtimeDetectedGroupId)
      ? runtimeDetectedGroupId
      : /^[CR][0-9a-fA-F]{32}$/.test(runtimeDefaultUserId)
      ? runtimeDefaultUserId
      : '';
    const effectiveUserId = /^U[0-9a-fA-F]{32}$/.test(runtimeDefaultUserId)
      ? runtimeDefaultUserId
      : '';

    let delivered = false;
    if (effectiveGroupId && (mode === 'group' || mode === 'both')) {
      const grpRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: effectiveGroupId, messages: [flexMessage] }),
      }).catch(() => null);
      if (grpRes && grpRes.ok) {
        delivered = true;
      } else {
        const grpTxt = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: effectiveGroupId,
            messages: [{ type: 'text', text: fallbackText }],
          }),
        }).catch(() => null);
        if (grpTxt && grpTxt.ok) delivered = true;
      }
      if (delivered && mode === 'group') return true;
    }

    if (effectiveUserId && mode !== 'group') {
      const usrRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: effectiveUserId, messages: [flexMessage] }),
      }).catch(() => null);
      if (usrRes && usrRes.ok) return true;
    }

    if (!delivered || mode === 'broadcast' || mode === 'both') {
      const bcRes = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: [flexMessage] }),
      }).catch(() => null);
      if (bcRes && bcRes.ok) delivered = true;
    }
    return delivered;
  };

  setInterval(async () => {
    try {
      if (!runtimeScheduleConfig.enabled || !runtimeChannelAccessToken) return;
      const ws =
        sharedWorkspaces.get('sheetcal-team-clean') ||
        sharedWorkspaces.get('team-default') ||
        Array.from(sharedWorkspaces.values())[0];
      if (!ws || !Array.isArray(ws.tasks)) return;

      const now = new Date();
      const { todayYMD, nowHM } = getBangkokNowYMDAndHM();
      const defaultAppUrl =
        'https://naiadminna.github.io/Lakha/?section=calendar&workspace=sheetcal-team-clean&sheet=1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc&gas=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FAKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg%2Fexec&openExternalBrowser=1';

      const rawCats = Array.isArray(ws.categories) ? ws.categories : [];
      const catById = new Map<string, { name: string; color: string }>();
      for (const c of rawCats) {
        if (c && typeof c === 'object') {
          const rec = c as Record<string, unknown>;
          if (rec.id) {
            catById.set(String(rec.id), {
              name: String(rec.name || 'ทั่วไป'),
              color: String(rec.color || '#2563EB'),
            });
          }
        }
      }

      // 1. Check Morning Daily Digest (แจ้งเตือนสรุปงานประจำวันตอนเช้า)
      if (
        runtimeScheduleConfig.dailyDigestEnabled !== false &&
        /^\d{1,2}:\d{2}$/.test(runtimeScheduleConfig.dailyDigestTime || '')
      ) {
        const digestHM = runtimeScheduleConfig.dailyDigestTime.trim().padStart(5, '0');
        const digestDateTime = new Date(`${todayYMD}T${digestHM}:00+07:00`);
        if (!isNaN(digestDateTime.getTime())) {
          const minsAfterDigest = (now.getTime() - digestDateTime.getTime()) / (1000 * 60);
          // Grace window [0.25 .. 12] minutes so browser tab (if open) can fire at 0.0 min or server fires automatically
          if (
            minsAfterDigest >= 0.25 &&
            minsAfterDigest <= 12 &&
            lastMorningDigestSentDate !== todayYMD
          ) {
            lastMorningDigestSentDate = todayYMD;
            savePersistedWorkspaceCache();

            const decoded = extractGasMetadataFromTasks(ws.tasks);
            const activeToday = decoded.tasks.filter((t) => {
              const startD = String(t.date || '').trim();
              const endD = String(t.endDate || startD).trim();
              if (!startD) return false;
              return startD <= todayYMD && endD >= todayYMD;
            });
            if (activeToday.length > 0) {
              const digestItems: DigestTaskItem[] = activeToday.map((t) => {
                const cid = String(t.categoryId || '');
                const catInfo = catById.get(cid);
                const tDate = String(t.date || todayYMD);
                const tTime = String(t.time || '09:00');
                return {
                  title: String(t.title || 'รายการงาน'),
                  date: tDate,
                  endDate: t.endDate ? String(t.endDate) : undefined,
                  time: tTime,
                  categoryName: catInfo?.name || 'งานตารางทีม',
                  categoryColor: catInfo?.color || '#2563EB',
                  priority: (t.priority as 'low' | 'medium' | 'high') || 'medium',
                  status: (t.status as 'pending' | 'in_progress' | 'completed') || 'pending',
                  description: String(t.description || ''),
                  assigneeName: t.assigneeName ? String(t.assigneeName) : undefined,
                  timePhase: tTime <= nowHM ? 'passed' : 'upcoming',
                };
              });

              const flexMsg = buildDailyDigestFlexMessage(
                todayYMD,
                digestItems,
                defaultAppUrl
              );
              await deliverScheduledFlexToLine(
                flexMsg,
                `☀️ สรุปตารางงานประจำวัน (${formatThaiDateReadable(todayYMD)}) — ทั้งหมด ${digestItems.length} รายการ`
              );
            }
          }
        }
      }

      // 2. Check Per-Task Scheduled Reminders (แจ้งเตือนทีละงานตามเวลาที่กำหนดให้ครบทุกงานในวันนั้น ๆ)
      const decodedTasks = extractGasMetadataFromTasks(ws.tasks).tasks;
      let taskUpdated = false;
      const sameDayTasksList = decodedTasks.filter((item) => {
        const sD = String(item.date || '').trim();
        const eD = String(item.endDate || sD).trim();
        return sD && sD <= todayYMD && eD >= todayYMD;
      });
      const statsPool = sameDayTasksList.length > 0 ? sameDayTasksList : decodedTasks;
      const totalCount = statsPool.length;
      const completedCount = statsPool.filter(
        (t) => String(t.status || '') === 'completed'
      ).length;
      const pendingCount = totalCount - completedCount;

      for (const t of decodedTasks) {
        if (!t || typeof t !== 'object') continue;
        if (String(t.status || '') === 'completed') continue;

        const remindMins =
          typeof t.remindMinutesBefore === 'number'
            ? t.remindMinutesBefore
            : runtimeScheduleConfig.defaultRemindMinutes ?? 1;
        if (remindMins <= 0) continue;

        const tDate = String(t.date || '').trim();
        const tEndDate = String(t.endDate || tDate).trim();
        const tTimeRaw = String(t.time || '09:00').trim();
        const cleanTime = /^\d{1,2}:\d{2}$/.test(tTimeRaw)
          ? tTimeRaw.padStart(5, '0')
          : '09:00';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tDate)) continue;

        const isTaskActiveToday = tDate <= todayYMD && tEndDate >= todayYMD;
        const effectiveDate = isTaskActiveToday ? todayYMD : tDate;

        const taskDateTime = new Date(`${effectiveDate}T${cleanTime}:00+07:00`);
        if (isNaN(taskDateTime.getTime())) continue;

        const diffMinutes = (taskDateTime.getTime() - now.getTime()) / (1000 * 60);

        // If lineNotified was set while the scheduled reminder window is still in the future
        // or on a previous day of a multi-day task, reset it so the task will notify on schedule
        if (Boolean(t.lineNotified)) {
          let updatedYMD = '';
          if (t.updatedAt) {
            const dtUpd = new Date(String(t.updatedAt));
            if (!isNaN(dtUpd.getTime())) {
              const bangkokUpd = new Date(dtUpd.getTime() + 7 * 60 * 60 * 1000);
              updatedYMD = bangkokUpd.toISOString().slice(0, 10);
            }
          }
          const isNewDayOfMultiDay =
            tEndDate > tDate && Boolean(updatedYMD && updatedYMD < todayYMD);
          if (diffMinutes > remindMins + 1 || isNewDayOfMultiDay) {
            t.lineNotified = false;
            t.updatedAt = new Date().toISOString();
            taskUpdated = true;
          }
          continue;
        }

        // Notify strictly within the task's configured reminder window [0..remindMins] before start
        // (with at most 1 minute grace [-1..0] — never fire late after the task time has already passed!)
        if (diffMinutes <= remindMins && diffMinutes >= -1) {
          t.lineNotified = true;
          t.updatedAt = new Date().toISOString();
          taskUpdated = true;

          const cid = String(t.categoryId || '');
          const catInfo = catById.get(cid);
          const singleFlex = buildSingleTaskReminderFlexMessage({
            taskTitle: String(t.title || 'รายการงาน'),
            description: String(t.description || ''),
            date: effectiveDate,
            time: cleanTime,
            categoryName: catInfo?.name || 'ทั่วไป',
            categoryColor: catInfo?.color || '#2563EB',
            priority: String(t.priority || 'medium'),
            appUrl: defaultAppUrl,
            messageFormat: runtimeScheduleConfig.messageFormat,
            includeDescription: runtimeScheduleConfig.includeDescriptionInNotification,
            includeGoogleCalendarButton: runtimeScheduleConfig.includeGoogleCalendarButton,
            includeOpenAppButton: runtimeScheduleConfig.includeOpenAppButton,
            cardFontSize: runtimeScheduleConfig.cardFontSize,
            cardTitleWeight: runtimeScheduleConfig.cardTitleWeight,
            cardLineSpacing: runtimeScheduleConfig.cardLineSpacing,
            stats: {
              total: totalCount,
              pending: pendingCount,
              completed: completedCount,
            },
          });

          await deliverScheduledFlexToLine(
            singleFlex,
            `🔔 แจ้งเตือนงานตามเวลา: ${String(t.title || '')} (${formatThaiDateReadable(effectiveDate)} เวลา ${cleanTime} น.)`
          );
        }
      }

      if (taskUpdated) {
        const updatedWs: CollaborativeWorkspaceState = {
          ...ws,
          updatedAt: new Date().toISOString(),
          tasks: decodedTasks,
        };
        sharedWorkspaces.set('sheetcal-team-clean', updatedWs);
        sharedWorkspaces.set('team-default', updatedWs);
        savePersistedWorkspaceCache();

        const cleanGas = resolveCleanGasUrl(runtimeGasUrl);
        if (cleanGas.startsWith('https://script.google.com/macros/s/')) {
          const gasTasksWithMeta = attachGasMetadataToTasks(
            decodedTasks,
            ws.categories,
            ws.teamMembers
          );
          postToGoogleAppsScript(cleanGas, {
            action: 'sync_tasks',
            tasks: gasTasksWithMeta,
            categories: ws.categories,
            teamMembers: ws.teamMembers,
          }).catch(() => {});
        }
      }
    } catch {
      // Ignore background scheduler error
    }
  }, 20000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

