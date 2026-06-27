<script>
  import { untrack } from "svelte";
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import toast from "../lib/toast.js";
  import { fetchMatch, getWsBaseUrl, leaveMatch } from "../lib/api.js";
  import { getStoredToken } from "../lib/user.js";
  import { unpack } from "@krps/shared/cards";
  import AppIcon from "../lib/AppIcon.svelte";

  let { params } = $props();
  let matchId = $derived(params?.id || "");

  let game = $state(null), selected = $state(-1), clash = $state(null);
  let exchangeAnimSelf = $state(false), exchangeAnimOpp = $state(false), wsReady = $state(false), ws = $state(null);
  let ppr = $state(null), pprj = $state(null), per = $state(null), perj = $state(null);
  let wsStopped = false;
  let pending = $state(false); // Client-side: true after submit until round resolves
  let pendingIdx = $state(-1);  // Which card was submitted

  let selfId = $derived(game?.selfPlayerId || "A");
  let oppId = $derived(game?.opponentPlayerId || "B");
  let isRoom = $derived(game?.mode === "human-vs-human");
  let oppHands = $derived(game?.players?.[oppId]?.handSize ?? 0);
  let myHand = $derived(game?.players?.[selfId]?.handBits != null ? unpack(game.players[selfId].handBits) : []);
  let canExchange = $derived(game?.players?.[selfId]?.canExchangeOnTie && game?.status === "playing" && !pending);

  // Trigger exchange animation for special actions (self only — never reveal to opponent)
  function notifyEx(actions) {
    if (!actions?.length) return;
    for (const a of actions) {
      const exTypes = ["opening-loss-exchange", "bot-tie-exchange", "tie-exchange"];
      if (!exTypes.includes(a.type)) continue;
      const pid = a.playerId;
      if (pid === selfId) { exchangeAnimSelf = true; setTimeout(() => exchangeAnimSelf = false, 600); }
    }
  }
  const iconMap = { 0: "deployed-code", 1: "draft", 2: "content-cut" };
  const typeNameMap = { 0: "ROCK", 1: "PAPER", 2: "SCISSORS" };
  function iconName(t) { return iconMap[+t] ?? "help"; }
  function typeName(t) { return typeNameMap[+t] ?? "?"; }
  // Server sends result from A's perspective ("win"/"lose"/"tie")
  function myRes(r) { if (r === "tie") return "tie"; return selfId === "A" ? r : (r === "win" ? "lose" : "win"); }

  // ─── WS ──────────────────────────────────────

  function wsPlay(gameId, payload) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error("WS off"));
      ppr = resolve; pprj = reject;
      ws.send(JSON.stringify({ token: getStoredToken(), action: "submitMove", matchId: gameId, payload }));
    });
  }
  function wsEx(gameId, payload) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error("WS off"));
      per = resolve; perj = reject;
      ws.send(JSON.stringify({ token: getStoredToken(), action: "exchangeCard", matchId: gameId, payload }));
    });
  }

  function startWS() {
    if (wsStopped) return;
    stopWS();
    const token = getStoredToken();
    if (!token || !matchId) return;
    ws = new WebSocket(getWsBaseUrl());
    ws.onopen = () => { wsReady = true; ws.send(JSON.stringify({ token, action: "getMatch", matchId })); };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.error) {
          if (pprj) { pprj(new Error(msg.error)); pprj = ppr = null; }
          if (perj) { perj(new Error(msg.error)); perj = per = null; }
          return;
        }
        if (msg.action === "moveResult") { if (ppr) { ppr(msg.data); ppr = pprj = null; } return; }
        if (msg.action === "exchangeResult") { if (per) { per(msg.data); per = perj = null; } return; }

        if (msg.action === "match" && msg.data) {
          if (ppr) { ppr(msg.data); ppr = pprj = null; }
          if (per) { per(msg.data); per = perj = null; }
          const next = msg.data;
          if (!game) { game = next; return; }
          if ((next.version || 0) < (game.version || 0)) return;
          const la = next.history?.[next.history.length - 1];
          const prevRound = game?.roundCount ?? 0;
          if (la?.type === "round" && !clash && next.roundCount > prevRound) {
            pending = false;
            pendingIdx = -1;
            selected = -1;
            clash = { mine: la.cards[selfId], opp: la.cards[oppId], res: myRes(la.result) };
            game = { ...next, history: game.history };
            setTimeout(() => { game = next; clash = null; notifyEx(la.specialActions); }, 1200);
          } else { game = next; }
        }
        else if (msg.action === "matchUpdate" && msg.data) {
          const diff = msg.data;
          if ((diff.version || 0) < (game?.version || 0)) return;
          if (ppr) { ppr({ match: { ...game, ...diff } }); ppr = pprj = null; }
          if (per) { per({ match: { ...game, ...diff } }); per = perj = null; }
          const la = diff.newHistoryItem;
          const prevRound = game?.roundCount ?? 0;
          // Sync players and history
          if (diff.players && game?.players) { game.players = { ...game.players, ...diff.players }; delete diff.players; }
          if (diff.newHistoryItem && game?.history) { game.history = [...game.history, diff.newHistoryItem]; delete diff.newHistoryItem; }
          // Apply remaining diff fields
          if (diff.pendingMoves) delete diff.pendingMoves;
          Object.assign(game, diff);
          if (la?.type === "round" && !clash && diff.roundCount > prevRound) {
            // Round actually resolved (roundCount increased)
            pending = false;
            pendingIdx = -1;
            selected = -1;
            clash = { mine: la.cards[selfId], opp: la.cards[oppId], res: myRes(la.result) };
            setTimeout(() => { clash = null; notifyEx(la.specialActions); }, 1200);
          } else {
            const exTypes = ["tie-exchange", "bot-tie-exchange", "opening-loss-exchange"];
            if (la && exTypes.includes(la.type)) {
              if (la.playerId === selfId) { exchangeAnimSelf = true; setTimeout(() => exchangeAnimSelf = false, 600); }
            }
          }
        }
      } catch (err) { console.error("WS:", err); }
    };
    ws.onclose = () => { wsReady = false; ws = null; if (!wsStopped) setTimeout(() => { if (matchId && !wsStopped) startWS(); }, 3000); };
  }
  function stopWS() { if (ws) { ws.close(); ws = null; } wsReady = false; }

  // ─── Game ────────────────────────────────────

  async function load() { try { game = await fetchMatch(matchId); } catch { push("/games"); } }

  async function play(idx, type) {
    if (game?.status !== "playing" || clash || pending) return;
    if (selected !== idx) { selected = idx; return; }
    if (!wsReady) return toast.warning("toast.failed");
    selected = -1;
    pending = true;
    pendingIdx = idx;
    try {
      const payload = isRoom ? { card: type } : { cardA: type };
      if (isRoom && game?.pendingMoves) game.pendingMoves = { ...game.pendingMoves, [selfId]: type };
      const res = await wsPlay(game.id, payload);
      if (!isRoom) {
        // Bot mode: resolve immediately
        pending = false;
        pendingIdx = -1;
        clash = { mine: type, opp: res.round.cards.B, res: myRes(res.round.result) };
        setTimeout(() => { game = res.match; clash = null; notifyEx(res.round.specialActions); }, 1200);
      }
      // PVP: stay pending until matchUpdate with round arrives
    } catch (e) {
      pending = false;
      if (isRoom && game?.pendingMoves) game.pendingMoves = { ...game.pendingMoves, [selfId]: null };
      toast.fromError(e, "toast.battle_play_failed");
    }
  }

  async function exchange() {
    if (!wsReady) return toast.warning("toast.failed");
    if (!canExchange || selected === -1) return toast.warning("toast.battle_select_card");
    try {
      const payload = isRoom ? { card: myHand[selected] } : { playerId: "A", card: myHand[selected] };
      const res = await wsEx(game.id, payload);
      if (!isRoom) { game = res.match; selected = -1; exchangeAnimSelf = true; setTimeout(() => exchangeAnimSelf = false, 600); }
      else { selected = -1; }
    } catch (e) { toast.fromError(e, "toast.battle_exchange_failed"); }
  }

  function rematch() {
    if (!isRoom || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ token: getStoredToken(), action: "requestRematch", matchId: game.id, payload: { vote: true } }));
  }

  function handleKey(e) {
    if (game?.status !== "playing" || clash || pending) {
      if (e.key === "Escape") { push("/games"); return; }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "escape") return push("/games");
    if (k === "e" && canExchange && selected !== -1) return exchange();
    const num = parseInt(k);
    if (!isNaN(num) && num > 0 && num <= myHand.length) {
      selected = num - 1;
      return;
    }
    if (k === "arrowleft" || k === "a" || k === "arrowup" || k === "w") selected = selected <= 0 ? myHand.length - 1 : selected - 1;
    else if (k === "arrowright" || k === "d" || k === "arrowdown" || k === "s") selected = selected >= myHand.length - 1 ? 0 : selected + 1;
    else if ((k === "enter" || k === " ") && selected !== -1) submitMove();
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    untrack(() => {
      load();
      startWS();
    });
    return () => {
      wsStopped = true;
      untrack(() => stopWS());
      if (matchId) leaveMatch(matchId).catch(() => {});
      window.removeEventListener("keydown", handleKey);
    };
  });
</script>

{#if game}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <main class="arena" onclick={() => selected = -1}>
    <header class="hud">
      <div style="width:44px"></div>
      <div class="stats">
        <div class="round">{$_("battle.round")} {game.roundCount + 1}</div>
        {#if game.players?.[selfId]?.tieCount}<div class="ties">{$_("battle.ties")} {game.players[selfId].tieCount}</div>{/if}
      </div>
      <button class="btn icon" onclick={() => push("/games")}><AppIcon name="close" /></button>
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
            <h1 class:win={game.winner === selfId} class:lose={game.winner !== selfId}>
              {game.winner === selfId ? $_("battle.victory") : $_("battle.defeat")}
            </h1>
            <div class="actions-row">
              {#if isRoom}<button class="btn lg" onclick={rematch} disabled={game.rematchVotes?.[selfId]}>{game.rematchVotes?.[selfId] ? $_("battle.waiting") : $_("battle.rematch")}</button>{/if}
              <button class="btn primary lg" onclick={() => push("/games")}>{$_("battle.leave")}</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="zone player" class:locked={game.status !== "playing" || clash || pending}>
        <div class="player-hand-wrapper" style="--hand-size:{myHand.length}">
          <div class="cards my-cards" class:exchange-anim={exchangeAnimSelf}>
            {#each myHand as c, i}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="card front" class:active={selected === i} class:pending={pending && pendingIdx === i}
                   style="--offset:{i - (myHand.length - 1) / 2};--abs-offset:{Math.abs(i - (myHand.length - 1) / 2)}"
                   role="button" tabindex="0"
                   onclick={(e) => { e.stopPropagation(); play(i, c); }}
                   onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submitMove(); } }}>
                <div class="ico"><AppIcon name={iconName(c)} /></div>
                {#if selected !== i}<div class="shortcut">{i + 1}</div>{:else}<div class="name">{typeName(c)}<br />[{i + 1}]</div>{/if}
              </div>
            {/each}
          </div>
          {#if canExchange}
            <div class="exchange-btn-wrapper">
              <button class="exchange-action-btn" onclick={(e) => { e.stopPropagation(); exchange(e); }} disabled={selected === -1} title={$_("battle.exchange")}><AppIcon name="sync" /></button>
            </div>
          {/if}
        </div>
        <div class="hint" style="visibility: {pending ? 'hidden' : 'visible'}">
          {selected === -1 ? $_("battle.select_card") : $_("battle.click_play")}
        </div>
      </div>
    </div>
  </main>
{/if}

<style></style>
