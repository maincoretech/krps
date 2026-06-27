<script>
  import { push } from "svelte-spa-router";
  import { _, locale } from "svelte-i18n";
  import toast from "../lib/toast.js";
  import { setStoredToken, getStoredUser, setStoredUser } from "../lib/user.js";
  import AppIcon from "../lib/AppIcon.svelte";
  import {
    fetchDashboard, createMatch, deleteMatch, fetchMe,
    joinMatch, logout, renameMatch, updateMe
  } from "../lib/api.js";

  let langDropdownOpen = $state(false);
  let userDropdownOpen = $state(false);

  const availableLangs = [
    { code: "en", name: "English" },
    { code: "zh-CN", name: "简体中文" },
    { code: "zh-TW", name: "繁體中文" },
  ];

  function toggleLangDropdown() {
    langDropdownOpen = !langDropdownOpen;
    if (langDropdownOpen) userDropdownOpen = false;
  }

  function toggleUserDropdown() {
    userDropdownOpen = !userDropdownOpen;
    if (userDropdownOpen) langDropdownOpen = false;
  }

  function selectLang(code) {
    locale.set(code);
    localStorage.setItem("app-lang", code);
    langDropdownOpen = false;
  }

  function handleClickOutside(e) {
    if (langDropdownOpen && !e.target.closest(".lang-switcher")) {
      langDropdownOpen = false;
    }
    if (userDropdownOpen && !e.target.closest(".user-menu-wrapper")) {
      userDropdownOpen = false;
    }
    if (strategyOpen && !e.target.closest(".strategy-dropdown")) {
      strategyOpen = false;
    }
  }

  let games = $state([]);
  let rooms = $state([]);
  let loading = $state(false);
  let view = $state("menu");
  let form = $state({ name: "", botStrategy: "", inviteCode: "", isPublic: false });
  let strategies = $state([]);
  let roomTab = $state("public");
  let matchesTab = $state("rooms");
  let playConfig = $state({ mode: "single" });
  let profileData = $state({ username: getStoredUser() });
  let editProfileForm = $state({ username: "", currentPassword: "", newPassword: "" });

  let activeGame = $derived(myGames.find((g) => g.status === "playing"));

  let myGames = $derived([...games, ...rooms.filter(r => r.selfPlayerId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  let filteredRooms = $derived((() => {
    if (roomTab === "public") {
      return rooms.filter((room) => room.isPublic && room.status === "waiting" && !room.players.B.userId);
    } else if (roomTab === "my") {
      return rooms.filter((room) => room.selfPlayerId);
    }
    return rooms;
  })());

  async function load() {
    loading = true;
    try {
      const data = await fetchDashboard();
      strategies = data.info.botStrategies ?? [];
      if (strategies.length && !form.botStrategy) {
        form.botStrategy = strategies[0].id;
      }
      games = data.games;
      rooms = data.rooms;
    } catch (e) {
      if (e?.response?.status === 401) push("/auth");
    } finally {
      loading = false;
    }
  }

  async function quickPlay() {
    if (loading) return;
    loading = true;
    try {
      const game = await createMatch({
        mode: "human-vs-bot",
        name: "Quick Match",
        botStrategy: strategies[0]?.id || "random",
      });
      push(`/battle/${game.id}`);
    } catch (err) {
      toast.fromError(err, "toast.games_failed_start");
      loading = false;
    }
  }

  async function doCreateBotMatch() {
    loading = true;
    try {
      const game = await createMatch({
        mode: "human-vs-bot",
        name: form.name || `Game ${Date.now()}`,
        botStrategy: form.botStrategy,
      });
      push(`/battle/${game.id}`);
    } catch (e) {
      toast.fromError(e, "toast.games_creation_failed");
    } finally {
      loading = false;
    }
  }

  async function doCreateRoom() {
    loading = true;
    try {
      const room = await createMatch({
        mode: "human-vs-human",
        name: form.name || `Room ${Date.now()}`,
        isPublic: form.isPublic,
        username: profileData.username,
      });
      push(`/room/${room.id}`);
    } catch (e) {
      toast.fromError(e, "toast.games_creation_failed");
    } finally {
      loading = false;
    }
  }

  async function doJoinRoom() {
    if (form.inviteCode.length !== 6) return;
    loading = true;
    try {
      const room = await joinMatch({
        inviteCode: form.inviteCode,
        username: profileData.username,
      });
      push(`/room/${room.id}`);
    } catch (e) {
      toast.fromError(e, "toast.games_join_failed");
    } finally {
      loading = false;
    }
  }

  async function openRoom(room) {
    if (room.status === "waiting") {
      if (room.isPublic && !room.selfPlayerId && !room.players.B.userId) {
        loading = true;
        try {
          await joinMatch({ matchId: room.id, username: profileData.username });
        } catch (e) {
          toast.fromError(e, "toast.games_join_failed");
          loading = false;
          return;
        } finally {
          loading = false;
        }
      }
      push(`/room/${room.id}`);
      return;
    }
    push(`/room/${room.id}/battle`);
  }

  let manageDialog = $state({ open: false, room: null, step: "menu", newName: "" });
  let strategyOpen = $state(false);

  function openManageDialog(room) {
    manageDialog = { open: true, room, step: "menu", newName: room.name };
  }

  function closeManageDialog() {
    manageDialog = { open: false, room: null, step: "menu", newName: "" };
  }

  async function doRename() {
    const room = manageDialog.room;
    const newName = manageDialog.newName.trim();
    if (!newName || newName === room.name) { closeManageDialog(); return; }
    loading = true;
    try {
      await renameMatch(room.id, newName);
      await load();
      closeManageDialog();
    } catch (error) {
      toast.fromError(error, "toast.games_rename_failed");
    } finally {
      loading = false;
    }
  }

  async function doDeleteRoom() {
    const room = manageDialog.room;
    loading = true;
    try {
      await deleteMatch(room.id);
      await load();
      closeManageDialog();
    } catch (error) {
      toast.fromError(error, "toast.games_delete_failed");
    } finally {
      loading = false;
    }
  }

  function openPlayConfig() {
    if (strategies.length && !form.botStrategy) {
      form.botStrategy = strategies[0].id;
    }
    view = "play_config";
  }

  function handleKey(e) {
    if (e.key === "Escape") {
      if (view !== "menu") { view = "menu"; return; }
      return;
    }
    if (e.key.startsWith("Arrow")) {
      const isInput = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      if (isInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      e.preventDefault();
      const focusable = Array.from(document.querySelectorAll(".btn, .md-input, .md-select, .match-card"));
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

  async function doLogout() {
    try { await logout(); } catch (e) { /* ignore */ }
    setStoredToken("");
    push("/auth");
  }

  async function loadProfile() {
    loading = true;
    try {
      const me = await fetchMe();
      profileData = me;
      editProfileForm.username = me.username;
    } catch (e) {
      toast.fromError(e, "toast.profile_load_failed");
    } finally {
      loading = false;
    }
  }

  async function doUpdateProfile() {
    loading = true;
    try {
      const payload = {};
      if (editProfileForm.username !== profileData.username) {
        payload.username = editProfileForm.username;
      }
      if (editProfileForm.newPassword) {
        payload.password = editProfileForm.newPassword;
      }
      await updateMe(payload);
      toast.success("toast.profile_updated");
      if (payload.username) {
        setStoredUser(payload.username);
        profileData.username = payload.username;
      }
      editProfileForm.currentPassword = "";
      editProfileForm.newPassword = "";
    } catch (e) {
      toast.fromError(e, "toast.profile_update_failed");
    } finally {
      loading = false;
    }
  }

  function openProfile() {
    userDropdownOpen = false;
    view = "profile";
    loadProfile();
  }

  $effect(() => {
    load();
    window.addEventListener("keydown", handleKey);
    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleClickOutside);
    };
  });
</script>

<main class="page-screen">
  <header class="page-top">
    <h1 class="page-title">KRPS</h1>
    <div style="display:flex;gap:8px;align-items:center;">
      <div style="position:relative;">
        <button class="btn icon" onclick={() => push("/rules")} title={$_("home.rules")}><AppIcon name="menu-book" /></button>
      </div>
      <div class="lang-switcher" style="position:relative;">
        <button class="btn icon" onclick={toggleLangDropdown} title={$_("home.language")}><AppIcon name="translate" /></button>
        {#if langDropdownOpen}
          <div class="dropdown">
            {#each availableLangs as lang}
              <button class="dropdown-item" class:active={$locale === lang.code} onclick={() => selectLang(lang.code)}>{lang.name}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="user-menu-wrapper" style="position:relative;">
        <button class="btn icon" onclick={toggleUserDropdown} title={$_("home.user")}><AppIcon name="person" /></button>
        {#if userDropdownOpen}
          <div class="dropdown">
            <button class="dropdown-item" onclick={openProfile}><AppIcon name="settings" /> {$_("profile.manage")}</button>
            <button class="dropdown-item" onclick={doLogout}><AppIcon name="logout" /> {$_("profile.logout")}</button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <!-- Menu View -->
  {#if view === "menu"}
    <div class="page-body">
        <div class="home-hero">
          <div class="home-play-row">
            <button class="btn primary home-play" onclick={quickPlay} disabled={loading}>{$_("home.quick_play")}</button>
            <button class="btn home-resume" disabled={!activeGame} onclick={() => activeGame && (activeGame.mode === "human-vs-human" ? push(`/room/${activeGame.id}/battle`) : push(`/battle/${activeGame.id}`))}>{$_("home.resume")}</button>
          </div><div class="home-actions">
            <button class="btn home-act" onclick={openPlayConfig} disabled={loading}><AppIcon name="deployed-code" /><span>{$_("home.custom")}</span></button>
            <button class="btn home-act" onclick={() => (view = "multiplayer")} disabled={loading}><AppIcon name="person" /><span>{$_("home.multiplayer")}</span></button>
          </div>
        </div>

        <div class="home-list-area">
          <div class="home-tabs">
            <div style="width:36px;"></div>
            <div style="flex:1;display:flex;justify-content:center;gap:8px;">
              <button class="btn text sm" class:primary={matchesTab === 'rooms'} onclick={() => (matchesTab = 'rooms')}>{$_("rooms.public")}</button>
              <button class="btn text sm" class:primary={matchesTab === 'games'} onclick={() => (matchesTab = 'games')}>{$_("home.my_games")}</button>
            </div>
            <button class="btn icon" onclick={load} disabled={loading}><AppIcon name="refresh" /></button>
          </div>
          <div class="home-list">
            
            {#if matchesTab === 'rooms'}
              {#if filteredRooms.length === 0}
                <div class="app-empty">{$_("home.no_rooms")}</div>
              {:else}
                {#each filteredRooms as room (room.id)}
                  <button class="match-card" onclick={() => openRoom(room)}>
                    <div>
                      <div style="font-weight:700;">{room.name}</div>
                      <div style="font-size:12px;color:rgba(255,255,255,0.4);">{room.players.A?.username || $_("home.host")} vs {room.players.B?.userId ? room.players.B.username : $_("home.waiting")}</div>
                    </div>
                    <span class="status waiting">WAITING</span>
                  </button>
                {/each}
              {/if}
            {:else}
              {#if myGames.length === 0}
                <div class="app-empty">{$_("home.no_games")}</div>
              {:else}
                {#each myGames as game (game.id)}
                  <button class="match-card" onclick={(e) => { if (e.target.closest('.js-manage')) return; game.mode === "human-vs-human" ? openRoom(game) : push(`/${game.status === "finished" ? "replay" : "battle"}/${game.id}`); }}>
                    <div>
                      <div style="font-weight:700;">{game.name}</div>
                      <div style="font-size:12px;color:rgba(255,255,255,0.4);">{game.mode === "human-vs-human" ? `${game.players.A?.username || $_("home.host")} vs ${game.players.B?.username || $_("home.waiting")}` : `R${game.roundCount} · ${game.mode}`}</div>
                    </div>
                    {#if game.isOwner && game.mode === "human-vs-human"}
                      <span class="btn text js-manage" style="font-size:11px;padding:2px 8px;height:auto;cursor:pointer;margin-left:auto;margin-right:8px;" onclick={() => openManageDialog(game)} onkeydown={(e) => e.key === 'Enter' && openManageDialog(game)}>{$_("home.manage")}</span>
                    {/if}
                    <span class="status {game.status}">{game.status}</span>
                  </button>
                {/each}
              {/if}
            {/if}
            
          </div>
        </div>
      </div>

      <footer class="page-footer">
        <button class="btn text" onclick={() => push("/leaderboard")}><AppIcon name="leaderboard" /><span>{$_("home.leaderboard")}</span></button>
        <button class="btn text" onclick={() => push("/info")}><AppIcon name="info" /><span>{$_("home.info")}</span></button>
      </footer>

    {:else}
      <div class="page-body center">
        <div class="app-surface page-panel">

          {#if view === "play_config"}
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <h3 style="margin:0;color:var(--color-primary);">{$_("home.custom_title")}</h3>
              <button class="btn icon" onclick={() => (view = "menu")}><AppIcon name="close" /></button>
            </div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <label class="md-field">
              <input class="md-input" type="text" bind:value={form.name} placeholder=" " disabled={loading} />
              <span class="md-label">{$_("home.game_name")}</span>
            </label>
            <label class="md-field strategy-dropdown">
              <button class="md-select" style="text-align:left;" onclick={() => (strategyOpen = !strategyOpen)} disabled={loading}>
                {strategies.find(s => s.id === form.botStrategy)?.name || $_("home.select_strategy")}
              </button>
              {#if strategyOpen}
                <div class="strategy-menu">
                  {#each strategies as s (s.id)}
                    <button class="strategy-item" class:active={form.botStrategy === s.id} onclick={() => { form.botStrategy = s.id; strategyOpen = false; }}>{s.name}</button>
                  {/each}
                </div>
              {/if}
              <span class="md-label" class:floating={form.botStrategy}>{$_("home.bot_strategy")}</span>
            </label>
            {#if strategies.length}
              {@const selected = strategies.find(s => s.id === form.botStrategy)}
              {#if selected}
                <p style="font-size:13px;color:rgba(255,255,255,0.4);margin:0;"><strong style="color:#fff;">{selected.name}</strong> — {selected.description}</p>
              {/if}
            {/if}
            <button class="btn primary lg" style="width:100%;margin-top:8px;" onclick={doCreateBotMatch} disabled={loading}>{$_("home.start_game")}</button>
          </div>

        {:else if view === "multiplayer"}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;color:var(--color-primary);">{$_("home.multiplayer_title")}</h3>
            <button class="btn icon" onclick={() => (view = "menu")}><AppIcon name="close" /></button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <button class="btn primary lg" onclick={() => (view = "create_room")}>{$_("home.create")}</button>
              <button class="btn lg" onclick={() => (view = "join_room")}>{$_("home.join")}</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn text sm" class:primary={roomTab === 'public'} onclick={() => (roomTab = 'public')}>{$_("rooms.public")}</button>
              <button class="btn text sm" class:primary={roomTab === 'my'} onclick={() => (roomTab = 'my')}>{$_("rooms.my")}</button>
              <button class="btn icon" style="margin-left:auto;" onclick={load} disabled={loading}><AppIcon name="refresh" /></button>
            </div>
            <div style="max-height:260px;overflow:auto;">
              {#if filteredRooms.length === 0}
                <div class="app-empty">{$_("home.no_rooms_found")}</div>
              {:else}
                {#each filteredRooms as room (room.id)}
                  <button class="match-card" onclick={(e) => { if (e.target.closest('.js-manage')) return; openRoom(room); }}>
                    <div>
                      <div style="font-weight:700;">{room.name}</div>
                      <div style="font-size:12px;color:rgba(255,255,255,0.4);">{room.players.A?.username || $_("home.host")} vs {room.players.B?.userId ? room.players.B.username : $_("home.waiting")}</div>
                    </div>
                    {#if room.isOwner && room.mode === "human-vs-human"}
                      <span class="btn text js-manage" style="font-size:11px;padding:2px 8px;height:auto;cursor:pointer;margin-left:auto;margin-right:8px;" onclick={() => openManageDialog(room)} onkeydown={(e) => e.key === 'Enter' && openManageDialog(room)}>{$_("home.manage")}</span>
                    {/if}
                    <span class="status waiting">WAITING</span>
                  </button>
                {/each}
              {/if}
            </div>
          </div>

        {:else if view === "create_room"}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;color:var(--color-primary);">{$_("home.create_room_title")}</h3>
            <button class="btn icon" onclick={() => (view = "multiplayer")}><AppIcon name="close" /></button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <label class="md-field">
              <input class="md-input" type="text" bind:value={form.name} placeholder=" " disabled={loading} />
              <span class="md-label">{$_("home.room_name")}</span>
            </label>
            <label class="md-checkbox">
              <input type="checkbox" bind:checked={form.isPublic} />
              <span>{$_("home.public_room")}</span>
            </label>
            <button class="btn primary lg" style="width:100%;" onclick={doCreateRoom} disabled={loading}>{$_("home.create_room")}</button>
          </div>

        {:else if view === "join_room"}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;color:var(--color-primary);">{$_("home.join_room_title")}</h3>
            <button class="btn icon" onclick={() => (view = "multiplayer")}><AppIcon name="close" /></button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <label class="md-field">
              <input class="md-input" type="text" bind:value={form.inviteCode} placeholder=" " maxlength="6" disabled={loading} />
              <span class="md-label">{$_("home.invite_code")}</span>
            </label>
            <button class="btn primary lg" style="width:100%;" onclick={doJoinRoom} disabled={loading || form.inviteCode.length !== 6}>{$_("home.join_room")}</button>
          </div>

        {:else if view === "profile"}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;color:var(--color-primary);">{$_("profile.title")}</h3>
            <button class="btn icon" onclick={() => (view = "menu")}><AppIcon name="close" /></button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <label class="md-field">
              <input class="md-input" type="text" bind:value={editProfileForm.username} placeholder=" " disabled={loading} />
              <span class="md-label">{$_("profile.username")}</span>
            </label>
            <label class="md-field">
              <input class="md-input" type="password" bind:value={editProfileForm.newPassword} placeholder=" " disabled={loading} />
              <span class="md-label">{$_("profile.new_password")}</span>
            </label>
            <button class="btn primary lg" style="width:100%;" onclick={doUpdateProfile} disabled={loading}>{$_("profile.update_btn")}</button>
          </div>
        {/if}

      </div>
    </div>
  {/if}

  {#if manageDialog.open}
    <div class="modal-overlay" onclick={closeManageDialog} onkeydown={(e) => e.key === 'Escape' && closeManageDialog()}>
      <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
        {#if manageDialog.step === "menu"}
          <h3 style="margin:0 0 12px;font-size:16px;">{$_("home.manage")} — {manageDialog.room.name}</h3>
          <button class="btn primary" style="width:100%;margin-bottom:8px;" onclick={() => (manageDialog.step = "rename")}>{$_("home.rename_btn")}</button>
          <button class="btn warn" style="width:100%;margin-bottom:8px;" onclick={doDeleteRoom} disabled={loading}>{$_("home.delete_btn")}</button>
          <button class="btn text" style="width:100%;" onclick={closeManageDialog}>{$_("home.cancel")}</button>
        {:else if manageDialog.step === "rename"}
          <h3 style="margin:0 0 12px;font-size:16px;">{$_("home.rename_btn")}</h3>
          <label class="md-field" style="margin-bottom:12px;">
            <input class="md-input" type="text" bind:value={manageDialog.newName} placeholder=" " onkeydown={(e) => e.key === 'Enter' && doRename()} />
            <span class="md-label">{$_("home.room_name")}</span>
          </label>
          <div style="display:flex;gap:8px;">
            <button class="btn primary" style="flex:1;" onclick={doRename} disabled={loading || !manageDialog.newName.trim()}>{$_("home.confirm")}</button>
            <button class="btn text" style="flex:1;" onclick={() => (manageDialog.step = "menu")}>{$_("home.cancel")}</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1000; }
  .modal-box { background:var(--color-surface-container); border-radius:var(--radius-xl); padding:24px; min-width:280px; max-width:360px; width:90%; }
  .strategy-dropdown { position:relative; }
  .strategy-dropdown .md-select { padding-right:36px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.6)' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center; }
  .strategy-menu { position:absolute; top:100%; left:0; right:0; z-index:100; background:var(--color-surface-container); border-radius:var(--radius-md); margin-top:4px; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,0.5); }
  .strategy-item { display:block; width:100%; padding:10px 14px; border:none; background:transparent; color:#fff; font-size:13px; text-align:left; cursor:pointer; font-family:inherit; transition:background 0.15s; }
  .strategy-item:hover { background:rgba(255,255,255,0.06); }
  .strategy-item.active { color:var(--color-primary); }
  .md-label.floating { top:6px; font-size:11px; color:var(--color-primary); font-weight:600; }
  .home-hero { display:flex; flex-direction:column; align-items:center; padding:80px 0 12px; gap:16px; }
  .home-play-row { display:flex; gap:8px; width:100%; max-width:300px; }
  .home-play { flex:3; height:56px; font-size:16px; font-weight:700; letter-spacing:2px; border-radius:999px 150px 150px 999px; }
  .home-resume { flex:1; height:56px; font-size:16px; font-weight:700; background:rgba(255,255,255,0.06); border-radius:150px 999px 999px 150px; }
  .home-actions { display:flex; gap:8px; width:100%; max-width:300px; }
  .home-act { flex:1; height:44px; font-size:12px; }
  .home-act:first-child { border-radius:999px 150px 150px 999px; }
  .home-act:last-child { border-radius:150px 999px 999px 150px; }
  .home-list-area { flex:1; display:flex; flex-direction:column; min-height:0; }
  .home-tabs { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .home-list { flex:1; overflow-y:auto; overflow-x:hidden; min-height:0; padding:2px; margin:-2px; mask-image:linear-gradient(to bottom,black 92%,transparent 100%); -webkit-mask-image:linear-gradient(to bottom,black 92%,transparent 100%); }

  @media (max-width: 400px) {
    .home-hero { padding: 56px 0 20px; gap: 12px; }
    .home-play-row { max-width: 100%; }
    .home-play { font-size: 14px; letter-spacing: 1px; height: 48px; }
    .home-resume { font-size: 14px; height: 48px; }
    .home-actions { max-width: 100%; }
    .home-act { font-size: 11px; height: 38px; }
    .home-act span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-tabs { gap: 4px; }
    .home-tabs .btn.sm { padding: 0 8px; font-size: 11px; }
  }
</style>
