# 478

Persistent human-vs-bot card-game backend with:

- user registration and login
- bearer-token authentication
- persistent users, sessions, and games in `data/store.json`
- one-game export and full export
- multiple bot algorithms

## Game Mode

- Player `A` is the human.
- Player `B` is the machine.
- Every new game stores one bot strategy.
- The human chooses only `cardA`.
- The machine chooses `cardB` automatically from its strategy.

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

Optional env vars:

- `SERVER_HOSTNAME`
- `SERVER_PORT`
- `SERVER_NAME`
- `AUTH_TOKEN_TTL_HOURS`

Default storage file:

```text
data/store.json
```

## Auth API

### `POST /auth/register`

Request body:

```json
{
  "username": "demo_user",
  "password": "strong-password"
}
```

Rules:

- `username`: 3-32 chars, only letters, numbers, `_`, `-`
- `password`: at least 8 chars

### `POST /auth/login`

Request body:

```json
{
  "username": "demo_user",
  "password": "strong-password"
}
```

Response data:

```json
{
  "token": "bearer-token",
  "expiresAt": "2026-04-12T00:00:00.000Z",
  "user": {
    "id": "user-id",
    "username": "demo_user",
    "createdAt": "2026-04-12T00:00:00.000Z"
  }
}
```

### `GET /auth/me`

Header:

```text
Authorization: Bearer <token>
```

### `POST /auth/logout`

Header:

```text
Authorization: Bearer <token>
```

## Game API

All game APIs below require:

```text
Authorization: Bearer <token>
```

### `GET /server/information`

Returns server data plus `botStrategies`.

### `GET /games`

Get the current user's game list.

Each game summary includes:

- `mode`
- `botStrategy`
- `botStrategyName`

### `POST /games`

Create a new human-vs-bot game.

Request body:

```json
{
  "name": "ranked-1",
  "botStrategy": "adaptive"
}
```

`name` is optional.  
`botStrategy` is optional and defaults to `random`.

### `GET /games/:gameId`

Get one full game state.

Important fields in the response:

- `mode`
- `humanPlayerId`
- `bot.playerId`
- `bot.strategy`
- `bot.strategyName`
- `bot.strategyDescription`

### `POST /games/:gameId/round`

Resolve one human-vs-bot round.

Request body:

```json
{
  "cardA": "rock"
}
```

Allowed values:

- `scissors`
- `rock`
- `paper`

The backend will choose `cardB` automatically.

`round` response includes:

- `cards.A`
- `cards.B`
- `botDecision.strategy`
- `botDecision.reason`
- `specialActions`

### `POST /games/:gameId/exchange`

Use the tie-exchange rule for the human side.

Request body:

```json
{
  "playerId": "A",
  "card": "paper"
}
```

Only player `A` can call this in human-vs-bot mode.

### `GET /games/:gameId/export`

Export one game as JSON download.

### `GET /games-export`

Export all current-user games as JSON download.

## Response format

Success:

```json
{
  "status": true,
  "message": "message",
  "data": {}
}
```

Error:

```json
{
  "status": false,
  "message": "error message",
  "data": {}
}
```
