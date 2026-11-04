import React, { useEffect, useState } from 'react';
import { Bell, Calendar, Clock, X } from 'lucide-react';
import { Category, Task, TaskPriority, TaskStatus } from '../types';
import {
  REMINDER_TIMING_OPTIONS,
  formatLocalDateYMD,
  formatRemindMinutesLabel,
} from '../services/lineCommandParser';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (taskData: Omit<Task, 'id' | 'updatedAt' | 'lineNotified'>, existingId?: string) => void;
  categories: Category[];
  initialDate?: string;
  editingTask?: Task | null;
  defaultRemindMinutes: number;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  categories,
  initialDate,
  editingTask,
  defaultRemindMinutes,
}) => {
  const todayStr = formatLocalDateYMD();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(initialDate || todayStr);
  const [endDate, setEndDate] = useState('');
  const [time, setTime] = useState('09:30');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'cat-work');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.PENDING);
  const [remindMinutesBefore, setRemindMinutesBefore] = useState<number>(defaultRemindMinutes);

  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description);
      setDate(editingTask.date);
      setEndDate(editingTask.endDate && editingTask.endDate > editingTask.date ? editingTask.endDate : '');
      setTime(editingTask.time);
      setCategoryId(editingTask.categoryId);
      setPriority(editingTask.priority);
      setStatus(editingTask.status);
      setRemindMinutesBefore(editingTask.remindMinutesBefore);
    } else {
      setTitle('');
      setDescription('');
      setDate(initialDate || todayStr);
      setEndDate('');
      setTime('09:30');
      setCategoryId(categories[0]?.id || 'cat-work');
      setPriority(TaskPriority.MEDIUM);
      setStatus(TaskStatus.PENDING);
      setRemindMinutesBefore(defaultRemindMinutes);
    }
  }, [editingTask, initialDate, isOpen, categories, defaultRemindMinutes, todayStr]);

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
    if (!title.trim()) return;

    onSave(
      {
        title: title.trim(),
        description: description.trim(),
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {editingTask ? 'แก้ไขงานในปฏิทิน' : 'เพิ่มงานใหม่ลงปฏิทิน'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              บันทึกในปฏิทินร่วมกันของทีมและซิงค์กับ Google Sheets (รองรับงานวันเดียวและงานต่อเนื่องหลายวัน)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              หัวข้องาน *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ประชุมสรุปแผนงาน, อบรมสัมมนาต่างจังหวัด..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              รายละเอียดเพิ่มเติม
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ระบุหมายเหตุหรือรายละเอียดงาน..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
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
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 font-mono-tabular focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                ถึงวันที่ (กรณีมากกว่า 1 วัน)
              </label>
              <input
                type="date"
                min={date}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="เว้นว่างถ้า 1 วัน"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 font-mono-tabular focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                เวลางาน
              </label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 font-mono-tabular focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Quick Multi-Day Duration Selector */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500 font-medium mr-1">เลือกระยะเวลาด่วน:</span>
            {[
              { label: '1 วัน (วันเดียว)', days: 1 },
              { label: '2 วัน', days: 2 },
              { label: '3 วัน', days: 3 },
              { label: '5 วัน', days: 5 },
              { label: '7 วัน', days: 7 },
            ].map((item) => (
              <button
                key={item.days}
                type="button"
                onClick={() => applyQuickDurationDays(item.days)}
                className={`px-2.5 py-1 rounded-md border font-medium transition-colors ${
                  (item.days === 1 && !endDate) ||
                  (item.days > 1 &&
                    endDate &&
                    Math.round(
                      (new Date(`${endDate}T00:00:00`).getTime() -
                        new Date(`${date}T00:00:00`).getTime()) /
                        (1000 * 60 * 60 * 24)
                    ) +
                      1 ===
                      item.days)
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                หมวดหมู่งาน
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:border-slate-900 focus:outline-none"
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
              <label className="block text-xs font-medium text-slate-700 mb-1">
                ระดับความสำคัญ
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:border-slate-900 focus:outline-none"
              >
                <option value={TaskPriority.HIGH}>สูง (High Priority)</option>
                <option value={TaskPriority.MEDIUM}>ปานกลาง (Medium)</option>
                <option value={TaskPriority.LOW}>ทั่วไป (Low)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                สถานะงาน
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:border-slate-900 focus:outline-none"
              >
                <option value={TaskStatus.PENDING}>รอดำเนินการ</option>
                <option value={TaskStatus.IN_PROGRESS}>กำลังดำเนินการ</option>
                <option value={TaskStatus.COMPLETED}>เสร็จสิ้นแล้ว</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                แจ้งเตือนผ่าน LINE ล่วงหน้า
              </label>
              <select
                value={remindMinutesBefore}
                onChange={(e) => setRemindMinutesBefore(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:border-slate-900 focus:outline-none"
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

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
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
              <span>
                {endDate && endDate > date ? `${date} ถึง ${endDate}` : date}
              </span>
              <Clock className="h-3.5 w-3.5 ml-1" />
              <span>{time}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {editingTask ? 'บันทึกการแก้ไข' : 'บันทึกงานลงปฏิทิน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
