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
  LineMessageLog,
  LineNotificationFormat,
  LineSettings,
  Task,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  REMINDER_TIMING_OPTIONS,
  consolidateContinuousTasks,
  doesTaskTriggerNotification,
  formatLocalDateYMD,
  formatRemindMinutesLabel,
  formatSummaryCardHeaderDate,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  generateGoogleAppsScriptCode,
  getPriorityHeaderTheme,
  renderCustomLineMessage,
  resolveTeamCalendarAppUrl,
} from '../services/lineCommandParser';
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
    'timing' | 'format' | 'triggers' | 'api'
  >('format');
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
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
            if (
              gasJson.mode === 'gas_bridge_ready' ||
              gasJson.version === '2.6-group-bridge' ||
              gasJson.version === '2.5-gas-bridge'
            ) {
              serverSteps.push({
                step: '4. ตรวจสอบความพร้อมสำหรับรันบนเว็บจริง (GitHub Pages Bridge)',
                status: 'ok',
                detail: `ลิงก์ Google Apps Script ของคุณพร้อมส่งแจ้งเตือนเข้า LINE (${String(
                  gasJson.version || 'Bridge Ready'
                )})${
                  gasDetectedGroup ? ` · ตรวจพบรหัสกลุ่มล่าสุด: ${gasDetectedGroup}` : ''
                }`,
              });
            } else {
              serverSteps.push({
                step: '4. ตรวจสอบความพร้อมสำหรับรันบนเว็บจริง (GitHub Pages Bridge)',
                status: 'warn',
                detail:
                  '⚠️ พบสาเหตุที่รันเป็นเว็บจริง (GitHub Pages) แล้วไม่แจ้งเตือน! ลิงก์ Google Apps Script ปัจจุบันของคุณยังเป็นโค้ดเวอร์ชันเก่า — กรุณากดปุ่ม "คัดลอกโค้ด Apps Script" ด้านล่าง ไปวางทับใน Google Sheets > Extensions > Apps Script แล้วกด Deploy > Manage deployments > แก้ไข (รูปดินสอ) > เลือก Version: New version > กด Deploy',
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
            steps.push({
              step: '3. ผลส่งข้อความเข้า LINE ผ่าน Google Apps Script Bridge',
              status: 'error',
              detail: `Google Apps Script เชื่อมต่อได้แล้ว แต่ LINE API ปฏิเสธคำขอ (HTTP ${gasData.lineHttpCode}): ${String(gasData.lineError || 'ตรวจสอบ Channel Access Token หรือการแอดเพื่อนบอท')}`,
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

  useEffect(() => {
    try {
      if (gasUrl.trim()) {
        localStorage.setItem('sheetcal_gas_url_v1', gasUrl.trim());
      }
    } catch {
      // Ignore storage error
    }
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
    resolvedCalendarButtonUrl
  );

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

    const sampleText = withSampleTask
      ? `ทดสอบส่งงานจาก LINE วันนี้ 15:30 #สูง`
      : undefined;

    try {
      // 1. ลองเรียกผ่าน Backend API ก่อน (กรณีรันบน Full-stack Server)
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

      // 2. ตรวจสอบตรงจากเบราว์เซอร์ไปที่ Google Apps Script (อ่าน JSON Response เพื่อเช็คเวอร์ชันโค้ดจริง)
      if (!handledByBackend || !withSampleTask) {
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
          // ใช้ text/plain แบบปกติก่อนเพื่ออ่าน JSON ตรวจสอบว่าโค้ด Apps Script อัปเดตเป็น v2.5 หรือยัง
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
          } else if (parsed.mode === 'gas_bridge_ready' || parsed.version === '2.5-gas-bridge') {
            setGasVerifyResult({
              ok: true,
              message:
                '✅ ลิงก์ Google Apps Script พร้อมใช้งาน 100% (โค้ดเวอร์ชันล่าสุด v2.5 รองรับทั้งขารับ Webhook และขาส่งแจ้งเตือน LINE จากเว็บ GitHub Pages)',
            });
          } else if (parsed.status === 'verified') {
            setGasVerifyResult({
              ok: false,
              message:
                '⚠️ ลิงก์เชื่อมต่อได้ แต่ยังเป็น "โค้ด Apps Script เวอร์ชันเก่า" (จึงทำให้เวลาเปิดเว็บจริงบน GitHub Pages แล้วไม่แจ้งเตือนเข้า LINE) — กรุณากดปุ่ม "คัดลอกโค้ด Apps Script" ด้านล่าง ไปวางทับใน Apps Script แล้วกด Deploy > Manage deployments > แก้ไข (รูปดินสอ) > เลือก Version: New version > กด Deploy',
            });
          } else {
            setGasVerifyResult({
              ok: true,
              message:
                'เชื่อมต่อลิงก์ Google Apps Script สำเร็จ! (หากต้องการให้ส่ง LINE จากเว็บ GitHub Pages ได้ อย่าลืมคัดลอกโค้ดด้านล่างไปอัปเดตเป็น New version)',
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
      {/* Top Executive Summary & Instant LINE Notification Dispatch Banner */}
      <div className="bg-white border border-slate-200 border-t-4 border-t-[#06C755] rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#06C755] uppercase tracking-wider">
              <Sparkles className="h-3.5 w-3.5" />
              <span>LINE OA Smart Notification & Daily Digest</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">
              ระบบแจ้งเตือนและส่งการ์ดสรุปตารางงานเข้า LINE OA
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              แจ้งเตือนเป็นดีไซน์การ์ดสีสันแยกตามหมวดหมู่ พร้อมสรุปยอดงานทั้งหมด งานค้าง และงานที่เสร็จแล้วในทุกการแจ้งเตือน
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
                    {/* Header */}
                    <div className="bg-[#0F172A] p-5 text-white">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#06C755] text-white text-[11px] font-bold">
                          📋 สรุปตารางงานประจำวัน
                        </span>
                        <span className="text-[11px] font-mono-tabular text-slate-400 font-bold">
                          เวลา {lineSettings.dailyDigestTime || '08:00'} น.
                        </span>
                      </div>
                      <div className="text-lg font-bold mt-3 text-white leading-snug">
                        {formatSummaryCardHeaderDate(selectedPreviewDate, previewDigestTasks)}
                      </div>

                      {/* 3-Column Dark Summary Strip */}
                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#1E293B] p-2.5 text-center">
                        <div>
                          <span className="text-xs font-bold text-sky-400 font-mono-tabular">
                            ทั้งหมด {previewDigestTasks.length}
                          </span>
                        </div>
                        <div className="border-x border-slate-700">
                          <span className="text-xs font-bold text-amber-400 font-mono-tabular">
                            รอดำเนินการ{' '}
                            {
                              previewDigestTasks.filter(
                                (t) => t.status !== TaskStatus.COMPLETED
                              ).length
                            }
                          </span>
                        </div>
                        <div>
                          <span className="text-xs font-bold text-emerald-400 font-mono-tabular">
                            เสร็จแล้ว{' '}
                            {
                              previewDigestTasks.filter(
                                (t) => t.status === TaskStatus.COMPLETED
                              ).length
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Body: Chronological Agenda Cards */}
                    <div className="p-4 bg-[#F1F5F9] space-y-3">
                      {previewDigestTasks.length > 0 ? (
                        previewDigestTasks.map((t, idx) => {
                          const cat = categories.find((c) => c.id === t.categoryId);
                          const catColor = cat?.color || '#2563EB';
                          const isDone = t.status === TaskStatus.COMPLETED;
                          const isHigh = t.priority === TaskPriority.HIGH;
                          const cleanDesc = (t.description || '').trim();
                          const showDesc =
                            Boolean(cleanDesc) &&
                            !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                            !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
                            !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');

                          return (
                            <div
                              key={`preview-card-${t.id}-${idx}`}
                              style={{
                                borderLeft: `6px solid ${isDone ? '#CBD5E1' : catColor}`,
                              }}
                              className={`bg-white border rounded-xl p-3 shadow-2xs ${
                                !isDone && isHigh ? 'border-rose-300' : 'border-slate-200'
                              }`}
                            >
                              {/* Top Row */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold font-mono-tabular shrink-0 ${
                                      isDone
                                        ? 'bg-slate-200 text-slate-600'
                                        : 'bg-[#0F172A] text-white'
                                    }`}
                                  >
                                    ⏰ {t.time} น.
                                  </span>
                                  <span
                                    className="text-[11px] font-bold truncate"
                                    style={{
                                      color: isDone ? '#94A3B8' : catColor,
                                    }}
                                  >
                                    • {cat?.name || 'ทั่วไป'}
                                  </span>
                                </div>

                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap shrink-0 ${
                                    isDone
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : isHigh
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {isDone
                                    ? '✓ เสร็จแล้ว'
                                    : isHigh
                                    ? '🔥 ด่วนมาก'
                                    : '⏳ รอถึงเวลา'}
                                </span>
                              </div>

                              {/* Full-width Title */}
                              <div
                                className={`text-sm font-bold mt-2 break-words leading-snug ${
                                  isDone ? 'line-through text-slate-400' : 'text-slate-900'
                                }`}
                              >
                                {idx + 1}. {t.title}
                              </div>

                              {/* Multi-day Continuous Range Badge */}
                              {t.endDate && t.endDate > t.date && (
                                <div className="mt-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-bold">
                                    🗓️ ต่อเนื่อง: {formatTaskDateRangeLabel(t, 'short')}
                                  </span>
                                </div>
                              )}

                              {/* Description */}
                              {showDesc && (
                                <div className="text-xs text-slate-600 mt-1 break-words leading-relaxed">
                                  {cleanDesc}
                                </div>
                              )}

                              {t.assigneeName && (
                                <div className="text-[11px] text-slate-500 mt-1">
                                  👤 ผู้รับผิดชอบ: {t.assigneeName}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 text-center text-xs text-slate-600 font-semibold">
                          🎉 วันนี้ไม่มีรายการงานในตารางของคุณ
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="p-3.5 bg-white border-t border-slate-200 space-y-2">
                      <button
                        type="button"
                        onClick={() => onOpenDateInCalendar(selectedPreviewDate)}
                        className="w-full py-2 px-3 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-center text-xs font-bold transition-colors"
                      >
                        📅 เปิดดูปฏิทินและจัดการงาน
                      </button>
                      <div className="w-full py-2 px-3 rounded-lg bg-slate-100 text-slate-700 text-center text-xs font-semibold">
                        📺 เปิดตารางงานนำเสนอ (รายวัน)
                      </div>
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
                        {/* Priority-Colored Header ("หัวตารางเน้นสีตามความสำคัญของงาน") */}
                        <div
                          style={{ backgroundColor: prioTheme.headerBg }}
                          className="p-5 text-white transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              style={{
                                backgroundColor: prioTheme.badgeBg,
                                color: prioTheme.badgeText,
                              }}
                              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold shadow-2xs"
                            >
                              {prioTheme.badgeLabel}
                            </span>
                            <span
                              style={{ backgroundColor: prioTheme.headerStripBg }}
                              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] text-white font-bold"
                            >
                              🗂️ {activeCat?.name || 'ทั่วไป'}
                            </span>
                          </div>

                          <div className="text-lg font-bold mt-3 text-white leading-snug break-words">
                            {activeTask.title}
                          </div>

                          {/* High-Contrast Date & Time Spotlight Banner inside Header */}
                          <div className="mt-3 rounded-xl bg-white px-3 py-2 shadow-xs flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-mono-tabular font-bold shrink-0">
                              ⏰ {activeTask.time} น.
                            </span>
                            <span
                              style={{ color: prioTheme.badgeText }}
                              className="text-xs font-bold leading-snug"
                            >
                              🗓️ {shortDateRange}
                            </span>
                          </div>
                        </div>

                        {/* Body: Structured Executive Card with 6px Left Priority Stripe */}
                        <div className="p-4 bg-[#F1F5F9] space-y-3">
                          <div
                            style={{ borderLeft: `6px solid ${prioTheme.headerBg}` }}
                            className={`bg-white border rounded-xl p-3.5 shadow-2xs space-y-2.5 text-xs ${
                              prioTheme.priorityKey === 'high'
                                ? 'border-rose-300'
                                : 'border-slate-200'
                            }`}
                          >
                            {/* Prominent Date & Time Hero Box at Top of Body */}
                            <div
                              style={{
                                backgroundColor: prioTheme.badgeBg,
                                borderColor: prioTheme.borderAccent,
                              }}
                              className="rounded-xl border p-3 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  style={{ backgroundColor: prioTheme.headerBg }}
                                  className="inline-flex items-center px-2.5 py-1 rounded-md text-white font-mono-tabular font-bold text-sm shadow-2xs"
                                >
                                  ⏰ เวลา {activeTask.time} น.
                                </span>
                                <span
                                  style={{ color: prioTheme.badgeText }}
                                  className="text-[11px] font-bold"
                                >
                                  กำหนดการนัดหมาย
                                </span>
                              </div>
                              <div className="text-sm font-bold text-slate-900 leading-snug pt-0.5">
                                🗓️ {longDateHeader}
                              </div>
                            </div>

                            <div className="grid grid-cols-12 gap-2 items-baseline pt-0.5">
                              <span className="col-span-4 text-slate-500 font-medium">
                                🗂️ หมวดหมู่
                              </span>
                              <span
                                style={{
                                  color: activeCat?.color || prioTheme.headerBg,
                                }}
                                className="col-span-8 font-bold"
                              >
                                {activeCat?.name || 'ทั่วไป'}
                              </span>
                            </div>
                            <div className="grid grid-cols-12 gap-2 items-baseline">
                              <span className="col-span-4 text-slate-500 font-medium">
                                ⚡ ความสำคัญ
                              </span>
                              <span
                                style={{ color: prioTheme.badgeText }}
                                className="col-span-8 font-bold"
                              >
                                {prioTheme.shortLabel}
                              </span>
                            </div>

                            {showSingleDesc && (
                              <>
                                <div className="border-t border-slate-200 my-2" />
                                <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-2.5">
                                  <div className="text-[11px] font-bold text-slate-600">
                                    📝 รายละเอียดงาน
                                  </div>
                                  <div className="text-xs text-slate-800 mt-1 leading-relaxed break-words">
                                    {cleanSingleDesc}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>

                          {/* 3-Column Dark Daily Overview Strip */}
                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#0F172A] p-2.5 text-center">
                            <div>
                              <span className="text-[11px] font-bold text-sky-400 font-mono-tabular">
                                ทั้งหมด {Math.max(1, sameDayCount.length)}
                              </span>
                            </div>
                            <div className="border-x border-slate-700">
                              <span className="text-[11px] font-bold text-amber-400 font-mono-tabular">
                                รอทำ {sameDayCount.length === 0 ? 1 : sameDayPending}
                              </span>
                            </div>
                            <div>
                              <span className="text-[11px] font-bold text-emerald-400 font-mono-tabular">
                                เสร็จแล้ว {sameDayDone}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="p-3.5 bg-white border-t border-slate-200 space-y-2">
                          <button
                            type="button"
                            onClick={() => onOpenDateInCalendar(activeTask.date)}
                            className="w-full py-2 px-3 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-center text-xs font-bold transition-colors"
                          >
                            📅 เปิดดูปฏิทินของทีม
                          </button>
                          <div className="w-full py-2 px-3 rounded-lg bg-slate-100 text-slate-700 text-center text-xs font-semibold">
                            📊 เปิดตาราง Google Sheets
                          </div>
                        </div>
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
                  พิมพ์สั่งเพิ่มงาน หรือกดดูสรุปงานเพื่อรับการ์ดแจ้งเตือนสีสันสดใสพร้อมสรุปยอดงาน
                </p>
              </div>
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
                          {/* Executive Dark Slate Header */}
                          <div className="bg-[#0F172A] px-5 py-4 text-white">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#06C755] text-white text-[11px] font-bold">
                                {flex.badge && !flex.badge.includes('TIME-SPLIT')
                                  ? flex.badge
                                  : '📋 สรุปตารางงานประจำวัน'}
                              </span>
                              <span className="text-[11px] font-mono-tabular text-slate-400 font-semibold">
                                {flex.time ? `เวลา ${flex.time} น.` : flex.dateTime}
                              </span>
                            </div>
                            <div className="text-base font-bold mt-2.5 text-white">
                              {flex.title &&
                              (flex.title.includes('ทั้งหมด') || flex.title.includes('งานค้าง'))
                                ? flex.title
                                : formatSummaryCardHeaderDate(
                                    flex.date || todayStr,
                                    flex.digestItems || []
                                  )}
                            </div>

                            {/* Compact Dark Summary Strip */}
                            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#1E293B] px-3 py-2.5 text-center">
                              <div>
                                <span className="text-xs font-bold text-sky-400 font-mono-tabular">
                                  ทั้งหมด {flex.stats?.total ?? flex.digestItems?.length ?? 0}
                                </span>
                              </div>
                              <div className="border-x border-slate-700/80">
                                <span className="text-xs font-bold text-amber-400 font-mono-tabular">
                                  รอดำเนินการ {flex.stats?.pending ?? 0}
                                </span>
                              </div>
                              <div>
                                <span className="text-xs font-bold text-emerald-400 font-mono-tabular">
                                  เสร็จแล้ว {flex.stats?.completed ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Chronological Executive Agenda Cards */}
                          <div className="p-4 bg-[#F1F5F9] space-y-2.5">
                            {flex.digestItems && flex.digestItems.length > 0 ? (
                              [...flex.digestItems]
                                .sort((a, b) =>
                                  String(a.time || '09:00').localeCompare(String(b.time || '09:00'))
                                )
                                .map((item, idx) => {
                                  const isDone = item.status === 'completed';
                                  const isHigh = item.priority === 'high';
                                  const isPassed = item.timePhase === 'passed';
                                  const catColor = item.categoryColor || '#2563EB';
                                  const cleanDesc = (item.description || '').trim();
                                  const showDesc =
                                    Boolean(cleanDesc) &&
                                    !cleanDesc.startsWith('เพิ่มผ่านแชท LINE') &&
                                    !cleanDesc.startsWith('บันทึกผ่านแชท LINE') &&
                                    !cleanDesc.startsWith('เพิ่มผ่านหน้าปฏิทิน');

                                  return (
                                    <div
                                      key={`agenda-${item.title}-${idx}`}
                                      style={{
                                        borderLeft: `6px solid ${isDone ? '#CBD5E1' : catColor}`,
                                      }}
                                      className={`bg-white border rounded-xl p-3 shadow-2xs ${
                                        !isDone && isHigh ? 'border-rose-300' : 'border-slate-200'
                                      }`}
                                    >
                                      {/* Row 1: Time Badge + Category + Status Pill */}
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold font-mono-tabular shrink-0 ${
                                              isDone
                                                ? 'bg-slate-200 text-slate-600'
                                                : 'bg-[#0F172A] text-white'
                                            }`}
                                          >
                                            ⏰ {item.time} น.
                                          </span>
                                          <span
                                            className="text-[11px] font-bold truncate"
                                            style={{
                                              color: isDone ? '#94A3B8' : catColor,
                                            }}
                                          >
                                            • {item.categoryName || 'ทั่วไป'}
                                          </span>
                                        </div>

                                        <span
                                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap shrink-0 ${
                                            isDone
                                              ? 'bg-emerald-100 text-emerald-800'
                                              : isHigh
                                              ? 'bg-rose-100 text-rose-700'
                                              : isPassed
                                              ? 'bg-amber-100 text-amber-800'
                                              : 'bg-blue-100 text-blue-800'
                                          }`}
                                        >
                                          {isDone
                                            ? '✓ เสร็จแล้ว'
                                            : isHigh
                                            ? '🔥 ด่วนมาก'
                                            : isPassed
                                            ? '⚠️ เลยเวลา'
                                            : '⏳ รอถึงเวลา'}
                                        </span>
                                      </div>

                                      {/* Row 2: Full-width Task Title */}
                                      <div
                                        className={`text-sm font-bold mt-2 break-words leading-snug ${
                                          isDone ? 'line-through text-slate-400' : 'text-slate-900'
                                        }`}
                                      >
                                        {idx + 1}. {item.title}
                                      </div>

                                      {/* Multi-day Continuous Range Badge */}
                                      {item.endDate && item.date && item.endDate > item.date && (
                                        <div className="mt-1.5">
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-bold">
                                            🗓️ ต่อเนื่อง:{' '}
                                            {formatTaskDateRangeLabel(
                                              { date: item.date, endDate: item.endDate },
                                              'short'
                                            )}
                                          </span>
                                        </div>
                                      )}

                                      {/* Row 3: Task Description (if present) */}
                                      {showDesc && (
                                        <div className="text-xs text-slate-600 mt-1 break-words leading-relaxed">
                                          {cleanDesc}
                                        </div>
                                      )}

                                      {item.assigneeName && (
                                        <div className="text-[11px] text-slate-500 mt-1">
                                          👤 ผู้รับผิดชอบ: {item.assigneeName}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                            ) : (
                              <div className="bg-white border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-600 font-semibold">
                                🎉 วันนี้ไม่มีรายการงานในตารางของคุณ
                              </div>
                            )}
                          </div>

                          {/* Card Footer Action */}
                          <div className="p-3 bg-white border-t border-slate-200 flex flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenDateInCalendar(flex.date || todayStr)}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#06C755] text-white text-xs font-bold hover:bg-[#05b34c] transition-colors"
                            >
                              <CalendarIcon className="h-3.5 w-3.5" />
                              <span>📅 เปิดดูปฏิทินและจัดการงาน</span>
                            </button>
                          </div>
                        </div>
                      ) : flex ? (
                        /* CASE 2: COLORFUL SINGLE TASK NOTIFICATION / SAVED TASK CARD WITH PRIORITY-COLORED HEADER */
                        (() => {
                          const pTheme = getPriorityHeaderTheme(
                            flex.priority,
                            `${flex.priorityLabel || ''} ${flex.badge || ''} ${flex.categoryName || ''}`
                          );
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
                              {/* Priority-Colored Header ("หัวตารางเน้นสีตามความสำคัญของงาน") */}
                              <div
                                style={{ backgroundColor: pTheme.headerBg }}
                                className="px-4 py-3.5 text-white"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    style={{
                                      backgroundColor: pTheme.badgeBg,
                                      color: pTheme.badgeText,
                                    }}
                                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold"
                                  >
                                    {pTheme.badgeLabel}
                                  </span>
                                  <span
                                    style={{ backgroundColor: pTheme.headerStripBg }}
                                    className="px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
                                  >
                                    🗂️ {flex.categoryName}
                                  </span>
                                </div>
                                <div className="text-sm font-bold mt-2 break-words leading-snug">
                                  {flex.title}
                                </div>
                                {/* High-Contrast Date & Time Spotlight Banner */}
                                <div className="mt-2.5 rounded-xl bg-white px-2.5 py-1.5 shadow-2xs flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-mono-tabular font-bold">
                                    ⏰ {flex.time || flex.dateTime}
                                  </span>
                                  <span
                                    style={{ color: pTheme.badgeText }}
                                    className="text-xs font-bold"
                                  >
                                    🗓️ {displayDate}
                                  </span>
                                </div>
                              </div>

                              <div className="p-3.5 space-y-2.5 bg-[#F1F5F9]">
                                {/* Structured Details with Left Priority Accent Stripe */}
                                <div
                                  style={{ borderLeft: `6px solid ${pTheme.headerBg}` }}
                                  className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 text-xs shadow-2xs"
                                >
                                  <div
                                    style={{
                                      backgroundColor: pTheme.badgeBg,
                                      borderColor: pTheme.borderAccent,
                                    }}
                                    className="rounded-lg border p-2.5 space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span
                                        style={{ backgroundColor: pTheme.headerBg }}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md text-white font-mono-tabular font-bold text-xs"
                                      >
                                        ⏰ เวลา {flex.time || flex.dateTime}
                                      </span>
                                      <span
                                        style={{ color: pTheme.badgeText }}
                                        className="text-[10px] font-bold"
                                      >
                                        กำหนดการนัดหมาย
                                      </span>
                                    </div>
                                    <div className="font-bold text-slate-900 text-xs pt-0.5">
                                      🗓️ {displayDate}
                                    </div>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-slate-500 shrink-0">🗂️ หมวดหมู่:</span>
                                    <span
                                      className="font-bold text-right"
                                      style={{ color: flex.categoryColor || pTheme.headerBg }}
                                    >
                                      {flex.categoryName}
                                    </span>
                                  </div>
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-slate-500 shrink-0">⚡ ความสำคัญ:</span>
                                    <span
                                      className="font-bold text-right"
                                      style={{ color: pTheme.badgeText }}
                                    >
                                      {pTheme.shortLabel}
                                    </span>
                                  </div>
                                  {flex.remindLabel && (
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="text-slate-500 shrink-0">
                                        🔔 แจ้งเตือนล่วงหน้า:
                                      </span>
                                      <span className="font-semibold text-emerald-700 text-right">
                                        {flex.remindLabel}
                                      </span>
                                    </div>
                                  )}

                                  {showCleanDesc && (
                                    <>
                                      <div className="border-t border-slate-200 my-1.5" />
                                      <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                                        <span className="font-bold text-slate-900 block mb-0.5">
                                          📝 รายละเอียดงาน:
                                        </span>
                                        {cleanDesc}
                                      </div>
                                    </>
                                  )}
                                </div>

                                {/* Dark Overview Strip + Calendar Action */}
                                <div className="rounded-xl bg-[#0F172A] px-3 py-2 flex items-center justify-between gap-2 text-white">
                                  <div className="text-[11px] font-bold font-mono-tabular">
                                    <span className="text-sky-400">
                                      ทั้งหมด {flex.stats?.total ?? summaryMetrics.total}
                                    </span>{' '}
                                    ·{' '}
                                    <span className="text-amber-400">
                                      รอทำ {flex.stats?.pending ?? summaryMetrics.pendingCount}
                                    </span>{' '}
                                    ·{' '}
                                    <span className="text-emerald-400">
                                      เสร็จแล้ว{' '}
                                      {flex.stats?.completed ?? summaryMetrics.completedCount}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenDateInCalendar(
                                        flex.date || flex.dateTime.slice(0, 10) || todayStr
                                      )
                                    }
                                    className="px-2.5 py-1 rounded-md bg-[#06C755] text-white text-[11px] font-bold hover:bg-[#05b34c] transition-colors whitespace-nowrap shrink-0"
                                  >
                                    📅 ดูในปฏิทิน
                                  </button>
                                </div>
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
                onClick={() => onSendChatCommand('สรุปงานตามเวลา')}
                className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
              >
                ⏰ สรุปงานตามเวลา (ผ่านแล้ว / ยังไม่ถึง)
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
              <button
                type="button"
                onClick={() =>
                  onSendChatCommand('ประชุมวางแผนโปรเจกต์ทีม พรุ่งนี้ 10:30 #สูง')
                }
                className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
              >
                + ตัวอย่างเพิ่มงานใหม่
              </button>
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
                placeholder='พิมพ์ "สรุปงานตามเวลา", "สรุปงานวันนี้", "สรุปงาน 28/10" หรือพิมพ์สั่งเพิ่มงาน...'
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
                    ตั้งค่ารูปแบบและเวลาแจ้งเตือน LINE OA
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ปรับแต่งดีไซน์การ์ดแจ้งเตือน สรุปงานประจำวัน และเวลาเตือนล่วงหน้า
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
                <span className="text-xs font-semibold text-slate-800">เปิดใช้งาน</span>
              </label>
            </div>

            {/* 4 Segmented Settings Sub-Tabs */}
            <div className="mt-4 grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveSettingsTab('format')}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeSettingsTab === 'api'
                    ? 'bg-indigo-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Bell className="h-3.5 w-3.5 shrink-0" />
                <span>LINE Token</span>
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
                        const samplePrioTheme = getPriorityHeaderTheme(
                          samplePreviewTask.priority,
                          sampleCategory?.name
                        );
                        return (
                          <div className="rounded-xl overflow-hidden border border-slate-200 shadow-2xs bg-white">
                            <div
                              style={{
                                backgroundColor: samplePrioTheme.headerBg,
                              }}
                              className="px-4 py-3.5 text-white"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  style={{
                                    backgroundColor: samplePrioTheme.badgeBg,
                                    color: samplePrioTheme.badgeText,
                                  }}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                                >
                                  {samplePrioTheme.badgeLabel}
                                </span>
                                <span
                                  style={{ backgroundColor: samplePrioTheme.headerStripBg }}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                                >
                                  🗂️ {sampleCategory?.name || 'งานบริหาร & โปรเจกต์'}
                                </span>
                              </div>
                              <div
                                className={`mt-2 ${
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
                              <div className="mt-2.5 rounded-xl bg-white px-2.5 py-1.5 shadow-2xs flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-mono-tabular font-bold">
                                  ⏰ {samplePreviewTask.time} น.
                                </span>
                                <span
                                  style={{ color: samplePrioTheme.badgeText }}
                                  className="text-xs font-bold"
                                >
                                  🗓️ {formatTaskDateRangeLabel(samplePreviewTask)}
                                </span>
                              </div>
                            </div>
                            <div
                              className={`p-3.5 space-y-2.5 bg-[#F1F5F9] ${
                                lineSettings.cardFontSize === 'sm'
                                  ? 'text-[11px]'
                                  : lineSettings.cardFontSize === 'lg'
                                  ? 'text-sm'
                                  : 'text-xs'
                              }`}
                            >
                              <div
                                style={{ borderLeft: `6px solid ${samplePrioTheme.headerBg}` }}
                                className="rounded-xl bg-white border border-slate-200 p-3 space-y-2 shadow-2xs"
                              >
                                <div
                                  style={{
                                    backgroundColor: samplePrioTheme.badgeBg,
                                    borderColor: samplePrioTheme.borderAccent,
                                  }}
                                  className="rounded-lg border p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span
                                      style={{ backgroundColor: samplePrioTheme.headerBg }}
                                      className="inline-flex items-center px-2 py-0.5 rounded-md text-white font-mono-tabular font-bold text-xs"
                                    >
                                      ⏰ เวลา {samplePreviewTask.time} น.
                                    </span>
                                    <span
                                      style={{ color: samplePrioTheme.badgeText }}
                                      className="text-[10px] font-bold"
                                    >
                                      กำหนดการนัดหมาย
                                    </span>
                                  </div>
                                  <div className="font-bold text-slate-900 text-xs pt-0.5">
                                    🗓️ {formatTaskDateRangeLabel(samplePreviewTask)}
                                  </div>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">🗂️ หมวดหมู่:</span>
                                  <span
                                    className={
                                      lineSettings.cardTitleWeight === 'regular'
                                        ? 'font-normal'
                                        : 'font-bold'
                                    }
                                    style={{
                                      color: sampleCategory?.color || samplePrioTheme.headerBg,
                                    }}
                                  >
                                    {sampleCategory?.name || 'งานบริหาร & โปรเจกต์'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">⚡ ความสำคัญ:</span>
                                  <span
                                    className={
                                      lineSettings.cardTitleWeight === 'regular'
                                        ? 'font-normal'
                                        : 'font-bold'
                                    }
                                    style={{ color: samplePrioTheme.badgeText }}
                                  >
                                    {samplePrioTheme.shortLabel}
                                  </span>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#0F172A] p-2.5 text-center">
                                <div>
                                  <span className="text-[11px] font-bold text-sky-400 font-mono-tabular">
                                    ทั้งหมด {Math.max(1, summaryMetrics.total)}
                                  </span>
                                </div>
                                <div className="border-x border-slate-700">
                                  <span className="text-[11px] font-bold text-amber-400 font-mono-tabular">
                                    รอทำ {summaryMetrics.total === 0 ? 1 : summaryMetrics.pendingCount}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] font-bold text-emerald-400 font-mono-tabular">
                                    เสร็จแล้ว {summaryMetrics.completedCount}
                                  </span>
                                </div>
                              </div>

                              {lineSettings.includeOpenAppButton !== false && (
                                <div className="pt-1">
                                  <div className="w-full py-2 px-3 rounded-lg bg-[#06C755] text-white text-center text-xs font-bold">
                                    📅 เปิดดูปฏิทินของทีม
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
                        title: '2. ห้องแชทกลุ่ม (C...)',
                        desc: 'ส่งรวมในกลุ่ม LINE ของทีม',
                      },
                      {
                        id: 'both' as const,
                        title: 'ส่งทั้ง 2 รูปแบบ',
                        desc: 'เข้ากลุ่ม LINE + แชทส่วนตัว',
                      },
                    ].map((opt) => {
                      const currentMode = lineSettings.teamNotificationMode || 'both';
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
              <div className="text-xs font-medium text-slate-700">
                ลิงก์ Web App URL ของคุณ
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
                  {isTestingGas ? 'กำลังตรวจสอบ...' : 'ตรวจสอบลิงก์'}
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
                  className={`p-2 rounded-md text-xs ${
                    gasVerifyResult.ok
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border border-red-200 text-red-800'
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
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
              >
                {copiedScript ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-300" />
                    <span>คัดลอกโค้ดแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>คัดลอกโค้ด Apps Script (รองรับการ์ดสรุปงาน)</span>
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
