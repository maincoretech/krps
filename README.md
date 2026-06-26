# KRPS

RPS 卡牌对战 · Bun monorepo（Client + Server + Shared）

## 项目结构

```
krps/
├── packages/
│   ├── client/    # Svelte 5 前端 (Vite)
│   ├── server/    # Elysia 后端 (Bun)
│   └── shared/    # 共享游戏逻辑 & AI
├── package.json   # monorepo scripts
└── README.md
```

## 快速开始

```bash
bun install
bun dev                  # 仅后端
bun run dev:client       # 仅前端
```

前端 `http://localhost:47808` · 后端 API `:3000` · 管理后台 `:47807`

## 模式

- **人机对战** — 多种 Bot 策略
- **房间对战** — 邀请码 / 公开房间，双人实时
- **离线模式** — 本地 Bot 对战，无需登录
- **回放** — 逐回合手牌/牌堆回放，自动播放

## 功能

- 注册登录 · Token 鉴权 · Turnstile 验证
- WebSocket 实时同步 · 重连
- i18n（简体中文 / 繁體中文 / English）
- SQLite 持久化
- 管理后台 + CLI

## 脚本

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动后端 (API + WS + Admin) |
| `bun run dev:client` | 启动前端 (Vite HMR) |
| `bun run build:client` | 构建前端 |
| `bun test` | 运行测试 |

## CLI

- `start` — 启动服务
- `config` — 配置服务
- `passwd` — 重置管理员密码
- `install` / `remove` — 安装/移除系统服务
- `status` — 查看状态

## 环境变量

`SERVER_HOSTNAME` · `SERVER_PORT` · `SERVER_NAME` · `SERVER_DESCRIPTION` · `ADMIN_PORT` · `ALLOWED_ORIGINS` · `AUTH_TOKEN_TTL_HOURS` · `TURNSTILE_SECRET_KEY`

## 存储

```text
data/store.sqlite
```

## 后台

`http://localhost:47807` — 用户、日志、配置管理

---

## English

RPS card battle game · Bun monorepo (Client + Server + Shared)

### Project Structure

```
krps/
├── packages/
│   ├── client/    # Svelte 5 frontend (Vite)
│   ├── server/    # Elysia backend (Bun)
│   └── shared/    # Shared game logic & AI
```

### Quick Start

```bash
bun install
bun dev                  # backend only
bun run dev:client       # frontend only
```

Frontend `http://localhost:47808` · API `:3000` · Admin `:47807`

### Modes

- **Bot Match** — multiple bot strategies
- **Room Match** — invite code / public rooms, real-time PVP
- **Offline** — local bot battle, no login required
- **Replay** — per-round hand/pool playback with auto-play

### Features

- Auth (register/login) · Token · Turnstile
- WebSocket real-time sync with reconnect
- i18n (简体中文 / 繁體中文 / English)
- SQLite persistence
- Admin panel + CLI

### Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start backend |
| `bun run dev:client` | Start frontend (HMR) |
| `bun run build:client` | Build frontend |
| `bun test` | Run tests |

### Storage

```text
data/store.sqlite
```

### Admin

`http://localhost:47807` — users, logs, config
