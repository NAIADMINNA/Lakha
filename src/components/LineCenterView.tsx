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
  doesTaskTriggerNotification,
  formatLocalDateYMD,
  formatRemindMinutesLabel,
  generateGoogleAppsScriptCode,
  renderCustomLineMessage,
} from '../services/lineCommandParser';

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
  const [gasUrl, setGasUrl] = useState(
    'https://script.google.com/macros/s/AKfycby5KO2cApLJ3p5DvbVnoa446OmmOqJ2yLsJMpUu3OobHzRieCUs_jmW1BFGQCzpYQQorQ/exec'
  );
  const [isTestingGas, setIsTestingGas] = useState(false);
  const [gasVerifyResult, setGasVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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

  const appsScriptCode = generateGoogleAppsScriptCode(
    spreadsheetId,
    lineSettings.channelAccessToken,
    window.location.origin
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
    if (!gasUrl.trim()) return;
    setIsTestingGas(true);
    setGasVerifyResult(null);
    try {
      const sampleText = withSampleTask
        ? `ทดสอบส่งงานจาก LINE วันนี้ 15:30 #สูง`
        : undefined;
      const res = await fetch('/api/line/test-gas-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptUrl: gasUrl.trim(),
          testText: sampleText,
        }),
      });
      const data = await res.json();
      setGasVerifyResult({
        ok: Boolean(data.ok),
        message: data.message || 'ตรวจสอบเสร็จสิ้น',
      });
      if (withSampleTask && data.ok && onPullFromSheets) {
        await onPullFromSheets();
      }
    } catch {
      setGasVerifyResult({
        ok: false,
        message: 'เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อทดสอบลิงก์ Apps Script',
      });
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
              onClick={onTestPushNotification}
              disabled={isSendingPush}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-2xs transition-colors whitespace-nowrap"
            >
              <BarChart3 className="h-4 w-4" />
              <span>
                {isSendingPush ? 'กำลังส่งสรุปงาน...' : '📊 ส่งการ์ดสรุปงานเข้า LINE ทันที'}
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
          </div>
        </div>

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
                        <div className="rounded-2xl overflow-hidden border border-indigo-200 bg-white shadow-sm">
                          {/* Vibrant Summary Header */}
                          <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-emerald-800 px-4 py-3.5 text-white">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#06C755] text-white text-[10px] font-bold tracking-wider uppercase">
                                {flex.badge || 'SHEETCAL DAILY SUMMARY'}
                              </span>
                              <span className="text-[11px] font-mono-tabular text-indigo-200 font-semibold">
                                {flex.dateTime}
                              </span>
                            </div>
                            <div className="text-base font-bold mt-2">{flex.title}</div>
                            <div className="text-xs text-emerald-200 mt-0.5">
                              {flex.subtitle}
                            </div>

                            {/* Progress Bar */}
                            {flex.stats && (
                              <div className="mt-3">
                                <div className="h-1.5 w-full rounded-full bg-indigo-950/60 overflow-hidden">
                                  <div
                                    className="h-full bg-[#06C755] rounded-full transition-all"
                                    style={{
                                      width: `${
                                        flex.stats.total > 0
                                          ? Math.max(
                                              8,
                                              Math.round(
                                                (flex.stats.completed / flex.stats.total) * 100
                                              )
                                            )
                                          : 100
                                      }%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 3 Colorful KPI Boxes */}
                          <div className="p-4 bg-slate-50/70 space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-2.5 text-center">
                                <div className="text-lg font-bold text-indigo-700 font-mono-tabular">
                                  {flex.stats?.total ?? flex.digestItems?.length ?? 0}
                                </div>
                                <div className="text-[11px] font-semibold text-indigo-800">
                                  งานทั้งหมด
                                </div>
                              </div>
                              <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-center">
                                <div className="text-lg font-bold text-amber-600 font-mono-tabular">
                                  {flex.stats?.pending ?? 0}
                                </div>
                                <div className="text-[11px] font-semibold text-amber-800">
                                  รอดำเนินการ
                                </div>
                              </div>
                              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-center">
                                <div className="text-lg font-bold text-emerald-600 font-mono-tabular">
                                  {flex.stats?.completed ?? 0}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-800">
                                  เสร็จแล้ว
                                </div>
                              </div>
                            </div>

                            {/* Task Timeline List */}
                            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pt-1">
                              รายการงานในตาราง ({flex.digestItems?.length || 0} รายการ)
                            </div>

                            {flex.digestItems && flex.digestItems.length > 0 ? (
                              <div className="space-y-2">
                                {flex.digestItems.map((item, idx) => {
                                  const isDone = item.status === 'completed';
                                  const isHigh = item.priority === 'high';
                                  return (
                                    <div
                                      key={`${item.title}-${idx}`}
                                      style={{
                                        borderLeft: `4px solid ${
                                          isDone ? '#10B981' : item.categoryColor || '#2563EB'
                                        }`,
                                      }}
                                      className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-start justify-between gap-2.5 shadow-2xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular">
                                          <span className="font-bold text-indigo-700">
                                            {item.time} น.
                                          </span>
                                          {item.date && item.date !== todayStr && (
                                            <span className="text-slate-500">({item.date})</span>
                                          )}
                                          <span
                                            className="font-semibold"
                                            style={{ color: item.categoryColor || '#2563EB' }}
                                          >
                                            · {item.categoryName}
                                          </span>
                                        </div>
                                        <div
                                          className={`text-xs font-semibold mt-0.5 break-words ${
                                            isDone
                                              ? 'line-through text-slate-400'
                                              : 'text-slate-900'
                                          }`}
                                        >
                                          {item.title}
                                        </div>
                                      </div>

                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shrink-0 ${
                                          isDone
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : isHigh
                                            ? 'bg-rose-100 text-rose-700'
                                            : 'bg-amber-100 text-amber-800'
                                        }`}
                                      >
                                        {isDone
                                          ? '✓ เสร็จแล้ว'
                                          : isHigh
                                          ? '🔥 ด่วนมาก'
                                          : '⏳ รอทำ'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="bg-white border border-slate-200 rounded-lg p-3 text-center text-xs text-slate-600 font-medium">
                                🎉 ไม่มีรายการงานค้างในตาราง
                              </div>
                            )}
                          </div>

                          {/* Card Footer Action */}
                          <div className="px-4 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between">
                            <span className="text-[11px] text-slate-500">
                              ซิงค์อัตโนมัติกับปฏิทินทีม & Google Sheets
                            </span>
                            <button
                              type="button"
                              onClick={() => onOpenDateInCalendar(flex.date || todayStr)}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
                            >
                              <CalendarIcon className="h-3 w-3" />
                              <span>เปิดดูปฏิทิน</span>
                            </button>
                          </div>
                        </div>
                      ) : flex ? (
                        /* CASE 2: COLORFUL SINGLE TASK NOTIFICATION / SAVED TASK CARD WITH EMBEDDED TASK SUMMARY */
                        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                          <div
                            style={{
                              backgroundColor: flex.categoryColor || '#2563EB',
                            }}
                            className="px-4 py-3 text-white"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-black/25 text-white text-[10px] font-bold tracking-wider uppercase">
                                {flex.badge}
                              </span>
                              <span className="text-xs font-mono-tabular font-bold">
                                {flex.dateTime}
                              </span>
                            </div>
                            <div className="text-sm font-bold mt-1.5 break-words">
                              {flex.title}
                            </div>
                          </div>

                          <div className="p-3.5 space-y-2.5 bg-white">
                            {/* Structured Details */}
                            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">🗂️ หมวดหมู่:</span>
                                <span
                                  className="font-bold"
                                  style={{ color: flex.categoryColor || '#2563EB' }}
                                >
                                  {flex.categoryName}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500">⚡ ความสำคัญ / เวลา:</span>
                                <span className="font-semibold text-slate-900">
                                  {flex.priorityLabel}
                                </span>
                              </div>
                              {flex.remindLabel && (
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-500">🔔 แจ้งเตือนล่วงหน้า:</span>
                                  <span className="font-semibold text-emerald-700">
                                    {flex.remindLabel}
                                  </span>
                                </div>
                              )}
                            </div>

                            {flex.subtitle && (
                              <div className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                                {flex.subtitle}
                              </div>
                            )}

                            {/* Embedded Summary Box Inside Every Notification */}
                            <div className="rounded-lg bg-indigo-50/80 border border-indigo-200 px-3 py-2 flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[10px] font-bold text-indigo-700 uppercase">
                                  📊 สรุปภาพรวมตารางงาน
                                </div>
                                <div className="text-xs font-semibold text-indigo-950 mt-0.5">
                                  ทั้งหมด {flex.stats?.total ?? summaryMetrics.total} งาน · รอทำ{' '}
                                  <span className="text-amber-700">
                                    {flex.stats?.pending ?? summaryMetrics.pendingCount}
                                  </span>{' '}
                                  · เสร็จแล้ว{' '}
                                  <span className="text-emerald-700">
                                    {flex.stats?.completed ?? summaryMetrics.completedCount}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenDateInCalendar(
                                    flex.date || flex.dateTime.slice(0, 10) || todayStr
                                  )
                                }
                                className="px-2.5 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                              >
                                ดูในปฏิทิน
                              </button>
                            </div>
                          </div>
                        </div>
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
                className="px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
              >
                📊 สรุปงานวันนี้
              </button>
              <button
                type="button"
                onClick={() => onSendChatCommand('งานค้าง')}
                className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
              >
                ⏳ ดูสรุปงานค้างทั้งหมด
              </button>
              <button
                type="button"
                onClick={() =>
                  onSendChatCommand('ประชุมวางแผนโปรเจกต์ทีม พรุ่งนี้ 10:30 #สูง')
                }
                className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
              >
                + ตัวอย่างสั่งเพิ่มงานใหม่
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
                placeholder='พิมพ์ชื่องาน หรือพิมพ์ "สรุปงานวันนี้" / "งานค้าง"...'
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
                          วันที่ {t.date} · เวลา {t.time} น. · เตือนล่วงหน้า{' '}
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
                    /* Colorful Flex Card Live Preview */
                    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-2xs bg-white">
                      <div
                        style={{
                          backgroundColor: sampleCategory?.color || '#2563EB',
                        }}
                        className="px-4 py-3 text-white"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded bg-black/25 text-[10px] font-bold uppercase">
                            🔥 HIGH PRIORITY REMINDER
                          </span>
                          <span className="text-xs font-mono-tabular font-bold">
                            {samplePreviewTask.time} น.
                          </span>
                        </div>
                        <div className="text-sm font-bold mt-1.5">
                          {samplePreviewTask.title}
                        </div>
                      </div>
                      <div className="p-3.5 space-y-2.5 text-xs">
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-slate-500">🗓️ วันที่:</span>
                            <span className="font-bold text-slate-900">
                              {samplePreviewTask.date} เวลา {samplePreviewTask.time} น.
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">🗂️ หมวดหมู่:</span>
                            <span
                              className="font-bold"
                              style={{ color: sampleCategory?.color || '#2563EB' }}
                            >
                              {sampleCategory?.name || 'งานบริหาร & โปรเจกต์'}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2.5">
                          <div className="text-[10px] font-bold text-indigo-700 uppercase">
                            📊 สรุปภาพรวมตารางงานประจำวัน
                          </div>
                          <div className="text-xs font-bold text-indigo-950 mt-0.5">
                            ทั้งหมด {summaryMetrics.total} งาน · รอทำ{' '}
                            <span className="text-amber-700">
                              {summaryMetrics.pendingCount} งาน
                            </span>{' '}
                            · เสร็จแล้ว{' '}
                            <span className="text-emerald-700">
                              {summaryMetrics.completedCount} งาน
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    LINE Channel Access Token
                  </label>
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

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    LINE User ID (ไม่บังคับ)
                  </label>
                  <input
                    type="text"
                    value={lineSettings.targetUserId}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...lineSettings,
                        targetUserId: e.target.value,
                      })
                    }
                    placeholder="เว้นว่างไว้เพื่อส่งแบบ Broadcast"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
                  />
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
