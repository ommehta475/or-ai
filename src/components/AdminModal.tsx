import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AdminOverview } from '../types';

interface AdminModalProps {
  accessToken: string;
  onClose: () => void;
}

export function AdminModal({ accessToken, onClose }: AdminModalProps) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<'users' | 'reports' | 'errors' | 'usage'>('users');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOverview = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(json.detail || 'Unable to load moderation overview.');
      }
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const toggleUserStatus = async (userId: string, currentStatus: 'active' | 'suspended') => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const resp = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (resp.ok) {
      await loadOverview();
    } else {
      const err = await resp.json().catch(() => ({}));
      setError(err.detail || 'Unable to update user status.');
    }
  };

  const updateReport = async (reportId: string, status: 'reviewed' | 'dismissed') => {
    const resp = await fetch(`/api/admin/reports/${reportId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });
    if (resp.ok) {
      await loadOverview();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-heading"
        className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B1221] text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 id="admin-heading" className="font-display text-lg font-semibold">
              Moderation & Operations
            </h2>
            <p className="text-xs text-slate-500">
              Restricted administrator console for user status, usage, error logs, and reports.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close admin console"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 dark:border-slate-800">
          {(['users', 'reports', 'errors', 'usage'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                tab === key
                  ? 'bg-sky-400 text-slate-950 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {key === 'reports' ? 'Abuse Reports' : key === 'errors' ? 'Error Logs' : key}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="text-sm text-slate-400">Loading moderation records...</div>}
          {error && (
            <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          )}

          {!loading && !error && data && tab === 'users' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs text-slate-500">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right tabular-nums">Messages</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-200/60 dark:border-slate-800/60">
                      <td className="py-2.5 pr-4">
                        <div className="font-medium">{u.full_name || 'Unnamed'}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-2.5 pr-4 text-xs capitalize">{u.role}</td>
                      <td className="py-2.5 pr-4 text-xs capitalize">{u.status}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        {u.message_count}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleUserStatus(u.id, u.status)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:border-sky-400 cursor-pointer"
                        >
                          {u.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && data && tab === 'reports' && (
            <div className="space-y-3">
              {data.abuse_reports.length === 0 && (
                <div className="text-sm text-slate-500">No abuse reports submitted.</div>
              )}
              {data.abuse_reports.map((rep) => (
                <div
                  key={rep.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="text-sm font-medium">{rep.reason}</div>
                    {rep.details && <p className="mt-1 text-xs text-slate-400">{rep.details}</p>}
                    <div className="mt-2 text-xs text-slate-500">
                      Status: {rep.status} · {new Date(rep.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateReport(rep.id, 'reviewed')}
                      className="px-2.5 py-1 rounded-lg border border-slate-700 text-xs hover:border-sky-400 cursor-pointer"
                    >
                      Mark reviewed
                    </button>
                    <button
                      type="button"
                      onClick={() => updateReport(rep.id, 'dismissed')}
                      className="px-2.5 py-1 rounded-lg border border-slate-700 text-xs hover:border-slate-500 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && data && tab === 'errors' && (
            <div className="space-y-2">
              {data.error_logs.length === 0 && (
                <div className="text-sm text-slate-500">No backend error logs recorded.</div>
              )}
              {data.error_logs.map((errLog) => (
                <div
                  key={errLog.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs"
                >
                  <div className="font-mono text-rose-400">
                    {errLog.error_type} · {errLog.endpoint}
                  </div>
                  <div className="mt-1 text-slate-300">{errLog.message}</div>
                  <div className="mt-1 text-slate-500">
                    {new Date(errLog.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && data && tab === 'usage' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                    <th className="py-2 pr-4">Model</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right tabular-nums">Latency (ms)</th>
                    <th className="py-2 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usage_logs.map((log) => (
                    <tr key={log.id} className="border-b border-slate-200/60 dark:border-slate-800/60">
                      <td className="py-2 pr-4 font-mono">{log.model}</td>
                      <td className="py-2 pr-4 capitalize">{log.status}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {log.latency_ms}
                      </td>
                      <td className="py-2 text-right text-slate-500 tabular-nums">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
