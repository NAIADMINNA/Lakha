import React, { useMemo, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  MessageSquare,
  RefreshCw,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Category,
  LineSettings,
  Task,
  TaskStatus,
  TeamMember,
  TeamRole,
} from '../types';

interface TeamCollaborationViewProps {
  tasks: Task[];
  categories: Category[];
  teamMembers: TeamMember[];
  workspaceId: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  lastCollabSyncAt?: string | null;
  lineSettings: LineSettings;
  isSendingPush?: boolean;
  onUpdateLineSettings: (newSettings: LineSettings) => void;
  onTestPushNotification: () => Promise<void>;
  onDetectGroupId?: () => Promise<string | null>;
  onOpenLineCenter?: () => void;
  onInviteMember: (member: Omit<TeamMember, 'id' | 'invitedAt' | 'status'>) => void;
  onUpdateMemberRole: (memberId: string, role: TeamRole) => void;
  onRemoveMember: (member: TeamMember) => void;
}

const AVATAR_COLORS = [
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#D97706',
  '#DC2626',
  '#0891B2',
  '#4F46E5',
  '#0F172A',
];

export const TeamCollaborationView: React.FC<TeamCollaborationViewProps> = ({
  tasks,
  categories,
  teamMembers,
  workspaceId,
  spreadsheetId,
  spreadsheetUrl,
  lastCollabSyncAt,
  lineSettings,
  isSendingPush = false,
  onUpdateLineSettings,
  onTestPushNotification,
  onDetectGroupId,
  onOpenLineCenter,
  onInviteMember,
  onUpdateMemberRole,
  onRemoveMember,
}) => {
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('editor');
  const [inviteColor, setInviteColor] = useState(AVATAR_COLORS[0]);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [isDetectingGroup, setIsDetectingGroup] = useState(false);
  const [groupDetectNotice, setGroupDetectNotice] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const activeMode = lineSettings.teamNotificationMode || 'both';
  const rawGroupId = (lineSettings.targetGroupId || '').trim();
  const fallbackGroupFromTarget = /^[CR][0-9a-fA-F]{32}$/.test(
    (lineSettings.targetUserId || '').trim()
  )
    ? lineSettings.targetUserId.trim()
    : '';
  const effectiveGroupId = rawGroupId || fallbackGroupFromTarget;
  const isValidGroupId = /^[CR][0-9a-fA-F]{32}$/.test(effectiveGroupId);

  const shareableCalendarUrl = useMemo(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams();
    params.set('workspace', workspaceId || 'team-default');
    if (spreadsheetId) {
      params.set('sheet', spreadsheetId);
    }
    return `${base}/?${params.toString()}`;
  }, [workspaceId, spreadsheetId]);

  const sharedStats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const inProgress = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
    const pending = tasks.filter((t) => t.status === TaskStatus.PENDING).length;
    const rate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

    return {
      total: tasks.length,
      completed,
      inProgress,
      pending,
      rate,
    };
  }, [tasks]);

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareableCalendarUrl);
      setCopiedShareLink(true);
      setTimeout(() => setCopiedShareLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleAutoDetectGroupId = async () => {
    if (!onDetectGroupId) return;
    setIsDetectingGroup(true);
    setGroupDetectNotice(null);
    try {
      const detected = await onDetectGroupId();
      if (detected && /^[CR][0-9a-fA-F]{32}$/.test(detected)) {
        setGroupDetectNotice({
          ok: true,
          message: `✅ ดึงรหัสห้องแชทกลุ่ม LINE สำเร็จ: ${detected} — พร้อมส่งแจ้งเตือนเข้ากลุ่ม LINE ทันที!`,
        });
      } else {
        setGroupDetectNotice({
          ok: false,
          message:
            '⚠️ ยังไม่พบสัญญาณจากกลุ่ม LINE — กรุณาเชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์คำว่า "เชื่อมกลุ่ม" ในห้องแชทกลุ่ม 1 ครั้ง (บอทจะตอบกลับรหัส C... ทันที) จากนั้นกดปุ่มดึงรหัสอีกครั้งครับ',
        });
      }
    } finally {
      setIsDetectingGroup(false);
    }
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) return;

    onInviteMember({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      department: inviteDepartment.trim() || 'สมาชิกทีม',
      role: inviteRole,
      avatarColor: inviteColor,
    });

    setInviteName('');
    setInviteEmail('');
    setInviteDepartment('');
  };

  return (
    <div className="space-y-6">
      {/* Top 3-Card Colorful Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-5 shadow-2xs">
          <div className="text-xs font-semibold text-indigo-600">
            สมาชิกที่ใช้ปฏิทินร่วมกัน
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {teamMembers.length}
            </span>
            <span className="text-xs text-indigo-700 font-medium">
              ใช้ตารางงานเดียวกัน
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-4 border-t-amber-500 rounded-xl p-5 shadow-2xs">
          <div className="text-xs font-semibold text-amber-600">
            งานทั้งหมดในปฏิทินของทีม
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 font-mono-tabular">
              {sharedStats.total}
            </span>
            <span className="text-xs text-amber-700 font-mono-tabular font-medium">
              กำลังทำ/ค้าง {sharedStats.pending + sharedStats.inProgress} งาน
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 shadow-2xs">
          <div className="text-xs font-semibold text-emerald-600">
            ความคืบหน้ารวมของปฏิทินทีม
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-bold text-emerald-600 font-mono-tabular">
              {sharedStats.rate}%
            </span>
            <span className="text-xs text-emerald-700 font-mono-tabular font-medium">
              เสร็จแล้ว {sharedStats.completed} งาน
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Clean Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Share Link + Interactive LINE Group Chat Control + Team Member Directory */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Share Calendar Link */}
          <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-6 space-y-4 shadow-2xs">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>แชร์ลิงก์ปฏิทินให้ทีมใช้งานร่วมกัน</span>
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  ส่งลิงก์ด้านล่างให้เพื่อนร่วมทีมเพื่อเปิดดู เพิ่ม หรือแก้ไขตารางงานในปฏิทินเดียวกันแบบ Real-time
                </p>
              </div>
              {lastCollabSyncAt && (
                <span className="text-[11px] font-mono-tabular text-emerald-700 font-medium shrink-0">
                  ซิงค์ล่าสุด{' '}
                  {new Date(lastCollabSyncAt).toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  น.
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                readOnly
                value={shareableCalendarUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3.5 py-2 text-xs font-mono-tabular text-slate-800 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] transition-colors whitespace-nowrap shrink-0"
              >
                {copiedShareLink ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-white" />
                    <span>คัดลอกลิงก์แล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>คัดลอกลิงก์ปฏิทิน</span>
                  </>
                )}
              </button>
              {spreadsheetUrl && (
                <a
                  href={spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <span>ตั้งค่าแชร์ชีต</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Card 2: Interactive LINE Team Notification Panel (Format 1 Broadcast & Format 2 Group Chat) */}
          <div className="bg-white border-2 border-emerald-300 border-t-4 border-t-[#06C755] rounded-xl p-6 space-y-5 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#06C755] shrink-0" />
                  <span>ตั้งค่าการแจ้งเตือน LINE สำหรับสมาชิกในปฏิทินทีม</span>
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  เลือกได้ว่าจะให้แจ้งเตือนแยกแชทส่วนตัว (รูปแบบที่ 1), แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม (รูปแบบที่ 2) หรือส่งทั้งคู่พร้อมกัน
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${
                  isValidGroupId
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-amber-50 text-amber-800 border-amber-300'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isValidGroupId ? 'bg-[#06C755]' : 'bg-amber-500'
                  }`}
                />
                {isValidGroupId
                  ? 'เชื่อมห้องแชทกลุ่ม LINE (C...) แล้ว'
                  : 'ยังไม่ได้ระบุ Group ID (C...)'}
              </span>
            </div>

            {/* Mode Selector Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() =>
                  onUpdateLineSettings({
                    ...lineSettings,
                    teamNotificationMode: 'broadcast',
                  })
                }
                className={`text-left rounded-xl border p-3.5 transition-all ${
                  activeMode === 'broadcast'
                    ? 'border-[#06C755] bg-emerald-50/70 ring-2 ring-[#06C755]/25'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    รูปแบบที่ 1: แชทส่วนตัว
                  </span>
                  {activeMode === 'broadcast' && (
                    <CheckCircle2 className="h-4 w-4 text-[#06C755]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  ส่งการ์ดแจ้งเตือนแยกเข้าแชทส่วนตัวของทุกคนที่แอดเพื่อน LINE OA (Broadcast)
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateLineSettings({
                    ...lineSettings,
                    teamNotificationMode: 'group',
                  })
                }
                className={`text-left rounded-xl border p-3.5 transition-all ${
                  activeMode === 'group'
                    ? 'border-[#06C755] bg-emerald-50/70 ring-2 ring-[#06C755]/25'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900">
                    รูปแบบที่ 2: ห้องแชทกลุ่ม
                  </span>
                  {activeMode === 'group' && (
                    <CheckCircle2 className="h-4 w-4 text-[#06C755]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  ยิงการ์ดแจ้งเตือนรวมเข้า <strong>ห้องแชทกลุ่ม LINE ของทีม (C...)</strong> ห้องเดียวเห็นพร้อมกันทั้งทีม
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateLineSettings({
                    ...lineSettings,
                    teamNotificationMode: 'both',
                  })
                }
                className={`text-left rounded-xl border p-3.5 transition-all ${
                  activeMode === 'both'
                    ? 'border-[#06C755] bg-emerald-50/70 ring-2 ring-[#06C755]/25'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-900">
                    ส่งทั้ง 2 รูปแบบ (แนะนำ)
                  </span>
                  {activeMode === 'both' && (
                    <CheckCircle2 className="h-4 w-4 text-[#06C755]" />
                  )}
                </div>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  ส่งเข้า <strong>ห้องแชทกลุ่ม LINE (C...)</strong> และส่ง Broadcast แชทส่วนตัวควบคู่กัน
                </p>
              </button>
            </div>

            {/* Interactive Group ID Input & Auto-Detect Box */}
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-bold text-emerald-950">
                  รหัสห้องแชทกลุ่ม LINE ของทีม — Group ID (ขึ้นต้นด้วย C ความยาว 33 ตัวอักษร)
                </label>
                {effectiveGroupId && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLineSettings({
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
                  value={lineSettings.targetGroupId || fallbackGroupFromTarget}
                  onChange={(e) =>
                    onUpdateLineSettings({
                      ...lineSettings,
                      targetGroupId: e.target.value.trim(),
                    })
                  }
                  placeholder="เช่น C1234567890abcdef1234567890abcdef (กดปุ่มดึงรหัสอัตโนมัติด้านขวาได้)"
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-mono-tabular text-slate-900 bg-white focus:outline-none ${
                    effectiveGroupId && !isValidGroupId
                      ? 'border-amber-400 bg-amber-50/40'
                      : 'border-emerald-300 focus:border-[#06C755]'
                  }`}
                />
                <button
                  type="button"
                  disabled={isDetectingGroup}
                  onClick={handleAutoDetectGroupId}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-emerald-700 ${
                      isDetectingGroup ? 'animate-spin' : ''
                    }`}
                  />
                  <span>
                    {isDetectingGroup
                      ? 'กำลังค้นหา Group ID...'
                      : '🔄 ดึงรหัสกลุ่ม C... อัตโนมัติ'}
                  </span>
                </button>
              </div>

              {effectiveGroupId && !isValidGroupId && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                  ⚠️ รหัสที่กรอกยังไม่ใช่รหัส LINE Group ID 33 ตัวอักษร (ต้องขึ้นต้นด้วยตัวพิมพ์ใหญ่{' '}
                  <code className="font-bold">C</code> หรือ <code className="font-bold">R</code>{' '}
                  ตามด้วยตัวเลขและ a-f รวม 33 ตัว) — แนะนำให้พิมพ์คำว่า{' '}
                  <code className="font-bold bg-white px-1.5 py-0.5 rounded border">
                    เชื่อมกลุ่ม
                  </code>{' '}
                  ในห้องแชทกลุ่ม LINE ของทีม แล้วบอทจะตอบกลับรหัส <code className="font-bold">C...</code>{' '}
                  ให้คัดลอกมาวาง หรือกดปุ่ม <strong>"ดึงรหัสกลุ่ม C... อัตโนมัติ"</strong> ได้เลยครับ
                </div>
              )}

              {groupDetectNotice && (
                <div
                  className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                    groupDetectNotice.ok
                      ? 'bg-emerald-100/80 border-emerald-300 text-emerald-950'
                      : 'bg-amber-50 border-amber-200 text-amber-950'
                  }`}
                >
                  {groupDetectNotice.message}
                </div>
              )}

              {/* Action Buttons: Test Group Push & Open LINE Settings */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isSendingPush}
                  onClick={() => onTestPushNotification()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] transition-colors shadow-2xs"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>
                    {isSendingPush
                      ? 'กำลังส่งการ์ดทดสอบเข้ากลุ่ม LINE...'
                      : '🔔 ทดสอบยิงแจ้งเตือนเข้าห้องแชทกลุ่ม LINE ทันที'}
                  </span>
                </button>

                {onOpenLineCenter && (
                  <button
                    type="button"
                    onClick={onOpenLineCenter}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5 text-slate-600" />
                    <span>ตั้งค่า Webhook / โค้ด Apps Script v2.6</span>
                  </button>
                )}
              </div>
            </div>

            {/* 3-Step Checklist Why Group Chat Might Not Receive & How to Fix in 1 Minute */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs text-slate-700">
              <div className="font-bold text-slate-900">
                💡 วิธีเชื่อมต่อ "รูปแบบที่ 2: ห้องแชทกลุ่ม LINE ของทีม (Group Chat)" ให้สำเร็จ 100%
              </div>
              <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-700">
                <li>
                  <strong className="text-slate-900">เปิดสิทธิ์ให้บอทเข้ากลุ่มได้:</strong> เข้าเว็บ{' '}
                  <a
                    href="https://manager.line.biz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 font-semibold underline"
                  >
                    manager.line.biz
                  </a>{' '}
                  &gt; เลือกบัญชี LINE OA &gt; <strong>ตั้งค่า (Settings)</strong> &gt;{' '}
                  <strong>ตั้งค่าบัญชี (Account settings)</strong> &gt; หัวข้อ{' '}
                  <em>"แชทแบบกลุ่มและแชทแบบหลายคน"</em> ให้ติ๊กเลือก{' '}
                  <span className="font-bold text-emerald-700">
                    "อนุญาตให้บัญชีเข้าร่วมกลุ่มและแชทแบบหลายคน"
                  </span>
                </li>
                <li>
                  <strong className="text-slate-900">เชิญบอทเข้ากลุ่ม & พิมพ์คำสั่ง:</strong> เชิญบอท LINE OA เข้าห้องแชทกลุ่มของทีม แล้วพิมพ์ข้อความในกลุ่มว่า{' '}
                  <code className="font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-300 text-emerald-800">
                    เชื่อมกลุ่ม
                  </code>{' '}
                  บอทจะตอบกลับรหัส <code className="font-bold">Group ID (C...)</code> ในห้องแชทกลุ่มทันที
                </li>
                <li>
                  <strong className="text-slate-900">ดึงรหัสเข้าเว็บ (หรือวางรหัส C...):</strong> กดปุ่ม{' '}
                  <strong>"🔄 ดึงรหัสกลุ่ม C... อัตโนมัติ"</strong> ด้านบน (หรือคัดลอกรหัส{' '}
                  <code className="font-bold">C...</code> ที่บอทตอบในกลุ่มมาวางในช่องด้านบน) แล้วกด{' '}
                  <strong>"🔔 ทดสอบยิงแจ้งเตือนเข้าห้องแชทกลุ่ม LINE ทันที"</strong> ได้เลยครับ!
                </li>
              </ol>
            </div>
          </div>

          {/* Card 3: Shared Calendar Team Members List */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-2xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-600 shrink-0" />
                  <span>รายชื่อสมาชิกที่ใช้ปฏิทินนี้ร่วมกัน ({teamMembers.length} คน)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  สมาชิกทุกคนในรายชื่อสามารถเข้าถึงปฏิทินเดียวกันตามสิทธิ์ที่กำหนด
                </p>
              </div>
            </div>

            <div className="mt-4 divide-y divide-slate-200">
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold text-white shrink-0 shadow-2xs"
                      style={{ backgroundColor: member.avatarColor || '#2563EB' }}
                    >
                      {member.name.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {member.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {member.email}
                        {member.department ? ` · ${member.department}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={member.role}
                      onChange={(e) =>
                        onUpdateMemberRole(member.id, e.target.value as TeamRole)
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-600 focus:outline-none"
                      aria-label={`สิทธิ์การใช้งานของ ${member.name}`}
                    >
                      <option value="owner">เจ้าของปฏิทิน (Owner)</option>
                      <option value="editor">แก้ไขตารางงานได้ (Editor)</option>
                      <option value="viewer">ดูตารางงานอย่างเดียว (Viewer)</option>
                    </select>

                    {member.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => onRemoveMember(member)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="นำออกจากปฏิทินร่วมกัน"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Invite Member Form + Shared Calendar Progress */}
        <div className="lg:col-span-5 space-y-6">
          {/* Invite Member Form */}
          <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-6 shadow-2xs">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 pb-4 border-b border-slate-200">
              <UserPlus className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>เพิ่มสมาชิกเข้าร่วมใช้ปฏิทิน</span>
            </h3>

            <form onSubmit={handleInviteSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ชื่อสมาชิก *
                </label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="เช่น ณัฐพงศ์, ศิริพร..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  อีเมล (สำหรับแชร์ Google Sheets) *
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@company.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ฝ่าย / ทีม (ไม่บังคับ)
                  </label>
                  <input
                    type="text"
                    value={inviteDepartment}
                    onChange={(e) => setInviteDepartment(e.target.value)}
                    placeholder="เช่น การตลาด, ทีมขาย..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    สิทธิ์การใช้ปฏิทิน
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                  >
                    <option value="editor">แก้ไขตารางงานได้ (Editor)</option>
                    <option value="viewer">ดูอย่างเดียว (Viewer)</option>
                    <option value="owner">เจ้าของร่วม (Owner)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1.5">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setInviteColor(c)}
                      className={`h-5 w-5 rounded-md transition-transform ${
                        inviteColor === c
                          ? 'ring-2 ring-offset-1 ring-slate-900 scale-110'
                          : 'opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`เลือกสี ${c}`}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>เพิ่มเข้าปฏิทินทีม</span>
                </button>
              </div>
            </form>
          </div>

          {/* Shared Calendar Progress by Category */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                ความคืบหน้างานในปฏิทินร่วมกัน
              </h3>
              <span className="text-xs font-mono-tabular font-semibold text-emerald-600">
                เสร็จแล้ว {sharedStats.completed}/{sharedStats.total} งาน ({sharedStats.rate}%)
              </span>
            </div>

            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-[#06C755] h-full transition-all duration-300"
                style={{ width: `${sharedStats.rate}%` }}
              />
            </div>

            <div className="pt-2 space-y-2.5 border-t border-slate-200">
              {categories.length === 0 ? (
                <p className="text-xs text-slate-500 py-1">
                  ยังไม่มีรายการงานหรือหมวดหมู่งานในปฏิทิน — สามารถเริ่มเพิ่มงานใหม่ของทีมได้ทันที
                </p>
              ) : (
                categories.map((cat) => {
                  const catTasks = tasks.filter((t) => t.categoryId === cat.id);
                  const catDone = catTasks.filter(
                    (t) => t.status === TaskStatus.COMPLETED
                  ).length;

                  return (
                    <div
                      key={cat.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-slate-800 font-medium truncate">
                          {cat.name}
                        </span>
                      </div>
                      <span className="font-mono-tabular text-slate-600 font-medium shrink-0">
                        เสร็จ {catDone}/{catTasks.length} งาน
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

