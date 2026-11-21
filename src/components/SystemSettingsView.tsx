import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Database,
  Download,
  MessageSquareText,
  RotateCcw,
  Save,
  Send,
  Settings,
  Tv,
  Upload,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  Category,
  LineMessageLog,
  LineSettings,
  OrganizationSettings,
  Task,
} from '../types';
import { SheetMetadata } from '../services/sheetsService';
import { SheetAutoSyncConfig, SheetsDatabaseView } from './SheetsDatabaseView';
import { LineCenterView } from './LineCenterView';
import {
  DEFAULT_ORG_SETTINGS,
  buildDefaultTelegramHeader,
  formatOrgSubtitle,
  normalizeOrgSettings,
} from '../services/orgSettings';
import { isTelegramConfigured } from '../services/telegramService';
import { ROBOT_MASCOT_DATA_URI } from '../assets/robotMascotDataUri';

export type SystemSettingsSubTab = 'organization' | 'line' | 'telegram' | 'database';

interface SystemSettingsViewProps {
  activeSubTab: SystemSettingsSubTab;
  onChangeSubTab: (tab: SystemSettingsSubTab) => void;
  orgSettings: OrganizationSettings;
  onSaveOrgSettings: (
    nextOrg: OrganizationSettings,
    syncTelegramHeader: boolean
  ) => Promise<void> | void;
  onImportBundleSettings?: (payload: {
    orgSettings?: Partial<OrganizationSettings>;
    lineSettings?: Partial<LineSettings>;
    spreadsheetId?: string;
    gasUrl?: string;
  }) => Promise<void> | void;
  // LINE & Telegram props
  logs: LineMessageLog[];
  categories: Category[];
  tasks: Task[];
  lineSettings: LineSettings;
  onUpdateLineSettings: (newSettings: LineSettings) => void;
  onSendChatCommand: (text: string) => void;
  onTestPushNotification: () => Promise<void>;
  onTestSingleTaskNotification?: (sampleTask: Task) => Promise<void>;
  onOpenDateInCalendar: (dateStr: string) => void;
  isSendingPush: boolean;
  // Google Sheets Database props
  user: User | null;
  accessToken: string | null;
  isLoggingIn: boolean;
  isSyncing: boolean;
  sheetMeta: SheetMetadata | null;
  spreadsheetInput: string;
  onChangeSpreadsheetInput: (val: string) => void;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onCreateNewSpreadsheet: (title: string) => Promise<void>;
  onConnectExistingSpreadsheet: (spreadsheetId: string) => Promise<void>;
  onPushToSheets: () => void;
  onPullFromSheets: () => Promise<void>;
  autoSyncConfig: SheetAutoSyncConfig;
  onUpdateAutoSyncConfig: (next: SheetAutoSyncConfig) => void;
  lastSyncedAt: string | null;
  onSaveAndSyncNow: (sheetIdOrUrl: string, gasUrl?: string) => Promise<void>;
}

const SUB_TABS: {
  id: SystemSettingsSubTab;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'organization',
    label: 'ชื่อหน่วยงาน & ระบบ',
    shortLabel: 'หน่วยงาน',
    description: 'ชื่อสำนัก กรม หัวข้อตาราง และส่งต่อระบบ',
    icon: Building2,
  },
  {
    id: 'line',
    label: 'ตั้งค่า LINE OA',
    shortLabel: 'LINE OA',
    description: 'Token, กลุ่ม LINE, รูปแบบการ์ด และเวลาแจ้งเตือน',
    icon: MessageSquareText,
  },
  {
    id: 'telegram',
    label: 'ตั้งค่า Telegram',
    shortLabel: 'Telegram',
    description: 'Bot Token, Chat ID, การ์ดภาพ และแจ้งเตือน 24 ชม.',
    icon: Send,
  },
  {
    id: 'database',
    label: 'ฐานข้อมูล Google Sheets',
    shortLabel: 'Google Sheets',
    description: 'รหัสชีต, Apps Script URL และการซิงค์ 2 ทาง',
    icon: Database,
  },
];

export const SystemSettingsView: React.FC<SystemSettingsViewProps> = ({
  activeSubTab,
  onChangeSubTab,
  orgSettings,
  onSaveOrgSettings,
  onImportBundleSettings,
  logs,
  categories,
  tasks,
  lineSettings,
  onUpdateLineSettings,
  onSendChatCommand,
  onTestPushNotification,
  onTestSingleTaskNotification,
  onOpenDateInCalendar,
  isSendingPush,
  user,
  accessToken,
  isLoggingIn,
  isSyncing,
  sheetMeta,
  spreadsheetInput,
  onChangeSpreadsheetInput,
  onLogin,
  onLogout,
  onCreateNewSpreadsheet,
  onConnectExistingSpreadsheet,
  onPushToSheets,
  onPullFromSheets,
  autoSyncConfig,
  onUpdateAutoSyncConfig,
  lastSyncedAt,
  onSaveAndSyncNow,
}) => {
  const [draftOrg, setDraftOrg] = useState<OrganizationSettings>(orgSettings);
  const [syncTelegramHeader, setSyncTelegramHeader] = useState(true);
  const [isSavingOrg, setIsSavingOrg] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [includeSecretsInExport, setIncludeSecretsInExport] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftOrg(orgSettings);
  }, [orgSettings]);

  const isLineReady = Boolean(lineSettings.channelAccessToken?.trim());
  const isTelegramReady = isTelegramConfigured(lineSettings);
  const isSheetReady = Boolean(sheetMeta?.spreadsheetId || spreadsheetInput.trim());

  const handleSaveOrgSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingOrg(true);
    setSavedBanner(false);
    try {
      const normalized = normalizeOrgSettings({
        ...draftOrg,
        updatedAt: new Date().toISOString(),
      });
      await onSaveOrgSettings(normalized, syncTelegramHeader);
      setSavedBanner(true);
      window.setTimeout(() => setSavedBanner(false), 3500);
    } finally {
      setIsSavingOrg(false);
    }
  };

  const handleResetOrgDefaults = () => {
    setDraftOrg({
      ...DEFAULT_ORG_SETTINGS,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleExportSettingsJson = () => {
    let savedGasUrl = '';
    try {
      savedGasUrl =
        localStorage.getItem('sheetcal_gas_url_v1') ||
        localStorage.getItem('sheetcal_gas_webapp_url_v1') ||
        '';
    } catch {
      // Ignore
    }

    const sanitizedLine: Partial<LineSettings> = {
      enabled: lineSettings.enabled,
      defaultRemindMinutes: lineSettings.defaultRemindMinutes,
      reminderTimings: lineSettings.reminderTimings,
      notifyOnOverdue: lineSettings.notifyOnOverdue,
      dailyDigestEnabled: lineSettings.dailyDigestEnabled,
      dailyDigestTime: lineSettings.dailyDigestTime,
      messageFormat: lineSettings.messageFormat,
      customMessageTemplate: lineSettings.customMessageTemplate,
      includeDescriptionInNotification: lineSettings.includeDescriptionInNotification,
      includeGoogleCalendarButton: lineSettings.includeGoogleCalendarButton,
      includeOpenAppButton: lineSettings.includeOpenAppButton,
      teamNotificationMode: lineSettings.teamNotificationMode,
      telegramEnabled: lineSettings.telegramEnabled,
      telegramDeliveryMode: lineSettings.telegramDeliveryMode,
      telegramStyle: lineSettings.telegramStyle,
      telegramHeaderTitle: lineSettings.telegramHeaderTitle,
      telegramShowStats: lineSettings.telegramShowStats,
      telegramShowButtons: lineSettings.telegramShowButtons,
      ...(includeSecretsInExport
        ? {
            channelAccessToken: lineSettings.channelAccessToken,
            targetUserId: lineSettings.targetUserId,
            targetGroupId: lineSettings.targetGroupId,
            telegramBotToken: lineSettings.telegramBotToken,
            telegramChatId: lineSettings.telegramChatId,
          }
        : {}),
    };

    const bundle = {
      exportedAt: new Date().toISOString(),
      orgSettings: normalizeOrgSettings(draftOrg),
      lineSettings: sanitizedLine,
      spreadsheetId: includeSecretsInExport
        ? sheetMeta?.spreadsheetId || spreadsheetInput.trim()
        : '',
      gasUrl: includeSecretsInExport ? savedGasUrl : '',
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeSlug = (draftOrg.agencyName || 'organization')
      .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, '_')
      .slice(0, 32);
    a.download = `settings-${safeSlug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportFeedback(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        orgSettings?: Partial<OrganizationSettings>;
        lineSettings?: Partial<LineSettings>;
        spreadsheetId?: string;
        gasUrl?: string;
      };
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('โครงสร้างไฟล์ตั้งค่าไม่ถูกต้อง');
      }
      if (parsed.orgSettings) {
        setDraftOrg(normalizeOrgSettings(parsed.orgSettings));
      }
      if (onImportBundleSettings) {
        await onImportBundleSettings(parsed);
      }
      setImportFeedback({
        type: 'success',
        text: 'นำเข้าไฟล์ตั้งค่าระบบเรียบร้อยแล้ว และซิงค์ข้อมูลไปยังหน้าจอทั้งหมดแล้ว',
      });
    } catch (err) {
      setImportFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? `ไม่สามารถนำเข้าไฟล์ได้: ${err.message}`
            : 'ไม่สามารถอ่านไฟล์ JSON ได้ กรุณาตรวจสอบไฟล์อีกครั้ง',
      });
    }
  };

  const previewOrg = normalizeOrgSettings(draftOrg);
  const previewSubtitle = formatOrgSubtitle(previewOrg);
  const previewTelegramHeader = buildDefaultTelegramHeader(previewOrg);

  return (
    <div className="space-y-5">
      {/* Top Unified Settings Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-200/80 text-indigo-700 flex items-center justify-center shrink-0">
              <Settings className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                ศูนย์ตั้งค่าระบบครบวงจร
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5 leading-relaxed">
                รวมการตั้งค่าชื่อหน่วยงาน (สำนัก / กรม), LINE OA, Telegram และฐานข้อมูล Google Sheets ไว้ในเมนูเดียว เพื่อปรับแต่งหรือส่งต่อระบบให้หน่วยงานอื่นได้ทันที
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 shrink-0">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
              <span>หน่วยงาน:</span>
              <strong className="text-indigo-700 max-w-[180px] truncate">
                {orgSettings.agencyName}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <span>LINE:</span>
              <span className={isLineReady ? 'text-emerald-700' : 'text-amber-700'}>
                {isLineReady ? 'พร้อมใช้งาน' : 'ยังไม่ตั้งค่า'}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <span>Telegram:</span>
              <span className={isTelegramReady ? 'text-emerald-700' : 'text-amber-700'}>
                {isTelegramReady ? 'พร้อมใช้งาน' : 'ยังไม่ตั้งค่า'}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <span>Sheets:</span>
              <span className={isSheetReady ? 'text-emerald-700' : 'text-amber-700'}>
                {isSheetReady ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
              </span>
            </span>
          </div>
        </div>

        {/* Horizontal Sub-Tab Bar (Visible on Mobile & Desktop for instant 1-click switching) */}
        <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 lg:grid-cols-4 gap-2">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeSubTab(tab.id)}
                className={`text-left px-3.5 py-2.5 rounded-xl border transition-all flex items-start gap-2.5 ${
                  isActive
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-slate-50/70 text-slate-700 border-slate-200/80 hover:bg-white hover:border-indigo-300'
                }`}
              >
                <Icon
                  className={`h-4 w-4 mt-0.5 shrink-0 ${
                    isActive ? 'text-white' : 'text-indigo-600'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-bold whitespace-nowrap truncate">
                    {tab.label}
                  </div>
                  <div
                    className={`text-[11px] leading-snug mt-0.5 hidden sm:block truncate ${
                      isActive ? 'text-indigo-100' : 'text-slate-500'
                    }`}
                  >
                    {tab.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 1: Organization & App Branding Settings */}
      {activeSubTab === 'organization' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Organization Branding Form */}
          <form
            onSubmit={handleSaveOrgSubmit}
            className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  ข้อมูลหน่วยงานและชื่อระบบ
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  เปลี่ยนชื่อสำนัก กรม หรือชื่อระบบที่นี่ ระบบจะอัปเดตให้ทุกหน้าและจอ TV อัตโนมัติ
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetOrgDefaults}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>คืนค่าเริ่มต้น</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  ชื่อหน่วยงาน / สำนัก / กอง <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={draftOrg.agencyName}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({ ...prev, agencyName: e.target.value }))
                  }
                  placeholder="เช่น สำนักบริหารแรงงานต่างด้าว"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  ชื่อกรม / กระทรวง / ต้นสังกัด
                </label>
                <input
                  type="text"
                  value={draftOrg.departmentName}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({ ...prev, departmentName: e.target.value }))
                  }
                  placeholder="เช่น กรมการจัดหางาน (เว้นว่างได้)"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  หัวข้อหลักหน้าตารางภารกิจและจอ TV <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={draftOrg.boardTitle}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({ ...prev, boardTitle: e.target.value }))
                  }
                  placeholder="เช่น กำหนดการภารกิจของผู้อำนวยการ"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  ตำแหน่งผู้บริหาร (บนแถบสถานะ TV)
                </label>
                <input
                  type="text"
                  value={draftOrg.directorLabel}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({ ...prev, directorLabel: e.target.value }))
                  }
                  placeholder="เช่น ผู้อำนวยการ, ผู้บริหาร, หัวหน้าฝ่าย"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  ชื่อระบบ / แอปพลิเคชัน
                </label>
                <input
                  type="text"
                  value={draftOrg.appName}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({ ...prev, appName: e.target.value }))
                  }
                  placeholder="เช่น ระบบน้องเลขา"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  คำอธิบายท้ายหน้าเว็บ (Footer)
                </label>
                <input
                  type="text"
                  value={draftOrg.footerDescription}
                  onChange={(e) =>
                    setDraftOrg((prev) => ({
                      ...prev,
                      footerDescription: e.target.value,
                    }))
                  }
                  placeholder="ระบบปฏิทินตารางงานร่วมกันของทีม แจ้งเตือนผ่าน LINE OA, Telegram และ Google Sheets"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600 transition-colors"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncTelegramHeader}
                onChange={(e) => setSyncTelegramHeader(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                อัปเดตหัวข้อการ์ดแจ้งเตือน Telegram ให้ตรงกับชื่อหน่วยงานอัตโนมัติ (
                <strong className="text-slate-900">{previewTelegramHeader}</strong>)
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
              <button
                type="submit"
                disabled={isSavingOrg}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <Save className="h-4 w-4" />
                <span>
                  {isSavingOrg ? 'กำลังบันทึกและซิงค์...' : 'บันทึกชื่อหน่วยงานและซิงค์จอ TV'}
                </span>
              </button>

              {savedBanner && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>บันทึกและส่งอัปเดตไปยังหน้าจอทั้งหมดแล้ว</span>
                </span>
              )}
            </div>
          </form>

          {/* Right: Live Preview + Quick Handoff Checklist & Export/Import */}
          <div className="lg:col-span-5 space-y-5">
            {/* Live TV & Dashboard Header Preview */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  ตัวอย่างการแสดงผลจริง (Live Preview)
                </h3>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                  <Tv className="h-3.5 w-3.5 text-indigo-600" />
                  <span>หัวหน้าจอ TV</span>
                </span>
              </div>

              <div className="rounded-xl bg-[#0B172A] border border-amber-400/35 p-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full p-0.5 bg-white/10 ring-1 ring-amber-300/40 shrink-0 overflow-hidden">
                    <img
                      src={ROBOT_MASCOT_DATA_URI}
                      alt="ตราสัญลักษณ์"
                      className="h-full w-full object-cover rounded-full"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm sm:text-base font-extrabold text-white truncate">
                      {previewOrg.boardTitle}
                    </div>
                    <div className="text-xs font-semibold text-amber-300 truncate mt-0.5">
                      {previewSubtitle}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-white/10 text-[11px] text-slate-300 flex items-center justify-between gap-2">
                  <span>
                    สถานะ{previewOrg.directorLabel}:{' '}
                    <strong className="text-emerald-300">ปฏิบัติราชการ ณ ห้องทำงาน</strong>
                  </span>
                  <span className="text-slate-400 truncate">{previewOrg.appName}</span>
                </div>
              </div>
            </div>

            {/* Handoff Setup Checklist */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  เช็กลิสต์ตั้งค่าเมื่อส่งต่อระบบให้หน่วยงานอื่น
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  กดไปที่แต่ละหัวข้อเพื่อกรอกข้อมูลของหน่วยงานใหม่ได้ครบจบในเมนูนี้
                </p>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">1. ชื่อหน่วยงานและชื่อระบบ</div>
                    <div className="text-slate-500 truncate">{previewSubtitle}</div>
                  </div>
                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700 whitespace-nowrap shrink-0">
                    <Check className="h-3.5 w-3.5" />
                    <span>ตั้งค่าแล้ว</span>
                  </span>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">2. การแจ้งเตือน LINE OA</div>
                    <div className="text-slate-500 truncate">
                      {isLineReady
                        ? 'เชื่อมต่อ Channel Access Token แล้ว'
                        : 'ยังไม่ได้ใส่ Token LINE OA'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChangeSubTab('line')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-bold text-indigo-700 hover:bg-indigo-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    ตั้งค่า LINE
                  </button>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">3. การแจ้งเตือน Telegram</div>
                    <div className="text-slate-500 truncate">
                      {isTelegramReady
                        ? 'เชื่อมต่อ Bot Token & Chat ID แล้ว'
                        : 'ยังไม่ได้ใส่ Bot Token / Chat ID'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChangeSubTab('telegram')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-bold text-sky-700 hover:bg-sky-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    ตั้งค่า Telegram
                  </button>
                </div>

                <div className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900">4. ฐานข้อมูล Google Sheets</div>
                    <div className="text-slate-500 truncate">
                      {isSheetReady
                        ? sheetMeta?.title || 'เชื่อมต่อ Spreadsheet แล้ว'
                        : 'ยังไม่ได้ผูก Google Sheets'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChangeSubTab('database')}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-bold text-violet-700 hover:bg-violet-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    ตั้งค่า Sheets
                  </button>
                </div>
              </div>
            </div>

            {/* Export / Import Configuration JSON for Easy Handoff */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  ส่งออก / นำเข้าไฟล์ตั้งค่าระบบ (JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  สำรองค่าการตั้งค่าหรือคัดลอกไปติดตั้งให้เครื่อง/หน่วยงานอื่นได้ในคลิกเดียว
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSecretsInExport}
                  onChange={(e) => setIncludeSecretsInExport(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>รวม Token, Chat ID และรหัส Google Sheets ในไฟล์ส่งออก (ใช้เฉพาะภายใน)</span>
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportSettingsJson}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 text-indigo-600" />
                  <span>ส่งออกไฟล์ตั้งค่า (.json)</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 text-xs font-bold text-indigo-800 hover:bg-indigo-100/80 transition-colors whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5 text-indigo-700" />
                  <span>นำเข้าไฟล์ตั้งค่า (.json)</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFileChange}
                  className="hidden"
                />
              </div>

              {importFeedback && (
                <p
                  className={`text-xs font-semibold ${
                    importFeedback.type === 'success' ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {importFeedback.text}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2 & Tab 3: LINE OA & Telegram Settings */}
      {(activeSubTab === 'line' || activeSubTab === 'telegram') && (
        <LineCenterView
          logs={logs}
          categories={categories}
          tasks={tasks}
          lineSettings={lineSettings}
          orgSettings={orgSettings}
          initialSettingsTab={activeSubTab === 'telegram' ? 'telegram' : 'format'}
          spreadsheetId={sheetMeta?.spreadsheetId || ''}
          spreadsheetUrl={sheetMeta?.spreadsheetUrl}
          onUpdateSettings={onUpdateLineSettings}
          onSendChatCommand={onSendChatCommand}
          onTestPushNotification={onTestPushNotification}
          onTestSingleTaskNotification={onTestSingleTaskNotification}
          onOpenDateInCalendar={onOpenDateInCalendar}
          onPullFromSheets={onPullFromSheets}
          onCreateSpreadsheet={() =>
            onCreateNewSpreadsheet(`${orgSettings.appName} — ฐานข้อมูลตารางงานและแจ้งเตือน`)
          }
          isSendingPush={isSendingPush}
          isSyncing={isSyncing}
        />
      )}

      {/* Tab 4: Google Sheets Database Settings */}
      {activeSubTab === 'database' && (
        <SheetsDatabaseView
          user={user}
          accessToken={accessToken}
          isLoggingIn={isLoggingIn}
          isSyncing={isSyncing}
          sheetMeta={sheetMeta}
          spreadsheetInput={spreadsheetInput}
          onChangeSpreadsheetInput={onChangeSpreadsheetInput}
          onLogin={onLogin}
          onLogout={onLogout}
          onCreateNewSpreadsheet={onCreateNewSpreadsheet}
          onConnectExistingSpreadsheet={onConnectExistingSpreadsheet}
          onPushToSheets={onPushToSheets}
          onPullFromSheets={onPullFromSheets}
          tasks={tasks}
          categories={categories}
          logs={logs}
          autoSyncConfig={autoSyncConfig}
          onUpdateAutoSyncConfig={onUpdateAutoSyncConfig}
          lastSyncedAt={lastSyncedAt}
          onSaveAndSyncNow={onSaveAndSyncNow}
        />
      )}
    </div>
  );
};
