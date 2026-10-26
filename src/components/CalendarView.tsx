import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Edit3,
  Plus,
  Trash2,
} from 'lucide-react';
import { Category, Task, TaskPriority, TaskStatus } from '../types';
import { formatLocalDateYMD } from '../services/lineCommandParser';

interface CalendarViewProps {
  tasks: Task[];
  categories: Category[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onAddTaskForDate: (date: string) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
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

const WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export function buildGoogleCalendarTemplateUrl(task: Task, categoryName?: string): string {
  const cleanDate = task.date.replace(/-/g, '');
  const [hhStr = '09', mmStr = '00'] = (task.time || '09:00').split(':');
  const startHH = String(parseInt(hhStr, 10)).padStart(2, '0');
  const startMM = String(parseInt(mmStr, 10)).padStart(2, '0');
  const endHour = Math.min(23, parseInt(hhStr, 10) + 1);
  const endHH = String(endHour).padStart(2, '0');

  const datesParam = `${cleanDate}T${startHH}${startMM}00/${cleanDate}T${endHH}${startMM}00`;
  const details = `${task.description || ''}${
    categoryName ? `\nหมวดหมู่: ${categoryName}` : ''
  }\nบันทึกจากระบบ SheetCal LINE`;

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
  onToggleStatus,
  onSendLineReminderNow,
}) => {
  const todayStr = formatLocalDateYMD();

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
    tasks.forEach((t) => {
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    });
    Object.keys(map).forEach((d) => {
      map[d].sort((a, b) => a.time.localeCompare(b.time));
    });
    return map;
  }, [tasks]);

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
      <div className="lg:col-span-8 bg-white border border-slate-200 border-t-4 border-t-indigo-600 rounded-xl overflow-hidden shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 bg-indigo-50/30">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {THAI_MONTHS[month]} {year + 543}{' '}
              <span className="text-indigo-600 font-semibold text-sm font-mono-tabular">
                ({year})
              </span>
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              ปฏิทินตารางงานส่วนกลางของทีม แยกสีตามหมวดหมู่งานชัดเจน
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGoToday}
              className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0"
            >
              วันนี้
            </button>
            <div className="flex items-center bg-white border border-slate-300 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-1.5 text-slate-600 hover:bg-slate-100 transition-colors"
                aria-label="เดือนก่อนหน้า"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-1.5 text-slate-600 hover:bg-slate-100 transition-colors border-l border-slate-300"
                aria-label="เดือนถัดไป"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onAddTaskForDate(selectedDate)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>เพิ่มงาน</span>
            </button>
          </div>
        </div>

        {/* Category Color Legend Bar */}
        <div className="px-5 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center gap-4 text-xs">
          {categories.map((cat) => (
            <div key={cat.id} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-slate-700 font-medium">{cat.name}</span>
            </div>
          ))}
        </div>

        {/* Weekday Headers */}
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAYS.map((day, idx) => (
            <div
              key={day}
              className={`py-2.5 text-center text-xs font-bold ${
                idx === 0
                  ? 'text-rose-600'
                  : idx === 6
                  ? 'text-indigo-600'
                  : 'text-slate-700'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
          {calendarCells.map((cell) => {
            const dayTasks = tasksByDate[cell.dateStr] || [];
            const isSelected = cell.dateStr === selectedDate;
            const isToday = cell.dateStr === todayStr;

            return (
              <div
                key={cell.dateStr}
                onClick={() => onSelectDate(cell.dateStr)}
                className={`min-h-[108px] sm:min-h-[124px] p-2 transition-colors cursor-pointer flex flex-col justify-between ${
                  !cell.isCurrentMonth
                    ? 'bg-slate-50/70 text-slate-400'
                    : isSelected
                    ? 'bg-indigo-50/60 ring-2 ring-inset ring-indigo-600'
                    : 'bg-white hover:bg-indigo-50/25'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-mono-tabular font-bold ${
                      isToday
                        ? 'bg-[#06C755] text-white shadow-2xs'
                        : isSelected
                        ? 'bg-indigo-600 text-white'
                        : cell.isCurrentMonth
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>
                  {dayTasks.length > 0 && (
                    <span className="text-[11px] font-mono-tabular text-indigo-600 font-semibold">
                      {dayTasks.length} งาน
                    </span>
                  )}
                </div>

                <div className="mt-1.5 space-y-1">
                  {dayTasks.slice(0, 3).map((t) => {
                    const cat = categoryMap[t.categoryId];
                    const catColor = cat?.color || '#2563EB';
                    const isDone = t.status === TaskStatus.COMPLETED;
                    return (
                      <div
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDate(cell.dateStr);
                        }}
                        style={{
                          backgroundColor: isDone ? '#F1F5F9' : `${catColor}18`,
                          borderLeft: `3px solid ${isDone ? '#94A3B8' : catColor}`,
                        }}
                        className={`flex items-center gap-1 rounded-r px-1.5 py-0.5 text-[11px] truncate ${
                          isDone ? 'opacity-60 line-through' : ''
                        }`}
                      >
                        <span
                          className="font-mono-tabular text-[10px] font-semibold shrink-0"
                          style={{ color: isDone ? '#64748B' : catColor }}
                        >
                          {t.time}
                        </span>
                        <span className="truncate text-slate-900 font-medium">
                          {t.title}
                        </span>
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[11px] text-indigo-600 font-mono-tabular font-medium pl-1">
                      + อีก {dayTasks.length - 3} รายการ
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Inspector Panel (4 columns on desktop) */}
      <div className="lg:col-span-4 bg-white border border-slate-200 border-t-4 border-t-emerald-500 rounded-xl p-5 shadow-2xs">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <div className="text-xs font-medium text-emerald-700">
              รายการงานประจำวันที่เลือก
            </div>
            <h3 className="text-base font-bold text-slate-900 font-mono-tabular mt-0.5">
              {selectedDate}
              {selectedDate === todayStr && (
                <span className="ml-2 text-xs font-sans font-semibold text-emerald-600">
                  · วันนี้
                </span>
              )}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onAddTaskForDate(selectedDate)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#06C755] rounded-lg hover:bg-[#05b04b] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>เพิ่มงาน</span>
          </button>
        </div>

        {selectedDayTasks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              ไม่มีรายการงานในวันที่ {selectedDate}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              คลิกปุ่ม &ldquo;เพิ่มงาน&rdquo; เพื่อสร้างรายการในวันนี้
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {selectedDayTasks.map((task) => {
              const cat = categoryMap[task.categoryId];
              const catColor = cat?.color || '#2563EB';
              const isCompleted = task.status === TaskStatus.COMPLETED;
              const googleCalUrl = buildGoogleCalendarTemplateUrl(task, cat?.name);

              return (
                <div
                  key={task.id}
                  style={{ borderLeft: `4px solid ${catColor}` }}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 hover:bg-white transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onToggleStatus(task)}
                        className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors shrink-0"
                        title={
                          isCompleted ? 'เปลี่ยนเป็นรอดำเนินการ' : 'ทำเครื่องหมายว่าเสร็จแล้ว'
                        }
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div
                          className={`text-sm font-semibold text-slate-900 break-words ${
                            isCompleted ? 'line-through text-slate-400' : ''
                          }`}
                        >
                          {task.title}
                        </div>
                        {task.description && (
                          <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">
                            {task.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span
                            className="inline-flex items-center gap-1.5 font-semibold"
                            style={{ color: catColor }}
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: catColor }}
                            />
                            {cat?.name || 'ทั่วไป'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular font-semibold text-slate-700">
                            {task.time} น.
                          </span>
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
                        onClick={() => onSendLineReminderNow(task)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                        title="ส่งแจ้งเตือนงานนี้เข้า LINE OA ทันที"
                      >
                        <Bell className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditTask(task)}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                        title="แก้ไขงาน"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="ลบงาน"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
