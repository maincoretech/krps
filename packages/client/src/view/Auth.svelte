<script>
  import { push } from "svelte-spa-router";

  // svelte-spa-router@5 removed querystring; parse from hash
  function getRedirect() {
    const h = window.location.hash;
    const q = h.includes("?") ? h.slice(h.indexOf("?") + 1) : "";
    const m = q.match(/(?:^|&)redirect=([^&]*)/);
    const raw = m ? decodeURIComponent(m[1]) : "";
    return raw.startsWith("/games") ? raw : "/games";
  }
  import { _ } from "../lib/i18n.js";
  import { login, register } from "../lib/api.js";
  import { setStoredToken, setStoredUser } from "../lib/user.js";
  import toast from "../lib/toast.js";

  function startOffline() { push("/offline"); }

  let loading = $state(false);
  let isLogin = $state(true);
  let username = $state("");
  let password = $state("");
  let turnstileToken = $state("");
  let turnstileContainer;
  let turnstileWidgetId = $state(null);

  let redirectPath = getRedirect();

  function renderTurnstile() {
    if (!turnstileContainer || isLogin) return;
    if (window.turnstile && turnstileWidgetId === null) {
      turnstileWidgetId = window.turnstile.render(turnstileContainer, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
        callback: function(token) {
          turnstileToken = token;
        },
        'error-callback': function() {
          toast.error("toast.auth_turnstile_failed");
        }
      });
    }
  }

  function toggleMode() {
    isLogin = !isLogin;
    if (!isLogin) {
      setTimeout(renderTurnstile, 0);
    } else {
      if (turnstileWidgetId != null && window.turnstile) {
        try { window.turnstile.remove(turnstileWidgetId); } catch {}
        turnstileWidgetId = null;
        turnstileToken = "";
      }
    }
  }

  async function submit() {
    if (!username || !password) return toast.warning("toast.auth_fill_all_fields");
    if (!isLogin && !turnstileToken) return toast.warning("toast.auth_complete_captcha");
    loading = true;
    try {
      if (!isLogin) {
        await register({ username, password, turnstileToken });
        isLogin = true;
        password = "";
        toast.success("toast.auth_registered_login");
        return;
      }
      const res = await login({ username, password });
      setStoredToken(res.token);
      setStoredUser(username);
      push(redirectPath);
      toast.success("toast.auth_welcome");
    } catch (err) {
      toast.fromError(err, "toast.failed");
      if (!isLogin && window.turnstile && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
        turnstileToken = "";
      }
    } finally {
      loading = false;
    }
  }

  function handleKey(e) {
    if (e.key === "Escape") {
      push("/games");
      return;
    }
    if (e.key.startsWith("Arrow")) {
      const isInput = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (isInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      e.preventDefault();
      const focusable = Array.from(document.querySelectorAll(".input, .btn"));
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      let nextIndex = 0;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        nextIndex = currentIndex >= 0 ? (currentIndex + 1) % focusable.length : 0;
      } else {
        nextIndex = currentIndex >= 0 ? (currentIndex - 1 + focusable.length) % focusable.length : focusable.length - 1;
      }
      focusable[nextIndex].focus();
    }
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    if (!isLogin) {
      setTimeout(renderTurnstile, 0);
    }
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (turnstileWidgetId != null && window.turnstile) {
        try { window.turnstile.remove(turnstileWidgetId); } catch {}
      }
    };
  });
</script>

<main class="page app-page">
  <div class="card auth-card">
    <div class="brand">
      <span class="logo-icon">❖</span>
      <h1 class="title">KRPS</h1>
    </div>

    <div class="fields">
      <label class="md-field">
        <input class="md-input" type="text" bind:value={username} placeholder=" " disabled={loading} />
        <span class="md-label">{$_("auth.username")}</span>
      </label>
      <label class="md-field">
        <input class="md-input" type="password" bind:value={password} placeholder=" " disabled={loading} onkeydown={(e) => e.key === 'Enter' && submit()} />
        <span class="md-label">{$_("auth.password")}</span>
      </label>
      {#if !isLogin}
        <div class="hint-box">
          <p>{$_("auth.hint_user")}</p>
          <p>{$_("auth.hint_pass")}</p>
        </div>
        <div bind:this={turnstileContainer} class="turnstile-wrapper"></div>
      {/if}
    </div>

    <div class="row" style="justify-content: space-between;">
      <button class="btn text" onclick={toggleMode} disabled={loading}>
        {isLogin ? $_("auth.create_account") : $_("auth.back_login")}
      </button>
      <button class="btn primary" onclick={submit} disabled={loading}>
        {isLogin ? $_("auth.enter") : $_("auth.register")}
      </button>
    </div>
    <div style="text-align:center; margin-top: 20px;">
      <button class="btn text" style="color: rgba(255,255,255,0.4); font-size: 12px;" onclick={startOffline}>
        Offline Mode
      </button>
    </div>
  </div>
</main>

<style>
  .auth-card { width: 100%; max-width: 360px; padding: 32px; border-radius: 24px; }
  .brand { text-align: center; margin-bottom: 32px; }
  .logo-icon { font-size: 40px; color: var(--color-primary, #a8c7fa); line-height: 1; }
  .title { font-size: 24px; font-weight: 800; margin: 8px 0 0; letter-spacing: 2px; color: #fff; }
  .fields { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .fields .md-field { margin-bottom: 0; }
  .hint-box { font-size: 12px; color: rgba(255,255,255,0.4); padding: 0 8px; line-height: 1.6; }
  .hint-box p { margin: 4px 0; }
  .turnstile-wrapper { min-height: 65px; display: flex; justify-content: center; }

  @media (max-width: 400px) {
    .auth-card { padding: 24px 18px 16px; border-radius: 18px; }
    .title { font-size: 22px; }
    .logo-icon { font-size: 32px; }
    .brand { margin-bottom: 24px; }
  }
</style>
