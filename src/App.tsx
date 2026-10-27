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
  LayoutDashboard,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
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
  DEFAULT_LINE_SETTINGS,
  INITIAL_CATEGORIES,
  INITIAL_LINE_LOGS,
  INITIAL_TEAM_MEMBERS,
  getInitialTasks,
} from './data/initialData';
import { getAccessToken, googleSignIn, initAuth, logout } from './services/auth';
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

type ActiveSection =
  | 'dashboard'
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

  // Shared Workspace ID (supports ?workspace=... URL param for shared calendar links)
  const [workspaceId] = useState<string>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
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

  // Core data state (persisted locally and synced with Google Sheets & Shared Workspace)
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore parse error
    }
    return getInitialTasks();
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
      if (saved) return { ...DEFAULT_LINE_SETTINGS, ...JSON.parse(saved) };
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
    return null;
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

  // Save local backup whenever state changes
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
    // Sync token & targetUserId to server so real LINE Webhook can auto-reply
    fetch('/api/line/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelAccessToken: lineSettings.channelAccessToken,
        targetUserId: lineSettings.targetUserId,
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

  // Push collaborative workspace state to server so shared calendar collaborators stay in sync
  const pushCollaborativeWorkspace = useCallback(
    async (
      nextTasks: Task[],
      nextCategories: Category[],
      nextMembers: TeamMember[]
    ) => {
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
              tasks: nextTasks,
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
    },
    [sheetMeta?.spreadsheetId, sheetMeta?.spreadsheetUrl, user?.email, workspaceId]
  );

  // Poll shared workspace every 5 seconds for real-time collaborative updates
  useEffect(() => {
    let isMounted = true;

    const syncFromSharedWorkspace = async () => {
      try {
        const res = await fetch(
          `/api/collab/workspace/${encodeURIComponent(workspaceId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        if (!data.exists) {
          // Seed initial workspace state on server
          await pushCollaborativeWorkspace(tasks, categories, teamMembers);
          return;
        }

        const remote = data.workspace;
        if (
          remote?.updatedAt &&
          remote.updatedAt !== lastSyncedTimestampRef.current
        ) {
          lastSyncedTimestampRef.current = remote.updatedAt;
          setLastCollabSyncAt(remote.updatedAt);

          if (Array.isArray(remote.tasks) && remote.tasks.length > 0) {
            setTasks(remote.tasks as Task[]);
          }
          if (Array.isArray(remote.categories) && remote.categories.length > 0) {
            setCategories(remote.categories as Category[]);
          }
          if (Array.isArray(remote.teamMembers) && remote.teamMembers.length > 0) {
            setTeamMembers(remote.teamMembers as TeamMember[]);
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    };

    syncFromSharedWorkspace();
    const timer = setInterval(syncFromSharedWorkspace, 5000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [workspaceId, pushCollaborativeWorkspace, tasks, categories, teamMembers]);

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
      deletedTaskId?: string,
      nextTeamMembers: TeamMember[] = teamMembers
    ) => {
      await pushCollaborativeWorkspace(nextTasks, nextCategories, nextTeamMembers);

      const token = await getAccessToken();
      if (!token || !sheetMeta?.spreadsheetId) {
        if (sheetMeta?.spreadsheetId && !token) {
          setNeedsAuth(true);
        }
        return;
      }
      setIsSyncing(true);
      try {
        let mergedTasks = nextTasks;
        let mergedLogs = nextLogs;
        try {
          const remote = await fetchDatabaseFromSheet(token, sheetMeta.spreadsheetId);
          const localIds = new Set(nextTasks.map((t) => t.id));
          const remoteOnlyTasks = remote.tasks.filter(
            (rt) => !localIds.has(rt.id) && rt.id !== deletedTaskId
          );
          if (remoteOnlyTasks.length > 0) {
            mergedTasks = [...remoteOnlyTasks, ...nextTasks];
            setTasks(mergedTasks);
          }
          const localLogIds = new Set(nextLogs.map((l) => l.id));
          const remoteOnlyLogs = remote.logs.filter((rl) => !localLogIds.has(rl.id));
          if (remoteOnlyLogs.length > 0) {
            mergedLogs = [...nextLogs, ...remoteOnlyLogs];
            setLineLogs(mergedLogs);
          }
        } catch {
          // Proceed with local state if remote pre-fetch fails
        }

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
    [pushCollaborativeWorkspace, sheetMeta, showNotice, teamMembers]
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

      if (result.tasks.length > 0 || result.categories.length > 0) {
        if (result.tasks.length > 0) setTasks(result.tasks);
        if (result.categories.length > 0) setCategories(result.categories);
        if (result.logs.length > 0) setLineLogs(result.logs);
        if (result.teamMembers.length > 0) setTeamMembers(result.teamMembers);
        showNotice(
          'success',
          `เชื่อมต่อและดึงข้อมูลจาก "${result.metadata.title}" สำเร็จ (${result.tasks.length} งาน · สมาชิก ${
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

  // Dispatch LINE OA notification (Real Messaging API Push/Broadcast if token configured + Simulator log)
  const dispatchLineReminder = useCallback(
    async (task: Task, isManualTrigger = false) => {
      if (!isManualTrigger) {
        const triggerCheck = doesTaskTriggerNotification(task, lineSettings);
        if (!triggerCheck.allowed) return;
      }

      const cat = categories.find((c) => c.id === task.categoryId);
      const categoryName = cat?.name || 'ทั่วไป';
      const formatMode = lineSettings.messageFormat || 'executive_flex';
      const includeDesc = lineSettings.includeDescriptionInNotification !== false;
      const remindLabel = formatRemindMinutesLabel(
        task.remindMinutesBefore || lineSettings.defaultRemindMinutes || 60
      );

      const sameDayTasks = tasks.filter((t) => t.date === task.date);
      const summaryTasks = sameDayTasks.length > 0 ? sameDayTasks : tasks;
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
              text: reminderText,
              taskTitle: task.title,
              description: includeDesc ? task.description || reminderText : '',
              date: task.date,
              time: task.time,
              dateTime: `${task.date} ${task.time} น.`,
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
          const savedGasUrl = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
          if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
            const gasPayload = JSON.stringify({
              action: 'push_line',
              channelAccessToken: lineSettings.channelAccessToken.trim(),
              to: lineSettings.targetUserId.trim(),
              text: reminderText,
              taskTitle: task.title,
              description: includeDesc ? task.description || reminderText : '',
              date: task.date,
              time: task.time,
              dateTime: `${task.date} ${task.time} น.`,
              categoryName,
              categoryColor: cat?.color || '#2563EB',
              priority: task.priority,
              messageFormat: formatMode,
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
          dateTime: `${task.date} · ${task.time} น.`,
          date: task.date,
          time: task.time,
          categoryName,
          categoryColor: cat?.color || '#2563EB',
          priorityLabel: priorityLabelText,
          remindLabel,
          description: task.description,
          formatMode,
          includeGoogleCalendarButton:
            lineSettings.includeGoogleCalendarButton !== false,
          stats: summaryStats,
        },
      };

      const nextLogs = [...lineLogs, newLog];
      const nextTasks = tasks.map((t) =>
        t.id === task.id ? { ...t, lineNotified: true, updatedAt: new Date().toISOString() } : t
      );

      setLineLogs(nextLogs);
      setTasks(nextTasks);

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
    },
    [
      categories,
      lineLogs,
      lineSettings,
      sheetMeta?.spreadsheetId,
      showNotice,
      spreadsheetInput,
      tasks,
      workspaceId,
    ]
  );

  // Automatic Background Check for Upcoming Tasks based on customizable timing & task trigger rules (runs every 30s)
  useEffect(() => {
    if (!lineSettings.enabled) return;

    const timer = setInterval(() => {
      const now = new Date();
      const maxConfiguredTiming = Math.max(
        ...(Array.isArray(lineSettings.reminderTimings) && lineSettings.reminderTimings.length > 0
          ? lineSettings.reminderTimings
          : [lineSettings.defaultRemindMinutes || 60])
      );

      for (const task of tasks) {
        if (task.status === TaskStatus.COMPLETED || task.lineNotified) {
          continue;
        }
        // Check if task matches user-selected priority, category, status, and source triggers
        if (!doesTaskTriggerNotification(task, lineSettings).allowed) {
          continue;
        }

        const taskDateTime = new Date(`${task.date}T${task.time}:00`);
        if (isNaN(taskDateTime.getTime())) continue;

        const diffMinutes = (taskDateTime.getTime() - now.getTime()) / (1000 * 60);
        const effectiveThreshold = Math.max(task.remindMinutesBefore || 0, maxConfiguredTiming);

        if (diffMinutes > 0 && effectiveThreshold > 0 && diffMinutes <= effectiveThreshold) {
          dispatchLineReminder(task, false);
          break;
        }

        // Also check overdue alert if enabled
        if (
          lineSettings.notifyOnOverdue !== false &&
          diffMinutes <= 0 &&
          diffMinutes >= -1440
        ) {
          dispatchLineReminder(task, false);
          break;
        }
      }
    }, 30000);

    return () => clearInterval(timer);
  }, [lineSettings, tasks, dispatchLineReminder]);

  // Delete Task (Always requires explicit confirmation)
  const handleDeleteTask = useCallback(
    (task: Task) => {
      setConfirmDialog({
        isOpen: true,
        title: 'ยืนยันการลบรายการงานนี้ออกจากระบบและ Google Sheets?',
        description:
          'เมื่อลบแล้ว รายการงานนี้จะถูกนำออกจากปฏิทินของทีมและลบออกจากแท็บ Tasks ใน Google Sheets ของคุณ',
        affectedItemSummary: `ลบงาน: "${task.title}" (กำหนดวันที่ ${task.date} เวลา ${task.time} น.)`,
        confirmLabel: 'ลบรายการงาน',
        isDestructive: true,
        onConfirm: async () => {
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
            await pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
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
      sheetMeta,
      showNotice,
      syncAllToConnectedSheet,
      tasks,
      teamMembers,
    ]
  );

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
            } (วันที่ ${created.date} เวลา ${created.time} น.) ลงปฏิทินเรียบร้อยแล้ว!`,
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
            const savedGasUrl = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
            if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
              try {
                await fetch(savedGasUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                  body: JSON.stringify({
                    action: 'push_line',
                    channelAccessToken: lineSettings.channelAccessToken.trim(),
                    to: lineSettings.targetUserId.trim(),
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
      lineSettings.targetUserId,
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

  // Poll real LINE Webhook events from /api/line/webhook-events every 4 seconds
  useEffect(() => {
    const pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/line/webhook-events');
        if (!res.ok) return;
        const data = await res.json();
        if (data.detectedUserId && !lineSettings.targetUserId) {
          setLineSettings((prev) => ({
            ...prev,
            targetUserId: data.detectedUserId,
          }));
        }
        if (Array.isArray(data.events) && data.events.length > 0) {
          for (const ev of data.events) {
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
  }, [handleSendLineChatCommand, lineSettings.targetUserId]);

  // Background Auto-Pull from Google Sheets every 6 seconds so tasks added via real LINE App (Google Apps Script Webhook) appear in Calendar automatically
  useEffect(() => {
    if (!sheetMeta?.spreadsheetId || !accessToken || isSyncing) return;

    const sheetPollTimer = setInterval(async () => {
      try {
        const token = await getAccessToken();
        if (!token || !sheetMeta?.spreadsheetId) return;

        const remote = await fetchDatabaseFromSheet(token, sheetMeta.spreadsheetId);
        if (!remote.tasks || remote.tasks.length === 0) return;

        const currentIds = new Set(tasks.map((t) => t.id));
        const newlyAddedFromSheet = remote.tasks.filter((rt) => !currentIds.has(rt.id));

        if (newlyAddedFromSheet.length > 0) {
          const newest = newlyAddedFromSheet[0];
          setTasks((prev) => {
            const existing = new Set(prev.map((p) => p.id));
            const toAdd = newlyAddedFromSheet.filter((n) => !existing.has(n.id));
            return toAdd.length > 0 ? [...toAdd, ...prev] : prev;
          });

          if (remote.logs && remote.logs.length > 0) {
            setLineLogs((prev) => {
              const existingLogIds = new Set(prev.map((l) => l.id));
              const newLogs = remote.logs.filter((rl) => !existingLogIds.has(rl.id));
              return newLogs.length > 0 ? [...prev, ...newLogs] : prev;
            });
          }

          setSelectedCalendarDate(newest.date);
          showNotice(
            'success',
            `ซิงค์งานใหม่จาก LINE OA: "${newest.title}" (วันที่ ${newest.date} เวลา ${newest.time} น.) เข้าสู่ปฏิทินอัตโนมัติแล้ว!`,
            newest.date
          );
        }
      } catch {
        // Silent background check
      }
    }, 6000);

    return () => clearInterval(sheetPollTimer);
  }, [accessToken, isSyncing, sheetMeta?.spreadsheetId, showNotice, tasks]);

  // Save (Create or Edit) Task
  const handleSaveTask = (
    taskData: Omit<Task, 'id' | 'updatedAt' | 'lineNotified'>,
    existingId?: string
  ) => {
    if (existingId) {
      const target = tasks.find((t) => t.id === existingId);
      const updatedTask: Task = {
        ...taskData,
        id: existingId,
        lineNotified: target?.lineNotified || false,
        updatedAt: new Date().toISOString(),
      };
      const nextTasks = tasks.map((t) => (t.id === existingId ? updatedTask : t));

      if (sheetMeta && accessToken) {
        setConfirmDialog({
          isOpen: true,
          title: 'ยืนยันการแก้ไขข้อมูลงานใน Google Sheets?',
          description:
            'การแก้ไขรายละเอียดงานนี้จะทำการอัปเดตข้อมูลแถวงานในแท็บ Tasks บนไฟล์ Google Sheets ของคุณ',
          affectedItemSummary: `แก้ไขงาน: "${updatedTask.title}" (วันที่ ${updatedTask.date} เวลา ${updatedTask.time} น.)`,
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

    if (sheetMeta && accessToken) {
      setConfirmDialog({
        isOpen: true,
        title: 'ยืนยันการเปลี่ยนสถานะงานใน Google Sheets?',
        description:
          'ระบบจะทำการอัปเดตสถานะของงานนี้ในแท็บ Tasks บนไฟล์ Google Sheets ของคุณ',
        affectedItemSummary: `งาน "${task.title}" เปลี่ยนสถานะเป็น "${
          nextStatus === TaskStatus.COMPLETED
            ? 'เสร็จสิ้นแล้ว (Completed)'
            : nextStatus === TaskStatus.IN_PROGRESS
            ? 'กำลังดำเนินการ (In Progress)'
            : 'รอดำเนินการ (Pending)'
        }"`,
        confirmLabel: 'ยืนยันอัปเดตสถานะ',
        isDestructive: false,
        onConfirm: async () => {
          setTasks(nextTasks);
          await syncAllToConnectedSheet(
            nextTasks,
            categories,
            lineLogs,
            `อัปเดตสถานะงาน "${task.title}" ลง Google Sheets เรียบร้อยแล้ว`,
            undefined,
            undefined,
            teamMembers
          );
          closeConfirmDialog();
        },
      });
    } else {
      setTasks(nextTasks);
      pushCollaborativeWorkspace(nextTasks, categories, teamMembers);
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
        const savedGasUrl = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
        if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
          const gasPayload = JSON.stringify({
            action: 'push_line',
            channelAccessToken: lineSettings.channelAccessToken.trim(),
            to: lineSettings.targetUserId.trim(),
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
      'สรุปงานตามเวลา',
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
        const savedGasUrl = (localStorage.getItem('sheetcal_gas_url_v1') || '').trim();
        if (savedGasUrl.startsWith('https://script.google.com/macros/s/')) {
          const gasPayload = JSON.stringify({
            action: 'push_line',
            channelAccessToken: lineSettings.channelAccessToken.trim(),
            to: lineSettings.targetUserId.trim(),
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
    if (isNew) {
      const nextCategories = [...categories, category];
      setCategories(nextCategories);
      if (sheetMeta && accessToken) {
        syncAllToConnectedSheet(
          tasks,
          nextCategories,
          lineLogs,
          `เพิ่มหมวดหมู่ "${category.name}" ลงใน Google Sheets เรียบร้อยแล้ว`
        );
      } else {
        showNotice('success', `เพิ่มหมวดหมู่ "${category.name}" เรียบร้อยแล้ว`);
      }
    } else {
      const nextCategories = categories.map((c) => (c.id === category.id ? category : c));
      if (sheetMeta && accessToken) {
        setConfirmDialog({
          isOpen: true,
          title: 'ยืนยันการแก้ไขหมวดหมู่งานใน Google Sheets?',
          description:
            'ระบบจะทำการอัปเดตชื่อ สี และคำอธิบายของหมวดหมู่นี้ในแท็บ Categories บน Google Sheets ของคุณ',
          affectedItemSummary: `หมวดหมู่ "${category.name}" (สี ${category.color})`,
          confirmLabel: 'ยืนยันการแก้ไข',
          isDestructive: false,
          onConfirm: async () => {
            setCategories(nextCategories);
            await syncAllToConnectedSheet(
              tasks,
              nextCategories,
              lineLogs,
              `อัปเดตหมวดหมู่ "${category.name}" ลงใน Google Sheets เรียบร้อยแล้ว`
            );
            closeConfirmDialog();
          },
        });
      } else {
        setCategories(nextCategories);
        showNotice('success', `แก้ไขหมวดหมู่ "${category.name}" เรียบร้อยแล้ว`);
      }
    }
  };

  const handleDeleteCategory = (category: Category) => {
    if (categories.length <= 1) return;
    const fallbackCategory = categories.find((c) => c.id !== category.id) || categories[0];

    setConfirmDialog({
      isOpen: true,
      title: 'ยืนยันการลบหมวดหมู่งานออกจากระบบและ Google Sheets?',
      description: `หมวดหมู่ "${category.name}" จะถูกลบออกจากแท็บ Categories และงานที่อยู่ในหมวดหมู่นี้จะถูกย้ายไปยังหมวดหมู่ "${fallbackCategory.name}" อัตโนมัติ`,
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
            `ลบหมวดหมู่ "${category.name}" ออกจาก Google Sheets เรียบร้อยแล้ว`
          );
        }
        closeConfirmDialog();
      },
    });
  };

  // Computed Dashboard Metrics
  const metrics = useMemo(() => {
    const todayTasks = tasks.filter((t) => t.date === todayStr);
    const pendingTasks = tasks.filter((t) => t.status !== TaskStatus.COMPLETED);
    const overdueTasks = pendingTasks.filter((t) => t.date < todayStr);
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
        if (taskFilter === 'today' && t.date !== todayStr) return false;
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
          return (
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.date.includes(q)
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
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900">
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
              setActiveSection('team');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'team'
                ? 'text-emerald-600 underline underline-offset-8 decoration-2 decoration-emerald-600 font-semibold'
                : 'hover:text-emerald-600'
            }`}
          >
            ทีมที่ใช้ปฏิทินร่วมกัน ({teamMembers.length})
          </a>
          <a
            href="#line"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('line');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'line'
                ? 'text-[#06C755] underline underline-offset-8 decoration-2 decoration-[#06C755] font-semibold'
                : 'hover:text-[#06C755]'
            }`}
          >
            แจ้งเตือน & สั่งงาน LINE
          </a>
          <a
            href="#database"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('database');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeSection === 'database' || activeSection === 'categories'
                ? 'text-violet-600 underline underline-offset-8 decoration-2 decoration-violet-600 font-semibold'
                : 'hover:text-violet-600'
            }`}
          >
            ฐานข้อมูล Google Sheets
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
          onClick={() => setActiveSection('team')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'team'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          <span>ทีมที่ใช้ปฏิทินร่วมกัน</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('line')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'line'
              ? 'bg-[#06C755] text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
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
          onClick={() => setActiveSection('database')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'database'
              ? 'bg-violet-600 text-white'
              : 'text-slate-600 bg-slate-100'
          }`}
        >
          <Cloud className="h-3.5 w-3.5" />
          <span>Google Sheets</span>
        </button>
      </div>

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
              <span>เชื่อมต่อ Google Sheets เพื่อสำรองข้อมูลและใช้ตารางงานร่วมกับทีม</span>
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
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {needsAuth ? (
              <GoogleSignInButton
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                label={isLoggingIn ? 'กำลังเชื่อมต่อ...' : 'Sign in with Google'}
              />
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
                      onClick={handlePullFromSheets}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`}
                      />
                      <span>ซิงค์ข้อมูลล่าสุด</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSyncing}
                      onClick={handlePushToSheetsWithConfirm}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Cloud className="h-3 w-3" />
                      <span>บันทึกขึ้น Sheets</span>
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
            className={`rounded-lg border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-4 ${
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
                  <span>ดูในปฏิทิน ({statusBanner.calendarDateToOpen})</span>
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
            {/* 4-Column Vibrant KPI Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl p-5 shadow-2xs">
                <div className="text-xs font-semibold text-indigo-700">
                  งานวันนี้
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-indigo-600 font-mono-tabular">
                    {metrics.todayCount}
                  </span>
                  <span className="text-xs text-slate-600 font-mono-tabular font-medium">
                    ค้าง {metrics.todayPendingCount} รายการ
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 border-t-4 border-t-amber-500 rounded-xl p-5 shadow-2xs">
                <div className="text-xs font-semibold text-amber-700">
                  งานค้างทั้งหมด
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-amber-600 font-mono-tabular">
                    {metrics.pendingCount}
                  </span>
                  <span className="text-xs text-rose-600 font-mono-tabular font-semibold">
                    เลยกำหนด {metrics.overdueCount} งาน
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 shadow-2xs">
                <div className="text-xs font-semibold text-emerald-700">
                  งานที่ทำเสร็จแล้ว
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-emerald-600 font-mono-tabular">
                    {metrics.completedCount}
                  </span>
                  <span className="text-xs text-emerald-700 font-mono-tabular font-semibold">
                    สำเร็จ {metrics.completionRate}%
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 border-t-4 border-t-rose-500 rounded-xl p-5 shadow-2xs">
                <div className="text-xs font-semibold text-rose-700">
                  งานความสำคัญสูง
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-rose-600 font-mono-tabular">
                    {metrics.highPriorityCount}
                  </span>
                  <span className="text-xs text-rose-600 font-medium">รายการเร่งด่วน</span>
                </div>
              </div>
            </div>

            {/* Clean Quick Natural-Language LINE Command Input Bar with Vibrant Accent */}
            <div className="bg-gradient-to-r from-emerald-50/70 via-white to-teal-50/50 border border-emerald-200 border-l-4 border-l-[#06C755] rounded-xl p-4 shadow-2xs">
              <form
                onSubmit={handleQuickLineSubmit}
                className="flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#06C755] text-white text-[10px] font-bold shadow-2xs">
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
                  placeholder='พิมพ์ชื่องานพร้อมวันเวลา เช่น "ประชุมสรุปแผนงาน พรุ่งนี้ 10:30 #สูง"...'
                  className="flex-1 rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#06C755] focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] shadow-2xs transition-colors whitespace-nowrap shrink-0"
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
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-2xs transition-colors whitespace-nowrap shrink-0"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>📊 ส่งการ์ดสรุปงานเข้า LINE</span>
                </button>
              </form>
            </div>

            {/* Main Dashboard Split: Clean Task List (8 cols) + Shared Calendar & Categories Sidebar (4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 Columns: Task Management Table */}
              <div className="lg:col-span-8 bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl overflow-hidden shadow-2xs">
                <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50/40 via-white to-slate-50/40 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-slate-900">
                      รายการงานในปฏิทินของทีม
                    </h2>

                    {/* Interactive Filter Tabs */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
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
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            taskFilter === tab.id
                              ? 'bg-indigo-600 text-white font-semibold shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
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
                        placeholder="ค้นหาชื่องาน รายละเอียด หรือวันที่ (YYYY-MM-DD)..."
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
                      const isOverdue = !isDone && task.date < todayStr;
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
                                  {task.date} เวลา {task.time} น.
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
                <div className="bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 shadow-2xs">
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
                            className="h-6 w-6 rounded-md text-white font-bold text-[11px] inline-flex items-center justify-center shrink-0"
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
                <div className="bg-white border border-slate-200 border-t-4 border-t-violet-500 rounded-xl p-5 shadow-2xs">
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
            onToggleStatus={handleToggleTaskStatus}
            onSendLineReminderNow={(task) => dispatchLineReminder(task, true)}
          />
        )}

        {activeSection === 'team' && (
          <TeamCollaborationView
            tasks={tasks}
            categories={categories}
            teamMembers={teamMembers}
            workspaceId={workspaceId}
            spreadsheetId={sheetMeta?.spreadsheetId}
            spreadsheetUrl={sheetMeta?.spreadsheetUrl}
            lastCollabSyncAt={lastCollabSyncAt}
            onInviteMember={handleInviteMember}
            onUpdateMemberRole={handleUpdateMemberRole}
            onRemoveMember={handleRemoveMember}
          />
        )}

        {activeSection === 'line' && (
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
          />
        )}

        {activeSection === 'database' && (
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
      <footer className="border-t border-slate-200 bg-white px-6 py-4 mt-12">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            SheetCal LINE — ระบบปฏิทินตารางงานร่วมกันของทีม แจ้งเตือนผ่าน LINE OA และฐานข้อมูล Google Sheets
          </span>
          <div className="flex items-center gap-4">
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
