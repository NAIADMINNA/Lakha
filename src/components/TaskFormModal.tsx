import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, Calendar, Clock, MapPin, X } from 'lucide-react';
import { Category, Task, TaskPriority, TaskStatus } from '../types';
import {
  REMINDER_TIMING_OPTIONS,
  formatLocalDateYMD,
  formatRemindMinutesLabel,
  formatTaskDateRangeLabel,
  formatThaiDateDisplay,
} from '../services/lineCommandParser';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskData: Omit<Task, 'id' | 'updatedAt' | 'lineNotified'>, existingId?: string) => void;
  categories: Category[];
  existingTasks?: Task[];
  initialDate?: string;
  editingTask?: Task | null;
  defaultRemindMinutes: number;
}

const QUICK_TIME_PRESETS = ['08:30', '09:00', '09:30', '10:00', '13:30', '14:00', '15:00'];
const QUICK_LOCATION_PRESETS = [
  'ห้องประชุมสำนักฯ',
  'ห้องประชุมกรมฯ',
  'กระทรวงแรงงาน',
  'ออนไลน์ (Zoom)',
];

function splitLocationAndDescription(rawDescription: string): {
  location: string;
  notes: string;
} {
  const raw = (rawDescription || '').trim();
  if (!raw) return { location: '', notes: '' };
  const lines = raw.split('\n');
  let extractedLocation = '';
  const remainingLines: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^สถานที่\s*:\s*(.+)$/i);
    if (match && !extractedLocation) {
      extractedLocation = match[1].trim();
    } else {
      remainingLines.push(line);
    }
  }

  return {
    location: extractedLocation,
    notes: remainingLines.join('\n').trim(),
  };
}

function parseTimeMinutes(hm: string): number | null {
  const m = (hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  categories,
  existingTasks = [],
  initialDate,
  editingTask,
  defaultRemindMinutes,
}) => {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => initialDate || formatLocalDateYMD());
  const [endDate, setEndDate] = useState('');
  const [time, setTime] = useState('09:30');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'cat-work');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.PENDING);
  const [remindMinutesBefore, setRemindMinutesBefore] = useState<number>(defaultRemindMinutes);

  const prevOpenSessionKeyRef = useRef<string>('');
  const isSubmittingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      prevOpenSessionKeyRef.current = '';
      isSubmittingRef.current = false;
      return;
    }
    isSubmittingRef.current = false;

    const sessionKey = `${editingTask?.id || 'new'}:${initialDate || ''}`;
    if (prevOpenSessionKeyRef.current === sessionKey) {
      return;
    }
    prevOpenSessionKeyRef.current = sessionKey;

    if (editingTask) {
      const parsedDesc = splitLocationAndDescription(editingTask.description);
      setTitle(editingTask.title);
      setLocation(parsedDesc.location);
      setDescription(parsedDesc.notes);
      setDate(editingTask.date);
      setEndDate(
        editingTask.endDate && editingTask.endDate > editingTask.date ? editingTask.endDate : ''
      );
      setTime(editingTask.time);
      setCategoryId(editingTask.categoryId);
      setPriority(editingTask.priority);
      setStatus(editingTask.status);
      setRemindMinutesBefore(editingTask.remindMinutesBefore);
    } else {
      setTitle('');
      setLocation('');
      setDescription('');
      setDate(initialDate || formatLocalDateYMD());
      setEndDate('');
      setTime('09:30');
      setCategoryId(categories[0]?.id || 'cat-work');
      setPriority(TaskPriority.MEDIUM);
      setStatus(TaskStatus.PENDING);
      setRemindMinutesBefore(defaultRemindMinutes);
    }
  }, [isOpen, editingTask, initialDate, categories, defaultRemindMinutes]);

  const conflictingTasks = useMemo(() => {
    if (!isOpen || !date || !time) return [];
    const targetMins = parseTimeMinutes(time);
    if (targetMins === null) return [];
    const targetEnd = endDate && endDate > date ? endDate : date;

    return existingTasks.filter((t) => {
      if (!t || t.id === editingTask?.id) return false;
      if (t.status === TaskStatus.COMPLETED) return false;
      const tEnd = t.endDate && t.endDate > t.date ? t.endDate : t.date;
      const datesOverlap = t.date <= targetEnd && tEnd >= date;
      if (!datesOverlap) return false;
      const tMins = parseTimeMinutes(t.time);
      if (tMins === null) return false;
      return Math.abs(tMins - targetMins) < 45;
    });
  }, [isOpen, existingTasks, editingTask?.id, date, endDate, time]);

  if (!isOpen) return null;

  const applyQuickDurationDays = (daysCount: number) => {
    if (daysCount <= 1) {
      setEndDate('');
      return;
    }
    const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return;
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + (daysCount - 1));
    const ey = dt.getFullYear();
    const em = String(dt.getMonth() + 1).padStart(2, '0');
    const ed = String(dt.getDate()).padStart(2, '0');
    setEndDate(`${ey}-${em}-${ed}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (!title.trim()) return;
    isSubmittingRef.current = true;

    const cleanLoc = location.trim();
    const cleanNotes = description.trim();
    const combinedDescription = cleanLoc
      ? cleanNotes
        ? `สถานที่: ${cleanLoc}\n${cleanNotes}`
        : `สถานที่: ${cleanLoc}`
      : cleanNotes;

    onSave(
      {
        title: title.trim(),
        description: combinedDescription,
        date,
        endDate: endDate && endDate > date ? endDate : undefined,
        time,
        categoryId,
        priority,
        status,
        remindMinutesBefore,
        source: editingTask?.source || 'web',
      },
      editingTask?.id
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white border border-slate-200/90 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Top Ceremonial Accent Bar */}
        <div
          aria-hidden="true"
          className="h-1.5 w-full bg-gradient-to-r from-indigo-900 via-indigo-600 to-amber-500 shrink-0"
        />

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100 bg-gradient-to-br from-white via-slate-50/40 to-indigo-50/30 shrink-0">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
              {editingTask ? 'แก้ไขกำหนดการภารกิจ' : 'เพิ่มกำหนดการภารกิจใหม่'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              บันทึกในปฏิทินร่วมกันของทีมและซิงค์เข้าฐานข้อมูล Google Sheets อัตโนมัติ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {/* Task Title */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              หัวข้อภารกิจ / นัดหมาย *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ประชุมคณะทำงานบริหารแรงงานต่างด้าว, ลงพื้นที่ตรวจเยี่ยม..."
              className="w-full rounded-xl border border-slate-200/90 bg-slate-50/50 focus:bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none transition-colors"
            />
          </div>

          {/* Dedicated Location / Meeting Room Field + Quick Chips */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              สถานที่ / ห้องประชุม
            </label>
            <div className="relative">
              <MapPin className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="เช่น ห้องประชุมชั้น 5, กระทรวงแรงงาน หรือลิงก์ประชุมออนไลน์..."
                className="w-full rounded-xl border border-slate-200/90 bg-slate-50/50 focus:bg-white pl-9 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none transition-colors"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">เลือกด่วน:</span>
              {QUICK_LOCATION_PRESETS.map((locPreset) => (
                <button
                  key={locPreset}
                  type="button"
                  onClick={() => setLocation(locPreset)}
                  className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-medium transition-colors ${
                    location === locPreset
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {locPreset}
                </button>
              ))}
            </div>
          </div>

          {/* Date & Time Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                วันที่เริ่มต้น *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  setDate(nextStart);
                  if (endDate && endDate < nextStart) {
                    setEndDate('');
                  }
                }}
                className="w-full h-10 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-bold text-slate-900 font-mono-tabular focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                ถึงวันที่ (งานหลายวัน)
              </label>
              <input
                type="date"
                min={date}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="เว้นว่างถ้า 1 วัน"
                className="w-full h-10 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-bold text-slate-900 font-mono-tabular focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                เวลาเริ่มงาน *
              </label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-bold text-slate-900 font-mono-tabular focus:border-indigo-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Quick Time Presets & Multi-Day Duration Presets */}
          <div className="space-y-2 rounded-xl bg-slate-50/80 border border-slate-200/80 p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-500 font-semibold mr-1">เวลาที่ใช้บ่อย:</span>
              {QUICK_TIME_PRESETS.map((presetTime) => (
                <button
                  key={presetTime}
                  type="button"
                  onClick={() => setTime(presetTime)}
                  className={`px-2.5 py-1 rounded-lg border font-mono-tabular font-semibold transition-colors ${
                    time === presetTime
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                  }`}
                >
                  {presetTime}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500 font-semibold mr-1">ระยะเวลา:</span>
                {[
                  { label: '1 วัน', days: 1 },
                  { label: '2 วัน', days: 2 },
                  { label: '3 วัน', days: 3 },
                  { label: '5 วัน', days: 5 },
                ].map((item) => {
                  const isActiveDur =
                    (item.days === 1 && !endDate) ||
                    (item.days > 1 &&
                      Boolean(endDate) &&
                      Math.round(
                        (new Date(`${endDate}T00:00:00`).getTime() -
                          new Date(`${date}T00:00:00`).getTime()) /
                          (1000 * 60 * 60 * 24)
                      ) +
                        1 ===
                        item.days);
                  return (
                    <button
                      key={item.days}
                      type="button"
                      onClick={() => applyQuickDurationDays(item.days)}
                      className={`px-2.5 py-0.5 rounded-lg border font-semibold transition-colors ${
                        isActiveDur
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <span className="text-indigo-700 font-bold">
                {endDate && endDate > date
                  ? formatTaskDateRangeLabel({ date, endDate }, 'long')
                  : formatThaiDateDisplay(date, 'long')}{' '}
                · {time} น.
              </span>
            </div>
          </div>

          {/* Real-time Time Conflict Warning */}
          {conflictingTasks.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200/90 px-3.5 py-2.5 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <div className="font-bold text-amber-900">
                  แจ้งเตือนเวลาใกล้เคียงกับภารกิจอื่นในวันเดียวกัน ({conflictingTasks.length} รายการ)
                </div>
                {conflictingTasks.slice(0, 2).map((ct) => (
                  <div key={ct.id} className="text-amber-800 truncate">
                    • <span className="font-mono-tabular font-semibold">{ct.time} น.</span> —{' '}
                    {ct.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additional Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              รายละเอียด / หมายเหตุเพิ่มเติม
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ระบุการแต่งกาย ผู้เข้าร่วม หรือหมายเหตุเพิ่มเติม..."
              className="w-full rounded-xl border border-slate-200/90 bg-slate-50/50 focus:bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none transition-colors"
            />
          </div>

          {/* Category & Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                หมวดหมู่งาน
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full h-10 rounded-xl border border-slate-200/90 px-3 text-sm font-medium text-slate-900 bg-white focus:border-indigo-600 focus:outline-none"
              >
                {categories.length === 0 ? (
                  <option value="cat-work">ทั่วไป (ยังไม่มีหมวดหมู่ที่ตั้งไว้)</option>
                ) : (
                  categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                ระดับความสำคัญ
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full h-10 rounded-xl border border-slate-200/90 px-3 text-sm font-medium text-slate-900 bg-white focus:border-indigo-600 focus:outline-none"
              >
                <option value={TaskPriority.HIGH}>ด่วนมาก / สำคัญสูง (High)</option>
                <option value={TaskPriority.MEDIUM}>ปานกลาง (Medium)</option>
                <option value={TaskPriority.LOW}>ทั่วไป (Low)</option>
              </select>
            </div>
          </div>

          {/* Status & LINE Reminder */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                สถานะภารกิจ
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full h-10 rounded-xl border border-slate-200/90 px-3 text-sm font-medium text-slate-900 bg-white focus:border-indigo-600 focus:outline-none"
              >
                <option value={TaskStatus.PENDING}>รอดำเนินการ</option>
                <option value={TaskStatus.IN_PROGRESS}>กำลังดำเนินการ</option>
                <option value={TaskStatus.COMPLETED}>เสร็จสิ้นแล้ว</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                แจ้งเตือนผ่าน LINE ล่วงหน้า
              </label>
              <select
                value={remindMinutesBefore}
                onChange={(e) => setRemindMinutesBefore(Number(e.target.value))}
                className="w-full h-10 rounded-xl border border-slate-200/90 px-3 text-sm font-medium text-slate-900 bg-white focus:border-indigo-600 focus:outline-none"
              >
                <option value={0}>ไม่แจ้งเตือนอัตโนมัติ</option>
                {REMINDER_TIMING_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Reminder Summary Footer Strip */}
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>
                {remindMinutesBefore > 0
                  ? `แจ้งเตือน LINE ล่วงหน้า ${formatRemindMinutesLabel(remindMinutesBefore)}`
                  : 'ปิดการแจ้งเตือน LINE อัตโนมัติ'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono-tabular text-slate-500 shrink-0">
              <Calendar className="h-3.5 w-3.5" />
              <span>{endDate && endDate > date ? `${date} ถึง ${endDate}` : date}</span>
              <Clock className="h-3.5 w-3.5 ml-1" />
              <span>{time}</span>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-200/90 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="h-10 px-5 text-xs font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              {editingTask ? 'บันทึกการแก้ไข' : 'บันทึกกำหนดการลงปฏิทิน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

