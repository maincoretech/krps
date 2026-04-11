# 478

Persistent card-game backend with:

- user registration and login
- bearer-token authentication
- persistent users, sessions, and games in `data/store.json`
- game export for one game or all games

## Rules

- Player A and Player B both start with `["scissors", "rock", "paper"]`.
- The pool starts with `["scissors", "scissors", "rock", "paper"]`.
- Base round rule:
  - tie: both players take their card back
  - non-tie: winner keeps the winning card, loser puts the losing card into the pool, then winner randomly draws 1 card from the pool
- A player who reaches 0 cards after resolution loses the game.
- Special rule 1:
  - only active in the first 3 rounds
  - if one player loses 2 rounds in a row, that player puts their remaining card into the pool and randomly draws 1 card back
- Special rule 2:
  - if total tie count equals a player's hand size, that player may put 1 chosen hand card into the pool and randomly draw 1 card back

## Run

```bash
npm install
npm start
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

### `GET /games`

Get the current user's game list.

### `POST /games`

Create a new game.

Request body:

```json
{
  "name": "ranked-1"
}
```

`name` is optional.

### `GET /games/:gameId`

Get one full game state.

### `POST /games/:gameId/round`

Resolve one round.

Request body:

```json
{
  "cardA": "rock",
  "cardB": "scissors"
}
```

Allowed values:

- `scissors`
- `rock`
- `paper`

### `POST /games/:gameId/exchange`

Use the tie-exchange rule.

Request body:

```json
{
  "playerId": "A",
  "card": "paper"
}
```

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
