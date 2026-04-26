const app = document.querySelector("#app");
const tokenKey = "478-admin-token";

const state = {
  token: localStorage.getItem(tokenKey) ?? "",
  me: null,
  activeView: "overview",
  overview: null,
  users: [],
  logs: [],
  logsScope: "app",
  config: null,
  message: "",
};

function roleName(role) {
  if (role === 0) return "超级管理员";
  if (role === 1) return "管理员";
  return "普通用户";
}

function setMessage(text) {
  state.message = text;
  render();
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({ status: false, message: "Invalid response." }));
  if (!response.ok || payload.status === false) {
    throw new Error(payload.message || `Request failed: ${response.status}`);
  }
  return payload.data;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: form.get("username"),
      password: form.get("password"),
    }),
  });
  state.token = data.token;
  localStorage.setItem(tokenKey, data.token);
  await bootstrap();
}

async function logout() {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch {
  }
  state.token = "";
  state.me = null;
  localStorage.removeItem(tokenKey);
  render();
}

async function bootstrap() {
  if (!state.token) {
    render();
    return;
  }

  try {
    state.me = (await request("/api/auth/me")).user;
    await loadCurrentView();
  } catch (error) {
    localStorage.removeItem(tokenKey);
    state.token = "";
    state.me = null;
    // Do not show auth-related error messages on the login screen
    if (!error.message.toLowerCase().includes("bearer") && !error.message.toLowerCase().includes("token")) {
      setMessage(error.message);
    }
  }
  render();
}

async function loadCurrentView() {
  if (state.activeView === "overview") {
    state.overview = await request("/api/overview");
  } else if (state.activeView === "users") {
    await loadUsers();
  } else if (state.activeView === "logs") {
    await loadLogs();
  } else if (state.activeView === "config") {
    state.config = await request("/api/config");
  }
}

async function switchView(view) {
  state.activeView = view;
  await loadCurrentView();
  render();
}

async function loadUsers() {
  const search = document.querySelector('[name="user-search"]')?.value ?? "";
  const role = document.querySelector('[name="user-role-filter"]')?.value ?? "";
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (role !== "") params.set("role", role);
  state.users = await request(`/api/users?${params.toString()}`);
}

async function loadLogs() {
  const search = document.querySelector('[name="log-search"]')?.value ?? "";
  const level = document.querySelector('[name="log-level"]')?.value ?? "";
  const limit = document.querySelector('[name="log-limit"]')?.value ?? "200";
  const params = new URLSearchParams({ scope: state.logsScope, limit });
  if (search) params.set("search", search);
  if (level) params.set("level", level);
  const result = await request(`/api/logs?${params.toString()}`);
  state.logs = result.items;
}

async function submitCreateUser(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await request("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: form.get("username"),
      password: form.get("password"),
      role: Number(form.get("role")),
    }),
  });
  event.currentTarget.reset();
  await loadUsers();
  setMessage("用户已创建。");
}

async function editUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  const username = window.prompt("输入新的用户名，留空保持不变：", user.username) ?? "";
  const password = window.prompt("输入新密码，留空保持不变：", "") ?? "";
  let role = user.role;
  if (state.me.role === 0) {
    const roleInput = window.prompt("输入角色：0=超级管理员，1=管理员，2=普通用户", String(user.role));
    if (roleInput != null && roleInput.trim() !== "") {
      role = Number(roleInput);
    }
  }

  await request(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({
      username: username.trim() === user.username ? undefined : username.trim(),
      password: password.trim() || undefined,
      role,
    }),
  });
  await loadUsers();
  setMessage("用户信息已更新。");
}

async function resetPassword(userId) {
  const result = await request(`/api/users/${userId}/reset-password`, { method: "POST" });
  window.alert(`用户 ${result.user.username} 的新密码是：${result.password}`);
  setMessage("密码已重置。");
}

async function deleteUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  if (!window.confirm(`确认删除用户 ${user.username} 吗？其游戏和房间数据也会被删除。`)) {
    return;
  }
  await request(`/api/users/${userId}`, { method: "DELETE" });
  await loadUsers();
  setMessage("用户已删除。");
}

async function saveConfig(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    serverName: form.get("serverName"),
    serverDescription: form.get("serverDescription"),
    hostname: form.get("hostname"),
    serverPort: Number(form.get("serverPort")),
    adminPort: Number(form.get("adminPort")),
    authTokenTtlHours: Number(form.get("authTokenTtlHours")),
    serviceName: form.get("serviceName"),
    allowedOrigins: String(form.get("allowedOrigins"))
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean),
  };
  const result = await request("/api/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  state.config = result.config;
  setMessage(result.requiresRestart ? "配置已保存，端口或监听地址变化需要重启服务。" : "配置已保存。");
}

function bindEvents() {
  document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    try {
      await login(event);
    } catch (error) {
      setMessage(error.message);
    }
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await switchView(button.dataset.view);
      } catch (error) {
        setMessage(error.message);
      }
    });
  });

  document.querySelector("#logout-btn")?.addEventListener("click", logout);
  document.querySelector("#reload-overview")?.addEventListener("click", async () => {
    await switchView("overview");
  });
  document.querySelector("#users-refresh")?.addEventListener("click", async () => {
    await loadUsers();
    render();
  });
  document.querySelector("#user-filter-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadUsers();
    render();
  });
  document.querySelector("#create-user-form")?.addEventListener("submit", async (event) => {
    try {
      await submitCreateUser(event);
    } catch (error) {
      setMessage(error.message);
    }
  });
  document.querySelectorAll("[data-edit-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await editUser(button.dataset.editUser);
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
  document.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await resetPassword(button.dataset.resetPassword);
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await deleteUser(button.dataset.deleteUser);
      } catch (error) {
        setMessage(error.message);
      }
    });
  });
  document.querySelectorAll("[data-log-scope]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.logsScope = button.dataset.logScope;
      await loadLogs();
      render();
    });
  });
  document.querySelector("#logs-filter-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadLogs();
    render();
  });
  document.querySelector("#config-form")?.addEventListener("submit", async (event) => {
    try {
      await saveConfig(event);
    } catch (error) {
      setMessage(error.message);
    }
  });
}

function renderLogin() {
  app.innerHTML = `
    <div class="page login-shell">
      <form id="login-form" class="login-card">
        <h1>478 管理后台</h1>
        <p class="muted">仅允许 0 级和 1 级管理员登录。</p>
        ${state.message ? `<div class="message">${state.message}</div>` : ""}
        <div class="field-grid">
          <label>
            <span>用户名</span>
            <input name="username" autocomplete="username" required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
        </div>
        <div class="btn-row">
          <button class="btn" type="submit">登录</button>
        </div>
      </form>
    </div>
  `;
  bindEvents();
}

function renderOverview() {
  const overview = state.overview;
  if (!overview) {
    return `<div class="panel-card">加载中...</div>`;
  }
  const stats = [
    ["用户总数", overview.counts.users],
    ["超级管理员", overview.counts.superAdmins],
    ["管理员", overview.counts.admins],
    ["普通用户", overview.counts.normalUsers],
    ["在线会话", overview.counts.sessions],
    ["游戏局", overview.counts.games],
    ["房间", overview.counts.rooms],
    ["应用日志", overview.counts.appLogs],
  ];
  return `
    <div class="content-head">
      <div>
        <h2>系统概览</h2>
        <div class="muted">${overview.service.name}</div>
      </div>
      <div class="actions">
        <button class="btn secondary" id="reload-overview">刷新</button>
      </div>
    </div>
    <div class="cards">
      ${stats
        .map(
          ([label, value]) => `
            <div class="stat-card">
              <div class="muted">${label}</div>
              <strong>${value}</strong>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="panel-card">
      <div class="field-grid">
        <div><strong>描述</strong><div class="muted">${overview.service.description || "未设置"}</div></div>
        <div><strong>API 地址</strong><div class="muted">${overview.service.hostname}:${overview.service.apiPort}</div></div>
        <div><strong>管理页地址</strong><div class="muted">${overview.service.hostname}:${overview.service.adminPort}</div></div>
        <div><strong>配置存储</strong><div class="muted">${overview.service.configStorage.type} / ${overview.service.configStorage.table}</div></div>
        <div><strong>数据文件</strong><div class="muted">${overview.service.storePath}</div></div>
      </div>
    </div>
  `;
}

function renderUsers() {
  return `
    <div class="content-head">
      <div>
        <h2>用户管理</h2>
        <div class="muted">支持创建、编辑、删号和密码重置。</div>
      </div>
      <div class="actions">
        <button class="btn secondary" id="users-refresh">刷新</button>
      </div>
    </div>
    <div class="panel-card">
      <form id="user-filter-form" class="toolbar">
        <input name="user-search" placeholder="搜索用户名" />
        <select name="user-role-filter">
          <option value="">全部角色</option>
          <option value="0">超级管理员</option>
          <option value="1">管理员</option>
          <option value="2">普通用户</option>
        </select>
        <button class="btn secondary" type="submit">筛选</button>
      </form>
    </div>
    <div class="panel-card">
      <form id="create-user-form" class="toolbar">
        <input name="username" placeholder="新用户名" required />
        <input name="password" type="password" placeholder="初始密码" required />
        <select name="role">
          ${state.me.role === 0 ? '<option value="1">管理员</option>' : ""}
          <option value="2" selected>普通用户</option>
        </select>
        <button class="btn" type="submit">创建用户</button>
      </form>
    </div>
    <div class="panel-card table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户名</th>
            <th>角色</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.users
            .map(
              (user) => `
                <tr>
                  <td>${user.username}${state.me.id === user.id ? " (我)" : ""}</td>
                  <td><span class="badge role-${user.role}">${roleName(user.role)}</span></td>
                  <td>${user.createdAt}</td>
                  <td class="actions">
                    <button class="btn secondary" type="button" data-edit-user="${user.id}">编辑</button>
                    <button class="btn secondary" type="button" data-reset-password="${user.id}">重置密码</button>
                    <button class="btn warn" type="button" data-delete-user="${user.id}">删除</button>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLogs() {
  return `
    <div class="content-head">
      <div>
        <h2>日志</h2>
        <div class="muted">查看应用日志和对局日志。</div>
      </div>
      <div class="actions">
        <button class="btn secondary ${state.logsScope === "app" ? "active" : ""}" type="button" data-log-scope="app">应用日志</button>
        <button class="btn secondary ${state.logsScope === "match" ? "active" : ""}" type="button" data-log-scope="match">对局日志</button>
      </div>
    </div>
    <div class="panel-card">
      <form id="logs-filter-form" class="toolbar">
        <input name="log-search" placeholder="搜索日志内容" />
        <select name="log-level">
          <option value="">全部级别</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="match">match</option>
        </select>
        <select name="log-limit">
          <option value="100">最近 100 条</option>
          <option value="200" selected>最近 200 条</option>
          <option value="500">最近 500 条</option>
        </select>
        <button class="btn secondary" type="submit">刷新</button>
      </form>
    </div>
    <div class="panel-card log-list">
      ${state.logs
        .map(
          (item) => `
            <div class="log-item">
              <div class="log-meta">
                <span>${item.date}</span>
                <span>${item.level}</span>
              </div>
              <div>${item.message}</div>
            </div>
          `
        )
        .join("") || '<div class="muted">暂无日志。</div>'}
    </div>
  `;
}

function renderConfig() {
  const config = state.config;
  if (!config) {
    return `<div class="panel-card">加载中...</div>`;
  }
  return `
    <div class="content-head">
      <div>
        <h2>配置</h2>
        <div class="muted">管理服务监听、描述、白名单和会话策略。</div>
      </div>
    </div>
    ${state.me.role === 0 ? '<div class="notice">保存端口或监听地址后需要重启服务才能生效。</div>' : '<div class="notice">当前为管理员，只可查看配置。</div>'}
    <form id="config-form" class="panel-card">
      <div class="config-grid">
        <label>
          <span>服务名</span>
          <input name="serverName" value="${config.serverName}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>描述</span>
          <input name="serverDescription" value="${config.serverDescription || ""}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>监听地址</span>
          <input name="hostname" value="${config.hostname}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>API 端口</span>
          <input name="serverPort" type="number" value="${config.serverPort}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>管理页端口</span>
          <input name="adminPort" type="number" value="${config.adminPort}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>Token TTL 小时</span>
          <input name="authTokenTtlHours" type="number" value="${config.authTokenTtlHours}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label>
          <span>systemd 服务名</span>
          <input name="serviceName" value="${config.serviceName}" ${state.me.role === 0 ? "" : "disabled"} />
        </label>
        <label class="full">
          <span>前端白名单</span>
          <textarea name="allowedOrigins" rows="6" ${state.me.role === 0 ? "" : "disabled"}>${config.allowedOrigins.join("\n")}</textarea>
        </label>
        <label class="full">
          <span>配置存储位置</span>
          <input value="${config.configStorage.storePath} -> ${config.configStorage.table}" disabled />
        </label>
      </div>
      ${
        state.me.role === 0
          ? '<div class="btn-row"><button class="btn" type="submit">保存配置</button></div>'
          : ""
      }
    </form>
  `;
}

function renderShell() {
  const viewMap = {
    overview: renderOverview(),
    users: renderUsers(),
    logs: renderLogs(),
    config: renderConfig(),
  };

  app.innerHTML = `
    <div class="page layout">
      <aside class="sidebar">
        <div>
          <h2>478 Admin</h2>
          <div class="muted">${state.me.username} / ${roleName(state.me.role)}</div>
        </div>
        <nav class="nav">
          <button class="nav-btn ${state.activeView === "overview" ? "active" : ""}" data-view="overview">概览</button>
          <button class="nav-btn ${state.activeView === "users" ? "active" : ""}" data-view="users">用户管理</button>
          <button class="nav-btn ${state.activeView === "logs" ? "active" : ""}" data-view="logs">日志</button>
          <button class="nav-btn ${state.activeView === "config" ? "active" : ""}" data-view="config">配置</button>
        </nav>
        <div class="actions">
          <button class="btn secondary" id="logout-btn">退出登录</button>
        </div>
      </aside>
      <main class="main">
        ${state.message ? `<div class="message">${state.message}</div>` : ""}
        ${viewMap[state.activeView]}
      </main>
    </div>
  `;
  bindEvents();
}

function render() {
  if (!state.token || !state.me) {
    renderLogin();
    return;
  }
  renderShell();
}

bootstrap();
