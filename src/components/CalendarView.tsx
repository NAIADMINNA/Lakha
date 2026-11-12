import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Category, Task, TaskPriority, TaskStatus } from '../types';
import {
  formatLocalDateYMD,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
  getTaskDurationDays,
} from '../services/lineCommandParser';

interface CalendarViewProps {
  tasks: Task[];
  categories: Category[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onAddTaskForDate: (date: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onDeleteCompletedTasks?: () => void;
  onToggleStatus: (task: Task) => void;
  onSendLineReminderNow: (task: Task) => void;
}

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WEEKDAYS_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function formatThaiDayWithWeekday(ymd: string): string {
  const parts = ymd.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    return formatThaiDateDisplay(ymd, 'long');
  }
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayName = WEEKDAYS_FULL[dt.getDay()] || '';
  return `วัน${dayName}ที่ ${formatThaiDateDisplay(ymd, 'long')}`;
}

export function buildGoogleCalendarTemplateUrl(task: Task, categoryName?: string): string {
  const cleanStartDate = task.date.replace(/-/g, '');
  const cleanEndDate =
    task.endDate && task.endDate > task.date
      ? task.endDate.replace(/-/g, '')
      : cleanStartDate;
  const [hhStr = '09', mmStr = '00'] = (task.time || '09:00').split(':');
  const startHH = String(parseInt(hhStr, 10)).padStart(2, '0');
  const startMM = String(parseInt(mmStr, 10)).padStart(2, '0');
  const endHour = Math.min(23, parseInt(hhStr, 10) + 1);
  const endHH = String(endHour).padStart(2, '0');

  const datesParam = `${cleanStartDate}T${startHH}${startMM}00/${cleanEndDate}T${endHH}${startMM}00`;
  const details = `${task.description || ''}${
    categoryName ? `\nหมวดหมู่: ${categoryName}` : ''
  }\nบันทึกจากระบบน้องเลขา`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: datesParam,
    details: details.trim(),
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  tasks,
  categories,
  selectedDate,
  onSelectDate,
  onAddTaskForDate,
  onEditTask,
  onDeleteTask,
  onDeleteCompletedTasks,
  onToggleStatus,
  onSendLineReminderNow,
}) => {
  const todayStr = formatLocalDateYMD();
  const [hideCompleted, setHideCompleted] = useState<boolean>(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [calendarSearchQuery, setCalendarSearchQuery] = useState<string>('');

  const completedCount = useMemo(
    () => tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
    [tasks]
  );

  const visibleTasks = useMemo(() => {
    const q = calendarSearchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (hideCompleted && t.status === TaskStatus.COMPLETED) return false;
      if (selectedCategoryFilter !== 'all' && t.categoryId !== selectedCategoryFilter) {
        return false;
      }
      if (q) {
        const catName =
          categories.find((c) => c.id === t.categoryId)?.name.toLowerCase() || '';
        const haystack = `${t.title} ${t.description || ''} ${t.time || ''} ${catName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, hideCompleted, selectedCategoryFilter, calendarSearchQuery, categories]);

  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => {
    const parsed = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
    if (isNaN(parsed.getTime())) return new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  });

  useEffect(() => {
    if (!selectedDate) return;
    const parsed = new Date(`${selectedDate}T00:00:00`);
    if (!isNaN(parsed.getTime())) {
      setCurrentMonthDate(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }
  }, [selectedDate]);

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  const categoryMap = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    const addTaskToDay = (dateKey: string, task: Task) => {
      if (!map[dateKey]) map[dateKey] = [];
      if (!map[dateKey].some((existing) => existing.id === task.id)) {
        map[dateKey].push(task);
      }
    };

    visibleTasks.forEach((t) => {
      if (t.endDate && t.endDate > t.date) {
        const [sy, sm, sd] = t.date.split('-').map((n) => parseInt(n, 10));
        const [ey, em, ed] = t.endDate.split('-').map((n) => parseInt(n, 10));
        if (sy && sm && sd && ey && em && ed) {
          const cur = new Date(sy, sm - 1, sd);
          const last = new Date(ey, em - 1, ed);
          let guard = 0;
          while (cur <= last && guard < 90) {
            const yStr = cur.getFullYear();
            const mStr = String(cur.getMonth() + 1).padStart(2, '0');
            const dStr = String(cur.getDate()).padStart(2, '0');
            addTaskToDay(`${yStr}-${mStr}-${dStr}`, t);
            cur.setDate(cur.getDate() + 1);
            guard++;
          }
          return;
        }
      }
      addTaskToDay(t.date, t);
    });

    Object.keys(map).forEach((d) => {
      map[d].sort((a, b) => a.time.localeCompare(b.time));
    });
    return map;
  }, [visibleTasks]);

  const calendarCells = useMemo(() => {
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: { dateStr: string; dayNumber: number; isCurrentMonth: boolean }[] = [];

    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, d);
      const yStr = prevDate.getFullYear();
      const mStr = String(prevDate.getMonth() + 1).padStart(2, '0');
      const dStr = String(prevDate.getDate()).padStart(2, '0');
      cells.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        dayNumber: d,
        isCurrentMonth: false,
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(month + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      cells.push({
        dateStr: `${year}-${mStr}-${dStr}`,
        dayNumber: d,
        isCurrentMonth: true,
      });
    }

    const totalNeeded = cells.length > 35 ? 42 : 35;
    const remaining = totalNeeded - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const yStr = nextDate.getFullYear();
      const mStr = String(nextDate.getMonth() + 1).padStart(2, '0');
      const dStr = String(nextDate.getDate()).padStart(2, '0');
      cells.push({
        dateStr: `${yStr}-${mStr}-${dStr}`,
        dayNumber: d,
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [year, month]);

  const selectedDayTasks = tasksByDate[selectedDate] || [];
  const selectedDayPendingCount = selectedDayTasks.filter(
    (t) => t.status !== TaskStatus.COMPLETED
  ).length;

  const monthSummary = useMemo(() => {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthTasks = tasks.filter((t) => {
      const startMonth = (t.date || '').slice(0, 7);
      const endMonth = (t.endDate || t.date || '').slice(0, 7);
      return startMonth <= monthPrefix && endMonth >= monthPrefix;
    });
    const done = monthTasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
    const high = monthTasks.filter(
      (t) => t.priority === TaskPriority.HIGH && t.status !== TaskStatus.COMPLETED
    ).length;
    return {
      total: monthTasks.length,
      pending: monthTasks.length - done,
      done,
      high,
    };
  }, [tasks, year, month]);

  const handlePrevMonth = () => {
    setCurrentMonthDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonthDate(new Date(year, month + 1, 1));
  };

  const handleGoToday = () => {
    const now = new Date();
    setCurrentMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
    onSelectDate(todayStr);
  };

  const priorityLabel = (p: TaskPriority) =>
    p === TaskPriority.HIGH ? 'สำคัญสูง' : p === TaskPriority.MEDIUM ? 'ปานกลาง' : 'ทั่วไป';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Monthly Calendar Grid (8 columns on desktop) */}
      <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
        {/* Top Ceremonial Accent Bar */}
        <div
          aria-hidden="true"
          className="h-1.5 w-full bg-gradient-to-r from-indigo-900 via-indigo-600 to-amber-500"
        />

        {/* Monthly Executive Header */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 bg-gradient-to-br from-white via-slate-50/50 to-indigo-50/35">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-indigo-700 tracking-wide">
              ปฏิทินตารางภารกิจรายเดือน
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                {THAI_MONTHS[month]} พ.ศ. {year + 543}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span>
                  รวม <strong className="font-mono-tabular text-slate-900">{monthSummary.total}</strong> งาน
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  รอทำ <strong className="font-mono-tabular text-amber-700">{monthSummary.pending}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  เสร็จแล้ว <strong className="font-mono-tabular text-emerald-700">{monthSummary.done}</strong>
                </span>
                {monthSummary.high > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-rose-600 font-semibold">
                      ด่วน <span className="font-mono-tabular">{monthSummary.high}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Month Navigation & Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Unified Stepper: Prev / Today / Next */}
            <div className="inline-flex items-center h-9 bg-white border border-slate-200/90 rounded-xl p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                aria-label="เดือนก่อนหน้า"
                title="เดือนก่อนหน้า"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleGoToday}
                className="h-8 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap"
              >
                วันนี้
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                aria-label="เดือนถัดไป"
                title="เดือนถัดไป"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => onAddTaskForDate(selectedDate)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>เพิ่มงานใหม่</span>
            </button>

            {completedCount > 0 && (
              <button
                type="button"
                onClick={() => setHideCompleted((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap shrink-0 ${
                  hideCompleted
                    ? 'text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100'
                    : 'text-slate-700 bg-white border-slate-200/90 hover:bg-slate-50'
                }`}
                title="ซ่อนหรือแสดงงานที่ทำเสร็จแล้วบนตารางปฏิทิน"
              >
                {hideCompleted ? (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    <span>แสดงงานเสร็จ ({completedCount})</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>ซ่อนงานเสร็จ ({completedCount})</span>
                  </>
                )}
              </button>
            )}

            {onDeleteCompletedTasks && completedCount > 0 && (
              <button
                type="button"
                onClick={onDeleteCompletedTasks}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-rose-700 bg-rose-50/80 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors whitespace-nowrap shrink-0"
                title="ลบงานที่ทำเสร็จแล้วทั้งหมดในคราวเดียว"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">ลบงานเสร็จ ({completedCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Interactive Category Filter Legend & Inline Search Bar */}
        <div className="px-5 sm:px-6 py-2.5 bg-white border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategoryFilter('all')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedCategoryFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span>ทุกหมวดหมู่</span>
            </button>
            {categories.map((cat) => {
              const isActiveCat = selectedCategoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) => (prev === cat.id ? 'all' : cat.id))
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isActiveCat
                      ? 'bg-indigo-50 text-indigo-950 font-semibold ring-1 ring-indigo-300'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[190px] sm:w-52 shrink-0">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={calendarSearchQuery}
              onChange={(e) => setCalendarSearchQuery(e.target.value)}
              placeholder="ค้นหางานในปฏิทิน..."
              className="w-full h-8 rounded-lg border border-slate-200/90 bg-slate-50/70 hover:bg-white focus:bg-white pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none transition-colors"
            />
            {calendarSearchQuery && (
              <button
                type="button"
                onClick={() => setCalendarSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                title="ล้างคำค้นหา"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 border-b border-slate-200/90 bg-slate-50/90">
          {WEEKDAYS_FULL.map((dayFull, idx) => (
            <div
              key={dayFull}
              className={`py-2.5 text-center text-xs font-bold tracking-tight ${
                idx === 0
                  ? 'text-rose-600 bg-rose-50/30'
                  : idx === 6
                  ? 'text-indigo-600 bg-indigo-50/30'
                  : 'text-slate-700'
              }`}
            >
              <span className="hidden sm:inline">{dayFull}</span>
              <span className="sm:hidden">{WEEKDAYS_SHORT[idx]}</span>
            </div>
          ))}
        </div>

        {/* Days Grid (Responsive for Mobile, Tablet, and Desktop) */}
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-200/80">
          {calendarCells.map((cell, cellIdx) => {
            const dayTasks = tasksByDate[cell.dateStr] || [];
            const isSelected = cell.dateStr === selectedDate;
            const isToday = cell.dateStr === todayStr;
            const colIdx = cellIdx % 7;
            const isWeekend = colIdx === 0 || colIdx === 6;

            return (
              <div
                key={cell.dateStr}
                onClick={() => onSelectDate(cell.dateStr)}
                className={`group relative min-h-[80px] sm:min-h-[118px] lg:min-h-[130px] p-1.5 sm:p-2.5 transition-all cursor-pointer flex flex-col justify-between ${
                  !cell.isCurrentMonth
                    ? 'bg-slate-50/80 text-slate-400 hover:bg-slate-100/70'
                    : isSelected
                    ? 'bg-indigo-50/55 ring-2 ring-inset ring-indigo-600 z-10'
                    : isToday
                    ? 'bg-emerald-50/30 hover:bg-emerald-50/55'
                    : isWeekend
                    ? 'bg-slate-50/30 hover:bg-indigo-50/25'
                    : 'bg-white hover:bg-indigo-50/25'
                }`}
              >
                {/* Top Date Number & Quick Add Affordance */}
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg text-[11px] sm:text-xs font-mono-tabular font-bold transition-colors ${
                        isToday
                          ? 'bg-[#06C755] text-white shadow-xs'
                          : isSelected
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : !cell.isCurrentMonth
                          ? 'text-slate-400'
                          : colIdx === 0
                          ? 'text-rose-600'
                          : colIdx === 6
                          ? 'text-indigo-700'
                          : 'text-slate-800'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {isToday && (
                      <span className="hidden xl:inline text-[10px] font-bold text-emerald-700">
                        วันนี้
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {dayTasks.length > 0 && (
                      <>
                        <span className="hidden sm:inline text-[11px] font-mono-tabular text-slate-500 font-semibold group-hover:hidden">
                          {dayTasks.length} งาน
                        </span>
                        <span className="sm:hidden text-[10px] font-mono-tabular font-bold text-indigo-600">
                          {dayTasks.length}
                        </span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate(cell.dateStr);
                        onAddTaskForDate(cell.dateStr);
                      }}
                      className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 h-5 w-5 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all"
                      title={`เพิ่มงานในวันที่ ${formatThaiDateDisplay(cell.dateStr, 'short')}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Desktop & Tablet Event Items */}
                <div className="hidden sm:block mt-1.5 space-y-1">
                  {dayTasks.slice(0, 3).map((t) => {
                    const cat = categoryMap[t.categoryId];
                    const catColor = cat?.color || '#2563EB';
                    const isDone = t.status === TaskStatus.COMPLETED;
                    const isUrgent = t.priority === TaskPriority.HIGH && !isDone;
                    return (
                      <div
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(cell.dateStr);
                        }}
                        style={{
                          backgroundColor: isDone ? '#F8FAFC' : `${catColor}14`,
                        }}
                        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] border transition-colors truncate ${
                          isDone
                            ? 'border-slate-200/80 opacity-60 line-through text-slate-500'
                            : isUrgent
                            ? 'border-rose-200/90 hover:border-rose-300'
                            : 'border-transparent hover:border-slate-200'
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: isDone ? '#94A3B8' : catColor }}
                        />
                        <span
                          className="font-mono-tabular text-[10px] font-bold shrink-0"
                          style={{ color: isDone ? '#64748B' : catColor }}
                        >
                          {t.time}
                        </span>
                        <span
                          className={`truncate font-medium ${
                            isDone
                              ? 'text-slate-500'
                              : isUrgent
                              ? 'text-rose-950 font-semibold'
                              : 'text-slate-800'
                          }`}
                        >
                          {t.title}
                        </span>
                        {t.endDate && t.endDate > t.date && (
                          <span className="ml-auto shrink-0 font-mono-tabular text-[9px] font-bold text-indigo-700">
                            {getTaskDurationDays(t.date, t.endDate)}ว.
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[11px] text-indigo-600 font-mono-tabular font-semibold pl-1 pt-0.5">
                      + อีก {dayTasks.length - 3} รายการ
                    </div>
                  )}
                </div>

                {/* Mobile Compact Event Items (< 640px) */}
                <div className="sm:hidden mt-1 space-y-0.5">
                  {dayTasks.slice(0, 2).map((t) => {
                    const cat = categoryMap[t.categoryId];
                    const catColor = cat?.color || '#2563EB';
                    const isDone = t.status === TaskStatus.COMPLETED;
                    return (
                      <div
                        key={t.id}
                        style={{
                          backgroundColor: isDone ? '#F1F5F9' : `${catColor}18`,
                        }}
                        className={`flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-medium truncate leading-tight ${
                          isDone ? 'line-through text-slate-400' : 'text-slate-800'
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: isDone ? '#94A3B8' : catColor }}
                        />
                        <span className="truncate">{t.title}</span>
                      </div>
                    );
                  })}
                  {dayTasks.length > 2 && (
                    <div className="text-[9px] text-indigo-600 font-mono-tabular font-bold leading-none pl-0.5">
                      +{dayTasks.length - 2}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Agenda Inspector Panel (4 columns on desktop, sticky) */}
      <div className="lg:col-span-4 lg:sticky lg:top-20 bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
        {/* Top Ceremonial Accent Bar */}
        <div
          aria-hidden="true"
          className="h-1.5 w-full bg-gradient-to-r from-emerald-700 via-teal-500 to-indigo-600"
        />

        <div className="p-5 sm:p-6">
          {/* Selected Date Header */}
          <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-700 tracking-wide">
                กำหนดการประจำวันที่เลือก
                {selectedDate === todayStr ? ' · วันนี้' : ''}
              </div>
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5 leading-snug">
                {formatThaiDayWithWeekday(selectedDate)}
              </h3>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <span>
                  ทั้งหมด{' '}
                  <strong className="font-mono-tabular text-slate-800">
                    {selectedDayTasks.length}
                  </strong>{' '}
                  รายการ
                </span>
                {selectedDayTasks.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      รอดำเนินการ{' '}
                      <strong className="font-mono-tabular text-amber-700">
                        {selectedDayPendingCount}
                      </strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onAddTaskForDate(selectedDate)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-bold text-white bg-[#06C755] rounded-xl hover:bg-[#05b04b] shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>เพิ่มงาน</span>
            </button>
          </div>

          {/* Selected Day Tasks Timeline */}
          {selectedDayTasks.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-3">
              <div className="h-11 w-11 rounded-2xl bg-slate-100 text-slate-400 inline-flex items-center justify-center mx-auto">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  ยังไม่มีกำหนดการในวันนี้
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  คลิกปุ่มด้านล่างเพื่อเพิ่มนัดหมายหรือภารกิจสำหรับวันที่{' '}
                  {formatThaiDateDisplay(selectedDate, 'long')}
                </p>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onAddTaskForDate(selectedDate)}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>สร้างรายการงานในวันนี้</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3 max-h-[640px] overflow-y-auto pr-0.5">
              {selectedDayTasks.map((task) => {
                const cat = categoryMap[task.categoryId];
                const catColor = cat?.color || '#2563EB';
                const isCompleted = task.status === TaskStatus.COMPLETED;
                const googleCalUrl = buildGoogleCalendarTemplateUrl(task, cat?.name);

                return (
                  <div
                    key={task.id}
                    className={`group rounded-xl border p-4 transition-all ${
                      isCompleted
                        ? 'border-slate-200/70 bg-slate-50/60 opacity-75'
                        : 'border-slate-200/90 bg-white hover:border-indigo-300/80 shadow-2xs'
                    }`}
                  >
                    {/* Row 1: Time + Status Check + Quick Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onToggleStatus(task)}
                          className="text-slate-400 hover:text-emerald-600 transition-colors shrink-0"
                          title={
                            isCompleted
                              ? 'เปลี่ยนเป็นรอดำเนินการ'
                              : 'ทำเครื่องหมายว่าเสร็จแล้ว'
                          }
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Circle className="h-4 w-4" style={{ color: catColor }} />
                          )}
                        </button>
                        <span
                          className="inline-flex items-center gap-1 font-mono-tabular text-xs font-extrabold"
                          style={{ color: isCompleted ? '#64748B' : catColor }}
                        >
                          <Clock className="h-3.5 w-3.5 shrink-0 opacity-80" />
                          <span>{task.time} น.</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSendLineReminderNow(task)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="ส่งแจ้งเตือนงานนี้เข้า LINE OA ทันที"
                        >
                          <Bell className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditTask(task)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="แก้ไขงาน"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTask(task)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="ลบงาน"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Title & Description */}
                    <div className="mt-2 pl-6">
                      <button
                        type="button"
                        onClick={() => onEditTask(task)}
                        className={`text-left text-sm font-bold leading-snug hover:text-indigo-700 transition-colors break-words ${
                          isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                        }`}
                      >
                        {task.title}
                      </button>

                      {task.description && (
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">
                          {task.description}
                        </p>
                      )}

                      {/* Row 3: Clean Unboxed Metadata */}
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span
                          className="inline-flex items-center gap-1.5 font-semibold"
                          style={{ color: catColor }}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: catColor }}
                          />
                          <span>{cat?.name || 'ทั่วไป'}</span>
                        </span>

                        {task.endDate && task.endDate > task.date && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-slate-700">
                              {formatTaskDateRangeLabel(task)}
                            </span>
                          </>
                        )}

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
                          {priorityLabel(task.priority)}
                        </span>

                        <span aria-hidden="true">·</span>
                        <a
                          href={googleCalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
                        >
                          <CalendarPlus className="h-3 w-3" />
                          <span>+Google Calendar</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
