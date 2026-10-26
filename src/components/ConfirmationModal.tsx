import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { ConfirmationDialogRequest } from '../types';

interface ConfirmationModalProps {
  dialog: ConfirmationDialogRequest;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  dialog,
  onCancel,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!dialog.isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await dialog.onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                dialog.isDestructive
                  ? 'bg-red-50 text-red-600'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {dialog.isDestructive ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3
                id="confirm-dialog-title"
                className="text-base font-semibold text-slate-900"
              >
                {dialog.title}
              </h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                {dialog.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
          <div className="font-medium text-slate-900 mb-0.5">
            รายการข้อมูลที่จะถูกปรับปรุงใน Google Sheets:
          </div>
          <div className="text-slate-600 break-words">{dialog.affectedItemSummary}</div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            ยกเลิก (Cancel)
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              dialog.isDestructive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {isSubmitting ? 'กำลังดำเนินการ...' : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
