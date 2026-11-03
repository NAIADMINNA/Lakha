import {
  Category,
  LineMessageLog,
  LineSettings,
  Task,
  TaskPriority,
  TaskStatus,
  TeamMember,
} from '../types';

export const DEFAULT_GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbxPgbnfAD8aJLzG9Vy8mybzN6dSBJRADHnKHf_J2L2hTtZqUhqW2ERjp01d8IIIk-r_Vg/exec';

export const DEFAULT_SPREADSHEET_ID =
  '1Jjg5fqaul_Q3VFQQRY0H02JltmfhL0_kNe4TmiwufWc';

export const DEFAULT_LINE_GROUP_ID =
  'Cff150b586a4f91c883b40ae7d76b2ec9';

export const INITIAL_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'member-owner',
    name: 'นายสุเมธ ยิ้มพงษ์',
    email: 'adjeabna@gmail.com',
    role: 'owner',
    avatarColor: '#0F172A',
    department: 'บริหารโครงการ & กลยุทธ์',
    invitedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
    status: 'active',
  },
];

export const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-work', name: 'งานบริหาร & โปรเจกต์', color: '#2563EB' },
  { id: 'cat-client', name: 'นัดหมายลูกค้า & การตลาด', color: '#0D9488' },
  { id: 'cat-urgent', name: 'งานด่วนเร่งรัด (SLA)', color: '#DC2626' },
  { id: 'cat-finance', name: 'บัญชี & เอกสารสัญญา', color: '#D97706' },
  { id: 'cat-personal', name: 'พัฒนาตัวเอง & กิจวัตร', color: '#7C3AED' },
];

export function getInitialTasks(): Task[] {
  return [
    {
      id: 'task-1793668054359',
      title: 'ประชุมส่วนราชการที่เกี่ยวข้องฯ',
      description: 'เพิ่มผ่านหน้าปฏิทินทีม (LINE Group Portal)',
      date: '2026-11-03',
      time: '10:00',
      categoryId: 'cat-work',
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.PENDING,
      remindMinutesBefore: 1,
      lineNotified: false,
      source: 'web',
      updatedAt: '2026-11-03T01:07:34.359Z',
    },
    {
      id: 'task-1793630653911',
      title: 'ไปพบเจ้าหน้าที่ boi @one bangkok เวลา 14.00 น.',
      description: 'ผอ.อำนาจ กับ หัวหน้าฝ่ายบริหาร',
      date: '2026-11-03',
      time: '14:00',
      categoryId: 'cat-urgent',
      priority: TaskPriority.HIGH,
      status: TaskStatus.PENDING,
      remindMinutesBefore: 30,
      lineNotified: true,
      source: 'web',
      updatedAt: '2026-11-02T14:46:15.670Z',
    },
  ];
}

export const INITIAL_LINE_LOGS: LineMessageLog[] = [];

export const DEFAULT_LINE_SETTINGS: LineSettings = {
  enabled: true,
  defaultRemindMinutes: 1,
  reminderTimings: [1, 15, 30],
  notifyOnOverdue: false,
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
  targetGroupId: DEFAULT_LINE_GROUP_ID,
  teamNotificationMode: 'both',
  autoSyncOnLineCommand: true,
  publicCalendarUrl: '',
  cardFontSize: 'md',
  cardTitleWeight: 'bold',
  cardLineSpacing: 'relaxed',
};
