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
  date: string; // YYYY-MM-DD
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
  date?: string;
  time: string;
  categoryName: string;
  categoryColor: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  assigneeName?: string;
}

export interface LineMessageLog {
  id: string;
  timestamp: string;
  direction: 'incoming_command' | 'outgoing_reply' | 'auto_reminder';
  text: string;
  taskTitle?: string;
  deliveryChannel: 'simulator' | 'line_messaging_api';
  status: 'delivered' | 'simulated' | 'failed';
  flexSummary?: {
    badge: string;
    title: string;
    subtitle: string;
    dateTime: string;
    date?: string;
    time?: string;
    categoryName: string;
    categoryColor: string;
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
  autoSyncOnLineCommand: boolean;
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
