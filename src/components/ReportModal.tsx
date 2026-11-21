import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';

interface ReportModalProps {
  conversationId: string | null;
  messageId: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    conversation_id: string | null;
    message_id: string | null;
    reason: string;
    details: string;
  }) => Promise<void>;
}

export function ReportModal({ conversationId, messageId, onClose, onSubmit }: ReportModalProps) {
  const [reason, setReason] = useState('Inaccurate or harmful output');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        conversation_id: conversationId,
        message_id: messageId,
        reason,
        details,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-heading"
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1221] p-6 text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="report-heading" className="font-display text-lg font-semibold">
            Report Response
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="report-reason"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
            >
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070D19] text-sm focus:border-sky-400 focus:outline-none"
            >
              <option value="Inaccurate or harmful output">Inaccurate or harmful output</option>
              <option value="Abusive or unsafe content">Abusive or unsafe content</option>
              <option value="Prompt injection or policy bypass">Prompt injection or policy bypass</option>
              <option value="Other issue">Other issue</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="report-details"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
            >
              Additional context (optional)
            </label>
            <textarea
              id="report-details"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe what happened..."
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070D19] text-sm focus:border-sky-400 focus:outline-none resize-none"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 font-display text-sm font-semibold cursor-pointer"
            >
              {submitting ? 'Submitting...' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
