<script>
  import Icon from "@iconify/svelte";

  let { name = "help", ...extra } = $props();

  const map = {
    close: "material-symbols:close",
    refresh: "material-symbols:refresh",
    translate: "material-symbols:translate",
    "menu-book": "material-symbols:menu-book",
    person: "material-symbols:person",
    lock: "material-symbols:lock",
    settings: "material-symbols:settings",
    sync: "material-symbols:sync",
    "deployed-code": "material-symbols:deployed-code",
    draft: "material-symbols:draft",
    "content-cut": "material-symbols:content-cut",
    help: "material-symbols:help",
    logout: "material-symbols:logout",
    leaderboard: "material-symbols:leaderboard",
    info: "material-symbols:info",
  };

  let iconName = $derived(map[name] || `material-symbols:${name}`);
</script>

<Icon icon={iconName} {...extra} />
