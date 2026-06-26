<script>
  import { fly, fade } from "svelte/transition";
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import { fetchMatch } from "../lib/api.js";
  import { unpack } from "@krps/shared/cards";
  import toast from "../lib/toast.js";
  import AppIcon from "../lib/AppIcon.svelte";

  let { params } = $props();
  let matchId = $derived(params?.id || "");

  let match = $state(null);
  let loading = $state(true);
  let roundIdx = $state(-1);
  let autoPlay = $state(false);
  let autoTimer = $state(null);

  const iconMap = { 0: "deployed-code", 1: "draft", 2: "content-cut" };
  const typeMap = { 0: "ROCK", 1: "PAPER", 2: "SCISSORS" };
  const typeNameCN = { 0: "R", 1: "P", 2: "S" };
  function iname(t) { return iconMap[+t] ?? "help"; }

  let rounds = $derived(match?.history?.filter(h => h.type === "round") || []);
  let totalRounds = $derived(rounds.length);
  let cur = $derived(roundIdx >= 0 && roundIdx < rounds.length ? rounds[roundIdx] : null);

  let snap = $derived(cur?.snap);
  let curPoolCards = $derived(snap != null ? unpack(snap & 0x1FF) : (match?.poolBits != null ? unpack(match.poolBits) : []));
  let curHandA = $derived(snap != null ? unpack((snap >>> 9) & 0x1FF) : (match?.players?.A?.handBits != null ? unpack(match.players.A.handBits) : []));
  let curHandB = $derived(snap != null ? unpack((snap >>> 18) & 0x1FF) : (match?.players?.B?.handBits != null ? unpack(match.players.B.handBits) : []));
  let curSizeA = $derived(curHandA.length);
  let curSizeB = $derived(curHandB.length);
  let curPoolSize = $derived(curPoolCards.length);

  let nameA = $derived(match?.players?.A?.username || $_("replay.player_a"));
  let nameB = $derived(match?.players?.B?.username || $_("replay.player_b"));
  let winnerName = $derived(match ? (match.winner === "A" ? nameA : nameB) : "");
  let isLastRound = $derived(match?.status === "finished" && roundIdx === totalRounds - 1);
  let winnerIsA = $derived(match?.winner === "A");

  let timeline = $derived(rounds.map((r, i) => ({
    num: r.round,
    res: r.result,
    active: i === roundIdx,
    past: i <= roundIdx,
  })));

  async function load() {
    loading = true;
    try {
      match = await fetchMatch(matchId);
      if (!match?.history?.length) {
        roundIdx = -1;
      } else {
        roundIdx = 0;
      }
    } catch (e) {
      toast.fromError(e, $_("replay.load_failed"));
      push("/games");
    } finally {
      loading = false;
    }
  }

  function prev() { if (roundIdx > 0) roundIdx--; }
  function next() {
    if (roundIdx < totalRounds - 1) roundIdx++;
    else stopAuto();
  }
  function goTo(i) { roundIdx = i; }

  function resultClass(r) {
    return r === "tie" ? "tie" : r;
  }

  function toggleAuto() {
    autoPlay = !autoPlay;
    if (autoPlay && roundIdx >= totalRounds - 1) roundIdx = 0;
  }

  function stopTimer() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  function stopAuto() {
    autoPlay = false;
    stopTimer();
  }

  $effect(() => {
    if (autoPlay) {
      stopTimer();
      autoTimer = setInterval(() => {
        if (roundIdx < totalRounds - 1) {
          roundIdx++;
        } else {
          roundIdx = 0;
        }
      }, 1500);
    } else {
      stopTimer();
    }
    return () => stopTimer();
  });

  function handleKey(e) {
    if (e.key === "Escape") { stopAuto(); push("/games"); return; }
    if (e.key === "ArrowLeft") { stopAuto(); prev(); }
    if (e.key === "ArrowRight") { stopAuto(); next(); }
    if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggleAuto(); }
  }

  $effect(() => {
    load();
    window.addEventListener("keydown", handleKey);
    return () => {
      stopTimer();
      window.removeEventListener("keydown", handleKey);
    };
  });
</script>

<main class="page-screen">
  <header class="page-top">
    <div style="width:36px;"></div>
    <div class="rp-info">
      <h1 class="page-title">{$_("replay.title")}</h1>
      <span class="rp-meta">
        {match?.name || "Match"} · {match?.mode === "human-vs-bot" ? $_("replay.vs_bot") : $_("replay.pvp")} · {totalRounds} {$_("replay.rounds")}
        {#if isLastRound}
          <span class="rp-outcome-inline" class:win={winnerIsA} class:lose={!winnerIsA}>
            — {winnerName} {$_("replay.victory")}
          </span>
        {/if}
      </span>
    </div>
    <div style="display:flex;gap:8px;">
      <div style="width:40px;height:40px;visibility:hidden;"></div>
      <button class="btn icon autoplay-btn" class:is-playing={autoPlay} onclick={toggleAuto} title={autoPlay ? $_("replay.pause") : $_("replay.auto")}><AppIcon name="sync" /></button>
      <button class="btn icon" onclick={() => { stopAuto(); push("/games"); }} title="Back"><AppIcon name="close" /></button>
    </div>
  </header>

  {#if loading}
    <div class="page-body center"><div class="app-empty">{$_("replay.loading")}</div></div>
  {:else if !match || !rounds.length}
    <div class="page-body center"><div class="app-empty">{$_("replay.no_rounds")}</div></div>
  {:else}
    <div class="page-body" style="flex-direction:row;gap:0;">
      <div class="rp-main">
        <!-- Players -->
        <div class="rp-players">
          <div class="rp-player-info a">
            <span class="rp-pl-name">{nameA}</span>
            <span class="rp-pl-hand">{$_("replay.hand")}: {curSizeA}</span>
            <div class="rp-hand-chips">
              {#each curHandA as c, i (i)}
                <span class="rp-hand-chip" class:r={c === 0} class:p={c === 1} class:s={c === 2} in:fly={{ y: -8, duration: 250, delay: i * 40 }}>{typeNameCN[c]}</span>
              {/each}
            </div>
          </div>
          <div class="rp-vs-wrap">
            {#if cur}
              <span class="rp-round-num-top">{$_("replay.round")} {cur.round}</span>
            {/if}
            <div class="rp-vs">{$_("replay.vs")}</div>
          </div>
          <div class="rp-player-info b">
            <span class="rp-pl-name">{nameB}</span>
            <span class="rp-pl-hand">{$_("replay.hand")}: {curSizeB}</span>
            <div class="rp-hand-chips">
              {#each curHandB as c, i (i)}
                <span class="rp-hand-chip" class:r={c === 0} class:p={c === 1} class:s={c === 2} in:fly={{ y: -8, duration: 250, delay: i * 40 }}>{typeNameCN[c]}</span>
              {/each}
            </div>
          </div>
        </div>

        {#if cur}
          <!-- Fixed clash zone: A | signal | B (keyed for animation) -->
          {#key roundIdx}
          <div class="rp-clash-zone">
            <div class="rp-card-slot left">
              <div class="rp-card a" class:empty={cur.cards.A == null}>
                {#if cur.cards.A != null}
                  <div class="rp-card-icon" in:fly={{ y: -20, duration: 300 }}><AppIcon name={iname(cur.cards.A)} /></div>
                  <span class="rp-card-label" in:fade={{ delay: 100, duration: 200 }}>{typeMap[cur.cards.A]}</span>
                {/if}
              </div>
            </div>

            <div class="rp-result" class:win={resultClass(cur.result) === "win"} class:lose={resultClass(cur.result) === "lose"} class:tie={resultClass(cur.result) === "tie"}>
              <div class="rp-sig-light" in:fade={{ duration: 400 }}></div>
            </div>

            <div class="rp-card-slot right">
              <div class="rp-card b" class:empty={cur.cards.B == null}>
                {#if cur.cards.B != null}
                  <div class="rp-card-icon" in:fly={{ y: -20, duration: 300 }}><AppIcon name={iname(cur.cards.B)} /></div>
                  <span class="rp-card-label" in:fade={{ delay: 100, duration: 200 }}>{typeMap[cur.cards.B]}</span>
                {/if}
              </div>
            </div>
          </div>
          {/key}

          <!-- Pool (keyed for animation) -->
          {#key roundIdx}
          <div class="rp-pool">
            <div class="rp-pool-label">{$_("replay.pool")}: {curPoolSize}</div>
            <div class="rp-pool-cards">
              {#each curPoolCards as c, i (i)}
                <span class="rp-pool-chip" class:r={c === 0} class:p={c === 1} class:s={c === 2} in:fly={{ y: -12, duration: 300, delay: i * 50 }}>{typeNameCN[c]}</span>
              {/each}
            </div>
          </div>
          {/key}

          <!-- Exchange actions (fixed height container) -->
          <div class="rp-actions-zone">
            {#if cur.specialActions?.length}
              {#each cur.specialActions as a (a.type)}
                <div class="rp-action-tag" in:fade={{ duration: 200 }}>
                  {a.type === "opening-loss-exchange" ? $_("replay.opening_exchange") :
                   a.type === "bot-tie-exchange" ? $_("replay.bot_exchange") :
                   a.type === "tie-exchange" ? $_("replay.tie_exchange") : a.type}
                  {#if a.putIntoPool != null}
                    <span class="rp-ex-detail">({$_("replay.discard")} <b>{typeNameCN[a.putIntoPool]}</b> {$_("replay.arrow")} {$_("replay.draw")} <b>{typeNameCN[a.drew]}</b>)</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/if}

        <!-- Nav: mirror header grid layout for alignment -->
        <div class="rp-nav">
          <button class="btn" onclick={prev} disabled={roundIdx <= 0}>◀</button>
          <span class="rp-nav-pos">{roundIdx + 1} / {totalRounds}</span>
          <button class="btn" onclick={next} disabled={roundIdx >= totalRounds - 1}>▶</button>
        </div>
      </div>

      <!-- Right sidebar: round timeline -->
      <div class="rp-sidebar">
        {#each timeline as t}
          <button class="rp-dot" class:active={t.active} class:past={t.past} class:win={t.res === "win"} class:lose={t.res === "lose"} class:tie={t.res === "tie"}
                  onclick={() => goTo(t.num - 1)} title="{$_('replay.round')} {t.num}">
            {t.num}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</main>

<style>
  .rp-info { flex: 1; text-align: center; }
  .rp-meta { font-size: 11px; color: rgba(255,255,255,0.35); }

  .autoplay-btn.is-playing { color: #a8c7fa !important; background: rgba(168,199,250,0.15) !important; }

  .rp-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 20px 24px; min-width: 0; gap: 10px; }

  .rp-sidebar {
    display: flex; flex-direction: column; gap: 4px;
    padding: 12px 8px;
    overflow-y: auto;
    border-left: 1px solid rgba(255,255,255,0.05);
    width: 48px; flex-shrink: 0;
    align-items: center;
    mask-image: linear-gradient(to bottom, black 80%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 80%, transparent 100%);
  }

  .rp-dot {
    width: 28px; height: 28px; min-height: 28px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.1);
    background: transparent; color: rgba(255,255,255,0.25);
    font-size: 10px; font-weight: 700; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-family: inherit; flex-shrink: 0;
  }
  .rp-dot.past { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.45); }
  .rp-dot.active { border-color: var(--color-primary); color: var(--color-primary); background: rgba(168,199,250,0.12); transform: scale(1.05); }
  .rp-dot.past.win { border-color: rgba(129,199,132,0.5); color: #81c784; }
  .rp-dot.past.lose { border-color: rgba(255,180,171,0.5); color: #ffb4ab; }
  .rp-dot.past.tie { border-color: rgba(253,226,147,0.5); color: #fde293; }

  .rp-players { display: flex; align-items: flex-start; justify-content: center; gap: 24px; width: 100%; max-width: 520px; }
  .rp-player-info { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; }
  .rp-player-info.a { align-items: flex-start; }
  .rp-player-info.b { align-items: flex-end; }
  .rp-pl-name { font-size: 14px; font-weight: 700; color: rgba(255,255,255,0.6); }
  .rp-pl-hand { font-size: 11px; color: rgba(255,255,255,0.3); }
  .rp-hand-chips { display: flex; gap: 3px; flex-wrap: wrap; min-height: 22px; }
  .rp-hand-chip {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 5px;
    font-size: 10px; font-weight: 800;
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
  }
  .rp-hand-chip.r { background: rgba(168,199,250,0.15); color: var(--color-primary); }
  .rp-hand-chip.p { background: rgba(129,199,132,0.15); color: #81c784; }
  .rp-hand-chip.s { background: rgba(255,180,171,0.15); color: #ffb4ab; }
  .rp-vs-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
  .rp-round-num-top { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.25); letter-spacing: 1px; }
  .rp-vs { font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.15); letter-spacing: 2px; flex-shrink: 0; }

  /* Fixed clash zone */
  .rp-clash-zone { display: flex; align-items: center; justify-content: center; gap: 24px; width: 100%; max-width: 480px; min-height: 120px; }
  .rp-card-slot { width: 110px; flex-shrink: 0; display: flex; justify-content: center; }
  .rp-card-slot.left { justify-content: flex-start; }
  .rp-card-slot.right { justify-content: flex-end; }

  .rp-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px; border-radius: 20px; background: rgba(255,255,255,0.04); width: 100px; min-height: 100px; justify-content: center; }
  .rp-card.empty { opacity: 0.2; }
  .rp-card-icon { font-size: 36px; }
  .rp-card-label { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.4); letter-spacing: 1px; }

  .rp-result { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; min-width: 90px; }
  .rp-sig-light {
    width: 28px; height: 28px; border-radius: 50%;
    background: rgba(255,255,255,0.15); box-shadow: 0 0 0 rgba(255,255,255,0);
    transition: background 0.4s, box-shadow 0.4s;
  }
  .rp-result.win .rp-sig-light { background: #81c784; box-shadow: 0 0 20px rgba(129,199,132,0.6); }
  .rp-result.lose .rp-sig-light { background: #ffb4ab; box-shadow: 0 0 20px rgba(255,180,171,0.6); }
  .rp-result.tie .rp-sig-light { background: #fde293; box-shadow: 0 0 20px rgba(253,226,147,0.6); }

  .rp-pool { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .rp-pool-label { font-size: 12px; color: rgba(255,255,255,0.35); font-weight: 600; letter-spacing: 1px; }
  .rp-pool-cards { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
  .rp-pool-chip {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 6px;
    font-size: 11px; font-weight: 800;
    background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
  }
  .rp-pool-chip.r { background: rgba(168,199,250,0.15); color: var(--color-primary); }
  .rp-pool-chip.p { background: rgba(129,199,132,0.15); color: #81c784; }
  .rp-pool-chip.s { background: rgba(255,180,171,0.15); color: #ffb4ab; }

  .rp-actions-zone { min-height: 24px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
  .rp-action-tag { font-size: 11px; padding: 4px 10px; border-radius: 999px; background: rgba(168,199,250,0.1); color: var(--color-primary); font-weight: 600; display: flex; align-items: center; gap: 4px; }
  .rp-ex-detail { opacity: 0.6; font-weight: 400; }
  .rp-ex-detail b { opacity: 1; font-weight: 700; }

  .rp-nav { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 4px; }
  .rp-nav-pos { font-size: 12px; color: rgba(255,255,255,0.3); min-width: 50px; text-align: center; }
  .rp-outcome-inline { font-weight: 800; text-shadow: 0 1px 4px rgba(0,0,0,0.6); }
  .rp-outcome-inline.win { color: #81c784; }
  .rp-outcome-inline.lose { color: #ffb4ab; }

  @media (max-width: 640px) {
    .rp-sidebar { width: 44px; padding: 8px 6px; }
    .rp-dot { width: 24px; height: 24px; min-height: 24px; font-size: 9px; }
    .rp-card { padding: 14px; min-height: 80px; width: 80px; }
    .rp-card-slot { width: 88px; }
    .rp-card-icon { font-size: 28px; }
    .rp-clash-zone { gap: 12px; min-height: 100px; }
  }
</style>
