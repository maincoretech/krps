# 478

Persistent card-game backend with:

- user registration and login
- bearer-token authentication
- persistent users, sessions, and games in Bun SQLite `data/store.sqlite`
- one-game export and full export
- multiple bot algorithms
- human-vs-bot and human-vs-human room play

## Game Modes

### Human vs Bot

- Player `A` is the human.
- Player `B` is the machine.
- Every new game stores one bot strategy.
- The human chooses only `cardA`.
- The machine chooses `cardB` automatically from its strategy.

### Human vs Human

- Create a room first, then share a one-time 6-digit invite code.
- After the second player joins, both players press start in the waiting room.
- The room switches into a single running match.
- During each round, both players lock in one card; the round resolves when both sides have submitted.
- After settlement, both players can choose rematch; when both confirm, the next match starts immediately in the same room.

## Bot Strategies

- `random`: random legal card, random exchange
- `pattern`: rotate through scissors, rock, paper
- `counter`: choose the card with the best expected result against the current human hand
- `adaptive`: predict the human move from history, then counter it
- `defensive`: prefer cards with lower loss risk, even if it causes more ties
- `streak`: switch by momentum, use pattern when stable and counter when losing

The bot also auto-uses the tie-exchange rule for player `B` when it becomes available.

## Rules

- Human and machine both start with `["scissors", "rock", "paper"]`.
- The pool starts with `["scissors", "scissors", "rock", "paper"]`.
- Base round rule:
  - tie: both sides take their card back
  - non-tie: winner keeps the winning card, loser puts the losing card into the pool, then winner randomly draws 1 card from the pool
- A player who reaches 0 cards after resolution loses the game.
- Special rule 1:
  - only active in the first 3 rounds
  - if one side loses 2 rounds in a row, that side puts the remaining card into the pool and randomly draws 1 card back
- Special rule 2:
  - if total tie count equals a player's hand size, that player can exchange 1 hand card with the pool
  - when a player has only 1 card left, a tie in that round also enables tie-exchange (single-card edge case)
  - player `A` triggers this manually with the exchange API
  - player `B` triggers this automatically from its bot logic

## Run

```bash
bun install
bun dev
```

Or run the executable entry directly:

```bash
bun run index.js start
```

Available CLI commands:

- `start`: start API and admin services
- `config`: interactive config wizard
- `passwd`: reset the level 0 super admin password
- `install`: install a systemd service unit on Linux
- `remove`: remove the systemd service unit
- `status`: print current config and executable status
- `help`: print command help

Admin panel:

- default URL: `http://localhost:47807`
- allowed roles: level `0` and level `1`
- features:
  - admin login/logout
  - user management
  - application and match logs
  - config editing for hostname, ports, description, token TTL and frontend origin whitelist

Optional env vars:

- `SERVER_HOSTNAME`
- `SERVER_PORT`
- `SERVER_NAME`
- `SERVER_DESCRIPTION`
- `ADMIN_PORT`
- `ALLOWED_ORIGINS`
- `AUTH_TOKEN_TTL_HOURS`

Default storage file:

```text
data/store.sqlite
```

Runtime config is also stored in SQLite table `system_config`.

On first startup, the backend will try to migrate legacy data from `data.db` and `data/store.json` into SQLite. If an old `data/config.json` exists and the database config table is empty, it will also be imported automatically.

