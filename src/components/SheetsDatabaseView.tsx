import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LogOut,
  PlusCircle,
  RefreshCw,
  Settings2,
  Upload,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { Category, LineMessageLog, Task } from '../types';
import { SheetMetadata, extractSpreadsheetId } from '../services/sheetsService';
import { formatTaskDateRangeLabel } from '../services/lineCommandParser';
import { GoogleSignInButton } from './GoogleSignInButton';

export interface SheetAutoSyncConfig {
  autoPushOnMutate: boolean;
  autoPullEnabled: boolean;
  autoPullIntervalSec: number;
  gasBridgeUrl: string;
}

interface SheetsDatabaseViewProps {
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
  onConnectExistingSpreadsheet: (idOrUrl: string) => Promise<void>;
  onPushToSheets: () => void;
  onPullFromSheets: () => Promise<void>;
  tasks: Task[];
  categories: Category[];
  logs: LineMessageLog[];
  autoSyncConfig?: SheetAutoSyncConfig;
  onUpdateAutoSyncConfig?: (next: SheetAutoSyncConfig) => void;
  lastSyncedAt?: string | null;
  onSaveAndSyncNow?: (spreadsheetIdOrUrl: string, gasUrl: string) => Promise<void>;
}

export const SheetsDatabaseView: React.FC<SheetsDatabaseViewProps> = ({
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
  tasks,
  categories,
  logs,
  autoSyncConfig,
  onUpdateAutoSyncConfig,
  lastSyncedAt,
  onSaveAndSyncNow,
}) => {
  const [newSheetTitle, setNewSheetTitle] = useState(
    'SheetCal LINE — ฐานข้อมูลตารางงานและแจ้งเตือน'
  );
  const [previewTab, setPreviewTab] = useState<'Tasks' | 'Categories' | 'LineLogs'>('Tasks');
  const [gasUrlInput, setGasUrlInput] = useState(
    autoSyncConfig?.gasBridgeUrl ||
      'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec'
  );

  const isAuthenticated = Boolean(user && accessToken);
  const effectiveConfig: SheetAutoSyncConfig = autoSyncConfig || {
    autoPushOnMutate: true,
    autoPullEnabled: true,
    autoPullIntervalSec: 5,
    gasBridgeUrl: gasUrlInput,
  };

  const formattedLastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'พร้อมซิงค์อัตโนมัติ';

  return (
    <div className="space-y-6">
      {/* Automatic Sync Configuration Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ตั้งค่าระบบซิงค์ฐานข้อมูล Google Sheets อัตโนมัติ (Auto-Sync Settings)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                กำหนดรูปแบบการบันทึกอัตโนมัติ ความถี่ในการดึงข้อมูล และลิงก์ชีตหลักให้ซิงค์ทำงานเองตลอดเวลาโดยไม่ต้องกดปุ่มซ้ำ
              </p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>ซิงค์ล่าสุด: {formattedLastSync}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Setting 1: Auto-Push on Mutation */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  1. บันทึกลงชีตอัตโนมัติเมื่อเพิ่ม/แก้ไขงาน
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAutoSyncConfig?.({
                      ...effectiveConfig,
                      autoPushOnMutate: !effectiveConfig.autoPushOnMutate,
                    })
                  }
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors ${
                    effectiveConfig.autoPushOnMutate
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {effectiveConfig.autoPushOnMutate ? 'เปิดใช้งาน (ON)' : 'ปิด (OFF)'}
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                เมื่อลงนัดหมายใหม่ แก้ไข หรือลบงานในปฏิทิน ระบบจะส่งข้อมูลไปบันทึกใน Google Sheets ทันทีโดยอัตโนมัติ
              </p>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[11px] font-semibold text-emerald-700">
              {effectiveConfig.autoPushOnMutate
                ? 'สถานะ: บันทึกเข้าชีตทันทีทุกครั้งที่มีการเปลี่ยนแปลง'
                : 'สถานะ: รอกดปุ่มอัปเดตลงชีต (Push) ด้วยตนเอง'}
            </div>
          </div>

          {/* Setting 2: Auto-Pull Interval */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900">
                  2. ความถี่การดึงข้อมูลจากชีตอัตโนมัติ
                </span>
                <Clock className="h-4 w-4 text-slate-500 shrink-0" />
              </div>
              <p className="text-xs text-slate-600 mt-1.5">
                เลือกรอบเวลาให้หน้าเว็บดึงข้อมูลล่าสุดจาก Google Sheets และคำสั่งจาก LINE อัตโนมัติ
              </p>
              <select
                value={
                  effectiveConfig.autoPullEnabled
                    ? String(effectiveConfig.autoPullIntervalSec)
                    : '0'
                }
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdateAutoSyncConfig?.({
                    ...effectiveConfig,
                    autoPullEnabled: val > 0,
                    autoPullIntervalSec: val > 0 ? val : 30,
                  });
                }}
                className="mt-2.5 w-full rounded-lg border border-slate-300 !bg-white !text-slate-900 font-semibold px-3 py-1.5 text-xs"
              >
                <option value="5">ดึงข้อมูลอัตโนมัติทุก 5 วินาที (เรียลไทม์ - แนะนำ)</option>
                <option value="15">ดึงข้อมูลอัตโนมัติทุก 15 วินาที</option>
                <option value="30">ดึงข้อมูลอัตโนมัติทุก 30 วินาที</option>
                <option value="60">ดึงข้อมูลอัตโนมัติทุก 1 นาที</option>
                <option value="300">ดึงข้อมูลอัตโนมัติทุก 5 นาที</option>
                <option value="0">ปิดการดึงอัตโนมัติ (ดึงเมื่อกดปุ่ม Pull เท่านั้น)</option>
              </select>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[11px] font-semibold text-slate-700">
              {effectiveConfig.autoPullEnabled
                ? `ทำงานอยู่: ตรวจสอบและซิงค์ข้อมูลทุก ${effectiveConfig.autoPullIntervalSec} วินาที`
                : 'ปิดการดึงข้อมูลอัตโนมัติชั่วคราว'}
            </div>
          </div>

          {/* Setting 3: Target Sheet & Apps Script Bridge Binding */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-slate-900">
                3. ลิงก์สะพานเชื่อม Google Apps Script (Auto Bridge)
              </div>
              <p className="text-xs text-slate-600 mt-1">
                ใช้ซิงค์ชีตอัตโนมัติ 24 ชม. โดยไม่ต้องล็อกอิน Google ซ้ำ
              </p>
              <input
                type="text"
                value={gasUrlInput}
                onChange={(e) => setGasUrlInput(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="mt-2 w-full rounded-lg border border-slate-300 !bg-white !text-slate-900 px-3 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <button
              type="button"
              disabled={isSyncing}
              onClick={async () => {
                onUpdateAutoSyncConfig?.({
                  ...effectiveConfig,
                  gasBridgeUrl: gasUrlInput.trim(),
                });
                if (onSaveAndSyncNow) {
                  await onSaveAndSyncNow(
                    spreadsheetInput.trim() || sheetMeta?.spreadsheetId || '',
                    gasUrlInput.trim()
                  );
                }
              }}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'กำลังซิงค์ข้อมูล...' : 'บันทึกการตั้งค่า & ซิงค์ชีตทันที'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Top Grid: Google Auth & Spreadsheet Provisioning */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Google Account Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-slate-800" />
                <h2 className="text-base font-semibold text-slate-900">
                  1. บัญชี Google & สะพานเชื่อม Google Sheets (Auto Bridge)
                </h2>
              </div>
              <span className="text-xs font-semibold text-emerald-700">
                {isAuthenticated ? 'เชื่อมต่อ OAuth + Bridge สำเร็จ' : 'เชื่อมต่อผ่าน Apps Script Bridge อัตโนมัติ'}
              </span>
            </div>

            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              ระบบเชื่อมต่อฐานข้อมูล Google Sheets ผ่าน <strong>Google Apps Script Bridge อัตโนมัติ 100%</strong> โดยไม่ติดข้อจำกัดสิทธิ์ OAuth Scopes (หรือสามารถล็อกอินบัญชี Google เพิ่มเติมได้ตามต้องการ)
            </p>

            {isAuthenticated && user ? (
              <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {user.displayName || 'ผู้ใช้งาน Google Workspace'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>ออกจากระบบ</span>
                </button>
              </div>
            ) : (
              <div className="mt-5 p-4 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-xs text-slate-700">
                  <div className="font-semibold text-slate-900">
                    พร้อมซิงค์ Google Sheets อัตโนมัติ (ไม่ต้องตั้งค่า Scope เพิ่ม)
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    สามารถกดดึงข้อมูล (Pull) หรืออัปเดตลงชีต (Push) ด้านขวาได้ทันที หรือล็อกอินด้วย Google
                  </div>
                </div>
                <GoogleSignInButton
                  onClick={onLogin}
                  disabled={isLoggingIn}
                  label={isLoggingIn ? 'กำลังเข้าสู่ระบบ...' : 'Sign in with Google'}
                />
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>โครงสร้างตารางอัตโนมัติ: Tasks · Categories · LineLogs</span>
            <span className="font-mono-tabular">GAS Bridge + Sheets API v4</span>
          </div>
        </div>

        {/* Spreadsheet Setup & Sync Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  2. ตั้งค่าไฟล์ฐานข้อมูล Google Sheets ของคุณ
                </h2>
              </div>
              {sheetMeta && (
                <a
                  href={sheetMeta.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                >
                  <span>เปิดไฟล์ Google Sheets จริง</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option A: Create new spreadsheet */}
              <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50/60">
                <div className="text-xs font-semibold text-slate-900">
                  สร้างหรือซิงค์ฐานข้อมูล Google Sheets อัตโนมัติ (แนะนำ)
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ระบบจะเตรียมแท็บ Tasks, Categories, TeamMembers และ LineLogs ให้ทันที
                </p>
                <input
                  type="text"
                  value={newSheetTitle}
                  onChange={(e) => setNewSheetTitle(e.target.value)}
                  placeholder="ชื่อไฟล์ Google Sheets..."
                  className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => onCreateNewSpreadsheet(newSheetTitle)}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>
                    {isSyncing ? 'กำลังซิงค์ฐานข้อมูล...' : 'ซิงค์ฐานข้อมูล Google Sheets ทันที'}
                  </span>
                </button>
              </div>

              {/* Option B: Connect existing spreadsheet */}
              <div className="rounded-lg border border-slate-200 p-3.5 bg-slate-50/60">
                <div className="text-xs font-semibold text-slate-900">
                  เชื่อมต่อไฟล์ Google Sheets ที่มีอยู่แล้ว
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  วางลิงก์ URL ของ Google Sheets หรือระบุ Spreadsheet ID ของคุณ
                </p>
                <input
                  type="text"
                  value={spreadsheetInput}
                  onChange={(e) => onChangeSpreadsheetInput(e.target.value)}
                  placeholder="วาง URL หรือ Spreadsheet ID ที่นี่..."
                  className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono-tabular text-slate-900"
                />
                <button
                  type="button"
                  disabled={!spreadsheetInput.trim() || isSyncing}
                  onClick={() =>
                    onConnectExistingSpreadsheet(extractSpreadsheetId(spreadsheetInput))
                  }
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>เชื่อมต่อและดึงข้อมูลจากชีตนี้</span>
                </button>
              </div>
            </div>
          </div>

          {/* Connected Spreadsheet Status & Manual Sync Controls */}
          <div className="mt-4 pt-3.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 min-w-0">
              {sheetMeta ? (
                <div className="truncate">
                  <span className="font-semibold text-slate-900">{sheetMeta.title}</span>
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="font-mono-tabular text-slate-500">
                    ID: {sheetMeta.spreadsheetId}
                  </span>
                </div>
              ) : (
                <span>
                  ยังไม่ได้เลือกไฟล์ Google Sheets (ข้อมูลปัจจุบันถูกพักไว้ในหน่วยความจำเครื่องชั่วคราว)
                </span>
              )}
            </div>

            {sheetMeta && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={onPullFromSheets}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดึงข้อมูลจากชีต (Pull)</span>
                </button>
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={onPushToSheets}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>อัปเดตลง Google Sheets (Push)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Spreadsheet Table Inspector */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              ตารางข้อมูลโครงสร้าง Google Sheets (Live Sheet Inspector)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              แสดงแถวข้อมูลที่ซิงค์กับแท็บ Tasks, Categories และ LineLogs ในไฟล์ Google Sheets ของคุณ
            </p>
          </div>

          {/* Segmented Tab Controls */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setPreviewTab('Tasks')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                previewTab === 'Tasks'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              แท็บ Tasks ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab('Categories')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                previewTab === 'Categories'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              แท็บ Categories ({categories.length})
            </button>
            <button
              type="button"
              onClick={() => setPreviewTab('LineLogs')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                previewTab === 'LineLogs'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              แท็บ LineLogs ({logs.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {previewTab === 'Tasks' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono-tabular font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Row</th>
                  <th className="py-2.5 px-3">A: ID</th>
                  <th className="py-2.5 px-3">B: Title</th>
                  <th className="py-2.5 px-3">D: Date</th>
                  <th className="py-2.5 px-3">E: Time</th>
                  <th className="py-2.5 px-3">F: CategoryID</th>
                  <th className="py-2.5 px-3">G: Priority</th>
                  <th className="py-2.5 px-3">H: Status</th>
                  <th className="py-2.5 px-3 text-right">I: Remind(m)</th>
                  <th className="py-2.5 px-3">K: Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {tasks.map((t, index) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-400">
                      {index + 2}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-600">{t.id}</td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{t.title}</td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {formatTaskDateRangeLabel(t)}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-700">{t.time}</td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-600">
                      {t.categoryId}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-700">
                      {t.priority}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-700">
                      {t.status}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-right text-slate-700">
                      {t.remindMinutesBefore}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-600">
                      {t.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {previewTab === 'Categories' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono-tabular font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Row</th>
                  <th className="py-2.5 px-4">A: ID</th>
                  <th className="py-2.5 px-4">B: Name</th>
                  <th className="py-2.5 px-4">C: Color</th>
                  <th className="py-2.5 px-4">D: Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {categories.map((c, index) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-400">
                      {index + 2}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-600">{c.id}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{c.name}</td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-xs border border-black/10"
                          style={{ backgroundColor: c.color }}
                        />
                        {c.color}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{c.description || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {previewTab === 'LineLogs' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-mono-tabular font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Row</th>
                  <th className="py-2.5 px-4">B: Timestamp</th>
                  <th className="py-2.5 px-4">C: Direction</th>
                  <th className="py-2.5 px-4">D: Message Text</th>
                  <th className="py-2.5 px-4">F: Channel</th>
                  <th className="py-2.5 px-4">G: Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {logs.map((l, index) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-400">
                      {index + 2}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-600">
                      {l.timestamp.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-700">
                      {l.direction}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 max-w-md truncate">
                      {l.text}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-600">
                      {l.deliveryChannel}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-emerald-700">
                      {l.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
