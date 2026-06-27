<script>
  import { untrack } from "svelte";
  import { push } from "svelte-spa-router";
  import { _ } from "../lib/i18n.js";
  import { fetchMatch, refreshMatchInviteCode, setMatchReady, getWsBaseUrl, leaveMatch } from "../lib/api.js";
  import toast from "../lib/toast.js";
  import { getStoredToken, getStoredUser } from "../lib/user.js";
  import AppIcon from "../lib/AppIcon.svelte";

  let { params } = $props();
  let roomId = $derived(params?.id || "");

  let room = $state(null);
  let loading = $state(false);
  const currentUsername = getStoredUser();
  let ws = $state(null);

  let selfSeat = $derived(room?.selfPlayerId ?? "A");
  let opponentSeat = $derived(room?.opponentPlayerId ?? "B");
  let selfReady = $derived(Boolean(room?.startVotes?.[selfSeat]));
  let opponentReady = $derived(Boolean(room?.startVotes?.[opponentSeat]));
  let guestJoined = $derived(Boolean(room?.players?.B?.userId));
  let isHost = $derived(selfSeat === "A");

  function getDisplayName(seat) {
    const p = room?.players?.[seat];
    if (!p) return $_("room.waiting");
    if (p.username === "Host" && seat === selfSeat) return currentUsername;
    return p.username || $_("room.waiting");
  }

  async function loadRoom() {
    try {
      const nextRoom = await fetchMatch(roomId);
      room = nextRoom;
      if (nextRoom.status !== "waiting") {
        push(`/room/${nextRoom.id}/battle`);
      }
    } catch (error) {
      toast.fromError(error, "toast.room_load_failed");
      push("/games");
    }
  }

  async function toggleReady() {
    if (!room || loading) return;
    loading = true;
    try {
      room = await setMatchReady(room.id, { ready: !selfReady });
    } catch (error) {
      toast.fromError(error, "toast.room_ready_update_failed");
    } finally {
      loading = false;
    }
  }

  async function doRefreshInviteCode() {
    if (!room || loading) return;
    loading = true;
    try {
      room = await refreshMatchInviteCode(room.id);
      toast.success("toast.room_invite_refreshed");
    } catch (error) {
      toast.fromError(error, "toast.room_invite_refresh_failed");
    } finally {
      loading = false;
    }
  }

  async function copyInviteCode() {
    if (!room?.inviteCode) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(room.inviteCode);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = room.inviteCode;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      toast.success("toast.room_invite_copied");
    } catch (error) {
      toast.error("toast.room_copy_failed");
    }
  }

  let wsStopped = false;

  function startWebSocket() {
    if (wsStopped) return;
    stopWebSocket();
    const token = getStoredToken();
    if (!token) return;

    const wsUrl = getWsBaseUrl();
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ token, action: "getMatch", matchId: roomId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === "match" && msg.data) {
          room = msg.data;
          if (msg.data.status !== "waiting") {
            push(`/room/${msg.data.id}/battle`);
          }
        }
      } catch (e) {
        console.error("WS error:", e);
      }
    };

    ws.onclose = () => {
      if (wsStopped) return;
      ws = null;
      setTimeout(() => {
        if (roomId && !wsStopped) startWebSocket();
      }, 3000);
    };
  }

  function stopWebSocket() {
    if (ws) { ws.close(); ws = null; }
  }

  let leaving = $state(false);

  async function doLeave() {
    if (leaving) return;
    leaving = true;
    try { await leaveMatch(roomId); } catch {}
    push("/games");
  }

  function handleKey(e) {
    if (e.key === "Escape") { doLeave(); return; }
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    untrack(() => {
      loadRoom();
      startWebSocket();
    });
    return () => {
      wsStopped = true;
      untrack(() => stopWebSocket());
      window.removeEventListener("keydown", handleKey);
    };
  });
</script>

{#if room}
  <main class="page center bg-mesh app-page">
    <section class="matches lobby-card app-surface">
      <div class="row header-row app-header-row">
        <div>
          <div class="eyebrow" style="font-size: 12px; color: rgba(255,255,255,0.4); letter-spacing: 2px;">{$_("room.title")}</div>
          <h2 style="margin: 4px 0 0;">{room.name}</h2>
        </div>
        <button class="btn icon app-icon-btn" onclick={doLeave}><AppIcon name="close" /></button>
      </div>

      <div class="seats row" style="gap: 16px; margin: 24px 0;">
        <!-- Host Seat -->
        <article class="info-card seat" class:active={selfSeat === 'A'} style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 16px; padding: 20px; text-align: center;">
          <div class="seat-chip host">{$_("room.host")}</div>
          <div class="seat-name" style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">{getDisplayName('A')}</div>
          <div class="ready-indicator" style="font-size: 13px; font-weight: 700; color: {selfSeat === 'A' ? (selfReady ? '#81c784' : '#ffb74d') : (opponentReady ? '#81c784' : 'rgba(255,255,255,0.3)')};">
            {selfSeat === 'A' ? (selfReady ? '✓ ' + $_("room.ready") : $_("room.not_ready")) : (opponentReady ? '✓ ' + $_("room.ready") : $_("room.waiting"))}
          </div>
        </article>

        <div style="font-size: 28px; font-weight: 800; color: rgba(255,255,255,0.2);">VS</div>

        <!-- Guest Seat -->
        <article class="info-card seat" class:active={selfSeat === 'B'} style="flex: 1; background: rgba(255,255,255,0.03); border-radius: 16px; padding: 20px; text-align: center;">
          <div class="seat-chip guest">{$_("room.guest")}</div>
          <div class="seat-name" style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">{getDisplayName('B')}</div>
          <div class="ready-indicator" style="font-size: 13px; font-weight: 700; color: {selfSeat === 'B' ? (selfReady ? '#81c784' : '#ffb74d') : (opponentReady ? '#81c784' : 'rgba(255,255,255,0.3)')};">
            {#if !guestJoined}
              {$_("room.waiting")}
            {:else if selfSeat === 'B'}
              {selfReady ? '✓ ' + $_("room.ready") : $_("room.not_ready")}
            {:else}
              {opponentReady ? '✓ ' + $_("room.ready") : $_("room.waiting")}
            {/if}
          </div>
        </article>
      </div>

      <!-- Invite Code -->
      {#if isHost}
        <div style="text-align: center; margin: 16px 0; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 12px;">
          <div style="font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 8px;">{$_("room.invite_code")}</div>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; font-family: monospace;">{room.inviteCode || '------'}</div>
          <div style="display: flex; gap: 8px; justify-content: center; margin-top: 12px;">
            <button class="btn text" style="font-size: 13px;" onclick={copyInviteCode}><AppIcon name="content-cut" /><span style="margin-left: 6px;">{$_("room.copy")}</span></button>
            <button class="btn text" style="font-size: 13px;" onclick={doRefreshInviteCode} disabled={loading}><AppIcon name="refresh" /><span style="margin-left: 6px;">{$_("room.refresh")}</span></button>
          </div>
        </div>
      {/if}

      <!-- Ready Button -->
      <button
        class="btn primary"
        style="width: 100%; height: 52px; font-size: 16px;"
        onclick={toggleReady}
        disabled={loading}
      >
        {selfReady ? 'CANCEL READY' : 'READY'}
      </button>
    </section>
  </main>
{/if}

<style>
  .lobby-card { width: 100%; max-width: 500px; }
  .info-card.active { background: rgba(168,199,250,0.08) !important; border: 1px solid rgba(168,199,250,0.2); }
  .seat-chip { display: inline-block; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin-bottom: 12px; }
  .seat-chip.host { background: rgba(168,199,250,0.15); color: var(--color-primary); }
  .seat-chip.guest { background: rgba(129,199,132,0.12); color: #81c784; }

  @media (max-width: 400px) {
    .lobby-card { padding: 0 4px; }
  }
</style>
