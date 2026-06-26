const app = document.querySelector("#app");
const tokenKey = "krps-admin-token";

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
  if (role === 0) return "Super Admin";
  if (role === 1) return "Admin";
  return "User";
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
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  await request("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: form.get("username"),
      password: form.get("password"),
      role: Number(form.get("role")),
    }),
  });
  
  await loadUsers();
  setMessage("User created successfully.");
  if (formElement && typeof formElement.reset === 'function') {
    formElement.reset();
  }
}

async function editUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;

  const result = await new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    
    let roleSelectHtml = "";
    if (state.me.role === 0) {
      roleSelectHtml = `
        <label class="md-field" style="margin-bottom:0;">
          <select class="md-select" name="role">
            <option value="0" ${user.role === 0 ? "selected" : ""}>Super Admin</option>
            <option value="1" ${user.role === 1 ? "selected" : ""}>Admin</option>
            <option value="2" ${user.role === 2 ? "selected" : ""}>User</option>
          </select>
          <span class="md-label">Role</span>
        </label>
      `;
    }

    overlay.innerHTML = `
      <form class="modal-content" id="edit-user-dialog-form">
        <h3>Edit User</h3>
        <p>Updating details for <strong>${user.username}</strong>.</p>
        <div class="field-grid" style="margin: 0;">
          <label class="md-field" style="margin-bottom:0;">
            <input class="md-input" name="username" placeholder=" " value="${user.username}" />
            <span class="md-label">Username (keep unchanged if empty)</span>
          </label>
          <label class="md-field" style="margin-bottom:0;">
            <input class="md-input" name="password" type="password" placeholder=" " />
            <span class="md-label">Password (keep unchanged if empty)</span>
          </label>
          <div class="pass-hint" id="edit-pass-hint">Leave empty to keep unchanged.</div>
          ${roleSelectHtml}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn secondary" id="edit-user-cancel">Cancel</button>
          <button type="submit" class="btn primary">Save Changes</button>
        </div>
      </form>
    `;
    
    document.body.appendChild(overlay);

    const form = overlay.querySelector("#edit-user-dialog-form");
    const cancelBtn = overlay.querySelector("#edit-user-cancel");

    const cleanup = () => {
      document.body.removeChild(overlay);
    };

    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const pw = String(fd.get("password") ?? "").trim();
      const data = {
        username: fd.get("username"),
        password: pw || undefined,
      };
      if (state.me.role === 0) {
        data.role = Number(fd.get("role"));
      }
      cleanup();
      resolve(data);
    });
  });

  if (!result) return; // User cancelled

  const { username, password, role } = result;

  await request(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({
      username: username.trim() === user.username ? undefined : username.trim(),
      password: password || undefined,
      role: role !== undefined ? role : user.role,
    }),
  });
  await loadUsers();
  setMessage("User information updated.");
}

async function resetPassword(userId) {
  const result = await request(`/api/users/${userId}/reset-password`, { method: "POST" });
  window.alert(`The new password for user ${result.user.username} is: ${result.password}`);
  setMessage("Password has been reset.");
}

async function deleteUser(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  if (!window.confirm(`Are you sure you want to delete user ${user.username}? Their game and room data will also be deleted.`)) {
    return;
  }
  await request(`/api/users/${userId}`, { method: "DELETE" });
  await loadUsers();
  setMessage("User has been deleted.");
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
    turnstileSecretKey: String(form.get("turnstileSecretKey") ?? "").trim(),
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
  setMessage(result.requiresRestart ? "Configuration saved. Restart required for port or host changes to take effect." : "Configuration saved.");
}

function downloadJson(filename, obj) {
  const str = JSON.stringify(obj, null, 2);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  document.querySelector("#export-config-btn")?.addEventListener("click", async () => {
    try {
      const data = await request("/api/backup/config");
      downloadJson("krps-config-backup.json", data);
    } catch (err) { setMessage(err.message); }
  });

  document.querySelector("#export-users-btn")?.addEventListener("click", async () => {
    try {
      const data = await request("/api/backup/users");
      downloadJson("krps-users-backup.json", data);
    } catch (err) { setMessage(err.message); }
  });

  document.querySelector("#import-config-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = e.currentTarget.querySelector('input[type="file"]').files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await request("/api/backup/config", { method: "POST", body: JSON.stringify(json) });
      setMessage("Configuration imported successfully.");
    } catch (err) { setMessage("Import failed: " + err.message); }
  });

  document.querySelector("#import-users-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = e.currentTarget.querySelector('input[type="file"]').files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await request("/api/backup/users", { method: "POST", body: JSON.stringify(json) });
      setMessage(`Imported ${res.imported} users successfully.`);
    } catch (err) { setMessage("Import failed: " + err.message); }
  });
}

function renderLogin() {
  app.innerHTML = `
    <div class="page login-shell">
      <form id="login-form" class="login-card">
        <h1>krps Admin</h1>
        <p class="muted">Access restricted to Super Admin (Level 0) and Admin (Level 1).</p>
        ${state.message ? `<div class="message">${state.message}</div>` : ""}
        <div class="field-grid">
          <label class="md-field">
            <input class="md-input" name="username" placeholder=" " autocomplete="username" required />
            <span class="md-label">Username</span>
          </label>
          <label class="md-field">
            <input class="md-input" name="password" type="password" placeholder=" " autocomplete="current-password" required />
            <span class="md-label">Password</span>
          </label>
        </div>
        <div class="btn-row">
          <button class="btn primary" type="submit">Login</button>
        </div>
      </form>
    </div>
  `;
  bindEvents();
}

function renderOverview() {
  const overview = state.overview;
  if (!overview) {
    return `<div class="panel-card">Loading...</div>`;
  }
  const stats = [
    ["Total Users", overview.counts.users],
    ["Super Admins", overview.counts.superAdmins],
    ["Admins", overview.counts.admins],
    ["Normal Users", overview.counts.normalUsers],
    ["Active Sessions", overview.counts.sessions],
    ["Total Games", overview.counts.games],
    ["Total Rooms", overview.counts.rooms],
    ["App Logs", overview.counts.appLogs],
  ];
  return `
    <div class="content-head">
      <div>
        <h2>System Overview</h2>
        <div class="muted">${overview.service.name}</div>
      </div>
      <div class="actions">
        <button class="btn secondary" id="reload-overview">Refresh</button>
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
        <div><strong>Description</strong><div class="muted">${overview.service.description || "Not Set"}</div></div>
        <div><strong>API Address</strong><div class="muted">${overview.service.hostname}:${overview.service.apiPort}</div></div>
        <div><strong>Admin Address</strong><div class="muted">${overview.service.hostname}:${overview.service.adminPort}</div></div>
        <div><strong>Config Storage</strong><div class="muted">${overview.service.configStorage.type} / ${overview.service.configStorage.table}</div></div>
        <div><strong>Data File</strong><div class="muted">${overview.service.storePath}</div></div>
      </div>
    </div>
  `;
}

function renderUsers() {
  return `
    <div class="content-head">
      <div>
        <h2>User Management</h2>
        <div class="muted">Create, edit, delete users and reset passwords.</div>
      </div>
      <div class="actions">
        <button class="btn secondary" id="users-refresh">Refresh</button>
      </div>
    </div>
    <div class="panel-card">
      <form id="user-filter-form" class="toolbar">
        <label class="md-field" style="flex:1;min-width:180px;margin-bottom:0;">
          <input class="md-input" name="user-search" placeholder=" " />
          <span class="md-label">Search Username</span>
        </label>
        <label class="md-field" style="min-width:140px;margin-bottom:0;">
          <select class="md-select" name="user-role-filter">
            <option value="">All Roles</option>
            <option value="0">Super Admin</option>
            <option value="1">Admin</option>
            <option value="2">User</option>
          </select>
          <span class="md-label">Role</span>
        </label>
        <button class="btn secondary" type="submit">Filter</button>
      </form>
    </div>
    <div class="panel-card">
      <form id="create-user-form" class="toolbar" style="align-items:flex-start;">
        <label class="md-field" style="flex:1;min-width:160px;margin-bottom:0;">
          <input class="md-input" name="username" placeholder=" " required />
          <span class="md-label">New Username</span>
        </label>
        <div style="flex:1;min-width:160px;">
          <label class="md-field" style="margin-bottom:0;">
            <input class="md-input" name="password" type="password" placeholder=" " required />
            <span class="md-label">Initial Password</span>
          </label>
          <div class="pass-hint">At least 8 characters.</div>
        </div>
        <label class="md-field" style="min-width:120px;margin-bottom:0;">
          <select class="md-select" name="role">
            ${state.me.role === 0 ? '<option value="1">Admin</option>' : ""}
            <option value="2" selected>User</option>
          </select>
          <span class="md-label">Role</span>
        </label>
        <button class="btn primary" type="submit">Create User</button>
      </form>
    </div>
    <div class="panel-card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.users
            .map(
              (user) => `
                <tr>
                  <td>${user.username}${state.me.id === user.id ? " (Me)" : ""}</td>
                  <td><span class="badge role-${user.role}">${roleName(user.role)}</span></td>
                  <td>${user.createdAt}</td>
                  <td class="actions">
                    <button class="btn secondary" type="button" data-edit-user="${user.id}">Edit</button>
                    <button class="btn secondary" type="button" data-reset-password="${user.id}">Reset Password</button>
                    <button class="btn warn" type="button" data-delete-user="${user.id}">Delete</button>
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
        <h2>Logs</h2>
        <div class="muted">View application and match logs.</div>
      </div>
      <div class="actions">
        <button class="btn secondary ${state.logsScope === "app" ? "nav-btn active" : ""}" type="button" data-log-scope="app">App Logs</button>
        <button class="btn secondary ${state.logsScope === "match" ? "nav-btn active" : ""}" type="button" data-log-scope="match">Match Logs</button>
      </div>
    </div>
    <div class="panel-card">
      <form id="logs-filter-form" class="toolbar">
        <label class="md-field" style="flex:1;min-width:160px;margin-bottom:0;">
          <input class="md-input" name="log-search" placeholder=" " />
          <span class="md-label">Search Logs</span>
        </label>
        <label class="md-field" style="min-width:120px;margin-bottom:0;">
          <select class="md-select" name="log-level">
            <option value="">All Levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="match">match</option>
          </select>
          <span class="md-label">Level</span>
        </label>
        <label class="md-field" style="min-width:120px;margin-bottom:0;">
          <select class="md-select" name="log-limit">
            <option value="100">Last 100</option>
            <option value="200" selected>Last 200</option>
            <option value="500">Last 500</option>
          </select>
          <span class="md-label">Limit</span>
        </label>
        <button class="btn secondary" type="submit">Refresh</button>
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
        .join("") || '<div class="muted">No logs found.</div>'}
    </div>
  `;
}

function renderConfig() {
  const config = state.config;
  if (!config) {
    return `<div class="panel-card">Loading...</div>`;
  }
  const disabled = state.me.role === 0 ? "" : "disabled";
  return `
    <div class="content-head">
      <div>
        <h2>Configuration</h2>
        <div class="muted">Manage server listeners, descriptions, allowed origins, and session policies.</div>
      </div>
    </div>
    ${state.me.role === 0 ? '<div class="notice">Changes to ports or listeners require a service restart to take effect.</div>' : '<div class="notice">You are an Admin. You can only view configuration.</div>'}
    <form id="config-form" class="panel-card">
      <div class="config-grid">
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="serverName" placeholder=" " value="${config.serverName}" ${disabled} />
          <span class="md-label">Server Name</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="serverDescription" placeholder=" " value="${config.serverDescription || ""}" ${disabled} />
          <span class="md-label">Description</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="hostname" placeholder=" " value="${config.hostname}" ${disabled} />
          <span class="md-label">Host</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="serverPort" placeholder=" " type="number" value="${config.serverPort}" ${disabled} />
          <span class="md-label">API Port</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="adminPort" placeholder=" " type="number" value="${config.adminPort}" ${disabled} />
          <span class="md-label">Admin Port</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="authTokenTtlHours" placeholder=" " type="number" value="${config.authTokenTtlHours}" ${disabled} />
          <span class="md-label">Token TTL (Hours)</span>
        </label>
        <label class="md-field" style="margin-bottom:0;">
          <input class="md-input" name="serviceName" placeholder=" " value="${config.serviceName}" ${disabled} />
          <span class="md-label">systemd Service Name</span>
        </label>
        <label class="md-field full" style="margin-bottom:0;">
          <input class="md-input" name="turnstileSecretKey" type="password" placeholder=" " value="" autocomplete="new-password" ${disabled} />
          <span class="md-label">Turnstile Secret Key ${config.turnstileSecretKeyConfigured ? "(Configured)" : "(Not Set)"}</span>
        </label>
        <label class="md-field full" style="margin-bottom:0;">
          <textarea class="md-input" name="allowedOrigins" rows="6" placeholder=" " ${disabled}>${config.allowedOrigins.join("\n")}</textarea>
          <span class="md-label">Allowed Origins</span>
        </label>
        <label class="md-field full" style="margin-bottom:0;">
          <input class="md-input" value="${config.configStorage.storePath} -> ${config.configStorage.table}" disabled />
          <span class="md-label">Config Storage</span>
        </label>
      </div>
      ${
        state.me.role === 0
          ? '<div class="btn-row" style="margin-top: 24px;"><button class="btn primary" type="submit">Save Configuration</button></div>'
          : ""
      }
    </form>
  `;
}

function renderBackup() {
  return `
    <div class="content-head">
      <div>
        <h2>Backup & Restore</h2>
        <div class="muted">Export and import configuration and user data.</div>
      </div>
    </div>
    ${state.me.role === 0 ? '' : '<div class="notice">You are an Admin. You can only export, not import.</div>'}
    
    <div class="cards" style="margin-bottom: 24px;">
      <div class="panel-card" style="flex: 1; display: flex; flex-direction: column;">
        <h3>Configuration</h3>
        <p class="muted" style="flex: 1;">Export current system configuration to a JSON file, or import to apply.</p>
        <div class="btn-row" style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn" id="export-config-btn">Export Config</button>
          ${state.me.role === 0 ? `
            <form id="import-config-form" style="display: flex; gap: 12px; align-items: center; margin: 0;">
              <label class="btn secondary" style="cursor: pointer; margin: 0;">
                Select File
                <input type="file" accept=".json" required style="display: none;" onchange="this.parentElement.nextElementSibling.style.display='block'; this.parentElement.nextElementSibling.querySelector('.file-name').textContent=this.files[0].name;" />
              </label>
              <div style="display: none; align-items: center; gap: 8px;">
                <span class="file-name muted" style="font-size: 13px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                <button class="btn" type="submit">Import</button>
              </div>
            </form>
          ` : ''}
        </div>
      </div>

      <div class="panel-card" style="flex: 1; display: flex; flex-direction: column;">
        <h3>Users Data</h3>
        <p class="muted" style="flex: 1;">Export all users (including hashed passwords) to a JSON file, or import to upsert.</p>
        <div class="btn-row" style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn warn" id="export-users-btn">Export Users</button>
          ${state.me.role === 0 ? `
            <form id="import-users-form" style="display: flex; gap: 12px; align-items: center; margin: 0;">
              <label class="btn secondary" style="cursor: pointer; margin: 0;">
                Select File
                <input type="file" accept=".json" required style="display: none;" onchange="this.parentElement.nextElementSibling.style.display='block'; this.parentElement.nextElementSibling.querySelector('.file-name').textContent=this.files[0].name;" />
              </label>
              <div style="display: none; align-items: center; gap: 8px;">
                <span class="file-name muted" style="font-size: 13px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                <button class="btn" type="submit">Import</button>
              </div>
            </form>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderShell() {
  const viewMap = {
    overview: renderOverview(),
    users: renderUsers(),
    logs: renderLogs(),
    config: renderConfig(),
    backup: renderBackup(),
  };

  app.innerHTML = `
    <div class="page layout">
      <aside class="sidebar">
        <div>
          <h2>krps Admin</h2>
          <div class="muted">${state.me.username} / ${roleName(state.me.role)}</div>
        </div>
        <nav class="nav">
          <button class="nav-btn ${state.activeView === "overview" ? "active" : ""}" data-view="overview">Overview</button>
          <button class="nav-btn ${state.activeView === "users" ? "active" : ""}" data-view="users">Users</button>
          <button class="nav-btn ${state.activeView === "logs" ? "active" : ""}" data-view="logs">Logs</button>
          <button class="nav-btn ${state.activeView === "config" ? "active" : ""}" data-view="config">Config</button>
          <button class="nav-btn ${state.activeView === "backup" ? "active" : ""}" data-view="backup">Backup</button>
        </nav>
        <div class="actions">
          <button class="btn secondary" id="logout-btn">Logout</button>
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
