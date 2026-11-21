import { FormEvent, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { OpenRouterTestResult, UserProfile, UserSettings } from '../types';

interface SettingsModalProps {
  user: UserProfile;
  settings: UserSettings;
  onClose: () => void;
  onSave: (payload: {
    full_name: string;
    theme: 'dark' | 'light';
  }) => Promise<void>;
  onTestConnection: () => Promise<OpenRouterTestResult>;
}

export function SettingsModal({
  user,
  settings,
  onClose,
  onSave,
  onTestConnection,
}: SettingsModalProps) {
  const [fullName, setFullName] = useState(user.full_name || '');
  const [theme, setTheme] = useState<'dark' | 'light'>(settings.theme || 'dark');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OpenRouterTestResult | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        full_name: fullName.trim(),
        theme,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection();
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        connected: false,
        latency_ms: 0,
        detail: err?.message || 'Connection test request failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1221] p-6 text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 id="settings-heading" className="font-display text-lg font-semibold">
            Account & Preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Account email
            </label>
            <div className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#070D19] flex items-center text-sm text-slate-600 dark:text-slate-400">
              {user.email}
            </div>
          </div>

          <div>
            <label
              htmlFor="settings-name"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
            >
              Full name
            </label>
            <input
              id="settings-name"
              type="text"
              maxLength={120}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070D19] text-sm focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="settings-theme"
              className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
            >
              Interface theme
            </label>
            <select
              id="settings-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value === 'light' ? 'light' : 'dark')}
              className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070D19] text-sm focus:border-sky-400 focus:outline-none"
            >
              <option value="dark">Dark Navy</option>
              <option value="light">Light Slate</option>
            </select>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                AI Service Connection
              </span>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:border-sky-400 disabled:opacity-50 cursor-pointer"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            {testResult && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs ${
                  testResult.connected
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                }`}
              >
                {testResult.connected ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                )}
                <div>
                  <div className="font-medium">
                    {testResult.connected ? 'Connected' : 'Connection failed'}
                    {testResult.latency_ms > 0 ? ` · ${testResult.latency_ms} ms` : ''}
                  </div>
                  <div className="mt-0.5 opacity-90">{testResult.detail}</div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 font-display text-sm font-semibold cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save preferences'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
