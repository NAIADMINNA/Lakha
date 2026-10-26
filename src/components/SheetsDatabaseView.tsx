import React, { useState } from 'react';
import {
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LogOut,
  PlusCircle,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { Category, LineMessageLog, Task } from '../types';
import { SheetMetadata, extractSpreadsheetId } from '../services/sheetsService';
import { GoogleSignInButton } from './GoogleSignInButton';

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
}) => {
  const [newSheetTitle, setNewSheetTitle] = useState(
    'SheetCal LINE — ฐานข้อมูลตารางงานและแจ้งเตือน'
  );
  const [previewTab, setPreviewTab] = useState<'Tasks' | 'Categories' | 'LineLogs'>('Tasks');

  const isAuthenticated = Boolean(user && accessToken);

  return (
    <div className="space-y-6">
      {/* Top Grid: Google Auth & Spreadsheet Provisioning */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Google Account Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-slate-800" />
                <h2 className="text-base font-semibold text-slate-900">
                  1. บัญชี Google & สิทธิ์เข้าถึง Google Sheets
                </h2>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {isAuthenticated ? 'เชื่อมต่อสำเร็จ' : 'รอการยืนยันตัวตน'}
              </span>
            </div>

            <p className="mt-3 text-xs text-slate-600 leading-relaxed">
              ข้อมูลตารางงาน หมวดหมู่ และประวัติการสั่งงานผ่าน LINE ทั้งหมดจะถูกบันทึกไว้ใน Google Sheets ของคุณเอง 100% เพื่อความปลอดภัยและสำรองข้อมูลได้ตลอดเวลา
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
                    เข้าสู่ระบบด้วย Google เพื่อเชื่อมฐานข้อมูล
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    อนุญาตสิทธิ์ให้แอปอ่านและบันทึกตารางงานลงใน Google Sheets ของคุณ
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
            <span className="font-mono-tabular">Google Sheets API v4</span>
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
                  สร้างไฟล์ Google Sheets ใหม่อัตโนมัติ (แนะนำ)
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  ระบบจะสร้างไฟล์ใหม่พร้อมแท็บ Tasks, Categories และ LineLogs ให้ทันที
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
                  disabled={!isAuthenticated || isSyncing}
                  onClick={() => onCreateNewSpreadsheet(newSheetTitle)}
                  className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  <span>
                    {isSyncing ? 'กำลังสร้างฐานข้อมูล...' : 'สร้างไฟล์ Google Sheets ใหม่'}
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
                  disabled={!isAuthenticated || !spreadsheetInput.trim() || isSyncing}
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
                  disabled={!isAuthenticated || isSyncing}
                  onClick={onPullFromSheets}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>ดึงข้อมูลจากชีต (Pull)</span>
                </button>
                <button
                  type="button"
                  disabled={!isAuthenticated || isSyncing}
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
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-700">{t.date}</td>
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
