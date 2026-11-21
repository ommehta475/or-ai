/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  FormEvent,
  KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import {
  AlertCircle,
  Check,
  Copy,
  Flag,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { AuthMode, AuthScreen } from './components/AuthScreen';
import { MarkdownMessage } from './components/MarkdownMessage';
import { OrlixaMark } from './components/OrlixaMark';

const AdminModal = lazy(() =>
  import('./components/AdminModal').then((m) => ({ default: m.AdminModal }))
);
const ReportModal = lazy(() =>
  import('./components/ReportModal').then((m) => ({ default: m.ReportModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
import {
  ChatMessage,
  Conversation,
  HealthStatus,
  OpenRouterTestResult,
  PublicConfig,
  UsageLimits,
  UserProfile,
  UserSettings,
} from './types';

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    return hash.get('type') === 'recovery' || query.get('type') === 'recovery'
      ? 'recovery'
      : 'login';
  });

  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    theme: 'dark',
  });
  const [limits, setLimits] = useState<UsageLimits>({
    max_message_length: 4000,
    max_output_tokens: 2048,
  });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState('');

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    conversationId: string | null;
    messageId: string | null;
  } | null>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync Tailwind dark class with user theme preference
  useEffect(() => {
    const isDark = settings.theme !== 'light';
    document.documentElement.classList.toggle('dark', isDark);
  }, [settings.theme]);

  // Bootstrap config + non-blocking health
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    fetch('/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h: HealthStatus | null) => {
        if (active && h) setHealth(h);
      })
      .catch(() => {});

    async function init() {
      try {
        const preloaded = (window as unknown as { __ORLIXA_CONFIG__?: PublicConfig })
          .__ORLIXA_CONFIG__;
        const cfg: PublicConfig = preloaded
          ? preloaded
          : await fetch('/api/config').then((r) => r.json());
        if (!active) return;
        setConfig(cfg);

        if (cfg.supabaseConfigured) {
          const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          });
          setSupabase(client);

          const { data } = await client.auth.getSession();
          if (active) {
            setSession(data.session ?? null);
            setAuthReady(true);
          }

          const { data: sub } = client.auth.onAuthStateChange((event, nextSession) => {
            if (event === 'PASSWORD_RECOVERY') {
              setAuthMode('recovery');
            }
            setSession(nextSession ?? null);
          });

          unsubscribe = () => sub.subscription.unsubscribe();
        } else {
          setAuthReady(true);
        }
      } catch {
        if (active) {
          setConfig({
            supabaseConfigured: false,
            supabaseUrl: '',
            supabaseAnonKey: '',
            openrouterConfigured: false,
          });
          setAuthReady(true);
        }
      }
    }
    init();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const authFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      if (!session?.access_token) {
        throw new Error('Authentication required.');
      }
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${session.access_token}`);
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      const resp = await fetch(path, { ...options, headers });
      if (resp.status === 401 && supabase) {
        await supabase.auth.signOut();
        setSession(null);
        throw new Error('Session expired. Please sign in again.');
      }
      return resp;
    },
    [session, supabase]
  );

  const loadWorkspaceData = useCallback(async () => {
    if (!session) return;
    try {
      const [meResp, convResp] = await Promise.all([
        authFetch('/api/me'),
        authFetch('/api/conversations'),
      ]);

      if (!meResp.ok) {
        const err = await meResp.json().catch(() => ({}));
        throw new Error(err.detail || 'Unable to load your ORLIXA AI profile.');
      }
      const meData = await meResp.json();
      setUser(meData.user);
      if (meData.settings) setSettings(meData.settings);
      if (meData.limits) setLimits(meData.limits);

      if (convResp.ok) {
        const convData = await convResp.json();
        setConversations(convData.conversations || []);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to initialize workspace.');
    }
  }, [authFetch, session]);

  useEffect(() => {
    if (session && authMode !== 'recovery') {
      loadWorkspaceData();
    } else if (!session) {
      setUser(null);
      setConversations([]);
      setMessages([]);
      setActiveConversationId(null);
    }
  }, [session, authMode, loadWorkspaceData]);

  // Smart auto-scroll
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < 80;
  };

  const refreshConversations = async () => {
    const resp = await authFetch('/api/conversations');
    if (resp.ok) {
      const data = await resp.json();
      setConversations(data.conversations || []);
    }
  };

  const selectConversation = async (conversationId: string) => {
    setErrorBanner('');
    try {
      const resp = await authFetch(`/api/conversations/${conversationId}`);
      if (!resp.ok) {
        throw new Error('Unable to load conversation.');
      }
      const data = await resp.json();
      setActiveConversationId(conversationId);
      setMessages(data.messages || []);
      autoScrollRef.current = true;
      setMobileSidebarOpen(false);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to load conversation.');
    }
  };

  const handleNewChat = () => {
    if (isGenerating) return;
    setErrorBanner('');
    setActiveConversationId(null);
    setMessages([]);
    setMobileSidebarOpen(false);
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      const resp = await authFetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!resp.ok) throw new Error('Delete failed.');
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch {
      setErrorBanner('Failed to delete conversation.');
    }
  };

  const consumeSse = async (resp: Response, draftId: string) => {
    if (!resp.body) throw new Error('Empty streaming response.');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const lines = block.split('\n');
        let eventName = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        const payload = JSON.parse(dataStr);

        if (eventName === 'meta') {
          if (payload.conversation?.id) {
            setActiveConversationId(payload.conversation.id);
          }
          if (payload.user_message?.id) {
            setMessages((prev) =>
              prev.map((m) => (m.id.startsWith('local-u-') ? payload.user_message : m))
            );
          }
        } else if (eventName === 'token') {
          const token = payload.token || '';
          setMessages((prev) =>
            prev.map((m) => (m.id === draftId ? { ...m, content: m.content + token } : m))
          );
        } else if (eventName === 'done') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === draftId
                ? {
                    ...m,
                    id: payload.assistant_message?.id || m.id,
                    streaming: false,
                  }
                : m
            )
          );
          await refreshConversations();
        } else if (eventName === 'error') {
          setErrorBanner(payload.error || 'Inference server error.');
          setMessages((prev) =>
            prev.map((m) => (m.id === draftId ? { ...m, streaming: false } : m))
          );
        }
      }
    }
  };

  const sendMessage = async (rawPrompt: string) => {
    if (isGenerating) return;
    const trimmed = rawPrompt.trim();
    if (!trimmed) return;
    if (trimmed.length > limits.max_message_length) {
      setErrorBanner(`Message exceeds maximum length of ${limits.max_message_length} characters.`);
      return;
    }

    setErrorBanner('');
    autoScrollRef.current = true;
    const userDraftId = `local-u-${Date.now()}`;
    const assistantDraftId = `local-a-${Date.now() + 1}`;

    setMessages((prev) => [
      ...prev,
      { id: userDraftId, role: 'user', content: trimmed },
      { id: assistantDraftId, role: 'assistant', content: '', streaming: true },
    ]);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsGenerating(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resp = await authFetch('/api/chat/stream', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          conversation_id: activeConversationId,
          message: trimmed,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || `Request failed with status ${resp.status}`);
      }

      await consumeSse(resp, assistantDraftId);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorBanner(err?.message || 'Unable to generate response.');
      }
      setMessages((prev) =>
        prev
          .map((m) => (m.id === assistantDraftId ? { ...m, streaming: false } : m))
          .filter((m) => !(m.id === assistantDraftId && !m.content))
      );
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleRetry = async (assistantMessageId: string) => {
    if (isGenerating || !activeConversationId) return;
    setErrorBanner('');
    autoScrollRef.current = true;
    const draftId = `local-a-${Date.now()}`;

    setMessages((prev) => [
      ...prev.filter((m) => m.id !== assistantMessageId),
      { id: draftId, role: 'assistant', content: '', streaming: true },
    ]);
    setIsGenerating(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resp = await authFetch('/api/chat/stream', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          conversation_id: activeConversationId,
          retry: true,
          assistant_message_id: assistantMessageId,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Retry request failed.');
      }

      await consumeSse(resp, draftId);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setErrorBanner(err?.message || 'Retry failed.');
      }
      setMessages((prev) =>
        prev
          .map((m) => (m.id === draftId ? { ...m, streaming: false } : m))
          .filter((m) => !(m.id === draftId && !m.content))
      );
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleStop = async () => {
    if (!isGenerating) return;
    if (activeConversationId) {
      authFetch('/api/chat/stop', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: activeConversationId }),
      }).catch(() => {});
    }
    abortControllerRef.current?.abort();
    setIsGenerating(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  };

  const handleCopyMessage = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSaveSettings = async (payload: {
    full_name: string;
    theme: 'dark' | 'light';
  }) => {
    const resp = await authFetch('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const updated = await resp.json();
      if (updated.user) setUser((prev) => (prev ? { ...prev, ...updated.user } : updated.user));
      if (updated.settings) setSettings(updated.settings);
    }
  };

  const handleSubmitReport = async (payload: {
    conversation_id: string | null;
    message_id: string | null;
    reason: string;
    details: string;
  }) => {
    const resp = await authFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      setReportNotice('Report submitted to Orlixa Labs moderation.');
      setTimeout(() => setReportNotice(''), 3500);
    }
  };

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setAuthMode('login');
  };

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  if (!authReady || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060B16] text-slate-300 text-sm">
        Initializing ORLIXA AI...
      </div>
    );
  }

  if (!session || authMode === 'recovery') {
    return (
      <AuthScreen
        supabase={supabase}
        config={config}
        mode={authMode}
        onModeChange={setAuthMode}
        onRecovered={() => {
          setAuthMode('login');
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#060B16] text-slate-900 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/70 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        aria-label="Conversations sidebar"
        className={`fixed inset-y-0 left-0 z-40 w-[272px] shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-800/80 bg-slate-100 dark:bg-[#091020] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/70">
          <div className="flex items-center gap-2.5">
            <OrlixaMark size={24} />
            <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
              ORLIXA AI
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close navigation"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white lg:hidden cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-[#0F172A] hover:border-sky-400/70 text-sm font-display font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 text-sky-400" />
            <span>New Chat</span>
          </button>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              aria-label="Search conversations"
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#070D19] text-xs placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="px-4 py-1 text-xs font-medium text-slate-500">Conversations</div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {filteredConversations.length === 0 ? (
            <div className="px-3 py-6 text-xs text-slate-500">
              {searchQuery ? 'No matching conversations.' : 'Your conversations will appear here.'}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') selectConversation(conv.id);
                  }}
                  className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 text-slate-900 dark:text-white font-medium'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {user?.full_name || session.user.email}
            </div>
            <div className="text-xs text-slate-500 truncate">{session.user.email}</div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setAdminOpen(true)}
                title="Moderation Console"
                aria-label="Open moderation console"
                className="p-2 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Shield className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Preferences"
              aria-label="Open settings"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Pane */}
      <main className="flex-1 flex flex-col min-w-0 h-full">
        <header className="h-14 shrink-0 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
              className="p-2 -ml-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white lg:hidden cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-sm sm:text-base font-semibold truncate">
              {activeConversation ? activeConversation.title : 'ORLIXA AI'}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0 whitespace-nowrap">
            {health && !health.openrouter_configured && (
              <span className="text-amber-500 dark:text-amber-300 font-medium">
                API unconfigured
              </span>
            )}
          </div>
        </header>

        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
        >
          <div className="max-w-3xl mx-auto">
            {health && !health.openrouter_configured && messages.length === 0 && (
              <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <div className="font-medium">OpenRouter API is not configured</div>
                  <p className="mt-1 text-xs opacity-90">
                    Set <code className="font-mono">OPENROUTER_API_KEY</code> and{' '}
                    <code className="font-mono">OPENROUTER_MODEL</code> in server environment
                    secrets before sending prompts. You can also test live connectivity from
                    Settings.
                  </p>
                </div>
              </div>
            )}

            {messages.length === 0 ? (
              <div className="min-h-[calc(100vh-14rem)] flex flex-col items-center justify-center text-center py-12">
                <div className="flex items-center gap-3">
                  <OrlixaMark size={32} />
                  <span className="font-display text-lg font-bold tracking-tight">ORLIXA AI</span>
                </div>

                <h2 className="mt-6 font-display text-3xl sm:text-4xl font-bold tracking-tight leading-[1.15] [text-wrap:balance]">
                  Hello,{' '}
                  {user?.full_name?.trim() ||
                    (session.user.user_metadata?.full_name as string | undefined)?.trim() ||
                    session.user.email?.split('@')[0] ||
                    'there'}
                </h2>
                <p className="mt-3 text-base sm:text-lg text-slate-600 dark:text-slate-400">
                  What can I help you with?
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800/70">
                {messages.map((msg, idx) => {
                  const isLastAssistant =
                    msg.role === 'assistant' && idx === messages.length - 1 && !msg.streaming;
                  return (
                    <article key={msg.id} className="py-5">
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`font-display text-xs font-semibold ${
                            msg.role === 'assistant'
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {msg.role === 'assistant' ? 'ORLIXA AI' : user?.full_name || 'You'}
                        </span>
                      </div>

                      {msg.role === 'assistant' ? (
                        msg.streaming && !msg.content ? (
                          <div className="text-sm text-slate-400">Generating response...</div>
                        ) : (
                          <MarkdownMessage content={msg.content} />
                        )
                      ) : (
                        <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                          {msg.content}
                        </div>
                      )}

                      {msg.role === 'assistant' && !msg.streaming && msg.content && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:border-sky-400/60 cursor-pointer"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {isLastAssistant && !isGenerating && (
                            <button
                              type="button"
                              onClick={() => handleRetry(msg.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:border-sky-400/60 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Retry</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setReportTarget({
                                conversationId: activeConversationId,
                                messageId: msg.id.startsWith('local-') ? null : msg.id,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 cursor-pointer"
                          >
                            <Flag className="w-3.5 h-3.5" />
                            <span>Report</span>
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Composer */}
        <div className="shrink-0 px-4 sm:px-6 pt-3 pb-4 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#060B16]">
          <div className="max-w-3xl mx-auto">
            {errorBanner && (
              <div
                role="alert"
                className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{errorBanner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorBanner('')}
                  aria-label="Dismiss error"
                  className="text-rose-400 hover:text-rose-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {reportNotice && (
              <div
                role="status"
                className="mb-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-700 dark:text-emerald-200"
              >
                {reportNotice}
              </div>
            )}

            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                sendMessage(inputText);
              }}
              className="flex items-end gap-2.5 rounded-2xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-[#0B1221] p-2.5 focus-within:border-sky-400"
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                }}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(inputText);
                  }
                }}
                placeholder="Message ORLIXA AI..."
                aria-label="Message input"
                className="flex-1 bg-transparent px-2 py-1.5 text-[15px] leading-relaxed resize-none max-h-[180px] focus:outline-none placeholder:text-slate-500"
              />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="h-10 px-4 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-200 font-display text-sm font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="h-10 px-4 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-45 disabled:cursor-not-allowed text-slate-950 font-display text-sm font-semibold inline-flex items-center gap-2 shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              )}
            </form>

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>Enter to send · Shift+Enter for new line</span>
              <span className="font-mono tabular-nums">
                {inputText.length} / {limits.max_message_length}
              </span>
            </div>
          </div>
        </div>
      </main>

      <Suspense fallback={null}>
        {settingsOpen && user && (
          <SettingsModal
            user={user}
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={handleSaveSettings}
            onTestConnection={async (): Promise<OpenRouterTestResult> => {
              const resp = await authFetch('/api/chat/test', { method: 'POST' });
              const json = await resp.json().catch(() => ({}));
              if (!resp.ok && !('connected' in json)) {
                throw new Error(json.detail || 'Connection test failed.');
              }
              return json;
            }}
          />
        )}

        {reportTarget && (
          <ReportModal
            conversationId={reportTarget.conversationId}
            messageId={reportTarget.messageId}
            onClose={() => setReportTarget(null)}
            onSubmit={handleSubmitReport}
          />
        )}

        {adminOpen && user?.role === 'admin' && (
          <AdminModal accessToken={session.access_token} onClose={() => setAdminOpen(false)} />
        )}
      </Suspense>
    </div>
  );
}
