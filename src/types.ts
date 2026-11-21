export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export type LineNotificationFormat = 'executive_flex' | 'compact_flex' | 'text_custom';
export type TelegramTemplateStyle = 'executive_card' | 'compact_brief' | 'timeline_digest';

export type TeamRole = 'owner' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatarColor: string;
  department?: string;
  lineUserId?: string;
  invitedAt: string;
  status: 'active' | 'invited';
}

export interface Category {
  id: string;
  name: string;
  color: string;
  description?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD (Start Date)
  endDate?: string; // YYYY-MM-DD (Optional End Date for multi-day tasks)
  time: string; // HH:mm
  categoryId: string;
  priority: TaskPriority;
  status: TaskStatus;
  remindMinutesBefore: number;
  lineNotified: boolean;
  source: 'web' | 'line' | 'sheets';
  updatedAt: string;
  assigneeId?: string;
  assigneeName?: string;
}

export interface FlexDigestItem {
  title: string;
  description?: string;
  date?: string;
  endDate?: string;
  time: string;
  categoryName: string;
  categoryColor: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  assigneeName?: string;
  timePhase?: 'passed' | 'upcoming';
}

export interface LineMessageLog {
  id: string;
  timestamp: string;
  direction: 'incoming_command' | 'outgoing_reply' | 'auto_reminder';
  text: string;
  taskTitle?: string;
  deliveryChannel:
    | 'simulator'
    | 'line_messaging_api'
    | 'telegram_bot'
    | 'line_and_telegram';
  status: 'delivered' | 'simulated' | 'failed';
  flexSummary?: {
    badge: string;
    title: string;
    subtitle: string;
    dateTime: string;
    date?: string;
    endDate?: string;
    time?: string;
    categoryName: string;
    categoryColor: string;
    priority?: TaskPriority | 'low' | 'medium' | 'high';
    priorityLabel: string;
    remindLabel?: string;
    description?: string;
    formatMode?: LineNotificationFormat;
    includeGoogleCalendarButton?: boolean;
    digestItems?: FlexDigestItem[];
    stats?: {
      total: number;
      pending: number;
      completed: number;
    };
    timeSplitStats?: {
      referenceTime: string;
      passedCount: number;
      passedCompletedCount: number;
      passedOverdueCount: number;
      upcomingCount: number;
    };
  };
}

export interface LineSettings {
  enabled: boolean;
  defaultRemindMinutes: number;
  reminderTimings: number[]; // e.g. [15, 60, 1440] (15 mins, 1 hour, 1 day before)
  notifyOnOverdue: boolean;
  dailyDigestEnabled: boolean;
  dailyDigestTime: string;
  messageFormat: LineNotificationFormat;
  customMessageTemplate: string;
  includeDescriptionInNotification: boolean;
  includeGoogleCalendarButton: boolean;
  includeOpenAppButton: boolean;
  triggerPriorities: TaskPriority[];
  triggerCategoryIds: string[]; // empty or all IDs = all categories
  triggerSources: ('web' | 'line' | 'sheets')[];
  triggerStatuses: TaskStatus[];
  channelAccessToken: string;
  targetUserId: string;
  targetGroupId?: string;
  teamNotificationMode?: 'broadcast' | 'group' | 'both';
  autoSyncOnLineCommand: boolean;
  allowAddTaskFromLine?: boolean;
  publicCalendarUrl?: string;
  cardFontSize?: 'sm' | 'md' | 'lg';
  cardTitleWeight?: 'bold' | 'regular';
  cardLineSpacing?: 'tight' | 'normal' | 'relaxed';
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramDeliveryMode?: 'photo_card' | 'text_html';
  telegramStyle?: TelegramTemplateStyle;
  telegramHeaderTitle?: string;
  telegramShowStats?: boolean;
  telegramShowButtons?: boolean;
}

export type DirectorPresenceMode =
  | 'auto'
  | 'in_office'
  | 'in_meeting'
  | 'offsite'
  | 'unavailable';

export interface DirectorPresenceState {
  mode: DirectorPresenceMode;
  customNote: string;
  updatedAt: string;
}

export interface OrganizationSettings {
  appName: string;
  boardTitle: string;
  agencyName: string;
  departmentName: string;
  directorLabel: string;
  footerDescription: string;
  updatedAt: string;
}

export interface ConfirmationDialogRequest {
  isOpen: boolean;
  title: string;
  description: string;
  affectedItemSummary: string;
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void> | void;
}
