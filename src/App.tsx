import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Cloud,
  Edit3,
  ExternalLink,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Tv,
  Unlock,
  Users,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  Category,
  ConfirmationDialogRequest,
  LineMessageLog,
  LineSettings,
  Task,
  TaskPriority,
  TaskStatus,
  TeamMember,
  TeamRole,
} from './types';
import {
  DEFAULT_GAS_WEB_APP_URL,
  DEFAULT_LINE_SETTINGS,
  DEFAULT_SPREADSHEET_ID,
  INITIAL_CATEGORIES,
  INITIAL_LINE_LOGS,
  INITIAL_TEAM_MEMBERS,
  getEffectiveGasUrl,
} from './data/initialData';
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  isInAppWebView,
  logout,
  openInExternalBrowser,
} from './services/auth';
import {
  SheetMetadata,
  createDatabaseSpreadsheet,
  fetchDatabaseFromSheet,
  writeDatabaseToSheet,
} from './services/sheetsService';
import {
  doesTaskTriggerNotification,
  formatLocalDateYMD,
  formatLocalTimeHM,
  formatRemindMinutesLabel,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  isTaskActiveOnDate,
  parseLineChatMessage,
  renderCustomLineMessage,
  resolveTeamCalendarAppUrl,
} from './services/lineCommandParser';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { ConfirmationModal } from './components/ConfirmationModal';
import { TaskFormModal } from './components/TaskFormModal';
import { CalendarView, buildGoogleCalendarTemplateUrl } from './components/CalendarView';
import { LineCenterView } from './components/LineCenterView';
import { CategoryManagerView } from './components/CategoryManagerView';
import { SheetsDatabaseView } from './components/SheetsDatabaseView';
import { TeamCollaborationView } from './components/TeamCollaborationView';
import { ScheduleBoardView } from './components/ScheduleBoardView';

type ActiveSection =
  | 'dashboard'
  | 'schedule'
  | 'calendar'
  | 'team'
  | 'line'
  | 'categories'
  | 'database';
type TaskFilterTab = 'all' | 'today' | 'pending' | 'high' | 'completed';

const STORAGE_KEYS = {
  TASKS: 'sheetcal_tasks_v3_clean',
  CATEGORIES: 'sheetcal_categories_v3_clean',
  TEAM_MEMBERS: 'sheetcal_team_members_v1',
  LINE_LOGS: 'sheetcal_line_logs_v3_clean',
  LINE_SETTINGS: 'sheetcal_line_settings_v2',
  SHEET_META: 'sheetcal_sheet_meta_v1',
  WORKSPACE_ID: 'sheetcal_workspace_id_v3_clean',
};

export default function App() {
  const todayStr = formatLocalDateYMD();

  // Navigation state (supports ?section=calendar or ?view=calendar deep-links from LINE Flex Cards)
  const [activeSection, setActiveSection] = useState<ActiveSection>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sec = (params.get('section') || params.get('view') || '').trim().toLowerCase();
      if (
        sec === 'calendar' ||
        sec === 'schedule' ||
        sec === 'dashboard' ||
        sec === 'team' ||
        sec === 'line' ||
        sec === 'categories' ||
        sec === 'database'
      ) {
        return sec as ActiveSection;
      }
      if (params.get('date')) {
        return 'calendar';
      }
    } catch {
      // Ignore
    }
    return 'dashboard';
  });

  // Passcode Protection for Admin Sections: ทีมที่ใช้ปฏิทินร่วมกัน ('team'), แจ้งเตือน & สั่งงาน LINE ('line'), ฐานข้อมูล Google Sheets ('database')
  const ADMIN_PASSCODE = '0841543524';
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [adminPasscodeInput, setAdminPasscodeInput] = useState<string>('');
  const [adminPasscodeError, setAdminPasscodeError] = useState<string>('');

  const handleVerifyAdminPasscode = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (adminPasscodeInput.trim() === ADMIN_PASSCODE) {
      setIsAdminUnlocked(true);
      setAdminPasscodeInput('');
      setAdminPasscodeError('');
    } else {
      setAdminPasscodeError('รหัสผ่านไม่ถูกต้อง กรุณากรอกรหัสผ่านผู้ดูแลระบบอีกครั้ง');
    }
  };

  // Shared Workspace ID (supports ?workspace=... URL param for shared calendar links)
  const [workspaceId] = useState<string>(() => {
    try {
      const existingGas = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
      if (
        !existingGas ||
        existingGas.includes('AKfycby0gvQ') ||
        existingGas.includes('AKfycbxIf9k')
      ) {
        localStorage.setItem('sheetcal_gas_url_v1', DEFAULT_GAS_WEB_APP_URL);
      }
      const params = new URLSearchParams(window.location.search);
      const gasFromUrl = params.get('gas');
      if (
        gasFromUrl &&
        gasFromUrl.trim().startsWith('https://script.google.com/macros/s/') &&
        !gasFromUrl.includes('AKfycby0gvQ') &&
        !gasFromUrl.includes('AKfycbxIf9k')
      ) {
        localStorage.setItem('sheetcal_gas_url_v1', gasFromUrl.trim());
      }
      const fromUrl = params.get('workspace');
      if (fromUrl && fromUrl.trim()) {
        localStorage.setItem(STORAGE_KEYS.WORKSPACE_ID, fromUrl.trim());
        return fromUrl.trim();
      }
      const saved = localStorage.getItem(STORAGE_KEYS.WORKSPACE_ID);
      if (saved && saved.trim()) return saved.trim();
    } catch {
      // Ignore
    }
    return 'sheetcal-team-clean';
  });

  const [lastCollabSyncAt, setLastCollabSyncAt] = useState<string | null>(null);
  const lastSyncedTimestampRef = useRef<string>('');
  const lastLocalMutationMsRef = useRef<number>(0);

  const PERMANENTLY_PURGED_IDS = useMemo(
    () =>
      new Set<string>([
        'task-1793454460187',
        'task-1793455770914-ty0d',
        'task-1793455784374',
        'task-1793455747775',
        'task-1793544098273',
        'task-1793545518340',
        'task-1793545672609',
        'task-1793455703389',
        'task-1793455880542-gdhj',
        'task-1793611662385',
        'task-1793668054359',
        'task-1793630653911',
        'task-1793666764668',
      ]),
    []
  );

  // Core data state (persisted locally and synced with Google Sheets & Shared Workspace)
  const [tasks, setTasks] = useState<Task[]>(() => {
    const purged = new Set<string>([
      'task-1793454460187',
      'task-1793455770914-ty0d',
      'task-1793455784374',
      'task-1793455747775',
      'task-1793544098273',
      'task-1793545518340',
      'task-1793545672609',
      'task-1793455703389',
      'task-1793455880542-gdhj',
      'task-1793611662385',
      'task-1793668054359',
      'task-1793630653911',
      'task-1793666764668',
    ]);
    try {
      const rawDel = localStorage.getItem('sheetcal_deleted_task_ids_v1');
      if (rawDel) {
        const parsedDel = JSON.parse(rawDel);
        if (Array.isArray(parsedDel)) {
          parsedDel.forEach((id) => purged.add(String(id)));
        }
      }
      const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return (parsed as Task[])
            .filter((t) => {
              if (!t || !t.id || purged.has(t.id)) return false;
              if (t.date === '2026-11-03' || t.date === '2026-11-04') {
                const idMatch = String(t.id).match(/^task-(\d+)/);
                const idMs = idMatch ? parseInt(idMatch[1], 10) : 0;
                const updatedMs = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
                if (
                  String(t.id).startsWith('sheet-task-') ||
                  (idMs > 0 && idMs < 1793841300000) ||
                  (updatedMs > 0 && updatedMs < 1793841300000)
                ) {
                  purged.add(t.id);
                  return false;
                }
              }
              return true;
            })
            .map((t) => {
              if (!t.endDate && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) {
                const combinedText = `${t.title || ''} ${t.description || ''}`;
                const [y, m, d] = t.date.split('-').map(Number);
                const durMatch = combinedText.match(/(\d{1,2})\s*วัน/);
                if (durMatch) {
                  const days = parseInt(durMatch[1], 10);
                  if (days >= 2 && days <= 60) {
                    const dt = new Date(y, m - 1, d + (days - 1));
                    const ey = dt.getFullYear();
                    const em = String(dt.getMonth() + 1).padStart(2, '0');
                    const ed = String(dt.getDate()).padStart(2, '0');
                    return { ...t, endDate: `${ey}-${em}-${ed}` };
                  }
                } else {
                  const rangeMatch = combinedText.match(/(?:วันที่\s*)?(\d{1,2})\s*[-–—ถึง]\s*(\d{1,2})/);
                  if (rangeMatch) {
                    const startDay = parseInt(rangeMatch[1], 10);
                    const endDay = parseInt(rangeMatch[2], 10);
                    if (startDay === d && endDay > startDay && endDay <= 31) {
                      const dt = new Date(y, m - 1, endDay);
                      const ey = dt.getFullYear();
                      const em = String(dt.getMonth() + 1).padStart(2, '0');
                      const ed = String(dt.getDate()).padStart(2, '0');
                      return { ...t, endDate: `${ey}-${em}-${ed}` };
                    }
                  }
                }
              }
              return t;
            });
        }
      }
    } catch {
      // Ignore parse error
    }
    return [];
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore
    }
    return INITIAL_CATEGORIES;
  });

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TEAM_MEMBERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore
    }
    return INITIAL_TEAM_MEMBERS;
  });

  const [lineLogs, setLineLogs] = useState<LineMessageLog[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LINE_LOGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore
    }
    return INITIAL_LINE_LOGS;
  });

  const [lineSettings, setLineSettings] = useState<LineSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LINE_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        const pubUrl = typeof parsed.publicCalendarUrl === 'string' ? parsed.publicCalendarUrl.trim() : '';
        if (
          !parsed._v28PublicUrlFixed ||
          !pubUrl ||
          /^https:\/\/ais-(pre|dev)-/i.test(pubUrl) ||
          pubUrl.includes('AKfycby0gvQ') ||
          pubUrl.includes('AKfycbxIf9k') ||
          pubUrl.includes('docs.google.com/spreadsheets')
        ) {
          parsed.publicCalendarUrl = 'https://naiadminna.github.io/Lakha/?section=calendar';
          parsed._v28PublicUrlFixed = true;
        }
        // Migrate legacy [30, 60, 1440] default timing and overdue catch-up that caused 18:00 tasks to fire at 21:29
        if (!parsed._v27TimingFixed) {
          if (
            Array.isArray(parsed.reminderTimings) &&
            parsed.reminderTimings.includes(1440) &&
            parsed.reminderTimings.length === 3
          ) {
            parsed.reminderTimings = [1, 15, 30];
          }
          if (parsed.defaultRemindMinutes === 60) {
            parsed.defaultRemindMinutes = 1;
          }
          parsed.notifyOnOverdue = false;
          parsed._v27TimingFixed = true;
        }
        return { ...DEFAULT_LINE_SETTINGS, ...parsed };
      }
      // Preserve token from v1 if present
      const legacy = localStorage.getItem('sheetcal_line_settings_v1');
      if (legacy) {
        const parsedLegacy = JSON.parse(legacy);
        return {
          ...DEFAULT_LINE_SETTINGS,
          channelAccessToken: parsedLegacy.channelAccessToken || '',
          targetUserId: parsedLegacy.targetUserId || '',
        };
      }
    } catch {
      // Ignore
    }
    return DEFAULT_LINE_SETTINGS;
  });

  const [sheetMeta, setSheetMeta] = useState<SheetMetadata | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SHEET_META);
      if (saved) return JSON.parse(saved);
    } catch {
      // Ignore
    }
    return {
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
      title: 'SheetCal LINE Database',
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${DEFAULT_SPREADSHEET_ID}/edit`,
      lastSyncedAt: new Date().toISOString(),
    };
  });

  // Google Auth & OAuth token state (token stored strictly in memory via auth.ts)
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [spreadsheetInput, setSpreadsheetInput] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sheetFromUrl = params.get('sheet');
      if (sheetFromUrl && sheetFromUrl.trim()) return sheetFromUrl.trim();
    } catch {
      // Ignore
    }
    return sheetMeta?.spreadsheetId || '';
  });

  // Status banner notification
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
    calendarDateToOpen?: string;
  } | null>(null);

  // Dashboard & Calendar Filter State
  const [taskFilter, setTaskFilter] = useState<TaskFilterTab>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uiStyleMode, setUiStyleMode] = useState<
    'neumorphism' | 'neobrutalism' | 'clay' | 'minimal'
  >(() => {
    try {
      const saved = localStorage.getItem('sheetcal_ui_style_v3');
      if (
        saved === 'neumorphism' ||
        saved === 'neobrutalism' ||
        saved === 'clay' ||
        saved === 'minimal'
      ) {
        return saved;
      }
    } catch {
      // Ignore
    }
    return 'neumorphism';
  });

  const handleToggleUiStyle = () => {
    const next =
      uiStyleMode === 'neumorphism'
        ? 'neobrutalism'
        : uiStyleMode === 'neobrutalism'
        ? 'clay'
        : uiStyleMode === 'clay'
        ? 'minimal'
        : 'neumorphism';
    setUiStyleMode(next);
    try {
      localStorage.setItem('sheetcal_ui_style_v3', next);
    } catch {
      // Ignore
    }
  };
  const [quickLineInput, setQuickLineInput] = useState<string>('');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const dateParam = (params.get('date') || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        return dateParam;
      }
    } catch {
      // Ignore
    }
    return todayStr;
  });

  // Task Modal State
  const [isTaskModalOpen, setIsTaskModalOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [modalInitialDate, setModalInitialDate] = useState<string>(todayStr);
  const [isSendingPush, setIsSendingPush] = useState<boolean>(false);

  // Mandatory Confirmation Dialog for Google Sheets mutations/deletions
  const [confirmDialog, setConfirmDialog] = useState<ConfirmationDialogRequest>({
    isOpen: false,
    title: '',
    description: '',
    affectedItemSummary: '',
    confirmLabel: 'ยืนยัน',
    isDestructive: false,
    onConfirm: () => {},
  });

  const closeConfirmDialog = () => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  };

  // Save local backup whenever state changes (DO NOT push to server/GAS on initial mount so a team member's stale cache never overwrites Admin's calendar!)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    } catch {
      // Ignore
    }
  }, [tasks]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
    } catch {
      // Ignore
    }
  }, [categories]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TEAM_MEMBERS, JSON.stringify(teamMembers));
    } catch {
      // Ignore
    }
  }, [teamMembers]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LINE_LOGS, JSON.stringify(lineLogs));
    } catch {
      // Ignore
    }
  }, [lineLogs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.LINE_SETTINGS, JSON.stringify(lineSettings));
    } catch {
      // Ignore
    }
    // Sync token, targetUserId, targetGroupId & schedule settings to server so 24/7 Server Scheduler & Webhook work automatically
    fetch('/api/line/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelAccessToken: lineSettings.channelAccessToken,
        targetUserId: lineSettings.targetUserId,
        targetGroupId: lineSettings.targetGroupId || '',
        enabled: lineSettings.enabled,
        dailyDigestEnabled: lineSettings.dailyDigestEnabled,
        dailyDigestTime: lineSettings.dailyDigestTime,
        defaultRemindMinutes: lineSettings.defaultRemindMinutes,
        notifyOnOverdue: lineSettings.notifyOnOverdue,
        teamNotificationMode: lineSettings.teamNotificationMode || 'both',
        publicCalendarUrl: lineSettings.publicCalendarUrl || '',
        messageFormat: lineSettings.messageFormat || 'executive_flex',
        includeDescriptionInNotification:
          lineSettings.includeDescriptionInNotification !== false,
        includeGoogleCalendarButton: lineSettings.includeGoogleCalendarButton !== false,
        includeOpenAppButton: lineSettings.includeOpenAppButton !== false,
        cardFontSize: lineSettings.cardFontSize || 'md',
        cardTitleWeight: lineSettings.cardTitleWeight || 'bold',
        cardLineSpacing: lineSettings.cardLineSpacing || 'relaxed',
      }),
    }).catch(() => {});
  }, [lineSettings]);

  useEffect(() => {
    try {
      if (sheetMeta) {
        localStorage.setItem(STORAGE_KEYS.SHEET_META, JSON.stringify(sheetMeta));
      }
    } catch {
      // Ignore
    }
  }, [sheetMeta]);

  const deletedTaskIdsRef = useRef<Set<string>>((() => {
    const initialSet = new Set<string>([
      'task-1793454460187',
      'task-1793455770914-ty0d',
      'task-1793455784374',
      'task-1793455747775',
      'task-1793544098273',
      'task-1793545518340',
      'task-1793545672609',
      'task-1793455703389',
      'task-1793455880542-gdhj',
      'task-1793611662385',
      'task-1793668054359',
      'task-1793630653911',
      'task-1793666764668',
    ]);
    try {
      const raw = localStorage.getItem('sheetcal_deleted_task_ids_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => initialSet.add(String(id)));
        }
      }
      localStorage.setItem(
        'sheetcal_deleted_task_ids_v1',
        JSON.stringify(Array.from(initialSet))
      );
    } catch {
      // Ignore
    }
    return initialSet;
  })());

  const recordDeletedTaskIds = useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        if (id) deletedTaskIdsRef.current.add(id);
      }
      PERMANENTLY_PURGED_IDS.forEach((id) => deletedTaskIdsRef.current.add(id));
      try {
        localStorage.setItem(
          'sheetcal_deleted_task_ids_v1',
          JSON.stringify(Array.from(deletedTaskIdsRef.current))
        );
      } catch {
        // Ignore
      }
    },
    [PERMANENTLY_PURGED_IDS]
  );

  const isTaskPurgedOrDeleted = useCallback(
    (t: { id?: string; date?: string; updatedAt?: string } | null | undefined, extraDeletedSet?: Set<string>): boolean => {
      if (!t || !t.id) return true;
      const id = String(t.id).trim();
      if (!id) return true;
      if (
        deletedTaskIdsRef.current.has(id) ||
        PERMANENTLY_PURGED_IDS.has(id) ||
        (extraDeletedSet && extraDeletedSet.has(id))
      ) {
        return true;
      }
      if (t.date === '2026-11-03' || t.date === '2026-11-04') {
        const idMatch = id.match(/^task-(\d+)/);
        const idMs = idMatch ? parseInt(idMatch[1], 10) : 0;
        const updatedMs = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
        if (
          id.startsWith('sheet-task-') ||
          (idMs > 0 && idMs < 1793841300000) ||
          (updatedMs > 0 && updatedMs < 1793841300000)
        ) {
          deletedTaskIdsRef.current.add(id);
          return true;
        }
      }
      return false;
    },
    [PERMANENTLY_PURGED_IDS]
  );

  const areTaskListsEqual = useCallback((a: Task[], b: Task[]): boolean => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const pt = a[i];
      const nt = b[i];
      if (
        !pt ||
        !nt ||
        pt.id !== nt.id ||
        pt.title !== nt.title ||
        pt.description !== nt.description ||
        pt.date !== nt.date ||
        pt.endDate !== nt.endDate ||
        pt.time !== nt.time ||
        pt.status !== nt.status ||
        pt.priority !== nt.priority ||
        pt.categoryId !== nt.categoryId ||
        pt.assigneeName !== nt.assigneeName
      ) {
        return false;
      }
    }
    return true;
  }, []);

  const GAS_META_DELIM = '#SCMETA#';

  const isDefaultCategoryList = useCallback((cats: Category[] | undefined | null): boolean => {
    if (!Array.isArray(cats) || cats.length === 0) return true;
    if (cats.length !== INITIAL_CATEGORIES.length) return false;
    return cats.every((c, i) => {
      const def = INITIAL_CATEGORIES[i];
      return (
        def &&
        c.id === def.id &&
        c.name === def.name &&
        c.color.toLowerCase() === def.color.toLowerCase() &&
        (c.description || '') === (def.description || '')
      );
    });
  }, []);

  const attachGasMetadataToTasks = useCallback(
    (
      taskList: Task[],
      categoriesList: Category[],
      teamMembersList: TeamMember[]
    ): Task[] => {
      return taskList.map((t, idx) => {
        const baseSource = (String(t.source || 'web').split(GAS_META_DELIM)[0] || 'web') as
          | 'web'
          | 'line'
          | 'sheets';
        const metaObj: Record<string, unknown> = {};
        if (t.endDate && t.endDate > t.date) {
          metaObj.e = t.endDate;
        }
        if (idx === 0) {
          if (Array.isArray(categoriesList) && categoriesList.length > 0) {
            metaObj.c = categoriesList;
          }
          if (Array.isArray(teamMembersList) && teamMembersList.length > 0) {
            metaObj.m = teamMembersList;
          }
        }
        const encodedSource =
          Object.keys(metaObj).length > 0
            ? (`${baseSource}${GAS_META_DELIM}${JSON.stringify(metaObj)}` as Task['source'])
            : baseSource;
        return {
          ...t,
          source: encodedSource,
        };
      });
    },
    []
  );

  const extractGasMetadataFromTasks = useCallback(
    (
      rawTasks: Task[]
    ): {
      tasks: Task[];
      categories?: Category[];
      teamMembers?: TeamMember[];
    } => {
      let extractedCategories: Category[] | undefined;
      let extractedMembers: TeamMember[] | undefined;
      const cleaned: Task[] = [];

      for (const item of rawTasks) {
        if (!item || typeof item !== 'object') continue;
        const copy: Task = { ...item };
        const rawSource = String(copy.source || 'web');
        if (rawSource.includes(GAS_META_DELIM)) {
          const [baseSource, metaJson] = rawSource.split(GAS_META_DELIM);
          copy.source = ((baseSource || 'web') as 'web' | 'line' | 'sheets');
          if (metaJson) {
            try {
              const parsedMeta = JSON.parse(metaJson) as {
                e?: string;
                c?: Category[];
                m?: TeamMember[];
              };
              if (typeof parsedMeta.e === 'string' && parsedMeta.e && !copy.endDate) {
                copy.endDate = parsedMeta.e;
              }
              if (
                Array.isArray(parsedMeta.c) &&
                parsedMeta.c.length > 0 &&
                !extractedCategories
              ) {
                extractedCategories = parsedMeta.c;
              }
              if (
                Array.isArray(parsedMeta.m) &&
                parsedMeta.m.length > 0 &&
                !extractedMembers
              ) {
                extractedMembers = parsedMeta.m;
              }
            } catch {
              // Ignore malformed metadata
            }
          }
        }

        if (!copy.endDate && /^\d{4}-\d{2}-\d{2}$/.test(copy.date || '')) {
          const combinedText = `${copy.title || ''} ${copy.description || ''}`;
          const [y, m, d] = copy.date.split('-').map(Number);
          const durMatch = combinedText.match(/(\d{1,2})\s*วัน/);
          if (durMatch) {
            const days = parseInt(durMatch[1], 10);
            if (days >= 2 && days <= 60) {
              const dt = new Date(y, m - 1, d + (days - 1));
              const ey = dt.getFullYear();
              const em = String(dt.getMonth() + 1).padStart(2, '0');
              const ed = String(dt.getDate()).padStart(2, '0');
              copy.endDate = `${ey}-${em}-${ed}`;
            }
          } else {
            const rangeMatch = combinedText.match(/(?:วันที่\s*)?(\d{1,2})\s*[-–—ถึง]\s*(\d{1,2})/);
            if (rangeMatch) {
              const startDay = parseInt(rangeMatch[1], 10);
              const endDay = parseInt(rangeMatch[2], 10);
              if (startDay === d && endDay > startDay && endDay <= 31) {
                const dt = new Date(y, m - 1, endDay);
                const ey = dt.getFullYear();
                const em = String(dt.getMonth() + 1).padStart(2, '0');
                const ed = String(dt.getDate()).padStart(2, '0');
                copy.endDate = `${ey}-${em}-${ed}`;
              }
            }
          }
        }

        cleaned.push(copy);
      }

      return {
        tasks: cleaned,
        categories: extractedCategories,
        teamMembers: extractedMembers,
      };
    },
    []
  );

  // Push collaborative workspace state to server so shared calendar collaborators stay in sync
  const pushCollaborativeWorkspace = useCallback(
    async (
      nextTasks: Task[],
      nextCategories: Category[],
      nextMembers: TeamMember[],
      deletedTaskId?: string | string[]
    ) => {
      lastLocalMutationMsRef.current = Date.now();
      const explicitDeleted = Array.isArray(deletedTaskId)
        ? deletedTaskId
        : deletedTaskId
        ? [deletedTaskId]
        : [];
      if (explicitDeleted.length > 0) {
        recordDeletedTaskIds(explicitDeleted);
      }
      const allDeletedIds = Array.from(deletedTaskIdsRef.current);
      const cleanNextTasks = extractGasMetadataFromTasks(nextTasks).tasks.filter(
        (t) => !isTaskPurgedOrDeleted(t)
      );

      try {
        const res = await fetch(
          `/api/collab/workspace/${encodeURIComponent(workspaceId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              updatedBy: user?.email || 'สมาชิกทีม',
              spreadsheetId: sheetMeta?.spreadsheetId,
              spreadsheetUrl: sheetMeta?.spreadsheetUrl,
              deletedTaskId:
                typeof deletedTaskId === 'string' ? deletedTaskId : undefined,
              deletedTaskIds: allDeletedIds,
              tasks: cleanNextTasks,
              categories: nextCategories,
              teamMembers: nextMembers,
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.workspace?.updatedAt) {
            lastSyncedTimestampRef.current = data.workspace.updatedAt;
            setLastCollabSyncAt(data.workspace.updatedAt);
          }
        }
      } catch {
        // Silent fallback
      }

      // Also sync tasks + categories + teamMembers to Google Sheets via Server Proxy or direct Google Apps Script Bridge (works on GitHub Pages too)
      const activeGasUrl = getEffectiveGasUrl();
      const gasTasksWithMeta = attachGasMetadataToTasks(
        cleanNextTasks,
        nextCategories,
        nextMembers
      );
      let proxySynced = false;
      try {
        const proxyRes = await fetch('/api/line/gas-bridge-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'push',
            gasUrl: activeGasUrl,
            tasks: gasTasksWithMeta,
            categories: nextCategories,
            teamMembers: nextMembers,
            deletedTaskIds: allDeletedIds,
          }),
        });
        const ct = proxyRes.headers.get('content-type') || '';
        if (proxyRes.ok && ct.includes('application/json')) {
          proxySynced = true;
        }
      } catch {
        proxySynced = false;
      }

      if (!proxySynced && activeGasUrl.startsWith('https://script.google.com/macros/s/')) {
        try {
          await fetch(activeGasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'sync_tasks',
              tasks: gasTasksWithMeta,
              categories: nextCategories,
              teamMembers: nextMembers,
            }),
          });
        } catch {
          // Silent fallback
        }
      }
    },
    [
      attachGasMetadataToTasks,
    extractGasMetadataFromTasks,
    isTaskPurgedOrDeleted,
    recordDeletedTaskIds,
    sheetMeta?.spreadsheetId,
    sheetMeta?.spreadsheetUrl,
    user?.email,
    workspaceId,
  ]);

  const tasksRef = useRef<Task[]>(tasks);
  const categoriesRef = useRef<Category[]>(categories);
  const teamMembersRef = useRef<TeamMember[]>(teamMembers);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);
  useEffect(() => {
    teamMembersRef.current = teamMembers;
  }, [teamMembers]);

  // Initialize Firebase Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (loggedInUser, token) => {
        setUser(loggedInUser);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      (partialUser) => {
        setUser(partialUser || null);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const showNotice = useCallback(
    (
      type: 'success' | 'info' | 'error',
      message: string,
      calendarDateToOpen?: string
    ) => {
      setStatusBanner({ type, message, calendarDateToOpen });
    },
    []
  );

  // Google Sign-In handler
  const handleGoogleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
        showNotice(
          'success',
          `เชื่อมต่อบัญชี Google (${result.user.email}) สำเร็จ พร้อมใช้งานฐานข้อมูล Google Sheets`
        );
      } else {
        showNotice(
          'info',
          'หน้าต่างเข้าสู่ระบบ Google ถูกปิดก่อนดำเนินการเสร็จสิ้น สามารถกดปุ่ม Sign in with Google เพื่อเข้าสู่ระบบใหม่ได้ทุกเมื่อ'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้';
      showNotice('error', msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    showNotice('info', 'ออกจากระบบบัญชี Google เรียบร้อยแล้ว');
  };

  // Helper to sync current state to Google Sheets (when connected) — merges remote LINE tasks first so we never overwrite them
  const syncAllToConnectedSheet = useCallback(
    async (
      nextTasks: Task[],
      nextCategories: Category[],
      nextLogs: LineMessageLog[],
      successMsg?: string,
      calendarDateToOpen?: string,
      deletedTaskId?: string | string[],
      nextTeamMembers: TeamMember[] = teamMembers
    ) => {
      const deletedSet = new Set<string>(
        Array.isArray(deletedTaskId)
          ? deletedTaskId
          : deletedTaskId
          ? [deletedTaskId]
          : []
      );
      await pushCollaborativeWorkspace(
        nextTasks,
        nextCategories,
        nextTeamMembers,
        deletedTaskId
      );

      const token = await getAccessToken();
      if (!token || !sheetMeta?.spreadsheetId) {
        if (sheetMeta?.spreadsheetId && !token) {
          setNeedsAuth(true);
        }
        return;
      }
      setIsSyncing(true);
      try {
        const mergedTasks = nextTasks.filter(
          (t) => !isTaskPurgedOrDeleted(t, deletedSet)
        );
        const mergedLogs = nextLogs;

        await writeDatabaseToSheet(
          token,
          sheetMeta.spreadsheetId,
          mergedTasks,
          nextCategories,
          mergedLogs,
          nextTeamMembers
        );
        if (successMsg) {
          showNotice('success', successMsg, calendarDateToOpen);
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการซิงค์ข้อมูลไปที่ Google Sheets';
        showNotice('error', msg);
      } finally {
        setIsSyncing(false);
      }
    },
    [isTaskPurgedOrDeleted, pushCollaborativeWorkspace, sheetMeta, showNotice, teamMembers]
  );

  // Create a brand new Google Spreadsheet database
  const handleCreateNewSpreadsheet = async (title: string) => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      showNotice('info', 'กรุณากด Sign in with Google ก่อนสร้างไฟล์ Google Sheets');
      return;
    }

    setIsSyncing(true);
    try {
      const createdMeta = await createDatabaseSpreadsheet(
        token,
        title || 'SheetCal LINE Database',
        tasks,
        categories,
        lineLogs,
        teamMembers
      );
      setSheetMeta(createdMeta);
      setSpreadsheetInput(createdMeta.spreadsheetId);
      showNotice(
        'success',
        `สร้างไฟล์ Google Sheets "${createdMeta.title}" พร้อมแท็บ Tasks, Categories, TeamMembers และ LineLogs เรียบร้อยแล้ว!`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้างไฟล์ Google Sheets ได้';
      showNotice('error', msg);
    } finally {
      setIsSyncing(false);
    }
  };

  // Connect an existing Google Spreadsheet
  const handleConnectExistingSpreadsheet = async (spreadsheetId: string) => {
    const token = await getAccessToken();
    if (!token) {
      setNeedsAuth(true);
      showNotice('info', 'กรุณากด Sign in with Google ก่อนเชื่อมต่อไฟล์ Google Sheets');
      return;
    }

    setIsSyncing(true);
    try {
      const result = await fetchDatabaseFromSheet(token, spreadsheetId);
      setSheetMeta(result.metadata);
      setSpreadsheetInput(result.metadata.spreadsheetId);

      const cleanSheetTasks = result.tasks.filter((t) => !isTaskPurgedOrDeleted(t));
      if (cleanSheetTasks.length > 0 || result.categories.length > 0) {
        if (cleanSheetTasks.length > 0) setTasks(cleanSheetTasks);
        if (result.categories.length > 0) setCategories(result.categories);
        if (result.logs.length > 0) setLineLogs(result.logs);
        if (result.teamMembers.length > 0) setTeamMembers(result.teamMembers);
        showNotice(
          'success',
          `เชื่อมต่อและดึงข้อมูลจาก "${result.metadata.title}" สำเร็จ (${cleanSheetTasks.length} งาน · สมาชิก ${
            result.teamMembers.length || teamMembers.length
          } คน)`
        );
      } else {
        setConfirmDialog({
          isOpen: true,
          title: 'เขียนข้อมูลเริ่มต้นลงใน Google Sheets ที่เชื่อมต่อหรือไม่?',
          description:
            'ชีตที่คุณเชื่อมต่อยังไม่มีข้อมูลงาน ระบบจะทำการเขียนรายการงาน หมวดหมู่ สมาชิกทีม และประวัติ LINE ปัจจุบันลงในแท็บ Tasks, Categories, TeamMembers และ LineLogs ของไฟล์นี้',
          affectedItemSummary: `ไฟล์ "${result.metadata.title}" — เขียนข้อมูลงาน ${tasks.length} รายการ · สมาชิกทีม ${teamMembers.length} คน`,
          confirmLabel: 'ยืนยันการเขียนข้อมูลลงชีต',
          isDestructive: false,
          onConfirm: async () => {
            await syncAllToConnectedSheet(
              tasks,
              categories,
              lineLogs,
              `บันทึกข้อมูลเริ่มต้นลงใน "${result.metadata.title}" เรียบร้อยแล้ว`,
              undefined,
              undefined,
              teamMembers
            );
            closeConfirmDialog();
          },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถดึงข้อมูลจาก Google Sheets ได้';
      showNotice('error', msg);
    } finally {
      setIsSyncing(false);
    }
  };

  // Pull from Google Sheets
  const handlePullFromSheets = async () => {
    if (!sheetMeta?.spreadsheetId) return;
    await handleConnectExistingSpreadsheet(sheetMeta.spreadsheetId);
  };

  // Push to Google Sheets (requires explicit user confirmation as it overwrites sheet rows)
  const handlePushToSheetsWithConfirm = () => {
    if (!sheetMeta?.spreadsheetId) {
      setActiveSection('database');
      showNotice('info', 'กรุณาสร้างหรือเชื่อมต่อไฟล์ Google Sheets ก่อนซิงค์ข้อมูล');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'ยืนยันการอัปเดตข้อมูลทับลงใน Google Sheets?',
      description:
        'ระบบจะทำการอัปเดตข้อมูลตารางงาน หมวดหมู่ สมาชิกทีม และประวัติการแจ้งเตือน LINE ปัจจุบันลงในไฟล์ Google Sheets ของคุณ',
      affectedItemSummary: `ไฟล์ "${sheetMeta.title}" · งาน ${tasks.length} รายการ · สมาชิกทีม ${teamMembers.length} คน · หมวดหมู่ ${categories.length} รายการ`,
      confirmLabel: 'ยืนยันอัปเดต Google Sheets',
      isDestructive: false,
      onConfirm: async () => {
        await syncAllToConnectedSheet(
          tasks,
          categories,
          lineLogs,
          `อัปเดตข้อมูลทั้งหมดลงใน Google Sheets "${sheetMeta.title}" สำเร็จแล้ว`,
          undefined,
          undefined,
          teamMembers
        );
        closeConfirmDialog();
      },
    });
  };

  const inFlightReminderIdsRef = useRef<Set<string>>(new Set());

  // Dispatch LINE OA notification (Real Messaging API Push/Broadcast if token configured + Simulator log)
  const dispatchLineReminder = useCallback(
    async (task: Task, isManualTrigger = false) => {
      if (!isManualTrigger) {
        if (inFlightReminderIdsRef.current.has(task.id)) return;
        const triggerCheck = doesTaskTriggerNotification(task, lineSettings);
        if (!triggerCheck.allowed) return;
        inFlightReminderIdsRef.current.add(task.id);
      }

      try {
        const cat = categories.find((c) => c.id === task.categoryId);
        const categoryName = cat?.name || 'ทั่วไป';
        const formatMode = lineSettings.messageFormat || 'executive_flex';
        const includeDesc = lineSettings.includeDescriptionInNotification !== false;
        const remindLabel = formatRemindMinutesLabel(
          task.remindMinutesBefore || lineSettings.defaultRemindMinutes || 60
        );

        const activeDateForStats = isTaskActiveOnDate(task, formatLocalDateYMD())
          ? formatLocalDateYMD()
          : task.date;
        const sameDayTasks = tasksRef.current.filter((t) =>
          isTaskActiveOnDate(t, activeDateForStats)
        );
        const baseSummaryTasks = sameDayTasks.length > 0 ? sameDayTasks : [task];
        const summaryTasks =
          baseSummaryTasks.length > 0
            ? baseSummaryTasks.some((t) => t.id === task.id)
              ? baseSummaryTasks
              : [...baseSummaryTasks, task]
            : [task];
      const summaryStats = {
        total: summaryTasks.length,
        pending: summaryTasks.filter((t) => t.status !== TaskStatus.COMPLETED).length,
        completed: summaryTasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
      };

      const customFormattedText = renderCustomLineMessage(
        lineSettings.customMessageTemplate,
        task,
        categoryName,
        includeDesc,
        summaryStats
      );

      const reminderText =
        formatMode === 'text_custom'
          ? customFormattedText
          : isManualTrigger
          ? `🔔 แจ้งเตือนงาน: "${task.title}" (${remindLabel})\n📊 สรุปตารางงาน: ทั้งหมด ${summaryStats.total} งาน · รอทำ ${summaryStats.pending} · เสร็จแล้ว ${summaryStats.completed}`
          : `⏰ ถึงเวลาเตรียมตัว (${remindLabel}): ${task.description || task.title}\n📊 สรุปตารางงาน: ทั้งหมด ${summaryStats.total} งาน · รอทำ ${summaryStats.pending} · เสร็จแล้ว ${summaryStats.completed}`;

      let deliveryChannel: LineMessageLog['deliveryChannel'] = 'simulator';
      let deliveryStatus: LineMessageLog['status'] = 'simulated';
      let apiNotice = '';

      if (lineSettings.channelAccessToken.trim()) {
        const calendarDeepLinkUrl = resolveTeamCalendarAppUrl({
          customPublicUrl: lineSettings.publicCalendarUrl,
          workspaceId,
          spreadsheetId: sheetMeta?.spreadsheetId || spreadsheetInput,
          date: task.date,
        });
        let handledByServer = false;
        try {
          const res = await fetch('/api/line/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channelAccessToken: lineSettings.channelAccessToken,
              to: lineSettings.targetUserId,
              targetGroupId: lineSettings.targetGroupId || '',
              teamNotificationMode: lineSettings.teamNotificationMode || 'both',
              text: reminderText,
              taskTitle: task.title,
              description: includeDesc ? task.description || '' : '',
              date: task.date,
              endDate: task.endDate,
              time: task.time,
              dateTime: `${formatTaskDateRangeLabel(task)} · ${task.time} น.`,
              categoryName,
              categoryColor: cat?.color || '#2563EB',
              priority: task.priority,
              stats: summaryStats,
              originUrl: calendarDeepLinkUrl,
              messageFormat: formatMode,
              includeDescription: includeDesc,
              includeGoogleCalendarButton:
                lineSettings.includeGoogleCalendarButton !== false,
              includeOpenAppButton: lineSettings.includeOpenAppButton !== false,
              cardFontSize: lineSettings.cardFontSize || 'md',
              cardTitleWeight: lineSettings.cardTitleWeight || 'bold',
              cardLineSpacing: lineSettings.cardLineSpacing || 'relaxed',
            }),
          });
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            handledByServer = true;
            const data = await res.json();
            if (data.ok) {
              deliveryChannel = 'line_messaging_api';
              deliveryStatus = 'delivered';
            }
            apiNotice = data.message || '';
          }
        } catch {
          handledByServer = false;
        }

        if (!handledByServer) {
          const savedGasUrl = getEffectiveGasUrl();
          if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
            const gasPayload = JSON.stringify({
              action: 'push_line',
              channelAccessToken: lineSettings.channelAccessToken.trim(),
              to: lineSettings.targetUserId.trim(),
              targetGroupId: (lineSettings.targetGroupId || '').trim(),
              teamNotificationMode: lineSettings.teamNotificationMode || 'both',
              text: reminderText,
              taskTitle: task.title,
              description: includeDesc ? task.description || '' : '',
              date: task.date,
              endDate: task.endDate,
              time: task.time,
              dateTime: `${formatTaskDateRangeLabel(task)} · ${task.time} น.`,
              categoryName,
              categoryColor: cat?.color || '#2563EB',
              priority: task.priority,
              stats: summaryStats,
              messageFormat: formatMode,
              originUrl: calendarDeepLinkUrl,
              cardFontSize: lineSettings.cardFontSize || 'md',
              cardTitleWeight: lineSettings.cardTitleWeight || 'bold',
              cardLineSpacing: lineSettings.cardLineSpacing || 'relaxed',
            });
            try {
              const gasRes = await fetch(savedGasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: gasPayload,
              });
              const gasText = await gasRes.text();
              let gasData: Record<string, unknown> = {};
              try {
                gasData = JSON.parse(gasText);
              } catch {
                gasData = {};
              }
              if (gasData.mode === 'gas_push_line' && gasData.ok) {
                deliveryChannel = 'line_messaging_api';
                deliveryStatus = 'delivered';
              } else if (gasData.status === 'verified' && !gasData.mode) {
                deliveryStatus = 'simulated';
                apiNotice =
                  '⚠️ ลิงก์ Google Apps Script ของคุณยังเป็นโค้ดเวอร์ชันเก่า จึงยังไม่ได้ส่งเข้าแอป LINE จริง — กรุณากด "คัดลอกโค้ด Apps Script" ไปวางทับแล้วกด Deploy > New version';
              } else {
                deliveryStatus = 'simulated';
                apiNotice = String(gasData.lineError || 'ไม่สามารถส่งเข้า LINE ผ่าน Apps Script ได้');
              }
            } catch {
              try {
                await fetch(savedGasUrl, {
                  method: 'POST',
                  mode: 'no-cors',
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                  body: gasPayload,
                });
                deliveryChannel = 'line_messaging_api';
                deliveryStatus = 'delivered';
              } catch {
                deliveryStatus = 'simulated';
              }
            }
          }
        }
      }

      const priorityLabelText =
        task.priority === TaskPriority.HIGH
          ? `ความสำคัญสูง · ${task.time} น.`
          : task.priority === TaskPriority.MEDIUM
          ? `ปานกลาง · ${task.time} น.`
          : `ทั่วไป · ${task.time} น.`;

      const newLog: LineMessageLog = {
        id: `log-${Date.now()}`,
        timestamp: new Date().toISOString(),
        direction: 'auto_reminder',
        text: reminderText,
        taskTitle: task.title,
        deliveryChannel,
        status: deliveryStatus,
        flexSummary: {
          badge:
            task.priority === TaskPriority.HIGH
              ? '🔥 HIGH PRIORITY ALERT'
              : '⏰ TASK REMINDER',
          title: task.title,
          subtitle: includeDesc
            ? task.description ||
              (isManualTrigger
                ? `แจ้งเตือนทันที (${remindLabel})`
                : `แจ้งเตือนล่วงหน้า (${remindLabel})`)
            : '',
          dateTime: `${formatTaskDateRangeLabel(task)} · ${task.time} น.`,
          date: task.date,
          endDate: task.endDate,
          time: task.time,
          categoryName,
          categoryColor: cat?.color || '#2563EB',
          priority: task.priority,
          priorityLabel: priorityLabelText,
          remindLabel,
          description: task.description,
          formatMode,
          includeGoogleCalendarButton:
            lineSettings.includeGoogleCalendarButton !== false,
          stats: summaryStats,
        },
      };

        setLineLogs((prev) => [...prev, newLog]);

        // Only mark lineNotified = true when triggered by the automatic scheduled reminder
        // (so a manual test click earlier in the day never prevents the scheduled time reminder from firing)
        if (!isManualTrigger) {
          const nowIso = new Date().toISOString();
          let updatedTasksList: Task[] = [];
          setTasks((prev) => {
            updatedTasksList = prev.map((t) =>
              t.id === task.id ? { ...t, lineNotified: true, updatedAt: nowIso } : t
            );
            return updatedTasksList;
          });
          const toPush =
            updatedTasksList.length > 0
              ? updatedTasksList
              : tasksRef.current.map((t) =>
                  t.id === task.id ? { ...t, lineNotified: true, updatedAt: nowIso } : t
                );
          pushCollaborativeWorkspace(toPush, categoriesRef.current, teamMembersRef.current);
        }

        if (deliveryChannel === 'line_messaging_api') {
          showNotice(
            'success',
            apiNotice || `ส่งการ์ดแจ้งเตือนงาน "${task.title}" พร้อมสรุปงานเข้าแอป LINE OA สำเร็จ!`
          );
        } else if (lineSettings.channelAccessToken.trim() && apiNotice) {
          showNotice('error', apiNotice);
        } else {
          showNotice(
            'success',
            `ส่งการ์ดแจ้งเตือนงาน "${task.title}" พร้อมสรุปงานเข้าห้องแชท LINE OA เรียบร้อยแล้ว`
          );
        }
      } finally {
        if (!isManualTrigger) {
          inFlightReminderIdsRef.current.delete(task.id);
        }
      }
    },
    [
      categories,
      lineSettings,
      pushCollaborativeWorkspace,
      sheetMeta?.spreadsheetId,
      showNotice,
      spreadsheetInput,
      workspaceId,
    ]
  );

  // Automatic Background Check for:
  // 1) Per-Task Reminders (แจ้งเตือนทีละงานตามเวลาที่กำหนด)
  // 2) Morning Daily Digest (แจ้งเตือนสรุปงานประจำวันตอนเช้าตามเวลา dailyDigestTime)
  // Evaluated strictly in Thailand Time (+07:00)
  useEffect(() => {
    if (!lineSettings.enabled) return;

    const checkDueTasksAndMorningDigest = () => {
      const now = new Date();
      const currentBangkokYMD = formatLocalDateYMD(now);
      const currentBangkokHM = formatLocalTimeHM(now);

      // 1. Check Morning Daily Digest (แจ้งเตือนสรุปตอนเช้า)
      if (
        lineSettings.dailyDigestEnabled !== false &&
        /^\d{1,2}:\d{2}$/.test((lineSettings.dailyDigestTime || '').trim())
      ) {
        const digestHM = lineSettings.dailyDigestTime.trim().padStart(5, '0');
        const digestDateTime = new Date(`${currentBangkokYMD}T${digestHM}:00+07:00`);
        if (!isNaN(digestDateTime.getTime())) {
          const minutesSinceDigestTime =
            (now.getTime() - digestDateTime.getTime()) / (1000 * 60);
          // Fire within [0 .. 15] minutes after configured morning digest time, once per day
          if (minutesSinceDigestTime >= 0 && minutesSinceDigestTime <= 15) {
            let lastSentDate = '';
            try {
              lastSentDate =
                localStorage.getItem('sheetcal_last_morning_digest_date') || '';
            } catch {
              lastSentDate = '';
            }
            if (lastSentDate !== currentBangkokYMD) {
              const parsedDigest = parseLineChatMessage(
                'สรุปงานวันนี้',
                tasks,
                categories,
                lineSettings.defaultRemindMinutes,
                teamMembers
              );
              const digestItems = parsedDigest.flexSummary?.digestItems || [];
              try {
                localStorage.setItem(
                  'sheetcal_last_morning_digest_date',
                  currentBangkokYMD
                );
              } catch {
                // Ignore
              }
              if (digestItems.length > 0) {
                const calendarDeepLinkUrl = resolveTeamCalendarAppUrl({
                  customPublicUrl: lineSettings.publicCalendarUrl,
                  workspaceId,
                  spreadsheetId: sheetMeta?.spreadsheetId || spreadsheetInput,
                  date: currentBangkokYMD,
                });
                (async () => {
                let sentViaServer = false;
                if (lineSettings.channelAccessToken.trim()) {
                  try {
                    const res = await fetch('/api/line/push', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        channelAccessToken: lineSettings.channelAccessToken,
                        to: lineSettings.targetUserId,
                        targetGroupId: (lineSettings.targetGroupId || '').trim(),
                        teamNotificationMode: lineSettings.teamNotificationMode || 'both',
                        text: parsedDigest.replyText,
                        date: currentBangkokYMD,
                        dateTime: `${currentBangkokYMD} · สรุปตอนเช้า ${currentBangkokHM} น.`,
                        tasksList: digestItems,
                        originUrl: calendarDeepLinkUrl,
                        isMorningDigest: true,
                      }),
                    });
                    if (res.ok) {
                      sentViaServer = true;
                    }
                  } catch {
                    sentViaServer = false;
                  }

                  if (!sentViaServer) {
                    const savedGasUrl = getEffectiveGasUrl();
                    if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
                      fetch(savedGasUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({
                          action: 'push_line',
                          channelAccessToken: lineSettings.channelAccessToken.trim(),
                          to: lineSettings.targetUserId.trim(),
                          targetGroupId: (lineSettings.targetGroupId || '').trim(),
                          teamNotificationMode: lineSettings.teamNotificationMode || 'both',
                          text: parsedDigest.replyText,
                          date: currentBangkokYMD,
                          dateTime: `${currentBangkokYMD} · สรุปตอนเช้า ${currentBangkokHM} น.`,
                          tasksList: digestItems,
                          messageFormat: lineSettings.messageFormat || 'executive_flex',
                          originUrl: calendarDeepLinkUrl,
                        }),
                      }).catch(() => {});
                    }
                  }
                }

                const morningLog: LineMessageLog = {
                  id: `log-morning-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  direction: 'auto_reminder',
                  text: parsedDigest.replyText,
                  deliveryChannel: lineSettings.channelAccessToken.trim()
                    ? 'line_messaging_api'
                    : 'simulator',
                  status: lineSettings.channelAccessToken.trim()
                    ? 'delivered'
                    : 'simulated',
                  flexSummary: parsedDigest.flexSummary,
                };
                setLineLogs((prev) => [...prev, morningLog]);
                showNotice(
                  'success',
                  `☀️ ส่งการ์ดสรุปตารางงานประจำวันตอนเช้า (${digestHM} น.) เข้า LINE OA อัตโนมัติเรียบร้อยแล้ว!`,
                  currentBangkokYMD
                );
              })();
              }
            }
          }
        }
      }

      // 2. Check Per-Task Reminders (แจ้งเตือนทีละงานตามเวลาที่กำหนดให้ครบทุกงานในวันนั้น ๆ)
      const resetNotifiedTaskIds: string[] = [];
      const sortedTasksForCheck = [...tasks].sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
      );

      for (const task of sortedTasksForCheck) {
        if (task.status === TaskStatus.COMPLETED) {
          continue;
        }
        if (!doesTaskTriggerNotification(task, lineSettings).allowed) {
          continue;
        }

        const taskRemindMins =
          typeof task.remindMinutesBefore === 'number'
            ? task.remindMinutesBefore
            : lineSettings.defaultRemindMinutes ?? 1;
        // 0 = ปิดการแจ้งเตือนอัตโนมัติสำหรับงานนี้
        if (taskRemindMins <= 0) {
          continue;
        }

        const cleanTime = /^\d{1,2}:\d{2}$/.test((task.time || '').trim())
          ? task.time.trim().padStart(5, '0')
          : '09:00';
        // Support both single-day and multi-day tasks active on currentBangkokYMD
        const effectiveDate = isTaskActiveOnDate(task, currentBangkokYMD)
          ? currentBangkokYMD
          : task.date;
        const taskDateTime = new Date(`${effectiveDate}T${cleanTime}:00+07:00`);
        if (isNaN(taskDateTime.getTime())) continue;

        const diffMinutes = (taskDateTime.getTime() - now.getTime()) / (1000 * 60);

        // If lineNotified was set prematurely while the scheduled reminder window is still in the future
        // (e.g. task time was edited to a later time, or it is a new day of a multi-day task),
        // reset lineNotified = false so the task is guaranteed to notify when its time arrives.
        const updatedDateBangkok = task.updatedAt
          ? formatLocalDateYMD(new Date(task.updatedAt))
          : '';
        const isMultiDayNewDay =
          Boolean(task.endDate && task.endDate > task.date) &&
          Boolean(updatedDateBangkok && updatedDateBangkok < currentBangkokYMD);

        if (task.lineNotified && (diffMinutes > taskRemindMins + 1 || isMultiDayNewDay)) {
          resetNotifiedTaskIds.push(task.id);
          continue;
        }

        if (task.lineNotified || inFlightReminderIdsRef.current.has(task.id)) {
          continue;
        }

        // Notify strictly within the task's configured reminder window [0..taskRemindMins] before start
        // (with at most 1 minute grace [-1..0] for clock alignment — never fire late e.g. at 15:24 for a 15:00 task!)
        if (diffMinutes <= taskRemindMins && diffMinutes >= -1) {
          dispatchLineReminder(task, false);
        } else if (
          lineSettings.notifyOnOverdue === true &&
          diffMinutes < -1 &&
          diffMinutes >= -15
        ) {
          dispatchLineReminder(task, false);
        }
      }

      if (resetNotifiedTaskIds.length > 0) {
        const resetSet = new Set(resetNotifiedTaskIds);
        const nowIso = new Date().toISOString();
        setTasks((prev) => {
          const next = prev.map((t) =>
            resetSet.has(t.id) ? { ...t, lineNotified: false, updatedAt: nowIso } : t
          );
          pushCollaborativeWorkspace(next, categoriesRef.current, teamMembersRef.current);
          return next;
        });
      }
    };

    checkDueTasksAndMorningDigest();
    const timer = setInterval(checkDueTasksAndMorningDigest, 10000);

    // Also run an un-throttled Web Worker ticker so background browser tabs still fire at the exact scheduled minute
    let worker: Worker | null = null;
    let workerUrl = '';
    try {
      const blob = new Blob(
        [
          'setInterval(function(){ postMessage("tick"); }, 10000);',
        ],
        { type: 'application/javascript' }
      );
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = () => {
        checkDueTasksAndMorningDigest();
      };
    } catch {
      // Fallback to standard setInterval
    }

    return () => {
      clearInterval(timer);
      if (worker) {
        worker.terminate();
      }
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
    };
  }, [
    categories,
    dispatchLineReminder,
    lineSettings,
    sheetMeta?.spreadsheetId,
    showNotice,
    spreadsheetInput,
    tasks,
    teamMembers,
    workspaceId,
  ]);

  // Delete Task (Always requires explicit confirmation)
  const handleDeleteTask = useCallback(
    (task: Task) => {
      setConfirmDialog({
        isOpen: true,
        title: 'ยืนยันการลบรายการงานนี้ออกจากระบบและ Google Sheets?',
        description:
          'เมื่อลบแล้ว รายการงานนี้จะถูกนำออกจากปฏิทินของทีมและลบออกจากแท็บ Tasks ใน Google Sheets ของคุณ',
        affectedItemSummary: `ลบงาน: "${task.title}" (กำหนดวันที่ ${formatTaskDateRangeLabel(task)} เวลา ${task.time} น.)`,
        confirmLabel: 'ลบรายการงาน',
        isDestructive: true,
        onConfirm: async () => {
          recordDeletedTaskIds([task.id]);
          const nextTasks = tasks.filter((t) => t.id !== task.id);
          setTasks(nextTasks);
          if (sheetMeta && accessToken) {
            await syncAllToConnectedSheet(
              nextTasks,
              categories,
              lineLogs,
              `ลบงาน "${task.title}" ออกจาก Google Sheets เรียบร้อยแล้ว`,
              undefined,
              task.id,
              teamMembers
            );
          } else {
            await pushCollaborativeWorkspace(nextTasks, categories, teamMembers, task.id);
            showNotice('info', `ลบงาน "${task.title}" ออกจากตารางงานแล้ว`);
          }
          closeConfirmDialog();
        },
      });
    },
    [
      accessToken,
      categories,
      lineLogs,
      pushCollaborativeWorkspace,
      recordDeletedTaskIds,
      sheetMeta,
      showNotice,
      syncAllToConnectedSheet,
      tasks,
      teamMembers,
    ]
  );

  // Bulk Delete All Completed Tasks at Once (Always requires explicit confirmation)
  const handleDeleteCompletedTasks = useCallback(() => {
    const completedTasks = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
    if (completedTasks.length === 0) {
      showNotice('info', 'ยังไม่มีรายการงานที่ทำเสร็จแล้วสำหรับลบ');
      return;
    }

    const previewTitles = completedTasks
      .slice(0, 4)
      .map((t) => `"${t.title}"`)
      .join(', ');
    const moreSuffix =
      completedTasks.length > 4 ? ` และอีก ${completedTasks.length - 4} งาน` : '';

    setConfirmDialog({
      isOpen: true,
      title: `ยืนยันการลบงานที่ทำเสร็จแล้วทั้งหมด (${completedTasks.length} งาน) ในครั้งเดียว?`,
      description:
        'ระบบจะลบเฉพาะงานที่มีสถานะ "เสร็จแล้ว" ทั้งหมดออกจากปฏิทินของทีมและฐานข้อมูล Google Sheets ทันที (งานที่ยังค้างอยู่จะไม่ถูกลบ)',
      affectedItemSummary: `ลบงานที่ทำเสร็จแล้วรวม ${completedTasks.length} รายการ: ${previewTitles}${moreSuffix}`,
      confirmLabel: `ลบงานที่เสร็จแล้วทั้งหมด (${completedTasks.length} งาน)`,
      isDestructive: true,
      onConfirm: async () => {
        const completedIds = completedTasks.map((t) => t.id);
        recordDeletedTaskIds(completedIds);
        const nextTasks = tasks.filter((t) => t.status !== TaskStatus.COMPLETED);
        setTasks(nextTasks);
        if (sheetMeta && accessToken) {
          await syncAllToConnectedSheet(
            nextTasks,
            categories,
            lineLogs,
            `ลบงานที่ทำเสร็จแล้วทั้งหมด ${completedTasks.length} รายการ ออกจากระบบและ Google Sheets เรียบร้อยแล้ว`,
            undefined,
            completedIds,
            teamMembers
          );
        } else {
          await pushCollaborativeWorkspace(
            nextTasks,
            categories,
            teamMembers,
            completedIds
          );
          showNotice(
            'success',
            `ลบงานที่ทำเสร็จแล้วทั้งหมด ${completedTasks.length} รายการ เรียบร้อยแล้ว`
          );
        }
        closeConfirmDialog();
      },
    });
  }, [
    accessToken,
    categories,
    lineLogs,
    pushCollaborativeWorkspace,
    recordDeletedTaskIds,
    sheetMeta,
    showNotice,
    syncAllToConnectedSheet,
    tasks,
    teamMembers,
  ]);

  // Process Natural Language LINE Chat Command (from in-app LINE chat, quick bar, or real LINE Webhook)
  const handleSendLineChatCommand = useCallback(
    (rawText: string) => {
      const incomingLog: LineMessageLog = {
        id: `log-in-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: new Date().toISOString(),
        direction: 'incoming_command',
        text: rawText,
        deliveryChannel: 'simulator',
        status: 'delivered',
      };

      const parsed = parseLineChatMessage(
        rawText,
        tasks,
        categories,
        lineSettings.defaultRemindMinutes,
        teamMembers
      );

      const outgoingLog: LineMessageLog = {
        id: `log-out-${Date.now() + 1}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: new Date().toISOString(),
        direction: 'outgoing_reply',
        text: parsed.replyText,
        taskTitle: parsed.createdTask?.title || parsed.targetTaskTitle,
        deliveryChannel: 'simulator',
        status: 'delivered',
        flexSummary: parsed.flexSummary,
      };

      const nextLogs = [...lineLogs, incomingLog, outgoingLog];

      if (parsed.action === 'add_task' && parsed.createdTask) {
        const created = parsed.createdTask;
        const nextTasks = [created, ...tasks];
        setTasks(nextTasks);
        setLineLogs(nextLogs);
        setSelectedCalendarDate(created.date);
        setTaskFilter('all');
        setCategoryFilter('all');
        setSearchQuery('');

        if (sheetMeta && accessToken && lineSettings.autoSyncOnLineCommand) {
          syncAllToConnectedSheet(
            nextTasks,
            categories,
            nextLogs,
            `บันทึกงาน "${created.title}"${
              created.assigneeName ? ` (มอบหมายให้ ${created.assigneeName})` : ''
            } ลงปฏิทินและ Google Sheets เรียบร้อยแล้ว!`,
            created.date,
            undefined,
            teamMembers
          );
        } else {
          pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
          showNotice(
            'success',
            `บันทึกงาน "${created.title}"${
              created.assigneeName ? ` (มอบหมายให้ ${created.assigneeName})` : ''
            } (วันที่ ${formatTaskDateRangeLabel(created)} เวลา ${created.time} น.) ลงปฏิทินเรียบร้อยแล้ว!`,
            created.date
          );
        }
        return;
      }

      if (parsed.action === 'complete_task' && parsed.targetTaskId) {
        const targetId = parsed.targetTaskId;
        const nextTasks = tasks.map((t) =>
          t.id === targetId
            ? { ...t, status: TaskStatus.COMPLETED, updatedAt: new Date().toISOString() }
            : t
        );
        setTasks(nextTasks);
        setLineLogs(nextLogs);
        if (sheetMeta && accessToken) {
          syncAllToConnectedSheet(
            nextTasks,
            categories,
            nextLogs,
            `อัปเดตสถานะงาน "${parsed.targetTaskTitle}" เป็นเสร็จสิ้นลงปฏิทินและ Google Sheets แล้ว`,
            undefined,
            undefined,
            teamMembers
          );
        } else {
          pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
          showNotice(
            'success',
            `อัปเดตสถานะงาน "${parsed.targetTaskTitle}" เป็นเสร็จสิ้นเรียบร้อยแล้ว`
          );
        }
        return;
      }

      if (parsed.action === 'delete_task' && parsed.targetTaskId) {
        const targetTask = tasks.find((t) => t.id === parsed.targetTaskId);
        if (targetTask) {
          setLineLogs(nextLogs);
          handleDeleteTask(targetTask);
          return;
        }
      }

      if (
        (parsed.action === 'query_today' || parsed.action === 'query_pending') &&
        lineSettings.enabled &&
        lineSettings.channelAccessToken.trim()
      ) {
        const summaryDate = parsed.flexSummary?.date || formatLocalDateYMD();
        const summaryDigestItems = parsed.flexSummary?.digestItems || [];
        const calendarDeepLinkUrl = resolveTeamCalendarAppUrl({
          customPublicUrl: lineSettings.publicCalendarUrl,
          workspaceId,
          spreadsheetId: sheetMeta?.spreadsheetId || spreadsheetInput,
          date: summaryDate,
        });
        (async () => {
          let handled = false;
          try {
            const res = await fetch('/api/line/push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channelAccessToken: lineSettings.channelAccessToken.trim(),
                to: lineSettings.targetUserId.trim(),
                targetGroupId: (lineSettings.targetGroupId || '').trim(),
                teamNotificationMode: lineSettings.teamNotificationMode || 'both',
                text: parsed.replyText,
                date: summaryDate,
                dateTime: parsed.flexSummary?.dateTime || summaryDate,
                tasksList: summaryDigestItems,
                originUrl: calendarDeepLinkUrl,
              }),
            });
            const ct = res.headers.get('content-type') || '';
            if (res.ok && ct.includes('application/json')) {
              handled = true;
            }
          } catch {
            handled = false;
          }
          if (!handled) {
            const savedGasUrl = getEffectiveGasUrl();
            if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
              try {
                await fetch(savedGasUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                  body: JSON.stringify({
                    action: 'push_line',
                    channelAccessToken: lineSettings.channelAccessToken.trim(),
                    to: lineSettings.targetUserId.trim(),
                    targetGroupId: (lineSettings.targetGroupId || '').trim(),
                    teamNotificationMode: lineSettings.teamNotificationMode || 'both',
                    text: parsed.replyText,
                    date: summaryDate,
                    dateTime: parsed.flexSummary?.dateTime || summaryDate,
                    tasksList: summaryDigestItems,
                    messageFormat: lineSettings.messageFormat || 'executive_flex',
                    originUrl: calendarDeepLinkUrl,
                  }),
                });
              } catch {
                // Ignore background error
              }
            }
          }
        })();
      }

      setLineLogs(nextLogs);
    },
    [
      accessToken,
      categories,
      handleDeleteTask,
      lineLogs,
      lineSettings.autoSyncOnLineCommand,
      lineSettings.channelAccessToken,
      lineSettings.defaultRemindMinutes,
      lineSettings.enabled,
      lineSettings.messageFormat,
      lineSettings.publicCalendarUrl,
      lineSettings.targetGroupId,
      lineSettings.targetUserId,
      lineSettings.teamNotificationMode,
      pushCollaborativeWorkspace,
      sheetMeta,
      showNotice,
      spreadsheetInput,
      syncAllToConnectedSheet,
      tasks,
      teamMembers,
      workspaceId,
    ]
  );

  // Helper to manually or automatically detect LINE Group ID (C... / R...) from backend webhook or Google Apps Script Bridge
  const handleDetectLineGroupId = useCallback(async (): Promise<string | null> => {
    let foundGroup = '';
    try {
      const res = await fetch('/api/line/webhook-events');
      if (res.ok) {
        const data = await res.json();
        if (
          typeof data.detectedGroupId === 'string' &&
          /^[CR][0-9a-fA-F]{32}$/.test(data.detectedGroupId.trim())
        ) {
          foundGroup = data.detectedGroupId.trim();
        }
      }
    } catch {
      // Ignore
    }

    if (!foundGroup) {
      const savedGasUrl = getEffectiveGasUrl();
      if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
        try {
          const gasRes = await fetch(savedGasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'check_bridge' }),
          });
          if (gasRes.ok) {
            const gasData = await gasRes.json();
            if (
              typeof gasData.detectedGroupId === 'string' &&
              /^[CR][0-9a-fA-F]{32}$/.test(gasData.detectedGroupId.trim())
            ) {
              foundGroup = gasData.detectedGroupId.trim();
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    if (foundGroup) {
      setLineSettings((prev) => ({
        ...prev,
        targetGroupId: foundGroup,
      }));
      showNotice(
        'success',
        `ดึงรหัสห้องแชทกลุ่ม LINE (${foundGroup.slice(0, 10)}...) สำเร็จแล้ว! พร้อมส่งแจ้งเตือนเข้ากลุ่มทันที`
      );
      return foundGroup;
    }
    return null;
  }, [showNotice]);

  // Poll real LINE Webhook events from /api/line/webhook-events every 4 seconds
  useEffect(() => {
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/line/webhook-events');
        if (!res.ok) return;
        const data = await res.json();
        if (
          typeof data.detectedGroupId === 'string' &&
          /^[CR][0-9a-fA-F]{32}$/.test(data.detectedGroupId.trim()) &&
          !lineSettings.targetGroupId
        ) {
          setLineSettings((prev) => ({
            ...prev,
            targetGroupId: data.detectedGroupId.trim(),
          }));
        }
        if (data.detectedUserId && !lineSettings.targetUserId) {
          setLineSettings((prev) => ({
            ...prev,
            targetUserId: data.detectedUserId,
          }));
        }
        if (Array.isArray(data.events) && data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.senderId && /^[CR][0-9a-fA-F]{32}$/.test(ev.senderId)) {
              setLineSettings((prev) =>
                prev.targetGroupId ? prev : { ...prev, targetGroupId: ev.senderId }
              );
            }
            if (ev.text) {
              handleSendLineChatCommand(ev.text);
            }
          }
        }
      } catch {
        // Ignore transient network poll error
      }
    }, 4000);

    return () => clearInterval(pollTimer);
  }, [handleSendLineChatCommand, lineSettings.targetGroupId, lineSettings.targetUserId]);

  // Unified Zero-Login Auto-Pull via Server Collaborative Workspace OR Google Apps Script Bridge (works on both Cloud Run & GitHub Pages without competing timers!)
  const pullLatestTeamCalendar = useCallback(
    async (showFeedback = false) => {
      if (showFeedback) setIsSyncing(true);
      try {
        // 0. First try Collaborative Workspace endpoint if running on Full-Stack Server
        let workspaceHandled = false;
        let wsTaskCount = 0;
        try {
          const wsRes = await fetch(
            `/api/collab/workspace/${encodeURIComponent(workspaceId)}`
          );
          const wsCt = wsRes.headers.get('content-type') || '';
          if (wsRes.ok && wsCt.includes('application/json')) {
            const wsData = await wsRes.json();
            if (wsData.exists && wsData.workspace) {
              if (wsData.workspace.updatedAt) {
                lastSyncedTimestampRef.current = wsData.workspace.updatedAt;
                setLastCollabSyncAt(wsData.workspace.updatedAt);
              }
              if (
                Array.isArray(wsData.deletedTaskIds) &&
                wsData.deletedTaskIds.length > 0
              ) {
                recordDeletedTaskIds(wsData.deletedTaskIds);
              }
              let cleanWsTasks: Task[] = [];
              if (Array.isArray(wsData.workspace.tasks)) {
                const delSet = new Set<string>([
                  ...(Array.isArray(wsData.deletedTaskIds) ? wsData.deletedTaskIds : []),
                  ...Array.from(deletedTaskIdsRef.current),
                ]);
                const decodedWs = extractGasMetadataFromTasks(
                  wsData.workspace.tasks as Task[]
                );
                cleanWsTasks = decodedWs.tasks.filter(
                  (t) => !isTaskPurgedOrDeleted(t, delSet)
                );
                wsTaskCount = cleanWsTasks.length;
                if (
                  showFeedback ||
                  Date.now() - lastLocalMutationMsRef.current > 12000
                ) {
                  setTasks((prev) =>
                    areTaskListsEqual(prev, cleanWsTasks) ? prev : cleanWsTasks
                  );
                  workspaceHandled = true;
                }
              }
              const wsCats = Array.isArray(wsData.workspace.categories)
                ? (wsData.workspace.categories as Category[])
                : [];
              if (
                !isDefaultCategoryList(categoriesRef.current) &&
                isDefaultCategoryList(wsCats)
              ) {
                pushCollaborativeWorkspace(
                  cleanWsTasks.length > 0 ? cleanWsTasks : tasksRef.current,
                  categoriesRef.current,
                  teamMembersRef.current
                );
              } else if (
                wsCats.length > 0 &&
                (showFeedback || Date.now() - lastLocalMutationMsRef.current > 12000)
              ) {
                setCategories((prev) =>
                  JSON.stringify(prev) === JSON.stringify(wsCats) ? prev : wsCats
                );
              }
              if (
                Array.isArray(wsData.workspace.teamMembers) &&
                wsData.workspace.teamMembers.length > 0 &&
                (showFeedback || Date.now() - lastLocalMutationMsRef.current > 12000)
              ) {
                const wsMembers = wsData.workspace.teamMembers as TeamMember[];
                setTeamMembers((prev) =>
                  JSON.stringify(prev) === JSON.stringify(wsMembers) ? prev : wsMembers
                );
              }
            }
          }
        } catch {
          // Static host fallback
        }

        // Only pull from GAS Bridge directly if the full-stack Collaborative Workspace did not handle it (e.g. on GitHub Pages) or had 0 tasks
        if (!workspaceHandled || wsTaskCount === 0 || showFeedback) {
          const activeGasUrl = getEffectiveGasUrl();
          let data: {
            gasUrl?: string;
            detectedGroupId?: string;
            tasks?: Task[];
            categories?: Category[];
            teamMembers?: TeamMember[];
            deletedTaskIds?: string[];
          } | null = null;

          // 1. Try full-stack Server Proxy first
          try {
            const res = await fetch('/api/line/gas-bridge-sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: 'pull',
                gasUrl: activeGasUrl,
              }),
            });
            const ct = res.headers.get('content-type') || '';
            if (res.ok && ct.includes('application/json')) {
              data = await res.json();
            }
          } catch {
            data = null;
          }

          // 2. Fallback for static hosting (e.g. GitHub Pages https://naiadminna.github.io/Lakha/)
          if (!data && activeGasUrl.startsWith('https://script.google.com/macros/s/')) {
            try {
              const directRes = await fetch(activeGasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'check_bridge' }),
              });
              if (directRes.ok) {
                const directJson = await directRes.json();
                data = {
                  gasUrl: activeGasUrl,
                  detectedGroupId: directJson.detectedGroupId,
                  tasks: Array.isArray(directJson.tasks) ? directJson.tasks : [],
                  categories: Array.isArray(directJson.categories)
                    ? directJson.categories
                    : undefined,
                  teamMembers: Array.isArray(directJson.teamMembers)
                    ? directJson.teamMembers
                    : undefined,
                };
              }
            } catch {
              try {
                const getRes = await fetch(
                  `${activeGasUrl}?action=get_tasks&format=json`
                );
                if (getRes.ok) {
                  const getJson = await getRes.json();
                  data = {
                    gasUrl: activeGasUrl,
                    detectedGroupId: getJson.detectedGroupId,
                    tasks: Array.isArray(getJson.tasks) ? getJson.tasks : [],
                    categories: Array.isArray(getJson.categories)
                      ? getJson.categories
                      : undefined,
                    teamMembers: Array.isArray(getJson.teamMembers)
                      ? getJson.teamMembers
                      : undefined,
                  };
                }
              } catch {
                data = null;
              }
            }
          }

          if (data) {
            if (Array.isArray(data.deletedTaskIds) && data.deletedTaskIds.length > 0) {
              recordDeletedTaskIds(data.deletedTaskIds);
            }

            if (
              typeof data.detectedGroupId === 'string' &&
              /^[CR][0-9a-fA-F]{32}$/.test(data.detectedGroupId.trim())
            ) {
              const detectedGrp = data.detectedGroupId.trim();
              setLineSettings((prev) =>
                prev.targetGroupId ? prev : { ...prev, targetGroupId: detectedGrp }
              );
            }

            const decodedGas = Array.isArray(data.tasks)
              ? extractGasMetadataFromTasks(data.tasks as Task[])
              : { tasks: [] as Task[] };

            const remoteGasCats =
              Array.isArray(data.categories) && data.categories.length > 0
                ? data.categories
                : decodedGas.categories;
            const remoteGasMembers =
              Array.isArray(data.teamMembers) && data.teamMembers.length > 0
                ? data.teamMembers
                : decodedGas.teamMembers;

            if (
              Array.isArray(remoteGasCats) &&
              remoteGasCats.length > 0 &&
              (showFeedback || Date.now() - lastLocalMutationMsRef.current > 12000)
            ) {
              setCategories((prev) =>
                JSON.stringify(prev) === JSON.stringify(remoteGasCats)
                  ? prev
                  : remoteGasCats
              );
            }

            if (
              Array.isArray(remoteGasMembers) &&
              remoteGasMembers.length > 0 &&
              (showFeedback || Date.now() - lastLocalMutationMsRef.current > 12000)
            ) {
              setTeamMembers((prev) =>
                JSON.stringify(prev) === JSON.stringify(remoteGasMembers)
                  ? prev
                  : remoteGasMembers
              );
            }

            if (
              !workspaceHandled &&
              Array.isArray(data.tasks) &&
              (showFeedback || Date.now() - lastLocalMutationMsRef.current > 12000)
            ) {
              setTasks((prev) => {
                const prevById = new Map<string, Task>(prev.map((p) => [p.id, p]));
                const nextRemoteTasks: Task[] = [];
                for (const rt of decodedGas.tasks) {
                  if (!rt || !rt.id || !rt.title || !rt.date) continue;
                  if (isTaskPurgedOrDeleted(rt)) continue;
                  const existing = prevById.get(rt.id);
                  let inferredEndDate = rt.endDate ?? existing?.endDate;
                  const descText = rt.description ?? existing?.description ?? '';
                  if (!inferredEndDate && descText) {
                    const durMatch = descText.match(/(\d{1,2})\s*วัน/);
                    if (durMatch) {
                      const days = parseInt(durMatch[1], 10);
                      if (days >= 2 && days <= 60) {
                        const [y, m, d] = rt.date.split('-').map(Number);
                        const dt = new Date(y, m - 1, d + (days - 1));
                        const ey = dt.getFullYear();
                        const em = String(dt.getMonth() + 1).padStart(2, '0');
                        const ed = String(dt.getDate()).padStart(2, '0');
                        inferredEndDate = `${ey}-${em}-${ed}`;
                      }
                    }
                  }
                  nextRemoteTasks.push({
                    id: rt.id,
                    title: rt.title,
                    description: descText,
                    date: rt.date,
                    endDate: inferredEndDate,
                    time: rt.time || existing?.time || '09:00',
                    categoryId: rt.categoryId || existing?.categoryId || 'cat-work',
                    priority:
                      (rt.priority as TaskPriority) ||
                      existing?.priority ||
                      TaskPriority.MEDIUM,
                    status:
                      (rt.status as TaskStatus) ||
                      existing?.status ||
                      TaskStatus.PENDING,
                    remindMinutesBefore:
                      typeof rt.remindMinutesBefore === 'number'
                        ? rt.remindMinutesBefore
                        : existing?.remindMinutesBefore ?? 1,
                    lineNotified: rt.lineNotified ?? existing?.lineNotified ?? false,
                    source: rt.source || existing?.source || 'web',
                    updatedAt:
                      rt.updatedAt || existing?.updatedAt || new Date().toISOString(),
                    assigneeId: rt.assigneeId ?? existing?.assigneeId,
                    assigneeName: rt.assigneeName ?? existing?.assigneeName,
                  });
                }

                return areTaskListsEqual(prev, nextRemoteTasks) ? prev : nextRemoteTasks;
              });
            }
          }
        }

        if (showFeedback) {
          showNotice(
            'success',
            'ดึงตารางงานและหมวดหมู่สีล่าสุดจากปฏิทินกลางของแอดมินและทีมเรียบร้อยแล้ว!'
          );
        }
      } catch {
        if (showFeedback) {
          showNotice(
            'error',
            'ไม่สามารถดึงตารางงานล่าสุดได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
          );
        }
      } finally {
        if (showFeedback) setIsSyncing(false);
      }
    },
    [
      areTaskListsEqual,
      extractGasMetadataFromTasks,
      isDefaultCategoryList,
      isTaskPurgedOrDeleted,
      pushCollaborativeWorkspace,
      recordDeletedTaskIds,
      showNotice,
      workspaceId,
    ]
  );

  useEffect(() => {
    pullLatestTeamCalendar(false);
    const gasTimer = setInterval(() => pullLatestTeamCalendar(false), 5000);
    return () => clearInterval(gasTimer);
  }, [pullLatestTeamCalendar]);

  // When Admin signs in with Google OAuth, automatically clean up any stale deleted rows in Google Sheets so deleted tasks never resurrect
  const hasCleanedConnectedSheetRef = useRef<boolean>(false);
  useEffect(() => {
    if (!sheetMeta?.spreadsheetId || !accessToken) {
      hasCleanedConnectedSheetRef.current = false;
      return;
    }
    if (hasCleanedConnectedSheetRef.current) return;
    hasCleanedConnectedSheetRef.current = true;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || !sheetMeta?.spreadsheetId) return;
        const cleanTasks = tasksRef.current.filter((t) => !isTaskPurgedOrDeleted(t));
        await writeDatabaseToSheet(
          token,
          sheetMeta.spreadsheetId,
          cleanTasks,
          categoriesRef.current,
          lineLogs,
          teamMembersRef.current
        );
      } catch {
        // Silent background cleanup
      }
    })();
  }, [accessToken, isTaskPurgedOrDeleted, lineLogs, sheetMeta?.spreadsheetId]);

  // Save (Create or Edit) Task
  const handleSaveTask = (
    taskData: Omit<Task, 'id' | 'updatedAt' | 'lineNotified'>,
    existingId?: string
  ) => {
    if (existingId) {
      const target = tasks.find((t) => t.id === existingId);
      const scheduleChanged =
        !target ||
        target.date !== taskData.date ||
        (target.endDate || '') !== (taskData.endDate || '') ||
        target.time !== taskData.time ||
        target.remindMinutesBefore !== taskData.remindMinutesBefore ||
        target.status !== taskData.status;
      const updatedTask: Task = {
        ...taskData,
        id: existingId,
        lineNotified: scheduleChanged ? false : target?.lineNotified || false,
        updatedAt: new Date().toISOString(),
      };
      const nextTasks = tasks.map((t) => (t.id === existingId ? updatedTask : t));

      if (sheetMeta && accessToken) {
        setConfirmDialog({
          isOpen: true,
          title: 'ยืนยันการแก้ไขข้อมูลงานใน Google Sheets?',
          description:
            'การแก้ไขรายละเอียดงานนี้จะทำการอัปเดตข้อมูลแถวงานในแท็บ Tasks บนไฟล์ Google Sheets ของคุณ',
          affectedItemSummary: `แก้ไขงาน: "${updatedTask.title}" (วันที่ ${formatTaskDateRangeLabel(updatedTask)} เวลา ${updatedTask.time} น.)`,
          confirmLabel: 'ยืนยันการแก้ไข',
          isDestructive: false,
          onConfirm: async () => {
            setTasks(nextTasks);
            await syncAllToConnectedSheet(
              nextTasks,
              categories,
              lineLogs,
              `แก้ไขงาน "${updatedTask.title}" และอัปเดตลง Google Sheets เรียบร้อยแล้ว`,
              updatedTask.date,
              undefined,
              teamMembers
            );
            closeConfirmDialog();
          },
        });
      } else {
        setTasks(nextTasks);
        pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
        showNotice(
          'success',
          `บันทึกการแก้ไขงาน "${updatedTask.title}" เรียบร้อยแล้ว`,
          updatedTask.date
        );
      }
    } else {
      const newTask: Task = {
        ...taskData,
        id: `task-${Date.now()}`,
        lineNotified: false,
        updatedAt: new Date().toISOString(),
      };
      const nextTasks = [newTask, ...tasks];
      setTasks(nextTasks);
      setSelectedCalendarDate(newTask.date);
      if (sheetMeta && accessToken) {
        syncAllToConnectedSheet(
          nextTasks,
          categories,
          lineLogs,
          `เพิ่มงาน "${newTask.title}" ลงปฏิทินและบันทึกเข้า Google Sheets เรียบร้อยแล้ว`,
          newTask.date,
          undefined,
          teamMembers
        );
      } else {
        pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
        showNotice(
          'success',
          `เพิ่มงาน "${newTask.title}" ลงปฏิทินเรียบร้อยแล้ว`,
          newTask.date
        );
      }
    }
  };

  // Toggle Task Completion Status
  const handleToggleTaskStatus = (task: Task) => {
    const nextStatus =
      task.status === TaskStatus.COMPLETED ? TaskStatus.PENDING : TaskStatus.COMPLETED;
    handleUpdateTaskStatus(task, nextStatus);
  };

  // Update Task Status (Pending / In Progress / Completed)
  const handleUpdateTaskStatus = (task: Task, nextStatus: TaskStatus) => {
    const nextTasks = tasks.map((t) =>
      t.id === task.id
        ? { ...t, status: nextStatus, updatedAt: new Date().toISOString() }
        : t
    );

    setTasks(nextTasks);
    if (sheetMeta && accessToken) {
      syncAllToConnectedSheet(
        nextTasks,
        categories,
        lineLogs,
        `อัปเดตสถานะงาน "${task.title}" เป็น "${
          nextStatus === TaskStatus.COMPLETED
            ? 'เสร็จแล้ว'
            : nextStatus === TaskStatus.IN_PROGRESS
            ? 'กำลังทำ'
            : 'รอดำเนินการ'
        }" เรียบร้อยแล้ว`,
        undefined,
        undefined,
        teamMembers
      );
    } else {
      pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
      showNotice(
        'success',
        `อัปเดตสถานะงาน "${task.title}" เป็น "${
          nextStatus === TaskStatus.COMPLETED
            ? 'เสร็จแล้ว'
            : nextStatus === TaskStatus.IN_PROGRESS
            ? 'กำลังทำ'
            : 'รอดำเนินการ'
        }" เรียบร้อยแล้ว`
      );
    }
  };

  // Invite New Team Member
  const handleInviteMember = async (
    newMemberData: Omit<TeamMember, 'id' | 'invitedAt' | 'status'>
  ) => {
    const newMember: TeamMember = {
      ...newMemberData,
      id: `member-${Date.now()}`,
      invitedAt: new Date().toISOString(),
      status: 'active',
    };
    const nextMembers = [...teamMembers, newMember];
    setTeamMembers(nextMembers);

    const roleLabel =
      newMember.role === 'owner'
        ? 'เจ้าของร่วม (Owner)'
        : newMember.role === 'editor'
        ? 'แก้ไขตารางงานได้ (Editor)'
        : 'ดูอย่างเดียว (Viewer)';

    const summaryStats = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status !== TaskStatus.COMPLETED).length,
      completed: tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
    };

    const todayStr = formatLocalDateYMD(new Date());
    const nowTimeStr = new Date().toTimeString().slice(0, 5);

    const memberInviteText = [
      `👥 สมาชิกใหม่เข้าร่วมปฏิทินทีม`,
      `━━━━━━━━━━━━━━`,
      `👤 ชื่อสมาชิก: ${newMember.name}`,
      `📧 อีเมล: ${newMember.email}`,
      newMember.department ? `🏢 ฝ่าย/ทีม: ${newMember.department}` : null,
      `🔐 สิทธิ์การใช้งาน: ${roleLabel}`,
      `👨‍👩‍👧‍👦 สมาชิกในปฏิทินรวม: ${nextMembers.length} คน`,
      ``,
      `📊 สรุปตารางงาน: ทั้งหมด ${summaryStats.total} งาน · รอทำ ${summaryStats.pending} · เสร็จแล้ว ${summaryStats.completed}`,
    ]
      .filter(Boolean)
      .join('\n');

    let deliveryChannel: LineMessageLog['deliveryChannel'] = 'simulator';
    let status: LineMessageLog['status'] = 'simulated';

    if (lineSettings.enabled && lineSettings.channelAccessToken.trim()) {
      const calendarDeepLinkUrl = resolveTeamCalendarAppUrl({
        customPublicUrl: lineSettings.publicCalendarUrl,
        workspaceId,
        spreadsheetId: sheetMeta?.spreadsheetId || spreadsheetInput,
        date: todayStr,
      });
      let handledByServer = false;
      try {
        const res = await fetch('/api/line/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelAccessToken: lineSettings.channelAccessToken.trim(),
            to: lineSettings.targetUserId.trim(),
            targetGroupId: (lineSettings.targetGroupId || '').trim(),
            teamNotificationMode: lineSettings.teamNotificationMode || 'both',
            text: memberInviteText,
            taskTitle: `สมาชิกใหม่: ${newMember.name} (${roleLabel})`,
            description: `${newMember.email}${newMember.department ? ` · ${newMember.department}` : ''} · สมาชิกรวม ${nextMembers.length} คน`,
            date: todayStr,
            time: nowTimeStr,
            dateTime: `${todayStr} ${nowTimeStr} น.`,
            categoryName: 'ปฏิทินทีมร่วมกัน',
            categoryColor: newMember.avatarColor || '#06C755',
            priority: TaskPriority.MEDIUM,
            stats: summaryStats,
            originUrl: calendarDeepLinkUrl,
            messageFormat: lineSettings.messageFormat || 'executive_flex',
            includeDescription: true,
            includeGoogleCalendarButton: false,
            includeOpenAppButton: true,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          handledByServer = true;
          const data = await res.json();
          if (data.ok) {
            deliveryChannel = 'line_messaging_api';
            status = 'delivered';
          }
        }
      } catch {
        handledByServer = false;
      }

      if (!handledByServer) {
        const savedGasUrl = getEffectiveGasUrl();
        if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
          const gasPayload = JSON.stringify({
            action: 'push_line',
            channelAccessToken: lineSettings.channelAccessToken.trim(),
            to: lineSettings.targetUserId.trim(),
            targetGroupId: (lineSettings.targetGroupId || '').trim(),
            teamNotificationMode: lineSettings.teamNotificationMode || 'both',
            text: memberInviteText,
            taskTitle: `สมาชิกใหม่: ${newMember.name} (${roleLabel})`,
            description: `${newMember.email}${newMember.department ? ` · ${newMember.department}` : ''} · สมาชิกรวม ${nextMembers.length} คน`,
            date: todayStr,
            time: nowTimeStr,
            dateTime: `${todayStr} ${nowTimeStr} น.`,
            categoryName: 'ปฏิทินทีมร่วมกัน',
            categoryColor: newMember.avatarColor || '#06C755',
            messageFormat: lineSettings.messageFormat || 'executive_flex',
            originUrl: calendarDeepLinkUrl,
          });
          try {
            const gasRes = await fetch(savedGasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: gasPayload,
            });
            const gasText = await gasRes.text();
            let gasData: Record<string, unknown> = {};
            try {
              gasData = JSON.parse(gasText);
            } catch {
              gasData = {};
            }
            if (gasData.mode === 'gas_push_line' && gasData.ok) {
              deliveryChannel = 'line_messaging_api';
              status = 'delivered';
            }
          } catch {
            // Fallback to simulated
          }
        }
      }
    }

    const inviteLog: LineMessageLog = {
      id: `log-member-${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: 'auto_reminder',
      text: memberInviteText,
      taskTitle: `สมาชิกใหม่: ${newMember.name}`,
      deliveryChannel,
      status,
      flexSummary: {
        badge: '👥 TEAM CALENDAR UPDATE',
        title: `สมาชิกใหม่: ${newMember.name}`,
        subtitle: `${newMember.email}${newMember.department ? ` · ${newMember.department}` : ''} (${roleLabel})`,
        dateTime: `${todayStr} · ${nowTimeStr} น.`,
        date: todayStr,
        time: nowTimeStr,
        categoryName: 'ปฏิทินทีมร่วมกัน',
        categoryColor: newMember.avatarColor || '#06C755',
        priorityLabel: `สมาชิกรวม ${nextMembers.length} คน`,
        remindLabel: 'แจ้งเตือนสมาชิกทีม',
        description: `${newMember.email} เข้าร่วมใช้งานปฏิทินทีม`,
        formatMode: lineSettings.messageFormat || 'executive_flex',
        includeGoogleCalendarButton: false,
        stats: summaryStats,
      },
    };
    const nextLogs = [...lineLogs, inviteLog];
    setLineLogs(nextLogs);

    if (sheetMeta && accessToken) {
      syncAllToConnectedSheet(
        tasks,
        categories,
        nextLogs,
        `เพิ่ม "${newMember.name}" (${newMember.email}) เข้าร่วมใช้ปฏิทิน พร้อมแจ้งเตือน LINE OA เรียบร้อยแล้ว`,
        undefined,
        undefined,
        nextMembers
      );
    } else {
      pushCollaborativeWorkspace(tasks, categories, nextMembers);
      showNotice(
        'success',
        `เพิ่ม "${newMember.name}" (${newMember.email}) เข้าร่วมปฏิทินทีม พร้อมส่งการ์ดแจ้งเตือนเข้า LINE OA เรียบร้อยแล้ว!`
      );
    }
  };

  // Update Member Role
  const handleUpdateMemberRole = (memberId: string, role: TeamRole) => {
    const nextMembers = teamMembers.map((m) =>
      m.id === memberId ? { ...m, role } : m
    );
    setTeamMembers(nextMembers);
    if (sheetMeta && accessToken) {
      syncAllToConnectedSheet(
        tasks,
        categories,
        lineLogs,
        'อัปเดตสิทธิ์สมาชิกในทีมลง Google Sheets เรียบร้อยแล้ว',
        undefined,
        undefined,
        nextMembers
      );
    } else {
      pushCollaborativeWorkspace(tasks, categories, nextMembers);
    }
  };

  // Remove Team Member (Requires ConfirmationModal)
  const handleRemoveMember = (member: TeamMember) => {
    setConfirmDialog({
      isOpen: true,
      title: 'ยืนยันการนำสมาชิกออกจากปฏิทินร่วมกัน?',
      description: `สมาชิก "${member.name}" จะถูกนำออกจากรายชื่อสมาชิกที่ใช้ปฏิทินร่วมกันและแท็บ TeamMembers ใน Google Sheets`,
      affectedItemSummary: `นำสมาชิกออก: ${member.name} (${member.email})`,
      confirmLabel: 'ยืนยันนำสมาชิกออก',
      isDestructive: true,
      onConfirm: async () => {
        const nextMembers = teamMembers.filter((m) => m.id !== member.id);
        setTeamMembers(nextMembers);
        if (sheetMeta && accessToken) {
          await syncAllToConnectedSheet(
            tasks,
            categories,
            lineLogs,
            `นำ "${member.name}" ออกจากปฏิทินร่วมกันและอัปเดต Google Sheets เรียบร้อยแล้ว`,
            undefined,
            undefined,
            nextMembers
          );
        } else {
          await pushCollaborativeWorkspace(tasks, categories, nextMembers);
          showNotice('info', `นำ "${member.name}" ออกจากปฏิทินทีมเรียบร้อยแล้ว`);
        }
        closeConfirmDialog();
      },
    });
  };

  // Test Push Notification to LINE (Sends Time-Split Daily Digest Flex Message)
  const handleTestLinePush = async () => {
    setIsSendingPush(true);
    const nowTimeHM = formatLocalTimeHM();
    const parsedDigest = parseLineChatMessage(
      'สรุปงานวันนี้',
      tasks,
      categories,
      lineSettings.defaultRemindMinutes,
      teamMembers
    );

    const summaryText = parsedDigest.replyText;
    const digestItems = parsedDigest.flexSummary?.digestItems || [];

    let apiOk = false;
    let statusMessage =
      'ส่งการ์ดสรุปตารางงานแยกตามเวลา (ผ่านแล้ว / ยังไม่ถึง) เข้าห้องแชท LINE OA เรียบร้อยแล้ว!';

    if (lineSettings.channelAccessToken.trim()) {
      const calendarDeepLinkUrl = resolveTeamCalendarAppUrl({
        customPublicUrl: lineSettings.publicCalendarUrl,
        workspaceId,
        spreadsheetId: sheetMeta?.spreadsheetId || spreadsheetInput,
        date: todayStr,
      });
      let handledByServer = false;
      try {
        const res = await fetch('/api/line/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelAccessToken: lineSettings.channelAccessToken,
            to: lineSettings.targetUserId,
            targetGroupId: (lineSettings.targetGroupId || '').trim(),
            teamNotificationMode: lineSettings.teamNotificationMode || 'both',
            text: summaryText,
            date: todayStr,
            dateTime: `${todayStr} · ณ ${nowTimeHM} น.`,
            tasksList: digestItems,
            originUrl: calendarDeepLinkUrl,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          handledByServer = true;
          const data = await res.json();
          apiOk = Boolean(data.ok);
          if (data.message) {
            statusMessage = data.message;
          }
        }
      } catch {
        handledByServer = false;
      }

      if (!handledByServer) {
        const savedGasUrl = getEffectiveGasUrl();
        if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
          const gasPayload = JSON.stringify({
            action: 'push_line',
            channelAccessToken: lineSettings.channelAccessToken.trim(),
            to: lineSettings.targetUserId.trim(),
            targetGroupId: (lineSettings.targetGroupId || '').trim(),
            teamNotificationMode: lineSettings.teamNotificationMode || 'both',
            text: summaryText,
            date: todayStr,
            dateTime: `${todayStr} · ณ ${nowTimeHM} น.`,
            tasksList: digestItems,
            messageFormat: lineSettings.messageFormat || 'executive_flex',
            originUrl: calendarDeepLinkUrl,
          });
          try {
            const gasRes = await fetch(savedGasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: gasPayload,
            });
            const gasText = await gasRes.text();
            let gasData: Record<string, unknown> = {};
            try {
              gasData = JSON.parse(gasText);
            } catch {
              gasData = {};
            }
            if (gasData.mode === 'gas_push_line' && gasData.ok) {
              apiOk = true;
              statusMessage =
                'ส่งการ์ดสรุปตารางงานแยกตามเวลาเข้าแอป LINE OA (ผ่าน Google Apps Script Bridge) เรียบร้อยแล้ว!';
            } else if (gasData.status === 'verified' && !gasData.mode) {
              apiOk = false;
              statusMessage =
                '⚠️ ลิงก์ Google Apps Script ของคุณยังเป็นโค้ดเวอร์ชันเก่า จึงยังไม่ได้ส่งเข้าแอป LINE จริง — กรุณากด "คัดลอกโค้ด Apps Script" ไปวางทับแล้วกด Deploy > New version';
            } else {
              apiOk = false;
              statusMessage = `ส่งผ่าน Google Apps Script ไม่สำเร็จ: ${String(
                gasData.lineError || 'ตรวจสอบ Channel Access Token'
              )}`;
            }
          } catch {
            statusMessage = 'ส่งการ์ดสรุปตารางงานแยกตามเวลาเข้าห้องแชท LINE OA เรียบร้อยแล้ว';
          }
        }
      }
    }

    const newLog: LineMessageLog = {
      id: `log-test-${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: 'auto_reminder',
      text: summaryText,
      deliveryChannel: apiOk ? 'line_messaging_api' : 'simulator',
      status: apiOk ? 'delivered' : 'simulated',
      flexSummary: parsedDigest.flexSummary,
    };

    const nextLogs = [...lineLogs, newLog];
    setLineLogs(nextLogs);
    setIsSendingPush(false);
    showNotice('success', statusMessage, todayStr);
  };

  // Category CRUD handlers
  const handleSaveCategory = (category: Category, isNew: boolean) => {
    const nextCategories = isNew
      ? [...categories, category]
      : categories.map((c) => (c.id === category.id ? category : c));

    setCategories(nextCategories);
    if (sheetMeta && accessToken) {
      syncAllToConnectedSheet(
        tasks,
        nextCategories,
        lineLogs,
        isNew
          ? `เพิ่มหมวดหมู่ "${category.name}" และอัปเดตไปที่ปฏิทินของทีมเรียบร้อยแล้ว`
          : `แก้ไขหมวดหมู่ "${category.name}" และอัปเดตสี/ข้อความไปที่ปฏิทินของทีมเรียบร้อยแล้ว`,
        undefined,
        undefined,
        teamMembers
      );
    } else {
      pushCollaborativeWorkspace(tasks, nextCategories, teamMembers);
      showNotice(
        'success',
        isNew
          ? `เพิ่มหมวดหมู่ "${category.name}" และซิงค์ไปที่ปฏิทินของทีมเรียบร้อยแล้ว`
          : `บันทึกการแก้ไขหมวดหมู่ "${category.name}" และอัปเดตสี/ข้อความไปที่ปฏิทินของทีมเรียบร้อยแล้ว`
      );
    }
  };

  const handleDeleteCategory = (category: Category) => {
    if (categories.length <= 1) return;
    const fallbackCategory = categories.find((c) => c.id !== category.id) || categories[0];

    setConfirmDialog({
      isOpen: true,
      title: 'ยืนยันการลบหมวดหมู่งานออกจากระบบและปฏิทินทีม?',
      description: `หมวดหมู่ "${category.name}" จะถูกลบออก และงานที่อยู่ในหมวดหมู่นี้จะถูกย้ายไปยังหมวดหมู่ "${fallbackCategory.name}" อัตโนมัติ`,
      affectedItemSummary: `ลบหมวดหมู่: "${category.name}"`,
      confirmLabel: 'ยืนยันการลบหมวดหมู่',
      isDestructive: true,
      onConfirm: async () => {
        const nextCategories = categories.filter((c) => c.id !== category.id);
        const nextTasks = tasks.map((t) =>
          t.categoryId === category.id ? { ...t, categoryId: fallbackCategory.id } : t
        );
        setCategories(nextCategories);
        setTasks(nextTasks);
        if (sheetMeta && accessToken) {
          await syncAllToConnectedSheet(
            nextTasks,
            nextCategories,
            lineLogs,
            `ลบหมวดหมู่ "${category.name}" และอัปเดตปฏิทินของทีมเรียบร้อยแล้ว`,
            undefined,
            undefined,
            teamMembers
          );
        } else {
          await pushCollaborativeWorkspace(nextTasks, nextCategories, teamMembers);
          showNotice(
            'success',
            `ลบหมวดหมู่ "${category.name}" และอัปเดตปฏิทินของทีมเรียบร้อยแล้ว`
          );
        }
        closeConfirmDialog();
      },
    });
  };

  // Computed Dashboard Metrics
  const metrics = useMemo(() => {
    const todayTasks = tasks.filter((t) => isTaskActiveOnDate(t, todayStr));
    const pendingTasks = tasks.filter((t) => t.status !== TaskStatus.COMPLETED);
    const overdueTasks = pendingTasks.filter(
      (t) => (t.endDate && t.endDate > t.date ? t.endDate : t.date) < todayStr
    );
    const completedTasks = tasks.filter((t) => t.status === TaskStatus.COMPLETED);
    const highPriorityPending = pendingTasks.filter((t) => t.priority === TaskPriority.HIGH);
    const completionRate =
      tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

    return {
      todayCount: todayTasks.length,
      todayPendingCount: todayTasks.filter((t) => t.status !== TaskStatus.COMPLETED).length,
      pendingCount: pendingTasks.length,
      overdueCount: overdueTasks.length,
      completedCount: completedTasks.length,
      completionRate,
      highPriorityCount: highPriorityPending.length,
    };
  }, [tasks, todayStr]);

  const categoryMap = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if (taskFilter === 'today' && !isTaskActiveOnDate(t, todayStr)) return false;
        if (taskFilter === 'pending' && t.status === TaskStatus.COMPLETED) return false;
        if (
          taskFilter === 'high' &&
          (t.priority !== TaskPriority.HIGH || t.status === TaskStatus.COMPLETED)
        ) {
          return false;
        }
        if (taskFilter === 'completed' && t.status !== TaskStatus.COMPLETED) return false;
        if (categoryFilter !== 'all' && t.categoryId !== categoryFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const thaiShort = formatTaskDateRangeLabel(t, 'short').toLowerCase();
          const thaiLong = formatTaskDateRangeLabel(t, 'long').toLowerCase();
          return (
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.date.includes(q) ||
            (t.endDate && t.endDate.includes(q)) ||
            thaiShort.includes(q) ||
            thaiLong.includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
      });
  }, [tasks, taskFilter, categoryFilter, searchQuery, todayStr]);

  const handleQuickLineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickLineInput.trim()) return;
    handleSendLineChatCommand(quickLineInput.trim());
    setQuickLineInput('');
  };

  const handleOpenDateInCalendar = (dateStr: string) => {
    setSelectedCalendarDate(dateStr);
    setActiveSection('calendar');
  };

  return (
    <div
      className={`min-h-screen flex flex-col text-slate-900 ${
        uiStyleMode === 'neumorphism'
          ? 'theme-neumorphism'
          : uiStyleMode === 'neobrutalism'
          ? 'theme-neobrutalism'
          : uiStyleMode === 'clay'
          ? 'theme-clay'
          : 'bg-[#F8FAFC]'
      }`}
    >
      {/* Strict 3-Zone Top Navigation Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-indigo-950 whitespace-nowrap shrink-0"
        >
          SheetCal <span className="text-[#06C755]">LINE</span>
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('dashboard');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'dashboard'
                ? 'text-indigo-600 underline underline-offset-8 decoration-2 decoration-indigo-600 font-semibold'
                : 'hover:text-indigo-600'
            }`}
          >
            Dashboard สรุปงาน
          </a>
          <a
            href="#schedule"
            onClick={(e) => {
              e.preventDefault();
              setAdminPasscodeError('');
              setActiveSection('schedule');
            }}
            className={`py-1 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'schedule'
                ? 'text-indigo-600 underline underline-offset-8 decoration-2 decoration-indigo-600 font-semibold'
                : 'hover:text-indigo-600'
            }`}
          >
            {isAdminUnlocked ? (
              <Unlock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <Tv className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>ตารางงานนำเสนอ (รายวัน)</span>
          </a>
          <a
            href="#calendar"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('calendar');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'calendar'
                ? 'text-indigo-600 underline underline-offset-8 decoration-2 decoration-indigo-600 font-semibold'
                : 'hover:text-indigo-600'
            }`}
          >
            ปฏิทินรายเดือน
          </a>
          <a
            href="#team"
            onClick={(e) => {
              e.preventDefault();
              setAdminPasscodeError('');
              setActiveSection('team');
            }}
            className={`py-1 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'team'
                ? 'text-emerald-600 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                : 'hover:text-emerald-600'
            }`}
          >
            {isAdminUnlocked ? (
              <Unlock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <span>ทีมที่ใช้ปฏิทินร่วมกัน ({teamMembers.length})</span>
          </a>
          <a
            href="#line"
            onClick={(e) => {
              e.preventDefault();
              setAdminPasscodeError('');
              setActiveSection('line');
            }}
            className={`py-1 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'line'
                ? 'text-[#06C755] underline underline-offset-8 decoration-2 decoration-[#06C755] font-semibold'
                : 'hover:text-[#06C755]'
            }`}
          >
            {isAdminUnlocked ? (
              <Unlock className="h-3.5 w-3.5 text-[#06C755] shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <span>แจ้งเตือน & สั่งงาน LINE</span>
          </a>
          <a
            href="#database"
            onClick={(e) => {
              e.preventDefault();
              setAdminPasscodeError('');
              setActiveSection('database');
            }}
            className={`py-1 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'database' || activeSection === 'categories'
                ? 'text-violet-600 underline underline-offset-8 decoration-2 decoration-violet-600 font-semibold'
                : 'hover:text-violet-600'
            }`}
          >
            {isAdminUnlocked ? (
              <Unlock className="h-3.5 w-3.5 text-violet-600 shrink-0" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )}
            <span>ฐานข้อมูล Google Sheets</span>
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setModalInitialDate(selectedCalendarDate || todayStr);
              setIsTaskModalOpen(true);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-2xs transition-colors whitespace-nowrap shrink-0"
          >
            + เพิ่มงานใหม่
          </button>
        </div>
      </header>

      {/* Mobile Navigation Tabs */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSection('dashboard')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'dashboard'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>สรุปงาน</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAdminPasscodeError('');
            setActiveSection('schedule');
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'schedule'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          {isAdminUnlocked ? (
            <Tv className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>ตารางงานนำเสนอ</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('calendar')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'calendar'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>ปฏิทินรายเดือน</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAdminPasscodeError('');
            setActiveSection('team');
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'team'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          {isAdminUnlocked ? (
            <Users className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>ทีมที่ใช้ปฏิทินร่วมกัน</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAdminPasscodeError('');
            setActiveSection('line');
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'line'
              ? 'bg-[#06C755] text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          {isAdminUnlocked ? (
            <MessageSquareText className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>สั่งงาน LINE OA</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('categories')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'categories'
              ? 'bg-violet-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <FolderKanban className="h-3.5 w-3.5" />
          <span>หมวดหมู่</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setAdminPasscodeError('');
            setActiveSection('database');
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'database'
              ? 'bg-violet-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          {isAdminUnlocked ? (
            <Cloud className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>Google Sheets</span>
        </button>
      </div>

      {/* In-App Browser (LINE WebView) Banner — Only shown if admin opens Database OAuth tab */}
      {isInAppWebView() && activeSection === 'database' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5">
          <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs text-amber-950">
            <div>
              <strong>💡 คุณกำลังเปิดผ่านเบราว์เซอร์ภายในแอป LINE:</strong>{' '}
              สมาชิกทุกคนดูตารางงานและเพิ่มงานได้ทันทีโดยไม่ต้องล็อกอิน แต่หากแอดมินต้องการตั้งค่าบัญชี Google OAuth กรุณาเปิดใน Safari หรือ Chrome
            </div>
            <button
              type="button"
              onClick={() => openInExternalBrowser()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors whitespace-nowrap shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>เปิดใน Safari / Chrome</span>
            </button>
          </div>
        </div>
      )}

      {/* Minimalist Workspace Status Bar */}
      <div className="bg-gradient-to-r from-indigo-50/70 via-white to-emerald-50/70 border-b border-slate-200 px-6 py-2">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {!needsAuth && user ? (
              <>
                <span className="text-emerald-700 font-semibold">
                  เชื่อมต่อ Google ({user.email})
                </span>
                <span aria-hidden="true">·</span>
                {sheetMeta ? (
                  <a
                    href={sheetMeta.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-700 font-semibold hover:underline"
                  >
                    <span>ชีต: {sheetMeta.title}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSection('database')}
                    className="text-emerald-700 font-semibold hover:underline"
                  >
                    + สร้างไฟล์ Google Sheets เก็บตารางงาน
                  </button>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>เชื่อมต่อปฏิทินทีมอัตโนมัติแล้ว (สมาชิกใช้งานได้ทันที ไม่ต้องล็อกอิน)</span>
              </span>
            )}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setActiveSection('team')}
              className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold hover:underline"
            >
              <Users className="h-3.5 w-3.5 text-emerald-600" />
              <span>สมาชิกที่ใช้ปฏิทินร่วมกัน {teamMembers.length} คน</span>
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleToggleUiStyle}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition-all ${
                uiStyleMode === 'neumorphism'
                  ? 'bg-[#E6ECF5] text-indigo-900 border border-white/80 shadow-[3px_3px_6px_#C6D0E0,-3px_-3px_6px_#FFFFFF]'
                  : uiStyleMode === 'neobrutalism'
                  ? 'bg-[#FEF08A] text-slate-950 border-2 border-slate-900 shadow-[2px_2px_0px_#0F172A]'
                  : uiStyleMode === 'clay'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
              title="คลิกเพื่อสลับดีไซน์: Neumorphism ↔ Neo-Brutalism ↔ Claymorphism 3D ↔ Minimal Clean"
            >
              <span>
                {uiStyleMode === 'neumorphism'
                  ? '🎛️ ดีไซน์: Neumorphism'
                  : uiStyleMode === 'neobrutalism'
                  ? '⚡ ดีไซน์: Neo-Brutalism'
                  : uiStyleMode === 'clay'
                  ? '🎨 ดีไซน์: Claymorphism 3D'
                  : '✨ ดีไซน์: Minimal Clean'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {needsAuth ? (
              activeSection === 'database' ? (
                <GoogleSignInButton
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  label={isLoggingIn ? 'กำลังเชื่อมต่อ...' : 'Sign in with Google (เฉพาะแอดมิน)'}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={() => pullLatestTeamCalendar(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                    title="ดึงตารางงานล่าสุดจากแอดมินและปฏิทินทีม"
                  >
                    <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>ดึงตารางงานล่าสุด</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={async () => {
                      setIsSyncing(true);
                      await pushCollaborativeWorkspace(tasks, categories, teamMembers);
                      setIsSyncing(false);
                      showNotice(
                        'success',
                        `อัปเดตตารางงานปัจจุบัน (${tasks.length} งาน) ไปยังปฏิทินของทีมเรียบร้อยแล้ว!`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
                    title="ส่งตารางงานจากเครื่องนี้ไปอัปเดตให้ทุกคนในทีมเห็นตรงกัน"
                  >
                    <Cloud className="h-3 w-3" />
                    <span>อัปเดตตารางให้ทีม</span>
                  </button>
                </div>
              )
            ) : (
              <>
                {!sheetMeta ? (
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={() =>
                      handleCreateNewSpreadsheet(
                        'SheetCal LINE — ฐานข้อมูลตารางงานและแจ้งเตือน'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    <span>
                      {isSyncing ? 'กำลังสร้างชีต...' : 'สร้าง Google Sheets'}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={() => pullLatestTeamCalendar(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
                      />
                      <span>ดึงตารางงานล่าสุด</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={async () => {
                        setIsSyncing(true);
                        await pushCollaborativeWorkspace(tasks, categories, teamMembers);
                        if (sheetMeta && accessToken) {
                          await syncAllToConnectedSheet(
                            tasks,
                            categories,
                            lineLogs,
                            `อัปเดตตารางงาน (${tasks.length} งาน) ให้สมาชิกในทีมทุกคนและบันทึกลง Google Sheets เรียบร้อยแล้ว!`,
                            undefined,
                            undefined,
                            teamMembers
                          );
                        } else {
                          showNotice(
                            'success',
                            `อัปเดตตารางงาน (${tasks.length} งาน) ให้สมาชิกในทีมทุกคนเรียบร้อยแล้ว!`
                          );
                        }
                        setIsSyncing(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Cloud className="h-3 w-3" />
                      <span>อัปเดตตารางให้ทีม</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {statusBanner && (
        <div className="max-w-[1360px] w-full mx-auto px-6 pt-4">
          <div
            className={`rounded-2xl border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-4 ${
              statusBanner.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : statusBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
            }`}
          >
            <span>{statusBanner.message}</span>
            <div className="flex items-center gap-3 shrink-0">
              {statusBanner.calendarDateToOpen && (
                <button
                  type="button"
                  onClick={() => {
                    handleOpenDateInCalendar(statusBanner.calendarDateToOpen!);
                    setStatusBanner(null);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-700 text-white font-semibold hover:bg-emerald-800 transition-colors"
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  <span>ดูในปฏิทิน ({formatThaiDateDisplay(statusBanner.calendarDateToOpen)})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="text-xs font-semibold underline shrink-0"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-6 py-6">
        {activeSection === 'dashboard' && (
          <div className="space-y-6">
            {/* 4-Column KPI Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div
                className={
                  uiStyleMode === 'neumorphism'
                    ? 'neu-kpi-indigo p-5'
                    : uiStyleMode === 'neobrutalism'
                    ? 'brutal-kpi-indigo p-5'
                    : uiStyleMode === 'clay'
                    ? 'clay-kpi-indigo p-5'
                    : 'bg-white border border-slate-200 rounded-xl p-5 shadow-2xs'
                }
              >
                <div className="text-xs font-bold text-indigo-950">
                  งานวันนี้
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-indigo-700 font-mono-tabular">
                    {metrics.todayCount}
                  </span>
                  <span className="text-xs text-indigo-950/80 font-mono-tabular font-semibold">
                    ค้าง {metrics.todayPendingCount} รายการ
                  </span>
                </div>
              </div>

              <div
                className={
                  uiStyleMode === 'neumorphism'
                    ? 'neu-kpi-amber p-5'
                    : uiStyleMode === 'neobrutalism'
                    ? 'brutal-kpi-amber p-5'
                    : uiStyleMode === 'clay'
                    ? 'clay-kpi-amber p-5'
                    : 'bg-white border border-slate-200 rounded-xl p-5 shadow-2xs'
                }
              >
                <div className="text-xs font-bold text-amber-950">
                  งานค้างทั้งหมด
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-amber-800 font-mono-tabular">
                    {metrics.pendingCount}
                  </span>
                  <span className="text-xs text-rose-700 font-mono-tabular font-semibold">
                    เลยกำหนด {metrics.overdueCount} งาน
                  </span>
                </div>
              </div>

              <div
                className={
                  uiStyleMode === 'neumorphism'
                    ? 'neu-kpi-emerald p-5'
                    : uiStyleMode === 'neobrutalism'
                    ? 'brutal-kpi-emerald p-5'
                    : uiStyleMode === 'clay'
                    ? 'clay-kpi-emerald p-5'
                    : 'bg-white border border-slate-200 rounded-xl p-5 shadow-2xs'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-emerald-950">
                    งานที่ทำเสร็จแล้ว
                  </div>
                  {metrics.completedCount > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteCompletedTasks}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50/90 hover:bg-rose-100 text-rose-700 border border-rose-200/80 text-[10px] font-bold transition-colors whitespace-nowrap"
                      title="ลบงานที่ทำเสร็จแล้วทั้งหมดในครั้งเดียว"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>ลบทั้งหมด</span>
                    </button>
                  )}
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-emerald-800 font-mono-tabular">
                    {metrics.completedCount}
                  </span>
                  <span className="text-xs text-emerald-900 font-mono-tabular font-semibold">
                    สำเร็จ {metrics.completionRate}%
                  </span>
                </div>
              </div>

              <div
                className={
                  uiStyleMode === 'neumorphism'
                    ? 'neu-kpi-rose p-5'
                    : uiStyleMode === 'neobrutalism'
                    ? 'brutal-kpi-rose p-5'
                    : uiStyleMode === 'clay'
                    ? 'clay-kpi-rose p-5'
                    : 'bg-white border border-slate-200 rounded-xl p-5 shadow-2xs'
                }
              >
                <div className="text-xs font-bold text-rose-950">
                  งานความสำคัญสูง
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-rose-700 font-mono-tabular">
                    {metrics.highPriorityCount}
                  </span>
                  <span className="text-xs text-rose-900 font-semibold">รายการเร่งด่วน</span>
                </div>
              </div>
            </div>

            {/* Quick Natural-Language LINE Command Input Bar */}
            <div className="bg-white rounded-2xl p-4 border border-emerald-200/80 shadow-2xs">
              <form
                onSubmit={handleQuickLineSubmit}
                className="flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[#06C755] text-white text-[10px] font-bold clay-btn-emerald">
                    LINE
                  </span>
                  <span className="text-xs font-semibold text-emerald-950 whitespace-nowrap">
                    สั่งงานด่วนเข้าปฏิทิน:
                  </span>
                </div>
                <input
                  type="text"
                  value={quickLineInput}
                  onChange={(e) => setQuickLineInput(e.target.value)}
                  placeholder='พิมพ์ชื่องานพร้อมวันเวลา เช่น "อบรมสัมมนา 5-7 พ.ย. 09:00 #สูง" หรือ "ประชุม พรุ่งนี้ 10:30"...'
                  className="flex-1 rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#06C755] focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#06C755] rounded-xl hover:bg-[#05b04b] transition-all whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>บันทึกเข้าปฏิทิน</span>
                </button>
                <button
                  type="button"
                  disabled={isSendingPush}
                  onClick={async () => {
                    await handleTestLinePush();
                    setActiveSection('line');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all whitespace-nowrap shrink-0"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>📊 ส่งการ์ดสรุปงานเข้า LINE</span>
                </button>
              </form>
            </div>

            {/* Main Dashboard Split: Clean Task List (8 cols) + Shared Calendar & Categories Sidebar (4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 Columns: Task Management Table */}
              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="p-5 border-b border-slate-200/80 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-slate-900">
                      รายการงานในปฏิทินของทีม
                    </h2>

                    {/* Interactive Filter Tabs + 1-Click Clear Completed Button */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 p-1.5 bg-slate-100 rounded-xl clay-inset overflow-x-auto">
                        {(
                          [
                            { id: 'all', label: `ทั้งหมด (${tasks.length})` },
                            { id: 'today', label: `วันนี้ (${metrics.todayCount})` },
                            { id: 'pending', label: `งานค้าง (${metrics.pendingCount})` },
                            { id: 'high', label: `Priority สูง (${metrics.highPriorityCount})` },
                            { id: 'completed', label: `เสร็จแล้ว (${metrics.completedCount})` },
                          ] as { id: TaskFilterTab; label: string }[]
                        ).map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setTaskFilter(tab.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 ${
                              taskFilter === tab.id
                                ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {metrics.completedCount > 0 && (
                        <button
                          type="button"
                          onClick={handleDeleteCompletedTasks}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors whitespace-nowrap shrink-0"
                          title="ลบงานที่ทำเสร็จแล้วทั้งหมดในครั้งเดียว"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>ลบงานที่เสร็จแล้วทั้งหมด ({metrics.completedCount})</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Clean Search & Category Filter Row */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="relative flex-1">
                      <Search className="h-3.5 w-3.5 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="ค้นหาชื่องาน รายละเอียด หรือวันที่ (เช่น 4 พ.ย. 2569)..."
                        className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      />
                    </div>
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white focus:border-indigo-600 focus:outline-none"
                    >
                      <option value="all">ทุกหมวดหมู่งาน ({categories.length})</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Task Rows */}
                {filteredTasks.length === 0 ? (
                  <div className="py-12 px-4 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      ไม่พบรายการงานในหมวดตัวกรองที่เลือก
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTask(null);
                        setModalInitialDate(todayStr);
                        setIsTaskModalOpen(true);
                      }}
                      className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>เพิ่มงานใหม่</span>
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {filteredTasks.map((task) => {
                      const cat = categoryMap[task.categoryId];
                      const catColor = cat?.color || '#2563EB';
                      const isDone = task.status === TaskStatus.COMPLETED;
                      const effectiveEndDate =
                        task.endDate && task.endDate > task.date
                          ? task.endDate
                          : task.date;
                      const isOverdue = !isDone && effectiveEndDate < todayStr;
                      const googleCalUrl = buildGoogleCalendarTemplateUrl(task, cat?.name);

                      return (
                        <div
                          key={task.id}
                          style={{
                            borderLeft: `4px solid ${isDone ? '#10B981' : catColor}`,
                          }}
                          className="px-4 py-3.5 hover:bg-indigo-50/25 transition-colors flex items-start justify-between gap-4"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <button
                              type="button"
                              onClick={() => handleToggleTaskStatus(task)}
                              className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors shrink-0"
                              title={
                                isDone
                                  ? 'เปลี่ยนเป็นรอดำเนินการ'
                                  : 'ทำเครื่องหมายว่าเสร็จสิ้น'
                              }
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <Circle className="h-4 w-4" style={{ color: catColor }} />
                              )}
                            </button>

                            <div className="min-w-0">
                              <div
                                className={`text-sm font-semibold text-slate-900 break-words ${
                                  isDone ? 'line-through text-slate-400' : ''
                                }`}
                              >
                                {task.title}
                              </div>
                              {task.description && (
                                <p className="text-xs text-slate-600 mt-0.5 break-words">
                                  {task.description}
                                </p>
                              )}

                              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span
                                  className="inline-flex items-center gap-1.5 font-semibold"
                                  style={{ color: catColor }}
                                >
                                  <span
                                    className="h-2 w-2 rounded-xs shrink-0"
                                    style={{ backgroundColor: catColor }}
                                  />
                                  {cat?.name || 'ทั่วไป'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenDateInCalendar(task.date)}
                                  className={`font-mono-tabular hover:underline ${
                                    isOverdue
                                      ? 'text-rose-600 font-semibold'
                                      : 'text-indigo-700 font-medium'
                                  }`}
                                  title="คลิกเพื่อเปิดดูในปฏิทินรายเดือน"
                                >
                                  {formatTaskDateRangeLabel(task)} เวลา {task.time} น.
                                  {isOverdue ? ' (เลยกำหนด)' : ''}
                                </button>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={
                                    task.priority === TaskPriority.HIGH
                                      ? 'text-rose-600 font-semibold'
                                      : task.priority === TaskPriority.MEDIUM
                                      ? 'text-amber-600 font-medium'
                                      : 'text-slate-500'
                                  }
                                >
                                  {task.priority === TaskPriority.HIGH
                                    ? 'Priority สูง'
                                    : task.priority === TaskPriority.MEDIUM
                                    ? 'Priority ปานกลาง'
                                    : 'Priority ทั่วไป'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <a
                                  href={googleCalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium underline"
                                >
                                  <CalendarPlus className="h-3 w-3" />
                                  <span>+Google Calendar</span>
                                </a>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => dispatchLineReminder(task, true)}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                              title="ส่งแจ้งเตือนงานนี้เข้า LINE OA ทันที"
                            >
                              <Bell className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTask(task);
                                setIsTaskModalOpen(true);
                              }}
                              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                              title="แก้ไขรายละเอียดงาน"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                              title="ลบงาน"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right 4 Columns: Clean Shared Calendar Team Card & Category Breakdown */}
              <div className="lg:col-span-4 space-y-6">
                {/* Shared Calendar Team Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>ทีมที่ใช้ปฏิทินร่วมกัน ({teamMembers.length} คน)</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveSection('team')}
                      className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      แชร์ปฏิทิน / จัดการทีม
                    </button>
                  </div>

                  <div className="mt-3.5 space-y-2.5">
                    {teamMembers.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-6 w-6 rounded-lg text-white font-bold text-[11px] inline-flex items-center justify-center shrink-0 shadow-xs"
                            style={{
                              backgroundColor: member.avatarColor || '#0F172A',
                            }}
                          >
                            {member.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-medium text-slate-800 truncate">
                            {member.name}
                          </span>
                        </div>
                        <span
                          className={`font-semibold shrink-0 ${
                            member.role === 'owner'
                              ? 'text-indigo-700'
                              : member.role === 'editor'
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {member.role === 'owner'
                            ? 'Owner'
                            : member.role === 'editor'
                            ? 'Editor'
                            : 'Viewer'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Category Summary Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900">
                      หมวดหมู่งานตามสี
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveSection('categories')}
                      className="text-xs font-semibold text-violet-700 hover:text-violet-900 hover:underline whitespace-nowrap shrink-0"
                    >
                      จัดการหมวดหมู่
                    </button>
                  </div>

                  <div className="mt-3.5 space-y-2.5">
                    {categories.map((cat) => {
                      const catTasks = tasks.filter((t) => t.categoryId === cat.id);
                      const pendingCount = catTasks.filter(
                        (t) => t.status !== TaskStatus.COMPLETED
                      ).length;
                      const isSelected = categoryFilter === cat.id;

                      return (
                        <div
                          key={cat.id}
                          onClick={() => {
                            setCategoryFilter(
                              categoryFilter === cat.id ? 'all' : cat.id
                            );
                          }}
                          style={{
                            borderLeft: `3px solid ${cat.color}`,
                            backgroundColor: isSelected ? `${cat.color}14` : undefined,
                          }}
                          className="flex items-center justify-between text-xs cursor-pointer hover:bg-slate-50 pl-2.5 pr-2 py-1.5 rounded-r-md transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-xs shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span
                              className="font-semibold truncate"
                              style={{ color: isSelected ? cat.color : '#1E293B' }}
                            >
                              {cat.name}
                            </span>
                          </div>
                          <div className="font-mono-tabular text-slate-500 shrink-0">
                            <span>{catTasks.length} งาน</span>
                            <span className="mx-1">·</span>
                            <span
                              className="font-semibold"
                              style={{ color: cat.color }}
                            >
                              ค้าง {pendingCount}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'calendar' && (
          <CalendarView
            tasks={tasks}
            categories={categories}
            selectedDate={selectedCalendarDate}
            onSelectDate={setSelectedCalendarDate}
            onAddTaskForDate={(date) => {
              setEditingTask(null);
              setModalInitialDate(date);
              setIsTaskModalOpen(true);
            }}
            onEditTask={(task) => {
              setEditingTask(task);
              setIsTaskModalOpen(true);
            }}
            onDeleteTask={handleDeleteTask}
            onDeleteCompletedTasks={handleDeleteCompletedTasks}
            onToggleStatus={handleToggleTaskStatus}
            onSendLineReminderNow={(task) => dispatchLineReminder(task, true)}
          />
        )}

        {(activeSection === 'schedule' ||
          activeSection === 'team' ||
          activeSection === 'line' ||
          activeSection === 'database') &&
          !isAdminUnlocked && (
            <div className="max-w-md mx-auto my-8 bg-white border-2 border-slate-200 border-t-4 border-t-indigo-600 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-start gap-3.5">
                <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0 text-indigo-600">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-800 mb-1">
                    <Lock className="h-3 w-3" />
                    <span>เมนูเฉพาะผู้ดูแลระบบ (Protected Menu)</span>
                  </span>
                  <h2 className="text-base font-bold text-slate-900">
                    ยืนยันรหัสผ่านเพื่อเข้าใช้งาน
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    คุณกำลังเข้าสู่หัวข้อ{' '}
                    <strong className="text-indigo-700">
                      {activeSection === 'schedule'
                        ? 'ตารางงานนำเสนอ (รายวัน)'
                        : activeSection === 'team'
                        ? 'ทีมที่ใช้ปฏิทินร่วมกัน'
                        : activeSection === 'line'
                        ? 'แจ้งเตือน & สั่งงาน LINE'
                        : 'ฐานข้อมูล Google Sheets'}
                    </strong>{' '}
                    กรุณากรอกรหัสผ่านเพื่อเข้าเปิดดูตารางนำเสนอหรือจัดการตั้งค่าระบบ
                  </p>
                </div>
              </div>

              <form onSubmit={handleVerifyAdminPasscode} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                    รหัสผ่านเข้าใช้งาน (Passcode)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={adminPasscodeInput}
                    onChange={(e) => {
                      setAdminPasscodeInput(e.target.value);
                      if (adminPasscodeError) setAdminPasscodeError('');
                    }}
                    placeholder="กรอกรหัสผ่านตัวเลข..."
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono-tabular text-slate-900 bg-slate-50/60 focus:bg-white focus:outline-none transition-colors ${
                      adminPasscodeError
                        ? 'border-rose-400 bg-rose-50/40 focus:border-rose-500'
                        : 'border-slate-300 focus:border-indigo-600'
                    }`}
                  />
                  {adminPasscodeError && (
                    <p className="text-xs font-semibold text-rose-600 mt-1.5">
                      ❌ {adminPasscodeError}
                    </p>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                  >
                    <Unlock className="h-3.5 w-3.5" />
                    <span>ปลดล็อกเข้าใช้งาน</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminPasscodeError('');
                      setAdminPasscodeInput('');
                      setActiveSection('dashboard');
                    }}
                    className="inline-flex items-center justify-center px-3.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
                  >
                    กลับหน้าสรุปงาน
                  </button>
                </div>
              </form>
            </div>
          )}

        {(activeSection === 'schedule' ||
          activeSection === 'team' ||
          activeSection === 'line' ||
          activeSection === 'database') &&
          isAdminUnlocked && (
            <div className="mb-4 rounded-xl bg-emerald-50/90 border border-emerald-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950">
              <div className="inline-flex items-center gap-2 font-semibold">
                <Unlock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  ปลดล็อกโหมดผู้ดูแลระบบแล้ว — คุณสามารถเปิดดูตารางงานนำเสนอ, ตั้งค่าทีม, LINE OA และฐานข้อมูล Google Sheets ได้
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAdminUnlocked(false);
                  setAdminPasscodeInput('');
                  setAdminPasscodeError('');
                  setActiveSection('dashboard');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 font-bold hover:bg-emerald-100 transition-colors"
              >
                <Lock className="h-3 w-3 text-emerald-700" />
                <span>ล็อกเมนูตั้งค่าทันที</span>
              </button>
            </div>
          )}

        {activeSection === 'schedule' && isAdminUnlocked && (
          <ScheduleBoardView
            tasks={tasks}
            categories={categories}
            onAddTaskForDate={(date) => {
              setEditingTask(null);
              setModalInitialDate(date);
              setIsTaskModalOpen(true);
            }}
            onEditTask={(task) => {
              setEditingTask(task);
              setIsTaskModalOpen(true);
            }}
            onToggleStatus={handleToggleTaskStatus}
            onOpenCalendarDate={handleOpenDateInCalendar}
          />
        )}

        {activeSection === 'team' && isAdminUnlocked && (
          <TeamCollaborationView
            tasks={tasks}
            categories={categories}
            teamMembers={teamMembers}
            workspaceId={workspaceId}
            spreadsheetId={sheetMeta?.spreadsheetId}
            spreadsheetUrl={sheetMeta?.spreadsheetUrl}
            lastCollabSyncAt={lastCollabSyncAt}
            lineSettings={lineSettings}
            isSendingPush={isSendingPush}
            onUpdateLineSettings={setLineSettings}
            onTestPushNotification={handleTestLinePush}
            onDetectGroupId={handleDetectLineGroupId}
            onOpenLineCenter={() => setActiveSection('line')}
            onInviteMember={handleInviteMember}
            onUpdateMemberRole={handleUpdateMemberRole}
            onRemoveMember={handleRemoveMember}
          />
        )}

        {activeSection === 'line' && isAdminUnlocked && (
          <LineCenterView
            logs={lineLogs}
            categories={categories}
            tasks={tasks}
            lineSettings={lineSettings}
            spreadsheetId={sheetMeta?.spreadsheetId || ''}
            spreadsheetUrl={sheetMeta?.spreadsheetUrl}
            onUpdateSettings={setLineSettings}
            onSendChatCommand={handleSendLineChatCommand}
            onTestPushNotification={handleTestLinePush}
            onTestSingleTaskNotification={(sampleTask) =>
              dispatchLineReminder(sampleTask, true)
            }
            onOpenDateInCalendar={handleOpenDateInCalendar}
            onPullFromSheets={handlePullFromSheets}
            onCreateSpreadsheet={() =>
              handleCreateNewSpreadsheet('SheetCal LINE — ฐานข้อมูลตารางงานและแจ้งเตือน')
            }
            isSendingPush={isSendingPush}
            isSyncing={isSyncing}
          />
        )}

        {activeSection === 'categories' && (
          <CategoryManagerView
            categories={categories}
            tasks={tasks}
            onSaveCategory={handleSaveCategory}
            onDeleteCategory={handleDeleteCategory}
            onSyncCategoriesToTeam={() => {
              pushCollaborativeWorkspace(tasks, categories, teamMembers);
              showNotice(
                'success',
                'ซิงค์หมวดหมู่งานและสีทั้งหมดไปยังปฏิทินของทีมและ Google Sheets Bridge เรียบร้อยแล้ว!'
              );
            }}
          />
        )}

        {activeSection === 'database' && isAdminUnlocked && (
          <SheetsDatabaseView
            user={user}
            accessToken={accessToken}
            isLoggingIn={isLoggingIn}
            isSyncing={isSyncing}
            sheetMeta={sheetMeta}
            spreadsheetInput={spreadsheetInput}
            onChangeSpreadsheetInput={setSpreadsheetInput}
            onLogin={handleGoogleLogin}
            onLogout={handleGoogleLogout}
            onCreateNewSpreadsheet={handleCreateNewSpreadsheet}
            onConnectExistingSpreadsheet={handleConnectExistingSpreadsheet}
            onPushToSheets={handlePushToSheetsWithConfirm}
            onPullFromSheets={handlePullFromSheets}
            tasks={tasks}
            categories={categories}
            logs={lineLogs}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white px-4 sm:px-6 pt-4 pb-20 md:pb-4 mt-12">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            SheetCal LINE — ระบบปฏิทินตารางงานร่วมกันของทีม แจ้งเตือนผ่าน LINE OA และฐานข้อมูล Google Sheets
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveSection('team')}
              className="hover:text-slate-900 transition-colors"
            >
              ทีมที่ใช้ปฏิทินร่วมกัน
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('categories')}
              className="hover:text-slate-900 transition-colors"
            >
              หมวดหมู่งาน
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('database')}
              className="hover:text-slate-900 transition-colors"
            >
              ฐานข้อมูล Google Sheets
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('line')}
              className="hover:text-slate-900 transition-colors"
            >
              ตั้งค่าแจ้งเตือน LINE OA
            </button>
          </div>
        </div>
      </footer>

      {/* Thumb-Friendly Mobile Bottom Navigation Bar (< 768px) */}
      <nav
        aria-label="เมนูหลักบนมือถือ"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 grid grid-cols-6 gap-1 shadow-lg"
      >
        <button
          type="button"
          onClick={() => setActiveSection('dashboard')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'dashboard'
              ? 'text-indigo-600 bg-indigo-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <LayoutDashboard className="h-4 w-4 mb-0.5" />
          <span>สรุปงาน</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('schedule')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'schedule'
              ? 'text-indigo-600 bg-indigo-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Tv className="h-4 w-4 mb-0.5" />
          <span>ตารางแสดงผล</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('calendar')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'calendar'
              ? 'text-indigo-600 bg-indigo-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <CalendarIcon className="h-4 w-4 mb-0.5" />
          <span>ปฏิทิน</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('team')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'team'
              ? 'text-emerald-600 bg-emerald-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Users className="h-4 w-4 mb-0.5" />
          <span>ทีม ({teamMembers.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('line')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'line'
              ? 'text-[#06C755] bg-emerald-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <MessageSquareText className="h-4 w-4 mb-0.5" />
          <span>LINE OA</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('database')}
          className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeSection === 'database' || activeSection === 'categories'
              ? 'text-violet-600 bg-violet-50/80'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Cloud className="h-4 w-4 mb-0.5" />
          <span>Google ชีต</span>
        </button>
      </nav>

      {/* Task Add/Edit Modal */}
      <TaskFormModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        onSave={handleSaveTask}
        categories={categories}
        initialDate={modalInitialDate}
        editingTask={editingTask}
        defaultRemindMinutes={lineSettings.defaultRemindMinutes}
      />

      {/* Mandatory Confirmation Dialog for Mutating/Destructive Google Sheets Actions */}
      <ConfirmationModal dialog={confirmDialog} onCancel={closeConfirmDialog} />
    </div>
  );
}
