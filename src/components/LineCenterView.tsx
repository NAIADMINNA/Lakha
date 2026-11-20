import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Code2,
  Copy,
  ExternalLink,
  Filter,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Category,
  FlexDigestItem,
  LineMessageLog,
  LineNotificationFormat,
  LineSettings,
  Task,
  TaskPriority,
  TaskStatus,
  TelegramTemplateStyle,
} from '../types';
import {
  REMINDER_TIMING_OPTIONS,
  consolidateContinuousTasks,
  doesTaskTriggerNotification,
  formatLineDeliveryErrorThai,
  formatLocalDateYMD,
  formatLocalTimeHM,
  formatRemindMinutesLabel,
  formatSummaryCardHeaderDate,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  generateGoogleAppsScriptCode,
  getPriorityHeaderTheme,
  isLineQuotaLimitError,
  renderCustomLineMessage,
  resolveTeamCalendarAppUrl,
} from '../services/lineCommandParser';
import {
  DEFAULT_TELEGRAM_HEADER_TITLE,
  TelegramDetectedChat,
  buildShortDigestPhotoCaption,
  buildShortTaskPhotoCaption,
  buildTelegramActionButtons,
  detectTelegramChats,
  escapeTelegramHtml,
  formatDailyDigestTelegramHtml,
  formatSingleTaskTelegramHtml,
  isTelegramConfigured,
  parseTelegramChatIds,
  sendTelegramNotification,
  sendTelegramPhotoCard,
} from '../services/telegramService';
import {
  renderDailyDigestTelegramCardPng,
  renderSingleTaskTelegramCardPng,
  renderTestConnectionCardPng,
} from '../services/telegramCardRenderer';
import { DEFAULT_GAS_WEB_APP_URL } from '../data/initialData';

interface LineCenterViewProps {
  logs: LineMessageLog[];
  categories: Category[];
  tasks: Task[];
  lineSettings: LineSettings;
  spreadsheetId: string;
  spreadsheetUrl?: string;
  onUpdateSettings: (newSettings: LineSettings) => void;
  onSendChatCommand: (text: string) => void;
  onTestPushNotification: () => Promise<void>;
  onTestSingleTaskNotification?: (sampleTask: Task) => Promise<void>;
  onOpenDateInCalendar: (dateStr: string) => void;
  onPullFromSheets?: () => Promise<void>;
  onCreateSpreadsheet?: () => Promise<void>;
  isSendingPush: boolean;
  isSyncing?: boolean;
}

const TEMPLATE_VARIABLES: { token: string; label: string }[] = [
  { token: '{title}', label: 'ชื่องาน' },
  { token: '{date}', label: 'วันที่' },
  { token: '{time}', label: 'เวลา' },
  { token: '{category}', label: 'หมวดหมู่' },
  { token: '{priority}', label: 'ความสำคัญ' },
  { token: '{remindBefore}', label: 'เวลาเตือนล่วงหน้า' },
  { token: '{description}', label: 'รายละเอียด' },
];

const TELEGRAM_STYLE_PRESETS: {
  id: TelegramTemplateStyle;
  title: string;
  subtitle: string;
  badge?: string;
}[] = [
  {
    id: 'executive_card',
    title: 'การ์ดผู้บริหาร',
    subtitle: 'หัวหน่วยงาน + กล่องการ์ด Quote + ป้ายเวลาเด่นชัด',
    badge: 'แนะนำ',
  },
  {
    id: 'compact_brief',
    title: 'กระชับ อ่านไว',
    subtitle: 'สั้น ชัดเจน ในกล่องเดียว เหมาะกับกลุ่มงานที่ส่งบ่อย',
  },
  {
    id: 'timeline_digest',
    title: 'ไทม์ไลน์ เช้า–บ่าย–เย็น',
    subtitle: 'แยกช่วงเวลาอัตโนมัติ พร้อมแถบสรุปและกล่องรายละเอียด',
  },
];

function decodeTelegramPreviewEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderTelegramInlineNodes(raw: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /<(b|i|code|s)>([\s\S]*?)<\/\1>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-t-${idx++}`}>
          {decodeTelegramPreviewEntities(raw.slice(lastIndex, match.index))}
        </React.Fragment>
      );
    }
    const tag = match[1];
    const inner = match[2];
    const childKey = `${keyPrefix}-${tag}-${idx++}`;
    if (tag === 'b') {
      nodes.push(
        <strong key={childKey} className="font-semibold text-slate-900">
          {renderTelegramInlineNodes(inner, childKey)}
        </strong>
      );
    } else if (tag === 'i') {
      nodes.push(
        <em key={childKey} className="italic text-slate-600">
          {renderTelegramInlineNodes(inner, childKey)}
        </em>
      );
    } else if (tag === 'code') {
      nodes.push(
        <code
          key={childKey}
          className="inline-block rounded bg-[#0088cc]/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#006699] tabular-nums"
        >
          {decodeTelegramPreviewEntities(inner)}
        </code>
      );
    } else if (tag === 's') {
      nodes.push(
        <span key={childKey} className="line-through text-slate-400">
          {renderTelegramInlineNodes(inner, childKey)}
        </span>
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < raw.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-end`}>
        {decodeTelegramPreviewEntities(raw.slice(lastIndex))}
      </React.Fragment>
    );
  }
  return nodes;
}

function renderTelegramMultilineText(raw: string, keyPrefix: string): React.ReactNode {
  const lines = raw.split('\n');
  return lines.map((line, i) => (
    <React.Fragment key={`${keyPrefix}-ln-${i}`}>
      {renderTelegramInlineNodes(line, `${keyPrefix}-ln-${i}`)}
      {i < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}

function renderTelegramPreviewBlocks(htmlText: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const quoteRegex = /<blockquote(\s+expandable)?>([\s\S]*?)<\/blockquote>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = quoteRegex.exec(htmlText)) !== null) {
    const before = htmlText.slice(lastIndex, match.index).replace(/^\n+|\n+$/g, '');
    if (before) {
      blocks.push(
        <div key={`tg-txt-${idx++}`} className="text-[12.5px] leading-relaxed text-slate-800">
          {renderTelegramMultilineText(before, `tg-txt-${idx}`)}
        </div>
      );
    }
    const isExpandable = Boolean(match[1]);
    const quoteBody = match[2].replace(/^\n+|\n+$/g, '');
    blocks.push(
      <div
        key={`tg-qt-${idx++}`}
        className="my-1.5 rounded-r-lg border-l-[3px] border-[#0088cc] bg-[#eaf5fc] px-2.5 py-2 text-[12px] leading-relaxed text-slate-800"
      >
        <div>{renderTelegramMultilineText(quoteBody, `tg-qt-${idx}`)}</div>
        {isExpandable && (
          <div className="mt-1 text-[10px] font-medium text-[#0077b3]">
            ▾ แตะเพื่อขยาย/ย่อในแอป Telegram
          </div>
        )}
      </div>
    );
    lastIndex = quoteRegex.lastIndex;
  }

  const after = htmlText.slice(lastIndex).replace(/^\n+|\n+$/g, '');
  if (after) {
    blocks.push(
      <div key={`tg-tail-${idx++}`} className="text-[12.5px] leading-relaxed text-slate-800">
        {renderTelegramMultilineText(after, `tg-tail-${idx}`)}
      </div>
    );
  }
  return blocks;
}

export const LineCenterView: React.FC<LineCenterViewProps> = ({
  logs,
  categories,
  tasks,
  lineSettings,
  spreadsheetId,
  spreadsheetUrl,
  onUpdateSettings,
  onSendChatCommand,
  onTestPushNotification,
  onTestSingleTaskNotification,
  onOpenDateInCalendar,
  onPullFromSheets,
  onCreateSpreadsheet,
  isSendingPush,
  isSyncing = false,
}) => {
  const [chatInput, setChatInput] = useState('');
  const [copiedScript, setCopiedScript] = useState(false);
  const [showScriptPanel, setShowScriptPanel] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<
    'timing' | 'format' | 'triggers' | 'api' | 'telegram'
  >('format');
  const [isDetectingTelegram, setIsDetectingTelegram] = useState(false);
  const [telegramDetectResult, setTelegramDetectResult] = useState<{
    ok: boolean;
    botUsername?: string;
    chats: TelegramDetectedChat[];
    message: string;
  } | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [showTelegramGuide, setShowTelegramGuide] = useState(false);
  const [telegramPreviewMode, setTelegramPreviewMode] = useState<'task' | 'digest'>('task');
  const [telegramPreviewCardUrl, setTelegramPreviewCardUrl] = useState<string | null>(null);
  const [isSyncingTgToGas, setIsSyncingTgToGas] = useState(false);
  const [tgGasSyncStatus, setTgGasSyncStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [gasUrl, setGasUrl] = useState(() => {
    try {
      const saved = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
      if (
        !saved ||
        saved.includes('AKfycby0gvQ') ||
        saved.includes('AKfycbxIf9k')
      ) {
        return DEFAULT_GAS_WEB_APP_URL;
      }
      return saved;
    } catch {
      return DEFAULT_GAS_WEB_APP_URL;
    }
  });
  const [isTestingGas, setIsTestingGas] = useState(false);
  const [gasVerifyResult, setGasVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [isDiagnosingLine, setIsDiagnosingLine] = useState(false);
  const [lineDiagnosticResult, setLineDiagnosticResult] = useState<{
    ok: boolean;
    steps: { step: string; status: 'ok' | 'warn' | 'error'; detail: string }[];
  } | null>(null);
  const [isClearingRichMenu, setIsClearingRichMenu] = useState(false);
  const [richMenuClearStatus, setRichMenuClearStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<'checking' | 'fullstack' | 'static_web'>('checking');
  const [lineQuotaInfo, setLineQuotaInfo] = useState<{
    loading: boolean;
    limit: number | null;
    totalUsage: number;
    remaining: number | null;
    isExhausted: boolean;
    checked: boolean;
  }>({
    loading: false,
    limit: null,
    totalUsage: 0,
    remaining: null,
    isExhausted: false,
    checked: false,
  });
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const fetchLineQuota = async () => {
    const token = lineSettings.channelAccessToken.trim();
    const trimmedGas = gasUrl.trim();
    if (token.length < 40) return;

    setLineQuotaInfo((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/line/quota', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelAccessToken: token }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data.ok) {
          setLineQuotaInfo({
            loading: false,
            limit: typeof data.limit === 'number' ? data.limit : null,
            totalUsage: typeof data.totalUsage === 'number' ? data.totalUsage : 0,
            remaining: typeof data.remaining === 'number' ? data.remaining : null,
            isExhausted: Boolean(data.isExhausted),
            checked: true,
          });
          return;
        }
      }
    } catch {
      // Fallback to Google Apps Script on static hosting
    }

    if (trimmedGas.startsWith('https://script.google.com/macros/s/')) {
      try {
        const gasRes = await fetch(trimmedGas, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'check_quota',
            channelAccessToken: token,
          }),
        });
        const gasData = JSON.parse(await gasRes.text());
        if (gasData && gasData.mode === 'gas_check_quota' && gasData.ok) {
          setLineQuotaInfo({
            loading: false,
            limit: typeof gasData.limit === 'number' ? gasData.limit : null,
            totalUsage: typeof gasData.totalUsage === 'number' ? gasData.totalUsage : 0,
            remaining: typeof gasData.remaining === 'number' ? gasData.remaining : null,
            isExhausted: Boolean(gasData.isExhausted),
            checked: true,
          });
          return;
        }
      } catch {
        // Ignore if older GAS version does not yet have check_quota
      }
    }

    setLineQuotaInfo((prev) => ({ ...prev, loading: false }));
  };

  const handleClearLineRichMenu = async (silent = false) => {
    const token = lineSettings.channelAccessToken.trim();
    const targetUserId = lineSettings.targetUserId.trim();
    const trimmedGas = gasUrl.trim();

    if (!token && !silent) {
      setActiveSettingsTab('api');
      setRichMenuClearStatus({
        ok: false,
        message:
          '⚠️ กรุณาวาง LINE Channel Access Token ในช่องตั้งค่าด้านล่างก่อน แล้วกดปุ่ม "ลบ Rich Menu ออกจาก LINE OA" อีกครั้ง (หรือหากเป็นริชเมนูที่เปิดไว้ในเว็บ manager.line.biz ให้เข้าไปปิดที่เมนู "ริชเมนู" ในเว็บ LINE OA Manager ได้เลยครับ)',
      });
      return;
    }

    if (!silent) {
      setIsClearingRichMenu(true);
      setRichMenuClearStatus(null);
    }

    try {
      // 1. Try server-side endpoint (/api/line/richmenu/clear)
      const res = await fetch('/api/line/richmenu/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelAccessToken: token,
          targetUserId,
        }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (!silent) {
          setRichMenuClearStatus({
            ok: Boolean(data.ok),
            message:
              data.message ||
              '✅ ลบและยกเลิกการผูก Rich Menu บน LINE OA สำเร็จแล้ว! กรุณากดออกจากห้องแชทบอทในแอป LINE แล้วกดเข้าใหม่อีกครั้ง',
          });
          setIsClearingRichMenu(false);
        }
        return;
      }
    } catch {
      // Fallback to Google Apps Script bridge when running on GitHub Pages
    }

    // 2. Static Hosting / GitHub Pages fallback via Google Apps Script Bridge
    if (trimmedGas.startsWith('https://script.google.com/macros/s/')) {
      try {
        const gasRes = await fetch(trimmedGas, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'clear_richmenu',
            channelAccessToken: token,
            targetUserId,
          }),
        });
        const gasText = await gasRes.text();
        let gasData: Record<string, unknown> = {};
        try {
          gasData = JSON.parse(gasText);
        } catch {
          gasData = {};
        }

        if (!silent) {
          if (gasData.mode === 'gas_clear_richmenu' && gasData.ok) {
            setRichMenuClearStatus({
              ok: true,
              message: `✅ สั่งลบ Rich Menu ผ่าน Google Apps Script สำเร็จแล้ว (ลบไป ${
                gasData.deletedCount || 0
              } รายการ)! กรุณาปิดห้องแชทในแอป LINE แล้วเปิดเข้าใหม่อีกครั้ง (หมายเหตุ: หากยังแสดงอยู่ แปลว่าเป็นริชเมนูที่สร้างในเว็บ manager.line.biz ให้ไปปิดที่เมนู "ริชเมนู" ในเว็บ LINE OA Manager ครับ)`,
            });
          } else {
            setRichMenuClearStatus({
              ok: true,
              message:
                'ส่งคำสั่งยกเลิก Rich Menu แล้ว — หากคุณใช้บน GitHub Pages กรุณาคัดลอกโค้ด Apps Script ด้านล่างไปอัปเดตเป็น New version หรือเข้าไปปิดสวิตช์ริชเมนูที่เว็บ manager.line.biz > เมนู "ริชเมนู (Rich menus)" ครับ',
            });
          }
        }
      } catch {
        if (!silent) {
          setRichMenuClearStatus({
            ok: false,
            message:
              'ไม่สามารถติดต่อ Google Apps Script เพื่อลบ Rich Menu ได้ กรุณาตรวจสอบลิงก์ Apps Script หรือเข้าไปปิดริชเมนูที่เว็บ manager.line.biz > เมนู "ริชเมนู"',
          });
        }
      }
    }

    if (!silent) {
      setIsClearingRichMenu(false);
    }
  };

  useEffect(() => {
    if (lineSettings.channelAccessToken.trim().length >= 80) {
      handleClearLineRichMenu(true).catch(() => {});
      fetchLineQuota().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSettings.channelAccessToken]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => {
        const ct = res.headers.get('content-type') || '';
        if (!cancelled) {
          setRuntimeMode(res.ok && ct.includes('application/json') ? 'fullstack' : 'static_web');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeMode('static_web');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDiagnoseLineApi = async (sendTest = true) => {
    setIsDiagnosingLine(true);
    setLineDiagnosticResult(null);
    const token = lineSettings.channelAccessToken.trim();
    const rawUserId = lineSettings.targetUserId.trim();
    const rawGroupId = (lineSettings.targetGroupId || '').trim();
    const activeMode = lineSettings.teamNotificationMode || 'both';
    const isValidUserIdFormat = /^[UCR][0-9a-fA-F]{32}$/.test(rawUserId);
    const isValidGroupIdFormat = /^[CR][0-9a-fA-F]{32}$/.test(rawGroupId);
    const trimmedGas = gasUrl.trim();

    try {
      // 1. Try server-side real LINE API diagnostic (/api/line/diagnose)
      const res = await fetch('/api/line/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelAccessToken: token,
          targetUserId: rawUserId,
          targetGroupId: rawGroupId,
          teamNotificationMode: activeMode,
          sendTest,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        const serverSteps: { step: string; status: 'ok' | 'warn' | 'error'; detail: string }[] = [
          {
            step: '0. ตรวจสอบสภาพแวดล้อมที่รันอยู่ (Runtime Environment)',
            status: 'ok',
            detail:
              'กำลังรันบนโหมด Full-Stack Server (มี Backend /api/line/push) จึงยิงตรงเข้าเซิร์ฟเวอร์ LINE ได้ทันที — แต่หากคุณนำขึ้นเว็บจริง (GitHub Pages) ตัวเว็บจะไม่มี Backend Server และต้องส่งผ่านลิงก์ Google Apps Script ด้านล่างแทน',
          },
          ...(Array.isArray(data.steps) ? data.steps : []),
        ];

        // Also check if the user's Google Apps Script URL is updated for GitHub Pages!
        if (trimmedGas.startsWith('https://script.google.com/macros/s/')) {
          try {
            const gasRes = await fetch(trimmedGas, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ action: 'check_bridge' }),
            });
            const gasText = await gasRes.text();
            let gasJson: Record<string, unknown> = {};
            try {
              gasJson = JSON.parse(gasText);
            } catch {
              gasJson = {};
            }
            const gasDetectedGroup =
              typeof gasJson.detectedGroupId === 'string' ? gasJson.detectedGroupId.trim() : '';
            if (gasDetectedGroup && /^[CR][0-9a-fA-F]{32}$/.test(gasDetectedGroup) && !rawGroupId) {
              onUpdateSettings({
                ...lineSettings,
                targetGroupId: gasDetectedGroup,
              });
            }
            const realGasVer = String(
              gasJson.cardDesignVersion || gasJson.version || ''
            ).trim();
            const isV3Card =
              realGasVer === '3.0-executive-card' || realGasVer.startsWith('3.');
            if (
              isV3Card ||
              gasJson.mode === 'gas_bridge_ready' ||
              realGasVer.startsWith('2.')
            ) {
              serverSteps.push({
                step: '4. ตรวจสอบเวอร์ชัน Google Apps Script Bridge',
                status: isV3Card ? 'ok' : 'warn',
                detail: isV3Card
                  ? `ลิงก์ Google Apps Script เป็นเวอร์ชันล่าสุดแล้ว (${realGasVer} — ดีไซน์การ์ดผู้บริหาร v3.0)${
                      gasDetectedGroup ? ` · ตรวจพบรหัสกลุ่มล่าสุด: ${gasDetectedGroup}` : ''
                    }`
                  : `ลิงก์เชื่อมต่อส่งงานได้แล้ว แต่ยังรันเวอร์ชันเก่า (${
                      realGasVer || 'ก่อน v3.0'
                    }) จึงยังส่งการ์ดดีไซน์เดิม — หากกด New deployment ไปแล้วให้นำลิงก์ /exec อันใหม่มาวางทับ หรือกด Manage deployments > รูปดินสอ > เลือก New version บนลิงก์เดิม`,
              });
            } else {
              serverSteps.push({
                step: '4. ตรวจสอบเวอร์ชัน Google Apps Script Bridge',
                status: 'warn',
                detail:
                  '⚠️ ลิงก์ Google Apps Script ปัจจุบันของคุณยังเป็นโค้ดเวอร์ชันเก่า — กรุณากดปุ่ม "คัดลอกโค้ด Apps Script ล่าสุด (v3.0)" ด้านล่าง ไปวางทับใน Google Sheets > Extensions > Apps Script แล้วกด Deploy > Manage deployments > แก้ไข (รูปดินสอ) > เลือก Version: New version > กด Deploy',
              });
            }
          } catch {
            serverSteps.push({
              step: '4. ตรวจสอบความพร้อมสำหรับรันบนเว็บจริง (GitHub Pages Bridge)',
              status: 'warn',
              detail:
                'ไม่สามารถอ่านค่าตอบกลับจากลิงก์ Google Apps Script ได้ กรุณาตรวจสอบว่าตั้งค่า Deploy > Who has access เป็น Anyone และอัปเดตเป็น New version แล้ว',
            });
          }
        }

        setLineDiagnosticResult({
          ok: Boolean(data.ok),
          steps: serverSteps,
        });
        setIsDiagnosingLine(false);
        return;
      }
    } catch {
      // Fallback to static web / GitHub Pages diagnostic
    }

    // 2. Diagnostic when running on GitHub Pages (Static Hosting without Node.js backend)
    const steps: { step: string; status: 'ok' | 'warn' | 'error'; detail: string }[] = [
      {
        step: '0. ตรวจสอบสภาพแวดล้อมที่รันอยู่ (GitHub Pages / Static Web)',
        status: 'ok',
        detail:
          'เว็บกำลังรันแบบ Static Hosting (ไม่มีเซิร์ฟเวอร์ /api/line/push ในตัว และเบราว์เซอร์ยิงตรงไปหา api.line.me ไม่ได้เพราะติด CORS ของ LINE) ระบบจึงใช้ลิงก์ Google Apps Script Web App ของคุณเป็นสะพานส่งแจ้งเตือนเข้า LINE',
      },
    ];

    if (!token) {
      steps.push({
        step: '1. ตรวจสอบ LINE Channel Access Token',
        status: 'error',
        detail:
          'ยังไม่ได้วาง LINE Channel Access Token บนเว็บหน้านี้ (ข้อมูลที่กรอกไว้ใน AI Studio จะไม่ได้ตามมาที่เว็บ GitHub Pages อัตโนมัติเพราะเก็บแยกตามโดเมนเบราว์เซอร์) กรุณาวาง Channel Access Token ที่หน้าเว็บนี้อีกครั้ง',
      });
      setLineDiagnosticResult({ ok: false, steps });
      setIsDiagnosingLine(false);
      return;
    }

    if (token.length < 80) {
      steps.push({
        step: '1. ตรวจสอบรูปแบบ LINE Channel Access Token',
        status: 'warn',
        detail: `ความยาว Token สั้นผิดปกติ (${token.length} ตัวอักษร) — Channel Access Token (Long-lived) ของ LINE ปกติจะมีความยาวประมาณ 170+ ตัวอักษร (ไม่ใช่ Channel Secret หรือ Channel ID)`,
      });
    } else {
      steps.push({
        step: '1. ตรวจสอบรูปแบบ LINE Channel Access Token',
        status: 'ok',
        detail: `พบ Channel Access Token ความยาว ${token.length} ตัวอักษร รูปแบบถูกต้อง`,
      });
    }

    if (!rawUserId) {
      steps.push({
        step: '2. ตรวจสอบ LINE User ID',
        status: 'ok',
        detail:
          'เว้นว่างไว้ (โหมด Broadcast) — ระบบจะส่งแจ้งเตือนหาทุกคนที่แอด LINE OA นี้เป็นเพื่อนอัตโนมัติ',
      });
    } else if (!isValidUserIdFormat) {
      steps.push({
        step: '2. ตรวจสอบรูปแบบ LINE User ID',
        status: 'error',
        detail: `ค่าที่ระบุ ("${rawUserId}") ไม่ใช่รหัส Webhook User ID 33 ตัวอักษร! รหัสที่ถูกต้องต้องขึ้นต้นด้วย U ตามด้วยรหัส 32 ตัวอักษร (เช่น U4af4980629...) แนะนำให้กดปุ่ม "ล้างค่า (ใช้ Broadcast แทน)"`,
      });
    } else {
      steps.push({
        step: '2. ตรวจสอบรูปแบบ LINE User ID',
        status: 'ok',
        detail: `รหัส ${rawUserId.slice(0, 10)}... ตรงตามรูปแบบ 33 ตัวอักษรของ LINE Messaging API`,
      });
    }

    if (!trimmedGas.startsWith('https://script.google.com/macros/s/')) {
      steps.push({
        step: '3. ตรวจสอบตัวกลางส่ง LINE บน GitHub Pages (Google Apps Script)',
        status: 'error',
        detail:
          'กรุณาวางลิงก์ Web App URL ของ Google Apps Script ด้านล่าง (ที่ลงท้ายด้วย /exec) เพื่อให้เว็บบน GitHub Pages ใช้ส่งข้อความเข้า LINE',
      });
      setLineDiagnosticResult({ ok: false, steps });
      setIsDiagnosingLine(false);
      return;
    }

    if (sendTest) {
      try {
        // Call without no-cors first using text/plain so we can read Google Apps Script's JSON response!
        const gasRes = await fetch(trimmedGas, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'push_line',
            diagnose: true,
            channelAccessToken: token,
            to: isValidUserIdFormat ? rawUserId : '',
            targetGroupId: isValidGroupIdFormat ? rawGroupId : '',
            teamNotificationMode: activeMode,
            text: `✅ [ระบบน้องเลขา Diagnostic - Web]\nทดสอบส่งแจ้งเตือนจากหน้าเว็บจริงผ่าน Google Apps Script สำเร็จ!\n⏰ เวลา: ${new Date().toLocaleTimeString('th-TH')} น.`,
          }),
        });
        const gasText = await gasRes.text();
        let gasData: Record<string, unknown> = {};
        try {
          gasData = JSON.parse(gasText);
        } catch {
          gasData = {};
        }

        if (gasData.mode === 'gas_push_line') {
          if (gasData.ok) {
            steps.push({
              step: '3. ผลส่งข้อความเข้า LINE ผ่าน Google Apps Script Bridge',
              status: 'ok',
              detail: `สำเร็จ! ส่งเข้า LINE OA ${gasData.botName ? `"${gasData.botName}" ` : ''}ผ่านโหมด ${gasData.deliveryMethod} (HTTP ${gasData.lineHttpCode || 200}) — กรุณาเช็คข้อความในแอป LINE ของคุณได้เลย`,
            });
            setLineDiagnosticResult({ ok: true, steps });
          } else {
            const isMonthlyFull =
              Boolean(gasData.quotaExceeded) || isLineQuotaLimitError(gasData.lineError);
            steps.push({
              step: '3. ผลส่งข้อความเข้า LINE ผ่าน Google Apps Script Bridge',
              status: 'error',
              detail: isMonthlyFull
                ? formatLineDeliveryErrorThai(gasData.lineError, 'Google Apps Script')
                : `Google Apps Script เชื่อมต่อได้แล้ว แต่ LINE API ปฏิเสธคำขอ (HTTP ${gasData.lineHttpCode}): ${String(gasData.lineError || 'ตรวจสอบ Channel Access Token หรือการแอดเพื่อนบอท')}`,
            });
            setLineDiagnosticResult({ ok: false, steps });
          }
        } else {
          // Old Apps Script code returned {"status":"verified"} without executing push_line!
          steps.push({
            step: '3. ตรวจพบสาเหตุที่เว็บไม่ส่งแจ้งเตือนเข้า LINE!',
            status: 'error',
            detail:
              '❌ ลิงก์ Google Apps Script ของคุณยังเป็น "โค้ดเวอร์ชันเก่า" (ตอบกลับเป็น {"status":"verified"} โดยยังไม่มีคำสั่ง push_line สำหรับส่งเข้า LINE) — วิธีแก้: 1) กดปุ่ม "คัดลอกโค้ด Apps Script" ด้านล่าง 2) ไปวางทับใน Google Sheets > Extensions > Apps Script 3) กดปุ่ม Deploy > Manage deployments > กดรูปดินสอ (Edit) > ช่อง Version เลือก "New version" > กด Deploy',
          });
          setLineDiagnosticResult({ ok: false, steps });
        }
      } catch {
        steps.push({
          step: '3. ทดสอบส่งข้อความเข้าแอป LINE ผ่าน Google Apps Script',
          status: 'error',
          detail:
            'ไม่สามารถเชื่อมต่อลิงก์ Google Apps Script ได้ กรุณาตรวจสอบว่าตั้งค่า Deploy > Who has access เป็น "Anyone (ทุกคน)" และเลือก New version แล้ว',
        });
        setLineDiagnosticResult({ ok: false, steps });
      }
    } else {
      setLineDiagnosticResult({ ok: true, steps });
    }
    setIsDiagnosingLine(false);
  };

  const [gasCardVersionInfo, setGasCardVersionInfo] = useState<{
    checking: boolean;
    status: 'idle' | 'up_to_date' | 'outdated' | 'unreachable';
    detectedVersion: string;
  }>({
    checking: false,
    status: 'idle',
    detectedVersion: '',
  });

  const checkLiveGasCardVersion = async (targetGasUrl?: string) => {
    const urlToCheck = (targetGasUrl ?? gasUrl).trim();
    if (!urlToCheck.startsWith('https://script.google.com/macros/s/')) {
      setGasCardVersionInfo({
        checking: false,
        status: 'idle',
        detectedVersion: '',
      });
      return;
    }

    setGasCardVersionInfo((prev) => ({ ...prev, checking: true }));
    try {
      const sep = urlToCheck.includes('?') ? '&' : '?';
      const res = await fetch(`${urlToCheck}${sep}format=json&_t=${Date.now()}`);
      const data = await res.json();
      const ver = String(data?.cardDesignVersion || data?.version || '').trim();
      const caps = Array.isArray(data?.capabilities) ? data.capabilities : [];
      const isV3 =
        ver === '3.0-executive-card' ||
        ver.startsWith('3.') ||
        caps.includes('executive_card_v3');
      setGasCardVersionInfo({
        checking: false,
        status: isV3 ? 'up_to_date' : 'outdated',
        detectedVersion: ver || 'เวอร์ชันเก่า (ก่อน v3.0)',
      });
    } catch {
      setGasCardVersionInfo({
        checking: false,
        status: 'unreachable',
        detectedVersion: '',
      });
    }
  };

  useEffect(() => {
    try {
      if (gasUrl.trim()) {
        localStorage.setItem('sheetcal_gas_url_v1', gasUrl.trim());
      }
    } catch {
      // Ignore storage error
    }
    checkLiveGasCardVersion(gasUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasUrl]);

  const todayStr = useMemo(() => formatLocalDateYMD(), []);

  const summaryMetrics = useMemo(() => {
    const todayTasks = tasks.filter((t) => t.date === todayStr);
    const pendingAll = tasks.filter((t) => t.status !== TaskStatus.COMPLETED);
    const completedAll = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
    const highPending = pendingAll.filter((t) => t.priority === TaskPriority.HIGH);
    return {
      total: tasks.length,
      todayCount: todayTasks.length,
      pendingCount: pendingAll.length,
      completedCount: completedAll.length,
      highCount: highPending.length,
    };
  }, [tasks, todayStr]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChatCommand(chatInput.trim());
    setChatInput('');
  };

  const resolvedCalendarButtonUrl = useMemo(
    () =>
      resolveTeamCalendarAppUrl({
        customPublicUrl: lineSettings.publicCalendarUrl,
        spreadsheetId,
        date: todayStr,
      }),
    [lineSettings.publicCalendarUrl, spreadsheetId, todayStr]
  );

  const appsScriptCode = generateGoogleAppsScriptCode(
    spreadsheetId,
    lineSettings.channelAccessToken,
    resolvedCalendarButtonUrl,
    {
      botToken: lineSettings.telegramBotToken,
      chatId: lineSettings.telegramChatId,
      headerTitle: lineSettings.telegramHeaderTitle,
      reminderTimings:
        lineSettings.reminderTimings && lineSettings.reminderTimings.length > 0
          ? lineSettings.reminderTimings
          : [lineSettings.defaultRemindMinutes || 15],
      dailyDigestEnabled: lineSettings.dailyDigestEnabled !== false,
      dailyDigestTime: lineSettings.dailyDigestTime || '08:00',
      showStats: lineSettings.telegramShowStats !== false,
      showButtons: lineSettings.telegramShowButtons !== false,
    }
  );

  const telegramReady = useMemo(() => isTelegramConfigured(lineSettings), [lineSettings]);

  const handleDetectTelegramChats = async () => {
    const token = (lineSettings.telegramBotToken || '').trim();
    if (!token && runtimeMode !== 'fullstack') {
      setTelegramDetectResult({
        ok: false,
        chats: [],
        message: 'กรุณาวาง Telegram Bot Token จาก @BotFather ก่อนกดค้นหา Chat ID ครับ',
      });
      return;
    }
    setIsDetectingTelegram(true);
    setTelegramDetectResult(null);
    try {
      const res = await detectTelegramChats(token, gasUrl);
      setTelegramDetectResult({
        ok: res.ok,
        botUsername: res.botUsername,
        chats: res.chats,
        message: res.message,
      });
      if (res.ok && res.chats.length === 1 && !(lineSettings.telegramChatId || '').trim()) {
        onUpdateSettings({
          ...lineSettings,
          telegramEnabled: true,
          telegramChatId: res.chats[0].chatId,
        });
      }
    } finally {
      setIsDetectingTelegram(false);
    }
  };

  const handleSelectDetectedTelegramChat = (chatId: string, append = false) => {
    const existing = parseTelegramChatIds(lineSettings.telegramChatId || '');
    const nextIds = append
      ? Array.from(new Set([...existing, chatId]))
      : [chatId];
    onUpdateSettings({
      ...lineSettings,
      telegramEnabled: true,
      telegramChatId: nextIds.join(', '),
    });
  };

  const handleTestTelegramSend = async () => {
    const token = (lineSettings.telegramBotToken || '').trim();
    const chatId = (lineSettings.telegramChatId || '').trim();
    if ((!token && runtimeMode !== 'fullstack') || !chatId) {
      setTelegramTestStatus({
        ok: false,
        message: 'กรุณากรอก Bot Token และ Chat ID ให้ครบก่อนกดทดสอบส่งครับ',
      });
      return;
    }

    setIsTestingTelegram(true);
    setTelegramTestStatus(null);
    try {
      const activeHeader = (
        lineSettings.telegramHeaderTitle || DEFAULT_TELEGRAM_HEADER_TITLE
      ).trim();
      const nowHM = formatLocalTimeHM();
      const testHtml = [
        `🏛 <b>${escapeTelegramHtml(activeHeader)}</b>`,
        `✅ <b>ทดสอบเชื่อมต่อ Telegram Bot สำเร็จ!</b>`,
        `<blockquote>✨ ระบบน้องเลขาพร้อมส่งแจ้งเตือนตารางงานและสรุปงานประจำวันเข้าห้องนี้ <b>ฟรีไม่จำกัดข้อความ</b>\n🕒 เวลาทดสอบ: <code>${escapeTelegramHtml(nowHM)} น.</code></blockquote>`,
        lineSettings.telegramShowStats !== false
          ? `📊 <i>ตารางงานปัจจุบัน: ทั้งหมด ${summaryMetrics.total} งาน · วันนี้ ${summaryMetrics.todayCount} งาน · รอทำ ${summaryMetrics.pendingCount} งาน</i>`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const testButtons = buildTelegramActionButtons({
        calendarUrl: resolvedCalendarButtonUrl,
        includeCalendarButton: true,
        includeTvButton: true,
        showButtons: lineSettings.telegramShowButtons !== false,
      });

      let result;
      if (lineSettings.telegramDeliveryMode !== 'text_html') {
        const photoDataUrl = await renderTestConnectionCardPng({
          headerTitle: activeHeader,
          nowHM,
          summaryStats: {
            total: summaryMetrics.total,
            todayCount: summaryMetrics.todayCount,
            pendingCount: summaryMetrics.pendingCount,
          },
          showStats: lineSettings.telegramShowStats !== false,
        });
        result = await sendTelegramPhotoCard({
          botToken: token,
          chatId,
          photoDataUrl,
          captionHtml: `✅ <b>ทดสอบเชื่อมต่อ Telegram Bot สำเร็จ!</b> · <code>${escapeTelegramHtml(nowHM)} น.</code>`,
          fallbackHtmlText: testHtml,
          buttons: testButtons,
          gasUrl,
        });
      } else {
        result = await sendTelegramNotification({
          botToken: token,
          chatId,
          htmlText: testHtml,
          buttons: testButtons,
          gasUrl,
        });
      }

      setTelegramTestStatus({
        ok: result.ok,
        message: result.message,
      });

      if (result.ok && !lineSettings.telegramEnabled) {
        onUpdateSettings({
          ...lineSettings,
          telegramEnabled: true,
        });
      }

      // Sync Telegram credentials & reminder schedule to Google Apps Script properties silently when GAS URL is set
      if (result.ok && gasUrl.trim().startsWith('https://script.google.com/macros/s/')) {
        fetch(gasUrl.trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'set_config',
            telegramBotToken: token,
            telegramChatId: chatId,
            telegramHeaderTitle: activeHeader,
            reminderTimings:
              lineSettings.reminderTimings && lineSettings.reminderTimings.length > 0
                ? lineSettings.reminderTimings
                : [lineSettings.defaultRemindMinutes || 15],
            dailyDigestEnabled: lineSettings.dailyDigestEnabled !== false,
            dailyDigestTime: lineSettings.dailyDigestTime || '08:00',
            telegramShowStats: lineSettings.telegramShowStats !== false,
            telegramShowButtons: lineSettings.telegramShowButtons !== false,
          }),
        }).catch(() => {});
      }
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSyncTelegramScheduleToGas = async () => {
    const trimmedGas = gasUrl.trim();
    if (!trimmedGas.startsWith('https://script.google.com/macros/s/')) {
      setTgGasSyncStatus({
        ok: false,
        message: 'ยังไม่พบลิงก์ Google Apps Script Web App URL (กรุณาตรวจสอบที่แท็บ เชื่อมต่อ API)',
      });
      return;
    }
    const token = (lineSettings.telegramBotToken || '').trim();
    const chatId = (lineSettings.telegramChatId || '').trim();
    const timings =
      lineSettings.reminderTimings && lineSettings.reminderTimings.length > 0
        ? lineSettings.reminderTimings
        : [lineSettings.defaultRemindMinutes || 15];
    setIsSyncingTgToGas(true);
    setTgGasSyncStatus(null);
    try {
      const res = await fetch(trimmedGas, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'set_config',
          telegramBotToken: token,
          telegramChatId: chatId,
          telegramHeaderTitle: (
            lineSettings.telegramHeaderTitle || DEFAULT_TELEGRAM_HEADER_TITLE
          ).trim(),
          reminderTimings: timings,
          dailyDigestEnabled: lineSettings.dailyDigestEnabled !== false,
          dailyDigestTime: lineSettings.dailyDigestTime || '08:00',
          telegramShowStats: lineSettings.telegramShowStats !== false,
          telegramShowButtons: lineSettings.telegramShowButtons !== false,
        }),
      });
      const data = JSON.parse((await res.text()) || '{}');
      if (data && data.mode === 'gas_set_config' && data.version === '3.3-telegram-24x7-reminders') {
        setTgGasSyncStatus({
          ok: true,
          message: `ซิงก์เวลาเตือนล่วงหน้า (${timings.map(formatRemindMinutesLabel).join(', ')}) และสรุปเช้า ${lineSettings.dailyDigestTime || '08:00'} น. เข้า Apps Script สำเร็จแล้ว!`,
        });
      } else {
        setTgGasSyncStatus({
          ok: false,
          message:
            'Apps Script ของคุณยังเป็นเวอร์ชันก่อนหน้า — กรุณากด "คัดลอกโค้ด Apps Script" ด้านบน ไปวางทับแล้วกด Deploy > Edit > New version จากนั้นรัน setupTelegramAutoTriggers 1 ครั้งครับ',
        });
      }
    } catch {
      setTgGasSyncStatus({
        ok: false,
        message: 'ไม่สามารถเชื่อมต่อ Google Apps Script ได้ กรุณาตรวจสอบสิทธิ์ Deploy เป็น Anyone',
      });
    } finally {
      setIsSyncingTgToGas(false);
    }
  };

  const handleSendSampleTaskToTelegramOnly = async () => {
    const token = (lineSettings.telegramBotToken || '').trim();
    const chatId = (lineSettings.telegramChatId || '').trim();
    if ((!token && runtimeMode !== 'fullstack') || !chatId) {
      setTelegramTestStatus({
        ok: false,
        message: 'กรุณากรอก Bot Token และ Chat ID ให้ครบก่อนกดส่งตัวอย่างครับ',
      });
      return;
    }
    setIsTestingTelegram(true);
    setTelegramTestStatus(null);
    try {
      let res;
      if (lineSettings.telegramDeliveryMode !== 'text_html') {
        const photoDataUrl =
          telegramPreviewCardUrl ||
          (telegramPreviewMode === 'digest'
            ? await renderDailyDigestTelegramCardPng({
                dateYMD: telegramPreviewDigestData.dateYMD,
                referenceTimeHM: formatLocalTimeHM(),
                items: telegramPreviewDigestData.items,
                heading:
                  telegramFormatOptions.style === 'timeline_digest'
                    ? 'ไทม์ไลน์กำหนดการประจำวัน'
                    : 'สรุปตารางงานประจำวัน',
                format: telegramFormatOptions,
              })
            : await renderSingleTaskTelegramCardPng({
                task: samplePreviewTask,
                categoryName: sampleCategory?.name || 'งานตารางทีม',
                categoryColor: sampleCategory?.color || '#0284C7',
                remindLabel: formatRemindMinutesLabel(
                  samplePreviewTask.remindMinutesBefore || lineSettings.defaultRemindMinutes || 15
                ),
                includeDescription: lineSettings.includeDescriptionInNotification !== false,
                summaryStats: {
                  total: summaryMetrics.total,
                  pending: summaryMetrics.pendingCount,
                  completed: summaryMetrics.completedCount,
                },
                isManualTrigger: true,
                format: telegramFormatOptions,
              }));

        res = await sendTelegramPhotoCard({
          botToken: token,
          chatId,
          photoDataUrl,
          captionHtml: telegramPreviewPhotoCaption,
          fallbackHtmlText: telegramPreviewHtml,
          buttons: telegramPreviewButtons,
          gasUrl,
        });
      } else {
        res = await sendTelegramNotification({
          botToken: token,
          chatId,
          htmlText: telegramPreviewHtml,
          buttons: telegramPreviewButtons,
          gasUrl,
        });
      }
      setTelegramTestStatus({ ok: res.ok, message: res.message });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(appsScriptCode);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleTestGasWebhook = async (withSampleTask: boolean) => {
    const trimmedUrl = gasUrl.trim();
    if (!trimmedUrl) return;

    if (!trimmedUrl.startsWith('https://script.google.com/macros/s/')) {
      setGasVerifyResult({
        ok: false,
        message:
          'กรุณาวางลิงก์ Google Apps Script Web App URL ที่ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec',
      });
      return;
    }

    setIsTestingGas(true);
    setGasVerifyResult(null);
    checkLiveGasCardVersion(trimmedUrl);

    const sampleText = withSampleTask
      ? `ทดสอบส่งงานจาก LINE วันนี้ 15:30 #สูง`
      : undefined;

    try {
      // 1. ลองเรียกผ่าน Backend API ก่อน (กรณีรันบน Full-stack Server — อ่านเวอร์ชันจริงจาก Apps Script แม่นยำไม่ติด CORS)
      let handledByBackend = false;
      try {
        const res = await fetch('/api/line/test-gas-webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scriptUrl: trimmedUrl,
            testText: sampleText,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          handledByBackend = true;
          setGasVerifyResult({
            ok: Boolean(data.ok),
            message: data.message || 'ตรวจสอบเสร็จสิ้น',
          });
          if (typeof data.detectedVersion === 'string' && data.detectedVersion) {
            const isV3 =
              Boolean(data.isLatestV3) || data.detectedVersion.startsWith('3.');
            setGasCardVersionInfo({
              checking: false,
              status: isV3 ? 'up_to_date' : 'outdated',
              detectedVersion: data.detectedVersion,
            });
          }
          if (withSampleTask && data.ok) {
            if (onPullFromSheets && spreadsheetId.trim()) {
              await onPullFromSheets();
            } else if (sampleText) {
              onSendChatCommand(sampleText);
            }
          }
        }
      } catch {
        handledByBackend = false;
      }

      // 2. กรณีรันบน Static Hosting (เช่น GitHub Pages ที่ไม่มี Backend API) ให้ตรวจสอบตรงจากเบราว์เซอร์ไปที่ Google Apps Script
      if (!handledByBackend) {
        const webhookPayload = sampleText
          ? {
              events: [
                {
                  type: 'message',
                  replyToken: '00000000000000000000000000000000',
                  message: { type: 'text', text: sampleText },
                },
              ],
            }
          : { action: 'check_bridge', events: [] };

        try {
          const directRes = await fetch(trimmedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(webhookPayload),
          });
          const rawText = await directRes.text();
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(rawText);
          } catch {
            parsed = {};
          }

          const realVer = String(
            parsed.cardDesignVersion || parsed.version || ''
          ).trim();
          const isLatestV3 =
            realVer === '3.0-executive-card' || realVer.startsWith('3.');

          if (withSampleTask && sampleText) {
            onSendChatCommand(sampleText);
            if (onPullFromSheets && spreadsheetId.trim()) {
              setTimeout(() => {
                onPullFromSheets().catch(() => {});
              }, 1500);
            }
            setGasVerifyResult({
              ok: true,
              message: `ส่งข้อความ "${sampleText}" ไปยัง Google Apps Script และเพิ่มงานเข้าปฏิทินเรียบร้อยแล้ว!`,
            });
          } else if (isLatestV3) {
            setGasVerifyResult({
              ok: true,
              message: `✅ ลิงก์ Google Apps Script พร้อมใช้งาน 100% (โค้ดเวอร์ชันล่าสุด ${realVer} — ดีไซน์การ์ดผู้บริหาร v3.0)`,
            });
          } else if (parsed.mode === 'gas_bridge_ready' || realVer.startsWith('2.')) {
            setGasVerifyResult({
              ok: false,
              message: `⚠️ ลิงก์เชื่อมต่อได้ แต่ลิงก์ /exec นี้ยังรันโค้ดเวอร์ชันเก่า (${
                realVer || 'ก่อน v3.0'
              }) ยังไม่ใช่ v3.0! 💡 หากคุณกดอัปเดตหลายรอบแล้วแต่ยังไม่เปลี่ยน แปลว่าเผลอกด "Deploy > New deployment" (ซึ่งจะได้ลิงก์ /exec อันใหม่คนละรหัส) — ให้นำลิงก์ /exec อันใหม่ล่าสุดมาวางทับในช่องนี้ หรือกด "Deploy > Manage deployments > รูปดินสอ (Edit) > เลือก New version > กด Deploy" บนลิงก์เดิมครับ`,
            });
          } else if (parsed.status === 'verified') {
            setGasVerifyResult({
              ok: false,
              message:
                '⚠️ ลิงก์เชื่อมต่อได้ แต่ยังเป็น "โค้ด Apps Script เวอร์ชันเก่า" — กรุณากดปุ่ม "คัดลอกโค้ด Apps Script ล่าสุด (v3.0)" ด้านล่าง ไปวางทับใน Apps Script แล้วกด Deploy > Manage deployments > แก้ไข (รูปดินสอ) > เลือก Version: New version > กด Deploy',
            });
          } else {
            setGasVerifyResult({
              ok: true,
              message:
                'เชื่อมต่อลิงก์ Google Apps Script สำเร็จ! (อย่าลืมตรวจสอบแถบด้านบนว่าเป็นเวอร์ชัน 3.0-executive-card แล้ว)',
            });
          }
        } catch {
          try {
            await fetch(trimmedUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(webhookPayload),
            });
            setGasVerifyResult({
              ok: true,
              message:
                'ส่งสัญญาณไปยัง Google Apps Script แล้ว (หากยังไม่ได้อัปเดตโค้ดล่าสุด กรุณาคัดลอกโค้ดด้านล่างไปวางแล้วกด Deploy > Manage deployments > New version)',
            });
          } catch {
            setGasVerifyResult({
              ok: false,
              message:
                'ไม่สามารถเชื่อมต่อลิงก์ Google Apps Script ได้ กรุณาตรวจสอบลิงก์ หรือตรวจสอบว่าตั้งค่า Deploy > Who has access เป็น "Anyone (ทุกคน)" แล้ว',
            });
          }
        }
      }
    } finally {
      setIsTestingGas(false);
    }
  };

  const activeTimings = useMemo(
    () =>
      Array.isArray(lineSettings.reminderTimings) && lineSettings.reminderTimings.length > 0
        ? lineSettings.reminderTimings
        : [lineSettings.defaultRemindMinutes || 60],
    [lineSettings.defaultRemindMinutes, lineSettings.reminderTimings]
  );

  const activePriorities = useMemo(
    () =>
      Array.isArray(lineSettings.triggerPriorities) && lineSettings.triggerPriorities.length > 0
        ? lineSettings.triggerPriorities
        : [TaskPriority.HIGH, TaskPriority.MEDIUM, TaskPriority.LOW],
    [lineSettings.triggerPriorities]
  );

  const activeCategoryIds = useMemo(
    () =>
      Array.isArray(lineSettings.triggerCategoryIds) ? lineSettings.triggerCategoryIds : [],
    [lineSettings.triggerCategoryIds]
  );

  const activeSources = useMemo(
    () =>
      Array.isArray(lineSettings.triggerSources) && lineSettings.triggerSources.length > 0
        ? lineSettings.triggerSources
        : (['web', 'line', 'sheets'] as ('web' | 'line' | 'sheets')[]),
    [lineSettings.triggerSources]
  );

  const activeStatuses = useMemo(
    () =>
      Array.isArray(lineSettings.triggerStatuses) && lineSettings.triggerStatuses.length > 0
        ? lineSettings.triggerStatuses
        : [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
    [lineSettings.triggerStatuses]
  );

  const toggleReminderTiming = (minutes: number) => {
    const exists = activeTimings.includes(minutes);
    const next = exists
      ? activeTimings.filter((m) => m !== minutes)
      : [...activeTimings, minutes].sort((a, b) => a - b);
    if (next.length === 0) return;
    onUpdateSettings({
      ...lineSettings,
      reminderTimings: next,
      defaultRemindMinutes: next[0],
    });
  };

  const togglePriorityTrigger = (priority: TaskPriority) => {
    const exists = activePriorities.includes(priority);
    const next = exists
      ? activePriorities.filter((p) => p !== priority)
      : [...activePriorities, priority];
    if (next.length === 0) return;
    onUpdateSettings({
      ...lineSettings,
      triggerPriorities: next,
    });
  };

  const toggleCategoryTrigger = (catId: string) => {
    const currentList =
      activeCategoryIds.length === 0 ? categories.map((c) => c.id) : activeCategoryIds;
    const exists = currentList.includes(catId);
    const next = exists ? currentList.filter((id) => id !== catId) : [...currentList, catId];
    if (next.length === 0) return;
    onUpdateSettings({
      ...lineSettings,
      triggerCategoryIds: next.length === categories.length ? [] : next,
    });
  };

  const toggleSourceTrigger = (source: 'web' | 'line' | 'sheets') => {
    const exists = activeSources.includes(source);
    const next = exists
      ? activeSources.filter((s) => s !== source)
      : [...activeSources, source];
    if (next.length === 0) return;
    onUpdateSettings({
      ...lineSettings,
      triggerSources: next,
    });
  };

  const toggleStatusTrigger = (status: TaskStatus) => {
    const exists = activeStatuses.includes(status);
    const next = exists
      ? activeStatuses.filter((s) => s !== status)
      : [...activeStatuses, status];
    if (next.length === 0) return;
    onUpdateSettings({
      ...lineSettings,
      triggerStatuses: next,
    });
  };

  const matchingTasks = useMemo(
    () => tasks.filter((t) => doesTaskTriggerNotification(t, lineSettings).allowed),
    [lineSettings, tasks]
  );

  const samplePreviewTask: Task = useMemo(() => {
    const candidate = matchingTasks[0] || tasks[0];
    if (candidate) {
      return {
        ...candidate,
        remindMinutesBefore: lineSettings.defaultRemindMinutes || 60,
      };
    }
    return {
      id: 'preview-task',
      title: 'ประชุมสรุปแผนงานไตรมาส 4 และตรวจตารางส่งมอบงาน',
      description: 'เตรียมเอกสารสรุปตัวเลขและลิงก์ Google Sheets สำหรับทีมบริหาร',
      date: todayStr,
      time: '10:30',
      categoryId: categories[0]?.id || 'cat-work',
      priority: TaskPriority.HIGH,
      status: TaskStatus.PENDING,
      remindMinutesBefore: lineSettings.defaultRemindMinutes || 60,
      lineNotified: false,
      source: 'web',
      updatedAt: new Date().toISOString(),
    };
  }, [categories, lineSettings.defaultRemindMinutes, matchingTasks, tasks, todayStr]);

  const sampleCategory =
    categories.find((c) => c.id === samplePreviewTask.categoryId) || categories[0];

  const previewCustomText = useMemo(
    () =>
      renderCustomLineMessage(
        lineSettings.customMessageTemplate,
        samplePreviewTask,
        sampleCategory?.name || 'งานบริหาร & โปรเจกต์',
        lineSettings.includeDescriptionInNotification !== false,
        {
          total: summaryMetrics.total,
          pending: summaryMetrics.pendingCount,
          completed: summaryMetrics.completedCount,
        }
      ),
    [
      lineSettings.customMessageTemplate,
      lineSettings.includeDescriptionInNotification,
      sampleCategory?.name,
      samplePreviewTask,
      summaryMetrics.completedCount,
      summaryMetrics.pendingCount,
      summaryMetrics.total,
    ]
  );

  const telegramFormatOptions = useMemo(
    () => ({
      style: (lineSettings.telegramStyle || 'executive_card') as TelegramTemplateStyle,
      headerTitle: (
        lineSettings.telegramHeaderTitle || DEFAULT_TELEGRAM_HEADER_TITLE
      ).trim(),
      showStats: lineSettings.telegramShowStats !== false,
      showButtons: lineSettings.telegramShowButtons !== false,
      cardFontSize: lineSettings.cardFontSize,
      cardTitleWeight: lineSettings.cardTitleWeight,
      cardLineSpacing: lineSettings.cardLineSpacing,
    }),
    [
      lineSettings.cardFontSize,
      lineSettings.cardLineSpacing,
      lineSettings.cardTitleWeight,
      lineSettings.telegramHeaderTitle,
      lineSettings.telegramShowButtons,
      lineSettings.telegramShowStats,
      lineSettings.telegramStyle,
    ]
  );

  const telegramPreviewButtons = useMemo(
    () =>
      buildTelegramActionButtons({
        calendarUrl: resolvedCalendarButtonUrl,
        includeCalendarButton: lineSettings.includeOpenAppButton !== false,
        includeTvButton: true,
        showButtons: telegramFormatOptions.showButtons,
      }),
    [
      lineSettings.includeOpenAppButton,
      resolvedCalendarButtonUrl,
      telegramFormatOptions.showButtons,
    ]
  );

  const telegramPreviewDigestData = useMemo(() => {
    const todayItems = tasks
      .filter((t) => t.date === todayStr)
      .sort((a, b) => a.time.localeCompare(b.time));
    const sourceTasks =
      todayItems.length > 0
        ? todayItems
        : [...tasks]
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
            .slice(0, 5);
    const items: FlexDigestItem[] =
      sourceTasks.length > 0
        ? sourceTasks.map((t) => {
            const cat = categories.find((c) => c.id === t.categoryId);
            return {
              title: t.title,
              time: t.time || '09:00',
              status: t.status,
              priority: t.priority,
              description: t.description,
              categoryName: cat?.name || 'งานตารางทีม',
              categoryColor: cat?.color || '#0284c7',
            };
          })
        : [
            {
              title: 'ประชุมสรุปแผนการดำเนินงานประจำสัปดาห์',
              time: '09:30',
              status: TaskStatus.PENDING,
              priority: TaskPriority.HIGH,
              description: 'ห้องประชุมชั้น 5 · ฝ่ายบริหาร',
              categoryName: 'งานบริหาร',
              categoryColor: '#ef4444',
            },
            {
              title: 'ตรวจรับรองเอกสารและสรุปยอดนำเข้าข้อมูล',
              time: '13:30',
              status: TaskStatus.IN_PROGRESS,
              priority: TaskPriority.MEDIUM,
              description: 'ส่งมอบทีมงานก่อน 16:00 น.',
              categoryName: 'งานปฏิบัติการ',
              categoryColor: '#0284c7',
            },
            {
              title: 'อัปเดตสถานะตารางขึ้นจอ TV ประจำวัน',
              time: '17:00',
              status: TaskStatus.COMPLETED,
              priority: TaskPriority.LOW,
              categoryName: 'งานทั่วไป',
              categoryColor: '#10b981',
            },
          ];
    return {
      dateYMD: todayItems.length > 0 ? todayStr : sourceTasks[0]?.date || todayStr,
      items,
    };
  }, [categories, tasks, todayStr]);

  const telegramPreviewHtml = useMemo(() => {
    if (telegramPreviewMode === 'digest') {
      return formatDailyDigestTelegramHtml({
        dateYMD: telegramPreviewDigestData.dateYMD,
        referenceTimeHM: formatLocalTimeHM(),
        items: telegramPreviewDigestData.items,
        heading:
          telegramFormatOptions.style === 'timeline_digest'
            ? 'ไทม์ไลน์กำหนดการประจำวัน'
            : 'สรุปตารางงานประจำวัน',
        format: telegramFormatOptions,
      });
    }

    return formatSingleTaskTelegramHtml({
      task: samplePreviewTask,
      categoryName: sampleCategory?.name || 'งานตารางทีม',
      remindLabel: formatRemindMinutesLabel(
        samplePreviewTask.remindMinutesBefore || lineSettings.defaultRemindMinutes || 15
      ),
      includeDescription: lineSettings.includeDescriptionInNotification !== false,
      summaryStats: {
        total: summaryMetrics.total,
        pending: summaryMetrics.pendingCount,
        completed: summaryMetrics.completedCount,
      },
      isManualTrigger: true,
      format: telegramFormatOptions,
    });
  }, [
    lineSettings.defaultRemindMinutes,
    lineSettings.includeDescriptionInNotification,
    sampleCategory?.name,
    samplePreviewTask,
    summaryMetrics.completedCount,
    summaryMetrics.pendingCount,
    summaryMetrics.total,
    telegramFormatOptions,
    telegramPreviewDigestData,
    telegramPreviewMode,
  ]);

  const telegramPreviewPhotoCaption = useMemo(() => {
    if (telegramPreviewMode === 'digest') {
      const doneCnt = telegramPreviewDigestData.items.filter(
        (i) => i.status === 'completed'
      ).length;
      return buildShortDigestPhotoCaption({
        dateYMD: telegramPreviewDigestData.dateYMD,
        referenceTimeHM: formatLocalTimeHM(),
        total: telegramPreviewDigestData.items.length,
        pending: telegramPreviewDigestData.items.length - doneCnt,
        completed: doneCnt,
        heading:
          telegramFormatOptions.style === 'timeline_digest'
            ? 'ไทม์ไลน์กำหนดการประจำวัน'
            : 'สรุปตารางงานประจำวัน',
      });
    }
    return buildShortTaskPhotoCaption({
      task: samplePreviewTask,
      categoryName: sampleCategory?.name || 'งานตารางทีม',
      remindLabel: formatRemindMinutesLabel(
        samplePreviewTask.remindMinutesBefore || lineSettings.defaultRemindMinutes || 15
      ),
    });
  }, [
    lineSettings.defaultRemindMinutes,
    sampleCategory?.name,
    samplePreviewTask,
    telegramFormatOptions.style,
    telegramPreviewDigestData,
    telegramPreviewMode,
  ]);

  useEffect(() => {
    if (activeSettingsTab !== 'telegram') return;
    if (lineSettings.telegramDeliveryMode === 'text_html') return;
    let cancelled = false;
    (async () => {
      const url =
        telegramPreviewMode === 'digest'
          ? await renderDailyDigestTelegramCardPng({
              dateYMD: telegramPreviewDigestData.dateYMD,
              referenceTimeHM: formatLocalTimeHM(),
              items: telegramPreviewDigestData.items,
              heading:
                telegramFormatOptions.style === 'timeline_digest'
                  ? 'ไทม์ไลน์กำหนดการประจำวัน'
                  : 'สรุปตารางงานประจำวัน',
              format: telegramFormatOptions,
            })
          : await renderSingleTaskTelegramCardPng({
              task: samplePreviewTask,
              categoryName: sampleCategory?.name || 'งานตารางทีม',
              categoryColor: sampleCategory?.color || '#0284C7',
              remindLabel: formatRemindMinutesLabel(
                samplePreviewTask.remindMinutesBefore || lineSettings.defaultRemindMinutes || 15
              ),
              includeDescription: lineSettings.includeDescriptionInNotification !== false,
              summaryStats: {
                total: summaryMetrics.total,
                pending: summaryMetrics.pendingCount,
                completed: summaryMetrics.completedCount,
              },
              isManualTrigger: true,
              format: telegramFormatOptions,
            });
      if (!cancelled) {
        setTelegramPreviewCardUrl(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSettingsTab,
    lineSettings.defaultRemindMinutes,
    lineSettings.includeDescriptionInNotification,
    lineSettings.telegramDeliveryMode,
    sampleCategory?.color,
    sampleCategory?.name,
    samplePreviewTask,
    summaryMetrics.completedCount,
    summaryMetrics.pendingCount,
    summaryMetrics.total,
    telegramFormatOptions,
    telegramPreviewDigestData,
    telegramPreviewMode,
  ]);

  const recentLineCreatedTasks = tasks.filter((t) => t.source === 'line').slice(0, 5);
  const hasSheet = Boolean(spreadsheetId.trim());

  const consolidatedPreviewTasks = useMemo(
    () => consolidateContinuousTasks(tasks),
    [tasks]
  );

  const availableTaskDates = useMemo(() => {
    const dateSet = new Set<string>();
    consolidatedPreviewTasks.forEach((t) => {
      if (t.date) dateSet.add(t.date);
    });
    return Array.from(dateSet).sort();
  }, [consolidatedPreviewTasks]);

  const [showSummaryPreview, setShowSummaryPreview] = useState(true);
  const [previewCardTab, setPreviewCardTab] = useState<'daily_summary' | 'single_task'>(
    'daily_summary'
  );
  const [selectedSingleTaskId, setSelectedSingleTaskId] = useState<string>(() => {
    return tasks[0]?.id || '';
  });
  const [previewPriorityOverride, setPreviewPriorityOverride] = useState<
    'auto' | 'high' | 'medium' | 'low'
  >('auto');
  const [selectedPreviewDate, setSelectedPreviewDate] = useState<string>(() => {
    const hasToday = consolidatedPreviewTasks.some(
      (t) => t.date <= todayStr && (t.endDate || t.date) >= todayStr
    );
    if (hasToday) return todayStr;
    const upcoming = consolidatedPreviewTasks
      .map((t) => t.date)
      .filter((d) => Boolean(d && d >= todayStr))
      .sort()[0];
    return upcoming || consolidatedPreviewTasks[0]?.date || todayStr;
  });

  useEffect(() => {
    const hasTasksOnSelected = consolidatedPreviewTasks.some(
      (t) =>
        t.date <= selectedPreviewDate && (t.endDate || t.date) >= selectedPreviewDate
    );
    if (!hasTasksOnSelected && consolidatedPreviewTasks.length > 0) {
      const upcoming = consolidatedPreviewTasks
        .map((t) => t.date)
        .filter((d) => Boolean(d && d >= todayStr))
        .sort()[0];
      setSelectedPreviewDate(upcoming || consolidatedPreviewTasks[0].date);
    }
  }, [consolidatedPreviewTasks, selectedPreviewDate, todayStr]);

  const previewDigestTasks = useMemo(() => {
    return consolidatedPreviewTasks
      .filter(
        (t) =>
          t.date <= selectedPreviewDate && (t.endDate || t.date) >= selectedPreviewDate
      )
      .sort((a, b) => String(a.time || '09:00').localeCompare(String(b.time || '09:00')));
  }, [consolidatedPreviewTasks, selectedPreviewDate]);

  return (
    <div className="space-y-6">
      {/* Live Google Apps Script Card Design Version Status Banner */}
      {gasCardVersionInfo.status === 'outdated' && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 sm:p-5 shadow-2xs space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-amber-200/80 text-amber-950 text-[11px] font-bold">
                <span>
                  ตรวจพบสาเหตุที่ LINE ยังตอบกลับเป็นดีไซน์สีม่วงแบบเดิม ({gasCardVersionInfo.detectedVersion || 'เวอร์ชันเก่า'})
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                ลิงก์ Google Apps Script ของคุณยังรันโค้ดเวอร์ชันเก่าอยู่ จึงยังส่งการ์ดดีไซน์เดิมเข้า LINE
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                หน้าเว็บนี้เปลี่ยนเป็น <strong>ดีไซน์ใหม่ระดับผู้บริหาร (สีกรมท่าเข้ม v3.0)</strong> เรียบร้อยแล้ว แต่บอทในแอป LINE ดึงการ์ดมาจาก Google Apps Script บนบัญชี Google ของคุณโดยตรง กรุณาอัปเดตตาม 3 ขั้นตอนด้านล่าง (ใช้เวลาไม่เกิน 1 นาที):
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyScript}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#0B192C] hover:bg-slate-800 text-white text-xs font-bold shadow-2xs transition-colors whitespace-nowrap"
              >
                {copiedScript ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span>คัดลอกโค้ดดีไซน์ใหม่ v3.0 แล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-amber-400" />
                    <span>1. คัดลอกโค้ด Apps Script ดีไซน์ใหม่ (v3.0)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={gasCardVersionInfo.checking}
                onClick={() => checkLiveGasCardVersion()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-white hover:bg-amber-100/70 border border-amber-300 text-amber-950 text-xs font-bold transition-colors whitespace-nowrap disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${gasCardVersionInfo.checking ? 'animate-spin' : ''}`}
                />
                <span>
                  {gasCardVersionInfo.checking
                    ? 'กำลังตรวจสอบ...'
                    : 'ตรวจเช็กอีกครั้งหลัง Deploy'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-xs">
            <div className="rounded-lg bg-white border border-amber-200 p-3">
              <div className="font-bold text-slate-900">ขั้นตอนที่ 1: วางทับใน Code.gs</div>
              <div className="text-slate-600 mt-0.5 leading-relaxed">
                กดปุ่มสีกรมท่าด้านบนเพื่อคัดลอกโค้ดจากหน้านี้ (ห้ามคัดลอกจากหน้าเว็บเก่า github.io) ไปวางทับโค้ดเดิมทั้งหมดใน <strong>Extensions &gt; Apps Script</strong> แล้วกด Save
              </div>
            </div>
            <div className="rounded-lg bg-white border border-amber-200 p-3">
              <div className="font-bold text-slate-900">
                ขั้นตอนที่ 2: กด Manage deployments (สำคัญมาก)
              </div>
              <div className="text-slate-600 mt-0.5 leading-relaxed">
                การกด Save เฉย ๆ จะไม่อัปเดตบอท LINE — ต้องกดปุ่ม <strong>Deploy &gt; Manage deployments &gt; รูปดินสอ (Edit) &gt; ช่อง Version เลือก &quot;New version&quot; &gt; กด Deploy</strong>
              </div>
            </div>
            <div className="rounded-lg bg-white border border-amber-200 p-3">
              <div className="font-bold text-slate-900">
                ข้อควรระวังหากกด New deployment
              </div>
              <div className="text-slate-600 mt-0.5 leading-relaxed">
                หากเผลอกด <em>New deployment</em> จะได้ลิงก์ใหม่ ต้องนำลิงก์ใหม่ไปวางทับใน <strong>LINE Developers Console &gt; Messaging API &gt; Webhook URL</strong> ด้วยครับ
              </div>
            </div>
          </div>
        </div>
      )}

      {gasCardVersionInfo.status === 'up_to_date' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950">
          <div className="font-bold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Google Apps Script ของคุณอัปเดตเป็นดีไซน์ใหม่ระดับผู้บริหาร (v3.0 Executive Card) เรียบร้อยแล้ว — พิมพ์ถามตารางงานใน LINE ได้ทันที
            </span>
          </div>
          <button
            type="button"
            onClick={() => checkLiveGasCardVersion()}
            className="text-[11px] font-semibold text-emerald-800 underline hover:text-emerald-950"
          >
            ตรวจสอบซ้ำ
          </button>
        </div>
      )}

      {/* Top Executive Summary & Instant LINE Notification Dispatch Banner */}
      <div className="bg-white border border-slate-200 border-t-4 border-t-[#0B192C] rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B192C] uppercase tracking-wider">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>Executive Official Schedule · LINE OA</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              ระบบแจ้งเตือนและส่งการ์ดกำหนดการปฏิบัติราชการเข้า LINE OA
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              ดีไซน์ระดับผู้บริหารโทนกรมท่าเข้ม แบ่งภารกิจภาคเช้าและภาคบ่ายชัดเจน พร้อมสรุปยอดภารกิจแบบอ่านง่ายเต็มความกว้างการ์ด
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowSummaryPreview((prev) => !prev)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg border transition-colors whitespace-nowrap ${
                showSummaryPreview
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="h-4 w-4 text-[#06C755]" />
              <span>
                {showSummaryPreview
                  ? '👁️ ซ่อนตัวอย่างการ์ดสรุปงาน'
                  : '👁️ ดูตัวอย่างการ์ดสรุปงาน (ไม่ต้องส่งจริง)'}
              </span>
            </button>

            <button
              type="button"
              onClick={onTestPushNotification}
              disabled={isSendingPush}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-2xs transition-colors whitespace-nowrap"
            >
              <BarChart3 className="h-4 w-4" />
              <span>
                {isSendingPush ? 'กำลังส่งสรุปงาน...' : '📊 ส่งการ์ดสรุปงานเข้า LINE จริง'}
              </span>
            </button>

            {onTestSingleTaskNotification && (
              <button
                type="button"
                disabled={isSendingPush}
                onClick={() => onTestSingleTaskNotification(samplePreviewTask)}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] shadow-2xs transition-colors whitespace-nowrap"
              >
                <Bell className="h-4 w-4" />
                <span>
                  {isSendingPush ? 'กำลังส่ง...' : '🔔 ทดสอบการ์ดแจ้งเตือนงาน'}
                </span>
              </button>
            )}

            <button
              type="button"
              disabled={isClearingRichMenu}
              onClick={() => handleClearLineRichMenu(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors whitespace-nowrap"
              title="สั่งลบ Rich Menu ที่ค้างอยู่ในแอป LINE ออกทันที"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-600" />
              <span>
                {isClearingRichMenu ? 'กำลังลบ Rich Menu...' : '🗑️ ลบ Rich Menu ออกจาก LINE'}
              </span>
            </button>
          </div>
        </div>

        {/* LIVE NO-SEND PREVIEW PANEL FOR DAILY TASK SUMMARY CARD */}
        {showSummaryPreview && (
          <div className="mt-5 pt-5 border-t border-slate-200">
            <div className="rounded-2xl bg-slate-900/5 border border-slate-200 p-4 sm:p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] font-bold">
                    <span>🔒 โหมดดูตัวอย่างบนหน้าเว็บเท่านั้น (ไม่ส่งข้อความเข้าแอป LINE จริง)</span>
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-1.5">
                    {previewCardTab === 'daily_summary'
                      ? 'ตัวอย่างการ์ดสรุปตารางงานประจำวัน (Executive Agenda)'
                      : 'ตัวอย่างการ์ดแจ้งเตือนแต่ละงาน (หัวตารางเน้นสีตามความสำคัญของงาน)'}
                  </h3>
                  <p className="text-xs text-slate-600">
                    {previewCardTab === 'daily_summary'
                      ? 'คลิกเลือกวันที่ด้านขวาเพื่อดูหน้าตาการ์ดสรุปงานของแต่ละวันได้ทันทีโดยไม่ต้องกดส่งจริง'
                      : 'หัวการ์ดเปลี่ยนสีอัตโนมัติตามระดับความสำคัญ: ด่วนมาก (#B91C1C แดงเข้ม) · ปานกลาง (#D97706 ส้มทอง) · ทั่วไป (#0F766E เขียวอมฟ้า)'}
                  </p>
                </div>

                {/* Card Type Switcher: Daily Summary vs Single Task Reminder */}
                <div className="inline-flex items-center rounded-xl bg-white p-1 border border-slate-300 shadow-2xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setPreviewCardTab('daily_summary')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      previewCardTab === 'daily_summary'
                        ? 'bg-[#0F172A] text-white shadow-2xs'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    📋 การ์ดสรุปงานประจำวัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewCardTab('single_task')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      previewCardTab === 'single_task'
                        ? 'bg-[#B91C1C] text-white shadow-2xs'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    🔔 การ์ดแจ้งเตือนแต่ละงาน (สีตามความสำคัญ)
                  </button>
                </div>
              </div>

              {previewCardTab === 'daily_summary' ? (
                <>
                  {/* Date Switcher for Daily Summary Preview */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-4">
                    <span className="text-xs font-bold text-slate-700 mr-1">เลือกวันที่:</span>
                    {availableTaskDates.map((d) => {
                      const tasksOnDate = consolidatedPreviewTasks.filter(
                        (t) => t.date <= d && (t.endDate || t.date) >= d
                      );
                      const count = tasksOnDate.length;
                      const maxEndOnDate = tasksOnDate.reduce(
                        (acc, t) => ((t.endDate || t.date) > acc ? t.endDate || t.date : acc),
                        d
                      );
                      const isSelected =
                        selectedPreviewDate >= d && selectedPreviewDate <= maxEndOnDate;
                      const pillDateLabel =
                        maxEndOnDate > d
                          ? formatTaskDateRangeLabel({ date: d, endDate: maxEndOnDate }, 'short')
                          : formatThaiDateDisplay(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedPreviewDate(d)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                            isSelected
                              ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-2xs'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {pillDateLabel} ({count} งาน)
                        </button>
                      );
                    })}
                    <input
                      type="date"
                      value={selectedPreviewDate}
                      onChange={(e) => {
                        if (e.target.value) setSelectedPreviewDate(e.target.value);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono-tabular text-slate-800"
                    />
                  </div>

                  {/* Exact 1:1 Simulated LINE Phone Bubble (Daily Summary) */}
                  <div className="max-w-[420px] mx-auto rounded-2xl overflow-hidden border border-slate-300 bg-white shadow-md">
                    {/* Royal Navy Executive Header */}
                    <div className="bg-[#0B192C] p-4.5 text-white">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-400">
                          กำหนดการปฏิบัติราชการ
                        </span>
                        <span className="text-[11px] font-mono-tabular text-slate-400 font-bold">
                          รวม {previewDigestTasks.length} ภารกิจ
                        </span>
                      </div>
                      <div className="text-lg font-bold mt-1.5 text-white leading-snug">
                        {formatSummaryCardHeaderDate(selectedPreviewDate, previewDigestTasks)}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        สำนักบริหารแรงงานต่างด้าว
                      </div>

                      {/* 3-Column Executive KPI Strip */}
                      <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#132640] py-2.5 px-2 text-center">
                        <div>
                          <div className="text-base font-extrabold text-white tabular-nums">
                            {previewDigestTasks.length}
                          </div>
                          <div className="text-[10px] text-slate-400">ทั้งหมด</div>
                        </div>
                        <div className="border-x border-[#1E3A5F]">
                          <div className="text-base font-extrabold text-amber-400 tabular-nums">
                            {
                              previewDigestTasks.filter(
                                (t) => t.status !== TaskStatus.COMPLETED
                              ).length
                            }
                          </div>
                          <div className="text-[10px] text-slate-400">รอดำเนินการ</div>
                        </div>
                        <div>
                          <div className="text-base font-extrabold text-emerald-400 tabular-nums">
                            {
                              previewDigestTasks.filter(
                                (t) => t.status === TaskStatus.COMPLETED
                              ).length
                            }
                          </div>
                          <div className="text-[10px] text-slate-400">เสร็จสิ้นแล้ว</div>
                        </div>
                      </div>
                    </div>

                    {/* Body: Morning / Afternoon Grouped Agenda Cards */}
                    <div className="p-4 bg-[#F8FAFC] space-y-3">
                      {previewDigestTasks.length > 0 ? (
                        (['morning', 'afternoon'] as const).map((period) => {
                          const periodItems = previewDigestTasks.filter((t) =>
                            period === 'morning' ? t.time < '12:00' : t.time >= '12:00'
                          );
                          if (periodItems.length === 0) return null;
                          return (
                            <div key={period} className="space-y-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-700">
                                  {period === 'morning'
                                    ? 'ภารกิจภาคเช้า (ก่อน 12:00 น.)'
                                    : 'ภารกิจภาคบ่าย (ตั้งแต่ 12:00 น.)'}
                                </span>
                                <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                                  {periodItems.length} รายการ
                                </span>
                              </div>
                              {periodItems.map((t, idx) => {
                                const cat = categories.find((c) => c.id === t.categoryId);
                                const isDone = t.status === TaskStatus.COMPLETED;
                                const isInProg = t.status === TaskStatus.IN_PROGRESS;
                                const isHigh = t.priority === TaskPriority.HIGH;
                                const cleanDesc = (t.description || '').trim();
                                const showDesc =
                                  Boolean(cleanDesc) &&
                                  cleanDesc !== t.title.trim() &&
                                  !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                                  !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
                                  !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');
                                const hasExtraMeta =
                                  Boolean(t.endDate && t.endDate > t.date) ||
                                  showDesc ||
                                  Boolean(t.assigneeName);

                                return (
                                  <div
                                    key={`preview-card-${t.id}-${idx}`}
                                    className={`bg-white border rounded-xl p-3.5 shadow-2xs ${
                                      !isDone && isHigh ? 'border-rose-200' : 'border-slate-200'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span
                                          className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold tabular-nums shrink-0 ${
                                            isDone
                                              ? 'bg-slate-200 text-slate-600'
                                              : 'bg-[#0F172A] text-white'
                                          }`}
                                        >
                                          {t.time} น.
                                        </span>
                                        <span className="text-[11px] text-slate-500 truncate">
                                          {cat?.name || 'ภารกิจทั่วไป'}
                                        </span>
                                      </div>

                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shrink-0 ${
                                          isDone
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : isInProg
                                            ? 'bg-blue-50 text-blue-700'
                                            : isHigh
                                            ? 'bg-rose-50 text-rose-700'
                                            : 'bg-slate-100 text-slate-600'
                                        }`}
                                      >
                                        {isDone
                                          ? 'เสร็จสิ้น'
                                          : isInProg
                                          ? 'กำลังดำเนินการ'
                                          : isHigh
                                          ? 'ด่วนมาก'
                                          : 'ตามกำหนดการ'}
                                      </span>
                                    </div>

                                    <div
                                      className={`text-sm font-bold mt-2 break-words leading-relaxed ${
                                        isDone ? 'line-through text-slate-400' : 'text-slate-900'
                                      }`}
                                    >
                                      {t.title}
                                    </div>

                                    {hasExtraMeta && (
                                      <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                                        {t.endDate && t.endDate > t.date && (
                                          <div className="text-[11px] font-bold text-indigo-700">
                                            กำหนดการต่อเนื่อง: {formatTaskDateRangeLabel(t, 'short')}
                                          </div>
                                        )}
                                        {showDesc && (
                                          <div className="text-xs text-slate-600 break-words leading-relaxed">
                                            {cleanDesc}
                                          </div>
                                        )}
                                        {t.assigneeName && (
                                          <div className="text-[11px] text-slate-500">
                                            ผู้รับผิดชอบ: {t.assigneeName}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 text-center text-xs text-slate-600 font-semibold">
                          ไม่มีภารกิจหรือนัดหมายในวันนี้
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="p-3.5 bg-white border-t border-slate-200 space-y-2">
                      <div className="w-full py-2 px-3 rounded-lg bg-[#0F172A] text-white text-center text-xs font-bold">
                        เปิดตารางงานนำเสนอ (รายวัน)
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenDateInCalendar(selectedPreviewDate)}
                        className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-center text-xs font-semibold transition-colors"
                      >
                        เปิดดูปฏิทินและจัดการงาน
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                (() => {
                  const activeTask =
                    consolidatedPreviewTasks.find((t) => t.id === selectedSingleTaskId) ||
                    consolidatedPreviewTasks[0] ||
                    samplePreviewTask;
                  const activeCat = categories.find((c) => c.id === activeTask.categoryId);
                  const effectivePrio =
                    previewPriorityOverride === 'auto'
                      ? activeTask.priority
                      : previewPriorityOverride;
                  const prioTheme = getPriorityHeaderTheme(effectivePrio, activeCat?.name);
                  const shortDateRange = formatTaskDateRangeLabel(activeTask, 'short');
                  const longDateHeader = formatSummaryCardHeaderDate(activeTask.date, [
                    activeTask,
                  ]);
                  const cleanSingleDesc = (activeTask.description || '').trim();
                  const showSingleDesc =
                    Boolean(cleanSingleDesc) &&
                    cleanSingleDesc !== activeTask.title.trim() &&
                    !cleanSingleDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                    !cleanSingleDesc.startsWith('บันทึกผ่านแชท LINE') &&
                    !cleanSingleDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');
                  const sameDayCount = consolidatedPreviewTasks.filter(
                    (t) =>
                      t.date <= activeTask.date &&
                      (t.endDate || t.date) >= activeTask.date
                  );
                  const sameDayDone = sameDayCount.filter(
                    (t) => t.status === TaskStatus.COMPLETED
                  ).length;
                  const sameDayPending = sameDayCount.length - sameDayDone;

                  return (
                    <div className="space-y-4">
                      {/* Task Selector + Priority Color Theme Switcher */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-700 mr-1">
                            เลือกงานเพื่อดูตัวอย่างการ์ด:
                          </span>
                          {consolidatedPreviewTasks.map((t) => {
                            const isSel = t.id === activeTask.id;
                            const tTheme = getPriorityHeaderTheme(t.priority);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setSelectedSingleTaskId(t.id);
                                  setPreviewPriorityOverride('auto');
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                                  isSel
                                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: tTheme.headerBg }}
                                />
                                <span className="truncate max-w-[180px]">{t.title}</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <span className="text-[11px] font-bold text-slate-500">
                            ทดสอบสีหัวการ์ดตามความสำคัญ:
                          </span>
                          {(
                            [
                              { id: 'auto', label: 'ตามงานจริง', color: '#334155' },
                              { id: 'high', label: '🔥 ด่วนมาก (แดง)', color: '#B91C1C' },
                              { id: 'medium', label: '⚡ ปานกลาง (ส้มทอง)', color: '#D97706' },
                              { id: 'low', label: '📌 ทั่วไป (เขียวคราม)', color: '#0F766E' },
                            ] as const
                          ).map((pOpt) => {
                            const isAct = previewPriorityOverride === pOpt.id;
                            return (
                              <button
                                key={pOpt.id}
                                type="button"
                                onClick={() => setPreviewPriorityOverride(pOpt.id)}
                                style={
                                  isAct ? { backgroundColor: pOpt.color, borderColor: pOpt.color } : undefined
                                }
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                  isAct
                                    ? 'text-white shadow-2xs'
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                {pOpt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Exact 1:1 Simulated LINE Single-Task Notification Bubble */}
                      <div className="max-w-[420px] mx-auto rounded-2xl overflow-hidden border border-slate-300 bg-white shadow-md">
                        {(() => {
                          const isTopHigh = prioTheme.priorityKey === 'high';
                          const isTopLow = prioTheme.priorityKey === 'low';
                          const topTagBg = isTopHigh
                            ? '#DC2626'
                            : isTopLow
                            ? '#1E3A5F'
                            : '#D97706';
                          const topPrioLabel = isTopHigh
                            ? 'ภารกิจด่วนมาก'
                            : isTopLow
                            ? 'ตามกำหนดการ'
                            : 'ความสำคัญปานกลาง';
                          const topPrioTextColor = isTopHigh
                            ? '#B91C1C'
                            : isTopLow
                            ? '#334155'
                            : '#B45309';

                          return (
                            <>
                              {/* Executive Royal Navy Header */}
                              <div className="bg-[#0B192C] p-4.5 text-white">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-amber-400">
                                    แจ้งเตือนกำหนดการปฏิบัติราชการ
                                  </span>
                                  <span
                                    style={{ backgroundColor: topTagBg }}
                                    className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold text-white shrink-0"
                                  >
                                    {topPrioLabel}
                                  </span>
                                </div>

                                <div className="text-lg font-bold mt-2 text-white leading-snug break-words">
                                  {activeTask.title}
                                </div>
                                <div className="text-xs text-slate-300 mt-1">
                                  {longDateHeader} · เวลา {activeTask.time} น.
                                </div>

                                {/* 3-Column Executive KPI Strip */}
                                <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#132640] py-2.5 px-2 text-center">
                                  <div>
                                    <div className="text-base font-extrabold text-white tabular-nums">
                                      {Math.max(1, sameDayCount.length)}
                                    </div>
                                    <div className="text-[10px] text-slate-400">ทั้งหมด</div>
                                  </div>
                                  <div className="border-x border-[#1E3A5F]">
                                    <div className="text-base font-extrabold text-amber-400 tabular-nums">
                                      {sameDayCount.length === 0 ? 1 : sameDayPending}
                                    </div>
                                    <div className="text-[10px] text-slate-400">รอดำเนินการ</div>
                                  </div>
                                  <div>
                                    <div className="text-base font-extrabold text-emerald-400 tabular-nums">
                                      {sameDayDone}
                                    </div>
                                    <div className="text-[10px] text-slate-400">เสร็จสิ้นแล้ว</div>
                                  </div>
                                </div>
                              </div>

                              {/* Body */}
                              <div className="p-4 bg-[#F8FAFC] space-y-3">
                                <div
                                  className={`bg-white border rounded-xl p-3.5 shadow-2xs space-y-2.5 text-xs ${
                                    isTopHigh ? 'border-rose-200' : 'border-slate-200'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-[#0F172A] text-white font-bold tabular-nums text-xs">
                                      เวลา {activeTask.time} น.
                                    </span>
                                    <span className="font-bold text-slate-700 text-xs">
                                      {shortDateRange}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-12 gap-2 items-baseline pt-0.5">
                                    <span className="col-span-4 text-slate-500 font-medium">
                                      หมวดหมู่
                                    </span>
                                    <span className="col-span-8 font-bold text-slate-900">
                                      {activeCat?.name || 'ภารกิจทั่วไป'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-12 gap-2 items-baseline">
                                    <span className="col-span-4 text-slate-500 font-medium">
                                      ความสำคัญ
                                    </span>
                                    <span
                                      style={{ color: topPrioTextColor }}
                                      className="col-span-8 font-bold"
                                    >
                                      {topPrioLabel}
                                    </span>
                                  </div>

                                  {showSingleDesc && (
                                    <>
                                      <div className="border-t border-slate-100 my-2" />
                                      <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-2.5">
                                        <div className="text-[11px] font-bold text-slate-600">
                                          รายละเอียดเพิ่มเติม
                                        </div>
                                        <div className="text-xs text-slate-800 mt-1 leading-relaxed break-words">
                                          {cleanSingleDesc}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Footer */}
                              <div className="p-3.5 bg-white border-t border-slate-200 space-y-2">
                                <div className="w-full py-2 px-3 rounded-lg bg-[#0F172A] text-white text-center text-xs font-bold">
                                  เปิดตารางงานนำเสนอ (รายวัน)
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onOpenDateInCalendar(activeTask.date)}
                                  className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-center text-xs font-semibold transition-colors"
                                >
                                  เปิดดูปฏิทินและจัดการงาน
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {richMenuClearStatus && (
          <div
            className={`mt-3 p-3 rounded-lg border text-xs leading-relaxed ${
              richMenuClearStatus.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            {richMenuClearStatus.message}
          </div>
        )}

        {/* 4 Mini Summary KPI Strip inside LINE Center */}
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-indigo-50/70 border border-indigo-200 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-800">งานวันนี้</span>
            <span className="text-lg font-bold text-indigo-700 font-mono-tabular">
              {summaryMetrics.todayCount} งาน
            </span>
          </div>
          <div className="rounded-lg bg-amber-50/70 border border-amber-200 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800">งานค้างรอทำ</span>
            <span className="text-lg font-bold text-amber-600 font-mono-tabular">
              {summaryMetrics.pendingCount} งาน
            </span>
          </div>
          <div className="rounded-lg bg-rose-50/70 border border-rose-200 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800">ด่วน Priority สูง</span>
            <span className="text-lg font-bold text-rose-600 font-mono-tabular">
              {summaryMetrics.highCount} งาน
            </span>
          </div>
          <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800">ทำเสร็จแล้ว</span>
            <span className="text-lg font-bold text-emerald-600 font-mono-tabular">
              {summaryMetrics.completedCount} งาน
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Colorful LINE Notification Cards & Chat Command Console */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl overflow-hidden shadow-2xs flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50/50 via-white to-emerald-50/50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ห้องแชทแจ้งเตือน & การ์ดสรุปงาน LINE OA
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lineSettings.allowAddTaskFromLine !== false
                    ? 'พิมพ์สั่งเพิ่มงาน หรือกดดูสรุปงานเพื่อรับการ์ดแจ้งเตือนสีสันสดใสพร้อมสรุปยอดงาน'
                    : 'ขณะนี้ปิดรับการเพิ่มงานจาก LINE ชั่วคราว (ยังขอดูสรุปงานและรับแจ้งเตือนได้ตามปกติ)'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer select-none whitespace-nowrap shrink-0">
                  <input
                    type="checkbox"
                    checked={lineSettings.allowAddTaskFromLine !== false}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        allowAddTaskFromLine: e.target.checked,
                      })
                    }
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                      lineSettings.allowAddTaskFromLine !== false
                        ? 'bg-[#06C755]'
                        : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                        lineSettings.allowAddTaskFromLine !== false
                          ? 'translate-x-3.5'
                          : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                  <span className="text-xs font-semibold text-slate-800">
                    {lineSettings.allowAddTaskFromLine !== false
                      ? 'เพิ่มงานจาก LINE: เปิด'
                      : 'เพิ่มงานจาก LINE: ปิด'}
                  </span>
                </label>

                {hasSheet && onPullFromSheets && (
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={onPullFromSheets}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'กำลังดึงงาน...' : 'ดึงงานจาก LINE'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Colorful LINE Chat Stream with Rich Flex Summary & Notification Cards */}
            <div
              ref={chatScrollRef}
              className="p-5 space-y-4 max-h-[540px] min-h-[360px] overflow-y-auto bg-[#8CABD9]/20"
            >
              {logs.map((log) => {
                const isUser = log.direction === 'incoming_command';
                const timeFormatted = new Date(log.timestamp).toLocaleTimeString('th-TH', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const flex = log.flexSummary;
                const hasDigest = Boolean(flex && Array.isArray(flex.digestItems));

                if (isUser) {
                  return (
                    <div key={log.id} className="flex justify-end">
                      <div className="max-w-[85%]">
                        <div className="rounded-2xl rounded-tr-xs px-4 py-2.5 text-xs font-medium leading-relaxed bg-[#06C755] text-white shadow-2xs whitespace-pre-wrap">
                          {log.text}
                        </div>
                        <div className="mt-1 text-[11px] font-mono-tabular text-slate-500 text-right">
                          คุณ · {timeFormatted} น.
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={log.id} className="flex justify-start">
                    <div className="w-full max-w-[92%]">
                      {/* CASE 1: FULL DAILY / PENDING TASK SUMMARY FLEX CARD */}
                      {flex && hasDigest ? (
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                          {/* Executive Royal Navy Header */}
                          <div className="bg-[#0B192C] px-4.5 py-4 text-white">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-bold text-amber-400">
                                {flex.title && flex.title.includes('งานค้าง')
                                  ? 'สรุปภารกิจค้างดำเนินการ'
                                  : 'กำหนดการปฏิบัติราชการ'}
                              </span>
                              <span className="text-[11px] tabular-nums text-slate-400 font-bold">
                                รวม {flex.stats?.total ?? flex.digestItems?.length ?? 0} ภารกิจ
                              </span>
                            </div>
                            <div className="text-base font-bold mt-1.5 text-white">
                              {flex.title &&
                              (flex.title.includes('ทั้งหมด') || flex.title.includes('งานค้าง'))
                                ? flex.title
                                : formatSummaryCardHeaderDate(
                                    flex.date || todayStr,
                                    flex.digestItems || []
                                  )}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              สำนักบริหารแรงงานต่างด้าว
                            </div>

                            {/* 3-Column Executive KPI Strip */}
                            <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#132640] py-2 px-2 text-center">
                              <div>
                                <div className="text-sm font-extrabold text-white tabular-nums">
                                  {flex.stats?.total ?? flex.digestItems?.length ?? 0}
                                </div>
                                <div className="text-[10px] text-slate-400">ทั้งหมด</div>
                              </div>
                              <div className="border-x border-[#1E3A5F]">
                                <div className="text-sm font-extrabold text-amber-400 tabular-nums">
                                  {flex.stats?.pending ?? 0}
                                </div>
                                <div className="text-[10px] text-slate-400">รอดำเนินการ</div>
                              </div>
                              <div>
                                <div className="text-sm font-extrabold text-emerald-400 tabular-nums">
                                  {flex.stats?.completed ?? 0}
                                </div>
                                <div className="text-[10px] text-slate-400">เสร็จสิ้นแล้ว</div>
                              </div>
                            </div>
                          </div>

                          {/* Morning / Afternoon Executive Agenda Cards */}
                          <div className="p-4 bg-[#F8FAFC] space-y-3">
                            {flex.digestItems && flex.digestItems.length > 0 ? (
                              (['morning', 'afternoon'] as const).map((period) => {
                                const sortedDigest = [...(flex.digestItems || [])].sort((a, b) =>
                                  String(a.time || '09:00').localeCompare(String(b.time || '09:00'))
                                );
                                const periodItems = sortedDigest.filter((item) =>
                                  period === 'morning'
                                    ? String(item.time || '09:00') < '12:00'
                                    : String(item.time || '09:00') >= '12:00'
                                );
                                if (periodItems.length === 0) return null;

                                return (
                                  <div key={period} className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-700">
                                        {period === 'morning'
                                          ? 'ภารกิจภาคเช้า (ก่อน 12:00 น.)'
                                          : 'ภารกิจภาคบ่าย (ตั้งแต่ 12:00 น.)'}
                                      </span>
                                      <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                                        {periodItems.length} รายการ
                                      </span>
                                    </div>
                                    {periodItems.map((item, idx) => {
                                      const isDone = item.status === 'completed';
                                      const isInProg = item.status === 'in_progress';
                                      const isHigh = item.priority === 'high';
                                      const cleanDesc = (item.description || '').trim();
                                      const showDesc =
                                        Boolean(cleanDesc) &&
                                        cleanDesc !== (item.title || '').trim() &&
                                        !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                                        !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
                                        !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');
                                      const hasExtraMeta =
                                        Boolean(item.endDate && item.date && item.endDate > item.date) ||
                                        showDesc ||
                                        Boolean(item.assigneeName);

                                      return (
                                        <div
                                          key={`agenda-${item.title}-${idx}`}
                                          className={`bg-white border rounded-xl p-3 shadow-2xs ${
                                            !isDone && isHigh ? 'border-rose-200' : 'border-slate-200'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <span
                                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tabular-nums shrink-0 ${
                                                  isDone
                                                    ? 'bg-slate-200 text-slate-600'
                                                    : 'bg-[#0F172A] text-white'
                                                }`}
                                              >
                                                {item.time} น.
                                              </span>
                                              <span className="text-[11px] text-slate-500 truncate">
                                                {item.categoryName || 'ภารกิจทั่วไป'}
                                              </span>
                                            </div>

                                            <span
                                              className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shrink-0 ${
                                                isDone
                                                  ? 'bg-emerald-50 text-emerald-700'
                                                  : isInProg
                                                  ? 'bg-blue-50 text-blue-700'
                                                  : isHigh
                                                  ? 'bg-rose-50 text-rose-700'
                                                  : 'bg-slate-100 text-slate-600'
                                              }`}
                                            >
                                              {isDone
                                                ? 'เสร็จสิ้น'
                                                : isInProg
                                                ? 'กำลังดำเนินการ'
                                                : isHigh
                                                ? 'ด่วนมาก'
                                                : 'ตามกำหนดการ'}
                                            </span>
                                          </div>

                                          <div
                                            className={`text-sm font-bold mt-2 break-words leading-relaxed ${
                                              isDone ? 'line-through text-slate-400' : 'text-slate-900'
                                            }`}
                                          >
                                            {item.title}
                                          </div>

                                          {hasExtraMeta && (
                                            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                                              {item.endDate && item.date && item.endDate > item.date && (
                                                <div className="text-[11px] font-bold text-indigo-700">
                                                  กำหนดการต่อเนื่อง:{' '}
                                                  {formatTaskDateRangeLabel(
                                                    { date: item.date, endDate: item.endDate },
                                                    'short'
                                                  )}
                                                </div>
                                              )}
                                              {showDesc && (
                                                <div className="text-xs text-slate-600 break-words leading-relaxed">
                                                  {cleanDesc}
                                                </div>
                                              )}
                                              {item.assigneeName && (
                                                <div className="text-[11px] text-slate-500">
                                                  ผู้รับผิดชอบ: {item.assigneeName}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="bg-white border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-600 font-semibold">
                                ไม่มีภารกิจหรือนัดหมายในวันนี้
                              </div>
                            )}
                          </div>

                          {/* Card Footer Action */}
                          <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenDateInCalendar(flex.date || todayStr)}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                            >
                              <CalendarIcon className="h-3.5 w-3.5" />
                              <span>เปิดดูปฏิทินและจัดการงาน</span>
                            </button>
                          </div>
                        </div>
                      ) : flex ? (
                        /* CASE 2: EXECUTIVE OFFICIAL SINGLE-TASK / SAVED TASK CARD */
                        (() => {
                          const pTheme = getPriorityHeaderTheme(
                            flex.priority,
                            `${flex.priorityLabel || ''} ${flex.badge || ''} ${flex.categoryName || ''}`
                          );
                          const isSingleHigh = pTheme.priorityKey === 'high';
                          const isSingleLow = pTheme.priorityKey === 'low';
                          const singleTagBg = isSingleHigh
                            ? '#DC2626'
                            : isSingleLow
                            ? '#1E3A5F'
                            : '#D97706';
                          const singlePrioLabel = isSingleHigh
                            ? 'ภารกิจด่วนมาก'
                            : isSingleLow
                            ? 'ตามกำหนดการ'
                            : 'ความสำคัญปานกลาง';
                          const singlePrioTextColor = isSingleHigh
                            ? '#B91C1C'
                            : isSingleLow
                            ? '#334155'
                            : '#B45309';
                          const cleanDesc = (flex.description || flex.subtitle || '').trim();
                          const showCleanDesc =
                            Boolean(cleanDesc) &&
                            cleanDesc !== flex.title.trim() &&
                            !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                            !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
                            !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');
                          const displayDate = flex.date
                            ? formatSummaryCardHeaderDate(flex.date, [
                                {
                                  date: flex.date,
                                  endDate: flex.endDate,
                                  title: flex.title,
                                  description: flex.description,
                                },
                              ])
                            : flex.dateTime;

                          return (
                            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                              {/* Executive Royal Navy Header */}
                              <div className="bg-[#0B192C] px-4 py-4 text-white">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-bold text-amber-400">
                                    แจ้งเตือนกำหนดการปฏิบัติราชการ
                                  </span>
                                  <span
                                    style={{ backgroundColor: singleTagBg }}
                                    className="px-2 py-0.5 rounded text-[10px] font-bold text-white shrink-0"
                                  >
                                    {singlePrioLabel}
                                  </span>
                                </div>
                                <div className="text-sm font-bold mt-2 break-words leading-snug text-white">
                                  {flex.title}
                                </div>
                                <div className="text-[11px] text-slate-300 mt-1">
                                  {displayDate} · เวลา {flex.time || flex.dateTime} น.
                                </div>

                                <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#132640] py-2 px-2 text-center">
                                  <div>
                                    <div className="text-sm font-extrabold text-white tabular-nums">
                                      {flex.stats?.total ?? summaryMetrics.total}
                                    </div>
                                    <div className="text-[10px] text-slate-400">ทั้งหมด</div>
                                  </div>
                                  <div className="border-x border-[#1E3A5F]">
                                    <div className="text-sm font-extrabold text-amber-400 tabular-nums">
                                      {flex.stats?.pending ?? summaryMetrics.pendingCount}
                                    </div>
                                    <div className="text-[10px] text-slate-400">รอดำเนินการ</div>
                                  </div>
                                  <div>
                                    <div className="text-sm font-extrabold text-emerald-400 tabular-nums">
                                      {flex.stats?.completed ?? summaryMetrics.completedCount}
                                    </div>
                                    <div className="text-[10px] text-slate-400">เสร็จสิ้นแล้ว</div>
                                  </div>
                                </div>
                              </div>

                              <div className="p-3.5 space-y-2.5 bg-[#F8FAFC]">
                                <div
                                  className={`rounded-xl bg-white border p-3.5 space-y-2 text-xs shadow-2xs ${
                                    isSingleHigh ? 'border-rose-200' : 'border-slate-200'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-[#0F172A] text-white font-bold tabular-nums text-xs">
                                      เวลา {flex.time || flex.dateTime} น.
                                    </span>
                                    <span className="text-slate-700 font-bold text-xs">
                                      {displayDate}
                                    </span>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-slate-500 shrink-0">หมวดหมู่</span>
                                    <span className="font-bold text-slate-900 text-right">
                                      {flex.categoryName}
                                    </span>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-slate-500 shrink-0">ความสำคัญ</span>
                                    <span
                                      className="font-bold text-right"
                                      style={{ color: singlePrioTextColor }}
                                    >
                                      {singlePrioLabel}
                                    </span>
                                  </div>
                                  {flex.remindLabel && (
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="text-slate-500 shrink-0">
                                        แจ้งเตือนล่วงหน้า
                                      </span>
                                      <span className="font-semibold text-emerald-700 text-right">
                                        {flex.remindLabel}
                                      </span>
                                    </div>
                                  )}

                                  {showCleanDesc && (
                                    <>
                                      <div className="border-t border-slate-100 my-1.5" />
                                      <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                                        <span className="font-bold text-slate-600 block mb-0.5 text-[11px]">
                                          รายละเอียดเพิ่มเติม
                                        </span>
                                        {cleanDesc}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div className="p-3 bg-white border-t border-slate-200">
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenDateInCalendar(
                                      flex.date || flex.dateTime.slice(0, 10) || todayStr
                                    )
                                  }
                                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-bold hover:bg-slate-800 transition-colors"
                                >
                                  <CalendarIcon className="h-3.5 w-3.5" />
                                  <span>เปิดดูปฏิทินและจัดการงาน</span>
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        /* Plain Text Fallback */
                        <div className="rounded-2xl rounded-tl-xs px-4 py-3 text-xs leading-relaxed bg-white border border-slate-200 text-slate-800 shadow-2xs whitespace-pre-wrap">
                          {log.text}
                        </div>
                      )}

                      <div className="mt-1 text-[11px] font-mono-tabular text-slate-500">
                        ระบบแจ้งเตือน LINE OA · {timeFormatted} น.
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Clean Quick Command Text Pills (No Graphical Rich Menu) */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap shrink-0">
                คำสั่งด่วน:
              </span>
              <button
                type="button"
                onClick={() => onSendChatCommand('สรุปงานวันนี้')}
                className="px-2.5 py-1 rounded-md bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                กำหนดการวันนี้
              </button>
              <button
                type="button"
                onClick={() => onSendChatCommand('สรุปงานวันนี้')}
                className="px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
              >
                📊 สรุปงานวันนี้
              </button>
              <button
                type="button"
                onClick={() => onSendChatCommand('สรุปงาน พรุ่งนี้')}
                className="px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
              >
                📅 สรุปงานพรุ่งนี้
              </button>
              <button
                type="button"
                onClick={() => onSendChatCommand('งานค้าง')}
                className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
              >
                ⏳ งานค้างทั้งหมด
              </button>
              {lineSettings.allowAddTaskFromLine !== false && (
                <button
                  type="button"
                  onClick={() =>
                    onSendChatCommand('ประชุมวางแผนโปรเจกต์ทีม พรุ่งนี้ 10:30 #สูง')
                  }
                  className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                >
                  + ตัวอย่างเพิ่มงานใหม่
                </button>
              )}
            </div>

            {/* Chat Input Form */}
            <form
              onSubmit={handleChatSubmit}
              className="p-3.5 bg-white border-t border-slate-200 flex items-center gap-2.5"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  lineSettings.allowAddTaskFromLine !== false
                    ? 'พิมพ์ "สรุปงานตามเวลา", "สรุปงานวันนี้", "สรุปงาน 28/10" หรือพิมพ์สั่งเพิ่มงาน...'
                    : 'พิมพ์ "สรุปงานตามเวลา", "สรุปงานวันนี้", "งานค้าง" (ปิดการสั่งเพิ่มงานจาก LINE ชั่วคราว)...'
                }
                className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] shadow-2xs transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>ส่งคำสั่ง</span>
              </button>
            </form>
          </div>

          {/* Live List of Tasks Saved from LINE into Calendar */}
          <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  งานที่บันทึกจาก LINE ล่าสุด ({recentLineCreatedTasks.length})
                </h3>
              </div>
            </div>

            {recentLineCreatedTasks.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">
                ยังไม่มีงานที่สั่งผ่าน LINE
              </p>
            ) : (
              <div className="mt-3 divide-y divide-slate-200">
                {recentLineCreatedTasks.map((t) => {
                  const cat = categories.find((c) => c.id === t.categoryId);
                  const catColor = cat?.color || '#2563EB';
                  return (
                    <div
                      key={t.id}
                      style={{ borderLeft: `3px solid ${catColor}` }}
                      className="pl-3 py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {t.title}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                          วันที่ {formatTaskDateRangeLabel(t)} · เวลา {t.time} น. · เตือนล่วงหน้า{' '}
                          {formatRemindMinutesLabel(t.remindMinutesBefore)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenDateInCalendar(t.date)}
                        className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
                      >
                        ดูในปฏิทิน
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Columns: Notification Format, Timing & Webhook Settings */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 border-t-4 border-t-violet-600 rounded-xl p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200 gap-3">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-violet-600 shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    ตั้งค่าการแจ้งเตือน LINE OA &amp; Telegram Bot
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ปรับแต่งดีไซน์การ์ด เวลาเตือนล่วงหน้า และเชื่อมต่อ Telegram ฟรีไม่จำกัดข้อความ
                  </p>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={lineSettings.enabled}
                  onChange={(e) =>
                    onUpdateSettings({ ...lineSettings, enabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                />
                <span className="text-xs font-semibold text-slate-800">เปิดแจ้งเตือน</span>
              </label>
            </div>

            {/* Dedicated Toggle: Allow / Block Adding Tasks to Calendar from LINE */}
            <div
              className={`mt-3.5 rounded-xl border p-3 flex items-center justify-between gap-3 transition-colors ${
                lineSettings.allowAddTaskFromLine !== false
                  ? 'bg-emerald-50/60 border-emerald-200'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">
                  ฟังก์ชันเพิ่มงานลงปฏิทินจาก LINE (แชทส่วนตัว & กลุ่ม LINE)
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                  {lineSettings.allowAddTaskFromLine !== false
                    ? 'เปิดอยู่ — สมาชิกสามารถพิมพ์คำสั่ง เช่น "เพิ่มงาน ประชุมพรุ่งนี้ 10:00" เพื่อบันทึกลงปฏิทินอัตโนมัติ'
                    : 'ปิดชั่วคราว — บอทจะไม่สร้างนัดหมายใหม่จากข้อความใน LINE (ยังรับแจ้งเตือนและดูสรุปงานได้ตามปกติ)'}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={lineSettings.allowAddTaskFromLine !== false}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...lineSettings,
                      allowAddTaskFromLine: e.target.checked,
                    })
                  }
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    lineSettings.allowAddTaskFromLine !== false
                      ? 'bg-[#06C755]'
                      : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-2xs transition-transform ${
                      lineSettings.allowAddTaskFromLine !== false
                        ? 'translate-x-4.5'
                        : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span
                  className={`text-xs font-bold ${
                    lineSettings.allowAddTaskFromLine !== false
                      ? 'text-emerald-800'
                      : 'text-slate-600'
                  }`}
                >
                  {lineSettings.allowAddTaskFromLine !== false ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                </span>
              </label>
            </div>

            {/* 5 Segmented Settings Sub-Tabs */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveSettingsTab('format')}
                className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'format'
                    ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>ดีไซน์การ์ด</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('timing')}
                className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'timing'
                    ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>เวลาเตือน</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('triggers')}
                className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'triggers'
                    ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Filter className="h-3.5 w-3.5 shrink-0" />
                <span>เงื่อนไขงาน</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('api')}
                className={`inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'api'
                    ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Bell className="h-3.5 w-3.5 shrink-0" />
                <span>LINE Token</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('telegram')}
                className={`col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'telegram'
                    ? 'bg-[#0088cc] text-white shadow-2xs font-semibold'
                    : telegramReady
                    ? 'text-[#006da3] bg-sky-50 hover:bg-sky-100 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span>Telegram</span>
              </button>
            </div>

            {/* TAB 1: Notification Card Design & Live Preview */}
            {activeSettingsTab === 'format' && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-900 mb-2">
                    เลือกรูปแบบการแจ้งเตือน LINE
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        {
                          id: 'executive_flex',
                          title: 'การ์ดสีสัน + สรุปงาน',
                          desc: 'Flex Card แยกสีหมวดหมู่พร้อมสรุปยอดงาน',
                        },
                        {
                          id: 'compact_flex',
                          title: 'การ์ดกะทัดรัด',
                          desc: 'Flex Card ขนาดเล็กเน้นวันเวลาและสรุป',
                        },
                        {
                          id: 'text_custom',
                          title: 'ปรับข้อความเอง',
                          desc: 'กำหนดข้อความเองพร้อมแนบสรุปงาน',
                        },
                      ] as { id: LineNotificationFormat; title: string; desc: string }[]
                    ).map((fmt) => {
                      const isSelected = lineSettings.messageFormat === fmt.id;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...lineSettings,
                              messageFormat: fmt.id,
                            })
                          }
                          className={`p-2.5 rounded-lg border text-left transition-colors ${
                            isSelected
                              ? 'bg-indigo-50/80 border-indigo-600 text-indigo-950'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{fmt.title}</span>
                            {isSelected && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            {fmt.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Visual Preview of the Selected Notification Format */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      ตัวอย่างการแจ้งเตือนที่จะส่งเข้า LINE:
                    </span>
                    <span className="text-[11px] text-emerald-700 font-semibold">
                      แนบสรุปตารางงานอัตโนมัติ
                    </span>
                  </div>

                  {lineSettings.messageFormat === 'text_custom' ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {TEMPLATE_VARIABLES.map((v) => (
                          <button
                            key={v.token}
                            type="button"
                            onClick={() =>
                              onUpdateSettings({
                                ...lineSettings,
                                customMessageTemplate: `${
                                  lineSettings.customMessageTemplate || ''
                                } ${v.token}`.trim(),
                              })
                            }
                            className="px-2 py-1 text-[11px] font-mono-tabular bg-indigo-50 border border-indigo-200 rounded text-indigo-800 hover:bg-indigo-100 transition-colors"
                          >
                            {v.token} ({v.label})
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={3}
                        value={lineSettings.customMessageTemplate}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...lineSettings,
                            customMessageTemplate: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 font-mono-tabular focus:border-indigo-600 focus:outline-none"
                      />
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-800 whitespace-pre-wrap">
                        {previewCustomText}
                      </div>
                    </div>
                  ) : (
                    /* Colorful Flex Card Live Preview + Typography Controls */
                    <div className="space-y-3">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900">
                            🔤 ปรับลักษณะตัวอักษรและการจัดวางบนการ์ด LINE
                          </span>
                          <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            แก้ปัญหาตัวหนังสือบวม/สระซ้อนบน LINE PC
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {/* ขนาดตัวอักษร */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-slate-600 block">
                              ขนาดตัวอักษร (Font Size)
                            </label>
                            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-lg border border-slate-200">
                              {(
                                [
                                  { id: 'sm', label: 'เล็ก' },
                                  { id: 'md', label: 'มาตรฐาน' },
                                  { id: 'lg', label: 'ใหญ่' },
                                ] as const
                              ).map((opt) => {
                                const active = (lineSettings.cardFontSize || 'md') === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({
                                        ...lineSettings,
                                        cardFontSize: opt.id,
                                      })
                                    }
                                    className={`py-1 rounded text-[11px] font-semibold transition-colors ${
                                      active
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* ความหนาหัวข้อและข้อมูล */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-slate-600 block">
                              ความหนาฟอนต์ (Weight)
                            </label>
                            <div className="grid grid-cols-2 gap-1 bg-white p-1 rounded-lg border border-slate-200">
                              {(
                                [
                                  { id: 'regular', label: 'ตัวปกติ (คมชัด)' },
                                  { id: 'bold', label: 'ตัวหนา (เน้น)' },
                                ] as const
                              ).map((opt) => {
                                const active =
                                  (lineSettings.cardTitleWeight || 'bold') === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({
                                        ...lineSettings,
                                        cardTitleWeight: opt.id,
                                      })
                                    }
                                    className={`py-1 rounded text-[11px] font-semibold transition-colors ${
                                      active
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* ระยะห่างบรรทัด */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-medium text-slate-600 block">
                              ระยะห่างบรรทัด (Line Spacing)
                            </label>
                            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-lg border border-slate-200">
                              {(
                                [
                                  { id: 'tight', label: 'ชิด' },
                                  { id: 'normal', label: 'ปกติ' },
                                  { id: 'relaxed', label: 'โปร่งสบาย' },
                                ] as const
                              ).map((opt) => {
                                const active =
                                  (lineSettings.cardLineSpacing || 'relaxed') === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() =>
                                      onUpdateSettings({
                                        ...lineSettings,
                                        cardLineSpacing: opt.id,
                                      })
                                    }
                                    className={`py-1 rounded text-[11px] font-semibold transition-colors ${
                                      active
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-600 hover:bg-slate-100'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          💡 <strong>เคล็ดลับสำหรับ LINE บนคอมพิวเตอร์ (Windows):</strong> หากตัวอักษรภาษาไทยดูหนาหรือติดกันเกินไป แนะนำให้เลือก{' '}
                          <strong className="text-slate-700">&quot;ตัวปกติ (คมชัด)&quot;</strong> คู่กับระยะห่าง{' '}
                          <strong className="text-slate-700">&quot;โปร่งสบาย&quot;</strong> หรือเปลี่ยนฟอนต์หลักในแอป LINE ที่เมนู{' '}
                          <span className="font-mono-tabular text-slate-700">Settings (⚙️) &gt; Chats &gt; Font</span>
                        </p>
                      </div>

                      {(() => {
                        const isSampleHigh = samplePreviewTask.priority === TaskPriority.HIGH;
                        const isSampleLow = samplePreviewTask.priority === TaskPriority.LOW;
                        const sampleTagBg = isSampleHigh
                          ? '#DC2626'
                          : isSampleLow
                          ? '#1E3A5F'
                          : '#D97706';
                        const samplePrioLabel = isSampleHigh
                          ? 'ภารกิจด่วนมาก'
                          : isSampleLow
                          ? 'ตามกำหนดการ'
                          : 'ความสำคัญปานกลาง';
                        const samplePrioTextColor = isSampleHigh
                          ? '#B91C1C'
                          : isSampleLow
                          ? '#334155'
                          : '#B45309';
                        const sampleFullDate = formatSummaryCardHeaderDate(
                          samplePreviewTask.date,
                          [samplePreviewTask]
                        );

                        return (
                          <div className="rounded-xl overflow-hidden border border-slate-200 shadow-2xs bg-white">
                            {/* Executive Royal Navy Header */}
                            <div className="bg-[#0B192C] px-4 py-4 text-white">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-amber-400">
                                  แจ้งเตือนกำหนดการปฏิบัติราชการ
                                </span>
                                <span
                                  style={{ backgroundColor: sampleTagBg }}
                                  className="px-2 py-0.5 rounded text-[10px] font-bold text-white shrink-0"
                                >
                                  {samplePrioLabel}
                                </span>
                              </div>
                              <div
                                className={`mt-2 text-white ${
                                  lineSettings.cardFontSize === 'sm'
                                    ? 'text-xs'
                                    : lineSettings.cardFontSize === 'lg'
                                    ? 'text-base'
                                    : 'text-sm'
                                } ${
                                  lineSettings.cardTitleWeight === 'regular'
                                    ? 'font-normal'
                                    : 'font-bold'
                                } ${
                                  lineSettings.cardLineSpacing === 'tight'
                                    ? 'leading-tight'
                                    : lineSettings.cardLineSpacing === 'normal'
                                    ? 'leading-snug'
                                    : 'leading-relaxed'
                                }`}
                              >
                                {samplePreviewTask.title}
                              </div>
                              <div className="text-[11px] text-slate-300 mt-1">
                                {sampleFullDate} · เวลา {samplePreviewTask.time} น.
                              </div>

                              {/* 3-Column Executive KPI Strip */}
                              <div className="mt-3 grid grid-cols-3 rounded-lg bg-[#132640] py-2 px-2 text-center">
                                <div>
                                  <div className="text-sm font-extrabold text-white tabular-nums">
                                    {Math.max(1, summaryMetrics.total)}
                                  </div>
                                  <div className="text-[10px] text-slate-400">ทั้งหมด</div>
                                </div>
                                <div className="border-x border-[#1E3A5F]">
                                  <div className="text-sm font-extrabold text-amber-400 tabular-nums">
                                    {summaryMetrics.total === 0 ? 1 : summaryMetrics.pendingCount}
                                  </div>
                                  <div className="text-[10px] text-slate-400">รอดำเนินการ</div>
                                </div>
                                <div>
                                  <div className="text-sm font-extrabold text-emerald-400 tabular-nums">
                                    {summaryMetrics.completedCount}
                                  </div>
                                  <div className="text-[10px] text-slate-400">เสร็จสิ้นแล้ว</div>
                                </div>
                              </div>
                            </div>

                            {/* Clean White Body Card */}
                            <div
                              className={`p-3.5 space-y-2.5 bg-[#F8FAFC] ${
                                lineSettings.cardFontSize === 'sm'
                                  ? 'text-[11px]'
                                  : lineSettings.cardFontSize === 'lg'
                                  ? 'text-sm'
                                  : 'text-xs'
                              }`}
                            >
                              <div
                                className={`rounded-xl bg-white border p-3.5 space-y-2 shadow-2xs ${
                                  isSampleHigh ? 'border-rose-200' : 'border-slate-200'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded bg-[#0F172A] text-white font-bold tabular-nums text-xs">
                                    เวลา {samplePreviewTask.time} น.
                                  </span>
                                  <span className="text-slate-700 font-bold text-xs">
                                    {formatTaskDateRangeLabel(samplePreviewTask, 'short')}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-slate-500">หมวดหมู่</span>
                                  <span
                                    className={`text-slate-900 ${
                                      lineSettings.cardTitleWeight === 'regular'
                                        ? 'font-normal'
                                        : 'font-bold'
                                    }`}
                                  >
                                    {sampleCategory?.name || 'งานบริหาร & โปรเจกต์'}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-2">
                                  <span className="text-slate-500">ความสำคัญ</span>
                                  <span
                                    className={
                                      lineSettings.cardTitleWeight === 'regular'
                                        ? 'font-normal'
                                        : 'font-bold'
                                    }
                                    style={{ color: samplePrioTextColor }}
                                  >
                                    {samplePrioLabel}
                                  </span>
                                </div>
                              </div>

                              {lineSettings.includeOpenAppButton !== false && (
                                <div className="pt-1 space-y-1.5">
                                  <div className="w-full py-2 px-3 rounded-lg bg-[#0F172A] text-white text-center text-xs font-bold">
                                    เปิดตารางงานนำเสนอ (รายวัน)
                                  </div>
                                  <div className="w-full py-2 px-3 rounded-lg bg-slate-100 text-slate-800 text-center text-xs font-semibold">
                                    เปิดดูปฏิทินและจัดการงาน
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Public Calendar Button URL Configuration for LINE Flex Card */}
                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-900">
                      🔗 ลิงก์ของปุ่ม &quot;เปิดดูปฏิทินของทีม&quot; บนการ์ดในแอป LINE
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lineSettings.includeOpenAppButton !== false}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...lineSettings,
                            includeOpenAppButton: e.target.checked,
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                      <span>แสดงปุ่มเปิดปฏิทินบนการ์ด</span>
                    </label>
                  </div>

                  <input
                    type="url"
                    value={lineSettings.publicCalendarUrl || ''}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        publicCalendarUrl: e.target.value,
                      })
                    }
                    placeholder="วางลิงก์เว็บจริงของคุณ เช่น https://ชื่อคุณ.github.io/ชื่อโปรเจกต์/ (เว้นว่างเพื่อใช้ลิงก์อัตโนมัติ)"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">ตั้งค่าด่วน:</span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          publicCalendarUrl: 'https://naiadminna.github.io/Lakha/?section=calendar',
                        })
                      }
                      className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-medium text-emerald-800 transition-colors"
                    >
                      🚀 เปิดหน้าเว็บหลัก (ไม่ต้องล็อกอิน)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          publicCalendarUrl: `${DEFAULT_GAS_WEB_APP_URL}?view=calendar`,
                        })
                      }
                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[11px] font-medium text-slate-700 transition-colors"
                    >
                      🌐 เปิดเว็บปฏิทินทีม Apps Script (ไม่ต้องล็อกอิน)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          publicCalendarUrl: 'https://calendar.google.com',
                        })
                      }
                      className="px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-[11px] font-medium text-indigo-800 transition-colors"
                    >
                      ให้ปุ่มเปิดแอป Google Calendar
                    </button>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    <div>
                      <strong className="text-slate-800">ปลายทางเมื่อกดปุ่มในแอป LINE:</strong>{' '}
                      <code className="font-mono-tabular text-indigo-700 break-all">
                        {resolvedCalendarButtonUrl}
                      </code>
                    </div>
                    <div className="mt-1 text-slate-500">
                      💡 หากคุณส่งแจ้งเตือนจากหน้าพรีวิว AI Studio ลิงก์ภายในอาจต้องล็อกอินบัญชีผู้พัฒนา แนะนำให้วางลิงก์เว็บจริง (เช่น GitHub Pages) หรือเลือกให้เปิดตาราง Google Sheets เพื่อให้สมาชิกทุกคนใน LINE กดเปิดดูได้ทันทีบนมือถือครับ
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Notification Timing Settings */}
            {activeSettingsTab === 'timing' && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-900">
                      เลือกช่วงเวลาแจ้งเตือนล่วงหน้า
                    </label>
                    <span className="text-[11px] font-mono-tabular text-indigo-600 font-semibold">
                      เลือกไว้ {activeTimings.length} ช่วงเวลา
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {REMINDER_TIMING_OPTIONS.map((opt) => {
                      const isSelected = activeTimings.includes(opt.minutes);
                      return (
                        <button
                          key={opt.minutes}
                          type="button"
                          onClick={() => toggleReminderTiming(opt.minutes)}
                          className={`px-3 py-2 rounded-lg border text-xs font-medium text-left flex items-center justify-between transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white font-semibold'
                              : 'bg-white border-slate-300 text-slate-700 hover:border-indigo-400'
                          }`}
                        >
                          <span>{opt.shortLabel}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-emerald-300 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      เวลาเตือนเริ่มต้นเมื่อสร้างงานใหม่
                    </label>
                    <select
                      value={lineSettings.defaultRemindMinutes}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...lineSettings,
                          defaultRemindMinutes: Number(e.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                    >
                      {REMINDER_TIMING_OPTIONS.map((opt) => (
                        <option key={opt.minutes} value={opt.minutes}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-700">
                        เวลาส่งการ์ดสรุปงานประจำวัน
                      </label>
                      <input
                        type="checkbox"
                        checked={lineSettings.dailyDigestEnabled !== false}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...lineSettings,
                            dailyDigestEnabled: e.target.checked,
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                      />
                    </div>
                    <input
                      type="time"
                      disabled={lineSettings.dailyDigestEnabled === false}
                      value={lineSettings.dailyDigestTime}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...lineSettings,
                          dailyDigestTime: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 font-mono-tabular disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Task Trigger Filters */}
            {activeSettingsTab === 'triggers' && (
              <div className="mt-4 space-y-4">
                <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200 flex items-center justify-between">
                  <span className="text-xs font-medium text-indigo-900">
                    งานที่เข้าเงื่อนไขแจ้งเตือน:
                  </span>
                  <span className="text-xs font-bold font-mono-tabular text-indigo-700">
                    {matchingTasks.length} / {tasks.length} รายการ
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-900 mb-1.5">
                    1. ระดับความสำคัญของงาน
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: TaskPriority.HIGH, label: 'Priority สูง' },
                        { id: TaskPriority.MEDIUM, label: 'ปานกลาง' },
                        { id: TaskPriority.LOW, label: 'ทั่วไป' },
                      ] as { id: TaskPriority; label: string }[]
                    ).map((p) => {
                      const checked = activePriorities.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePriorityTrigger(p.id)}
                          className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                            checked
                              ? 'bg-indigo-600 border-indigo-600 text-white font-semibold'
                              : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'
                          }`}
                        >
                          <span>{p.label}</span>
                          {checked && <Check className="h-3.5 w-3.5 text-emerald-300 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-900">
                      2. หมวดหมู่งานที่แจ้งเตือน
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          triggerCategoryIds: [],
                        })
                      }
                      className="text-[11px] font-medium text-indigo-700 hover:underline"
                    >
                      เลือกทั้งหมด
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {categories.map((cat) => {
                      const isChecked =
                        activeCategoryIds.length === 0 || activeCategoryIds.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => toggleCategoryTrigger(cat.id)}
                          className={`px-2.5 py-2 rounded-lg border text-xs text-left flex items-center justify-between gap-2 transition-colors ${
                            isChecked
                              ? 'bg-indigo-50/40 border-indigo-600 text-slate-900 font-semibold'
                              : 'bg-white border-slate-200 text-slate-400'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className="h-2.5 w-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="truncate">{cat.name}</span>
                          </span>
                          {isChecked && <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-900 mb-1.5">
                      3. สถานะงาน
                    </label>
                    <div className="space-y-1.5">
                      {(
                        [
                          { id: TaskStatus.PENDING, label: 'รอดำเนินการ' },
                          { id: TaskStatus.IN_PROGRESS, label: 'กำลังทำ' },
                        ] as { id: TaskStatus; label: string }[]
                      ).map((st) => {
                        const isChecked = activeStatuses.includes(st.id);
                        return (
                          <label
                            key={st.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleStatusTrigger(st.id)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                            />
                            <span>{st.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-900 mb-1.5">
                      4. แหล่งที่มา
                    </label>
                    <div className="space-y-1.5">
                      {(
                        [
                          { id: 'web', label: 'หน้าเว็บแอป' },
                          { id: 'line', label: 'แชท LINE OA' },
                          { id: 'sheets', label: 'Google Sheets' },
                        ] as { id: 'web' | 'line' | 'sheets'; label: string }[]
                      ).map((src) => {
                        const isChecked = activeSources.includes(src.id);
                        return (
                          <label
                            key={src.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSourceTrigger(src.id)}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                            />
                            <span>{src.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: LINE Messaging API Credentials */}
            {activeSettingsTab === 'api' && (
              <div className="mt-4 space-y-3">
                <div
                  className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                    runtimeMode === 'fullstack'
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                      : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
                  }`}
                >
                  <div className="font-bold">
                    {runtimeMode === 'fullstack'
                      ? '🟢 โหมดปัจจุบัน: AI Studio / Full-Stack Server (ส่งผ่าน /api/line/push โดยตรง)'
                      : '🌐 โหมดปัจจุบัน: เว็บไซต์จริง / GitHub Pages (ส่งผ่าน Google Apps Script Bridge)'}
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-90">
                    {runtimeMode === 'fullstack'
                      ? 'หน้าพรีวิวนี้มี Node.js Server จึงส่งเข้า LINE ได้ทันที — แต่หากรันบนเว็บจริง (GitHub Pages) จะไม่มี Server ในตัว ต้องคัดลอกโค้ด Apps Script ด้านล่างไป Deploy เป็น New version เพื่อทำหน้าที่ส่งข้อความแทน'
                      : 'เนื่องจากเว็บจริงบน GitHub Pages เป็น Static Web (เบราว์เซอร์ยิงตรงไปหา api.line.me ไม่ได้เพราะติด CORS) ระบบจะส่งแจ้งเตือนผ่านลิงก์ Google Apps Script ด้านล่างโดยอัตโนมัติ'}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      LINE Channel Access Token (Long-lived)
                    </label>
                    {lineSettings.channelAccessToken.trim() && (
                      <span
                        className={`text-[11px] font-semibold ${
                          lineSettings.channelAccessToken.trim().length >= 80
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {lineSettings.channelAccessToken.trim().length >= 80
                          ? `✓ ความยาว ${lineSettings.channelAccessToken.trim().length} ตัวอักษร`
                          : `⚠️ สั้นผิดปกติ (${lineSettings.channelAccessToken.trim().length} ตัวอักษร)`}
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    value={lineSettings.channelAccessToken}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        channelAccessToken: e.target.value,
                      })
                    }
                    placeholder="วาง Channel Access Token ของ LINE OA..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
                  />

                  {/* Live LINE OA Monthly Quota Meter */}
                  {lineSettings.channelAccessToken.trim().length >= 40 && (
                    <div
                      className={`mt-2.5 p-3 rounded-xl border text-xs space-y-2 ${
                        lineQuotaInfo.isExhausted
                          ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-bold flex items-center gap-1.5">
                          <BarChart3
                            className={`h-3.5 w-3.5 shrink-0 ${
                              lineQuotaInfo.isExhausted ? 'text-rose-600' : 'text-indigo-600'
                            }`}
                          />
                          <span>โควต้าส่งข้อความอัตโนมัติ (Push / Broadcast) รายเดือนของ LINE OA</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => fetchLineQuota()}
                          disabled={lineQuotaInfo.loading}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 whitespace-nowrap shrink-0 disabled:opacity-60"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${lineQuotaInfo.loading ? 'animate-spin' : ''}`}
                          />
                          <span>เช็กโควต้าล่าสุด</span>
                        </button>
                      </div>

                      {lineQuotaInfo.checked && lineQuotaInfo.limit !== null ? (
                        <>
                          <div className="flex flex-wrap items-baseline justify-between gap-2 tabular-nums">
                            <span>
                              ใช้ไปแล้ว{' '}
                              <strong className="font-extrabold">
                                {lineQuotaInfo.totalUsage.toLocaleString()}
                              </strong>{' '}
                              / {lineQuotaInfo.limit.toLocaleString()} ข้อความ
                            </span>
                            <span
                              className={`font-bold ${
                                lineQuotaInfo.isExhausted
                                  ? 'text-rose-700'
                                  : (lineQuotaInfo.remaining ?? 0) <= 40
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {lineQuotaInfo.isExhausted
                                ? 'เต็มโควต้าเดือนนี้แล้ว (รีเซ็ตวันที่ 1 เดือนถัดไป)'
                                : `คงเหลือ ${(lineQuotaInfo.remaining ?? 0).toLocaleString()} ข้อความ`}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-md bg-slate-200/80 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                lineQuotaInfo.isExhausted
                                  ? 'bg-rose-600'
                                  : (lineQuotaInfo.remaining ?? 0) <= 40
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-600'
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round(
                                    (lineQuotaInfo.totalUsage / Math.max(1, lineQuotaInfo.limit)) *
                                      100
                                  )
                                )}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] text-slate-600">
                          แพ็กเกจฟรีของ LINE OA ส่ง Push/Broadcast ได้ 300 ข้อความ/เดือน (นับตามจำนวนคนรับในกลุ่ม) กดปุ่ม &ldquo;เช็กโควต้าล่าสุด&rdquo; เพื่อตรวจสอบยอดคงเหลือ
                        </div>
                      )}

                      <div className="text-[11px] leading-relaxed opacity-90">
                        {lineQuotaInfo.isExhausted
                          ? 'การพิมพ์ถามบอทในแชทกลุ่มหรือแชทส่วนตัว เช่น "สรุปงานวันนี้", "งานพรุ่งนี้", "งานค้าง" ใช้ระบบตอบกลับ (Reply API) ฟรีไม่จำกัด — หรือสลับใช้ Telegram Bot เพื่อรับแจ้งเตือนอัตโนมัติฟรีไม่จำกัดข้อความแทนได้ทันที'
                          : 'คำแนะนำประหยัดโควต้า: เลือกโหมด "2. ห้องแชทกลุ่ม (C...)" ด้านล่างแทน "ส่งทั้ง 2 รูปแบบ" หรือเปิดใช้งาน Telegram Bot ควบคู่เพื่อรับแจ้งเตือนฟรีไม่จำกัดข้อความ'}
                      </div>
                      {lineQuotaInfo.isExhausted && (
                        <button
                          type="button"
                          onClick={() => setActiveSettingsTab('telegram')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                        >
                          <Send className="h-3.5 w-3.5 shrink-0" />
                          <span>ตั้งค่า Telegram Bot (ฟรีไม่จำกัดข้อความ)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* รูปแบบที่ 1 & รูปแบบที่ 2: Team Notification Mode + LINE Group ID (C...) */}
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-bold text-emerald-950">
                      รูปแบบการแจ้งเตือนทีม (แชทส่วนตัว vs ห้องแชทกลุ่ม LINE ของทีม)
                    </label>
                    <span className="text-[11px] font-semibold text-[#06C755] bg-white px-2 py-0.5 rounded border border-emerald-200">
                      รองรับ Group Chat (C...)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      {
                        id: 'broadcast' as const,
                        title: '1. แยกแชทส่วนตัว',
                        desc: 'Broadcast หาทุกคนที่แอดเพื่อน',
                      },
                      {
                        id: 'group' as const,
                        title: '2. ห้องแชทกลุ่ม (แนะนำ)',
                        desc: 'ส่งเฉพาะในกลุ่ม LINE (ประหยัดโควต้า)',
                      },
                      {
                        id: 'both' as const,
                        title: 'ส่งทั้ง 2 รูปแบบ',
                        desc: 'กลุ่ม + แชทส่วนตัว (ใช้โควต้า 2 เท่า)',
                      },
                    ].map((opt) => {
                      const currentMode =
                        lineSettings.teamNotificationMode ||
                        ((lineSettings.targetGroupId || '').trim() ? 'group' : 'broadcast');
                      const selected = currentMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...lineSettings,
                              teamNotificationMode: opt.id,
                            })
                          }
                          className={`text-left rounded-lg border p-2.5 transition-all ${
                            selected
                              ? 'border-[#06C755] bg-white ring-2 ring-[#06C755]/25'
                              : 'border-emerald-200/80 bg-white/60 hover:bg-white'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900">{opt.title}</div>
                          <div className="text-[11px] text-slate-600 mt-0.5">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-emerald-950">
                        รหัสห้องแชทกลุ่ม LINE (Group ID สำหรับรูปแบบที่ 2 — ขึ้นต้นด้วย C ความยาว 33 ตัวอักษร)
                      </label>
                      {(lineSettings.targetGroupId || '').trim() && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...lineSettings,
                              targetGroupId: '',
                            })
                          }
                          className="text-[11px] font-semibold text-rose-600 hover:underline"
                        >
                          ล้างรหัสกลุ่ม
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={lineSettings.targetGroupId || ''}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...lineSettings,
                            targetGroupId: e.target.value.trim(),
                          })
                        }
                        placeholder="เชิญบอทเข้ากลุ่ม พิมพ์ 'เชื่อมกลุ่ม' แล้วกดดึงรหัส C... อัตโนมัติ"
                        className="flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          let foundGroup = '';
                          let isOutdatedGas = false;
                          let webhookActive = true;
                          try {
                            const checkRes = await fetch('/api/line/check-group-webhook', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                channelAccessToken: lineSettings.channelAccessToken,
                                gasUrl: gasUrl.trim(),
                              }),
                            });
                            if (checkRes.ok) {
                              const checkData = await checkRes.json();
                              if (
                                typeof checkData.detectedGroupId === 'string' &&
                                /^[CR][0-9a-fA-F]{32}$/.test(checkData.detectedGroupId.trim())
                              ) {
                                foundGroup = checkData.detectedGroupId.trim();
                              }
                              if (checkData.isOutdatedGas) {
                                isOutdatedGas = true;
                              }
                              if (checkData.webhookActive === false) {
                                webhookActive = false;
                              }
                            }
                          } catch {
                            // Ignore
                          }
                          if (!foundGroup && gasUrl.trim().startsWith('https://script.google.com/macros/s/')) {
                            try {
                              const gRes = await fetch(gasUrl.trim(), {
                                method: 'POST',
                                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                                body: JSON.stringify({
                                  action: 'check_bridge',
                                  channelAccessToken: lineSettings.channelAccessToken,
                                }),
                              });
                              const gData = await gRes.json();
                              if (
                                typeof gData.detectedGroupId === 'string' &&
                                /^[CR][0-9a-fA-F]{32}$/.test(gData.detectedGroupId.trim())
                              ) {
                                foundGroup = gData.detectedGroupId.trim();
                              } else if (
                                gData.status === 'verified' &&
                                gData.mode !== 'gas_bridge_ready'
                              ) {
                                isOutdatedGas = true;
                              }
                            } catch {
                              // Ignore
                            }
                          }
                          if (foundGroup) {
                            onUpdateSettings({
                              ...lineSettings,
                              targetGroupId: foundGroup,
                            });
                            setRichMenuClearStatus({
                              ok: true,
                              message: `✅ ดึงรหัสห้องแชทกลุ่ม LINE สำเร็จ: ${foundGroup}`,
                            });
                          } else if (!webhookActive) {
                            setRichMenuClearStatus({
                              ok: false,
                              message:
                                '❌ สวิตช์ "Use webhook" ใน LINE Developers Console ยังปิดอยู่! กรุณาเปิดสวิตช์ Use webhook ให้เป็นสีเขียว แล้วพิมพ์ "เชื่อมกลุ่ม" ในกลุ่ม LINE อีกครั้งครับ',
                            });
                          } else if (isOutdatedGas) {
                            setRichMenuClearStatus({
                              ok: false,
                              message:
                                '❌ พบสาเหตุที่พิมพ์ "เชื่อมกลุ่ม" แล้วบอทไม่ตอบกลับรหัส Group ID: ลิงก์ Google Apps Script ด้านล่างของคุณยังเป็น "โค้ดเวอร์ชันเก่า"! วิธีแก้: 1) กดปุ่ม "คัดลอกโค้ด Apps Script" ด้านล่างสุด 2) นำไปวางทับใน Apps Script 3) กดปุ่ม Deploy > Manage deployments > กดรูปดินสอ (Edit) > ช่อง Version เลือก "New version" > กด Deploy แล้วพิมพ์ "เชื่อมกลุ่ม" ในกลุ่ม LINE อีกครั้งครับ',
                            });
                          } else {
                            setRichMenuClearStatus({
                              ok: false,
                              message:
                                '⚠️ ยังไม่พบ Group ID (C...) — กรุณาคัดลอกโค้ด Apps Script ด้านล่างไปอัปเดตเป็น New version ก่อน แล้วเชิญบอทเข้ากลุ่ม LINE พิมพ์คำว่า "เชื่อมกลุ่ม" ในกลุ่ม 1 ครั้งครับ',
                            });
                          }
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 whitespace-nowrap shrink-0"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-emerald-700" />
                        <span>ดึงรหัสกลุ่ม C... อัตโนมัติ</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-emerald-900 mt-1.5 leading-relaxed">
                      💡 <strong>เคล็ดลับสำคัญ:</strong> ในเว็บ{' '}
                      <a
                        href="https://manager.line.biz"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-semibold"
                      >
                        manager.line.biz
                      </a>{' '}
                      &gt; ตั้งค่า &gt; ตั้งค่าบัญชี ต้องติ๊ก{' '}
                      <strong>"อนุญาตให้บัญชีเข้าร่วมกลุ่มและแชทแบบหลายคน"</strong> ด้วยนะครับ บอทจึงจะเข้ากลุ่มและส่งแจ้งเตือนเข้ากลุ่มได้
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-700">
                      LINE User ID ส่วนตัว (ไม่บังคับ — ขึ้นต้นด้วย U หรือ C ความยาว 33 ตัวอักษร)
                    </label>
                    {lineSettings.targetUserId.trim() && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            ...lineSettings,
                            targetUserId: '',
                          })
                        }
                        className="text-[11px] font-semibold text-indigo-600 hover:underline"
                      >
                        ล้างค่า (ใช้ Broadcast แทน)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={lineSettings.targetUserId}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        targetUserId: e.target.value,
                      })
                    }
                    placeholder="เว้นว่างไว้เพื่อส่งแบบ Broadcast หรือใส่รหัส U... / C... 33 ตัวอักษร"
                    className={`w-full rounded-lg border px-3 py-1.5 text-xs font-mono-tabular text-slate-900 ${
                      lineSettings.targetUserId.trim() &&
                      !/^[UCR][0-9a-fA-F]{32}$/.test(lineSettings.targetUserId.trim())
                        ? 'border-amber-400 bg-amber-50/40'
                        : 'border-slate-300'
                    }`}
                  />
                  {lineSettings.targetUserId.trim() &&
                    !/^[UCR][0-9a-fA-F]{32}$/.test(lineSettings.targetUserId.trim()) && (
                      <div className="mt-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                        ⚠️ <strong>ข้อควรระวัง:</strong> รหัสที่กรอก (
                        <code className="font-mono-tabular font-bold">
                          {lineSettings.targetUserId.trim()}
                        </code>
                        ) ไม่ใช่รหัส Webhook ID 33 ตัวอักษร (ที่ขึ้นต้นด้วย{' '}
                        <code className="font-bold">U</code> หรือ <code className="font-bold">C</code>
                        ) แต่เป็นไอดีไลน์ทั่วไป — แนะนำให้กด{' '}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...lineSettings,
                              targetUserId: '',
                            })
                          }
                          className="font-bold text-indigo-700 underline"
                        >
                          ล้างค่าช่องนี้
                        </button>{' '}
                        เพื่อให้ระบบส่งเข้ากลุ่ม LINE หรือส่งแบบ <strong>Broadcast</strong> ได้ทันทีครับ
                      </div>
                    )}
                </div>

                {/* Interactive LINE Connection Diagnostic & Rich Menu Cleanup Box */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    disabled={isDiagnosingLine}
                    onClick={() => handleDiagnoseLineApi(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
                    <span>
                      {isDiagnosingLine
                        ? 'กำลังตรวจสอบ Token & ทดสอบยิงเข้า LINE...'
                        : '🔍 ตรวจสอบสถานะ Token & ทดสอบยิงเข้า LINE จริง'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isClearingRichMenu}
                    onClick={() => handleClearLineRichMenu(false)}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    <span>
                      {isClearingRichMenu
                        ? 'กำลังส่งคำสั่งลบ Rich Menu ออกจาก LINE OA...'
                        : '🗑️ ลบ Rich Menu ที่ค้างในแอป LINE OA ทันที'}
                    </span>
                  </button>

                  {richMenuClearStatus && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                        richMenuClearStatus.ok
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                          : 'bg-amber-50 border-amber-200 text-amber-950'
                      }`}
                    >
                      {richMenuClearStatus.message}
                    </div>
                  )}

                  {lineDiagnosticResult && (
                    <div className="mt-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-900">
                        ผลการตรวจสอบการเชื่อมต่อ LINE Messaging API:
                      </div>
                      {lineDiagnosticResult.steps.map((s, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded-md border text-xs leading-relaxed ${
                            s.status === 'ok'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                              : s.status === 'warn'
                              ? 'bg-amber-50 border-amber-200 text-amber-950'
                              : 'bg-red-50 border-red-200 text-red-900'
                          }`}
                        >
                          <div className="font-bold">
                            {s.status === 'ok' ? '✅ ' : s.status === 'warn' ? '⚠️ ' : '❌ '}
                            {s.step}
                          </div>
                          <div className="mt-0.5 text-[11px]">{s.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: Telegram Bot (Free Unlimited Notifications) */}
            {activeSettingsTab === 'telegram' && (
              <div className="mt-4 space-y-4">
                <div className="p-3.5 rounded-xl border border-sky-200 bg-sky-50/70 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">
                      เปิดใช้งานแจ้งเตือนผ่าน Telegram Bot (ฟรีไม่จำกัดข้อความ)
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                      {telegramReady
                        ? 'พร้อมส่งแจ้งเตือนตามเวลาและสรุปงานประจำวันเข้า Telegram โดยอัตโนมัติ (ใช้งานแทนหรือควบคู่กับ LINE ได้ทันที)'
                        : 'กรอก Bot Token และ Chat ID ด้านล่างเพื่อเปิดรับแจ้งเตือนตารางงานฟรี ไม่มีโควตา 300 ข้อความ/เดือน'}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(lineSettings.telegramEnabled)}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...lineSettings,
                          telegramEnabled: e.target.checked,
                        })
                      }
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        lineSettings.telegramEnabled ? 'bg-[#0088cc]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-2xs transition-transform ${
                          lineSettings.telegramEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                    <span
                      className={`text-xs font-bold ${
                        lineSettings.telegramEnabled ? 'text-[#006da3]' : 'text-slate-600'
                      }`}
                    >
                      {lineSettings.telegramEnabled ? 'เปิดใช้งาน' : 'ปิดไว้'}
                    </span>
                  </label>
                </div>

                {/* Step 1: Bot Token */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-900">
                      1. Telegram Bot Token (จาก @BotFather)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowTelegramGuide((prev) => !prev)}
                      className="text-[11px] font-semibold text-[#0077b3] hover:underline whitespace-nowrap shrink-0"
                    >
                      {showTelegramGuide ? 'ซ่อนวิธีสร้างบอท' : 'ดูวิธีสร้างบอทใน 2 นาที'}
                    </button>
                  </div>
                  <input
                    type="password"
                    value={lineSettings.telegramBotToken || ''}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        telegramBotToken: e.target.value,
                      })
                    }
                    placeholder="เช่น 7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:border-[#0088cc]"
                  />
                </div>

                {showTelegramGuide && (
                  <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-700 space-y-1.5 leading-relaxed">
                    <div className="font-bold text-slate-900">
                      ขั้นตอนสร้าง Telegram Bot และเชื่อมเข้ากลุ่มทีม (ทำครั้งเดียว):
                    </div>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>
                        เปิดแอป <strong>Telegram</strong> แล้วค้นหา <code className="font-mono bg-white px-1 rounded border border-slate-200">@BotFather</code> กด <strong>Start</strong> แล้วพิมพ์ <code className="font-mono bg-white px-1 rounded border border-slate-200">/newbot</code>
                      </li>
                      <li>
                        ตั้งชื่อบอท (เช่น <em>น้องเลขา สบต.</em>) และ Username ที่ลงท้ายด้วย <code className="font-mono bg-white px-1 rounded border border-slate-200">bot</code> แล้วคัดลอก <strong>HTTP API Token</strong> มาวางในช่องที่ 1 ด้านบน
                      </li>
                      <li>
                        ถ้าส่งเข้าแชทส่วนตัว ให้เปิดแชทบอทแล้วกด <strong>Start</strong> — ถ้าส่งเข้า<strong>กลุ่มทีม</strong> ให้ดึงบอทเข้ากลุ่ม Telegram แล้วพิมพ์ข้อความในกลุ่ม 1 ครั้ง (เช่น <em>&ldquo;สวัสดี&rdquo;</em>)
                      </li>
                      <li>
                        กลับมากดปุ่ม <strong>&ldquo;ค้นหา Chat ID อัตโนมัติ&rdquo;</strong> ด้านล่าง แล้วคลิกเลือกห้องที่ต้องการ กด <strong>&ldquo;ทดสอบส่งเข้า Telegram&rdquo;</strong> เป็นอันเสร็จครับ
                      </li>
                    </ol>
                  </div>
                )}

                {/* Step 2: Chat ID + Auto Detector */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-xs font-semibold text-slate-900">
                      2. Telegram Chat ID / Group ID (ใส่หลายห้องคั่นด้วยเครื่องหมายจุลภาคได้)
                    </label>
                    {parseTelegramChatIds(lineSettings.telegramChatId || '').length > 0 && (
                      <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                        ✓ พร้อมส่ง {parseTelegramChatIds(lineSettings.telegramChatId || '').length} ห้องแชท
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={lineSettings.telegramChatId || ''}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...lineSettings,
                          telegramChatId: e.target.value,
                        })
                      }
                      placeholder="เช่น -1001234567890 (กลุ่ม) หรือ 987654321 (ส่วนตัว)"
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:border-[#0088cc]"
                    />
                    <button
                      type="button"
                      disabled={isDetectingTelegram}
                      onClick={handleDetectTelegramChats}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-300 bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-[#006da3] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isDetectingTelegram ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isDetectingTelegram ? 'กำลังค้นหา...' : 'ค้นหา Chat ID อัตโนมัติ'}
                      </span>
                    </button>
                  </div>

                  {telegramDetectResult && (
                    <div
                      className={`p-3 rounded-lg border text-xs space-y-2 ${
                        telegramDetectResult.ok
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                          : 'bg-amber-50 border-amber-200 text-amber-950'
                      }`}
                    >
                      <div className="font-semibold leading-relaxed">
                        {telegramDetectResult.message}
                      </div>
                      {telegramDetectResult.chats.length > 0 && (
                        <div className="divide-y divide-emerald-200/70 border border-emerald-200 rounded-lg bg-white overflow-hidden">
                          {telegramDetectResult.chats.map((ch) => {
                            const isSelected = parseTelegramChatIds(
                              lineSettings.telegramChatId || ''
                            ).includes(ch.chatId);
                            return (
                              <div
                                key={ch.chatId}
                                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-900 truncate">
                                    {ch.title}
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                    {ch.type === 'private' ? 'แชทส่วนตัว' : 'กลุ่ม/ช่อง'} · ID:{' '}
                                    {ch.chatId}
                                    {ch.lastMessageText ? ` · ล่าสุด: "${ch.lastMessageText}"` : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectDetectedTelegramChat(ch.chatId, false)}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                      isSelected
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-[#0088cc] hover:bg-[#0077b3] text-white'
                                    }`}
                                  >
                                    {isSelected ? 'เลือกอยู่แล้ว' : 'ใช้ห้องนี้'}
                                  </button>
                                  {!isSelected &&
                                    parseTelegramChatIds(lineSettings.telegramChatId || '').length >
                                      0 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleSelectDetectedTelegramChat(ch.chatId, true)
                                        }
                                        className="px-2 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 whitespace-nowrap"
                                      >
                                        + เพิ่มอีกห้อง
                                      </button>
                                    )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Step 3: Message Styling & Live Preview */}
                <div className="pt-3 border-t border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold text-slate-800">
                      3) ปรับแต่งรูปแบบการ์ด Telegram ให้สวยงาม
                    </label>
                    <span className="text-[10px] font-medium text-slate-500">
                      ส่งเป็นภาพการ์ดคมชัดระดับ 2x เหมือน LINE Flex Card ได้ทันที
                    </span>
                  </div>

                  {/* Delivery Mode Toggle: Graphic Photo Card vs HTML Text */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          telegramDeliveryMode: 'photo_card',
                        })
                      }
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        lineSettings.telegramDeliveryMode !== 'text_html'
                          ? 'border-[#0088cc] bg-[#f0f8fd]'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`text-xs font-semibold ${
                            lineSettings.telegramDeliveryMode !== 'text_html'
                              ? 'text-[#006699]'
                              : 'text-slate-800'
                          }`}
                        >
                          การ์ดภาพกราฟิก (เหมือน LINE Flex)
                        </span>
                        <span className="text-[10px] font-semibold text-[#0077b3]">แนะนำ</span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                        แสดงหัวการ์ดสี Royal Navy + แถบสรุป KPI + ตารางคมชัดสวยงามทั้งโหมดสว่างและมืด
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...lineSettings,
                          telegramDeliveryMode: 'text_html',
                        })
                      }
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        lineSettings.telegramDeliveryMode === 'text_html'
                          ? 'border-[#0088cc] bg-[#f0f8fd]'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`text-xs font-semibold ${
                            lineSettings.telegramDeliveryMode === 'text_html'
                              ? 'text-[#006699]'
                              : 'text-slate-800'
                          }`}
                        >
                          ข้อความ HTML (กล่อง Quote)
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                        ข้อความตัวอักษรล้วนในกรอบ Quote เบา ประหยัดเน็ต และคัดลอกข้อความได้ง่าย
                      </p>
                    </button>
                  </div>

                  {/* 3 Selectable Template Presets */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {TELEGRAM_STYLE_PRESETS.map((preset) => {
                      const isActive =
                        (lineSettings.telegramStyle || 'executive_card') === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...lineSettings,
                              telegramStyle: preset.id,
                            })
                          }
                          className={`text-left p-2.5 rounded-lg border transition-colors ${
                            isActive
                              ? 'border-[#0088cc] bg-[#f0f8fd]'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span
                              className={`text-xs font-semibold ${
                                isActive ? 'text-[#006699]' : 'text-slate-800'
                              }`}
                            >
                              {preset.title}
                            </span>
                            {preset.badge && (
                              <span className="text-[10px] font-semibold text-[#0077b3]">
                                {preset.badge}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-slate-500">
                            {preset.subtitle}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Header Title + Toggle Options */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        ชื่อหัวการ์ด / ชื่อหน่วยงาน (บรรทัดบนสุด)
                      </label>
                      <input
                        type="text"
                        value={
                          lineSettings.telegramHeaderTitle ?? DEFAULT_TELEGRAM_HEADER_TITLE
                        }
                        onChange={(e) =>
                          onUpdateSettings({
                            ...lineSettings,
                            telegramHeaderTitle: e.target.value,
                          })
                        }
                        placeholder={DEFAULT_TELEGRAM_HEADER_TITLE}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0088cc]/30 focus:border-[#0088cc]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={lineSettings.telegramShowStats !== false}
                          onChange={(e) =>
                            onUpdateSettings({
                              ...lineSettings,
                              telegramShowStats: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-[#0088cc]"
                        />
                        <span>แสดงแถบสรุปยอดงาน</span>
                      </label>
                    </div>
                  </div>

                  {/* Card Font Size Quick Control */}
                  {lineSettings.telegramDeliveryMode !== 'text_html' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-[11px] font-semibold text-slate-700">
                        ขนาดตัวอักษรบนภาพการ์ด (เหมาะกับจอมือถือ)
                      </span>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                        {(
                          [
                            { id: 'sm', label: 'กะทัดรัด' },
                            { id: 'md', label: 'ใหญ่ชัดเจน (แนะนำ)' },
                            { id: 'lg', label: 'ใหญ่มาก' },
                          ] as const
                        ).map((opt) => {
                          const isActive = (lineSettings.cardFontSize || 'md') === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                onUpdateSettings({
                                  ...lineSettings,
                                  cardFontSize: opt.id,
                                })
                              }
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-[#0088cc] text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Live Telegram Chat Preview */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#0088cc]" />
                        <span className="text-[11px] font-semibold text-slate-700">
                          ตัวอย่างหน้าตาจริงที่จะได้รับบนแอป Telegram
                        </span>
                      </div>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() => setTelegramPreviewMode('task')}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            telegramPreviewMode === 'task'
                              ? 'bg-[#0088cc] text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          เตือน 1 งาน
                        </button>
                        <button
                          type="button"
                          onClick={() => setTelegramPreviewMode('digest')}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            telegramPreviewMode === 'digest'
                              ? 'bg-[#0088cc] text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          สรุปประจำวัน
                        </button>
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 bg-[#17212b]">
                      <div className="max-w-md">
                        {lineSettings.telegramDeliveryMode !== 'text_html' ? (
                          <div className="rounded-2xl rounded-tl-sm bg-[#232e3c] overflow-hidden border border-white/10 shadow-sm">
                            {telegramPreviewCardUrl ? (
                              <img
                                src={telegramPreviewCardUrl}
                                alt="ตัวอย่างการ์ดแจ้งเตือน Telegram"
                                className="w-full h-auto block"
                              />
                            ) : (
                              <div className="py-12 text-center text-xs text-slate-300">
                                กำลังสร้างภาพการ์ดตัวอย่าง...
                              </div>
                            )}
                            <div className="px-3 py-2 text-[12px] leading-relaxed text-slate-100">
                              <div className="space-y-0.5 [&>div]:text-slate-200 [&_strong]:text-white [&_em]:text-slate-300 [&_code]:bg-sky-500/20 [&_code]:text-sky-300">
                                {renderTelegramPreviewBlocks(telegramPreviewPhotoCaption)}
                              </div>
                              <div className="mt-1 text-right text-[10px] text-slate-400 font-mono tabular-nums">
                                {formatLocalTimeHM()}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 shadow-2xs border border-slate-200/80 space-y-1">
                            <div className="flex items-center justify-between gap-2 pb-0.5">
                              <span className="text-[11px] font-semibold text-[#0077b3]">
                                Lakha · น้องเลขา
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                                {formatLocalTimeHM()}
                              </span>
                            </div>
                            <div>{renderTelegramPreviewBlocks(telegramPreviewHtml)}</div>
                          </div>
                        )}

                        {telegramPreviewButtons.length > 0 && (
                          <div className="mt-1.5 space-y-1">
                            {telegramPreviewButtons.map((row, rowIdx) => (
                              <div
                                key={`tg-btn-row-${rowIdx}`}
                                className={`grid gap-1 ${
                                  row.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'
                                }`}
                              >
                                {row.map((btn, btnIdx) => (
                                  <div
                                    key={`tg-btn-${rowIdx}-${btnIdx}`}
                                    className="rounded-lg bg-[#2b5278]/90 px-2.5 py-1.5 text-center text-[11px] font-semibold text-white truncate"
                                  >
                                    {btn.text}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 4: Live Test Buttons */}
                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isTestingTelegram}
                      onClick={handleTestTelegramSend}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {isTestingTelegram ? 'กำลังส่งทดสอบ...' : 'ทดสอบส่งข้อความเข้า Telegram'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={
                        isTestingTelegram ||
                        (!telegramReady &&
                          !(
                            runtimeMode === 'fullstack' &&
                            parseTelegramChatIds(lineSettings.telegramChatId || '').length > 0
                          ))
                      }
                      onClick={handleSendSampleTaskToTelegramOnly}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <Bell className="h-3.5 w-3.5 shrink-0 text-[#0088cc]" />
                      <span>
                        {telegramPreviewMode === 'digest'
                          ? 'ส่งตัวอย่างสรุปวันเข้า Telegram จริง'
                          : 'ส่งตัวอย่างแบบที่เลือกเข้า Telegram จริง'}
                      </span>
                    </button>
                  </div>

                  {telegramTestStatus && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                        telegramTestStatus.ok
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                          : 'bg-rose-50 border-rose-200 text-rose-900'
                      }`}
                    >
                      {telegramTestStatus.message}
                    </div>
                  )}

                  {/* 24/7 Offline Google Apps Script Auto-Reminder Box */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        แจ้งเตือนอัตโนมัติ 24 ชม. แม้ปิดคอมพิวเตอร์ (Google Apps Script)
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                        สรุปเช้า {lineSettings.dailyDigestTime || '08:00'} น. · เตือน{' '}
                        {(lineSettings.reminderTimings && lineSettings.reminderTimings.length > 0
                          ? lineSettings.reminderTimings
                          : [lineSettings.defaultRemindMinutes || 15]
                        )
                          .map(formatRemindMinutesLabel)
                          .join(' / ')}
                      </span>
                    </div>

                    <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 leading-relaxed">
                      <li>
                        กดปุ่ม <strong>คัดลอกโค้ด Apps Script</strong> ด้านล่าง แล้วนำไปวางทับใน Google Sheets &gt;{' '}
                        <code className="font-mono text-slate-800">Extensions &gt; Apps Script</code> กด Save
                      </li>
                      <li>
                        กด <strong>Deploy &gt; Manage deployments &gt; แก้ไข (ดินสอ) &gt; เลือก New version &gt; Deploy</strong>
                      </li>
                      <li>
                        เลือกฟังก์ชัน <code className="font-mono font-semibold text-[#006699]">setupTelegramAutoTriggers</code>{' '}
                        ที่แถบด้านบนแล้วกด <strong>Run</strong> เพียงครั้งเดียว — ระบบจะเช็กเตือนงานล่วงหน้าและส่งสรุปเช้าเข้า Telegram ทุก 5 นาทีตลอด 24 ชม.
                      </li>
                    </ol>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleCopyScript}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                      >
                        {copiedScript ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {copiedScript
                            ? 'คัดลอกโค้ด Apps Script (24 ชม.) แล้ว!'
                            : 'คัดลอกโค้ด Apps Script (รองรับเตือน 24 ชม.)'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isSyncingTgToGas}
                        onClick={handleSyncTelegramScheduleToGas}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 shrink-0 ${isSyncingTgToGas ? 'animate-spin' : ''}`}
                        />
                        <span>
                          {isSyncingTgToGas ? 'กำลังซิงก์...' : 'ซิงก์เวลาเตือนล่าสุดเข้า Apps Script'}
                        </span>
                      </button>
                    </div>

                    {tgGasSyncStatus && (
                      <div
                        className={`p-2 rounded-lg border text-[11px] leading-relaxed ${
                          tgGasSyncStatus.ok
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                            : 'bg-amber-50 border-amber-200 text-amber-950'
                        }`}
                      >
                        {tgGasSyncStatus.message}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Test Action Buttons */}
            <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {onTestSingleTaskNotification && (
                <button
                  type="button"
                  disabled={isSendingPush}
                  onClick={() => onTestSingleTaskNotification(samplePreviewTask)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] shadow-2xs transition-colors whitespace-nowrap"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>{isSendingPush ? 'กำลังส่ง...' : 'ทดสอบการ์ดแจ้งเตือนงาน'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={onTestPushNotification}
                disabled={isSendingPush}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-2xs transition-colors whitespace-nowrap"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>ส่งการ์ดสรุปงานประจำวัน</span>
              </button>
            </div>
          </div>

          {/* Google Apps Script Webhook Setup Card */}
          <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 space-y-3 shadow-2xs">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <Code2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900">
                เชื่อมต่อ LINE Webhook ผ่าน Google Apps Script
              </h3>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="text-xs font-medium text-slate-700">
                  ลิงก์ Web App URL ของคุณ
                </div>
                {gasCardVersionInfo.status === 'up_to_date' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[11px] font-bold">
                    ✓ เวอร์ชันล่าสุด: {gasCardVersionInfo.detectedVersion || '3.0-executive-card'}
                  </span>
                )}
                {gasCardVersionInfo.status === 'outdated' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-200/80 text-amber-950 text-[11px] font-bold">
                    ! ลิงก์นี้ยังเป็น: {gasCardVersionInfo.detectedVersion} (รออัปเดตเป็น v3.0)
                  </span>
                )}
              </div>
              <input
                type="text"
                value={gasUrl}
                onChange={(e) => setGasUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isTestingGas}
                  onClick={() => handleTestGasWebhook(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                >
                  {isTestingGas ? 'กำลังตรวจสอบ...' : 'ตรวจสอบลิงก์ & เช็กเวอร์ชันจริง'}
                </button>
                <button
                  type="button"
                  disabled={isTestingGas}
                  onClick={() => handleTestGasWebhook(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
                >
                  {isTestingGas ? 'กำลังส่ง...' : 'ทดสอบส่งงานเข้าปฏิทิน'}
                </button>
              </div>
              {gasVerifyResult && (
                <div
                  className={`p-2.5 rounded-md text-xs leading-relaxed ${
                    gasVerifyResult.ok
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                      : 'bg-amber-50 border border-amber-300 text-amber-950'
                  }`}
                >
                  {gasVerifyResult.message}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyScript}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                {copiedScript ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>คัดลอกโค้ด v3.0 แล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-amber-400" />
                    <span>คัดลอกโค้ด Apps Script ล่าสุด (v3.0 ดีไซน์ผู้บริหาร)</span>
                  </>
                )}
              </button>

              {spreadsheetUrl ? (
                <a
                  href={spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  <span>เปิดชีต</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                onCreateSpreadsheet && (
                  <button
                    type="button"
                    onClick={onCreateSpreadsheet}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    <span>สร้างชีต</span>
                  </button>
                )
              )}

              <button
                type="button"
                onClick={() => setShowScriptPanel(!showScriptPanel)}
                className="px-2.5 py-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline whitespace-nowrap shrink-0"
              >
                {showScriptPanel ? 'ซ่อนโค้ด' : 'ดูโค้ด'}
              </button>
            </div>

            {showScriptPanel && (
              <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] font-mono-tabular overflow-x-auto max-h-52 leading-relaxed">
                {appsScriptCode}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
