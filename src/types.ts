export interface PublicConfig {
  supabaseConfigured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  openrouterConfigured: boolean;
}

export interface HealthStatus {
  status: string;
  service: string;
  provider: string;
  supabase_configured: boolean;
  openrouter_api_key_present: boolean;
  openrouter_model_configured: boolean;
  openrouter_base_url_valid: boolean;
  openrouter_configured: boolean;
}

export interface OpenRouterTestResult {
  connected: boolean;
  latency_ms: number;
  detail: string;
  code?: string;
  status_code?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  message_count: number;
}

export interface UserSettings {
  id?: string;
  user_id?: string;
  theme: 'dark' | 'light';
}

export interface UsageLimits {
  max_message_length: number;
  max_output_tokens: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  streaming?: boolean;
}

export interface AdminOverview {
  users: Array<{
    id: string;
    email: string;
    full_name: string;
    role: 'user' | 'admin';
    status: 'active' | 'suspended';
    message_count: number;
    last_active_at: string | null;
    created_at: string;
  }>;
  error_logs: Array<{
    id: string;
    user_id: string | null;
    endpoint: string;
    error_type: string;
    message: string;
    created_at: string;
  }>;
  abuse_reports: Array<{
    id: string;
    reporter_id: string;
    conversation_id: string | null;
    message_id: string | null;
    reason: string;
    details: string;
    status: 'open' | 'reviewed' | 'dismissed';
    created_at: string;
  }>;
  usage_logs: Array<{
    id: string;
    user_id: string;
    model: string;
    latency_ms: number;
    status: string;
    created_at: string;
  }>;
}
