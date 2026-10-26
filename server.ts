import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';

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

function buildDailyDigestFlexMessage(
  dateStr: string,
  tasksList: DigestTaskItem[],
  appUrl: string
) {
  const totalCount = tasksList.length;
  const completedCount = tasksList.filter((t) => t.status === 'completed').length;
  const pendingCount = totalCount - completedCount;
  const highCount = tasksList.filter(
    (t) => t.priority === 'high' && t.status !== 'completed'
  ).length;
  const completionPct =
    totalCount > 0 ? Math.max(6, Math.round((completedCount / totalCount) * 100)) : 100;
  const readableDate = formatThaiDateReadable(dateStr);

  const taskRowBoxes =
    tasksList.length > 0
      ? tasksList.slice(0, 6).map((t) => {
          const isDone = t.status === 'completed';
          const isHigh = t.priority === 'high';
          const catColor =
            /^#[0-9A-Fa-f]{6}$/.test(t.categoryColor || '') ? t.categoryColor : '#2563EB';
          const statusLabel = isDone ? '✓ เสร็จแล้ว' : isHigh ? '🔥 ด่วนมาก' : '⏳ รอทำ';
          const statusColor = isDone ? '#16A34A' : isHigh ? '#DC2626' : '#64748B';

          return {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            margin: 'md',
            paddingAll: '12px',
            backgroundColor: isDone ? '#F8FAFC' : '#FFFFFF',
            cornerRadius: '12px',
            borderWidth: '1px',
            borderColor: isHigh && !isDone ? '#FECACA' : '#E2E8F0',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                width: '58px',
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
        })
      : [
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: '16px',
            backgroundColor: '#F8FAFC',
            cornerRadius: '10px',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '🎉 วันนี้ไม่มีงานค้างในตารางของคุณ',
                size: 'sm',
                color: '#475569',
                align: 'center',
                weight: 'bold',
              },
            ],
          },
        ];

  return {
    type: 'flex',
    altText: `📅 สรุปตารางงานประจำวัน (${readableDate}) — ทั้งหมด ${totalCount} งาน`,
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
                    text: 'SHEETCAL DAILY DIGEST',
                    color: '#FFFFFF',
                    size: 'xxs',
                    weight: 'bold',
                  },
                ],
              },
              {
                type: 'text',
                text: readableDate,
                color: '#94A3B8',
                size: 'xs',
                align: 'end',
                weight: 'bold',
              },
            ],
          },
          {
            type: 'text',
            text: 'สรุปตารางงานประจำวัน',
            color: '#FFFFFF',
            size: 'xl',
            weight: 'bold',
            margin: 'md',
          },
          {
            type: 'text',
            text:
              highCount > 0
                ? `มีงานด่วนสำคัญสูง ${highCount} รายการที่ต้องโฟกัสวันนี้`
                : 'ซิงค์ข้อมูลอัตโนมัติจาก Google Sheets ของคุณ',
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
                backgroundColor: '#FFFFFF',
                cornerRadius: '10px',
                paddingAll: '10px',
                borderWidth: '1px',
                borderColor: '#E2E8F0',
                contents: [
                  {
                    type: 'text',
                    text: String(totalCount),
                    size: 'xl',
                    weight: 'bold',
                    color: '#0F172A',
                    align: 'center',
                  },
                  {
                    type: 'text',
                    text: 'งานทั้งหมด',
                    size: 'xxs',
                    color: '#64748B',
                    align: 'center',
                    margin: 'xs',
                  },
                ],
              },
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
                    text: String(pendingCount),
                    size: 'xl',
                    weight: 'bold',
                    color: '#D97706',
                    align: 'center',
                  },
                  {
                    type: 'text',
                    text: 'รอดำเนินการ',
                    size: 'xxs',
                    color: '#B45309',
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
                    text: String(completedCount),
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
          {
            type: 'text',
            text: 'ตารางเวลา (TIMELINE)',
            size: 'xxs',
            weight: 'bold',
            color: '#64748B',
            margin: 'lg',
          },
          ...taskRowBoxes,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: '#FFFFFF',
        borderWidth: '1px',
        borderColor: '#F1F5F9',
        contents: [
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
        ],
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
        label: 'เปิดปฏิทินจัดการงาน',
        uri: params.appUrl,
      },
    });
  }
  if (showCalBtn) {
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
          size: 'xs',
          flex: 2,
        },
        {
          type: 'text',
          text: `${readableDate} (${params.date})`,
          color: '#0F172A',
          size: 'xs',
          weight: 'bold',
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
          size: 'xs',
          flex: 2,
        },
        {
          type: 'text',
          text: `${params.time} น.`,
          color: '#059669',
          size: 'sm',
          weight: 'bold',
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
          size: 'xs',
          flex: 2,
        },
        {
          type: 'text',
          text: params.categoryName || 'ทั่วไป',
          color: headerBg,
          size: 'xs',
          weight: 'bold',
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
            size: isCompact ? 'md' : 'lg',
            weight: 'bold',
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
                  size: 'xs',
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
                      size: 'xs',
                      weight: 'bold',
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
const pendingWebhookMessages: IncomingLineWebhookItem[] = [];
const sharedWorkspaces = new Map<string, CollaborativeWorkspaceState>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Real-time Collaborative Shared Calendar Workspace Endpoints
  app.get('/api/collab/workspace/:workspaceId', (req, res) => {
    const workspaceId = String(req.params.workspaceId || 'default').trim();
    const state = sharedWorkspaces.get(workspaceId);
    if (!state) {
      res.json({ exists: false, workspaceId });
      return;
    }
    res.json({ exists: true, workspace: state });
  });

  app.post('/api/collab/workspace/:workspaceId', (req, res) => {
    const workspaceId = String(req.params.workspaceId || 'default').trim();
    const { updatedBy, spreadsheetId, spreadsheetUrl, tasks, categories, teamMembers } =
      req.body || {};

    const existing = sharedWorkspaces.get(workspaceId);
    const nextState: CollaborativeWorkspaceState = {
      workspaceId,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || existing?.updatedBy || 'สมาชิกในทีม',
      spreadsheetId: spreadsheetId ?? existing?.spreadsheetId,
      spreadsheetUrl: spreadsheetUrl ?? existing?.spreadsheetUrl,
      tasks: Array.isArray(tasks) ? tasks : existing?.tasks || [],
      categories: Array.isArray(categories) ? categories : existing?.categories || [],
      teamMembers: Array.isArray(teamMembers) ? teamMembers : existing?.teamMembers || [],
    };
    sharedWorkspaces.set(workspaceId, nextState);
    res.json({ ok: true, workspace: nextState });
  });

  // Save runtime LINE OA credentials from the Web UI so the Webhook can reply automatically
  app.post('/api/line/config', (req, res) => {
    const { channelAccessToken, targetUserId } = req.body || {};
    if (typeof channelAccessToken === 'string') {
      runtimeChannelAccessToken = sanitizeToken(channelAccessToken);
    }
    if (typeof targetUserId === 'string') {
      runtimeDefaultUserId = targetUserId.trim();
    }
    res.json({ ok: true });
  });

  // Real LINE Official Account Webhook Endpoint
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
        if (event.type === 'message' && event.message?.type === 'text') {
          const userText = String(event.message.text || '').trim();
          const senderId = event.source?.userId || event.source?.groupId || '';
          if (senderId) {
            runtimeDefaultUserId = senderId;
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
            const todayStr = new Date().toISOString().slice(0, 10);
            const flexReply = buildSingleTaskReminderFlexMessage({
              taskTitle: userText.replace(/^(เพิ่มงาน|จดงาน|บันทึกงาน)\s*/i, ''),
              description: 'บันทึกลงปฏิทิน SheetCal LINE และซิงค์เข้า Google Sheets เรียบร้อยแล้ว',
              date: todayStr,
              time: '09:00',
              categoryName: 'บันทึกผ่านแชท LINE OA',
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

  // Poll endpoint for the Web App to consume real LINE Webhook messages
  app.get('/api/line/webhook-events', (_req, res) => {
    const items = pendingWebhookMessages.splice(0, pendingWebhookMessages.length);
    res.json({
      events: items,
      detectedUserId: runtimeDefaultUserId || undefined,
    });
  });

  // Server-side proxy to send rich LINE Official Account Flex Messages or Custom Text (Push or Broadcast)
  app.post('/api/line/push', async (req, res) => {
    try {
      const {
        channelAccessToken,
        to,
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
      } = req.body || {};

      const token = sanitizeToken(channelAccessToken || runtimeChannelAccessToken || '');
      const targetUserId = String(to || runtimeDefaultUserId || '').trim();

      if (token) runtimeChannelAccessToken = token;
      if (targetUserId) runtimeDefaultUserId = targetUserId;

      if (!token) {
        res.status(200).json({
          ok: false,
          simulated: true,
          message:
            'แสดงการ์ดแจ้งเตือนและสรุปงานบนห้องแชท LINE OA หน้าเว็บเรียบร้อยแล้ว! (หากต้องการให้เด้งเข้าแอป LINE ในมือถือจริง กรุณาวาง LINE Channel Access Token ในช่องตั้งค่า)',
        });
        return;
      }

      const appUrl =
        originUrl && String(originUrl).startsWith('http')
          ? String(originUrl)
          : process.env.APP_URL && process.env.APP_URL.startsWith('http')
          ? process.env.APP_URL
          : 'https://calendar.google.com';

      let flexMessage: unknown;
      if (Array.isArray(tasksList)) {
        flexMessage = buildDailyDigestFlexMessage(
          date || dateTime || new Date().toISOString().slice(0, 10),
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
          date: date || (dateTime ? String(dateTime).slice(0, 10) : new Date().toISOString().slice(0, 10)),
          time: time || '09:00',
          categoryName: categoryName || 'ทั่วไป',
          categoryColor: categoryColor || '#4F46E5',
          priority: priority || 'medium',
          appUrl,
          messageFormat: messageFormat === 'compact_flex' ? 'compact_flex' : 'executive_flex',
          includeDescription,
          includeGoogleCalendarButton,
          includeOpenAppButton,
          stats,
        });
      } else {
        flexMessage = {
          type: 'text',
          text: text || 'ข้อความแจ้งเตือนจาก SheetCal LINE OA',
        };
      }

      const messages = [flexMessage];
      const isValidLineTargetId = /^[UCR][0-9a-fA-F]{32}$/.test(targetUserId);

      if (isValidLineTargetId) {
        const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: targetUserId,
            messages,
          }),
        });

        if (pushRes.ok) {
          res.status(200).json({
            ok: true,
            simulated: false,
            mode: 'push',
            message: `ส่งการ์ดแจ้งเตือนดีไซน์ใหม่เข้าแอป LINE Official Account สำเร็จแล้ว!`,
          });
          return;
        }
      }

      // Fallback to Broadcast API
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
        res.status(200).json({
          ok: false,
          simulated: true,
          message: `ไม่สามารถส่งผ่าน LINE API ได้ (${
            errData?.message || `HTTP ${broadcastRes.status}`
          }) — กรุณาตรวจสอบ Channel Access Token`,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        simulated: false,
        mode: 'broadcast',
        message: 'ส่งการ์ดแจ้งเตือน Flex Message ดีไซน์ใหม่เข้าแอป LINE ของคุณสำเร็จแล้ว!',
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

      res.status(200).json({
        ok: isJsonOk,
        httpStatus: postRes.status,
        responsePreview: bodyText.slice(0, 300),
        message: isJsonOk
          ? testText
            ? `ส่งข้อความ "${testText}" เข้า Google Apps Script สำเร็จ (เขียนลง Google Sheets เรียบร้อย!)`
            : 'ตรวจสอบสำเร็จ! ลิงก์ Google Apps Script ของคุณพร้อมรับข้อความจาก LINE 100% (ตอบกลับ {"status":"verified"})'
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
