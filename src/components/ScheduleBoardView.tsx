import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Palette,
  Pause,
  Play,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { Category, Task, TaskPriority, TaskStatus } from '../types';
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

interface ScheduleBoardViewProps {
  tasks: Task[];
  categories: Category[];
  onAddTaskForDate: (dateStr: string) => void;
  onEditTask: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onOpenCalendarDate: (dateStr: string) => void;
}

type BoardRangeMode = 'upcoming' | 'today' | 'week7' | 'all';
type BoardLayoutMode = 'grouped_by_day' | 'split_two_column' | 'single_day' | 'master_table';
type BoardThemeMode = 'light' | 'dark' | 'navy_gold' | 'emerald_exec';

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
    /(?:ณ\s+|สถานที่\s*:?\s*|ห้องประชุม\s*|ชั้น\s*\d+\s*อาคาร\s*)([^|\n•,]{3,65})/i
  );
  if (match && match[0]) {
    return match[0].trim();
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

const LiveBangkokClockDisplay: React.FC<{
  isLargeText: boolean;
  isNavyGold: boolean;
  isDarkDisplay: boolean;
  isEmeraldExec: boolean;
}> = React.memo(({ isLargeText, isNavyGold, isDarkDisplay, isEmeraldExec }) => {
  const [clockTick, setClockTick] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const formattedSec = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(clockTick);
    } catch {
      return formatLocalTimeHM(clockTick);
    }
  }, [clockTick]);

  return (
    <span
      className={`font-sans tabular-nums font-extrabold tracking-widest leading-none ${
        isLargeText
          ? 'text-4xl sm:text-5xl md:text-[50px]'
          : 'text-3xl sm:text-4xl md:text-[42px]'
      } ${
        isNavyGold
          ? 'text-white'
          : isDarkDisplay
          ? 'text-white'
          : isEmeraldExec
          ? 'text-emerald-950'
          : 'text-indigo-950'
      }`}
    >
      {formattedSec}
    </span>
  );
});

export const ScheduleBoardView: React.FC<ScheduleBoardViewProps> = ({
  tasks,
  categories,
  onAddTaskForDate,
  onEditTask,
  onToggleStatus,
  onOpenCalendarDate,
}) => {
  // Update minute-level state only when HH:mm changes so 1s clock ticks never re-render the schedule list
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  const todayStr = useMemo(() => formatLocalDateYMD(nowDate), [nowDate]);
  const nowHM = useMemo(() => formatLocalTimeHM(nowDate), [nowDate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = new Date();
      setNowDate((prev) =>
        formatLocalTimeHM(prev) !== formatLocalTimeHM(next) ||
        formatLocalDateYMD(prev) !== formatLocalDateYMD(next)
          ? next
          : prev
      );
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const [rangeMode, setRangeMode] = useState<BoardRangeMode>('upcoming');
  const [layoutMode, setLayoutMode] = useState<BoardLayoutMode>('grouped_by_day');
  const [focusDate, setFocusDate] = useState<string>(() => formatLocalDateYMD());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [expandMultiDay, setExpandMultiDay] = useState<boolean>(false);
  const [boardTheme, setBoardTheme] = useState<BoardThemeMode>('light');
  const [isLargeText, setIsLargeText] = useState<boolean>(false);
  const [isPresentationMode, setIsPresentationMode] = useState<boolean>(false);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(false);

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

  const handleTogglePresentationFullscreen = async () => {
    const nextState = !isPresentationMode;
    setIsPresentationMode(nextState);
    if (nextState) {
      setIsLargeText(true);
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {
        // Ignore iframe fullscreen restrictions; in-page presentation mode still expands
      }
    } else {
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
          filteredBase[existingIdx] = {
            task: {
              ...prevTask,
              endDate: mergedEnd > prevTask.date ? mergedEnd : prevTask.endDate,
              description:
                prevTask.description || item.description
                  ? prevTask.description || item.description
                  : '',
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
  }, [isAutoScroll, isPresentationMode, layoutMode, rangeMode, scheduleByDate.length]);

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

    const inProgressTask = activeToday.find((t) => {
      if (t.status === TaskStatus.COMPLETED) return false;
      if (t.status === TaskStatus.IN_PROGRESS) return true;
      if (nowTotalMins === null) return false;
      const tMins = parseHM(t.time);
      if (tMins === null) return false;
      return tMins <= nowTotalMins && nowTotalMins - tMins <= 55;
    });

    const nextUpcoming = activeToday.find(
      (t) => t.status !== TaskStatus.COMPLETED && t.time >= nowHM
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
      nextUpcoming,
      nextCountdownLabel,
      highPriorityCount,
      allSchedulesCount,
    };
  }, [tasks, todayStr, nowHM]);

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

    return (
      <section
        key={group.date}
        className={`rounded-2xl border ${
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
        {/* Day Header Bar (100% Solid Opaque so task rows never show through or above) */}
        <div
          className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${
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
          <div className="flex flex-wrap items-center gap-3">
            <CalendarIcon
              className={`h-6 w-6 shrink-0 ${
                isTodayGroup
                  ? isEmeraldExec
                    ? 'text-emerald-700'
                    : 'text-indigo-600'
                  : 'text-slate-600'
              }`}
            />
            <h2
              className={`font-extrabold text-slate-900 ${
                isLargeText ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
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
              className={`${
                isLargeText ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
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
            className={`flex flex-wrap items-center gap-4 ${
              isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
            }`}
          >
            <div className="font-sans tabular-nums font-bold text-slate-700">
              รวม {group.items.length} งาน (รอทำ {pendingInDay} · เสร็จแล้ว {doneInDay})
            </div>
            <button
              type="button"
              onClick={() => onAddTaskForDate(group.date)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white font-bold transition-colors whitespace-nowrap shrink-0 ${
                isEmeraldExec
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>เพิ่มงานวันนี้</span>
            </button>
          </div>
        </div>

        {/* Day Schedule Rows */}
        <div
          ref={scrollRowsOnly ? autoScrollViewportRef : undefined}
          style={
            scrollRowsOnly && !isPresentationMode
              ? { maxHeight: `${autoScrollMaxHeight}px` }
              : scrollRowsOnly && isPresentationMode
              ? { maxHeight: 'calc(100vh - 340px)' }
              : undefined
          }
          className={`${
            stickyHeaderInsideScroll ? 'rounded-b-2xl overflow-hidden ' : ''
          }${
            scrollRowsOnly
              ? isAutoScroll
                ? 'overflow-hidden'
                : 'overflow-y-auto overflow-x-hidden'
              : isPinnedInStack
              ? 'max-h-[34vh] overflow-y-auto overflow-x-hidden'
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
          {group.items.map((entry, idx) => {
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
            const isHigh = task.priority === TaskPriority.HIGH;
            const isCurrentDayPassed =
              displayDate === todayStr && task.time <= nowHM && !isDone;
            const isNextUpcomingRow =
              displayDate === todayStr &&
              !isDone &&
              todayTasksSummary.nextUpcoming?.id === task.id;
            const detectedVenue = extractLocationFromText(task.title, task.description);

            return (
              <div
                key={`${displayDate}-${task.id}-${idx}`}
                className={`px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
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
                  <div className="w-36 sm:w-44 shrink-0">
                    <div
                      className={`inline-flex items-center gap-2 font-sans tabular-nums font-bold ${
                        isLargeText ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
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

                    {task.description && (
                      <p
                        className={`leading-relaxed break-words ${
                          isLargeText ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
                        } ${isDarkDisplay ? 'text-slate-200' : 'text-slate-600'}`}
                      >
                        {task.description}
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
                    onClick={() => onToggleStatus(task)}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${
                      isLargeText ? 'text-base' : 'text-sm'
                    } font-bold transition-colors whitespace-nowrap shrink-0 ${
                      isDone
                        ? isDarkDisplay
                          ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
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
          })}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`transition-colors ${
        isPresentationMode
          ? isNavyGold
            ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0A1628] text-slate-100 p-6 sm:p-8 gap-3.5'
            : isDarkDisplay
            ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-950 text-slate-100 p-6 sm:p-8 gap-3.5'
            : isEmeraldExec
            ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#F0FDF4] text-slate-900 p-6 sm:p-8 gap-3.5'
            : 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-50 text-slate-900 p-6 sm:p-8 gap-3.5'
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
            ? 'shrink-0 space-y-3.5'
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

        <div className="p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start sm:items-center gap-4 sm:gap-5 min-w-0">
              <div
                className={`h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 rounded-full bg-white overflow-hidden border-2 flex items-center justify-center shrink-0 transition-shadow ${
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
                    isLargeText
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
                    isLargeText ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
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
            <div className="flex items-center shrink-0">
              <div
                className={`w-full sm:w-auto min-w-[275px] sm:min-w-[340px] rounded-2xl border px-5 py-3.5 sm:px-7 sm:py-4 text-right transition-colors ${
                  isNavyGold
                    ? 'bg-[#091526]/90 border-amber-400/45 text-white shadow-inner'
                    : isDarkDisplay
                    ? 'bg-slate-950/90 border-slate-700/80 text-white shadow-inner'
                    : isEmeraldExec
                    ? 'bg-white/95 border-emerald-200/90 text-slate-900 shadow-xs'
                    : 'bg-white/95 border-indigo-200/80 text-slate-900 shadow-xs'
                }`}
              >
                <div
                  className={`flex items-center justify-end gap-1.5 font-bold tracking-tight pb-2 border-b ${
                    isLargeText
                      ? 'text-base sm:text-lg md:text-xl'
                      : 'text-sm sm:text-base md:text-lg'
                  } ${
                    isNavyGold
                      ? 'text-amber-300 border-amber-400/20'
                      : isDarkDisplay
                      ? 'text-sky-300 border-slate-800'
                      : isEmeraldExec
                      ? 'text-emerald-800 border-emerald-100'
                      : 'text-indigo-800 border-indigo-100/90'
                  }`}
                >
                  <Clock className="h-4 w-4 shrink-0 opacity-85" />
                  <span>{formatFullThaiDayHeader(todayStr)}</span>
                </div>
                <div className="mt-2.5 flex items-baseline justify-end gap-2">
                  <LiveBangkokClockDisplay
                    isLargeText={isLargeText}
                    isNavyGold={isNavyGold}
                    isDarkDisplay={isDarkDisplay}
                    isEmeraldExec={isEmeraldExec}
                  />
                  <span
                    className={`font-bold ${
                      isLargeText ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
                    } ${
                      isNavyGold
                        ? 'text-amber-300'
                        : isDarkDisplay
                        ? 'text-sky-300'
                        : isEmeraldExec
                        ? 'text-emerald-700'
                        : 'text-indigo-700'
                    }`}
                  >
                    น.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Today's Highlight Strip + Compact Presentation Action Buttons */}
          <div
            className={`mt-5 pt-3.5 border-t flex flex-col xl:flex-row xl:items-center justify-between gap-3.5 text-xs ${
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
                isLargeText ? 'text-base sm:text-lg' : 'text-xs sm:text-sm'
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

            <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                onClick={() => window.print()}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                  isNavyGold
                    ? 'bg-[#091526]/80 text-slate-100 border-amber-400/30 hover:border-amber-400/60'
                    : isDarkDisplay
                    ? 'bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700'
                    : 'bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <Printer className="h-3.5 w-3.5" />
                <span>พิมพ์ตารางงาน</span>
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
          </div>
        </div>
      </div>

      {/* Filter & View Mode Toolbar (100% Solid Opaque) */}
      <div
        ref={toolbarRef}
        className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 shadow-xs transition-colors ${
          isNavyGold
            ? 'bg-[#0F213C] border-amber-400/40 text-white'
            : isDarkDisplay
            ? 'bg-slate-900 border-slate-800 text-white'
            : isEmeraldExec
            ? 'bg-white border-emerald-200/90 text-slate-900'
            : 'bg-white border-slate-200/90 text-slate-900'
        }`}
      >
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
      </div>

        {/* Pinned Today's Schedule inside the Unified Solid Top Stack (when grouped_by_day has upcoming days below) */}
        {shouldPinTodayInTopStack &&
          todayGroupInSchedule &&
          renderDaySection(todayGroupInSchedule, { isPinnedInStack: true })}
      </div>

      {/* Empty State */}
      {scheduleByDate.length === 0 ? (
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
                            onClick={() => onToggleStatus(task)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                              isDone
                                ? isDarkDisplay
                                  ? 'text-emerald-400'
                                  : 'text-emerald-600'
                                : displayDate === todayStr && task.time <= nowHM
                                ? isDarkDisplay
                                  ? 'text-rose-400'
                                  : 'text-rose-600'
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
                            ) : (
                              <>
                                <Circle className="h-4 w-4" />
                                <span>
                                  {displayDate === todayStr && task.time <= nowHM
                                    ? 'ถึงเวลา / กำลังดำเนินการ'
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
        /* 2-Column Executive Split View: Left = Today's Missions (Pinned), Right = Upcoming Missions (Clipped GPU-Smooth Scrollable) */
        <div
          className={`grid grid-cols-1 lg:grid-cols-12 gap-6 items-start ${
            isPresentationMode ? 'flex-1 min-h-0' : ''
          }`}
        >
          {/* Left Column: Today's Schedule (Stationary / Pinned) */}
          <div className="lg:col-span-6 space-y-4">
            <div
              className={`px-4 py-2.5 rounded-xl border flex items-center justify-between ${
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
              scheduleByDate
                .filter((g) => g.date === todayStr)
                .map((group) => renderDaySection(group))
            ) : (
              <div
                className={`rounded-2xl border p-8 text-center space-y-3 ${surfaceCardClasses}`}
              >
                <div className="text-sm font-bold">ไม่มีภารกิจที่กำหนดไว้ในวันนี้</div>
                <button
                  type="button"
                  onClick={() => onAddTaskForDate(todayStr)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>เพิ่มงานวันนี้</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Tomorrow & Upcoming Schedule (Header fixed, list GPU-scrolled below header) */}
          <div
            className={`lg:col-span-6 flex flex-col gap-4 ${
              isPresentationMode ? 'h-full min-h-0' : ''
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
                <button
                  type="button"
                  onClick={() => onAddTaskForDate(addDaysYMD(todayStr, 1))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>เพิ่มงานวันพรุ่งนี้</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : layoutMode === 'single_day' || nonTodayGroupsInSchedule.length === 0 ? (
        /* Single-Day View or Today-Only View: Day Header stays fixed, only task rows below scroll */
        <div className="space-y-6">
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
  );
};

