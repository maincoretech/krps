<script>
  import Router from "svelte-spa-router";
  import Auth from "./view/Auth.svelte";
  import GamesList from "./view/GamesList.svelte";
  import Battle from "./view/Battle.svelte";
  import RoomLobby from "./view/RoomLobby.svelte";
  import Information from "./view/Information.svelte";
  import Leaderboard from "./view/Leaderboard.svelte";
  import OfflineBattle from "./view/OfflineBattle.svelte";
  import Replay from "./view/Replay.svelte";
  import Rules from "./view/Rules.svelte";
  import ToastContainer from "./lib/ToastContainer.svelte";
  import { wrap } from "svelte-spa-router/wrap";
  import { push } from "svelte-spa-router";
  import { getStoredToken } from "./lib/user.js";
  import { i18nReady } from "./lib/i18n.js";

  let ready = $state(false);
  i18nReady.then(() => { ready = true; });

  function authGuard() {
    const token = getStoredToken();
    if (!token) {
      push("/auth");
      return false;
    }
    return true;
  }

  const routes = {
    "/": GamesList,
    "/auth": Auth,
    "/games": wrap({
      component: GamesList,
      conditions: [authGuard],
    }),
    "/battle/:id": wrap({
      component: Battle,
      conditions: [authGuard],
    }),
    "/room/:id": wrap({
      component: RoomLobby,
      conditions: [authGuard],
    }),
    "/room/:id/battle": wrap({
      component: Battle,
      conditions: [authGuard],
    }),
    "/info": wrap({
      component: Information,
      conditions: [authGuard],
    }),
    "/leaderboard": wrap({
      component: Leaderboard,
      conditions: [authGuard],
    }),
    "/offline": OfflineBattle,
    "/replay/:id": wrap({
      component: Replay,
      conditions: [authGuard],
    }),
    "/rules": wrap({
      component: Rules,
      conditions: [authGuard],
    }),
    "*": GamesList,
  };
</script>

<main>
  {#if ready}
    <Router {routes} />
    <ToastContainer />
  {:else}
    <div class="app-page"><div class="app-surface" style="text-align:center;padding:40px;">Loading...</div></div>
  {/if}
</main>
