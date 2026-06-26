<script>
  import { fade } from "svelte/transition";
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import { fetchLeaderboard } from "../lib/api.js";
  import toast from "../lib/toast.js";
  import AppIcon from "../lib/AppIcon.svelte";

  let loading = $state(false);
  let leaderboard = $state([]);

  async function load() {
    loading = true;
    try {
      leaderboard = await fetchLeaderboard();
    } catch (error) {
      toast.fromError(error, "toast.leaderboard_load_failed");
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
    <h1 class="page-title">{$_("leaderboard.title")}</h1>
    <div style="display:flex;gap:8px;">
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <button class="btn icon app-icon-btn" onclick={load} disabled={loading} title={$_("leaderboard.refresh")}><AppIcon name="refresh" /></button>
      <button class="btn icon app-icon-btn" onclick={() => push("/games")} title={$_("leaderboard.back")}><AppIcon name="close" /></button>
    </div>
  </header>

  <div class="page-body">
    {#if loading && !leaderboard.length}
      <div class="app-empty" style="padding:48px 0;">{$_("leaderboard.loading")}</div>
    {:else if !leaderboard.length}
      <div class="app-empty" style="padding:48px 0;">{$_("leaderboard.no_data")}</div>
    {:else}
      <div class="lb-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="th-rank">{$_("leaderboard.rank")}</th>
              <th class="th-name">{$_("leaderboard.player")}</th>
              <th class="th-score">{$_("leaderboard.score")}</th>
              <th>{$_("leaderboard.pvp_wl")}</th>
              <th>{$_("leaderboard.bot_wl")}</th>
              <th>{$_("leaderboard.total")}</th>
            </tr>
          </thead>
          <tbody>
            {#each leaderboard as item, index}
              <tr>
                <td class="td-rank">#{index + 1}</td>
                <td class="td-name">{item.username}</td>
                <td class="td-score">{item.score}</td>
                <td>{item.pvpWins} / {item.pvpLosses}</td>
                <td>{item.botWins} / {item.botLosses}</td>
                <td>{item.totalGames}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</main>

<style>
  .lb-table-wrap { flex: 1; overflow: auto; }

  table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    padding: 10px 10px;
    color: rgba(255,255,255,0.4);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 1px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    white-space: nowrap;
    text-transform: uppercase;
  }

  td {
    padding: 12px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    white-space: nowrap;
  }

  .th-rank, .td-rank { width: 72px; }
  .td-rank { font-weight: 800; color: var(--color-primary, #a8c7fa); }
  .td-name { font-weight: 700; font-size: 14px; }
  .td-score { font-weight: 800; font-size: 15px; }

  @media (max-width: 640px) {
    table { min-width: 600px; font-size: 12px; }
    th, td { padding: 8px 8px; }
  }
  @media (max-width: 400px) {
    table { min-width: 520px; font-size: 11px; }
    th, td { padding: 6px 6px; }
    .td-name { font-size: 12px; }
    .td-score { font-size: 13px; }
  }
</style>
