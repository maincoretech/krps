const BASE_URL = "http://127.0.0.1:3000";
const BENCHMARK_USERNAME = "bench_user_" + Date.now();
const BENCHMARK_PASSWORD = "password123";

async function fetchApi(path, options = {}) {
  // Routes are directly under /auth and /matches etc, not /api/auth
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
  };

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(`API Error [${res.status}]: ${data.message || JSON.stringify(data)}`);
  }
  return data.data;
}

async function setupBenchmarkUser() {
  console.log(`Registering benchmark user: ${BENCHMARK_USERNAME}`);
  try {
    await fetchApi("/auth/register", {
      method: "POST",
      body: { username: BENCHMARK_USERNAME, password: BENCHMARK_PASSWORD }
    });
  } catch (e) {
    // console.warn("Register warning (might exist):", e.message);
  }

  const loginData = await fetchApi("/auth/login", {
    method: "POST",
    body: { username: BENCHMARK_USERNAME, password: BENCHMARK_PASSWORD }
  });
  
  return loginData.token;
}

async function createMatch(token) {
  return fetchApi("/matches", {
    method: "POST",
    token,
    body: { mode: "human-vs-bot", botStrategy: "random" }
  });
}

async function playRounds(matchId, token) {
  // Submit moves via WebSocket to simulate the exact real-time flow
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:3000/`);
    let roundsPlayed = 0;
    
    ws.onopen = () => {
      // Authenticate and get initial state
      ws.send(JSON.stringify({ action: "getMatch", token, matchId }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.error) {
        ws.close();
        return reject(new Error(msg.error));
      }

      if (msg.action === "match") {
        const match = msg.data;
        if (match.status === "finished") {
          ws.close();
          resolve(roundsPlayed);
          return;
        }

        // Determine a valid card to play (0, 1, or 2)
        const myHand = match.players.A.hand;
        const validCards = myHand.filter(c => c !== undefined && c !== null);
        const cardToPlay = validCards[Math.floor(Math.random() * validCards.length)];

        if (cardToPlay === undefined) {
            // Failsafe
            ws.close();
            resolve(roundsPlayed);
            return;
        }

        // Submit move via HTTP
        if (!ws.moveSubmittedRound || ws.moveSubmittedRound < match.roundCount + 1) {
          ws.moveSubmittedRound = match.roundCount + 1;
          ws.send(JSON.stringify({
            action: "submitMove",
            token,
            matchId,
            payload: { card: cardToPlay }
          }));
        }
      }

      if (msg.action === "moveResult") {
        roundsPlayed++;
        // The server will broadcast "match" state update immediately after "moveResult"
        // so we don't explicitly need to call getMatch again, the next message will be action: "match"
      }
    };

    ws.onerror = (err) => {
      reject(err);
    };
  });
}

async function runNetworkBenchmark() {
  console.log("==================================================");
  console.log("Starting Network WebSocket/HTTP Benchmark...");
  console.log("Make sure the backend server is running on :3000");
  console.log("==================================================\n");

  let token;
  try {
    token = await setupBenchmarkUser();
  } catch (err) {
    console.error("Failed to setup user. Is the server running?");
    console.error(err.message);
    process.exit(1);
  }

  const CONCURRENT_GAMES = 100; // Number of games playing simultaneously
  const TARGET_GAMES_TOTAL = 1000; // Total games to play

  console.log(`Configuration:`);
  console.log(`- Target Total Games: ${TARGET_GAMES_TOTAL}`);
  console.log(`- Concurrency (Active WS Connections): ${CONCURRENT_GAMES}\n`);

  let completedGames = 0;
  let totalRoundsPlayed = 0;
  let activePromises = new Set();
  
  const startTime = performance.now();
  let lastLogTime = startTime;

  async function worker() {
    while (completedGames + activePromises.size < TARGET_GAMES_TOTAL) {
      const match = await createMatch(token);
      const promise = playRounds(match.id, token);
      activePromises.add(promise);
      
      try {
        const rounds = await promise;
        totalRoundsPlayed += rounds;
        completedGames++;
        
        if (completedGames % 50 === 0) {
            const now = performance.now();
            const elapsed = (now - lastLogTime) / 1000;
            console.log(`[Progress] Completed ${completedGames}/${TARGET_GAMES_TOTAL} matches | Active WS: ${activePromises.size - 1} | ${(50 / elapsed).toFixed(1)} games/sec`);
            lastLogTime = now;
        }
      } catch (err) {
        console.error("Game simulation failed:", err.message);
      } finally {
        activePromises.delete(promise);
      }
    }
  }

  console.log("Spawning connection workers...");
  // Spawn initial workers up to CONCURRENT_GAMES limit
  const workers = [];
  for (let i = 0; i < CONCURRENT_GAMES; i++) {
    workers.push(worker());
  }

  // Wait for all workers to finish
  await Promise.all(workers);

  const endTime = performance.now();
  const totalTimeSec = (endTime - startTime) / 1000;
  
  console.log("\n================ NETWORK BENCHMARK RESULTS ================");
  console.log(`Total Games Completed : ${completedGames}`);
  console.log(`Total Rounds Played   : ${totalRoundsPlayed}`);
  console.log(`Total Time            : ${totalTimeSec.toFixed(2)} seconds`);
  console.log(`Game Throughput       : ${(completedGames / totalTimeSec).toFixed(2)} games / second`);
  console.log(`Round Throughput      : ${(totalRoundsPlayed / totalTimeSec).toFixed(2)} rounds / second`);
  console.log("===========================================================\n");
}

runNetworkBenchmark().catch(console.error);
