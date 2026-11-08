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
  Plus,
  Printer,
  Search,
  Sparkles,
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

interface ScheduleBoardViewProps {
  tasks: Task[];
  categories: Category[];
  onAddTaskForDate: (dateStr: string) => void;
  onEditTask: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onOpenCalendarDate: (dateStr: string) => void;
}

type BoardRangeMode = 'upcoming' | 'today' | 'week7' | 'all';
type BoardLayoutMode = 'grouped_by_day' | 'single_day' | 'master_table';

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

export const ScheduleBoardView: React.FC<ScheduleBoardViewProps> = ({
  tasks,
  categories,
  onAddTaskForDate,
  onEditTask,
  onToggleStatus,
  onOpenCalendarDate,
}) => {
  const [nowDate, setNowDate] = useState<Date>(() => new Date());
  const todayStr = useMemo(() => formatLocalDateYMD(nowDate), [nowDate]);
  const nowHM = useMemo(() => formatLocalTimeHM(nowDate), [nowDate]);
  const nowSec = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(nowDate);
    } catch {
      return nowHM;
    }
  }, [nowDate, nowHM]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [rangeMode, setRangeMode] = useState<BoardRangeMode>('upcoming');
  const [layoutMode, setLayoutMode] = useState<BoardLayoutMode>('grouped_by_day');
  const [focusDate, setFocusDate] = useState<string>(() => formatLocalDateYMD());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);
  const [expandMultiDay, setExpandMultiDay] = useState<boolean>(false);
  const [isDarkDisplay, setIsDarkDisplay] = useState<boolean>(false);
  const [isLargeText, setIsLargeText] = useState<boolean>(false);
  const [isPresentationMode, setIsPresentationMode] = useState<boolean>(false);

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
  const scheduleByDate = useMemo(() => {
    const normalizedTasks = tasks.map((t) => {
      const inferred = inferTaskEndDate(t);
      return inferred && (!t.endDate || inferred > t.endDate)
        ? { ...t, endDate: inferred }
        : t;
    });
    const filtered = normalizedTasks.filter((t) => {
      if (!showCompleted && t.status === TaskStatus.COMPLETED) return false;
      if (selectedCategoryId !== 'all' && t.categoryId !== selectedCategoryId) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const catName = (categoryMap[t.categoryId]?.name || '').toLowerCase();
        const thaiDate = formatTaskDateRangeLabel(t, 'long').toLowerCase();
        const match =
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          catName.includes(q) ||
          thaiDate.includes(q) ||
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
    searchQuery,
    categoryMap,
    expandMultiDay,
    layoutMode,
    focusDate,
    rangeMode,
    todayStr,
    endOf7DaysStr,
  ]);

  const totalDisplayedTasksCount = useMemo(() => {
    const uniqueIds = new Set<string>();
    scheduleByDate.forEach((group) => {
      group.items.forEach((entry) => uniqueIds.add(entry.task.id));
    });
    return uniqueIds.size;
  }, [scheduleByDate]);

  const todayTasksSummary = useMemo(() => {
    const activeToday = tasks
      .filter((t) => isTaskActiveOnDate(t, todayStr))
      .sort((a, b) => a.time.localeCompare(b.time));
    const pending = activeToday.filter((t) => t.status !== TaskStatus.COMPLETED).length;
    const completed = activeToday.length - pending;
    const nextUpcoming = activeToday.find(
      (t) => t.status !== TaskStatus.COMPLETED && t.time >= nowHM
    );
    return {
      total: activeToday.length,
      pending,
      completed,
      nextUpcoming,
    };
  }, [tasks, todayStr, nowHM]);

  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [bannerHeight, setBannerHeight] = useState<number>(196);
  const [headerHeight, setHeaderHeight] = useState<number>(61);

  useEffect(() => {
    const updateMeasurements = () => {
      if (bannerRef.current) {
        setBannerHeight(bannerRef.current.offsetHeight);
      }
      const appHeader = document.querySelector('header');
      if (appHeader instanceof HTMLElement) {
        setHeaderHeight(appHeader.offsetHeight);
      }
    };

    updateMeasurements();

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateMeasurements();
          })
        : null;

    if (observer && bannerRef.current) {
      observer.observe(bannerRef.current);
    }
    const appHeader = document.querySelector('header');
    if (observer && appHeader instanceof HTMLElement) {
      observer.observe(appHeader);
    }

    window.addEventListener('resize', updateMeasurements);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [isLargeText, isDarkDisplay, isPresentationMode, todayTasksSummary]);

  const stickyTopBanner = isPresentationMode ? 12 : headerHeight + 8;
  const stickyGap = 16;
  const stickyTopToolbar = stickyTopBanner + bannerHeight + stickyGap;
  const stickyMaskColor = isDarkDisplay ? '#020617' : '#F8FAFC';

  return (
    <div
      className={`space-y-4 transition-colors ${
        isPresentationMode
          ? isDarkDisplay
            ? 'fixed inset-0 z-50 overflow-y-auto bg-slate-950 text-slate-100 p-6 sm:p-10'
            : 'fixed inset-0 z-50 overflow-y-auto bg-slate-50 text-slate-900 p-6 sm:p-10'
          : isDarkDisplay
          ? 'bg-slate-950 text-slate-100 rounded-2xl p-6 border border-slate-800 shadow-lg'
          : ''
      }`}
    >
      {/* Top Executive Presentation Banner & Live Clock */}
      <div
        ref={bannerRef}
        style={{
          top: `${stickyTopBanner}px`,
          boxShadow: `0 -20px 0 12px ${stickyMaskColor}, 0 12px 0 12px ${stickyMaskColor}`,
        }}
        className={`sticky z-20 rounded-2xl border p-6 transition-colors ${
          isDarkDisplay
            ? 'bg-slate-900 border-slate-800 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <h1
              className={`font-extrabold tracking-tight leading-tight ${
                isLargeText
                  ? 'text-4xl sm:text-5xl md:text-[52px]'
                  : 'text-3xl sm:text-4xl md:text-[42px]'
              } ${isDarkDisplay ? 'text-white' : 'text-slate-900'}`}
            >
              กำหนดการภารกิจของผู้อำนวยการสำนักบริหารแรงงานต่างด้าว
            </h1>
          </div>

          {/* Right Live Thailand Digital Clock */}
          <div className="flex items-center shrink-0">
            <div
              className={`min-w-[280px] sm:min-w-[350px] rounded-2xl border-2 px-6 py-3.5 sm:px-8 sm:py-4 text-right transition-colors ${
                isDarkDisplay
                  ? 'bg-white border-slate-200 text-slate-900 shadow-md'
                  : 'bg-gradient-to-br from-indigo-50/95 via-white to-emerald-50/80 border-indigo-200 text-slate-900 shadow-sm'
              }`}
            >
              <div
                className={`font-bold tracking-tight pb-1.5 border-b border-indigo-100/90 ${
                  isLargeText
                    ? 'text-lg sm:text-xl md:text-2xl'
                    : 'text-base sm:text-lg md:text-xl'
                } text-indigo-800`}
              >
                {formatFullThaiDayHeader(todayStr)}
              </div>
              <div className="mt-2 flex items-baseline justify-end gap-2">
                <span
                  className={`font-sans tabular-nums font-extrabold tracking-widest text-indigo-950 leading-none ${
                    isLargeText
                      ? 'text-4xl sm:text-5xl md:text-[52px]'
                      : 'text-3xl sm:text-4xl md:text-[42px]'
                  }`}
                >
                  {nowSec}
                </span>
                <span
                  className={`font-bold text-indigo-700 ${
                    isLargeText
                      ? 'text-xl sm:text-2xl'
                      : 'text-lg sm:text-xl'
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
          className={`mt-5 pt-3.5 border-t flex flex-wrap items-center justify-between gap-3 text-xs ${
            isDarkDisplay ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-600'
          }`}
        >
          <div
            className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 ${
              isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`font-bold ${
                  isDarkDisplay ? 'text-white' : 'text-slate-900'
                }`}
              >
                สรุปงานวันนี้ ({formatThaiDateDisplay(todayStr, 'long')}):
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border font-sans tabular-nums font-bold ${
                  isDarkDisplay
                    ? 'bg-indigo-950/90 border-indigo-500/60 text-indigo-300'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                }`}
              >
                ทั้งหมด {todayTasksSummary.total} งาน
              </span>
              <span aria-hidden="true" className="text-slate-400 font-bold">
                ·
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border font-sans tabular-nums font-bold ${
                  isDarkDisplay
                    ? 'bg-amber-950/90 border-amber-500/60 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                รอดำเนินการ {todayTasksSummary.pending} งาน
              </span>
              <span aria-hidden="true" className="text-slate-400 font-bold">
                ·
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border font-sans tabular-nums font-bold ${
                  isDarkDisplay
                    ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}
              >
                เสร็จสิ้นแล้ว {todayTasksSummary.completed} งาน
              </span>
            </div>

            {todayTasksSummary.nextUpcoming && (
              <div className="flex items-center gap-1.5 font-medium">
                <span aria-hidden="true" className="text-slate-300">
                  |
                </span>
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                <span>
                  ภารกิจถัดไป:{' '}
                  <strong className={isDarkDisplay ? 'text-white' : 'text-slate-900'}>
                    {todayTasksSummary.nextUpcoming.time} น. —{' '}
                    {todayTasksSummary.nextUpcoming.title}
                  </strong>
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsLargeText((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isLargeText
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : isDarkDisplay
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {isLargeText ? 'ตัวอักษรใหญ่ (TV)' : 'ขยายตัวอักษรใหญ่'}
            </button>

            <button
              type="button"
              onClick={() => setIsDarkDisplay((prev) => !prev)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isDarkDisplay
                  ? 'bg-amber-400 text-slate-950 border-amber-400'
                  : 'bg-slate-800 text-white border-slate-800 hover:bg-slate-700'
              }`}
            >
              {isDarkDisplay ? 'โหมดสว่าง' : 'โหมดจอมืด (Dark TV)'}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isDarkDisplay
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Printer className="h-3 w-3" />
              <span>พิมพ์ตารางงาน</span>
            </button>

            <button
              type="button"
              onClick={handleTogglePresentationFullscreen}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#06C755] hover:bg-[#05b04b] text-white text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 shadow-2xs"
            >
              {isPresentationMode ? (
                <>
                  <Minimize2 className="h-3 w-3" />
                  <span>ออกจากโหมดเต็มจอ</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3 w-3" />
                  <span>เปิดโหมดเต็มจอ (นำเสนอ)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Filter & View Mode Toolbar */}
      <div
        style={{
          top: `${stickyTopToolbar}px`,
          boxShadow: `0 -16px 0 12px ${stickyMaskColor}, 0 4px 0 6px ${stickyMaskColor}, 0 12px 20px -6px rgba(15, 23, 42, 0.14)`,
        }}
        className={`sticky z-20 rounded-2xl border p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 ${
          isDarkDisplay
            ? 'bg-slate-900 border-slate-800 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Left: Layout & Date Range Selector */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout Mode Tabs */}
          <div
            className={`inline-flex items-center gap-1 p-1 rounded-xl ${
              isDarkDisplay ? 'bg-slate-950' : 'bg-slate-100'
            }`}
          >
            <button
              type="button"
              onClick={() => setLayoutMode('grouped_by_day')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                layoutMode === 'grouped_by_day'
                  ? 'bg-indigo-600 text-white'
                  : isDarkDisplay
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              แยกตารางตามวัน
            </button>
            <button
              type="button"
              onClick={() => {
                setLayoutMode('single_day');
                if (!focusDate) setFocusDate(todayStr);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                layoutMode === 'single_day'
                  ? 'bg-indigo-600 text-white'
                  : isDarkDisplay
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              เจาะจงรายวัน (1 วัน)
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('master_table')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                layoutMode === 'master_table'
                  ? 'bg-indigo-600 text-white'
                  : isDarkDisplay
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ตารางรวมเรียงลำดับเวลา
            </button>
          </div>

          {/* Range Selector when not in single_day mode */}
          {layoutMode !== 'single_day' ? (
            <div
              className={`inline-flex items-center gap-1 p-1 rounded-xl ${
                isDarkDisplay ? 'bg-slate-950' : 'bg-slate-100'
              }`}
            >
              {(
                [
                  { id: 'upcoming', label: 'วันนี้และงานล่วงหน้า' },
                  { id: 'today', label: 'เฉพาะวันนี้' },
                  { id: 'week7', label: '7 วันข้างหน้า' },
                  { id: 'all', label: 'ทุกวันทั้งหมด' },
                ] as { id: BoardRangeMode; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRangeMode(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    rangeMode === item.id
                      ? isDarkDisplay
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : isDarkDisplay
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFocusDate((prev) => addDaysYMD(prev, -1))}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isDarkDisplay
                    ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                }`}
                title="วันก่อนหน้า"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={focusDate}
                onChange={(e) => setFocusDate(e.target.value || todayStr)}
                className="rounded-lg border border-slate-300 !bg-white !text-slate-900 px-3 py-1.5 text-xs font-bold font-sans tabular-nums"
              />
              <button
                type="button"
                onClick={() => setFocusDate((prev) => addDaysYMD(prev, 1))}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isDarkDisplay
                    ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                    : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                }`}
                title="วันถัดไป"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFocusDate(todayStr)}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
              >
                กลับมาวันนี้
              </button>
            </div>
          )}
        </div>

        {/* Right: Search, Category Filter & Toggles */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่องาน, เวลา, วันที่..."
              className="w-full rounded-xl border border-slate-300 !bg-white !text-slate-900 placeholder:text-slate-500 pl-8 pr-3 py-1.5 text-xs font-medium focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="rounded-xl border border-slate-300 !bg-white !text-slate-900 px-3.5 py-1.5 text-xs sm:text-sm font-bold focus:border-indigo-600 focus:outline-none cursor-pointer"
          >
            <option value="all" className="bg-white text-slate-900 font-bold">
              ทุกหมวดหมู่งาน
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id} className="bg-white text-slate-900 font-semibold">
                {cat.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-xl">
            <input
              type="checkbox"
              checked={!expandMultiDay}
              onChange={(e) => setExpandMultiDay(!e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>สรุปรวมงานต่อเนื่องเป็นรายการเดียว</span>
          </label>

          <label
            className={`inline-flex items-center gap-1.5 text-xs cursor-pointer select-none font-semibold px-2.5 py-1.5 rounded-xl border ${
              isDarkDisplay
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>แสดงงานที่เสร็จแล้ว</span>
          </label>
        </div>
      </div>

      {/* Empty State */}
      {scheduleByDate.length === 0 ? (
        <div
          className={`rounded-2xl border p-12 text-center space-y-3 ${
            isDarkDisplay
              ? 'bg-slate-900 border-slate-800 text-slate-300'
              : 'bg-white border-slate-200 text-slate-600'
          }`}
        >
          <MonitorPlay className="h-10 w-10 mx-auto text-indigo-500 opacity-80" />
          <div className="text-base font-bold">
            ไม่มีรายการงานในช่วงวันที่หรือตัวกรองที่เลือก
          </div>
          <p className="text-xs max-w-md mx-auto">
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
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
            >
              ดูตารางงานทุกวันทั้งหมด
            </button>
            <button
              type="button"
              onClick={() =>
                onAddTaskForDate(layoutMode === 'single_day' ? focusDate : todayStr)
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>เพิ่มงานใหม่</span>
            </button>
          </div>
        </div>
      ) : layoutMode === 'master_table' ? (
        /* Master Continuous Schedule Table */
        <div
          className={`rounded-2xl border overflow-hidden ${
            isDarkDisplay
              ? 'bg-slate-900 border-slate-800'
              : 'bg-white border-slate-200 shadow-2xs'
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className={`border-b text-xs font-bold ${
                    isDarkDisplay
                      ? 'bg-white border-slate-200 text-slate-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
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
                            } ${isDarkDisplay ? 'text-indigo-300' : 'text-indigo-950'}`}
                          >
                            {!expandMultiDay && totalSpanDays > 1
                              ? formatTaskDateRangeLabel(task, 'long')
                              : formatThaiDateDisplay(displayDate, 'long')}
                          </button>
                          <div className="text-xs text-slate-500 mt-0.5">
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
                            <div className="text-xs font-semibold text-indigo-600 mt-0.5">
                              {!expandMultiDay
                                ? `🗓️ กำหนดการต่อเนื่อง ${formatTaskDateRangeLabel(task, 'long')} (รวม ${totalSpanDays} วัน)`
                                : `งานต่อเนื่อง ${formatTaskDateRangeLabel(task, 'short')} (วันที่ ${dayIndexOfSpan}/${totalSpanDays})`}
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
                            className="inline-flex items-center gap-1.5 text-xs font-semibold"
                            style={{ color: catColor }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: catColor }}
                            />
                            <span>{cat?.name || 'ทั่วไป'}</span>
                          </span>
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap text-xs font-semibold">
                          {task.priority === TaskPriority.HIGH ? (
                            <span className="text-rose-600">ด่วนมาก (สูง)</span>
                          ) : task.priority === TaskPriority.MEDIUM ? (
                            <span className="text-amber-600">ปานกลาง</span>
                          ) : (
                            <span className="text-slate-500">ทั่วไป</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={() => onToggleStatus(task)}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                              isDone
                                ? 'text-emerald-600'
                                : displayDate === todayStr && task.time <= nowHM
                                ? 'text-rose-600'
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
      ) : (
        /* Day-by-Day Schedule Sections (Default & Single-Day Presentation View) */
        <div className="space-y-6">
          {scheduleByDate.map((group) => {
            const isTodayGroup = group.date === todayStr;
            const rel = getRelativeDayLabel(group.date, todayStr);
            const doneInDay = group.items.filter(
              (i) => i.task.status === TaskStatus.COMPLETED
            ).length;
            const pendingInDay = group.items.length - doneInDay;

            return (
              <section
                key={group.date}
                className={`rounded-2xl border overflow-hidden transition-colors ${
                  isTodayGroup
                    ? isDarkDisplay
                      ? 'bg-slate-900 border-emerald-500/70'
                      : 'bg-white border-indigo-300 shadow-sm'
                    : isDarkDisplay
                    ? 'bg-slate-900 border-slate-800'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}
              >
                {/* Day Header Bar */}
                <div
                  className={`px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 ${
                    isDarkDisplay
                      ? 'bg-white border-slate-200 text-slate-900'
                      : isTodayGroup
                      ? 'bg-indigo-50/70 border-indigo-200/80'
                      : 'bg-slate-50/80 border-slate-200/80'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <CalendarIcon
                      className={`h-6 w-6 shrink-0 ${
                        isTodayGroup ? 'text-indigo-600' : 'text-slate-600'
                      }`}
                    />
                    <h2
                      className={`font-extrabold text-slate-900 ${
                        isLargeText ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-xl'
                      }`}
                    >
                      {!expandMultiDay
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
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      <span>เพิ่มงานวันนี้</span>
                    </button>
                  </div>
                </div>

                {/* Day Schedule Rows */}
                <div
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
                    const isDone = task.status === TaskStatus.COMPLETED;
                    const isHigh = task.priority === TaskPriority.HIGH;
                    const isCurrentDayPassed =
                      displayDate === todayStr && task.time <= nowHM && !isDone;

                    return (
                      <div
                        key={`${displayDate}-${task.id}-${idx}`}
                        className={`px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                          isDarkDisplay ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/70'
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
                                  : isDarkDisplay
                                  ? 'text-emerald-400'
                                  : 'text-indigo-950'
                              }`}
                            >
                              <Clock className="h-5 w-5 text-indigo-500 shrink-0" />
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
                                  } font-bold text-rose-600`}
                                >
                                  · ด่วนมาก
                                </span>
                              )}
                            </div>

                            {task.description && (
                              <p
                                className={`leading-relaxed break-words ${
                                  isLargeText ? 'text-lg sm:text-xl' : 'text-sm sm:text-base'
                                } ${isDarkDisplay ? 'text-slate-300' : 'text-slate-600'}`}
                              >
                                {task.description}
                              </p>
                            )}

                            <div
                              className={`flex flex-wrap items-center gap-2.5 ${
                                isLargeText ? 'text-base sm:text-lg' : 'text-sm sm:text-base'
                              } ${isDarkDisplay ? 'text-slate-300' : 'text-slate-600'} pt-1`}
                            >
                              <span
                                className="inline-flex items-center gap-2 font-bold"
                                style={{ color: catColor }}
                              >
                                <span
                                  className="h-3 w-3 rounded-xs shrink-0"
                                  style={{ backgroundColor: catColor }}
                                />
                                <span>{cat?.name || 'ทั่วไป'}</span>
                              </span>

                              {totalSpanDays > 1 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-bold text-indigo-600">
                                    {!expandMultiDay
                                      ? `🗓️ กำหนดการต่อเนื่อง: ${formatTaskDateRangeLabel(
                                          task,
                                          'long'
                                        )} (รวม ${totalSpanDays} วัน)`
                                      : `งานต่อเนื่อง ${formatTaskDateRangeLabel(
                                          task,
                                          'short'
                                        )} (วันที่ ${dayIndexOfSpan} จาก ${totalSpanDays} วัน)`}
                                  </span>
                                </>
                              )}

                              {task.assigneeName && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-medium">
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
                                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {isDone ? (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                <span>เสร็จสิ้นแล้ว</span>
                              </>
                            ) : (
                              <>
                                <Circle className="h-4 w-4" style={{ color: catColor }} />
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
