import { marked } from "https://cdn.jsdelivr.net/npm/marked@15.0.6/+esm";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/+esm";
import { requireAuthenticatedSession } from "./auth.js";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const state = {
  session: null,
  supabase: null,
  backendApiUrl: "",
  user: null,
  settings: null,
  limits: { max_message_length: 4000 },
  conversations: [],
  activeConversationId: null,
  messages: [],
  isGenerating: false,
  autoScrollEnabled: true,
  abortController: null,
};

const els = {
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  openSidebarBtn: document.getElementById("open-sidebar-btn"),
  closeSidebarBtn: document.getElementById("close-sidebar-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  conversationList: document.getElementById("conversation-list"),
  userDisplayName: document.getElementById("user-display-name"),
  userDisplayEmail: document.getElementById("user-display-email"),
  topbarTitle: document.getElementById("topbar-title"),
  chatScroll: document.getElementById("chat-scroll"),
  welcomeScreen: document.getElementById("welcome-screen"),
  welcomeGreeting: document.getElementById("welcome-greeting"),
  messagesList: document.getElementById("messages-list"),
  chatForm: document.getElementById("chat-form"),
  messageInput: document.getElementById("message-input"),
  sendBtn: document.getElementById("send-btn"),
  stopBtn: document.getElementById("stop-btn"),
  charCounter: document.getElementById("char-counter"),
  errorBanner: document.getElementById("chat-error-banner"),
  logoutBtn: document.getElementById("logout-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsModal: document.getElementById("settings-modal"),
  closeSettingsBtn: document.getElementById("close-settings-btn"),
  settingsForm: document.getElementById("settings-form"),
  settingsName: document.getElementById("settings-name"),
  settingsTheme: document.getElementById("settings-theme"),
};

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.hidden = false;
}

function clearError() {
  els.errorBanner.hidden = true;
  els.errorBanner.textContent = "";
}

function renderMarkdownSafe(markdownText) {
  const rawHtml = marked.parse(markdownText || "");
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
  const wrapper = document.createElement("div");
  wrapper.innerHTML = cleanHtml;
  wrapper.querySelectorAll("pre code").forEach((block) => {
    hljs.highlightElement(block);
  });
  wrapper.querySelectorAll("pre").forEach((pre) => {
    const copyCodeBtn = document.createElement("button");
    copyCodeBtn.type = "button";
    copyCodeBtn.className = "action-chip-btn";
    copyCodeBtn.style.position = "absolute";
    copyCodeBtn.style.top = "8px";
    copyCodeBtn.style.right = "8px";
    copyCodeBtn.textContent = "Copy code";
    copyCodeBtn.addEventListener("click", async () => {
      const codeEl = pre.querySelector("code");
      await navigator.clipboard.writeText(codeEl ? codeEl.textContent || "" : pre.textContent || "");
      copyCodeBtn.textContent = "Copied";
      setTimeout(() => {
        copyCodeBtn.textContent = "Copy code";
      }, 1500);
    });
    pre.appendChild(copyCodeBtn);
  });
  wrapper.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return wrapper;
}

async function apiFetch(path, options = {}) {
  if (!state.backendApiUrl) {
    throw new Error("BACKEND_API_URL is not configured in frontend/config.js.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.session.access_token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(`${state.backendApiUrl}${path}`, {
    ...options,
    headers,
  });
  if (resp.status === 401) {
    await state.supabase.auth.signOut();
    window.location.replace("./login.html");
    throw new Error("Session expired.");
  }
  return resp;
}

function toggleSidebar(open) {
  els.sidebar.classList.toggle("open", open);
  els.sidebarBackdrop.classList.toggle("open", open);
}

function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
}

function renderConversations() {
  els.conversationList.innerHTML = "";
  if (state.conversations.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "12px 10px";
    empty.style.fontSize = "13px";
    empty.style.color = "var(--text-muted)";
    empty.textContent = "No conversations yet.";
    els.conversationList.appendChild(empty);
    return;
  }

  state.conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.className = `conversation-item ${conv.id === state.activeConversationId ? "active" : ""}`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "conversation-title";
    titleSpan.textContent = conv.title || "New Conversation";
    item.appendChild(titleSpan);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn";
    delBtn.style.width = "26px";
    delBtn.style.height = "26px";
    delBtn.title = "Delete conversation";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteConversationById(conv.id);
    });
    item.appendChild(delBtn);

    item.addEventListener("click", async () => {
      await loadConversation(conv.id);
      toggleSidebar(false);
    });
    els.conversationList.appendChild(item);
  });
}

function renderMessages() {
  els.messagesList.innerHTML = "";
  const hasMessages = state.messages.length > 0;
  els.welcomeScreen.hidden = hasMessages;

  state.messages.forEach((msg, idx) => {
    const row = document.createElement("article");
    row.className = "message-row";

    const header = document.createElement("div");
    header.className = "message-header";

    const author = document.createElement("span");
    author.className = `message-author ${msg.role}`;
    author.textContent = msg.role === "assistant" ? "ORLIXA AI" : (state.user?.full_name || "You");
    header.appendChild(author);

    row.appendChild(header);

    const body = document.createElement("div");
    body.className = "message-body";
    if (msg.role === "assistant") {
      if (msg.streaming && !msg.content) {
        body.textContent = "Generating response...";
      } else {
        body.appendChild(renderMarkdownSafe(msg.content));
      }
    } else {
      body.style.whiteSpace = "pre-wrap";
      body.textContent = msg.content;
    }
    row.appendChild(body);

    if (msg.role === "assistant" && !msg.streaming) {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "action-chip-btn";
      copyBtn.textContent = "Copy response";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(msg.content || "");
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy response";
        }, 1500);
      });
      actions.appendChild(copyBtn);

      if (idx === state.messages.length - 1 && !state.isGenerating) {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "action-chip-btn";
        retryBtn.textContent = "Retry response";
        retryBtn.addEventListener("click", () => retryAssistantMessage(msg.id));
        actions.appendChild(retryBtn);
      }

      row.appendChild(actions);
    }

    els.messagesList.appendChild(row);
  });

  if (state.autoScrollEnabled) {
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  }
}

async function refreshConversations() {
  const resp = await apiFetch("/api/conversations");
  if (!resp.ok) throw new Error("Failed to load conversation history.");
  const data = await resp.json();
  state.conversations = data.conversations || [];
  renderConversations();
}

async function loadConversation(conversationId) {
  clearError();
  const resp = await apiFetch(`/api/conversations/${conversationId}`);
  if (!resp.ok) {
    showError("Unable to load the selected conversation.");
    return;
  }
  const data = await resp.json();
  state.activeConversationId = conversationId;
  state.messages = data.messages || [];
  els.topbarTitle.textContent = data.conversation?.title || "ORLIXA AI";
  state.autoScrollEnabled = true;
  renderConversations();
  renderMessages();
}

async function deleteConversationById(conversationId) {
  const resp = await apiFetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
  if (!resp.ok) {
    showError("Failed to delete conversation.");
    return;
  }
  if (state.activeConversationId === conversationId) {
    startNewChat();
  }
  await refreshConversations();
}

function startNewChat() {
  clearError();
  state.activeConversationId = null;
  state.messages = [];
  els.topbarTitle.textContent = "ORLIXA AI";
  renderConversations();
  renderMessages();
  els.messageInput.focus();
}

function setGeneratingState(generating) {
  state.isGenerating = generating;
  els.sendBtn.hidden = generating;
  els.stopBtn.hidden = !generating;
  els.sendBtn.disabled = generating;
}

async function consumeSseStream(response, assistantDraft) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const lines = rawEvent.split("\n");
      let eventType = "message";
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataStr += line.slice(5).trim();
        }
      }
      if (!dataStr) continue;

      const payload = JSON.parse(dataStr);
      if (eventType === "meta") {
        if (payload.conversation) {
          state.activeConversationId = payload.conversation.id;
          els.topbarTitle.textContent = payload.conversation.title || "ORLIXA AI";
        }
      } else if (eventType === "token") {
        assistantDraft.content += payload.token || "";
        renderMessages();
      } else if (eventType === "done") {
        assistantDraft.streaming = false;
        if (payload.assistant_message?.id) {
          assistantDraft.id = payload.assistant_message.id;
        }
        renderMessages();
        await refreshConversations();
      } else if (eventType === "error") {
        assistantDraft.streaming = false;
        showError(payload.error || "Inference failed.");
        renderMessages();
      }
    }
  }
}

async function sendMessage(text) {
  if (state.isGenerating) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  if (trimmed.length > state.limits.max_message_length) {
    showError(`Message exceeds ${state.limits.max_message_length} characters.`);
    return;
  }

  clearError();
  state.autoScrollEnabled = true;

  const userDraft = { id: `local-u-${Date.now()}`, role: "user", content: trimmed };
  const assistantDraft = { id: `local-a-${Date.now()}`, role: "assistant", content: "", streaming: true };
  state.messages.push(userDraft, assistantDraft);
  renderMessages();

  els.messageInput.value = "";
  els.charCounter.textContent = `0 / ${state.limits.max_message_length}`;
  setGeneratingState(true);

  const controller = new AbortController();
  state.abortController = controller;

  try {
    const resp = await apiFetch("/api/chat/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        conversation_id: state.activeConversationId,
        message: trimmed,
      }),
    });

    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(errJson.detail || `Request failed with status ${resp.status}`);
    }

    await consumeSseStream(resp, assistantDraft);
  } catch (err) {
    if (err.name !== "AbortError") {
      showError(err.message || "Unable to reach ORLIXA AI backend.");
    }
    assistantDraft.streaming = false;
    if (!assistantDraft.content) {
      state.messages = state.messages.filter((m) => m !== assistantDraft);
    }
    renderMessages();
  } finally {
    state.abortController = null;
    setGeneratingState(false);
  }
}

async function retryAssistantMessage(assistantMessageId) {
  if (state.isGenerating || !state.activeConversationId) return;
  clearError();
  state.messages = state.messages.filter((m) => m.id !== assistantMessageId);
  const assistantDraft = { id: `local-a-${Date.now()}`, role: "assistant", content: "", streaming: true };
  state.messages.push(assistantDraft);
  renderMessages();
  setGeneratingState(true);

  const controller = new AbortController();
  state.abortController = controller;

  try {
    const resp = await apiFetch("/api/chat/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        conversation_id: state.activeConversationId,
        retry: true,
        assistant_message_id: assistantMessageId,
      }),
    });
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}));
      throw new Error(errJson.detail || "Retry failed.");
    }
    await consumeSseStream(resp, assistantDraft);
  } catch (err) {
    if (err.name !== "AbortError") showError(err.message);
    assistantDraft.streaming = false;
    renderMessages();
  } finally {
    state.abortController = null;
    setGeneratingState(false);
  }
}

async function stopGeneration() {
  if (!state.isGenerating) return;
  if (state.activeConversationId) {
    apiFetch("/api/chat/stop", {
      method: "POST",
      body: JSON.stringify({ conversation_id: state.activeConversationId }),
    }).catch(() => {});
  }
  state.abortController?.abort();
  setGeneratingState(false);
}

async function bootstrap() {
  const auth = await requireAuthenticatedSession();
  if (!auth) return;
  if (!auth.configured) {
    showError("Supabase is not configured. Copy frontend/config.example.js to frontend/config.js.");
    els.sendBtn.disabled = true;
    return;
  }

  state.session = auth.session;
  state.supabase = auth.supabase;
  state.backendApiUrl = auth.config.backendApiUrl;

  try {
    const meResp = await apiFetch("/api/me");
    if (!meResp.ok) {
      const err = await meResp.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to load user profile.");
    }
    const meData = await meResp.json();
    state.user = meData.user;
    state.settings = meData.settings;
    state.limits = meData.limits || state.limits;

    els.userDisplayName.textContent = state.user.full_name || state.user.email;
    els.userDisplayEmail.textContent = state.user.email;
    if (els.welcomeGreeting) {
      const greetingName =
        (state.user.full_name || "").trim() || state.user.email?.split("@")[0] || "there";
      els.welcomeGreeting.textContent = `Hello, ${greetingName}`;
    }
    applyTheme(state.settings?.theme || "dark");

    await refreshConversations();
  } catch (err) {
    showError(err.message);
  }

  // Event wiring
  els.openSidebarBtn.addEventListener("click", () => toggleSidebar(true));
  els.closeSidebarBtn.addEventListener("click", () => toggleSidebar(false));
  els.sidebarBackdrop.addEventListener("click", () => toggleSidebar(false));
  els.newChatBtn.addEventListener("click", startNewChat);
  els.stopBtn.addEventListener("click", stopGeneration);

  els.chatScroll.addEventListener("scroll", () => {
    const distanceFromBottom =
      els.chatScroll.scrollHeight - els.chatScroll.scrollTop - els.chatScroll.clientHeight;
    state.autoScrollEnabled = distanceFromBottom < 80;
  });

  els.messageInput.addEventListener("input", () => {
    els.messageInput.style.height = "auto";
    els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 180)}px`;
    els.charCounter.textContent = `${els.messageInput.value.length} / ${state.limits.max_message_length}`;
  });

  els.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.chatForm.requestSubmit();
    }
  });

  els.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(els.messageInput.value);
  });

  els.logoutBtn.addEventListener("click", async () => {
    await state.supabase.auth.signOut();
    window.location.replace("./login.html");
  });

  els.settingsBtn.addEventListener("click", () => {
    els.settingsName.value = state.user?.full_name || "";
    els.settingsTheme.value = state.settings?.theme || "dark";
    els.settingsModal.hidden = false;
  });

  els.closeSettingsBtn.addEventListener("click", () => {
    els.settingsModal.hidden = true;
  });

  els.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const resp = await apiFetch("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        full_name: els.settingsName.value.trim(),
        theme: els.settingsTheme.value,
      }),
    });
    if (resp.ok) {
      const updated = await resp.json();
      state.user = updated.user || state.user;
      state.settings = updated.settings || state.settings;
      els.userDisplayName.textContent = state.user.full_name || state.user.email;
      if (els.welcomeGreeting) {
        const greetingName =
          (state.user.full_name || "").trim() || state.user.email?.split("@")[0] || "there";
        els.welcomeGreeting.textContent = `Hello, ${greetingName}`;
      }
      applyTheme(state.settings.theme);
      els.settingsModal.hidden = true;
    }
  });
}

bootstrap();
