import { getRuntimeConfig, getSupabaseClient, isSupabaseConfigured } from "./supabase.js";

const page = document.body.dataset.page || "";

function showBanner(elementId, message, type = "error") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = `auth-alert ${type === "success" ? "auth-alert-success" : "auth-alert-error"}`;
  el.hidden = false;
}

function hideBanner(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.hidden = true;
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-toggle-password");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.textContent = showing ? "Show" : "Hide";
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
}

function setupPasswordMatch(passwordId, confirmId, statusId) {
  const pwdEl = document.getElementById(passwordId);
  const confirmEl = document.getElementById(confirmId);
  const statusEl = document.getElementById(statusId);
  if (!pwdEl || !confirmEl || !statusEl) return;

  const update = () => {
    const pwd = pwdEl.value;
    const confirm = confirmEl.value;
    if (!confirm) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.className = "password-match-msg";
      return;
    }
    const matched = pwd.length > 0 && pwd === confirm;
    statusEl.hidden = false;
    statusEl.textContent = matched ? "Passwords match" : "Passwords do not match";
    statusEl.className = `password-match-msg ${matched ? "match" : "mismatch"}`;
  };

  pwdEl.addEventListener("input", update);
  confirmEl.addEventListener("input", update);
}

async function initAuthPages() {
  setupPasswordToggles();
  const supabase = getSupabaseClient();
  const configBanner = document.getElementById("config-warning");

  if (!isSupabaseConfigured() || !supabase) {
    if (configBanner) {
      configBanner.hidden = false;
    }
    document.querySelectorAll("form button[type='submit']").forEach((btn) => {
      btn.disabled = true;
    });
    return;
  }

  // Handle password recovery redirect link from Supabase email
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const isRecovery =
    hashParams.get("type") === "recovery" || queryParams.get("type") === "recovery";

  if (page === "login" && isRecovery) {
    const loginCard = document.getElementById("login-view");
    const forgotCard = document.getElementById("forgot-view");
    const resetCard = document.getElementById("reset-view");
    if (loginCard) loginCard.hidden = true;
    if (forgotCard) forgotCard.hidden = true;
    if (resetCard) resetCard.hidden = false;
  } else {
    const { data } = await supabase.auth.getSession();
    if (data?.session && (page === "login" || page === "register")) {
      window.location.replace("./index.html");
      return;
    }
  }

  if (page === "login") {
    setupPasswordMatch("reset-password", "reset-password-confirm", "reset-match-status");
    const loginForm = document.getElementById("login-form");
    const forgotForm = document.getElementById("forgot-form");
    const resetForm = document.getElementById("reset-form");
    const showForgotBtn = document.getElementById("show-forgot-btn");
    const backToLoginBtns = document.querySelectorAll("[data-back-login]");

    showForgotBtn?.addEventListener("click", () => {
      document.getElementById("login-view").hidden = true;
      document.getElementById("forgot-view").hidden = false;
      hideBanner("login-alert");
    });

    backToLoginBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("forgot-view").hidden = true;
        document.getElementById("reset-view").hidden = true;
        document.getElementById("login-view").hidden = false;
        hideBanner("forgot-alert");
        hideBanner("reset-alert");
      });
    });

    loginForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("login-alert");
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      const submitBtn = document.getElementById("login-submit");

      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        showBanner("login-alert", error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
        return;
      }

      if (data?.session) {
        window.location.replace("./index.html");
      }
    });

    forgotForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("forgot-alert");
      const email = document.getElementById("forgot-email").value.trim();
      const submitBtn = document.getElementById("forgot-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending reset link...";

      const redirectTo = `${window.location.origin}${window.location.pathname}?type=recovery`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

      submitBtn.disabled = false;
      submitBtn.textContent = "Send reset link";

      if (error) {
        showBanner("forgot-alert", error.message);
        return;
      }
      showBanner(
        "forgot-alert",
        "Password reset instructions have been sent if an account exists for that email.",
        "success"
      );
    });

    resetForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("reset-alert");
      const password = document.getElementById("reset-password").value;
      const confirm = document.getElementById("reset-password-confirm").value;
      if (password.length < 8) {
        showBanner("reset-alert", "Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        showBanner("reset-alert", "Passwords do not match.");
        return;
      }

      const submitBtn = document.getElementById("reset-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Updating password...";

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showBanner("reset-alert", error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Update password";
        return;
      }
      showBanner("reset-alert", "Password updated. Redirecting to chat...", "success");
      setTimeout(() => window.location.replace("./index.html"), 900);
    });
  }

  if (page === "register") {
    setupPasswordMatch("register-password", "register-confirm", "register-match-status");
    const registerForm = document.getElementById("register-form");
    registerForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideBanner("register-alert");

      const fullName = document.getElementById("register-name").value.trim();
      const email = document.getElementById("register-email").value.trim();
      const password = document.getElementById("register-password").value;
      const confirm = document.getElementById("register-confirm").value;
      const submitBtn = document.getElementById("register-submit");

      if (password.length < 8) {
        showBanner("register-alert", "Password must be at least 8 characters long.");
        return;
      }
      if (password !== confirm) {
        showBanner("register-alert", "Passwords do not match.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";

      const emailRedirectTo = `${window.location.origin}/login.html`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo,
        },
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";

      if (error) {
        showBanner("register-alert", error.message);
        return;
      }

      if (data?.session) {
        window.location.replace("./index.html");
      } else {
        showBanner(
          "register-alert",
          "Account created. Please check your inbox and verify your email address before signing in.",
          "success"
        );
        registerForm.reset();
      }
    });
  }
}

export async function requireAuthenticatedSession() {
  const supabase = getSupabaseClient();
  if (!isSupabaseConfigured() || !supabase) {
    return { configured: false, session: null, supabase: null, config: getRuntimeConfig() };
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) {
    window.location.replace("./login.html");
    return null;
  }
  return { configured: true, session: data.session, supabase, config: getRuntimeConfig() };
}

if (page === "login" || page === "register") {
  initAuthPages();
}
