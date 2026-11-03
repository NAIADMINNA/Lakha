import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { extractThaiDate, extractThaiTime } from './src/services/lineCommandParser';

dotenv.config();
process.env.DISABLE_HMR = 'true';

interface IncomingLineWebhookItem {
  id: string;
  text: string;
  userId?: string;
  timestamp: string;
}

interface DigestTaskItem {
  title: string;
  date: string;
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
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12) return ymd;
  return `${d} ${thaiMonths[m - 1]} ${y + 543}`;
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
    details: details || 'SheetCal LINE Task',
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
  const totalCount = tasksList.length;
  const completedCount = tasksList.filter((t) => t.status === 'completed').length;
  const highCount = tasksList.filter(
    (t) => t.priority === 'high' && t.status !== 'completed'
  ).length;
  const completionPct =
    totalCount > 0 ? Math.max(6, Math.round((completedCount / totalCount) * 100)) : 100;
  const readableDate = formatThaiDateReadable(dateStr);

  const classifyItemPhase = (t: DigestTaskItem): 'passed' | 'upcoming' => {
    if (t.timePhase === 'passed' || t.timePhase === 'upcoming') {
      return t.timePhase;
    }
    const itemDate = t.date || dateStr || todayYMD;
    const itemTime = t.time || '09:00';
    if (itemDate < todayYMD) return 'passed';
    if (itemDate > todayYMD) return 'upcoming';
    return itemTime <= nowHM ? 'passed' : 'upcoming';
  };

  const passedItems = tasksList.filter((t) => classifyItemPhase(t) === 'passed');
  const upcomingItems = tasksList.filter((t) => classifyItemPhase(t) === 'upcoming');

  const renderTaskBox = (t: DigestTaskItem, isPassed: boolean) => {
    const isDone = t.status === 'completed';
    const isHigh = t.priority === 'high';
    const catColor =
      /^#[0-9A-Fa-f]{6}$/.test(t.categoryColor || '') ? t.categoryColor : '#2563EB';
    const statusLabel = isDone
      ? '✓ เสร็จแล้ว'
      : isPassed
      ? '⚠️ เลยเวลา'
      : isHigh
      ? '🔥 ด่วนมาก'
      : '⏳ รอถึงเวลา';
    const statusColor = isDone
      ? '#16A34A'
      : isPassed
      ? '#DC2626'
      : isHigh
      ? '#EA580C'
      : '#2563EB';

    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      margin: 'sm',
      paddingAll: '10px',
      backgroundColor: isDone ? '#F8FAFC' : '#FFFFFF',
      cornerRadius: '10px',
      borderWidth: '1px',
      borderColor: !isDone && isPassed ? '#FECACA' : '#E2E8F0',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '62px',
          flex: 0,
          contents: [
            {
              type: 'text',
              text: `${t.time || '09:00'}`,
              weight: 'bold',
              size: 'sm',
              color: isDone ? '#94A3B8' : '#0F172A',
            },
            {
              type: 'text',
              text: statusLabel,
              size: 'xxs',
              color: statusColor,
              weight: 'bold',
              margin: 'xs',
            },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          width: '4px',
          flex: 0,
          backgroundColor: isDone ? '#CBD5E1' : catColor,
          cornerRadius: '4px',
          contents: [{ type: 'filler' }],
        },
        {
          type: 'box',
          layout: 'vertical',
          flex: 1,
          contents: [
            {
              type: 'text',
              text: t.title || 'รายการงาน',
              weight: 'bold',
              size: 'sm',
              color: isDone ? '#94A3B8' : '#0F172A',
              wrap: true,
            },
            {
              type: 'text',
              text: `${t.categoryName || 'ทั่วไป'}${
                t.assigneeName ? ` · 👤 ${t.assigneeName}` : ''
              } · ${
                isHigh ? 'ความสำคัญสูง' : t.priority === 'medium' ? 'ปานกลาง' : 'ทั่วไป'
              }`,
              size: 'xxs',
              color: '#64748B',
              margin: 'xs',
              wrap: true,
            },
          ],
        },
      ],
    };
  };

  const timelineSectionBoxes: unknown[] = [];
  if (totalCount === 0) {
    timelineSectionBoxes.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      backgroundColor: '#F8FAFC',
      cornerRadius: '10px',
      margin: 'md',
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
    });
  } else {
    timelineSectionBoxes.push({
      type: 'text',
      text: `⏮️ ผ่านเวลาที่กำหนดแล้ว (<= ${nowHM} น.) · ${passedItems.length} งาน`,
      size: 'xxs',
      weight: 'bold',
      color: '#B45309',
      margin: 'lg',
    });
    if (passedItems.length > 0) {
      passedItems.slice(0, 5).forEach((item) => {
        timelineSectionBoxes.push(renderTaskBox(item, true));
      });
    } else {
      timelineSectionBoxes.push({
        type: 'text',
        text: '• ไม่มีงานที่ผ่านเวลาที่กำหนด',
        size: 'xs',
        color: '#94A3B8',
        margin: 'sm',
      });
    }

    timelineSectionBoxes.push({
      type: 'text',
      text: `⏭️ ยังไม่ถึงเวลาที่กำหนด (> ${nowHM} น.) · ${upcomingItems.length} งาน`,
      size: 'xxs',
      weight: 'bold',
      color: '#1D4ED8',
      margin: 'lg',
    });
    if (upcomingItems.length > 0) {
      upcomingItems.slice(0, 5).forEach((item) => {
        timelineSectionBoxes.push(renderTaskBox(item, false));
      });
    } else {
      timelineSectionBoxes.push({
        type: 'text',
        text: '• ไม่มีงานที่รอถึงเวลาอีกในวันนี้',
        size: 'xs',
        color: '#94A3B8',
        margin: 'sm',
      });
    }
  }

  return {
    type: 'flex',
    altText: `📅 สรุปตารางงานแยกตามเวลา (${readableDate}) — ผ่านเวลา ${passedItems.length} · ยังไม่ถึงเวลา ${upcomingItems.length}`,
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
                paddingAll: '4px',
                paddingStart: '8px',
                paddingEnd: '8px',
                flex: 0,
                contents: [
                  {
                    type: 'text',
                    text: 'TIME-SPLIT DAILY SUMMARY',
                    color: '#FFFFFF',
                    size: 'xxs',
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'text',
                text: `${readableDate} · ${nowHM} น.`,
                color: '#94A3B8',
                size: 'xs',
                align: 'end',
                weight: 'bold',
              },
            ],
          },
          {
            type: 'text',
            text: 'สรุปตารางงานแยกตามเวลา',
            color: '#FFFFFF',
            size: 'xl',
            weight: 'bold',
            margin: 'md',
          },
          {
            type: 'text',
            text:
              highCount > 0
                ? `ผ่านเวลาแล้ว ${passedItems.length} งาน · ยังไม่ถึงเวลา ${upcomingItems.length} งาน (ด่วนสูง ${highCount})`
                : `ผ่านเวลาแล้ว ${passedItems.length} งาน · ยังไม่ถึงเวลา ${upcomingItems.length} งาน`,
            color: highCount > 0 ? '#FCD34D' : '#CBD5E1',
            size: 'xs',
            margin: 'xs',
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#334155',
            height: '6px',
            cornerRadius: '3px',
            margin: 'lg',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#06C755',
                width: `${completionPct}%`,
                height: '6px',
                cornerRadius: '3px',
                contents: [{ type: 'filler' }],
              },
            ],
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        backgroundColor: '#F8FAFC',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#FFFBEB',
                cornerRadius: '10px',
                paddingAll: '10px',
                borderWidth: '1px',
                borderColor: '#FDE68A',
                contents: [
                  {
                    type: 'text',
                    text: String(passedItems.length),
                    size: 'xl',
                    weight: 'bold',
                    color: '#B45309',
                    align: 'center',
                  },
                  {
                    type: 'text',
                    text: 'ผ่านเวลาแล้ว',
                    size: 'xxs',
                    color: '#92400E',
                    align: 'center',
                    margin: 'xs',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#EFF6FF',
                cornerRadius: '10px',
                paddingAll: '10px',
                borderWidth: '1px',
                borderColor: '#BFDBFE',
                contents: [
                  {
                    type: 'text',
                    text: String(upcomingItems.length),
                    size: 'xl',
                    weight: 'bold',
                    color: '#1D4ED8',
                    align: 'center',
                  },
                  {
                    type: 'text',
                    text: 'ยังไม่ถึงเวลา',
                    size: 'xxs',
                    color: '#1E40AF',
                    align: 'center',
                    margin: 'xs',
                  },
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#F0FDF4',
                cornerRadius: '10px',
                paddingAll: '10px',
                borderWidth: '1px',
                borderColor: '#BBF7D0',
                contents: [
                  {
                    type: 'text',
                    text: `${completedCount}/${totalCount}`,
                    size: 'xl',
                    weight: 'bold',
                    color: '#16A34A',
                    align: 'center',
                  },
                  {
                    type: 'text',
                    text: 'เสร็จแล้ว',
                    size: 'xxs',
                    color: '#15803D',
                    align: 'center',
                    margin: 'xs',
                  },
                ],
              },
            ],
          },
          ...timelineSectionBoxes,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        backgroundColor: '#FFFFFF',
        borderWidth: '1px',
        borderColor: '#F1F5F9',
        contents: (() => {
          const btns: Record<string, unknown>[] = [
            {
              type: 'button',
              style: 'primary',
              color: '#06C755',
              height: 'sm',
              action: {
                type: 'uri',
                label: 'เปิดดูปฏิทินและจัดการงาน',
                uri: appUrl,
              },
            },
          ];
          try {
            const parsed = new URL(appUrl);
            const sheetParam = (parsed.searchParams.get('sheet') || '').trim();
            if (sheetParam && !appUrl.includes('docs.google.com/spreadsheets')) {
              btns.push({
                type: 'button',
                style: 'secondary',
                height: 'sm',
                action: {
                  type: 'uri',
                  label: '📊 เปิดตารางงาน Google Sheets',
                  uri: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetParam)}/edit`,
                },
              });
            }
          } catch {
            // Ignore URL parse error
          }
          return btns;
        })(),
      },
    },
  };
}

function buildSingleTaskReminderFlexMessage(params: {
  taskTitle: string;
  description?: string;
  date: string;
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
  const readableDate = formatThaiDateReadable(params.date);
  const isHigh = params.priority === 'high';
  const isCompact = params.messageFormat === 'compact_flex';
  const showDesc = params.includeDescription !== false && Boolean(params.description);
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

  const headerBg =
    /^#[0-9A-Fa-f]{6}$/.test(params.categoryColor || '') ? params.categoryColor! : '#4F46E5';
  const googleCalUrl = buildGoogleCalUrl(
    params.taskTitle,
    params.date,
    params.time,
    params.description || ''
  );

  const footerButtons: Record<string, unknown>[] = [];
  if (showAppBtn) {
    footerButtons.push({
      type: 'button',
      style: 'primary',
      color: '#06C755',
      height: 'sm',
      action: {
        type: 'uri',
        label: 'เปิดดูปฏิทินและจัดการงาน',
        uri: params.appUrl,
      },
    });
  }
  try {
    const parsedApp = new URL(params.appUrl);
    const sheetParam = (parsedApp.searchParams.get('sheet') || '').trim();
    if (sheetParam && !params.appUrl.includes('docs.google.com/spreadsheets')) {
      footerButtons.push({
        type: 'button',
        style: 'secondary',
        height: 'sm',
        action: {
          type: 'uri',
          label: '📊 เปิดตารางงาน Google Sheets',
          uri: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetParam)}/edit`,
        },
      });
    }
  } catch {
    // Ignore URL parse error
  }
  if (showCalBtn && footerButtons.length < 2) {
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

  const metadataRows: Record<string, unknown>[] = [
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '🗓️ วันที่',
          color: '#64748B',
          size: bodySize,
          flex: 2,
        },
        {
          type: 'text',
          text: `${readableDate} (${params.date})`,
          color: '#0F172A',
          size: bodySize,
          weight: textWeight,
          flex: 5,
        },
      ],
    },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '⏰ เวลา',
          color: '#64748B',
          size: bodySize,
          flex: 2,
        },
        {
          type: 'text',
          text: `${params.time} น.`,
          color: '#059669',
          size: timeValueSize,
          weight: textWeight,
          flex: 5,
        },
      ],
    },
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: '🗂️ หมวดหมู่',
          color: '#64748B',
          size: bodySize,
          flex: 2,
        },
        {
          type: 'text',
          text: params.categoryName || 'ทั่วไป',
          color: headerBg,
          size: bodySize,
          weight: textWeight,
          flex: 5,
          wrap: true,
        },
      ],
    },
  ];

  const summaryStats = params.stats;

  return {
    type: 'flex',
    altText: `🔔 แจ้งเตือนงาน: ${params.taskTitle} (${readableDate} เวลา ${params.time} น.)`,
    contents: {
      type: 'bubble',
      size: isCompact ? 'kilo' : 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: isCompact ? '14px' : '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            alignItems: 'center',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                backgroundColor: isHigh ? '#DC2626' : '#06C755',
                cornerRadius: '6px',
                paddingAll: '4px',
                paddingStart: '8px',
                paddingEnd: '8px',
                flex: 0,
                contents: [
                  {
                    type: 'text',
                    text: isHigh ? '🔥 HIGH PRIORITY' : '⏰ TASK REMINDER',
                    color: '#FFFFFF',
                    size: 'xxs',
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'text',
                text: `${params.time} น.`,
                color: '#FFFFFF',
                size: 'sm',
                weight: 'bold',
                align: 'end',
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
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: isCompact ? '14px' : '20px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F8FAFC',
            cornerRadius: '10px',
            paddingAll: '12px',
            spacing: 'sm',
            borderWidth: '1px',
            borderColor: '#E2E8F0',
            contents: metadataRows,
          },
          ...(showDesc
            ? [
                {
                  type: 'text',
                  text: params.description,
                  size: bodySize,
                  lineSpacing: lineSpacingPx,
                  color: '#475569',
                  wrap: true,
                },
              ]
            : []),
          ...(summaryStats
            ? [
                {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#EEF2FF',
                  cornerRadius: '10px',
                  paddingAll: '10px',
                  borderWidth: '1px',
                  borderColor: '#C7D2FE',
                  contents: [
                    {
                      type: 'text',
                      text: `📊 สรุปภาพรวมตารางงาน (${readableDate})`,
                      size: 'xxs',
                      weight: 'bold',
                      color: '#4338CA',
                    },
                    {
                      type: 'text',
                      text: `ทั้งหมด ${summaryStats.total} งาน · รอทำ ${summaryStats.pending} งาน · เสร็จแล้ว ${summaryStats.completed} งาน`,
                      size: bodySize,
                      weight: textWeight,
                      lineSpacing: lineSpacingPx,
                      color: '#1E1B4B',
                      margin: 'xs',
                      wrap: true,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      ...(footerButtons.length > 0
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: isCompact ? '12px' : '16px',
              contents: footerButtons,
            },
          }
        : {}),
    },
  };
}

let runtimeChannelAccessToken = sanitizeToken(process.env.LINE_CHANNEL_ACCESS_TOKEN || '');
let runtimeDefaultUserId = (process.env.LINE_DEFAULT_USER_ID || '').trim();
let runtimeDetectedGroupId = (process.env.LINE_DEFAULT_GROUP_ID || '').trim();
let runtimeGasUrl = '';
const pendingWebhookMessages: IncomingLineWebhookItem[] = [];
const sharedWorkspaces = new Map<string, CollaborativeWorkspaceState>();
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
        runtimeGasUrl = parsed.runtimeGasUrl.trim();
      }
      if (parsed.workspaces && typeof parsed.workspaces === 'object') {
        for (const [k, v] of Object.entries(parsed.workspaces)) {
          if (v && typeof v === 'object') {
            sharedWorkspaces.set(k, v as CollaborativeWorkspaceState);
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
          runtimeGasUrl,
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

  // Real-time Collaborative Shared Calendar Workspace Endpoints
  app.get('/api/collab/workspace/:workspaceId', (req, res) => {
    const workspaceId = String(req.params.workspaceId || 'sheetcal-team-clean').trim();
    const state =
      sharedWorkspaces.get(workspaceId) ||
      sharedWorkspaces.get('sheetcal-team-clean') ||
      sharedWorkspaces.get('team-default') ||
      Array.from(sharedWorkspaces.values())[0];
    if (!state) {
      res.json({ exists: false, workspaceId });
      return;
    }
    res.json({ exists: true, workspace: state });
  });

  app.post('/api/collab/workspace/:workspaceId', (req, res) => {
    const workspaceId = String(req.params.workspaceId || 'sheetcal-team-clean').trim();
    const {
      action,
      task,
      taskId,
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

    let nextTasks: unknown[] = Array.isArray(tasks) ? tasks : existing?.tasks || [];

    if (action === 'add_task' && task && typeof task === 'object') {
      const currentList = Array.isArray(existing?.tasks) ? [...existing.tasks] : [];
      nextTasks = [task, ...currentList];
    } else if (action === 'toggle_task' && taskId) {
      const currentList = Array.isArray(existing?.tasks)
        ? (existing.tasks as Record<string, unknown>[])
        : [];
      nextTasks = currentList.map((t) =>
        String(t.id) === String(taskId)
          ? {
              ...t,
              status: t.status === 'completed' ? 'pending' : 'completed',
              updatedAt: new Date().toISOString(),
            }
          : t
      );
    } else if (action === 'delete_task' && taskId) {
      const currentList = Array.isArray(existing?.tasks)
        ? (existing.tasks as Record<string, unknown>[])
        : [];
      nextTasks = currentList.filter((t) => String(t.id) !== String(taskId));
    }

    const nextState: CollaborativeWorkspaceState = {
      workspaceId,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || existing?.updatedBy || 'สมาชิกในทีม',
      spreadsheetId: spreadsheetId ?? existing?.spreadsheetId,
      spreadsheetUrl: spreadsheetUrl ?? existing?.spreadsheetUrl,
      tasks: nextTasks,
      categories: Array.isArray(categories) ? categories : existing?.categories || [],
      teamMembers: Array.isArray(teamMembers) ? teamMembers : existing?.teamMembers || [],
    };
    sharedWorkspaces.set(workspaceId, nextState);
    sharedWorkspaces.set('sheetcal-team-clean', nextState);
    sharedWorkspaces.set('team-default', nextState);
    savePersistedWorkspaceCache();

    if (runtimeGasUrl.startsWith('https://script.google.com/macros/s/')) {
      postToGoogleAppsScript(runtimeGasUrl, {
        action: 'sync_tasks',
        tasks: nextTasks,
      }).catch(() => {});
    }

    res.json({ ok: true, workspace: nextState });
  });

  // Server-side proxy to sync tasks between Web App and Google Apps Script (immune to browser CORS/302 issues)
  app.post('/api/line/gas-bridge-sync', async (req, res) => {
    try {
      const { gasUrl, channelAccessToken, tasks, mode } = req.body || {};
      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      if (token) runtimeChannelAccessToken = token;

      let targetGasUrl = String(gasUrl || runtimeGasUrl || '').trim();
      if (!targetGasUrl.startsWith('https://script.google.com/macros/s/') && token) {
        const whRes = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (whRes && whRes.ok) {
          const whData = (await whRes.json().catch(() => ({}))) as { endpoint?: string };
          if (
            whData.endpoint &&
            whData.endpoint.trim().startsWith('https://script.google.com/macros/s/')
          ) {
            targetGasUrl = whData.endpoint.trim();
          }
        }
      }

      if (!targetGasUrl.startsWith('https://script.google.com/macros/s/')) {
        res.json({ ok: false, reason: 'no_gas_url' });
        return;
      }

      runtimeGasUrl = targetGasUrl;
      savePersistedWorkspaceCache();

      if (mode === 'push' && Array.isArray(tasks)) {
        const syncRes = await postToGoogleAppsScript(targetGasUrl, {
          action: 'sync_tasks',
          tasks,
        });
        res.json({
          ok: Boolean(syncRes.json.ok),
          gasUrl: targetGasUrl,
          version: syncRes.json.version,
          response: syncRes.json,
        });
        return;
      }

      const pullRes = await postToGoogleAppsScript(targetGasUrl, {
        action: 'get_tasks',
      });
      const remoteTasks = Array.isArray(pullRes.json.tasks) ? pullRes.json.tasks : [];
      const detectedGrp =
        typeof pullRes.json.detectedGroupId === 'string' &&
        /^[CR][0-9a-fA-F]{32}$/.test(pullRes.json.detectedGroupId.trim())
          ? pullRes.json.detectedGroupId.trim()
          : '';
      if (detectedGrp) {
        runtimeDetectedGroupId = detectedGrp;
        savePersistedWorkspaceCache();
      }

      if (remoteTasks.length === 0 && Array.isArray(tasks) && tasks.length > 0) {
        await postToGoogleAppsScript(targetGasUrl, {
          action: 'sync_tasks',
          tasks,
        }).catch(() => {});
      }

      res.json({
        ok: true,
        gasUrl: targetGasUrl,
        version: pullRes.json.version,
        detectedGroupId: detectedGrp || runtimeDetectedGroupId || undefined,
        tasks: remoteTasks,
      });
    } catch (err: unknown) {
      res.json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Save runtime LINE OA credentials from the Web UI so the Webhook can reply automatically
  // Also automatically unlinks/purges any lingering Messaging API Rich Menus!
  app.post('/api/line/config', (req, res) => {
    const { channelAccessToken, targetUserId, targetGroupId, gasUrl } = req.body || {};
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
    if (
      typeof gasUrl === 'string' &&
      gasUrl.trim().startsWith('https://script.google.com/macros/s/')
    ) {
      runtimeGasUrl = gasUrl.trim();
    }
    savePersistedWorkspaceCache();
    if (runtimeChannelAccessToken) {
      purgeAllLineRichMenus(runtimeChannelAccessToken, runtimeDefaultUserId).catch(() => {});
    }
    res.json({
      ok: true,
      detectedGroupId: runtimeDetectedGroupId || undefined,
      detectedUserId: runtimeDefaultUserId || undefined,
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

  // Real LINE Official Account Webhook Endpoint (supports 1-on-1 AND Group Chat Format 2)
  app.post('/api/line/webhook', async (req, res) => {
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [];

      if (events.length === 0) {
        res.status(200).json({ status: 'verified' });
        return;
      }

      const appUrl =
        process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : 'https://calendar.google.com';

      for (const event of events) {
        const senderGroupId = String(
          event.source?.groupId || event.source?.roomId || ''
        ).trim();
        const senderUserId = String(event.source?.userId || '').trim();
        // IMPORTANT: In a LINE Group Chat, event.source contains BOTH groupId (C...) and userId (U...).
        // We MUST prioritize senderGroupId so Group Chat notifications (Format 2) capture C.../R... properly!
        const senderId = senderGroupId || senderUserId;

        if (senderGroupId) {
          runtimeDetectedGroupId = senderGroupId;
          runtimeDefaultUserId = senderGroupId;
        } else if (senderUserId && !runtimeDefaultUserId) {
          runtimeDefaultUserId = senderUserId;
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
                      text: '💡 พิมพ์สั่งงานในกลุ่มได้ทันที เช่น "ประชุมทีม พรุ่งนี้ 10:00 #สูง" หรือพิมพ์ "สรุปงานวันนี้"',
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
          const lowerText = userText.toLowerCase();

          // Special command to check/link Group ID in LINE Group Chat (supports substring matching e.g. "@bot เชื่อมกลุ่ม" or typos)
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

          if (userText) {
            pendingWebhookMessages.push({
              id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              text: userText,
              userId: senderId,
              timestamp: new Date().toISOString(),
            });
          }

          if (runtimeChannelAccessToken && event.replyToken) {
            const { todayYMD: todayStr } = getBangkokNowYMDAndHM();
            const stripped = userText.replace(
              /^(เพิ่มงาน|จดงาน|บันทึกงาน|นัดหมาย|ตารางงาน|เตือน|งานใหม่)\s*[:：-]?\s*/i,
              ''
            );
            const dateResult = extractThaiDate(stripped);
            const timeResult = extractThaiTime(dateResult.cleanedText);
            const parsedTitle =
              timeResult.cleanedText
                .replace(/#(สูง|ด่วนมาก|ด่วน|high|ต่ำ|low|กลาง|ทั่วไป|medium)/gi, ' ')
                .replace(/\b(เวลา|วันที่|ตอน|น\.|ของ)\b/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || stripped || userText;
            const flexReply = buildSingleTaskReminderFlexMessage({
              taskTitle: parsedTitle,
              description: senderGroupId
                ? `บันทึกลงปฏิทินทีมเรียบร้อยแล้ว (🔑 Group ID: ${senderGroupId})`
                : 'บันทึกลงปฏิทิน SheetCal LINE และซิงค์เข้า Google Sheets เรียบร้อยแล้ว',
              date: dateResult.dateStr || todayStr,
              time: timeResult.timeStr || '09:00',
              categoryName: senderGroupId ? 'งานกลุ่ม LINE ของทีม' : 'บันทึกผ่านแชท LINE OA',
              categoryColor: '#06C755',
              priority: userText.includes('#สูง') || userText.includes('#ด่วน') ? 'high' : 'medium',
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

      const refererHeader = String(req.headers.origin || req.headers.referer || '').trim();
      const rawAppUrl =
        originUrl && String(originUrl).startsWith('https://')
          ? String(originUrl)
          : refererHeader.startsWith('https://')
          ? refererHeader
          : process.env.APP_URL && process.env.APP_URL.startsWith('https://')
          ? process.env.APP_URL
          : 'https://calendar.google.com';
      // Heal stale ais-pre- URLs (which return 404 when not published) back to active ais-dev- container URL
      const appUrl =
        /^https:\/\/ais-pre-/i.test(rawAppUrl) &&
        (/^https:\/\/ais-dev-/i.test(refererHeader) ||
          /^https:\/\/ais-dev-/i.test(process.env.APP_URL || ''))
          ? rawAppUrl.replace(/^https:\/\/ais-pre-/i, 'https://ais-dev-')
          : rawAppUrl;

      const { todayYMD: bangkokTodayStr } = getBangkokNowYMDAndHM();
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
          text: text || 'ข้อความแจ้งเตือนจาก SheetCal LINE OA',
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
          text: text || 'ข้อความแจ้งเตือนจาก SheetCal LINE OA',
        };
      }

      const fallbackTextMessage = {
        type: 'text',
        text:
          text ||
          (taskTitle
            ? `🔔 แจ้งเตือนงาน: ${taskTitle}\n🗓️ วันที่: ${date || ''} เวลา ${time || ''} น.\n${description || ''}`
            : 'ข้อความแจ้งเตือนจาก SheetCal LINE OA'),
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
          text: `✅ [SheetCal LINE Diagnostic]\nทดสอบการเชื่อมต่อแจ้งเตือนสำเร็จ!\n🤖 บอท: ${
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

          // Also push workspaceTasks via sync_tasks so the Apps Script portal immediately has all tasks
          if (workspaceTasks.length > 0) {
            await fetch(scriptUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sync_tasks',
                targetGroupId: detectedGroupId || undefined,
                tasks: workspaceTasks,
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

  if (process.env.NODE_ENV !== 'production') {
    let viteMiddleware: express.RequestHandler | null = null;
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    }).then((vite) => {
      viteMiddleware = vite.middlewares;
      return vite;
    });

    app.use(async (req, res, next) => {
      try {
        if (!viteMiddleware) {
          await vitePromise;
        }
        if (viteMiddleware) {
          viteMiddleware(req, res, next);
        } else {
          next();
        }
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

