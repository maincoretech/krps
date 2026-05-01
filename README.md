# 478 Backend

极简对战后端。  
Minimal battle backend.

## 规则 / Rules

- 双方初始手牌相同。 / Both sides start with the same hand.
- 牌型规则为石头剪刀布。 / The card rule is rock-paper-scissors.
- 平局时双方收回原牌。 / On a tie, both take their cards back.
- 非平局时，败方弃牌入池，胜方随机补一张。 / On a non-tie, the loser sends the card to the pool and the winner draws one.
- 手牌归零即失败。 / A player loses when their hand reaches zero.
- 前 3 回合内，连输 2 回合会触发补牌规则。 / In the first 3 rounds, losing 2 in a row triggers recovery.
- 平局次数达到手牌数时可换牌。 / A player can exchange when tie count reaches hand size.

## 模式 / Modes

- 人机对战：玩家出牌，机器人自动响应。 / Bot match: the player moves, the bot responds.
- 房间对战：双方都出牌后结算。 / Room match: resolution starts after both players move.
- 支持同房间连续再战。 / Supports rematch in the same room.

## 功能 / Features

- 注册与登录 / Register and login
- Token 鉴权 / Token auth
- SQLite 持久化 / SQLite persistence
- WebSocket 实时同步 / WebSocket real-time sync
- 多种 Bot 策略 / Multiple bot strategies
- 管理后台与 CLI / Admin panel and CLI

## 运行 / Run

```bash
bun install
bun dev
```

```bash
bun run index.js start
```

## CLI

- `start` 启动服务 / start services
- `config` 配置服务 / edit config
- `passwd` 重置管理员密码 / reset admin password
- `install` 安装系统服务 / install service
- `remove` 移除系统服务 / remove service
- `status` 查看状态 / show status

## 环境变量 / Env

- `SERVER_HOSTNAME`
- `SERVER_PORT`
- `SERVER_NAME`
- `SERVER_DESCRIPTION`
- `ADMIN_PORT`
- `ALLOWED_ORIGINS`
- `AUTH_TOKEN_TTL_HOURS`

## 存储 / Storage

```text
data/store.sqlite
```

## 后台 / Admin

- 默认地址：`http://localhost:47807` / Default URL: `http://localhost:47807`
- 支持用户、日志、配置管理。 / Manages users, logs, and config.
