const API = "http://localhost:3000";
let token = "";

async function fetchApi(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Error");
  return data.data;
}

async function main() {
  try {
    const user = { username: "testuser_" + Date.now(), password: "password" };
    console.log("Registering...", user);
    await fetchApi("/auth/register", { method: "POST", body: JSON.stringify(user) });
    
    console.log("Logging in...");
    const auth = await fetchApi("/auth/login", { method: "POST", body: JSON.stringify(user) });
    token = auth.token;
    
    console.log("Dashboard...");
    const dashboard = await fetchApi("/dashboard");
    console.log("Dashboard rooms:", dashboard.rooms.length, "games:", dashboard.games.length);
    
    console.log("Creating game...");
    const game = await fetchApi("/games", { method: "POST", body: JSON.stringify({ name: "Test Game", botStrategy: "random" }) });
    console.log("Game created. ID:", game.id);
    
    console.log("Playing round...");
    const cardToPlay = game.players.A.hand[0];
    const round = await fetchApi(`/games/${game.id}/round`, { method: "POST", body: JSON.stringify({ cardA: cardToPlay }) });
    console.log("Round result:", round.round.result);
  } catch (e) {
    console.error("Error:", e);
  }
}

main();