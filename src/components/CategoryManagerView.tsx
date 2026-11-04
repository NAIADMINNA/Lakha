import React, { useState } from 'react';
import { Edit3, FolderPlus, Plus, Trash2 } from 'lucide-react';
import { Category, Task, TaskStatus } from '../types';

interface CategoryManagerViewProps {
  categories: Category[];
  tasks: Task[];
  onSaveCategory: (category: Category, isNew: boolean) => void;
  onDeleteCategory: (category: Category) => void;
  onSyncCategoriesToTeam?: () => void;
}

const PRESET_COLORS = [
  '#2563EB', // Royal Blue
  '#0D9488', // Emerald Teal
  '#16A34A', // Emerald
  '#D97706', // Amber
  '#DC2626', // Crimson
  '#7C3AED', // Violet
  '#DB2777', // Pink
  '#0F172A', // Slate Dark
];

export const CategoryManagerView: React.FC<CategoryManagerViewProps> = ({
  categories,
  tasks,
  onSaveCategory,
  onDeleteCategory,
  onSyncCategoriesToTeam,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState('');

  const handleStartEdit = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setColor(cat.color);
    setDescription(cat.description || '');
  };

  const handleResetForm = () => {
    setEditingId(null);
    setName('');
    setColor(PRESET_COLORS[categories.length % PRESET_COLORS.length]);
    setDescription('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingId) {
      onSaveCategory(
        {
          id: editingId,
          name: name.trim(),
          color,
          description: description.trim(),
        },
        false
      );
    } else {
      onSaveCategory(
        {
          id: `cat-${Date.now()}`,
          name: name.trim(),
          color,
          description: description.trim(),
        },
        true
      );
    }
    handleResetForm();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 4 Columns: Create / Edit Category Form */}
      <div
        className={`lg:col-span-4 bg-white rounded-xl p-5 transition-all ${
          editingId
            ? 'border-2 border-indigo-600 ring-4 ring-indigo-500/15 shadow-sm'
            : 'border border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FolderPlus
              className={`h-4 w-4 ${editingId ? 'text-indigo-600' : 'text-slate-800'}`}
            />
            <h2 className="text-base font-semibold text-slate-900">
              {editingId ? 'กำลังแก้ไขหมวดหมู่งาน' : 'สร้างหมวดหมู่งานใหม่'}
            </h2>
          </div>
          {editingId && (
            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
              โหมดแก้ไข
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              ชื่อหมวดหมู่ (Category Name) *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น งานลูกค้า, โปรเจกต์หลัก, การเงิน..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              สีประจำหมวดหมู่ (แสดงในปฏิทินทีมและ LINE Flex Card)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColor(hex)}
                  className={`h-7 w-7 rounded-md border transition-transform ${
                    color.toLowerCase() === hex.toLowerCase()
                      ? 'scale-110 ring-2 ring-slate-900 ring-offset-1 border-white'
                      : 'border-slate-200 hover:scale-105'
                  }`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-9 rounded border border-slate-300 cursor-pointer bg-white p-0.5"
                title="เลือกสีเพิ่มเติม"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              คำอธิบายหมวดหมู่
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ระบุขอบเขตงานของหมวดหมู่นี้..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
            {editingId && (
              <button
                type="button"
                onClick={handleResetForm}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                ยกเลิกแก้ไข
              </button>
            )}
            <button
              type="submit"
              className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                editingId
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                {editingId
                  ? 'บันทึกการแก้ไขและอัปเดตปฏิทินทีม'
                  : 'เพิ่มหมวดหมู่งาน'}
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Right 8 Columns: Categories Table & Breakdown */}
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              หมวดหมู่งานทั้งหมด ({categories.length} หมวดหมู่)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              กดที่จุดสีเพื่อเปลี่ยนสีได้ทันที หรือกดปุ่ม &ldquo;แก้ไขชื่อ/สี&rdquo; เพื่อปรับข้อความและซิงค์เข้าปฏิทินของทีมอัตโนมัติ
            </p>
          </div>
          {onSyncCategoriesToTeam && (
            <button
              type="button"
              onClick={onSyncCategoriesToTeam}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
            >
              <span>🔄 ซิงค์หมวดหมู่และสีไปที่ปฏิทินทีมทันที</span>
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">หมวดหมู่งาน (คลิกสีเพื่อเปลี่ยนได้ทันที)</th>
                <th className="py-3 px-4">รายละเอียด</th>
                <th className="py-3 px-4 text-right">งานทั้งหมด</th>
                <th className="py-3 px-4 text-right">ค้าง / เสร็จแล้ว</th>
                <th className="py-3 px-4 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-xs text-slate-500">
                    ยังไม่มีหมวดหมู่งาน — สร้างหมวดหมู่งานใหม่จากฟอร์มด้านซ้ายได้เลย
                  </td>
                </tr>
              ) : (
                categories.map((cat) => {
                  const catTasks = tasks.filter((t) => t.categoryId === cat.id);
                  const doneCount = catTasks.filter(
                    (t) => t.status === TaskStatus.COMPLETED
                  ).length;
                  const pendingCount = catTasks.length - doneCount;
                  const isBeingEdited = editingId === cat.id;

                  return (
                    <tr
                      key={cat.id}
                      className={`transition-colors ${
                        isBeingEdited ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <label
                            className="relative inline-flex items-center cursor-pointer shrink-0"
                            title="คลิกเพื่อเปลี่ยนสีหมวดหมู่นี้ทันที"
                          >
                            <input
                              type="color"
                              value={cat.color}
                              onChange={(e) => {
                                const newColor = e.target.value;
                                if (editingId === cat.id) {
                                  setColor(newColor);
                                }
                                onSaveCategory(
                                  {
                                    ...cat,
                                    color: newColor,
                                  },
                                  false
                                );
                              }}
                              className="sr-only"
                            />
                            <span
                              className="h-5 w-5 rounded-md border border-black/15 shadow-2xs transition-transform hover:scale-110"
                              style={{ backgroundColor: cat.color }}
                            />
                          </label>
                          <div>
                            <div className="font-semibold text-slate-900">{cat.name}</div>
                            <div className="text-[11px] font-mono-tabular text-slate-400">
                              {cat.color}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs">
                        {cat.description || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                        {catTasks.length}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-xs text-slate-600">
                        <span>ค้าง {pendingCount}</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="text-emerald-700 font-medium">เสร็จ {doneCount}</span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(cat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                            title="แก้ไขชื่อและสีหมวดหมู่"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>แก้ไขชื่อ/สี</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteCategory(cat)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="ลบหมวดหมู่"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
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
  );
};
