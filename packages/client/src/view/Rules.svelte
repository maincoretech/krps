<script>
  import { onMount, onDestroy } from "svelte";
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import AppIcon from "../lib/AppIcon.svelte";

  function handleKey(e) {
    if (e.key === "Escape") { push("/games"); return; }
  }

  onMount(() => { window.addEventListener("keydown", handleKey); });
  onDestroy(() => { window.removeEventListener("keydown", handleKey); });
</script>

<main class="page-screen">
  <header class="page-top">
    <h1 class="page-title">{$_("rules.title")}</h1>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <button class="btn icon" onclick={() => push("/games")} title="Back"><AppIcon name="close" /></button>
    </div>
  </header>

  <div class="page-body" style="max-width:640px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:16px;">

    <div class="rule-card">
      <h2>{$_("rules.cards_title")}</h2>
      <p>{$_("rules.cards_desc1")}</p>
      <p>{$_("rules.cards_desc2")}</p>
      <p>{$_("rules.cards_desc3")}</p>
    </div>

    <div class="rule-card">
      <h2>{$_("rules.gameplay_title")}</h2>
      <p>{$_("rules.gameplay_desc1")}</p>
      <p>{$_("rules.gameplay_desc2")}</p>
      <p>{$_("rules.gameplay_desc3")}</p>
      <p>{$_("rules.gameplay_desc4")}</p>
      <p>{$_("rules.gameplay_desc5")}</p>
    </div>

    <div class="rule-card">
      <h2>{$_("rules.opening_title")}</h2>
      <p>{$_("rules.opening_desc1")}</p>
      <p>{$_("rules.opening_desc2")}</p>
      <p>{$_("rules.opening_desc3")}</p>
    </div>

    <div class="rule-card">
      <h2>{$_("rules.tie_title")}</h2>
      <p>{$_("rules.tie_desc1")}</p>
      <p>{$_("rules.tie_desc2")}</p>
      <p>{$_("rules.tie_desc3")}</p>
    </div>

    <div class="rule-card">
      <h2>{$_("rules.keys_title")}</h2>
      <p>{$_("rules.keys_desc1")}</p>
      <p>{$_("rules.keys_desc2")}</p>
    </div>
  </div>
</main>

<style>
  .rule-card { padding: 20px; border-radius: 16px; background: rgba(255,255,255,0.03); }
  .rule-card h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; }
  .rule-card p { margin: 6px 0; font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.65); }
  @media (max-width: 400px) {
    .rule-card { padding: 14px; border-radius: 12px; }
    .rule-card h2 { font-size: 14px; }
    .rule-card p { font-size: 12px; }
  }
</style>
