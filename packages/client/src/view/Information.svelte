<script>
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import { fetchDashboard } from "../lib/api.js";
  import { getStoredUser } from "../lib/user.js";
  import AppIcon from "../lib/AppIcon.svelte";

  let serverInfo = $state(null);
  let currentUser = { username: getStoredUser() };
  let loading = $state(true);

  let server = $derived(serverInfo?.server ?? null);
  let auth = $derived(serverInfo?.auth ?? null);
  let botStrategies = $derived(serverInfo?.botStrategies ?? []);

  async function load() {
    loading = true;
    try {
      const dashboardData = await fetchDashboard();
      serverInfo = dashboardData.info;
    } catch (e) {
      console.error("Failed to load info", e);
    } finally {
      loading = false;
    }
  }

  function handleKey(e) {
    if (e.key === "Escape") { push("/games"); return; }
  }

  $effect(() => {
    load();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
</script>

<main class="page-screen">
  <header class="page-top">
    <h1 class="page-title">{$_("info.title")}</h1>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <button class="btn icon" onclick={() => push("/games")} title="Back"><AppIcon name="close" /></button>
    </div>
  </header>

  <div class="page-body" style="max-width:800px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:16px;">
    <div class="info-card">
      <h2>{$_("info.server")}</h2>
      {#if server}
        <dl class="desc-list">
          <dt>{$_("info.name")}</dt><dd>{server.name}</dd>
          <dt>{$_("info.host")}</dt><dd>{server.host}</dd>
          <dt>{$_("info.port")}</dt><dd>{server.port}</dd>
          <dt>{$_("info.storage")}</dt><dd>{server.storage}</dd>
        </dl>
      {:else}
        <p class="muted">{$_("info.loading")}</p>
      {/if}
    </div>

    <div class="info-card">
      <h2>{$_("info.auth")}</h2>
      <dl class="desc-list">
        <dt>{$_("info.token_type")}</dt><dd>{auth?.tokenType ?? "Bearer"}</dd>
        <dt>{$_("info.user")}</dt>
        <dd>
          <span class="user-chip" class:user-ok={currentUser} class:user-idle={!currentUser}>
            {currentUser ? currentUser.username : $_("info.not_logged")}
          </span>
        </dd>
      </dl>
    </div>

    <div class="info-card">
      <h2>{$_("info.bot_strategies")}</h2>
      {#if botStrategies.length > 0}
        <div class="table-wrap">
          <table class="strategy-table">
            <thead><tr><th>{$_("info.name")}</th><th>ID</th><th>Description</th></tr></thead>
            <tbody>
              {#each botStrategies as s}
                <tr><td style="font-weight:700;">{s.name}</td><td>{s.id}</td><td>{s.description}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted">{$_("info.loading")}</p>
      {/if}
    </div>

    <div class="info-card">
      <h2>{$_("info.about")}</h2>
      <dl class="desc-list">
        <dt>{$_("info.project")}</dt>
        <dd><a href="https://github.com/maincoretech/krps" target="_blank" style="color:var(--color-primary);text-decoration:underline;">{$_("info.repo")}</a></dd>
        <dt>{$_("info.credits")}</dt><dd>{$_("info.credits_text")}</dd>
      </dl>
    </div>
  </div>
</main>

<style>
  .info-card { border-radius: 16px; padding: 20px; background: rgba(255,255,255,0.03); }
  .info-card h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; }
  .desc-list { margin: 0; display: grid; grid-template-columns: 100px 1fr; gap: 8px 12px; font-size: 13px; }
  .desc-list dt { color: rgba(255,255,255,0.4); }
  .desc-list dd { margin: 0; }
  .muted { color: rgba(255,255,255,0.4); font-size: 13px; }
  .user-chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 10px; font-size: 13px; }
  .user-ok { color: #000; background: var(--color-primary); font-weight: 700; }
  .user-idle { color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.08); }
  .table-wrap { overflow-x: auto; }
  .strategy-table { width: 100%; min-width: 600px; border-collapse: collapse; font-size: 13px; }
  .strategy-table th, .strategy-table td { text-align: left; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .strategy-table th { color: rgba(255,255,255,0.4); font-weight: 600; font-size: 11px; text-transform: uppercase; }

  @media (max-width: 400px) {
    .info-card { padding: 14px; border-radius: 12px; }
    .info-card h2 { font-size: 14px; }
    .desc-list { grid-template-columns: 80px 1fr; font-size: 12px; gap: 6px 8px; }
    .strategy-table { min-width: 480px; font-size: 12px; }
    .strategy-table th, .strategy-table td { padding: 8px 6px; }
  }
</style>
