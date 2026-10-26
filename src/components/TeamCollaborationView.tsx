import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  Category,
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
        {/* Left 7 Columns: Share Link + Team Member Directory */}
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

          {/* Card 2: Shared Calendar Team Members List */}
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

          {/* LINE Team Notification Guide Card */}
          <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-5 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-emerald-950 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-[#06C755]" />
                การแจ้งเตือน LINE สำหรับสมาชิกในปฏิทินทีม
              </h3>
              <span className="text-[11px] font-semibold text-[#06C755] bg-white px-2 py-0.5 rounded-md border border-emerald-200">
                รองรับ 2 รูปแบบ
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-700 leading-relaxed">
              <div className="bg-white/90 border border-emerald-100 rounded-lg p-3">
                <p className="font-semibold text-slate-900">
                  1. แจ้งเตือนแยกเข้าแชทส่วนตัวของทุกคน (Broadcast อัตโนมัติ)
                </p>
                <p className="text-slate-600 mt-0.5">
                  เพียงให้สมาชิกในทีมแอดเพื่อน <span className="font-semibold text-emerald-700">LINE OA ของทีม</span> และเว้นช่อง Target ID ว่างไว้ ระบบจะส่งการ์ดแจ้งเตือนงานและสรุปงานประจำวันให้สมาชิกทุกคนพร้อมกันอัตโนมัติ
                </p>
              </div>

              <div className="bg-white/90 border border-emerald-100 rounded-lg p-3">
                <p className="font-semibold text-slate-900">
                  2. แจ้งเตือนรวมในห้องแชทกลุ่ม LINE ของทีม (Group Chat)
                </p>
                <p className="text-slate-600 mt-0.5">
                  เชิญบอท LINE OA เข้า <span className="font-semibold text-emerald-700">กลุ่ม LINE ของทีม</span> แล้วพิมพ์ข้อความในกลุ่ม 1 ครั้ง ระบบจะจับ <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">Group ID (C...)</code> เพื่อส่งการ์ดแจ้งเตือนและสรุปงานเข้ากลุ่มเดียวกันทั้งทีม
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
