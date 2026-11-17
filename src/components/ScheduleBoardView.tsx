import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Building2,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  Edit3,
  MapPin,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Palette,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sun,
  Sunset,
  Tv,
  Users,
  X,
} from 'lucide-react';
import {
  Category,
  DirectorPresenceMode,
  DirectorPresenceState,
  Task,
  TaskPriority,
  TaskStatus,
} from '../types';
import {
  formatLocalDateYMD,
  formatLocalTimeHM,
  formatSummaryCardHeaderDate,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  getTaskDurationDays,
  inferTaskEndDate,
  isTaskActiveOnDate,
} from '../services/lineCommandParser';
import { ROBOT_MASCOT_DATA_URI } from '../assets/robotMascotDataUri';
import {
  ensureInternetTimeAutoSync,
  getInternetNow,
  getInternetNowMs,
  onInternetTimeSync,
} from '../services/internetTimeService';
import {
  BoardRemoteSettings,
  TvScreenHeartbeat,
  announceTvScreenPresence,
  broadcastBoardSettingsChange,
  broadcastLocalPresenceChange,
  getClientTabId,
  pushFullStateToTvScreens,
  readLocalBoardSettings,
  readLocalDirectorPresence,
  requestConnectedTvPing,
  sendTvRemoteCommand,
  subscribeRealtimeEvents,
  writeLocalDirectorPresence,
} from '../services/realtimeSync';

interface ScheduleBoardViewProps {
  tasks: Task[];
  categories: Category[];
  onAddTaskForDate: (dateStr: string) => void;
  onEditTask: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onUpdateStatus?: (task: Task, nextStatus: TaskStatus) => void;
  onOpenCalendarDate: (dateStr: string) => void;
  onPresenceStaticSync?: () => void;
  onForcePushRealtimeToTv?: (currentBoardSettings: BoardRemoteSettings) => void;
}

type BoardRangeMode = 'upcoming' | 'today' | 'week7' | 'all';
type BoardLayoutMode = 'grouped_by_day' | 'split_two_column' | 'single_day' | 'master_table';
type BoardThemeMode = 'light' | 'dark' | 'navy_gold' | 'emerald_exec';

function isExternalOffsiteTask(task: Task): boolean {
  const text = `${task.title || ''} ${task.description || ''}`;
  if (/สบต\.|สำนักบริหารแรงงานต่างด้าว|ห้องประชุมเทียน/i.test(text)) {
    return false;
  }
  return /เดินทางไป|ไปราชการ|ไปพบ|ไปตึก|กระทรวง|ต่างประเทศ|ต่างจังหวัด|นอกสถานที่|ลงพื้นที่|ตรวจเยี่ยม|ศรีลังกา|ลาว|ญี่ปุ่น|กัมพูชา|เมียนมา|เวียดนาม|ร้อยเอ็ด|เชียงใหม่|ภูเก็ต|ชลบุรี|สนามบิน|ทำเนียบรัฐบาล|รัฐสภา|โรงแรม/i.test(
    text
  );
}

const THAI_WEEKDAY_FULL = [
  'วันอาทิตย์',
  'วันจันทร์',
  'วันอังคาร',
  'วันพุธ',
  'วันพฤหัสบดี',
  'วันศุกร์',
  'วันเสาร์',
];

function formatFullThaiDayHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return formatThaiDateDisplay(ymd, 'long');
  const dt = new Date(y, m - 1, d);
  const dow = THAI_WEEKDAY_FULL[dt.getDay()] || '';
  return `${dow}ที่ ${formatThaiDateDisplay(ymd, 'long')}`;
}

function getRelativeDayLabel(ymd: string, todayStr: string): {
  text: string;
  tone: 'today' | 'tomorrow' | 'future' | 'past';
} {
  if (ymd === todayStr) {
    return { text: 'วันนี้', tone: 'today' };
  }
  const [y1, m1, d1] = todayStr.split('-').map(Number);
  const [y2, m2, d2] = ymd.split('-').map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  const diffDays = Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) {
    return { text: 'พรุ่งนี้', tone: 'tomorrow' };
  }
  if (diffDays === 2) {
    return { text: 'มะรืนนี้', tone: 'future' };
  }
  if (diffDays > 2) {
    return { text: `อีก ${diffDays} วัน`, tone: 'future' };
  }
  if (diffDays === -1) {
    return { text: 'เมื่อวานนี้', tone: 'past' };
  }
  return { text: `ผ่านมาแล้ว ${Math.abs(diffDays)} วัน`, tone: 'past' };
}

function addDaysYMD(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const ry = dt.getFullYear();
  const rm = String(dt.getMonth() + 1).padStart(2, '0');
  const rd = String(dt.getDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

function enumerateTaskDates(task: Task): string[] {
  if (!task.date) return [];
  if (!task.endDate || task.endDate <= task.date) {
    return [task.date];
  }
  const dates: string[] = [];
  let cursor = task.date;
  let guard = 0;
  while (cursor <= task.endDate && guard < 60) {
    dates.push(cursor);
    cursor = addDaysYMD(cursor, 1);
    guard++;
  }
  return dates;
}

function getReadableCategoryColor(hexColor: string, isDark: boolean): string {
  if (!isDark) return hexColor;
  const clean = (hexColor || '#2563EB').replace('#', '').trim();
  if (clean.length !== 6) return '#38BDF8';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#38BDF8';

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  // Shift deep blue/indigo hues (205°-265°) toward bright sky-cyan so they never blend with dark slate
  if (h >= 205 && h <= 265) {
    return '#38BDF8';
  }

  const targetS = Math.max(Math.round(s * 100), 85);
  const targetL = Math.max(Math.round(l * 100), 74);
  return `hsl(${Math.round(h)}, ${targetS}%, ${targetL}%)`;
}

function extractLocationFromText(title: string, description?: string): string | null {
  const combined = `${title || ''} ${description || ''}`.trim();
  if (!combined) return null;
  const match = combined.match(
    /(?:ณ\.?\s+|ณ\.(?=\S)|สถานที่\s*:?\s*|ห้องประชุม\s*|ชั้น\s*\d+\s*อาคาร\s*)([^|\n•,]{3,65})/i
  );
  if (match && match[0]) {
    const cleaned = match[0]
      .replace(/^(?:สถานที่\s*:?\s*|ณ\.?\s*)/i, '')
      .trim();
    return cleaned || null;
  }
  return null;
}

interface DayGroupEntry {
  date: string;
  items: Array<{
    task: Task;
    displayDate: string;
    dayIndexOfSpan: number;
    totalSpanDays: number;
    timeRangeLabel?: string;
  }>;
}

interface TvStageMetrics {
  viewportW: number;
  viewportH: number;
  stageW: number;
  stageH: number;
  scale: number;
  isLandscape: boolean;
}

function detectAutoTvEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const tvParam = (
      params.get('tv') ||
      params.get('present') ||
      params.get('mode') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (tvParam === '1' || tvParam === 'true' || tvParam === 'tv') {
      return true;
    }
    const ua = String(window.navigator?.userAgent || '');
    if (
      /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|BRAVIA|AFTB|AFTT|AFTS|AFTM|AFTR|Android TV|GoogleTV|Viera|CrKey|MiBOX/i.test(
        ua
      )
    ) {
      return true;
    }
  } catch {
    // Ignore environment read error
  }
  return false;
}

function computeTvStageMetrics(): TvStageMetrics {
  if (typeof window === 'undefined') {
    return {
      viewportW: 1920,
      viewportH: 1080,
      stageW: 1920,
      stageH: 1080,
      scale: 1,
      isLandscape: true,
    };
  }
  const vw = Math.max(
    320,
    Math.round(window.visualViewport?.width || window.innerWidth || 1920)
  );
  const vh = Math.max(
    320,
    Math.round(window.visualViewport?.height || window.innerHeight || 1080)
  );
  const isLandscape = vw >= vh;
  const refW = isLandscape ? 1920 : 1080;
  const refH = isLandscape ? 1080 : 1920;
  const rawScale = Math.min(vw / refW, vh / refH);
  const clampedScale = Math.min(2.5, Math.max(0.45, rawScale));
  const finalScale = Math.abs(clampedScale - 1) < 0.015 ? 1 : Number(clampedScale.toFixed(4));
  return {
    viewportW: vw,
    viewportH: vh,
    stageW: Math.round(vw / finalScale),
    stageH: Math.round(vh / finalScale),
    scale: finalScale,
    isLandscape,
  };
}

const LiveBangkokClockDisplay: React.FC<{
  isLargeText: boolean;
  isNavyGold: boolean;
  isDarkDisplay: boolean;
  isEmeraldExec: boolean;
  isTvStageActive?: boolean;
}> = React.memo(({ isLargeText, isNavyGold, isDarkDisplay, isEmeraldExec, isTvStageActive }) => {
  const [clockTick, setClockTick] = useState<Date>(() => getInternetNow());

  useEffect(() => {
    ensureInternetTimeAutoSync();
    let timeoutId: number | undefined;
    let cancelled = false;

    const scheduleNextSecond = () => {
      if (cancelled) return;
      const nowMs = getInternetNowMs();
      setClockTick(new Date(nowMs));
      const delayMs = Math.max(50, 1005 - (nowMs % 1000));
      timeoutId = window.setTimeout(scheduleNextSecond, delayMs);
    };

    scheduleNextSecond();

    const unsubscribe = onInternetTimeSync(() => {
      if (cancelled) return;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      scheduleNextSecond();
    });

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const [hh, mm, ss] = useMemo(() => {
    try {
      const str = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(clockTick);
      const parts = str.split(':');
      if (parts.length === 3) return [parts[0], parts[1], parts[2]];
      return [parts[0] || '00', parts[1] || '00', '00'];
    } catch {
      const fallback = formatLocalTimeHM(clockTick).split(':');
      return [fallback[0] || '00', fallback[1] || '00', '00'];
    }
  }, [clockTick]);

  const hmSizeClasses = isTvStageActive
    ? isLargeText
      ? 'text-[62px]'
      : 'text-[52px]'
    : isLargeText
    ? 'text-5xl sm:text-6xl md:text-[64px]'
    : 'text-4xl sm:text-5xl md:text-[54px]';

  const secSizeClasses = isTvStageActive
    ? isLargeText
      ? 'text-[34px]'
      : 'text-[28px]'
    : isLargeText
    ? 'text-2xl sm:text-3xl md:text-[36px]'
    : 'text-xl sm:text-2xl md:text-[30px]';

  const primaryDigitColor = isNavyGold || isDarkDisplay
    ? 'text-white'
    : isEmeraldExec
    ? 'text-emerald-950'
    : 'text-slate-950';

  const colonColor = isNavyGold
    ? 'text-amber-400'
    : isDarkDisplay
    ? 'text-sky-400'
    : isEmeraldExec
    ? 'text-emerald-600'
    : 'text-indigo-600';

  const secColor = isNavyGold
    ? 'text-amber-200/90'
    : isDarkDisplay
    ? 'text-sky-300/90'
    : isEmeraldExec
    ? 'text-emerald-700/85'
    : 'text-indigo-700/85';

  return (
    <span className="inline-flex items-baseline font-sans tabular-nums leading-none select-none">
      <span className={`font-black tracking-tight ${hmSizeClasses} ${primaryDigitColor}`}>
        {hh}
      </span>
      <span
        aria-hidden="true"
        className={`mx-1 sm:mx-1.5 -translate-y-[3px] inline-block font-extrabold ${hmSizeClasses} ${colonColor}`}
      >
        :
      </span>
      <span className={`font-black tracking-tight ${hmSizeClasses} ${primaryDigitColor}`}>
        {mm}
      </span>
      <span className={`ml-1.5 font-bold tracking-tight ${secSizeClasses} ${secColor}`}>
        :{ss}
      </span>
    </span>
  );
});

export const ScheduleBoardView: React.FC<ScheduleBoardViewProps> = ({
  tasks,
  categories,
  onAddTaskForDate,
  onEditTask,
  onToggleStatus,
  onUpdateStatus,
  onOpenCalendarDate,
  onPresenceStaticSync,
  onForcePushRealtimeToTv,
}) => {
  // Update minute-level state from Internet Standard Time only when HH:mm or YYYY-MM-DD changes
  const [nowDate, setNowDate] = useState<Date>(() => getInternetNow());
  const todayStr = useMemo(() => formatLocalDateYMD(nowDate), [nowDate]);
  const nowHM = useMemo(() => formatLocalTimeHM(nowDate), [nowDate]);

  useEffect(() => {
    ensureInternetTimeAutoSync();
    const syncMinuteState = () => {
      const next = getInternetNow();
      setNowDate((prev) =>
        formatLocalTimeHM(prev) !== formatLocalTimeHM(next) ||
        formatLocalDateYMD(prev) !== formatLocalDateYMD(next)
          ? next
          : prev
      );
    };

    const unsubscribe = onInternetTimeSync(() => {
      syncMinuteState();
    });
    const timer = window.setInterval(syncMinuteState, 10000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const initialBoardSettings = useMemo(() => readLocalBoardSettings(), []);
  const [rangeMode, setRangeMode] = useState<BoardRangeMode>(
    () => initialBoardSettings?.rangeMode || 'upcoming'
  );
  const [layoutMode, setLayoutMode] = useState<BoardLayoutMode>(
    () => initialBoardSettings?.layoutMode || 'grouped_by_day'
  );
  const [focusDate, setFocusDate] = useState<string>(() => {
    const savedFocus = initialBoardSettings?.focusDate;
    if (savedFocus && /^\d{4}-\d{2}-\d{2}$/.test(savedFocus) && savedFocus >= todayStr) {
      return savedFocus;
    }
    return formatLocalDateYMD();
  });
  const prevTodayStrRef = useRef<string>(todayStr);
  const isRemoteBoardApplyRef = useRef<boolean>(false);
  const hasMountedBoardSyncRef = useRef<boolean>(false);
  const lastBoardSettingsUpdatedAtRef = useRef<string>(initialBoardSettings?.updatedAt || '');

  // Automatically advance focusDate at midnight when a TV screen is left running 24/7
  useEffect(() => {
    if (prevTodayStrRef.current !== todayStr) {
      const oldToday = prevTodayStrRef.current;
      prevTodayStrRef.current = todayStr;
      isRemoteBoardApplyRef.current = true;
      setFocusDate((prevFocus) => (prevFocus === oldToday ? todayStr : prevFocus));
    }
  }, [todayStr]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    () => initialBoardSettings?.selectedCategoryId || 'all'
  );
  const [selectedPriority, setSelectedPriority] = useState<string>(
    () => initialBoardSettings?.selectedPriority || 'all'
  );
  const [showCompleted, setShowCompleted] = useState<boolean>(() =>
    initialBoardSettings ? initialBoardSettings.showCompleted : true
  );
  const [expandMultiDay, setExpandMultiDay] = useState<boolean>(() =>
    Boolean(initialBoardSettings?.expandMultiDay)
  );
  const isTvLaunchEnv = useMemo(() => detectAutoTvEnvironment(), []);
  const [boardTheme, setBoardTheme] = useState<BoardThemeMode>(
    () => initialBoardSettings?.boardTheme || 'light'
  );
  const [isTvAutoFit, setIsTvAutoFit] = useState<boolean>(() =>
    initialBoardSettings?.tvAutoFit !== undefined ? initialBoardSettings.tvAutoFit : true
  );
  const [isLargeText, setIsLargeText] = useState<boolean>(() =>
    isTvLaunchEnv ? true : Boolean(initialBoardSettings?.isLargeText)
  );
  const [isPresentationMode, setIsPresentationMode] = useState<boolean>(() => isTvLaunchEnv);
  const [isToolbarCollapsedInFullscreen, setIsToolbarCollapsedInFullscreen] =
    useState<boolean>(() => isTvLaunchEnv);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(() =>
    isTvLaunchEnv ? true : Boolean(initialBoardSettings?.isAutoScroll)
  );
  const [tvStageMetrics, setTvStageMetrics] = useState<TvStageMetrics>(() =>
    computeTvStageMetrics()
  );
  const [isTvControlsIdle, setIsTvControlsIdle] = useState<boolean>(false);
  const [copiedTvLink, setCopiedTvLink] = useState<boolean>(false);
  const [isTvRemoteModalOpen, setIsTvRemoteModalOpen] = useState<boolean>(false);
  const [connectedTvScreens, setConnectedTvScreens] = useState<
    Record<string, TvScreenHeartbeat>
  >({});
  const [tvRemoteActionFeedback, setTvRemoteActionFeedback] = useState<
    'idle' | 'pushed' | 'reloaded' | 'pinging'
  >('idle');
  const tvIdleTimerRef = useRef<number | null>(null);
  const loadedScriptHashRef = useRef<string>('');

  const wakeTvControls = useCallback(() => {
    setIsTvControlsIdle((prev) => (prev ? false : prev));
    if (tvIdleTimerRef.current !== null) {
      window.clearTimeout(tvIdleTimerRef.current);
      tvIdleTimerRef.current = null;
    }
    if (isPresentationMode && isTvAutoFit && isToolbarCollapsedInFullscreen) {
      tvIdleTimerRef.current = window.setTimeout(() => {
        setIsTvControlsIdle(true);
      }, 6500);
    }
  }, [isPresentationMode, isTvAutoFit, isToolbarCollapsedInFullscreen]);

  useEffect(() => {
    if (!isPresentationMode || !isTvAutoFit || !isToolbarCollapsedInFullscreen) {
      setIsTvControlsIdle(false);
      if (tvIdleTimerRef.current !== null) {
        window.clearTimeout(tvIdleTimerRef.current);
        tvIdleTimerRef.current = null;
      }
      return;
    }
    tvIdleTimerRef.current = window.setTimeout(() => {
      setIsTvControlsIdle(true);
    }, 6500);
    return () => {
      if (tvIdleTimerRef.current !== null) {
        window.clearTimeout(tvIdleTimerRef.current);
        tvIdleTimerRef.current = null;
      }
    };
  }, [isPresentationMode, isTvAutoFit, isToolbarCollapsedInFullscreen]);

  // Real-time TV resolution, DPI scale, orientation, Esc, and browser Fullscreen synchronization
  useEffect(() => {
    const syncViewportMetrics = () => {
      setTvStageMetrics((prev) => {
        const next = computeTvStageMetrics();
        if (
          prev.viewportW === next.viewportW &&
          prev.viewportH === next.viewportH &&
          prev.scale === next.scale &&
          prev.isLandscape === next.isLandscape
        ) {
          return prev;
        }
        return next;
      });
    };

    const handleFullscreenChange = () => {
      syncViewportMetrics();
      if (document.fullscreenElement) {
        setIsPresentationMode(true);
        if (isTvAutoFit) {
          isRemoteBoardApplyRef.current = true;
          setIsLargeText(true);
          setIsAutoScroll(true);
          setIsToolbarCollapsedInFullscreen(true);
        }
      } else if (!isTvLaunchEnv) {
        setIsPresentationMode(false);
        setIsToolbarCollapsedInFullscreen(false);
      }
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && isTvRemoteModalOpen) {
        setIsTvRemoteModalOpen(false);
        return;
      }
      if (ev.key === 'Escape' && isPresentationMode) {
        setIsPresentationMode(false);
        setIsToolbarCollapsedInFullscreen(false);
      } else if (isPresentationMode) {
        wakeTvControls();
      }
    };

    syncViewportMetrics();
    window.addEventListener('resize', syncViewportMetrics);
    window.addEventListener('orientationchange', syncViewportMetrics);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', syncViewportMetrics);
    }

    return () => {
      window.removeEventListener('resize', syncViewportMetrics);
      window.removeEventListener('orientationchange', syncViewportMetrics);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      if (vv) {
        vv.removeEventListener('resize', syncViewportMetrics);
      }
    };
  }, [isPresentationMode, isTvAutoFit, isTvLaunchEnv, isTvRemoteModalOpen, wakeTvControls]);

  // Broadcast board display controls to TV screens whenever Admin clicks any toolbar control
  useEffect(() => {
    if (!hasMountedBoardSyncRef.current) {
      hasMountedBoardSyncRef.current = true;
      return;
    }
    if (isRemoteBoardApplyRef.current) {
      isRemoteBoardApplyRef.current = false;
      return;
    }
    const prevMs = lastBoardSettingsUpdatedAtRef.current
      ? new Date(lastBoardSettingsUpdatedAtRef.current).getTime()
      : 0;
    const safePrevMs = Number.isFinite(prevMs) ? prevMs : 0;
    const nextIso = new Date(Math.max(Date.now(), safePrevMs + 1000)).toISOString();
    lastBoardSettingsUpdatedAtRef.current = nextIso;
    const nextSettings: BoardRemoteSettings = {
      rangeMode,
      layoutMode,
      focusDate,
      selectedCategoryId,
      selectedPriority,
      showCompleted,
      expandMultiDay,
      boardTheme,
      isLargeText,
      isAutoScroll,
      tvAutoFit: isTvAutoFit,
      updatedAt: nextIso,
    };
    broadcastBoardSettingsChange(nextSettings);
  }, [
    boardTheme,
    expandMultiDay,
    focusDate,
    isAutoScroll,
    isLargeText,
    isTvAutoFit,
    layoutMode,
    rangeMode,
    selectedCategoryId,
    selectedPriority,
    showCompleted,
  ]);

  const isToolbarCollapsed = isPresentationMode && isToolbarCollapsedInFullscreen;
  const isTvStageActive = isPresentationMode && isTvAutoFit;
  const isLandscapeTvStage = isTvStageActive && tvStageMetrics.isLandscape;
  const isPortraitTvStage = isTvStageActive && !tvStageMetrics.isLandscape;
  const isTvCleanSignage =
    isPresentationMode &&
    isTvAutoFit &&
    isToolbarCollapsedInFullscreen &&
    isTvControlsIdle;

  const isDarkDisplay = boardTheme === 'dark' || boardTheme === 'navy_gold';
  const isNavyGold = boardTheme === 'navy_gold';
  const isEmeraldExec = boardTheme === 'emerald_exec';

  const handleCycleTheme = () => {
    setBoardTheme((prev) => {
      if (prev === 'light') return 'navy_gold';
      if (prev === 'navy_gold') return 'dark';
      if (prev === 'dark') return 'emerald_exec';
      return 'light';
    });
  };

  const themeButtonLabel = useMemo(() => {
    if (boardTheme === 'navy_gold') return 'โทนสี: กรมท่า-ทอง (ผู้บริหาร)';
    if (boardTheme === 'dark') return 'โทนสี: จอมืด (Dark TV)';
    if (boardTheme === 'emerald_exec') return 'โทนสี: เขียวมรกต';
    return 'โทนสี: สว่างมาตรฐาน';
  }, [boardTheme]);

  // Auto-scroll & GPU-composited sub-pixel schedule viewport refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const topStackRef = useRef<HTMLDivElement | null>(null);
  const autoScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const autoScrollTrackRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollMaxHeight, setAutoScrollMaxHeight] = useState<number>(460);

  const categoryMap = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const handleToggleTvAutoFit = () => {
    setIsTvAutoFit((prev) => {
      const next = !prev;
      if (next && isPresentationMode) {
        isRemoteBoardApplyRef.current = true;
        setIsLargeText(true);
        setIsAutoScroll(true);
        setIsToolbarCollapsedInFullscreen(true);
      }
      return next;
    });
  };

  const tvDirectShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'schedule');
      url.searchParams.set('tv', '1');
      url.searchParams.delete('_v');
      return url.toString();
    } catch {
      return '';
    }
  }, []);

  const handleCopyTvLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'schedule');
      url.searchParams.set('tv', '1');
      url.searchParams.set('_v', String(Date.now()));
      await navigator.clipboard.writeText(url.toString());
      setCopiedTvLink(true);
      window.setTimeout(() => setCopiedTvLink(false), 2600);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const buildCurrentBoardSettingsSnapshot = useCallback((): BoardRemoteSettings => {
    const nextIso = new Date().toISOString();
    lastBoardSettingsUpdatedAtRef.current = nextIso;
    return {
      rangeMode,
      layoutMode,
      focusDate,
      selectedCategoryId,
      selectedPriority,
      showCompleted,
      expandMultiDay,
      boardTheme,
      isLargeText,
      isAutoScroll,
      tvAutoFit: isTvAutoFit,
      updatedAt: nextIso,
    };
  }, [
    boardTheme,
    expandMultiDay,
    focusDate,
    isAutoScroll,
    isLargeText,
    isTvAutoFit,
    layoutMode,
    rangeMode,
    selectedCategoryId,
    selectedPriority,
    showCompleted,
  ]);

  const handleForcePushToTv = useCallback(() => {
    const currentSettings = buildCurrentBoardSettingsSnapshot();
    if (onForcePushRealtimeToTv) {
      onForcePushRealtimeToTv(currentSettings);
    } else {
      pushFullStateToTvScreens({
        tasks,
        categories,
        presence: readLocalDirectorPresence(),
        settings: currentSettings,
      });
      onPresenceStaticSync?.();
    }
    requestConnectedTvPing();
    setTvRemoteActionFeedback('pushed');
    window.setTimeout(() => {
      setTvRemoteActionFeedback((prev) => (prev === 'pushed' ? 'idle' : prev));
    }, 2800);
  }, [
    buildCurrentBoardSettingsSnapshot,
    categories,
    onForcePushRealtimeToTv,
    onPresenceStaticSync,
    tasks,
  ]);

  const handleRemoteReloadTv = useCallback(() => {
    sendTvRemoteCommand('reload');
    setTvRemoteActionFeedback('reloaded');
    window.setTimeout(() => {
      setTvRemoteActionFeedback((prev) => (prev === 'reloaded' ? 'idle' : prev));
    }, 3000);
  }, []);

  const handlePingTvScreens = useCallback(() => {
    requestConnectedTvPing();
    setTvRemoteActionFeedback('pinging');
    window.setTimeout(() => {
      setTvRemoteActionFeedback((prev) => (prev === 'pinging' ? 'idle' : prev));
    }, 1800);
  }, []);

  const activeTvScreenList = useMemo<TvScreenHeartbeat[]>(() => {
    return (Object.values(connectedTvScreens) as TvScreenHeartbeat[]).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [connectedTvScreens]);

  const handleTogglePresentationFullscreen = async () => {
    const nextState = !isPresentationMode;
    setIsPresentationMode(nextState);
    if (nextState) {
      isRemoteBoardApplyRef.current = true;
      setIsLargeText(true);
      if (isTvAutoFit) {
        setIsAutoScroll(true);
        setIsToolbarCollapsedInFullscreen(true);
      }
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // Ignore iframe fullscreen restrictions; in-page presentation mode still expands
      }
    } else {
      setIsToolbarCollapsedInFullscreen(false);
      setIsTvControlsIdle(false);
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch {
        // Ignore
      }
    }
  };

  const endOf7DaysStr = useMemo(() => addDaysYMD(todayStr, 6), [todayStr]);

  // Build grouped schedule entries by date (consolidating continuous tasks into a single entry by default)
  const scheduleByDate = useMemo<DayGroupEntry[]>(() => {
    const normalizedTasks = tasks.map((t) => {
      const inferred = inferTaskEndDate(t);
      return inferred && (!t.endDate || inferred > t.endDate)
        ? { ...t, endDate: inferred }
        : t;
    });
    const filtered = normalizedTasks.filter((t) => {
      if (!showCompleted && t.status === TaskStatus.COMPLETED) return false;
      if (selectedCategoryId !== 'all' && t.categoryId !== selectedCategoryId) return false;
      if (selectedPriority !== 'all' && t.priority !== selectedPriority) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const catName = (categoryMap[t.categoryId]?.name || '').toLowerCase();
        const thaiDate = formatTaskDateRangeLabel(t, 'long').toLowerCase();
        const assignee = (t.assigneeName || '').toLowerCase();
        const match =
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          catName.includes(q) ||
          thaiDate.includes(q) ||
          assignee.includes(q) ||
          t.date.includes(q) ||
          t.time.includes(q);
        if (!match) return false;
      }
      return true;
    });

    // When consolidating (!expandMultiDay), merge separate task entries that have the exact same title
    // and run on consecutive/overlapping days or consecutive times on the same day into 1 summarized entry
    const filteredBase: Array<{ task: Task; timeRangeLabel?: string }> = [];
    if (!expandMultiDay) {
      const sortedForMerge = [...filtered].sort((a, b) =>
        `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
      );
      for (const item of sortedForMerge) {
        const normTitle = item.title.trim().toLowerCase();
        const itemEnd = item.endDate && item.endDate > item.date ? item.endDate : item.date;
        const existingIdx = filteredBase.findIndex((entry) => {
          const ex = entry.task;
          if (ex.title.trim().toLowerCase() !== normTitle) return false;
          if (ex.categoryId !== item.categoryId) return false;
          const exEnd = ex.endDate && ex.endDate > ex.date ? ex.endDate : ex.date;
          const nextDayAfterEx = addDaysYMD(exEnd, 1);
          return item.date >= ex.date && item.date <= nextDayAfterEx;
        });

        if (existingIdx !== -1) {
          const prevEntry = filteredBase[existingIdx];
          const prevTask = prevEntry.task;
          const prevEnd =
            prevTask.endDate && prevTask.endDate > prevTask.date
              ? prevTask.endDate
              : prevTask.date;
          const mergedEnd = itemEnd > prevEnd ? itemEnd : prevEnd;
          let nextTimeRange = prevEntry.timeRangeLabel;
          if (
            prevTask.date === item.date &&
            mergedEnd === prevTask.date &&
            prevTask.time !== item.time
          ) {
            const startT = prevTask.time < item.time ? prevTask.time : item.time;
            const endT = prevTask.time > item.time ? prevTask.time : item.time;
            nextTimeRange = `${startT} - ${endT}`;
          }
          const prevMs = prevTask.updatedAt ? new Date(prevTask.updatedAt).getTime() : 0;
          const itemMs = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
          const newerStatus =
            itemMs > prevMs
              ? item.status
              : prevMs > itemMs
              ? prevTask.status
              : prevTask.status === TaskStatus.IN_PROGRESS || item.status === TaskStatus.IN_PROGRESS
              ? TaskStatus.IN_PROGRESS
              : prevTask.status;
          filteredBase[existingIdx] = {
            task: {
              ...prevTask,
              status: newerStatus,
              updatedAt: itemMs > prevMs ? item.updatedAt : prevTask.updatedAt,
              endDate: mergedEnd > prevTask.date ? mergedEnd : prevTask.endDate,
              description:
                itemMs > prevMs && item.description
                  ? item.description
                  : prevTask.description || item.description || '',
            },
            timeRangeLabel: nextTimeRange,
          };
        } else {
          filteredBase.push({ task: item });
        }
      }
    } else {
      for (const item of filtered) {
        filteredBase.push({ task: item });
      }
    }

    const map = new Map<
      string,
      Array<{
        task: Task;
        displayDate: string;
        dayIndexOfSpan: number;
        totalSpanDays: number;
        timeRangeLabel?: string;
      }>
    >();

    for (const { task, timeRangeLabel } of filteredBase) {
      const totalSpanDays = getTaskDurationDays(task.date, task.endDate);

      if (!expandMultiDay) {
        // Consolidated mode: summarize a continuous/multi-day task as 1 single entry
        const taskEnd = task.endDate && task.endDate > task.date ? task.endDate : task.date;
        let anchorDate = task.date;

        if (layoutMode === 'single_day') {
          if (task.date > focusDate || taskEnd < focusDate) continue;
          anchorDate = focusDate;
        } else if (layoutMode === 'split_two_column') {
          if (taskEnd < todayStr) continue;
          anchorDate = task.date < todayStr ? todayStr : task.date;
        } else if (rangeMode === 'today') {
          if (task.date > todayStr || taskEnd < todayStr) continue;
          anchorDate = todayStr;
        } else if (rangeMode === 'upcoming') {
          if (taskEnd < todayStr) continue;
          anchorDate = task.date < todayStr ? todayStr : task.date;
        } else if (rangeMode === 'week7') {
          if (taskEnd < todayStr || task.date > endOf7DaysStr) continue;
          anchorDate = task.date < todayStr ? todayStr : task.date;
        }

        const list = map.get(anchorDate) || [];
        list.push({
          task,
          displayDate: anchorDate,
          dayIndexOfSpan: 1,
          totalSpanDays,
          timeRangeLabel,
        });
        map.set(anchorDate, list);
      } else {
        const datesToPlace = enumerateTaskDates(task);
        datesToPlace.forEach((dStr, idx) => {
          if (layoutMode === 'single_day') {
            if (dStr !== focusDate) return;
          } else if (layoutMode === 'split_two_column') {
            if (dStr < todayStr) return;
          } else {
            if (rangeMode === 'today' && dStr !== todayStr) return;
            if (rangeMode === 'upcoming' && dStr < todayStr) return;
            if (rangeMode === 'week7' && (dStr < todayStr || dStr > endOf7DaysStr)) return;
          }

          const list = map.get(dStr) || [];
          list.push({
            task,
            displayDate: dStr,
            dayIndexOfSpan: idx + 1,
            totalSpanDays,
            timeRangeLabel,
          });
          map.set(dStr, list);
        });
      }
    }

    const sortedDates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return sortedDates.map((dateKey) => {
      const items = (map.get(dateKey) || []).sort((a, b) =>
        a.task.time.localeCompare(b.task.time)
      );
      return {
        date: dateKey,
        items,
      };
    });
  }, [
    tasks,
    showCompleted,
    selectedCategoryId,
    selectedPriority,
    searchQuery,
    categoryMap,
    expandMultiDay,
    layoutMode,
    focusDate,
    rangeMode,
    todayStr,
    endOf7DaysStr,
  ]);

  useEffect(() => {
    if (!isAutoScroll) {
      if (autoScrollTrackRef.current) {
        autoScrollTrackRef.current.style.transform = '';
      }
      return;
    }

    // Align the top header stack cleanly below the app header once when starting auto-scroll
    if (!isPresentationMode && topStackRef.current) {
      const appHeader = document.querySelector('header');
      const hdrH = appHeader instanceof HTMLElement ? appHeader.offsetHeight : 58;
      const stackRect = topStackRef.current.getBoundingClientRect();
      if (stackRect.top > hdrH + 4 || stackRect.top < hdrH - 4) {
        const targetWindowY = Math.max(0, window.scrollY + stackRect.top - hdrH);
        window.scrollTo({ top: targetWindowY, behavior: 'auto' });
      }
    }

    if (autoScrollViewportRef.current) {
      autoScrollViewportRef.current.scrollTop = 0;
    }

    let rafId = 0;
    let lastTs = performance.now();
    let offsetPx = 0;
    let direction: 1 | -1 = 1;
    let pauseRemainingMs = 900;

    const SPEED_DOWN_PX_PER_SEC = 32;
    const SPEED_UP_PX_PER_SEC = 50;

    const step = (nowTs: number) => {
      const dtSec = Math.min(0.05, Math.max(0, (nowTs - lastTs) / 1000));
      lastTs = nowTs;

      const viewportEl = autoScrollViewportRef.current;
      const trackEl = autoScrollTrackRef.current;

      if (viewportEl && trackEl) {
        const maxOffset = trackEl.scrollHeight - viewportEl.clientHeight;

        if (maxOffset > 20) {
          if (pauseRemainingMs > 0) {
            pauseRemainingMs = Math.max(0, pauseRemainingMs - dtSec * 1000);
          } else if (direction === 1) {
            const distToBottom = maxOffset - offsetPx;
            const easeFactor =
              distToBottom < 20 ? Math.max(0.35, distToBottom / 20) : 1;
            offsetPx += SPEED_DOWN_PX_PER_SEC * easeFactor * dtSec;
            if (offsetPx >= maxOffset - 0.25) {
              offsetPx = maxOffset;
              direction = -1;
              pauseRemainingMs = 1800;
            }
          } else {
            const distToTop = offsetPx;
            const easeFactor =
              distToTop < 20 ? Math.max(0.35, distToTop / 20) : 1;
            offsetPx -= SPEED_UP_PX_PER_SEC * easeFactor * dtSec;
            if (offsetPx <= 0.25) {
              offsetPx = 0;
              direction = 1;
              pauseRemainingMs = 1800;
            }
          }

          trackEl.style.transform = `translate3d(0, ${-offsetPx}px, 0)`;
        } else if (offsetPx !== 0) {
          offsetPx = 0;
          trackEl.style.transform = 'translate3d(0, 0px, 0)';
        }
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (autoScrollTrackRef.current) {
        autoScrollTrackRef.current.style.transform = '';
      }
    };
  }, [
    isAutoScroll,
    isPresentationMode,
    isToolbarCollapsed,
    layoutMode,
    rangeMode,
    scheduleByDate.length,
  ]);

  const todayTasksSummary = useMemo(() => {
    const parseHM = (hm: string): number | null => {
      const m = (hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };

    const nowTotalMins = parseHM(nowHM);
    const activeToday = tasks
      .filter((t) => isTaskActiveOnDate(t, todayStr))
      .sort((a, b) => a.time.localeCompare(b.time));
    const pending = activeToday.filter((t) => t.status !== TaskStatus.COMPLETED).length;
    const completed = activeToday.length - pending;

    const explicitTodayInProgress = activeToday.find(
      (t) => t.status === TaskStatus.IN_PROGRESS
    );
    const timeWindowTodayInProgress = activeToday.find((t) => {
      if (t.status !== TaskStatus.PENDING) return false;
      if (nowTotalMins === null) return false;
      const tMins = parseHM(t.time);
      if (tMins === null) return false;
      return tMins <= nowTotalMins && nowTotalMins - tMins <= 55;
    });
    const inProgressTask = explicitTodayInProgress || timeWindowTodayInProgress;

    const explicitAnyInProgressTask = tasks
      .filter((t) => t.status === TaskStatus.IN_PROGRESS)
      .sort((a, b) => {
        const aToday = isTaskActiveOnDate(a, todayStr) ? 0 : 1;
        const bToday = isTaskActiveOnDate(b, todayStr) ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        const updatedCmp = (b.updatedAt || '').localeCompare(a.updatedAt || '');
        if (updatedCmp !== 0) return updatedCmp;
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return a.time.localeCompare(b.time);
      })[0];

    const nextUpcoming = activeToday.find(
      (t) => t.status === TaskStatus.PENDING && t.time >= nowHM
    );

    let nextCountdownLabel = '';
    if (nextUpcoming && nowTotalMins !== null) {
      const targetMins = parseHM(nextUpcoming.time);
      if (targetMins !== null) {
        const diff = targetMins - nowTotalMins;
        if (diff <= 0) {
          nextCountdownLabel = 'ถึงเวลาเริ่มภารกิจ';
        } else if (diff < 60) {
          nextCountdownLabel = `อีก ${diff} นาที`;
        } else {
          const hrs = Math.floor(diff / 60);
          const mins = diff % 60;
          nextCountdownLabel = mins > 0 ? `อีก ${hrs} ชม. ${mins} นาที` : `อีก ${hrs} ชม.`;
        }
      }
    }

    const upcomingAndTodayTasks = tasks.filter((t) => {
      const end = t.endDate && t.endDate > t.date ? t.endDate : t.date;
      return end >= todayStr;
    });
    const highPriorityCount = upcomingAndTodayTasks.filter(
      (t) => t.priority === TaskPriority.HIGH && t.status !== TaskStatus.COMPLETED
    ).length;
    const allSchedulesCount =
      upcomingAndTodayTasks.length > 0 ? upcomingAndTodayTasks.length : tasks.length;

    return {
      total: activeToday.length,
      pending,
      completed,
      inProgressTask,
      explicitAnyInProgressTask,
      nextUpcoming,
      nextCountdownLabel,
      highPriorityCount,
      allSchedulesCount,
      activeToday,
    };
  }, [tasks, todayStr, nowHM]);

  const [directorPresence, setDirectorPresence] = useState<DirectorPresenceState>(() =>
    readLocalDirectorPresence()
  );

  const [isEditingPresenceNote, setIsEditingPresenceNote] = useState<boolean>(false);
  const [presenceNoteDraft, setPresenceNoteDraft] = useState<string>('');
  const lastPresenceWriteMsRef = useRef<number>(0);

  const applyIncomingPresence = useCallback((remote: DirectorPresenceState | null | undefined) => {
    if (!remote || typeof remote.mode !== 'string') return;
    setDirectorPresence((prev) => {
      if (
        remote.updatedAt &&
        remote.updatedAt === prev.updatedAt &&
        remote.mode === prev.mode &&
        (remote.customNote || '') === prev.customNote
      ) {
        return prev;
      }
      if (prev.updatedAt && remote.updatedAt) {
        const prevMs = new Date(prev.updatedAt).getTime();
        const remMs = new Date(remote.updatedAt).getTime();
        if (Number.isFinite(prevMs) && Number.isFinite(remMs) && remMs < prevMs) {
          return prev;
        }
      }
      const merged: DirectorPresenceState = {
        mode: remote.mode,
        customNote: typeof remote.customNote === 'string' ? remote.customNote : '',
        updatedAt: typeof remote.updatedAt === 'string' ? remote.updatedAt : '',
      };
      writeLocalDirectorPresence(merged);
      return merged;
    });
  }, []);

  // Instant Real-Time Presence & Board Settings Subscription (WebSocket + Global Cloud Bus + HDMI BroadcastChannel)
  useEffect(() => {
    const unsubscribeRealtime = subscribeRealtimeEvents((ev) => {
      if (ev.type === 'sync:init' && ev.presence) {
        applyIncomingPresence(ev.presence);
      } else if (ev.type === 'presence:updated' && ev.presence) {
        if (ev.clientOriginId && ev.clientOriginId === getClientTabId()) return;
        applyIncomingPresence(ev.presence);
      } else if (ev.type === 'board:settings' && ev.settings) {
        if (ev.clientOriginId && ev.clientOriginId === getClientTabId()) return;
        const incMs = ev.settings.updatedAt ? new Date(ev.settings.updatedAt).getTime() : 0;
        const curMs = lastBoardSettingsUpdatedAtRef.current
          ? new Date(lastBoardSettingsUpdatedAtRef.current).getTime()
          : 0;
        if (Number.isFinite(incMs) && Number.isFinite(curMs) && curMs > 0 && incMs < curMs) {
          return;
        }
        if (ev.settings.updatedAt) {
          lastBoardSettingsUpdatedAtRef.current = ev.settings.updatedAt;
        }
        isRemoteBoardApplyRef.current = true;
        setRangeMode(ev.settings.rangeMode);
        setLayoutMode(ev.settings.layoutMode);
        if (ev.settings.focusDate) {
          setFocusDate(ev.settings.focusDate);
        }
        setSelectedCategoryId(ev.settings.selectedCategoryId);
        setSelectedPriority(ev.settings.selectedPriority);
        setShowCompleted(ev.settings.showCompleted);
        setExpandMultiDay(ev.settings.expandMultiDay);
        setBoardTheme(ev.settings.boardTheme);
        setIsLargeText(ev.settings.isLargeText);
        setIsAutoScroll(ev.settings.isAutoScroll);
        if (ev.settings.tvAutoFit !== undefined) {
          setIsTvAutoFit(ev.settings.tvAutoFit);
        }
      } else if (ev.type === 'tv:ping') {
        if (ev.clientOriginId && ev.clientOriginId === getClientTabId()) return;
        if (isPresentationMode || isTvLaunchEnv) {
          const metrics = computeTvStageMetrics();
          announceTvScreenPresence({
            label: isTvLaunchEnv ? 'จอทีวีนำเสนอ (?tv=1)' : 'หน้าจอโหมดนำเสนอเต็มจอ',
            viewportW: metrics.viewportW,
            viewportH: metrics.viewportH,
            scale: metrics.scale,
            isPresentationMode: true,
          });
        }
      } else if (ev.type === 'tv:pong' && ev.screen) {
        if (ev.clientOriginId && ev.clientOriginId === getClientTabId()) return;
        setConnectedTvScreens((prev) => ({
          ...prev,
          [ev.screen.tvClientId]: ev.screen,
        }));
      } else if (ev.type === 'tv:command') {
        if (ev.clientOriginId && ev.clientOriginId === getClientTabId()) return;
        if (ev.action === 'reload' && (isPresentationMode || isTvLaunchEnv)) {
          try {
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set('section', 'schedule');
            nextUrl.searchParams.set('tv', '1');
            nextUrl.searchParams.set('_v', String(Date.now()));
            window.location.replace(nextUrl.toString());
          } catch {
            window.location.reload();
          }
        } else if (ev.action === 'enter_fullscreen' && isTvLaunchEnv) {
          setIsPresentationMode(true);
          setIsTvAutoFit(true);
          setIsLargeText(true);
          setIsAutoScroll(true);
          setIsToolbarCollapsedInFullscreen(true);
        }
      }
    });
    return () => unsubscribeRealtime();
  }, [applyIncomingPresence, isPresentationMode, isTvLaunchEnv]);

  // Announce TV screen presence while in Presentation Mode & auto-request initial sync on ?tv=1 boot
  useEffect(() => {
    if (!isPresentationMode && !isTvLaunchEnv) return;
    const sendPresence = () => {
      const m = computeTvStageMetrics();
      announceTvScreenPresence({
        label: isTvLaunchEnv ? 'จอทีวีนำเสนอ (?tv=1)' : 'หน้าจอโหมดนำเสนอเต็มจอ',
        viewportW: m.viewportW,
        viewportH: m.viewportH,
        scale: m.scale,
        isPresentationMode: true,
      });
    };
    sendPresence();
    const syncReqTimer = isTvLaunchEnv
      ? window.setTimeout(() => {
          sendTvRemoteCommand('force_sync_request');
        }, 650)
      : null;
    const heartbeatId = window.setInterval(sendPresence, 28000);
    return () => {
      if (syncReqTimer !== null) window.clearTimeout(syncReqTimer);
      window.clearInterval(heartbeatId);
    };
  }, [isPresentationMode, isTvLaunchEnv]);

  // Prune stale TV heartbeats (>75s) on Admin view & ping connected TVs when opening the modal or mounting
  useEffect(() => {
    if (!isTvLaunchEnv) {
      requestConnectedTvPing();
    }
    const pruneId = window.setInterval(() => {
      const cutoff = Date.now() - 75000;
      setConnectedTvScreens((prev) => {
        let changed = false;
        const next: Record<string, TvScreenHeartbeat> = {};
        (Object.entries(prev) as Array<[string, TvScreenHeartbeat]>).forEach(([k, v]) => {
          const ts = v.updatedAt ? new Date(v.updatedAt).getTime() : 0;
          if (Number.isFinite(ts) && ts >= cutoff) {
            next[k] = v;
          } else {
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 15000);
    return () => window.clearInterval(pruneId);
  }, [isTvLaunchEnv]);

  // Auto-reload TV screen when a newer frontend build is deployed to GitHub Pages / server
  useEffect(() => {
    if (!isPresentationMode && !isTvLaunchEnv) return;
    const detectCurrentScriptBundle = (): string => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      for (const s of scripts) {
        const src = s.getAttribute('src') || '';
        const match = src.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        if (match) return match[0];
      }
      return '';
    };
    if (!loadedScriptHashRef.current) {
      loadedScriptHashRef.current = detectCurrentScriptBundle();
    }
    if (!loadedScriptHashRef.current) return;

    const checkId = window.setInterval(async () => {
      try {
        const indexUrl = new URL('./index.html', window.location.href);
        indexUrl.searchParams.set('_t', String(Date.now()));
        const res = await fetch(indexUrl.toString(), { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const remoteMatch = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        if (
          remoteMatch &&
          remoteMatch[0] &&
          loadedScriptHashRef.current &&
          remoteMatch[0] !== loadedScriptHashRef.current
        ) {
          const reloadUrl = new URL(window.location.href);
          reloadUrl.searchParams.set('section', 'schedule');
          reloadUrl.searchParams.set('tv', '1');
          reloadUrl.searchParams.set('_v', String(Date.now()));
          window.location.replace(reloadUrl.toString());
        }
      } catch {
        // Ignore offline/network check error
      }
    }, 90000);

    return () => window.clearInterval(checkId);
  }, [isPresentationMode, isTvLaunchEnv]);

  // Keep Notebook + HDMI TV awake all day (prevents Windows screen sleep / HDMI "No Signal" when idle)
  useEffect(() => {
    if (!isPresentationMode && !isTvLaunchEnv) return;
    let wakeLockSentinel: { release: () => Promise<void> } | null = null;
    let disposed = false;

    const acquireWakeLock = async () => {
      if (disposed || typeof navigator === 'undefined') return;
      const navWithWakeLock = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      if (!navWithWakeLock.wakeLock || document.visibilityState !== 'visible') return;
      try {
        wakeLockSentinel = await navWithWakeLock.wakeLock.request('screen');
      } catch {
        // Ignore if browser policy requires user gesture or battery saver is active
      }
    };

    void acquireWakeLock();
    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVis);
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
        wakeLockSentinel = null;
      }
    };
  }, [isPresentationMode, isTvLaunchEnv]);

  useEffect(() => {
    let cancelled = false;
    let isStaticEndpoint = false;

    const pullDirectorPresence = async () => {
      if (isStaticEndpoint || Date.now() - lastPresenceWriteMsRef.current < 1500) return;
      try {
        const res = await fetch('/api/collab/director-presence', {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const ct = res.headers.get('content-type') || '';
        if (res.status === 404 || !ct.includes('application/json')) {
          isStaticEndpoint = true;
          return;
        }
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const remote = data?.presence;
        if (!remote || typeof remote.mode !== 'string') return;
        applyIncomingPresence(remote as DirectorPresenceState);
      } catch {
        // silent fallback to local/GAS state when offline or static host
      }
    };

    pullDirectorPresence();
    const intervalId = window.setInterval(pullDirectorPresence, 3000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        pullDirectorPresence();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', pullDirectorPresence);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', pullDirectorPresence);
    };
  }, [applyIncomingPresence]);

  const updateDirectorPresence = useCallback(
    async (nextMode: DirectorPresenceMode, nextCustomNote?: string) => {
      lastPresenceWriteMsRef.current = Date.now();
      const resolvedNote =
        nextCustomNote !== undefined
          ? nextCustomNote.trim().slice(0, 160)
          : directorPresence.customNote;
      const prevDpMs = directorPresence.updatedAt
        ? new Date(directorPresence.updatedAt).getTime()
        : 0;
      const safePrevDpMs = Number.isFinite(prevDpMs) ? prevDpMs : 0;
      const monotonicDpIso = new Date(
        Math.max(Date.now(), safePrevDpMs + 1000)
      ).toISOString();
      const optimistic: DirectorPresenceState = {
        mode: nextMode,
        customNote: resolvedNote,
        updatedAt: monotonicDpIso,
      };
      setDirectorPresence(optimistic);
      // Broadcast immediately in 0ms across HDMI / multi-tab windows on the same device
      broadcastLocalPresenceChange(optimistic);

      let serverSaved = false;
      try {
        const res = await fetch('/api/collab/director-presence', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: nextMode,
            customNote: resolvedNote,
            clientOriginId: getClientTabId(),
          }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          serverSaved = true;
          const data = await res.json();
          if (data?.presence) {
            const confirmed: DirectorPresenceState = {
              mode: data.presence.mode as DirectorPresenceMode,
              customNote:
                typeof data.presence.customNote === 'string'
                  ? data.presence.customNote
                  : resolvedNote,
              updatedAt:
                typeof data.presence.updatedAt === 'string'
                  ? data.presence.updatedAt
                  : optimistic.updatedAt,
            };
            setDirectorPresence(confirmed);
            writeLocalDirectorPresence(confirmed);
          }
        }
      } catch {
        serverSaved = false;
      }

      if (!serverSaved) {
        onPresenceStaticSync?.();
      }
    },
    [directorPresence.customNote, directorPresence.updatedAt, onPresenceStaticSync]
  );

  const handleCycleTaskStatus = useCallback(
    (task: Task, isDone: boolean, isInProgress: boolean) => {
      if (onUpdateStatus) {
        if (isDone) {
          onUpdateStatus(task, TaskStatus.PENDING);
        } else if (isInProgress) {
          onUpdateStatus(task, TaskStatus.COMPLETED);
        } else {
          onUpdateStatus(task, TaskStatus.IN_PROGRESS);
          if (directorPresence.mode !== 'auto') {
            updateDirectorPresence('auto');
          }
        }
      } else {
        onToggleStatus(task);
      }
    },
    [onUpdateStatus, onToggleStatus, directorPresence.mode, updateDirectorPresence]
  );

  const resolvedDirectorPresence = useMemo(() => {
    const multiDayOffsiteToday = todayTasksSummary.activeToday.find(
      (t) =>
        t.status !== TaskStatus.COMPLETED &&
        Boolean(t.endDate && t.endDate > t.date) &&
        isExternalOffsiteTask(t)
    );
    const activeInProgress =
      todayTasksSummary.explicitAnyInProgressTask || todayTasksSummary.inProgressTask;

    const formatActiveTaskDetail = (t: Task) =>
      isTaskActiveOnDate(t, todayStr)
        ? `${t.time} น. — ${t.title}`
        : `${t.title} (${formatThaiDateDisplay(t.date, 'short')} · ${t.time} น.)`;

    let effectiveStatus: Exclude<DirectorPresenceMode, 'auto'> = 'in_office';
    let autoDetail = '';

    if (directorPresence.mode === 'auto') {
      if (activeInProgress && isExternalOffsiteTask(activeInProgress)) {
        effectiveStatus = 'offsite';
        autoDetail = formatActiveTaskDetail(activeInProgress);
      } else if (activeInProgress) {
        effectiveStatus = 'in_meeting';
        autoDetail = formatActiveTaskDetail(activeInProgress);
      } else if (multiDayOffsiteToday) {
        effectiveStatus = 'offsite';
        autoDetail = multiDayOffsiteToday.title;
      } else {
        effectiveStatus = 'in_office';
        if (todayTasksSummary.nextUpcoming) {
          autoDetail = `นัดหมายถัดไป เวลา ${todayTasksSummary.nextUpcoming.time} น.${
            todayTasksSummary.nextCountdownLabel ? ` (${todayTasksSummary.nextCountdownLabel})` : ''
          }`;
        } else {
          autoDetail = 'พร้อมปฏิบัติราชการตามปกติ';
        }
      }
    } else {
      effectiveStatus = directorPresence.mode;
    }

    const statusMeta: Record<
      Exclude<DirectorPresenceMode, 'auto'>,
      {
        label: string;
        shortButtonLabel: string;
        tone: 'emerald' | 'amber' | 'sky' | 'rose';
      }
    > = {
      in_office: {
        label: 'ปฏิบัติราชการ ณ ห้องทำงาน',
        shortButtonLabel: 'ณ ห้องทำงาน',
        tone: 'emerald',
      },
      in_meeting: {
        label: 'ติดประชุม / พบผู้มาติดต่อ',
        shortButtonLabel: 'ติดประชุม',
        tone: 'amber',
      },
      offsite: {
        label: 'ไปราชการนอกสถานที่',
        shortButtonLabel: 'ไปราชการ',
        tone: 'sky',
      },
      unavailable: {
        label: 'งดรับนัดชั่วคราว',
        shortButtonLabel: 'งดรับนัด',
        tone: 'rose',
      },
    };

    return {
      effectiveStatus,
      isAuto: directorPresence.mode === 'auto',
      meta: statusMeta[effectiveStatus],
      autoDetail,
      customNote: directorPresence.customNote,
    };
  }, [directorPresence, todayTasksSummary, todayStr]);

  const bannerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(58);
  const [detectedAppBg, setDetectedAppBg] = useState<string>('#F8FAFC');

  useEffect(() => {
    const updateMeasurements = () => {
      const appHeader = document.querySelector('header');
      const hdrH = appHeader instanceof HTMLElement ? appHeader.offsetHeight : 58;
      setHeaderHeight((prev) => (Math.abs(prev - hdrH) >= 1 ? hdrH : prev));

      const rootThemeEl = containerRef.current?.closest('.min-h-screen');
      if (rootThemeEl instanceof HTMLElement) {
        const bg = window.getComputedStyle(rootThemeEl).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          setDetectedAppBg((prev) => (prev !== bg ? bg : prev));
        }
      }

      if (autoScrollViewportRef.current && !isPresentationMode) {
        const rect = autoScrollViewportRef.current.getBoundingClientRect();
        const effectiveTop = Math.max(hdrH + 16, rect.top);
        const nextMax = Math.max(320, Math.floor(window.innerHeight - effectiveTop - 20));
        setAutoScrollMaxHeight((prev) => (Math.abs(prev - nextMax) >= 3 ? nextMax : prev));
      }
    };

    updateMeasurements();
    const rafId = window.requestAnimationFrame(updateMeasurements);

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateMeasurements();
          })
        : null;

    if (observer && bannerRef.current) {
      observer.observe(bannerRef.current);
    }
    if (observer && toolbarRef.current) {
      observer.observe(toolbarRef.current);
    }
    if (observer && topStackRef.current) {
      observer.observe(topStackRef.current);
    }
    const appHeader = document.querySelector('header');
    if (observer && appHeader instanceof HTMLElement) {
      observer.observe(appHeader);
    }

    window.addEventListener('resize', updateMeasurements);
    return () => {
      window.cancelAnimationFrame(rafId);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [
    isLargeText,
    boardTheme,
    isPresentationMode,
    isToolbarCollapsed,
    isAutoScroll,
    layoutMode,
    rangeMode,
    scheduleByDate.length,
  ]);

  const stickyMaskColor = isNavyGold
    ? '#0A1628'
    : isDarkDisplay
    ? '#020617'
    : isEmeraldExec
    ? '#F0FDF4'
    : isPresentationMode
    ? '#F8FAFC'
    : detectedAppBg;

  const isClippedScrollActive = isAutoScroll || isPresentationMode;

  const todayGroupInSchedule = useMemo(
    () => scheduleByDate.find((g) => g.date === todayStr) || null,
    [scheduleByDate, todayStr]
  );
  const nonTodayGroupsInSchedule = useMemo(
    () => scheduleByDate.filter((g) => g.date !== todayStr),
    [scheduleByDate, todayStr]
  );
  const shouldPinTodayInTopStack =
    layoutMode === 'grouped_by_day' &&
    Boolean(todayGroupInSchedule) &&
    nonTodayGroupsInSchedule.length > 0;

  const surfaceCardClasses = isNavyGold
    ? 'bg-[#0F213C] border-amber-400/40 text-white'
    : isDarkDisplay
    ? 'bg-slate-900 border-slate-800 text-white'
    : isEmeraldExec
    ? 'bg-white border-emerald-200 text-slate-900'
    : 'bg-white border-slate-200 text-slate-900';

  const renderDaySection = (
    group: DayGroupEntry,
    options?: {
      isPinnedInStack?: boolean;
      stickyHeaderInsideScroll?: boolean;
      scrollRowsOnly?: boolean;
    }
  ) => {
    const isTodayGroup = group.date === todayStr;
    const isPinnedInStack = Boolean(options?.isPinnedInStack);
    const stickyHeaderInsideScroll = Boolean(options?.stickyHeaderInsideScroll);
    const scrollRowsOnly = Boolean(options?.scrollRowsOnly);

    const rel = getRelativeDayLabel(group.date, todayStr);
    const doneInDay = group.items.filter(
      (i) => i.task.status === TaskStatus.COMPLETED
    ).length;
    const pendingInDay = group.items.length - doneInDay;

    const shouldSplitPeriods =
      layoutMode === 'single_day' || rangeMode === 'today' || isTodayGroup;
    const morningItems = shouldSplitPeriods
      ? group.items.filter((entry) => (entry.task.time || '00:00') < '12:00')
      : [];
    const afternoonItems = shouldSplitPeriods
      ? group.items.filter((entry) => (entry.task.time || '00:00') >= '12:00')
      : [];

    const renderTaskRow = (
      entry: DayGroupEntry['items'][number],
      idxKey: string | number
    ) => {
      const {
        task,
        displayDate,
        dayIndexOfSpan,
        totalSpanDays,
        timeRangeLabel,
      } = entry;
      const cat = categoryMap[task.categoryId];
      const catColor = cat?.color || '#2563EB';
      const displayCatColor = getReadableCategoryColor(catColor, isDarkDisplay);
      const isDone = task.status === TaskStatus.COMPLETED;
      const isAutoInProgressByTime =
        displayDate === todayStr &&
        !isDone &&
        todayTasksSummary.inProgressTask?.id === task.id;
      const isInProgress =
        !isDone &&
        (task.status === TaskStatus.IN_PROGRESS || isAutoInProgressByTime);
      const isHigh = task.priority === TaskPriority.HIGH;
      const isCurrentDayPassed =
        displayDate === todayStr &&
        task.time <= nowHM &&
        !isDone &&
        !isInProgress;
      const isNextUpcomingRow =
        displayDate === todayStr &&
        !isDone &&
        !isInProgress &&
        todayTasksSummary.nextUpcoming?.id === task.id;
      const detectedVenue = extractLocationFromText(task.title, task.description);
      const displayDescription = task.description
        ? detectedVenue
          ? task.description
              .split('\n')
              .filter((line) => !/^\s*สถานที่\s*:/i.test(line))
              .join('\n')
              .trim()
          : task.description
        : '';

      return (
        <div
          key={`${displayDate}-${task.id}-${idxKey}`}
          className={`px-6 py-4 flex ${
            isTvStageActive ? 'flex-row items-center' : 'flex-col md:flex-row md:items-center'
          } justify-between gap-4 transition-colors ${
            isNextUpcomingRow
              ? isDarkDisplay
                ? 'bg-amber-500/10 hover:bg-amber-500/15'
                : 'bg-amber-50/70 hover:bg-amber-50'
              : isDarkDisplay
              ? 'hover:bg-slate-800/40'
              : 'hover:bg-slate-50/70'
          }`}
        >
          {/* Left: Time Column + Task Details */}
          <div className="flex items-start gap-5 min-w-0">
            {/* Distinct Time Slot Column */}
            <div className={`${isTvStageActive ? 'w-44' : 'w-36 sm:w-44'} shrink-0`}>
              <div
                className={`inline-flex items-center gap-2 font-sans tabular-nums font-bold ${
                  isTvStageActive
                    ? isLargeText
                      ? 'text-3xl'
                      : 'text-xl'
                    : isLargeText
                    ? 'text-2xl sm:text-3xl'
                    : 'text-lg sm:text-xl'
                } ${
                  isDone
                    ? 'text-slate-400 line-through'
                    : isNextUpcomingRow
                    ? isDarkDisplay
                      ? 'text-amber-300'
                      : 'text-amber-800'
                    : isDarkDisplay
                    ? 'text-emerald-400'
                    : 'text-indigo-950'
                }`}
              >
                <Clock
                  className={`h-5 w-5 shrink-0 ${
                    isDone
                      ? 'text-slate-400'
                      : isNextUpcomingRow
                      ? isDarkDisplay
                        ? 'text-amber-300'
                        : 'text-amber-600'
                      : isDarkDisplay
                      ? 'text-emerald-400'
                      : 'text-indigo-500'
                  }`}
                />
                <span>{timeRangeLabel || task.time} น.</span>
              </div>
            </div>

            {/* Task Content */}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onEditTask(task)}
                  className={`font-bold text-left hover:underline break-words ${
                    isLargeText ? 'text-2xl' : 'text-lg sm:text-xl'
                  } ${
                    isDone
                      ? 'line-through text-slate-400'
                      : isDarkDisplay
                      ? 'text-white'
                      : 'text-slate-900'
                  }`}
                >
                  {task.title}
                </button>
                {isHigh && !isDone && (
                  <span
                    className={`${
                      isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
                    } font-bold ${
                      isDarkDisplay ? 'text-rose-400' : 'text-rose-600'
                    }`}
                  >
                    · ด่วนมาก
                  </span>
                )}
                {isNextUpcomingRow && (
                  <span
                    className={`${
                      isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
                    } font-bold ${
                      isDarkDisplay ? 'text-amber-300' : 'text-amber-700'
                    }`}
                  >
                    · กำลังจะถึงกำหนด (คิวถัดไป)
                  </span>
                )}
              </div>

              {displayDescription && (
                <p
                  className={`leading-relaxed break-words ${
                    isLargeText ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
                  } ${isDarkDisplay ? 'text-slate-200' : 'text-slate-600'}`}
                >
                  {displayDescription}
                </p>
              )}

              <div
                className={`flex flex-wrap items-center gap-2.5 ${
                  isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
                } ${isDarkDisplay ? 'text-slate-200' : 'text-slate-600'} pt-1`}
              >
                <span
                  className="inline-flex items-center gap-2 font-bold"
                  style={{ color: displayCatColor }}
                >
                  <span
                    className="h-3 w-3 rounded-xs shrink-0"
                    style={{ backgroundColor: displayCatColor }}
                  />
                  <span>{cat?.name || 'ทั่วไป'}</span>
                </span>

                {totalSpanDays > 1 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-bold ${
                        isDarkDisplay ? 'text-sky-300' : 'text-indigo-600'
                      }`}
                    >
                      {!expandMultiDay
                        ? `🗓️ กำหนดการต่อเนื่อง: ${formatTaskDateRangeLabel(
                            task,
                            'long'
                          )}`
                        : `งานต่อเนื่อง ${formatTaskDateRangeLabel(
                            task,
                            'short'
                          ).replace(/\s*\(\d+\s*วัน\)$/, '')} (วันที่ ${dayIndexOfSpan} จาก ${totalSpanDays} วัน)`}
                    </span>
                  </>
                )}

                {detectedVenue && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-semibold ${
                        isDarkDisplay ? 'text-amber-200' : 'text-slate-700'
                      }`}
                    >
                      สถานที่: {detectedVenue}
                    </span>
                  </>
                )}

                {task.assigneeName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-medium ${
                        isDarkDisplay ? 'text-slate-200' : 'text-slate-600'
                      }`}
                    >
                      ผู้รับผิดชอบ: {task.assigneeName}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Status & Quick Action */}
          <div className="flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleCycleTaskStatus(task, isDone, isInProgress)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${
                isLargeText ? 'text-base' : 'text-sm'
              } font-bold transition-colors whitespace-nowrap shrink-0 ${
                isDone
                  ? isDarkDisplay
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : isInProgress
                  ? isDarkDisplay
                    ? 'bg-sky-950/65 border-sky-600 text-sky-300 hover:bg-sky-900/60'
                    : isEmeraldExec
                    ? 'bg-teal-50 border-teal-300 text-teal-900 hover:bg-teal-100/80'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100/80'
                  : isCurrentDayPassed
                  ? isDarkDisplay
                    ? 'bg-amber-950/60 border-amber-700 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                  : isDarkDisplay
                  ? 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {isDone ? (
                <>
                  <CheckCircle2
                    className={`h-4 w-4 ${
                      isDarkDisplay ? 'text-emerald-400' : 'text-emerald-600'
                    }`}
                  />
                  <span>เสร็จสิ้นแล้ว</span>
                </>
              ) : isInProgress ? (
                <>
                  <Clock
                    className={`h-4 w-4 ${
                      isDarkDisplay
                        ? 'text-sky-400'
                        : isEmeraldExec
                        ? 'text-teal-700'
                        : 'text-indigo-600'
                    }`}
                  />
                  <span>กำลังดำเนินการ</span>
                </>
              ) : (
                <>
                  <Circle
                    className="h-4 w-4"
                    style={{ color: displayCatColor }}
                  />
                  <span>
                    {isCurrentDayPassed ? 'ถึงกำหนดเวลา' : 'รอดำเนินการ'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      );
    };

    const renderPeriodSubHeader = (
      period: 'morning' | 'afternoon',
      periodItems: DayGroupEntry['items']
    ) => {
      const isMorning = period === 'morning';
      const pendingPeriodCount = periodItems.filter(
        (entry) => entry.task.status !== TaskStatus.COMPLETED
      ).length;

      return (
        <div
          key={`period-header-${group.date}-${period}`}
          className={`px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
            isMorning
              ? isNavyGold
                ? 'bg-[#0B1930] text-amber-200'
                : isDarkDisplay
                ? 'bg-slate-950/90 text-amber-300'
                : isEmeraldExec
                ? 'bg-emerald-50/55 text-emerald-950'
                : 'bg-slate-50/95 text-slate-800'
              : isNavyGold
              ? 'bg-[#0B1930] text-sky-200'
              : isDarkDisplay
              ? 'bg-slate-950/90 text-sky-300'
              : isEmeraldExec
              ? 'bg-teal-50/55 text-teal-950'
              : 'bg-indigo-50/45 text-indigo-950'
          }`}
        >
          <div className="flex items-center gap-2">
            {isMorning ? (
              <Sun
                className={`h-4 w-4 shrink-0 ${
                  isNavyGold || isDarkDisplay ? 'text-amber-300' : 'text-amber-600'
                }`}
              />
            ) : (
              <Sunset
                className={`h-4 w-4 shrink-0 ${
                  isNavyGold || isDarkDisplay ? 'text-sky-300' : 'text-indigo-600'
                }`}
              />
            )}
            <span
              className={`font-extrabold tracking-tight ${
                isLargeText ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'
              }`}
            >
              {isMorning ? 'ภารกิจภาคเช้า' : 'ภารกิจภาคบ่าย'}
            </span>
            <span
              className={`font-medium ${
                isLargeText ? 'text-sm sm:text-base' : 'text-xs'
              } ${
                isNavyGold || isDarkDisplay ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {isMorning ? '(ก่อน 12:00 น.)' : '(ตั้งแต่ 12:00 น. เป็นต้นไป)'}
            </span>
          </div>

          <div
            className={`font-sans tabular-nums font-bold ${
              isLargeText ? 'text-sm sm:text-base' : 'text-xs'
            } ${
              periodItems.length === 0
                ? isNavyGold || isDarkDisplay
                  ? 'text-slate-400'
                  : 'text-slate-500'
                : isNavyGold || isDarkDisplay
                ? 'text-slate-200'
                : 'text-slate-700'
            }`}
          >
            {periodItems.length === 0
              ? 'ว่างปฏิบัติราชการ'
              : `${periodItems.length} รายการ${
                  pendingPeriodCount > 0
                    ? ` · รอดำเนินการ ${pendingPeriodCount}`
                    : ' · เสร็จสิ้นครบ'
                }`}
          </div>
        </div>
      );
    };

    const renderPeriodRows = (
      period: 'morning' | 'afternoon',
      periodItems: DayGroupEntry['items']
    ) => {
      if (periodItems.length === 0) {
        return (
          <div
            key={`empty-period-${group.date}-${period}`}
            className={`px-6 py-3.5 flex items-center gap-5 ${
              isLargeText ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'
            } ${isDarkDisplay ? 'text-slate-400' : 'text-slate-500'}`}
          >
            <div className="w-36 sm:w-44 shrink-0 font-sans tabular-nums font-semibold opacity-75">
              {period === 'morning' ? '08:30 – 12:00 น.' : '13:00 – 16:30 น.'}
            </div>
            <div className="font-medium">
              {period === 'morning'
                ? 'ไม่มีนัดหมายในช่วงเช้า — ว่างปฏิบัติราชการ'
                : 'ไม่มีนัดหมายในช่วงบ่าย — ว่างปฏิบัติราชการ'}
            </div>
          </div>
        );
      }

      return periodItems.map((entry, idx) =>
        renderTaskRow(entry, `${period}-${idx}`)
      );
    };

    return (
      <section
        key={group.date}
        className={`rounded-2xl border ${
          scrollRowsOnly && isPresentationMode ? 'flex-1 min-h-0 flex flex-col ' : ''
        }${
          stickyHeaderInsideScroll ? '' : 'overflow-hidden'
        } transition-colors ${
          isTodayGroup
            ? isNavyGold
              ? 'bg-[#0F213C] border-amber-400/80'
              : isDarkDisplay
              ? 'bg-slate-900 border-emerald-500/70'
              : isEmeraldExec
              ? 'bg-white border-emerald-400'
              : 'bg-white border-indigo-300'
            : isNavyGold
            ? 'bg-[#0F213C] border-slate-700/80'
            : isDarkDisplay
            ? 'bg-slate-900 border-slate-800'
            : isEmeraldExec
            ? 'bg-white border-emerald-200'
            : 'bg-white border-slate-200'
        }`}
      >
        {/* Day Header Bar (Single-line layout, 100% Solid Opaque so task rows never show through or above) */}
        <div
          className={`shrink-0 px-4 sm:px-5 py-3 border-b flex flex-nowrap items-center justify-between gap-3 ${
            stickyHeaderInsideScroll ? 'sticky top-0 z-10 rounded-t-2xl ' : ''
          }${
            isDarkDisplay
              ? 'bg-white border-slate-200 text-slate-900'
              : isEmeraldExec
              ? isTodayGroup
                ? 'bg-emerald-50 border-emerald-200 text-slate-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
              : isTodayGroup
              ? 'bg-indigo-50 border-indigo-200/90'
              : 'bg-slate-50 border-slate-200/90'
          }`}
        >
          <div className="flex flex-nowrap items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <CalendarIcon
              className={`h-5 w-5 shrink-0 ${
                isTodayGroup
                  ? isEmeraldExec
                    ? 'text-emerald-700'
                    : 'text-indigo-600'
                  : 'text-slate-600'
              }`}
            />
            <h2
              className={`font-extrabold text-slate-900 whitespace-nowrap truncate ${
                isTvStageActive
                  ? isLargeText
                    ? 'text-2xl'
                    : 'text-lg'
                  : isLargeText
                  ? 'text-lg sm:text-xl xl:text-2xl'
                  : 'text-sm sm:text-base lg:text-lg'
              }`}
            >
              {!expandMultiDay && !isTodayGroup && layoutMode !== 'single_day'
                ? formatSummaryCardHeaderDate(
                    group.date,
                    group.items.map((i) => i.task)
                  )
                : formatFullThaiDayHeader(group.date)}
            </h2>
            <span
              className={`whitespace-nowrap shrink-0 ${
                isTvStageActive
                  ? isLargeText
                    ? 'text-lg'
                    : 'text-sm'
                  : isLargeText
                  ? 'text-sm sm:text-base xl:text-lg'
                  : 'text-xs sm:text-sm'
              } font-bold ${
                rel.tone === 'today'
                  ? 'text-emerald-600'
                  : rel.tone === 'tomorrow'
                  ? 'text-indigo-600'
                  : 'text-slate-600'
              }`}
            >
              · {rel.text}
            </span>
          </div>

          <div
            className={`flex flex-nowrap items-center gap-2.5 sm:gap-3 shrink-0 whitespace-nowrap ${
              isLargeText ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
            }`}
          >
            <div className="font-sans tabular-nums font-bold text-slate-700 whitespace-nowrap">
              รวม {group.items.length} งาน (รอทำ {pendingInDay} · เสร็จแล้ว {doneInDay})
            </div>
            {!isTvCleanSignage && (
              <button
                type="button"
                onClick={() => onAddTaskForDate(group.date)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm text-white font-bold transition-colors whitespace-nowrap shrink-0 ${
                  isEmeraldExec
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>เพิ่มงานวันนี้</span>
              </button>
            )}
          </div>
        </div>

        {/* Day Schedule Rows */}
        <div
          ref={scrollRowsOnly ? autoScrollViewportRef : undefined}
          style={
            scrollRowsOnly && !isPresentationMode
              ? { maxHeight: `${autoScrollMaxHeight}px` }
              : isPinnedInStack
              ? {
                  maxHeight: isTvStageActive
                    ? `${Math.round(tvStageMetrics.stageH * 0.32)}px`
                    : '34vh',
                }
              : undefined
          }
          className={`${
            stickyHeaderInsideScroll ? 'rounded-b-2xl overflow-hidden ' : ''
          }${
            scrollRowsOnly
              ? isPresentationMode
                ? isAutoScroll
                  ? 'flex-1 min-h-0 overflow-hidden'
                  : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'
                : isAutoScroll
                ? 'overflow-hidden'
                : 'overflow-y-auto overflow-x-hidden'
              : isPinnedInStack
              ? 'overflow-y-auto overflow-x-hidden'
              : ''
          }`}
        >
          <div
            ref={scrollRowsOnly ? autoScrollTrackRef : undefined}
            style={
              scrollRowsOnly && isAutoScroll
                ? { willChange: 'transform', backfaceVisibility: 'hidden' }
                : undefined
            }
            className={`divide-y ${
              isDarkDisplay ? 'divide-slate-800' : 'divide-slate-200'
            }`}
          >
            {shouldSplitPeriods ? (
              <>
                {renderPeriodSubHeader('morning', morningItems)}
                {renderPeriodRows('morning', morningItems)}
                {renderPeriodSubHeader('afternoon', afternoonItems)}
                {renderPeriodRows('afternoon', afternoonItems)}
              </>
            ) : (
              group.items.map((entry, idx) => renderTaskRow(entry, idx))
            )}
          </div>
        </div>
      </section>
    );
  };

  const presentationSurfaceClasses = isNavyGold
    ? 'bg-[#0A1628] text-slate-100'
    : isDarkDisplay
    ? 'bg-slate-950 text-slate-100'
    : isEmeraldExec
    ? 'bg-[#F0FDF4] text-slate-900'
    : 'bg-slate-50 text-slate-900';

  return (
    <div
      onMouseMove={isPresentationMode ? wakeTvControls : undefined}
      onPointerDown={isPresentationMode ? wakeTvControls : undefined}
      onTouchStart={isPresentationMode ? wakeTvControls : undefined}
      onWheel={isPresentationMode ? wakeTvControls : undefined}
      className={
        isPresentationMode
          ? `fixed inset-0 z-50 overflow-hidden transition-colors ${presentationSurfaceClasses} ${
              isTvCleanSignage ? 'cursor-none' : ''
            }`
          : ''
      }
    >
      <div
        ref={containerRef}
        style={
          isTvStageActive
            ? {
                width: `${tvStageMetrics.stageW}px`,
                height: `${tvStageMetrics.stageH}px`,
                transform:
                  tvStageMetrics.scale !== 1 ? `scale(${tvStageMetrics.scale})` : undefined,
                transformOrigin: 'top left',
              }
            : undefined
        }
        className={`transition-colors ${
          isPresentationMode
            ? `flex flex-col overflow-hidden ${presentationSurfaceClasses} ${
                isTvAutoFit
                  ? 'px-[2.2%] py-[1.6%] gap-3.5'
                  : 'h-full w-full p-6 sm:p-8 gap-3.5'
              }`
            : isNavyGold
            ? 'space-y-4 bg-[#0A1628] text-slate-100 rounded-2xl p-6 border border-amber-400/40'
            : isDarkDisplay
            ? 'space-y-4 bg-slate-950 text-slate-100 rounded-2xl p-6 border border-slate-800'
            : isEmeraldExec
            ? 'space-y-4 bg-[#F0FDF4] text-slate-900 rounded-2xl p-6 border border-emerald-200'
            : 'space-y-4'
        }`}
      >
      {/* Unified Solid Opaque Top Header Stack (Zero Open Gaps Above or Between Sticky Headers) */}
      <div
        ref={topStackRef}
        style={
          !isPresentationMode
            ? {
                top: `${headerHeight}px`,
                backgroundColor: stickyMaskColor,
              }
            : undefined
        }
        className={
          isPresentationMode
            ? 'shrink-0 space-y-3'
            : 'sticky z-30 -mx-2 px-2 pt-2 pb-3 space-y-3.5'
        }
      >
        {/* Top Executive Presentation Banner & Live Clock */}
        <div
          ref={bannerRef}
          className={`rounded-2xl border overflow-hidden shadow-xs transition-colors ${
            isNavyGold
              ? 'bg-[#0F213C] bg-gradient-to-br from-[#0F213C] via-[#13294B] to-[#0B182D] border-amber-400/50 text-white'
              : isDarkDisplay
              ? 'bg-slate-900 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-slate-700/80 text-white'
              : isEmeraldExec
              ? 'bg-white bg-gradient-to-br from-white via-emerald-50 to-teal-50/70 border-emerald-200/90 text-slate-900'
              : 'bg-white bg-gradient-to-br from-white via-slate-50 to-indigo-50/65 border-slate-200/90 text-slate-900'
          }`}
        >
        {/* Top Ceremonial Accent Bar */}
        <div
          aria-hidden="true"
          className={`h-1.5 w-full ${
            isNavyGold
              ? 'bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500'
              : isDarkDisplay
              ? 'bg-gradient-to-r from-sky-500 via-indigo-400 to-emerald-400'
              : isEmeraldExec
              ? 'bg-gradient-to-r from-emerald-700 via-teal-500 to-amber-400'
              : 'bg-gradient-to-r from-indigo-900 via-indigo-600 to-amber-500'
          }`}
        />

        <div className={isTvStageActive ? 'px-6 py-4' : 'p-5 sm:p-6'}>
          <div
            className={`flex ${
              isLandscapeTvStage
                ? 'flex-row items-center'
                : isPortraitTvStage
                ? 'flex-col items-stretch'
                : 'flex-col lg:flex-row lg:items-center'
            } justify-between gap-5`}
          >
            <div className="flex items-center gap-4 sm:gap-5 min-w-0">
              <div
                className={`${
                  isTvStageActive
                    ? 'h-24 w-24'
                    : 'h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28'
                } rounded-full bg-white overflow-hidden border-2 flex items-center justify-center shrink-0 transition-shadow ${
                  isNavyGold
                    ? 'border-amber-300 ring-4 ring-amber-400/20 shadow-md'
                    : isDarkDisplay
                    ? 'border-sky-400/80 ring-4 ring-sky-400/15 shadow-md'
                    : isEmeraldExec
                    ? 'border-emerald-400 ring-4 ring-emerald-500/15 shadow-xs'
                    : 'border-indigo-200 ring-4 ring-indigo-500/10 shadow-xs'
                }`}
              >
                <img
                  src={ROBOT_MASCOT_DATA_URI}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.dataset.fallbackUsed) {
                      target.dataset.fallbackUsed = '1';
                      target.src = '/assets/aistudio/images_b42759e5.jpg';
                    }
                  }}
                  alt="ตราสัญลักษณ์ระบบตารางภารกิจ"
                  className="h-full w-full object-cover scale-105 rounded-full"
                />
              </div>

              <div className="min-w-0 space-y-1.5">
                <h1
                  className={`font-extrabold tracking-tight leading-tight text-balance ${
                    isTvStageActive
                      ? isLargeText
                        ? 'text-[42px]'
                        : 'text-[34px]'
                      : isLargeText
                      ? 'text-3xl sm:text-4xl md:text-[44px]'
                      : 'text-2xl sm:text-3xl md:text-[36px]'
                  } ${
                    isNavyGold
                      ? 'text-amber-50'
                      : isDarkDisplay
                      ? 'text-white'
                      : 'text-slate-900'
                  }`}
                >
                  กำหนดการภารกิจของผู้อำนวยการ
                </h1>
                <div
                  className={`font-semibold tracking-wide ${
                    isTvStageActive
                      ? isLargeText
                        ? 'text-base'
                        : 'text-sm'
                      : isLargeText
                      ? 'text-sm sm:text-base'
                      : 'text-xs sm:text-sm'
                  } ${
                    isNavyGold
                      ? 'text-amber-300/95'
                      : isDarkDisplay
                      ? 'text-sky-300'
                      : isEmeraldExec
                      ? 'text-emerald-700'
                      : 'text-indigo-700'
                  }`}
                >
                  สำนักบริหารแรงงานต่างด้าว · กรมการจัดหางาน
                </div>
              </div>
            </div>

            {/* Right Live Thailand Digital Clock */}
            <div
              className={`flex items-center shrink-0 ${
                isLandscapeTvStage
                  ? 'w-auto'
                  : isPortraitTvStage
                  ? 'w-full'
                  : 'w-full lg:w-auto'
              }`}
            >
              <div
                className={`${
                  isLandscapeTvStage
                    ? 'w-auto min-w-[460px]'
                    : isPortraitTvStage
                    ? 'w-full'
                    : 'w-full lg:w-auto min-w-[300px] sm:min-w-[420px] xl:min-w-[470px]'
                } rounded-2xl border overflow-hidden transition-colors ${
                  isNavyGold
                    ? 'bg-[#081221] border-amber-400/50 text-white'
                    : isDarkDisplay
                    ? 'bg-slate-950 border-slate-700/90 text-white'
                    : isEmeraldExec
                    ? 'bg-white border-emerald-200/95 text-slate-900'
                    : 'bg-white border-indigo-200/90 text-slate-900'
                }`}
              >
                <div
                  className={`flex items-center justify-center gap-2.5 px-6 sm:px-8 py-2.5 border-b font-bold tracking-tight text-center whitespace-nowrap ${
                    isTvStageActive
                      ? isLargeText
                        ? 'text-[25px]'
                        : 'text-[21px]'
                      : isLargeText
                      ? 'text-lg sm:text-2xl md:text-[26px]'
                      : 'text-base sm:text-xl md:text-[22px]'
                  } ${
                    isNavyGold
                      ? 'bg-amber-400/12 border-amber-400/25 text-amber-200'
                      : isDarkDisplay
                      ? 'bg-slate-900/95 border-slate-800 text-sky-200'
                      : isEmeraldExec
                      ? 'bg-emerald-50/85 border-emerald-100 text-emerald-950'
                      : 'bg-indigo-50/80 border-indigo-100 text-indigo-950'
                }`}
                >
                  <CalendarIcon
                    className={`h-4 w-4 sm:h-5 sm:w-5 shrink-0 ${
                      isNavyGold
                        ? 'text-amber-300'
                        : isDarkDisplay
                        ? 'text-sky-400'
                        : isEmeraldExec
                        ? 'text-emerald-700'
                        : 'text-indigo-700'
                    }`}
                  />
                  <span>{formatFullThaiDayHeader(todayStr)}</span>
                </div>

                <div className="px-6 sm:px-8 py-3 flex items-baseline justify-center gap-2">
                  <LiveBangkokClockDisplay
                    isLargeText={isLargeText}
                    isNavyGold={isNavyGold}
                    isDarkDisplay={isDarkDisplay}
                    isEmeraldExec={isEmeraldExec}
                    isTvStageActive={isTvStageActive}
                  />
                  <span
                    className={`font-extrabold tracking-tight ml-0.5 ${
                      isTvStageActive
                        ? isLargeText
                          ? 'text-[26px]'
                          : 'text-[22px]'
                        : isLargeText
                        ? 'text-xl sm:text-2xl md:text-[28px]'
                        : 'text-lg sm:text-xl md:text-2xl'
                    } ${
                      isNavyGold
                        ? 'text-amber-300'
                        : isDarkDisplay
                        ? 'text-sky-300'
                        : isEmeraldExec
                        ? 'text-emerald-800'
                        : 'text-indigo-800'
                    }`}
                  >
                    น.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Director Live Presence Status Strip (Front-Office Executive Display) */}
          <div
            className={`mt-3.5 pt-3 border-t flex ${
              isLandscapeTvStage
                ? 'flex-row items-center'
                : 'flex-col xl:flex-row xl:items-center'
            } justify-between gap-3 ${
              isNavyGold
                ? 'border-amber-400/20'
                : isDarkDisplay
                ? 'border-slate-800'
                : isEmeraldExec
                ? 'border-emerald-200/70'
                : 'border-slate-200/80'
            }`}
          >
            {/* Left: Current Director Status Readout */}
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <div
                className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  resolvedDirectorPresence.meta.tone === 'emerald'
                    ? isDarkDisplay
                      ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : resolvedDirectorPresence.meta.tone === 'amber'
                    ? isDarkDisplay
                      ? 'bg-amber-500/15 border-amber-400/50 text-amber-300'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                    : resolvedDirectorPresence.meta.tone === 'sky'
                    ? isDarkDisplay
                      ? 'bg-sky-500/15 border-sky-400/50 text-sky-300'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : isDarkDisplay
                    ? 'bg-rose-500/15 border-rose-400/50 text-rose-300'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {resolvedDirectorPresence.effectiveStatus === 'in_office' ? (
                  <Building2 className="h-5 w-5" />
                ) : resolvedDirectorPresence.effectiveStatus === 'in_meeting' ? (
                  <Users className="h-5 w-5" />
                ) : resolvedDirectorPresence.effectiveStatus === 'offsite' ? (
                  <MapPin className="h-5 w-5" />
                ) : (
                  <Ban className="h-5 w-5" />
                )}
              </div>

              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={`font-semibold whitespace-nowrap ${
                    isLargeText ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
                  } ${
                    isNavyGold
                      ? 'text-amber-200/90'
                      : isDarkDisplay
                      ? 'text-slate-300'
                      : 'text-slate-600'
                  }`}
                >
                  สถานะผู้อำนวยการ:
                </span>

                <span
                  className={`font-extrabold tracking-tight ${
                    isLargeText ? 'text-lg sm:text-2xl' : 'text-sm sm:text-lg'
                  } ${
                    resolvedDirectorPresence.meta.tone === 'emerald'
                      ? isDarkDisplay
                        ? 'text-emerald-300'
                        : 'text-emerald-800'
                      : resolvedDirectorPresence.meta.tone === 'amber'
                      ? isDarkDisplay
                        ? 'text-amber-300'
                        : 'text-amber-800'
                      : resolvedDirectorPresence.meta.tone === 'sky'
                      ? isDarkDisplay
                        ? 'text-sky-300'
                        : 'text-indigo-800'
                      : isDarkDisplay
                      ? 'text-rose-300'
                      : 'text-rose-700'
                  }`}
                >
                  {resolvedDirectorPresence.meta.label}
                </span>

                {resolvedDirectorPresence.customNote ? (
                  <span
                    className={`font-semibold break-words ${
                      isLargeText ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'
                    } ${
                      isNavyGold
                        ? 'text-amber-100'
                        : isDarkDisplay
                        ? 'text-slate-200'
                        : 'text-slate-700'
                    }`}
                  >
                    · {resolvedDirectorPresence.customNote}
                  </span>
                ) : resolvedDirectorPresence.isAuto &&
                  resolvedDirectorPresence.autoDetail ? (
                  <span
                    className={`font-medium break-words ${
                      isLargeText ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
                    } ${
                      isNavyGold
                        ? 'text-slate-300'
                        : isDarkDisplay
                        ? 'text-slate-300'
                        : 'text-slate-600'
                    }`}
                  >
                    · {resolvedDirectorPresence.autoDetail}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Right: Quick 1-Click Secretary Controls (Hidden when fullscreen toolbar is collapsed) */}
            {!isToolbarCollapsed && (
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {isEditingPresenceNote ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      updateDirectorPresence(directorPresence.mode, presenceNoteDraft);
                      setIsEditingPresenceNote(false);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={presenceNoteDraft}
                      onChange={(e) => setPresenceNoteDraft(e.target.value)}
                      placeholder="เช่น กลับเข้าสำนักฯ เวลา 15:00 น."
                      maxLength={160}
                      autoFocus
                      className={`h-8 w-52 sm:w-64 rounded-lg border px-2.5 text-xs font-medium focus:outline-none ${
                        isNavyGold
                          ? 'bg-[#091526] border-amber-400/50 text-white placeholder:text-slate-400'
                          : isDarkDisplay
                          ? 'bg-slate-950 border-slate-700 text-white placeholder:text-slate-500'
                          : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400'
                      }`}
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-nowrap shrink-0"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>บันทึก</span>
                    </button>
                    {directorPresence.customNote && (
                      <button
                        type="button"
                        onClick={() => {
                          setPresenceNoteDraft('');
                          updateDirectorPresence(directorPresence.mode, '');
                          setIsEditingPresenceNote(false);
                        }}
                        className={`inline-flex items-center h-8 px-2 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 ${
                          isDarkDisplay
                            ? 'bg-slate-800 border-slate-700 text-rose-300 hover:bg-slate-700'
                            : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'
                        }`}
                      >
                        ล้าง
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsEditingPresenceNote(false)}
                      className={`inline-flex items-center justify-center h-8 w-8 rounded-lg border shrink-0 ${
                        isDarkDisplay
                          ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                      aria-label="ปิดช่องแก้ไขหมายเหตุ"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <>
                    {(
                      [
                        { id: 'auto', label: 'อัตโนมัติ' },
                        { id: 'in_office', label: 'ณ ห้องทำงาน' },
                        { id: 'in_meeting', label: 'ติดประชุม' },
                        { id: 'offsite', label: 'ไปราชการ' },
                        { id: 'unavailable', label: 'งดรับนัด' },
                      ] as Array<{ id: DirectorPresenceMode; label: string }>
                    ).map((opt) => {
                      const active = directorPresence.mode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateDirectorPresence(opt.id)}
                          className={`inline-flex items-center h-7 px-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? isNavyGold
                                ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold'
                                : isEmeraldExec
                                ? 'bg-emerald-700 text-white border-emerald-700 font-bold'
                                : 'bg-indigo-600 text-white border-indigo-600 font-bold'
                              : isNavyGold
                              ? 'bg-[#091526]/75 text-slate-200 border-amber-400/25 hover:border-amber-400/55'
                              : isDarkDisplay
                              ? 'bg-slate-800/85 text-slate-200 border-slate-700 hover:bg-slate-700'
                              : 'bg-white text-slate-600 border-slate-200/90 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setPresenceNoteDraft(directorPresence.customNote || '');
                        setIsEditingPresenceNote(true);
                      }}
                      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        directorPresence.customNote
                          ? isNavyGold || isDarkDisplay
                            ? 'bg-amber-400/15 border-amber-400/50 text-amber-200'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                          : isNavyGold
                          ? 'bg-[#091526]/75 text-slate-300 border-amber-400/25 hover:border-amber-400/55'
                          : isDarkDisplay
                          ? 'bg-slate-800/85 text-slate-300 border-slate-700 hover:bg-slate-700'
                          : 'bg-white text-slate-600 border-slate-200/90 hover:bg-slate-50'
                      }`}
                    >
                      <Edit3 className="h-3 w-3" />
                      <span>
                        {directorPresence.customNote ? 'แก้หมายเหตุ' : 'หมายเหตุ'}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Today's Highlight Strip + Compact Presentation Action Buttons */}
          <div
            className={`mt-3 pt-3 border-t flex ${
              isLandscapeTvStage
                ? 'flex-row items-center'
                : 'flex-col xl:flex-row xl:items-center'
            } justify-between gap-3.5 text-xs ${
              isNavyGold
                ? 'border-amber-400/20 text-slate-200'
                : isDarkDisplay
                ? 'border-slate-800 text-slate-300'
                : isEmeraldExec
                ? 'border-emerald-200/70 text-slate-600'
                : 'border-slate-200/80 text-slate-600'
            }`}
          >
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${
                isTvStageActive
                  ? isLargeText
                    ? 'text-lg'
                    : 'text-sm'
                  : isLargeText
                  ? 'text-base sm:text-lg'
                  : 'text-xs sm:text-sm'
              }`}
            >
              <span
                className={`font-bold ${
                  isDarkDisplay ? 'text-white' : 'text-slate-900'
                }`}
              >
                สรุปภารกิจวันนี้ ({formatThaiDateDisplay(todayStr, 'long')}):
              </span>

              <span className="inline-flex items-baseline gap-1">
                <span>ทั้งหมด</span>
                <strong
                  className={`font-sans tabular-nums font-extrabold ${
                    isNavyGold
                      ? 'text-amber-300'
                      : isDarkDisplay
                      ? 'text-sky-300'
                      : isEmeraldExec
                      ? 'text-emerald-700'
                      : 'text-indigo-700'
                  }`}
                >
                  {todayTasksSummary.total}
                </strong>
                <span>งาน</span>
              </span>

              <span aria-hidden="true" className="opacity-40">
                ·
              </span>

              <span className="inline-flex items-baseline gap-1">
                <span>รอดำเนินการ</span>
                <strong
                  className={`font-sans tabular-nums font-extrabold ${
                    isDarkDisplay ? 'text-amber-300' : 'text-amber-700'
                  }`}
                >
                  {todayTasksSummary.pending}
                </strong>
                <span>งาน</span>
              </span>

              <span aria-hidden="true" className="opacity-40">
                ·
              </span>

              <span className="inline-flex items-baseline gap-1">
                <span>เสร็จสิ้นแล้ว</span>
                <strong
                  className={`font-sans tabular-nums font-extrabold ${
                    isDarkDisplay ? 'text-emerald-300' : 'text-emerald-700'
                  }`}
                >
                  {todayTasksSummary.completed}
                </strong>
                <span>งาน</span>
              </span>

              {todayTasksSummary.nextUpcoming ? (
                <div className="inline-flex flex-wrap items-center gap-1.5 font-medium">
                  <span aria-hidden="true" className="opacity-30 px-0.5">
                    |
                  </span>
                  <Clock
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isNavyGold || isDarkDisplay ? 'text-amber-300' : 'text-indigo-600'
                    }`}
                  />
                  <span>
                    ภารกิจถัดไป:{' '}
                    <strong
                      className={
                        isNavyGold || isDarkDisplay ? 'text-amber-200' : 'text-slate-900'
                      }
                    >
                      {todayTasksSummary.nextUpcoming.time} น. —{' '}
                      {todayTasksSummary.nextUpcoming.title}
                    </strong>
                  </span>
                  {todayTasksSummary.nextCountdownLabel && (
                    <span
                      className={`font-sans tabular-nums font-bold ${
                        isNavyGold
                          ? 'text-amber-300'
                          : isDarkDisplay
                          ? 'text-sky-300'
                          : isEmeraldExec
                          ? 'text-emerald-700'
                          : 'text-indigo-700'
                      }`}
                    >
                      ({todayTasksSummary.nextCountdownLabel})
                    </span>
                  )}
                </div>
              ) : todayTasksSummary.inProgressTask ? (
                <div className="inline-flex flex-wrap items-center gap-1.5 font-medium">
                  <span aria-hidden="true" className="opacity-30 px-0.5">
                    |
                  </span>
                  <Clock
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isNavyGold || isDarkDisplay ? 'text-emerald-300' : 'text-emerald-600'
                    }`}
                  />
                  <span>
                    กำลังดำเนินการ:{' '}
                    <strong
                      className={
                        isNavyGold || isDarkDisplay ? 'text-emerald-200' : 'text-slate-900'
                      }
                    >
                      {todayTasksSummary.inProgressTask.time} น. —{' '}
                      {todayTasksSummary.inProgressTask.title}
                    </strong>
                  </span>
                </div>
              ) : null}
            </div>

            {!isTvCleanSignage && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleTvAutoFit}
                  title="คำนวณสัดส่วนความละเอียด ขอบจอ Overscan และขนาดตัวอักษรให้พอดีกับจอ TV อัตโนมัติ"
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isTvAutoFit
                      ? isNavyGold
                        ? 'bg-amber-400/20 text-amber-200 border-amber-400/70 shadow-xs'
                        : isDarkDisplay
                        ? 'bg-sky-500/20 text-sky-200 border-sky-400/70 shadow-xs'
                        : isEmeraldExec
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                        : 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : isNavyGold
                      ? 'bg-[#091526]/80 text-slate-200 border-amber-400/30 hover:border-amber-400/60'
                      : isDarkDisplay
                      ? 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <Tv className="h-3.5 w-3.5" />
                  <span>
                    {isTvAutoFit
                      ? isPresentationMode && tvStageMetrics.scale !== 1
                        ? `ปรับตามจอ TV อัตโนมัติ (${Math.round(tvStageMetrics.scale * 100)}%)`
                        : 'ปรับตามจอ TV อัตโนมัติ'
                      : 'สัดส่วนปกติ (1:1)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsTvRemoteModalOpen(true);
                    requestConnectedTvPing();
                  }}
                  title="เชื่อมต่อและควบคุมจอ TV แบบเรียลไทม์ (คนละเครื่องผ่าน Wi-Fi/อินเทอร์เน็ต หรือต่อสาย HDMI 2 จอ)"
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    activeTvScreenList.length > 0
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs hover:bg-emerald-700'
                      : isNavyGold
                      ? 'bg-[#091526]/80 text-amber-200 border-amber-400/35 hover:border-amber-400/70'
                      : isDarkDisplay
                      ? 'bg-slate-800/90 text-sky-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50/70 hover:border-indigo-300'
                  }`}
                >
                  <Radio className="h-3.5 w-3.5" />
                  <span>
                    {activeTvScreenList.length > 0
                      ? `เชื่อมต่อจอ TV แล้ว (${activeTvScreenList.length})`
                      : 'เชื่อมต่อจอ TV เรียลไทม์'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAutoScroll((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isAutoScroll
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : isNavyGold
                      ? 'bg-[#091526]/80 text-slate-100 border-amber-400/30 hover:border-amber-400/60'
                      : isDarkDisplay
                      ? 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  {isAutoScroll ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      <span>หยุดเลื่อนจอ</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>เลื่อนจออัตโนมัติ (TV)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setIsLargeText((prev) => !prev)}
                  className={`inline-flex items-center h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isLargeText
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : isNavyGold
                      ? 'bg-[#091526]/80 text-slate-100 border-amber-400/30 hover:border-amber-400/60'
                      : isDarkDisplay
                      ? 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700'
                      : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  {isLargeText ? 'ตัวอักษรใหญ่ (TV)' : 'ขยายตัวอักษรใหญ่'}
                </button>

                <button
                  type="button"
                  onClick={handleCycleTheme}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                    isNavyGold || isDarkDisplay
                      ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold hover:bg-amber-300'
                      : isEmeraldExec
                      ? 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800'
                      : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                  }`}
                >
                  <Palette className="h-3.5 w-3.5" />
                  <span>{themeButtonLabel}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTogglePresentationFullscreen}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#06C755] hover:bg-[#05b04b] text-white text-xs font-bold shadow-xs transition-colors whitespace-nowrap shrink-0"
                >
                  {isPresentationMode ? (
                    <>
                      <Minimize2 className="h-3.5 w-3.5" />
                      <span>ออกจากโหมดเต็มจอ</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>เปิดโหมดเต็มจอ (นำเสนอ)</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter & View Mode Toolbar (100% Solid Opaque, Auto-Hidden in Clean TV Signage Mode when Idle) */}
      {!isTvCleanSignage && (
      <div
        ref={toolbarRef}
        className={`rounded-2xl border shadow-xs transition-all ${
          isToolbarCollapsed ? 'px-3.5 py-2' : 'p-3.5 sm:p-4 space-y-3'
        } ${
          isNavyGold
            ? 'bg-[#0F213C] border-amber-400/40 text-white'
            : isDarkDisplay
            ? 'bg-slate-900 border-slate-800 text-white'
            : isEmeraldExec
            ? 'bg-white border-emerald-200/90 text-slate-900'
            : 'bg-white border-slate-200/90 text-slate-900'
        }`}
      >
        {isToolbarCollapsed ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold min-w-0">
              <SlidersHorizontal
                className={`h-3.5 w-3.5 shrink-0 ${
                  isNavyGold
                    ? 'text-amber-300'
                    : isDarkDisplay
                    ? 'text-sky-400'
                    : isEmeraldExec
                    ? 'text-emerald-600'
                    : 'text-indigo-600'
                }`}
              />
              <span className={isDarkDisplay ? 'text-slate-200' : 'text-slate-700'}>
                แถบมุมมองและตัวกรองถูกย่อไว้:
              </span>
              <span
                className={`font-bold ${
                  isNavyGold
                    ? 'text-amber-300'
                    : isDarkDisplay
                    ? 'text-white'
                    : isEmeraldExec
                    ? 'text-emerald-800'
                    : 'text-indigo-700'
                }`}
              >
                {layoutMode === 'grouped_by_day'
                  ? 'แยกตารางตามวัน'
                  : layoutMode === 'split_two_column'
                  ? 'แบ่ง 2 คอลัมน์'
                  : layoutMode === 'single_day'
                  ? `เจาะจงรายวัน (${formatThaiDateDisplay(focusDate)})`
                  : 'ตารางรวมเรียงลำดับเวลา'}
              </span>
              {selectedCategoryId !== 'all' && (
                <span className="opacity-80">
                  · หมวด: {categoryMap[selectedCategoryId]?.name || 'ทั่วไป'}
                </span>
              )}
              {searchQuery.trim() && (
                <span className="opacity-80 truncate max-w-[200px]">
                  · ค้นหา: &ldquo;{searchQuery.trim()}&rdquo;
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsToolbarCollapsedInFullscreen(false)}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                isNavyGold
                  ? 'bg-amber-400 text-slate-950 border-amber-400 hover:bg-amber-300'
                  : isDarkDisplay
                  ? 'bg-slate-800 text-sky-300 border-slate-700 hover:bg-slate-700'
                  : isEmeraldExec
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
              title="แสดงแถบตัวกรองและสลับมุมมอง"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>ขยายแถบเครื่องมือ</span>
            </button>
          </div>
        ) : (
          <>
            {/* Toolbar Tier 1: Layout Switcher & Timeframe Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Segmented Layout Mode Tabs */}
          <div
            className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border ${
              isNavyGold
                ? 'bg-[#091526]/90 border-amber-400/25'
                : isDarkDisplay
                ? 'bg-slate-950 border-slate-800'
                : isEmeraldExec
                ? 'bg-emerald-50/70 border-emerald-200/70'
                : 'bg-slate-100/90 border-slate-200/70'
            }`}
          >
            {(
              [
                { id: 'grouped_by_day', label: 'แยกตารางตามวัน' },
                { id: 'split_two_column', label: 'แบ่ง 2 คอลัมน์ (วันนี้ + ล่วงหน้า)' },
                { id: 'single_day', label: 'เจาะจงรายวัน (1 วัน)' },
                { id: 'master_table', label: 'ตารางรวมเรียงลำดับเวลา' },
              ] as { id: BoardLayoutMode; label: string }[]
            ).map((tab) => {
              const isActive = layoutMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setLayoutMode(tab.id);
                    if (tab.id === 'single_day' && !focusDate) {
                      setFocusDate(todayStr);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 ${
                    isActive
                      ? isNavyGold
                        ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                        : isEmeraldExec
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-indigo-600 text-white shadow-xs'
                      : isDarkDisplay
                      ? 'text-slate-300 hover:text-white hover:bg-white/5'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/70'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Range Selector when not in single_day or split_two_column mode */}
          {layoutMode !== 'single_day' && layoutMode !== 'split_two_column' ? (
            <div
              className={`inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border ${
                isNavyGold
                  ? 'bg-[#091526]/90 border-amber-400/25'
                  : isDarkDisplay
                  ? 'bg-slate-950 border-slate-800'
                  : isEmeraldExec
                  ? 'bg-emerald-50/70 border-emerald-200/70'
                  : 'bg-slate-100/90 border-slate-200/70'
              }`}
            >
              {(
                [
                  { id: 'upcoming', label: 'วันนี้และงานล่วงหน้า' },
                  { id: 'today', label: 'เฉพาะวันนี้' },
                  { id: 'week7', label: '7 วันข้างหน้า' },
                  { id: 'all', label: 'ทุกวันทั้งหมด' },
                ] as { id: BoardRangeMode; label: string }[]
              ).map((item) => {
                const isRangeActive = rangeMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRangeMode(item.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-all whitespace-nowrap shrink-0 ${
                      isRangeActive
                        ? isDarkDisplay
                          ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                          : 'bg-white text-slate-900 font-bold shadow-xs'
                        : isDarkDisplay
                        ? 'text-slate-300 hover:text-white hover:bg-white/5 font-medium'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : layoutMode === 'single_day' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFocusDate((prev) => addDaysYMD(prev, -1))}
                className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-colors ${
                  isNavyGold
                    ? 'border-amber-400/30 bg-[#091526] hover:border-amber-400/60 text-amber-200'
                    : isDarkDisplay
                    ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
                title="วันก่อนหน้า"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={focusDate}
                onChange={(e) => setFocusDate(e.target.value || todayStr)}
                className={`h-8 rounded-lg border px-3 text-xs font-bold font-sans tabular-nums focus:outline-none ${
                  isNavyGold
                    ? 'border-amber-400/35 bg-[#091526] text-white focus:border-amber-400'
                    : isDarkDisplay
                    ? 'border-slate-700 bg-slate-950 text-white focus:border-sky-400'
                    : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-600'
                }`}
              />
              <button
                type="button"
                onClick={() => setFocusDate((prev) => addDaysYMD(prev, 1))}
                className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-colors ${
                  isNavyGold
                    ? 'border-amber-400/30 bg-[#091526] hover:border-amber-400/60 text-amber-200'
                    : isDarkDisplay
                    ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
                title="วันถัดไป"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFocusDate(todayStr)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  isNavyGold
                    ? 'bg-amber-400 text-slate-950 font-bold hover:bg-amber-300'
                    : isEmeraldExec
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                กลับมาวันนี้
              </button>
            </div>
          ) : null}

          {isPresentationMode && (
            <button
              type="button"
              onClick={() => setIsToolbarCollapsedInFullscreen(true)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-bold transition-colors whitespace-nowrap shrink-0 ml-auto ${
                isNavyGold
                  ? 'bg-[#091526]/90 text-amber-300 border-amber-400/40 hover:border-amber-400/80 hover:bg-[#091526]'
                  : isDarkDisplay
                  ? 'bg-slate-800 text-sky-300 border-slate-700 hover:bg-slate-700'
                  : isEmeraldExec
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/80'
              }`}
              title="ย่อแถบตัวกรองและสลับมุมมองเพื่อเพิ่มพื้นที่แสดงตารางงาน"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              <span>ย่อแถบเครื่องมือ</span>
            </button>
          )}
        </div>

        {/* Toolbar Tier 2: Search, Category & Priority Filters, and Display Toggles */}
        <div
          className={`pt-3 border-t flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 ${
            isNavyGold
              ? 'border-amber-400/20'
              : isDarkDisplay
              ? 'border-slate-800'
              : isEmeraldExec
              ? 'border-emerald-100'
              : 'border-slate-100'
          }`}
        >
          {/* Left: Unified Search & Select Dropdowns */}
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative min-w-[210px] flex-1 sm:max-w-xs">
              <Search
                className={`h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                  isDarkDisplay ? 'text-slate-400' : 'text-slate-400'
                }`}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่องาน, เวลา, สถานที่..."
                className={`w-full h-9 rounded-xl border pl-8 pr-8 text-xs font-medium transition-colors focus:outline-none ${
                  isNavyGold
                    ? 'bg-[#091526]/90 border-amber-400/30 text-white placeholder:text-slate-400 focus:border-amber-400'
                    : isDarkDisplay
                    ? 'bg-slate-950 border-slate-700 text-white placeholder:text-slate-400 focus:border-sky-400'
                    : 'bg-slate-50/70 hover:bg-white focus:bg-white border-slate-200/90 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500'
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md transition-colors ${
                    isDarkDisplay
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                  title="ล้างคำค้นหา"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className={`h-9 rounded-xl border px-3 text-xs font-semibold transition-colors focus:outline-none cursor-pointer ${
                isNavyGold
                  ? 'bg-[#091526]! focus:bg-[#0F213C]! border-amber-400/45! text-amber-50! shadow-none! focus:border-amber-300! scheme-dark'
                  : isDarkDisplay
                  ? 'bg-slate-950! focus:bg-slate-900! border-slate-700! text-white! shadow-none! focus:border-sky-400! scheme-dark'
                  : 'bg-slate-50/70 hover:bg-white border-slate-200/90 text-slate-800 focus:border-indigo-500 scheme-light'
              }`}
            >
              <option
                value="all"
                className={
                  isNavyGold
                    ? 'bg-[#0F213C] text-amber-50 font-bold'
                    : isDarkDisplay
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-white text-slate-900 font-bold'
                }
              >
                ทุกหมวดหมู่งาน
              </option>
              {categories.map((cat) => (
                <option
                  key={cat.id}
                  value={cat.id}
                  className={
                    isNavyGold
                      ? 'bg-[#0F213C] text-amber-50 font-semibold'
                      : isDarkDisplay
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-white text-slate-900 font-semibold'
                  }
                >
                  {cat.name}
                </option>
              ))}
            </select>

            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className={`h-9 rounded-xl border px-3 text-xs font-semibold transition-colors focus:outline-none cursor-pointer ${
                isNavyGold
                  ? 'bg-[#091526]! focus:bg-[#0F213C]! border-amber-400/45! text-amber-50! shadow-none! focus:border-amber-300! scheme-dark'
                  : isDarkDisplay
                  ? 'bg-slate-950! focus:bg-slate-900! border-slate-700! text-white! shadow-none! focus:border-sky-400! scheme-dark'
                  : 'bg-slate-50/70 hover:bg-white border-slate-200/90 text-slate-800 focus:border-indigo-500 scheme-light'
              }`}
            >
              <option
                value="all"
                className={
                  isNavyGold
                    ? 'bg-[#0F213C] text-amber-50 font-bold'
                    : isDarkDisplay
                    ? 'bg-slate-900 text-white font-bold'
                    : 'bg-white text-slate-900 font-bold'
                }
              >
                ทุกระดับความสำคัญ
              </option>
              <option
                value={TaskPriority.HIGH}
                className={
                  isNavyGold
                    ? 'bg-[#0F213C] text-rose-300 font-bold'
                    : isDarkDisplay
                    ? 'bg-slate-900 text-rose-300 font-bold'
                    : 'bg-white text-rose-700 font-bold'
                }
              >
                เฉพาะงานด่วนมาก (สูง)
              </option>
              <option
                value={TaskPriority.MEDIUM}
                className={
                  isNavyGold
                    ? 'bg-[#0F213C] text-amber-300 font-semibold'
                    : isDarkDisplay
                    ? 'bg-slate-900 text-amber-300 font-semibold'
                    : 'bg-white text-amber-700 font-semibold'
                }
              >
                ความสำคัญปานกลาง
              </option>
              <option
                value={TaskPriority.LOW}
                className={
                  isNavyGold
                    ? 'bg-[#0F213C] text-slate-200 font-semibold'
                    : isDarkDisplay
                    ? 'bg-slate-900 text-slate-200 font-semibold'
                    : 'bg-white text-slate-700 font-semibold'
                }
              >
                ความสำคัญทั่วไป
              </option>
            </select>
          </div>

          {/* Right: Sleek Executive Toggle Switches */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all whitespace-nowrap shrink-0 ${
                !expandMultiDay
                  ? isNavyGold
                    ? 'bg-amber-400/15 border-amber-400/60 text-amber-200'
                    : isDarkDisplay
                    ? 'bg-indigo-500/20 border-indigo-400/60 text-indigo-200'
                    : isEmeraldExec
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-indigo-50/90 border-indigo-200 text-indigo-900'
                  : isNavyGold
                  ? 'bg-[#091526]/70 border-amber-400/25 text-slate-300 hover:border-amber-400/50'
                  : isDarkDisplay
                  ? 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  : 'bg-slate-50/70 border-slate-200/90 text-slate-600 hover:bg-white'
              }`}
            >
              <input
                type="checkbox"
                checked={!expandMultiDay}
                onChange={(e) => setExpandMultiDay(!e.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  !expandMultiDay
                    ? isNavyGold
                      ? 'bg-amber-400'
                      : isEmeraldExec
                      ? 'bg-emerald-600'
                      : 'bg-indigo-600'
                    : isDarkDisplay
                    ? 'bg-slate-700'
                    : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full transition-transform ${
                    !expandMultiDay
                      ? isNavyGold
                        ? 'translate-x-3.5 bg-slate-950'
                        : 'translate-x-3.5 bg-white'
                      : 'translate-x-0.5 bg-white'
                  }`}
                />
              </span>
              <span>สรุปรวมงานต่อเนื่องเป็นรายการเดียว</span>
            </label>

            <label
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all whitespace-nowrap shrink-0 ${
                showCompleted
                  ? isNavyGold
                    ? 'bg-amber-400/15 border-amber-400/60 text-amber-200'
                    : isDarkDisplay
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                  : isNavyGold
                  ? 'bg-[#091526]/70 border-amber-400/25 text-slate-300 hover:border-amber-400/50'
                  : isDarkDisplay
                  ? 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  : 'bg-slate-50/70 border-slate-200/90 text-slate-600 hover:bg-white'
              }`}
            >
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(e) => setShowCompleted(e.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  showCompleted
                    ? 'bg-emerald-600'
                    : isDarkDisplay
                    ? 'bg-slate-700'
                    : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    showCompleted ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span>แสดงงานที่เสร็จแล้ว</span>
            </label>
          </div>
        </div>
          </>
        )}
      </div>
      )}

        {/* Pinned Today's Schedule inside the Unified Solid Top Stack (when grouped_by_day has upcoming days below) */}
        {shouldPinTodayInTopStack &&
          todayGroupInSchedule &&
          renderDaySection(todayGroupInSchedule, { isPinnedInStack: true })}
      </div>

      {/* Empty State (in single_day or today view with no active filters, still show Morning/Afternoon slots & Live Timeline) */}
      {scheduleByDate.length === 0 &&
      (layoutMode === 'single_day' || rangeMode === 'today') &&
      !searchQuery.trim() &&
      selectedCategoryId === 'all' &&
      selectedPriority === 'all' ? (
        <div className={isPresentationMode ? 'flex-1 min-h-0 flex flex-col' : 'space-y-6'}>
          {renderDaySection(
            {
              date: layoutMode === 'single_day' ? focusDate : todayStr,
              items: [],
            },
            { scrollRowsOnly: isClippedScrollActive }
          )}
        </div>
      ) : scheduleByDate.length === 0 ? (
        <div
          className={`rounded-2xl border p-12 text-center space-y-3 ${surfaceCardClasses}`}
        >
          <MonitorPlay className="h-10 w-10 mx-auto text-indigo-500 opacity-80" />
          <div className="text-base font-bold">
            ไม่มีรายการงานในช่วงวันที่หรือตัวกรองที่เลือก
          </div>
          <p className={`text-xs max-w-md mx-auto ${isDarkDisplay ? 'text-slate-300' : 'text-slate-600'}`}>
            คุณสามารถสลับตัวกรองเป็น "ทุกวันทั้งหมด" หรือกดเพิ่มงานใหม่เพื่อแสดงในตารางสรุปงานได้ทันที
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setRangeMode('all');
                setLayoutMode('grouped_by_day');
                setSearchQuery('');
                setSelectedCategoryId('all');
                setSelectedPriority('all');
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              ดูตารางงานทุกวันทั้งหมด
            </button>
            <button
              type="button"
              onClick={() =>
                onAddTaskForDate(layoutMode === 'single_day' ? focusDate : todayStr)
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>เพิ่มงานใหม่</span>
            </button>
          </div>
        </div>
      ) : layoutMode === 'master_table' ? (
        /* Master Continuous Schedule Table (Fixed header above, GPU-smooth body below) */
        <div
          className={`rounded-2xl border overflow-hidden ${
            isPresentationMode ? 'flex-1 min-h-0 flex flex-col ' : ''
          }${surfaceCardClasses}`}
        >
          <div className="overflow-x-auto shrink-0">
            <table className="w-full text-left border-collapse table-fixed min-w-[760px]">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[11%]" />
                <col className="w-[35%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead>
                <tr
                  className={`text-xs font-bold border-b ${
                    isDarkDisplay
                      ? 'bg-white border-slate-200 text-slate-900'
                      : 'bg-slate-100 border-slate-200 text-slate-800'
                  }`}
                >
                  <th className="py-3.5 px-4 whitespace-nowrap">วันที่ปฏิบัติงาน</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">เวลา</th>
                  <th className="py-3.5 px-4">รายการงาน / รายละเอียดและสถานที่</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">หมวดหมู่งาน</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">ความสำคัญ</th>
                  <th className="py-3.5 px-4 whitespace-nowrap text-right">สถานะ</th>
                </tr>
              </thead>
            </table>
          </div>

          <div
            ref={autoScrollViewportRef}
            style={
              isAutoScroll && !isPresentationMode
                ? { maxHeight: `${autoScrollMaxHeight}px` }
                : undefined
            }
            className={`overflow-x-auto ${
              isAutoScroll
                ? isPresentationMode
                  ? 'flex-1 min-h-0 overflow-hidden'
                  : 'overflow-hidden'
                : isPresentationMode
                ? 'flex-1 min-h-0 overflow-y-auto'
                : ''
            }`}
          >
            <div
              ref={autoScrollTrackRef}
              style={
                isAutoScroll
                  ? { willChange: 'transform', backfaceVisibility: 'hidden' }
                  : undefined
              }
            >
              <table className="w-full text-left border-collapse table-fixed min-w-[760px]">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[11%]" />
                  <col className="w-[35%]" />
                  <col className="w-[13%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <tbody
                  className={`divide-y ${
                    isDarkDisplay ? 'divide-slate-800' : 'divide-slate-200'
                  }`}
                >
                {scheduleByDate.flatMap((group) =>
                  group.items.map((entry, idx) => {
                    const {
                      task,
                      displayDate,
                      dayIndexOfSpan,
                      totalSpanDays,
                      timeRangeLabel,
                    } = entry;
                    const cat = categoryMap[task.categoryId];
                    const catColor = cat?.color || '#2563EB';
                    const displayCatColor = getReadableCategoryColor(catColor, isDarkDisplay);
                    const isDone = task.status === TaskStatus.COMPLETED;
                    const isInProgress =
                      !isDone &&
                      (task.status === TaskStatus.IN_PROGRESS ||
                        (displayDate === todayStr && todayTasksSummary.inProgressTask?.id === task.id));
                    const rel = getRelativeDayLabel(displayDate, todayStr);

                    return (
                      <tr
                        key={`${displayDate}-${task.id}-${idx}`}
                        className={`transition-colors ${
                          isDarkDisplay ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50/90'
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onOpenCalendarDate(displayDate)}
                            className={`font-semibold hover:underline text-left ${
                              isLargeText ? 'text-base' : 'text-sm'
                            } ${isDarkDisplay ? 'text-sky-300' : 'text-indigo-950'}`}
                          >
                            {!expandMultiDay && totalSpanDays > 1
                              ? formatTaskDateRangeLabel(task, 'long')
                              : formatThaiDateDisplay(displayDate, 'long')}
                          </button>
                          <div
                            className={`text-xs mt-0.5 ${
                              isDarkDisplay ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {!expandMultiDay && totalSpanDays > 1
                              ? `งานต่อเนื่องรวม ${totalSpanDays} วัน (${rel.text})`
                              : rel.text}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <span
                            className={`font-mono-tabular font-bold ${
                              isLargeText ? 'text-lg' : 'text-sm'
                            } ${
                              isDone
                                ? 'text-slate-400 line-through'
                                : isDarkDisplay
                                ? 'text-emerald-400'
                                : 'text-slate-900'
                            }`}
                          >
                            {timeRangeLabel || task.time} น.
                          </span>
                        </td>

                        <td className="py-3.5 px-4 align-top">
                          <button
                            type="button"
                            onClick={() => onEditTask(task)}
                            className={`font-bold text-left hover:underline ${
                              isLargeText ? 'text-lg' : 'text-sm'
                            } ${
                              isDone
                                ? 'line-through text-slate-400'
                                : isDarkDisplay
                                ? 'text-white'
                                : 'text-slate-900'
                            }`}
                          >
                            {task.title}
                          </button>
                          {totalSpanDays > 1 && (
                            <div
                              className={`text-xs font-semibold mt-0.5 ${
                                isDarkDisplay ? 'text-sky-300' : 'text-indigo-600'
                              }`}
                            >
                              {!expandMultiDay
                                ? `🗓️ กำหนดการต่อเนื่อง ${formatTaskDateRangeLabel(task, 'long')}`
                                : `งานต่อเนื่อง ${formatTaskDateRangeLabel(task, 'short').replace(/\s*\(\d+\s*วัน\)$/, '')} (วันที่ ${dayIndexOfSpan}/${totalSpanDays})`}
                            </div>
                          )}
                          {task.description && (
                            <p
                              className={`mt-1 ${
                                isLargeText ? 'text-sm' : 'text-xs'
                              } ${isDarkDisplay ? 'text-slate-300' : 'text-slate-600'}`}
                            >
                              {task.description}
                            </p>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-bold"
                            style={{ color: displayCatColor }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: displayCatColor }}
                            />
                            <span>{cat?.name || 'ทั่วไป'}</span>
                          </span>
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap text-xs font-semibold">
                          {task.priority === TaskPriority.HIGH ? (
                            <span className={isDarkDisplay ? 'text-rose-400' : 'text-rose-600'}>
                              ด่วนมาก (สูง)
                            </span>
                          ) : task.priority === TaskPriority.MEDIUM ? (
                            <span className={isDarkDisplay ? 'text-amber-300' : 'text-amber-600'}>
                              ปานกลาง
                            </span>
                          ) : (
                            <span className={isDarkDisplay ? 'text-slate-300' : 'text-slate-500'}>
                              ทั่วไป
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => handleCycleTaskStatus(task, isDone, isInProgress)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0 ${
                              isDone
                                ? isDarkDisplay
                                  ? 'text-emerald-400'
                                  : 'text-emerald-600'
                                : isInProgress
                                ? isDarkDisplay
                                  ? 'text-sky-300'
                                  : isEmeraldExec
                                  ? 'text-teal-700'
                                  : 'text-indigo-600'
                                : displayDate === todayStr && task.time <= nowHM
                                ? isDarkDisplay
                                  ? 'text-amber-300'
                                  : 'text-amber-700'
                                : isDarkDisplay
                                ? 'text-amber-300'
                                : 'text-amber-600'
                            }`}
                          >
                            {isDone ? (
                              <>
                                <CheckCircle2 className="h-4 w-4" />
                                <span>เสร็จสิ้นแล้ว</span>
                              </>
                            ) : isInProgress ? (
                              <>
                                <Clock className="h-4 w-4" />
                                <span>กำลังดำเนินการ</span>
                              </>
                            ) : (
                              <>
                                <Circle className="h-4 w-4" />
                                <span>
                                  {displayDate === todayStr && task.time <= nowHM
                                    ? 'ถึงกำหนดเวลา'
                                    : 'รอดำเนินการ'}
                                </span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : layoutMode === 'split_two_column' ? (
        /* 2-Column Executive Split View: Adapts automatically to Landscape TV (2 equal columns) or Portrait Kiosk TV (stacked) */
        <div
          className={`grid ${
            isPortraitTvStage
              ? 'grid-cols-1 overflow-y-auto'
              : isLandscapeTvStage
              ? 'grid-cols-12 items-stretch'
              : 'grid-cols-1 lg:grid-cols-12 items-start'
          } gap-6 ${isPresentationMode ? 'flex-1 min-h-0' : ''}`}
        >
          {/* Left Column: Today's Schedule */}
          <div
            className={`${
              isPortraitTvStage
                ? 'space-y-4'
                : isLandscapeTvStage
                ? 'col-span-6 h-full min-h-0 flex flex-col gap-4'
                : `lg:col-span-6 ${
                    isPresentationMode ? 'h-full min-h-0 flex flex-col gap-4' : 'space-y-4'
                  }`
            }`}
          >
            <div
              className={`shrink-0 px-4 py-2.5 rounded-xl border flex items-center justify-between ${
                isDarkDisplay
                  ? 'bg-slate-900 border-emerald-500/60 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-950'
              }`}
            >
              <span className="font-extrabold text-sm sm:text-base">
                ภารกิจวันนี้ ({formatFullThaiDayHeader(todayStr)})
              </span>
              <span className="text-xs font-bold tabular-nums">
                {scheduleByDate.find((g) => g.date === todayStr)?.items.length || 0} รายการ
              </span>
            </div>

            {scheduleByDate.filter((g) => g.date === todayStr).length > 0 ? (
              <div
                className={
                  isPresentationMode && !isPortraitTvStage
                    ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-2xl space-y-4'
                    : 'space-y-4'
                }
              >
                {scheduleByDate
                  .filter((g) => g.date === todayStr)
                  .map((group) => renderDaySection(group))}
              </div>
            ) : (
              <div
                className={`rounded-2xl border p-8 text-center space-y-3 ${surfaceCardClasses}`}
              >
                <div className="text-sm font-bold">ไม่มีภารกิจที่กำหนดไว้ในวันนี้</div>
                {!isTvCleanSignage && (
                  <button
                    type="button"
                    onClick={() => onAddTaskForDate(todayStr)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>เพิ่มงานวันนี้</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Tomorrow & Upcoming Schedule (Header fixed, list GPU-scrolled below header) */}
          <div
            className={`${
              isPortraitTvStage
                ? 'flex flex-col gap-4'
                : isLandscapeTvStage
                ? 'col-span-6 h-full min-h-0 flex flex-col gap-4'
                : `lg:col-span-6 flex flex-col gap-4 ${
                    isPresentationMode ? 'h-full min-h-0' : ''
                  }`
            }`}
          >
            <div
              className={`shrink-0 px-4 py-2.5 rounded-xl border flex items-center justify-between ${
                isDarkDisplay
                  ? 'bg-slate-900 border-sky-500/60 text-sky-300'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-950'
              }`}
            >
              <span className="font-extrabold text-sm sm:text-base">
                ภารกิจวันพรุ่งนี้และล่วงหน้า
              </span>
              <span className="text-xs font-bold tabular-nums">
                {scheduleByDate
                  .filter((g) => g.date > todayStr)
                  .reduce((acc, g) => acc + g.items.length, 0)}{' '}
                รายการ
              </span>
            </div>

            {scheduleByDate.filter((g) => g.date > todayStr).length > 0 ? (
              <div
                ref={autoScrollViewportRef}
                style={
                  isAutoScroll && !isPresentationMode
                    ? { maxHeight: `${autoScrollMaxHeight}px` }
                    : undefined
                }
                className={
                  isAutoScroll
                    ? isPresentationMode
                      ? 'flex-1 min-h-0 overflow-hidden rounded-2xl'
                      : 'overflow-hidden rounded-2xl'
                    : isPresentationMode
                    ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-2xl'
                    : ''
                }
              >
                <div
                  ref={autoScrollTrackRef}
                  style={
                    isAutoScroll
                      ? { willChange: 'transform', backfaceVisibility: 'hidden' }
                      : undefined
                  }
                  className="space-y-5"
                >
                  {scheduleByDate
                    .filter((g) => g.date > todayStr)
                    .map((group) =>
                      renderDaySection(group, {
                        stickyHeaderInsideScroll: isPresentationMode && !isAutoScroll,
                      })
                    )}
                </div>
              </div>
            ) : (
              <div
                className={`rounded-2xl border p-8 text-center space-y-3 ${surfaceCardClasses}`}
              >
                <div className="text-sm font-bold">ยังไม่มีภารกิจล่วงหน้าในรายการ</div>
                {!isTvCleanSignage && (
                  <button
                    type="button"
                    onClick={() => onAddTaskForDate(addDaysYMD(todayStr, 1))}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>เพิ่มงานวันพรุ่งนี้</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : layoutMode === 'single_day' || nonTodayGroupsInSchedule.length === 0 ? (
        /* Single-Day View or Today-Only View: Day Header stays fixed, only task rows below scroll */
        <div
          className={
            isPresentationMode ? 'flex-1 min-h-0 flex flex-col gap-6' : 'space-y-6'
          }
        >
          {scheduleByDate.map((group, idx) =>
            renderDaySection(group, {
              scrollRowsOnly: isClippedScrollActive && idx === 0,
            })
          )}
        </div>
      ) : (
        /* Grouped-by-Day View: Today is pinned in topStackRef above; upcoming/other days glide smoothly on GPU inside clipped viewport below */
        <div
          ref={autoScrollViewportRef}
          style={
            isAutoScroll && !isPresentationMode
              ? { maxHeight: `${autoScrollMaxHeight}px` }
              : undefined
          }
          className={
            isAutoScroll
              ? isPresentationMode
                ? 'flex-1 min-h-0 overflow-hidden rounded-2xl'
                : 'overflow-hidden rounded-2xl'
              : isPresentationMode
              ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-2xl'
              : ''
          }
        >
          <div
            ref={autoScrollTrackRef}
            style={
              isAutoScroll
                ? { willChange: 'transform', backfaceVisibility: 'hidden' }
                : undefined
            }
            className="space-y-6"
          >
            {nonTodayGroupsInSchedule.map((group) =>
              renderDaySection(group, {
                stickyHeaderInsideScroll: isPresentationMode && !isAutoScroll,
              })
            )}
          </div>
        </div>
      )}
      </div>

      {/* Live TV Remote Sync & Channel Setup Modal */}
      {isTvRemoteModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setIsTvRemoteModalOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                  <Tv className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-slate-900 truncate">
                    เชื่อมต่อและควบคุมจอ TV แบบเรียลไทม์
                  </h3>
                  <p className="text-xs text-slate-600">
                    ซิงก์ตารางงาน สถานะผู้บริหาร และมุมมองจากเครื่องแอดมินขึ้นจอทีวีอัตโนมัติ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTvRemoteModalOpen(false)}
                className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
                title="ปิดหน้าต่าง"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              {/* Active TV Status & Direct Remote Actions */}
              <div
                className={`rounded-xl border p-4 space-y-3 ${
                  activeTvScreenList.length > 0
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        activeTvScreenList.length > 0 ? 'bg-emerald-600' : 'bg-amber-500'
                      }`}
                    />
                    <span className="text-sm font-bold text-slate-900">
                      {activeTvScreenList.length > 0
                        ? `พบหน้าจอ TV เปิดรับสัญญาณเรียลไทม์อยู่ (${activeTvScreenList.length} จอ)`
                        : 'รอการเปิดลิงก์สำหรับจอ TV บนเครื่องที่ต่อเข้าทีวี'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePingTvScreens}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>
                      {tvRemoteActionFeedback === 'pinging'
                        ? 'กำลังตรวจสอบ...'
                        : 'เช็กสัญญาณจอ TV'}
                    </span>
                  </button>
                </div>

                {activeTvScreenList.length > 0 && (
                  <div className="space-y-1.5">
                    {activeTvScreenList.map((scr) => (
                      <div
                        key={scr.tvClientId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-emerald-200/90 text-xs"
                      >
                        <div className="flex items-center gap-2 font-semibold text-slate-800">
                          <MonitorPlay className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>{scr.label}</span>
                        </div>
                        <span className="font-sans tabular-nums text-slate-600 font-medium">
                          ความละเอียด {scr.viewportW}×{scr.viewportH} · สัดส่วน{' '}
                          {Math.round(scr.scale * 100)}% ·{' '}
                          {scr.transport === 'local_hdmi'
                            ? 'สาย HDMI ในเครื่อง (0 วินาที)'
                            : 'คลาวด์ HTTPS (Port 443)'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleForcePushToTv}
                    className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold transition-colors"
                  >
                    {tvRemoteActionFeedback === 'pushed' ? (
                      <>
                        <Check className="h-4 w-4" />
                        <span>ส่งข้อมูลและมุมมองขึ้นจอ TV แล้ว</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>ส่งข้อมูลและมุมมองขึ้นจอ TV เดี๋ยวนี้</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleRemoteReloadTv}
                    className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs sm:text-sm font-bold transition-colors"
                  >
                    {tvRemoteActionFeedback === 'reloaded' ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-600" />
                        <span className="text-emerald-700">ส่งคำสั่งรีเฟรชจอ TV แล้ว</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        <span>สั่งรีเฟรชเบราว์เซอร์จอ TV ระยะไกล</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Channel 1: Separate PC / Notebook+HDMI over Internet / Office Wi-Fi */}
              <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                    ช่องทางที่ 1 · คอมแอดมิน + โน้ตบุ๊กอีกเครื่องต่อสาย HDMI เข้าทีวี (ผ่านเน็ต/Wi-Fi)
                  </span>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md">
                    ไม่ต้องล็อกอินบนโน้ตบุ๊ก
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  เสียบสาย HDMI จากโน้ตบุ๊กเข้าทีวี (แนะนำกด <strong>Windows + P → เฉพาะหน้าจอที่สอง / Second screen only</strong> หรือ <strong>Extend</strong> เพื่อให้ภาพออกเต็มความละเอียดทีวีและไม่ติดขอบดำ) จากนั้นเปิดลิงก์ด้านล่างบนเบราว์เซอร์ของโน้ตบุ๊กและกด <strong>F11</strong> ระบบจะกันพักหน้าจออัตโนมัติและซิงก์กับคอมแอดมินผ่าน <strong>HTTPS (Port 443)</strong> ภายใน ~0.5–1.5 วินาที
                </p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
                  <input
                    type="text"
                    readOnly
                    value={tvDirectShareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyTvLink}
                    className={`inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                      copiedTvLink
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {copiedTvLink ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>คัดลอกลิงก์แล้ว</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>คัดลอกลิงก์สำหรับจอ TV</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Channel 2: Dual-Monitor HDMI / Wireless Display from Admin PC */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                    ช่องทางที่ 2 · ต่อสาย HDMI / Wireless Display แยก 2 จอจากเครื่องแอดมิน
                  </span>
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                    เร็ว 0.00 วินาที · ไม่พึ่งเน็ต
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  หากเครื่องแอดมินต่อสาย HDMI หรือส่งภาพไร้สายเข้าทีวีแบบขยายหน้าจอ (<strong>Windows + P → Extend</strong>) ให้กด <strong>Ctrl + N</strong> เปิดหน้าต่างเบราว์เซอร์ใหม่ วางลิงก์สำหรับจอ TV แล้วลากหน้าต่างไปวางบนจอทีวีแล้วกด <strong>F11</strong> ทุกการกดเปลี่ยนสถานะหรือแก้ไขจะซิงก์ตรงในเครื่องทันทีแบบ 0 วินาที
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

