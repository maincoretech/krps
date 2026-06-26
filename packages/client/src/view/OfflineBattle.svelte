<script>
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import AppIcon from "../lib/AppIcon.svelte";
  import { createState, playRound, doExchange } from "@krps/shared/game";
  import { STRATEGIES } from "@krps/shared/ai";
  import { R, P, S, unpack, first } from "@krps/shared/cards";

  let gameState, game = $state(null), selected = $state(-1), clash = $state(null), exchangeAnimSelf = $state(false), exchangeAnimOpp = $state(false);
  let screen = $state("menu"), strategy = $state("random");

  let oppHands = $derived(game?.players?.B?.hand?.length ?? 0);
  let myHand = $derived(game?.players?.A?.hand || []);
  let canExchange = $derived(game?.players?.A?.canExchangeOnTie && game?.status === "playing");

  const iconMap = { 0: "deployed-code", 1: "draft", 2: "content-cut" };
  const typeNameMap = { 0: "ROCK", 1: "PAPER", 2: "SCISSORS" };
  function iconName(t) { return iconMap[+t] ?? "help"; }
  function typeName(t) { return typeNameMap[+t] ?? "?"; }
  function myRes(r) { if (r === "tie") return "tie"; return r; }

  function newGame(strat = strategy) {
    gameState = createState();
    game = { status: "playing", roundCount: 0, tieCount: 0, winner: null, mode: "offline", players: { A: { hand: unpack(gameState.players.A.hand), losses: 0, canExchangeOnTie: false }, B: { hand: unpack(gameState.players.B.hand), losses: 0, canExchangeOnTie: false } }, history: [] };
    selected = -1; clash = null;
    screen = "game";
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function play(idx, type) {
    if (game.status !== "playing" || clash) return;
    if (selected !== idx) { selected = idx; return; }
    try {
      const r = playRound(gameState, type, strategy);
      clash = { mine: type, opp: r.round.cards.B, res: myRes(r.round.result) };
      selected = -1;
      setTimeout(() => { game = r.state; clash = null; }, 1200);
    } catch (e) { /* ignore */ }
  }

  function exchange() {
    if (!gameState.players.A.tieEx || selected === -1) return;
    const r = doExchange(gameState);
    if (!r) return;
    game.players.A.hand = unpack(gameState.players.A.hand);
    game.players.A.canExchangeOnTie = false;
    game.tieCount = 0;
    exchangeAnimSelf = true;
    setTimeout(() => exchangeAnimSelf = false, 600);
  }

  function handleKey(e) {
    if (game.status !== "playing" || clash) {
      if (e.key === "Escape") { push("/auth"); return; }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "escape") return push("/auth");
    if (k === "e" && canExchange && selected !== -1) return exchange();
    const num = parseInt(k);
    if (!isNaN(num) && num > 0 && num <= myHand.length) {
      const idx = num - 1;
      if (selected === idx) play(idx, myHand[idx]); else selected = idx;
      return;
    }
    if (k === "arrowleft" || k === "a" || k === "arrowup" || k === "w") selected = selected <= 0 ? myHand.length - 1 : selected - 1;
    else if (k === "arrowright" || k === "d" || k === "arrowdown" || k === "s") selected = selected >= myHand.length - 1 ? 0 : selected + 1;
    else if ((k === "enter" || k === " ") && selected !== -1) play(selected, myHand[selected]);
  }
</script>

{#if screen === "menu"}
  <main class="arena" style="display:flex;align-items:center;justify-content:center;">
    <div class="app-surface" style="max-width:360px;width:100%;text-align:center;">
      <div class="brand" style="margin-bottom:24px;">
        <h2 style="margin:8px 0 0;font-weight:800;letter-spacing:2px;">{$_("offline.title")}</h2>
        <p style="font-size:12px;color:rgba(255,255,255,0.4);">{$_("offline.subtitle")}</p>
      </div>

      <div style="margin-bottom:20px;">
        <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:8px;letter-spacing:1px;">{$_("offline.strategy_label")}</div>
        {#each STRATEGIES as s}
          <button
            class="btn"
            style="width:100%;margin-bottom:6px;padding:10px 16px;height:auto;border-radius:14px;"
            class:primary={strategy === s.id}
            onclick={() => strategy = s.id}
          >
            <span style="font-weight:800;font-size:13px;">{s.name}</span>
          </button>
        {/each}
      </div>

      <button class="btn primary" style="width:100%;height:48px;font-size:15px;" onclick={newGame}>{$_("offline.start")}</button>
      <button class="btn text" style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.3);" onclick={() => push("/auth")}>{$_("offline.back")}</button>
    </div>
  </main>
{:else}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<main class="arena" onclick={() => selected = -1}>
  <header class="hud">
      <span style="font-size:11px;color:rgba(255,255,255,0.3);">OFFLINE</span>
      <div class="stats">
        <div class="round">{$_("offline.round")} {game.roundCount + 1}</div>
        {#if game.tieCount}<div class="ties">{$_("offline.ties")} {game.tieCount}</div>{/if}
      </div>
      <button class="btn icon" onclick={() => push("/auth")}><AppIcon name="close" /></button>
    </header>
  <div class="field">
    <div class="zone opp">
      <div class="cards opp-cards" class:exchange-anim={exchangeAnimOpp}>
        {#each Array(oppHands) as _, i}
          <div class="card back" style="--offset:{i - (oppHands - 1) / 2};--abs-offset:{Math.abs(i - (oppHands - 1) / 2)}"></div>
        {/each}
      </div>
    </div>

    <div class="center">
      {#if clash}
        <div class="clash-view">
          <div class="c-card opp-fly"><div class="ico"><AppIcon name={iconName(clash.opp)} /></div></div>
          <div class="result-light" class:win={clash.res === "win"} class:lose={clash.res === "lose"} class:tie={clash.res === "tie"}></div>
          <div class="c-card my-fly"><div class="ico"><AppIcon name={iconName(clash.mine)} /></div></div>
        </div>
      {:else if game.status === "finished"}
        <div class="game-over">
          <h1 class:win={game.winner === "A"} class:lose={game.winner !== "A"}>
            {game.winner === "A" ? $_("offline.victory") : $_("offline.defeat")}
          </h1>
          <div class="actions-row">
            <button class="btn lg" onclick={newGame}>{$_("offline.rematch")}</button>
            <button class="btn primary lg" onclick={() => push("/auth")}>{$_("offline.leave")}</button>
          </div>
        </div>
      {/if}
    </div>

    <div class="zone player" class:locked={game.status !== "playing" || clash}>
      <div class="player-hand-wrapper" style="--hand-size:{myHand.length}">
        <div class="cards my-cards" class:exchange-anim={exchangeAnimSelf}>
          {#each myHand as c, i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="card front" class:active={selected === i}
                 style="--offset:{i - (myHand.length - 1) / 2};--abs-offset:{Math.abs(i - (myHand.length - 1) / 2)}"
                 role="button" tabindex="0"
                 onclick={(e) => { e.stopPropagation(); play(i, c); }}
                 onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i, c); } }}>
              <div class="ico"><AppIcon name={iconName(c)} /></div>
              {#if selected !== i}<div class="shortcut">{i + 1}</div>{:else}<div class="name">{typeName(c)}<br />[{i + 1}]</div>{/if}
            </div>
          {/each}
        </div>
        {#if canExchange}
          <div class="exchange-btn-wrapper">
              <button class="exchange-action-btn" onclick={(e) => { e.stopPropagation(); exchange(e); }} disabled={selected === -1} title={$_("offline.exchange")}><AppIcon name="sync" /></button>
          </div>
        {/if}
      </div>
      {#if game.status === "playing"}<div class="hint">{selected === -1 ? $_("offline.select_card") : $_("offline.click_play")}</div>{/if}
    </div>
  </div>
</main>
{/if}

<style></style>
