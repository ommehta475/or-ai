import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_CANDIDATES = [
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env.production'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, 'backend/.env'),
];
const foundEnvFiles = ENV_CANDIDATES.filter((p) => fs.existsSync(p));
for (const envPath of foundEnvFiles) {
  dotenv.config({ path: envPath, override: false });
}

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
)
  .trim()
  .replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = (
  process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'
).trim();
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
  .trim()
  .replace(/\/+$/, '');
const OPENROUTER_SITE_URL = (process.env.OPENROUTER_SITE_URL || process.env.APP_URL || '').trim();
const OPENROUTER_APP_NAME = (process.env.OPENROUTER_APP_NAME || 'ORLIXA AI').trim();

const rawTemp = Number(process.env.AI_TEMPERATURE ?? 0.7);
const AI_TEMPERATURE = Number.isFinite(rawTemp) ? Math.min(2, Math.max(0, rawTemp)) : 0.7;
const RATE_LIMIT_RPM = Math.max(1, Number(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || 20));
const MAX_MESSAGE_LENGTH = Math.max(100, Number(process.env.MAX_MESSAGE_LENGTH || 4000));
const MAX_OUTPUT_TOKENS = Math.max(64, Number(process.env.MAX_OUTPUT_TOKENS || 2048));
const MAX_CONTEXT_MESSAGES = Math.max(2, Number(process.env.MAX_CONTEXT_MESSAGES || 20));
const AI_TIMEOUT_MS = Math.max(10000, Number(process.env.AI_REQUEST_TIMEOUT_SECONDS || 120) * 1000);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function isValidSupabaseUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.includes('your-project-ref')) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' && Boolean(parsed.hostname)) return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isValidSupabaseKey(rawKey: string): boolean {
  if (
    !rawKey ||
    rawKey.includes('your-supabase-anon') ||
    rawKey.includes('your-supabase-service-role')
  ) {
    return false;
  }
  if (rawKey.startsWith('sb_publishable_') || rawKey.startsWith('sb_secret_')) {
    return rawKey.length > 20;
  }
  const parts = rawKey.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function isValidOpenRouterBaseUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

const supabaseUrlValid = isValidSupabaseUrl(SUPABASE_URL);
const supabaseAnonKeyValid = isValidSupabaseKey(SUPABASE_ANON_KEY);
const supabaseServiceRoleConfigured = isValidSupabaseKey(SUPABASE_SERVICE_ROLE_KEY);
const isSupabaseConfigured = supabaseUrlValid && supabaseAnonKeyValid;

const openrouterApiKeyPresent =
  Boolean(OPENROUTER_API_KEY) && !OPENROUTER_API_KEY.toLowerCase().includes('your-openrouter');
const openrouterModelConfigured = Boolean(OPENROUTER_MODEL);
const openrouterBaseUrlValid = isValidOpenRouterBaseUrl(OPENROUTER_BASE_URL);
const isOpenRouterConfigured =
  openrouterApiKeyPresent && openrouterModelConfigured && openrouterBaseUrlValid;

let supabaseServerClient: SupabaseClient | null = null;
if (isSupabaseConfigured) {
  try {
    supabaseServerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    supabaseServerClient = null;
  }
}

interface AuthenticatedUser {
  id: string;
  email: string;
  accessToken: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  profile: Record<string, any>;
}

interface AuthedRequest extends Request {
  authUser?: AuthenticatedUser;
}

const rateBuckets = new Map<string, number[]>();
const activeControllers = new Map<string, AbortController>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const cutoff = now - windowMs;
  const bucket = (rateBuckets.get(userId) || []).filter((ts) => ts > cutoff);
  if (bucket.length >= RATE_LIMIT_RPM) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket[0] + windowMs - now) / 1000));
    rateBuckets.set(userId, bucket);
    return { allowed: false, retryAfterSec };
  }
  bucket.push(now);
  rateBuckets.set(userId, bucket);
  return { allowed: true };
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function deriveTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New Conversation';
  return cleaned.length <= 52 ? cleaned : `${cleaned.slice(0, 49).trimEnd()}...`;
}

async function supabaseRest(
  method: string,
  tablePath: string,
  accessToken: string,
  body?: unknown,
  useServiceRole = false,
  prefer = 'return=representation'
): Promise<any> {
  const apiKey = useServiceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const authToken = useServiceRole ? SUPABASE_SERVICE_ROLE_KEY : accessToken;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tablePath}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supabase REST ${resp.status}: ${errText.slice(0, 200)}`);
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

async function logErrorSafe(userId: string | null, endpoint: string, errorType: string, message: string) {
  if (!isSupabaseConfigured || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await supabaseRest(
      'POST',
      'error_logs',
      '',
      {
        user_id: userId,
        endpoint: endpoint.slice(0, 120),
        error_type: errorType.slice(0, 80),
        message: message.slice(0, 500),
      },
      true,
      'return=minimal'
    );
  } catch {
    // Do not throw from error logging
  }
}

function resolveModelName(preferredModel?: string | null): string {
  const candidate = (preferredModel || '').trim();
  if (!candidate || candidate === 'Qwen3-4B') {
    return OPENROUTER_MODEL;
  }
  return candidate;
}

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (OPENROUTER_SITE_URL && !OPENROUTER_SITE_URL.includes('MY_APP_URL')) {
    headers['HTTP-Referer'] = OPENROUTER_SITE_URL;
  }
  if (OPENROUTER_APP_NAME) {
    headers['X-Title'] = OPENROUTER_APP_NAME;
  }
  return headers;
}

function mapOpenRouterHttpError(
  status: number,
  rawBody: string,
  modelName: string
): { message: string; code: string } {
  let upstreamMsg = '';
  try {
    const parsed = JSON.parse(rawBody);
    const msg = parsed?.error?.message;
    if (typeof msg === 'string') {
      upstreamMsg = msg.trim().slice(0, 240);
    }
  } catch {
    // Ignore non-JSON upstream errors
  }

  if (status === 401 || status === 403) {
    return {
      message: 'OpenRouter authentication failed. Verify OPENROUTER_API_KEY on the backend.',
      code: 'OPENROUTER_AUTH_ERROR',
    };
  }
  if (status === 402) {
    return {
      message: 'Insufficient OpenRouter credits. Please add credits to your OpenRouter account.',
      code: 'INSUFFICIENT_CREDITS',
    };
  }
  if (status === 404 || (status === 400 && upstreamMsg.toLowerCase().includes('model'))) {
    return {
      message: 'Configured OpenRouter model is invalid or unavailable. Check OPENROUTER_MODEL on the backend.',
      code: 'INVALID_MODEL',
    };
  }
  if (status === 429) {
    return {
      message: 'OpenRouter rate limit exceeded. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
    };
  }
  if (status >= 500) {
    return {
      message: 'OpenRouter upstream service is temporarily unavailable.',
      code: 'UPSTREAM_UNAVAILABLE',
    };
  }
  return {
    message: upstreamMsg
      ? `OpenRouter rejected the request (HTTP ${status}): ${upstreamMsg}`
      : `OpenRouter rejected the request (HTTP ${status}).`,
    code: 'OPENROUTER_REQUEST_ERROR',
  };
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured) {
    res.status(503).json({
      detail: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in environment secrets.',
    });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ detail: 'Missing or invalid Authorization Bearer token.' });
    return;
  }

  const token = match[1].trim();
  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!userResp.ok) {
      res.status(401).json({ detail: 'Invalid or expired Supabase session.' });
      return;
    }

    const authPayload: any = await userResp.json();
    const userId = authPayload.id;
    const email = authPayload.email || '';

    const rows = await supabaseRest(
      'GET',
      `profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      token
    ).catch(() => []);
    const profile = rows?.[0] || {
      id: userId,
      email,
      full_name: authPayload.user_metadata?.full_name || '',
      role: 'user',
      status: 'active',
      message_count: 0,
    };

    if (profile.status === 'suspended') {
      res.status(403).json({ detail: 'Your account has been suspended by an administrator.' });
      return;
    }

    req.authUser = {
      id: userId,
      email,
      accessToken: token,
      role: profile.role === 'admin' ? 'admin' : 'user',
      status: profile.status === 'suspended' ? 'suspended' : 'active',
      profile,
    };
    next();
  } catch {
    res.status(503).json({ detail: 'Unable to verify session with Supabase Auth.' });
  }
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.authUser?.role !== 'admin') {
    res.status(403).json({ detail: 'Administrator privileges required.' });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Strict CORS restricted to configured origins (plus same-origin requests)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const normalized = origin.replace(/\/+$/, '');
      const hostOrigin = req.headers.host ? `${req.protocol}://${req.headers.host}` : '';
      const isAllowed =
        ALLOWED_ORIGINS.includes(normalized) ||
        normalized === hostOrigin ||
        normalized === (process.env.APP_URL || '').replace(/\/+$/, '');

      if (isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      service: 'orlixa-ai',
      provider: 'Orlixa Labs',
      env_file_found: foundEnvFiles.length > 0,
      supabase_url_valid: supabaseUrlValid,
      supabase_anon_key_valid: supabaseAnonKeyValid,
      supabase_service_role_configured: supabaseServiceRoleConfigured,
      supabase_client_initialized: supabaseServerClient !== null,
      supabase_configured: isSupabaseConfigured,
      openrouter_api_key_present: openrouterApiKeyPresent,
      openrouter_model_configured: openrouterModelConfigured,
      openrouter_base_url_valid: openrouterBaseUrlValid,
      openrouter_configured: isOpenRouterConfigured,
    });
  });

  app.get('/api/boot.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const publicConfig = {
      supabaseConfigured: isSupabaseConfigured,
      supabaseUrl: isSupabaseConfigured ? SUPABASE_URL : '',
      supabaseAnonKey: isSupabaseConfigured ? SUPABASE_ANON_KEY : '',
      openrouterConfigured: isOpenRouterConfigured,
    };
    res.send(`window.__ORLIXA_CONFIG__ = ${JSON.stringify(publicConfig)};`);
  });

  app.get('/api/config', async (_req, res) => {
    res.json({
      supabaseConfigured: isSupabaseConfigured,
      supabaseUrl: isSupabaseConfigured ? SUPABASE_URL : '',
      supabaseAnonKey: isSupabaseConfigured ? SUPABASE_ANON_KEY : '',
      openrouterConfigured: isOpenRouterConfigured,
    });
  });

  app.post('/api/chat/test', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const rate = checkRateLimit(user.id);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec || 10));
      res.status(429).json({
        connected: false,
        detail: `Rate limit exceeded. Try again in ${rate.retryAfterSec} seconds.`,
      });
      return;
    }

    if (!openrouterApiKeyPresent) {
      res.json({
        connected: false,
        latency_ms: 0,
        code: 'OPENROUTER_NOT_CONFIGURED',
        detail: 'OPENROUTER_API_KEY is missing on the backend.',
      });
      return;
    }
    if (!openrouterModelConfigured) {
      res.json({
        connected: false,
        latency_ms: 0,
        code: 'MODEL_NOT_CONFIGURED',
        detail: 'OPENROUTER_MODEL is missing on the backend.',
      });
      return;
    }
    if (!openrouterBaseUrlValid) {
      res.json({
        connected: false,
        latency_ms: 0,
        code: 'OPENROUTER_CONFIG_ERROR',
        detail: 'OPENROUTER_BASE_URL must be a valid HTTPS URL.',
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: openRouterHeaders(),
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 1,
          temperature: 0,
          stream: false,
        }),
      });
      const latencyMs = Date.now() - startedAt;

      if (!resp.ok) {
        const rawBody = await resp.text().catch(() => '');
        const mapped = mapOpenRouterHttpError(resp.status, rawBody, OPENROUTER_MODEL);
        res.json({
          connected: false,
          latency_ms: latencyMs,
          status_code: resp.status,
          code: mapped.code,
          detail: mapped.message,
        });
        return;
      }

      const data: any = await resp.json().catch(() => null);
      if (!data?.choices?.length) {
        res.json({
          connected: false,
          latency_ms: latencyMs,
          code: 'EMPTY_RESPONSE',
          detail: 'OpenRouter returned an empty completion response.',
        });
        return;
      }

      res.json({
        connected: true,
        latency_ms: latencyMs,
        detail: 'AI service connection test succeeded.',
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      res.json({
        connected: false,
        latency_ms: Date.now() - startedAt,
        code: isTimeout ? 'TIMEOUT' : 'OPENROUTER_UNREACHABLE',
        detail: isTimeout
          ? 'OpenRouter connection test timed out.'
          : 'Unable to reach OpenRouter API.',
      });
    }
  });

  app.get('/api/me', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    try {
      let settingsRows = await supabaseRest(
        'GET',
        `user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=*`,
        user.accessToken
      );
      if (!settingsRows || settingsRows.length === 0) {
        settingsRows = await supabaseRest('POST', 'user_settings', user.accessToken, {
          user_id: user.id,
          theme: 'dark',
          preferred_model: '',
        });
      }
      const userTheme = settingsRows?.[0]?.theme === 'light' ? 'light' : 'dark';
      res.json({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.profile.full_name || '',
          avatar_url: user.profile.avatar_url || null,
          role: user.role,
          status: user.status,
          message_count: user.profile.message_count || 0,
        },
        settings: {
          id: settingsRows?.[0]?.id,
          user_id: settingsRows?.[0]?.user_id,
          theme: userTheme,
        },
        limits: {
          max_message_length: MAX_MESSAGE_LENGTH,
          max_output_tokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch {
      res.status(502).json({ detail: 'Failed to load profile from Supabase.' });
    }
  });

  app.patch('/api/me', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { full_name, theme, preferred_model } = req.body || {};
    try {
      let updatedProfile = user.profile;
      if (typeof full_name === 'string') {
        const rows = await supabaseRest(
          'PATCH',
          `profiles?id=eq.${encodeURIComponent(user.id)}`,
          user.accessToken,
          { full_name: full_name.trim().slice(0, 120) }
        );
        if (rows?.[0]) updatedProfile = rows[0];
      }
      const settingsPatch: Record<string, string> = {};
      if (theme === 'dark' || theme === 'light') settingsPatch.theme = theme;
      if (typeof preferred_model === 'string' && preferred_model.trim()) {
        settingsPatch.preferred_model = preferred_model.trim().slice(0, 100);
      }
      let updatedSettings = null;
      if (Object.keys(settingsPatch).length > 0) {
        const sRows = await supabaseRest(
          'PATCH',
          `user_settings?user_id=eq.${encodeURIComponent(user.id)}`,
          user.accessToken,
          settingsPatch
        );
        updatedSettings = sRows?.[0] || null;
      }
      res.json({ user: updatedProfile, settings: updatedSettings });
    } catch {
      res.status(502).json({ detail: 'Failed to update profile or settings.' });
    }
  });

  app.get('/api/conversations', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    try {
      const conversations = await supabaseRest(
        'GET',
        `conversations?user_id=eq.${encodeURIComponent(user.id)}&select=id,user_id,title,created_at,updated_at&order=updated_at.desc&limit=100`,
        user.accessToken
      );
      res.json({ conversations: conversations || [] });
    } catch {
      res.status(502).json({ detail: 'Failed to fetch conversations.' });
    }
  });

  app.post('/api/conversations', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const title = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim().slice(0, 120)
      : 'New Conversation';
    try {
      const rows = await supabaseRest('POST', 'conversations', user.accessToken, {
        user_id: user.id,
        title,
      });
      res.status(201).json({ conversation: rows[0] });
    } catch {
      res.status(502).json({ detail: 'Failed to create conversation.' });
    }
  });

  app.get('/api/conversations/:id', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const convId = String(req.params.id);
    if (!isValidUuid(convId)) {
      res.status(400).json({ detail: 'Invalid conversation ID.' });
      return;
    }
    try {
      const convRows = await supabaseRest(
        'GET',
        `conversations?id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}&select=*`,
        user.accessToken
      );
      if (!convRows?.length) {
        res.status(404).json({ detail: 'Conversation not found.' });
        return;
      }
      const messages = await supabaseRest(
        'GET',
        `messages?conversation_id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}&select=id,conversation_id,user_id,role,content,token_count,created_at&order=created_at.asc&limit=100`,
        user.accessToken
      );
      res.json({ conversation: convRows[0], messages: messages || [] });
    } catch {
      res.status(502).json({ detail: 'Failed to load conversation.' });
    }
  });

  app.delete('/api/conversations/:id', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const convId = String(req.params.id);
    if (!isValidUuid(convId)) {
      res.status(400).json({ detail: 'Invalid conversation ID.' });
      return;
    }
    try {
      await supabaseRest(
        'DELETE',
        `conversations?id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}`,
        user.accessToken,
        undefined,
        false,
        'return=minimal'
      );
      res.status(204).end();
    } catch {
      res.status(502).json({ detail: 'Failed to delete conversation.' });
    }
  });

  app.post('/api/chat/stop', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const convId = String(req.body?.conversation_id || '');
    if (!isValidUuid(convId)) {
      res.status(400).json({ detail: 'Valid conversation_id is required.' });
      return;
    }
    const key = `${user.id}:${convId}`;
    const controller = activeControllers.get(key);
    if (controller) {
      controller.abort();
      res.json({ stopped: true, conversation_id: convId });
      return;
    }
    res.json({ stopped: false, conversation_id: convId });
  });

  app.post('/api/chat/stream', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const rate = checkRateLimit(user.id);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec || 10));
      res.status(429).json({ detail: `Rate limit exceeded. Try again in ${rate.retryAfterSec} seconds.` });
      return;
    }

    const { conversation_id, message, retry, assistant_message_id } = req.body || {};
    const isRetry = Boolean(retry);
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    if (!isRetry) {
      if (!trimmedMessage) {
        res.status(400).json({ detail: 'Message content cannot be empty.' });
        return;
      }
      if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({ detail: `Message exceeds max length of ${MAX_MESSAGE_LENGTH} characters.` });
        return;
      }
    } else if (!conversation_id || !isValidUuid(String(conversation_id))) {
      res.status(400).json({ detail: 'Valid conversation_id is required to retry.' });
      return;
    }

    let conversation: any;
    try {
      if (conversation_id) {
        const convId = String(conversation_id);
        if (!isValidUuid(convId)) {
          res.status(400).json({ detail: 'Invalid conversation_id.' });
          return;
        }
        const rows = await supabaseRest(
          'GET',
          `conversations?id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}&select=*`,
          user.accessToken
        );
        if (!rows?.length) {
          res.status(404).json({ detail: 'Conversation not found.' });
          return;
        }
        conversation = rows[0];
      } else {
        const rows = await supabaseRest('POST', 'conversations', user.accessToken, {
          user_id: user.id,
          title: deriveTitle(trimmedMessage),
        });
        conversation = rows[0];
      }

      const convId: string = conversation.id;
      let history: any[] = await supabaseRest(
        'GET',
        `messages?conversation_id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}&select=id,role,content,created_at&order=created_at.asc&limit=100`,
        user.accessToken
      );

      let savedUserMessage: any = null;
      if (isRetry) {
        if (assistant_message_id && isValidUuid(String(assistant_message_id))) {
          await supabaseRest(
            'DELETE',
            `messages?id=eq.${assistant_message_id}&conversation_id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}`,
            user.accessToken,
            undefined,
            false,
            'return=minimal'
          );
          history = history.filter((m) => m.id !== assistant_message_id);
        }
        if (!history.length || history[history.length - 1].role !== 'user') {
          res.status(400).json({ detail: 'No preceding user message found to retry.' });
          return;
        }
      } else {
        if (history.length === 0 && conversation.title === 'New Conversation') {
          const derived = deriveTitle(trimmedMessage);
          const updated = await supabaseRest(
            'PATCH',
            `conversations?id=eq.${convId}&user_id=eq.${encodeURIComponent(user.id)}`,
            user.accessToken,
            { title: derived }
          );
          if (updated?.[0]) conversation = updated[0];
        }
        const inserted = await supabaseRest('POST', 'messages', user.accessToken, {
          conversation_id: convId,
          user_id: user.id,
          role: 'user',
          content: trimmedMessage,
          token_count: 0,
        });
        savedUserMessage = inserted[0];
        history.push(savedUserMessage);
      }

      const settingsRows = await supabaseRest(
        'GET',
        `user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=preferred_model`,
        user.accessToken
      ).catch(() => []);
      const modelName = resolveModelName(settingsRows?.[0]?.preferred_model);

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const writeEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      writeEvent('meta', {
        conversation,
        user_message: savedUserMessage,
        model: modelName,
      });

      if (!openrouterApiKeyPresent) {
        await logErrorSafe(user.id, '/api/chat/stream', 'ConfigError', 'OPENROUTER_API_KEY not set');
        writeEvent('error', {
          error: 'OPENROUTER_API_KEY is not configured on the backend.',
          code: 'OPENROUTER_NOT_CONFIGURED',
        });
        res.end();
        return;
      }

      if (!modelName) {
        await logErrorSafe(user.id, '/api/chat/stream', 'ConfigError', 'OPENROUTER_MODEL not set');
        writeEvent('error', {
          error: 'OPENROUTER_MODEL is not configured on the backend.',
          code: 'MODEL_NOT_CONFIGURED',
        });
        res.end();
        return;
      }

      if (!openrouterBaseUrlValid) {
        await logErrorSafe(user.id, '/api/chat/stream', 'ConfigError', 'Invalid OPENROUTER_BASE_URL');
        writeEvent('error', {
          error: 'OPENROUTER_BASE_URL must be a valid HTTPS URL.',
          code: 'OPENROUTER_CONFIG_ERROR',
        });
        res.end();
        return;
      }

      const key = `${user.id}:${convId}`;
      const existingController = activeControllers.get(key);
      if (existingController) existingController.abort();

      const controller = new AbortController();
      activeControllers.set(key, controller);
      res.on('close', () => {
        if (!res.writableEnded) {
          controller.abort();
        }
      });

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, AI_TIMEOUT_MS);
      const startedAt = Date.now();
      const recentContext = history
        .slice(-MAX_CONTEXT_MESSAGES)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      let fullReply = '';
      let stopped = false;

      try {
        const upstreamResp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: openRouterHeaders(),
          signal: controller.signal,
          body: JSON.stringify({
            model: modelName,
            stream: true,
            max_tokens: MAX_OUTPUT_TOKENS,
            temperature: AI_TEMPERATURE,
            messages: [
              {
                role: 'system',
                content:
                  'You are ORLIXA AI, a precise, helpful AI assistant developed by Orlixa Labs. Format code blocks with appropriate language identifiers.',
              },
              ...recentContext,
            ],
          }),
        });

        if (!upstreamResp.ok || !upstreamResp.body) {
          const rawBody = await upstreamResp.text().catch(() => '');
          const mapped = mapOpenRouterHttpError(upstreamResp.status, rawBody, modelName);
          await logErrorSafe(user.id, '/api/chat/stream', mapped.code, mapped.message);
          writeEvent('error', {
            error: mapped.message,
            code: mapped.code,
          });
          res.end();
          return;
        }

        const reader = upstreamResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) continue;
            const dataStr = trimmedLine.slice(5).trim();
            if (dataStr === '[DONE]') break;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed?.error?.message) {
                const msg = String(parsed.error.message).slice(0, 240);
                await logErrorSafe(user.id, '/api/chat/stream', 'OPENROUTER_STREAM_ERROR', msg);
                writeEvent('error', {
                  error: msg,
                  code: 'OPENROUTER_STREAM_ERROR',
                });
                res.end();
                return;
              }
              const token = parsed?.choices?.[0]?.delta?.content;
              if (token) {
                fullReply += token;
                writeEvent('token', { token });
              }
            } catch {
              // Ignore partial SSE chunk parse errors
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' && !timedOut) {
          stopped = true;
        } else if (timedOut) {
          await logErrorSafe(user.id, '/api/chat/stream', 'TIMEOUT', 'OpenRouter request timed out');
          writeEvent('error', {
            error: 'OpenRouter request timed out before completion.',
            code: 'TIMEOUT',
          });
          res.end();
          return;
        } else {
          await logErrorSafe(user.id, '/api/chat/stream', 'OPENROUTER_UNREACHABLE', 'OpenRouter API unreachable');
          writeEvent('error', {
            error: 'Unable to reach OpenRouter API. Check network connectivity and configuration.',
            code: 'OPENROUTER_UNREACHABLE',
          });
          res.end();
          return;
        }
      } finally {
        clearTimeout(timeoutHandle);
        if (activeControllers.get(key) === controller) {
          activeControllers.delete(key);
        }
      }

      let savedAssistantMessage: any = null;
      if (fullReply.trim()) {
        const inserted = await supabaseRest('POST', 'messages', user.accessToken, {
          conversation_id: convId,
          user_id: user.id,
          role: 'assistant',
          content: fullReply,
          token_count: 0,
        }).catch(() => null);
        savedAssistantMessage = inserted?.[0] || null;
      }

      await supabaseRest(
        'POST',
        'usage_logs',
        user.accessToken,
        {
          user_id: user.id,
          conversation_id: convId,
          model: modelName,
          prompt_chars: recentContext.reduce((acc, m) => acc + m.content.length, 0),
          completion_chars: fullReply.length,
          latency_ms: Date.now() - startedAt,
          status: stopped ? 'stopped' : 'completed',
        },
        false,
        'return=minimal'
      ).catch(() => {});

      writeEvent('done', { assistant_message: savedAssistantMessage, stopped });
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(502).json({ detail: 'Failed to process chat request.' });
      } else {
        res.end();
      }
    }
  });

  app.post('/api/reports', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { conversation_id, message_id, reason, details } = req.body || {};
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ detail: 'Please provide a reason for the report.' });
      return;
    }
    try {
      const rows = await supabaseRest('POST', 'abuse_reports', user.accessToken, {
        reporter_id: user.id,
        conversation_id: conversation_id && isValidUuid(String(conversation_id)) ? conversation_id : null,
        message_id: message_id && isValidUuid(String(message_id)) ? message_id : null,
        reason: reason.trim().slice(0, 120),
        details: typeof details === 'string' ? details.trim().slice(0, 1000) : '',
      });
      res.status(201).json({ report: rows?.[0] || null });
    } catch {
      res.status(502).json({ detail: 'Unable to submit report.' });
    }
  });

  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req: AuthedRequest, res) => {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      res.status(503).json({ detail: 'SUPABASE_SERVICE_ROLE_KEY is required on the server for admin actions.' });
      return;
    }
    try {
      const [users, error_logs, abuse_reports, usage_logs] = await Promise.all([
        supabaseRest(
          'GET',
          'profiles?select=id,email,full_name,role,status,message_count,last_active_at,created_at&order=created_at.desc&limit=50',
          '',
          undefined,
          true
        ),
        supabaseRest('GET', 'error_logs?select=*&order=created_at.desc&limit=30', '', undefined, true),
        supabaseRest('GET', 'abuse_reports?select=*&order=created_at.desc&limit=30', '', undefined, true),
        supabaseRest(
          'GET',
          'usage_logs?select=id,user_id,model,latency_ms,status,created_at&order=created_at.desc&limit=50',
          '',
          undefined,
          true
        ),
      ]);
      res.json({ users, error_logs, abuse_reports, usage_logs });
    } catch {
      res.status(502).json({ detail: 'Failed to load admin overview.' });
    }
  });

  app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const targetId = String(req.params.id);
    const nextStatus = req.body?.status;
    if (!isValidUuid(targetId) || (nextStatus !== 'active' && nextStatus !== 'suspended')) {
      res.status(400).json({ detail: 'Invalid user ID or status.' });
      return;
    }
    if (targetId === req.authUser!.id && nextStatus === 'suspended') {
      res.status(400).json({ detail: 'Cannot suspend your own admin account.' });
      return;
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      res.status(503).json({ detail: 'SUPABASE_SERVICE_ROLE_KEY is required on the server.' });
      return;
    }
    try {
      const rows = await supabaseRest(
        'PATCH',
        `profiles?id=eq.${targetId}`,
        '',
        { status: nextStatus },
        true
      );
      res.json({ user: rows?.[0] || null });
    } catch {
      res.status(502).json({ detail: 'Failed to update user status.' });
    }
  });

  app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const reportId = String(req.params.id);
    const nextStatus = req.body?.status;
    if (!isValidUuid(reportId) || !['open', 'reviewed', 'dismissed'].includes(nextStatus)) {
      res.status(400).json({ detail: 'Invalid report ID or status.' });
      return;
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      res.status(503).json({ detail: 'SUPABASE_SERVICE_ROLE_KEY is required on the server.' });
      return;
    }
    try {
      const rows = await supabaseRest(
        'PATCH',
        `abuse_reports?id=eq.${reportId}`,
        '',
        { status: nextStatus },
        true
      );
      res.json({ report: rows?.[0] || null });
    } catch {
      res.status(502).json({ detail: 'Failed to update report status.' });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ORLIXA AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ORLIXA AI server:', err);
  process.exit(1);
});
