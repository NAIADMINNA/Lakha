import {
  Category,
  LineMessageLog,
  LineSettings,
  Task,
  TaskPriority,
  TaskStatus,
  TeamMember,
} from '../types';

export const INITIAL_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'member-owner',
    name: 'ธนภัทร (หัวหน้าทีม)',
    email: 'adjeabna@gmail.com',
    role: 'owner',
    avatarColor: '#0F172A',
    department: 'บริหารโครงการ & กลยุทธ์',
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    status: 'active',
  },
  {
    id: 'member-kanda',
    name: 'กานดา (การตลาด & ลูกค้า)',
    email: 'kanda.marketing@company.co.th',
    role: 'editor',
    avatarColor: '#0D9488',
    department: 'ดูแลลูกค้า & การตลาด',
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    status: 'active',
  },
  {
    id: 'member-pakorn',
    name: 'ปกรณ์ (พัฒนาระบบ & IT)',
    email: 'pakorn.dev@company.co.th',
    role: 'editor',
    avatarColor: '#2563EB',
    department: 'วิศวกรรมซอฟต์แวร์',
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    status: 'active',
  },
  {
    id: 'member-pimchanok',
    name: 'พิมพ์ชนก (บัญชี & การเงิน)',
    email: 'pimchanok.fin@company.co.th',
    role: 'viewer',
    avatarColor: '#D97706',
    department: 'บัญชีและการเงิน',
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    status: 'active',
  },
];

export const INITIAL_CATEGORIES: Category[] = [];

export function getInitialTasks(): Task[] {
  return [];
}

export const INITIAL_LINE_LOGS: LineMessageLog[] = [];

export const DEFAULT_LINE_SETTINGS: LineSettings = {
  enabled: true,
  defaultRemindMinutes: 60,
  reminderTimings: [30, 60, 1440],
  notifyOnOverdue: true,
  dailyDigestEnabled: true,
  dailyDigestTime: '08:30',
  messageFormat: 'executive_flex',
  customMessageTemplate:
    '🔔 แจ้งเตือนงาน [{priority}]\n📌 {title}\n🗓️ วันที่ {date} เวลา {time} น.\n🗂️ หมวดหมู่: {category}\n⏳ แจ้งเตือนล่วงหน้า: {remindBefore}',
  includeDescriptionInNotification: true,
  includeGoogleCalendarButton: true,
  includeOpenAppButton: true,
  triggerPriorities: [TaskPriority.HIGH, TaskPriority.MEDIUM, TaskPriority.LOW],
  triggerCategoryIds: [], // empty = all categories enabled
  triggerSources: ['web', 'line', 'sheets'],
  triggerStatuses: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  channelAccessToken: '',
  targetUserId: '',
  autoSyncOnLineCommand: true,
  publicCalendarUrl: '',
};
