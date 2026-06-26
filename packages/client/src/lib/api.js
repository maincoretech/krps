import { getStoredToken, setStoredToken } from "./user.js";
import { push } from "svelte-spa-router";
import toast from "./toast.js";

export function getApiBaseUrl() {
  let base = import.meta.env.VITE_API_BASE_URL;
  if (base) {
    // Ensure it has a protocol
    if (!/^https?:\/\//.test(base)) base = "https://" + base;
    return base.replace(/\/+$/, "");
  }
  const url = new URL(window.location.href);
  url.port = "3000";
  url.pathname = "";
  url.hash = "";
  url.search = "";
  return url.origin;
}

export function getWsBaseUrl() {
  const httpUrl = new URL(getApiBaseUrl());
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  httpUrl.pathname = httpUrl.pathname.replace(/\/?$/, "/ws");
  return httpUrl.href;
}

const baseURL = getApiBaseUrl();

export class ApiError extends Error {
  constructor(message, status, response) {
    super(message);
    this.status = status;
    this.response = response;
  }
}

async function fetchApi(path, options = {}) {
  const url = `${baseURL}${path}`;
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        setStoredToken("");
        toast.warning("toast.session_expired");
        push("/auth");
      }

      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { message: response.statusText };
      }

      throw new ApiError(
        errorData.message || "API Error",
        response.status,
        { data: errorData }
      );
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new ApiError("Request timeout", 408, {
        data: { message: "Request timeout" },
      });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message, 0, {
      data: { message: error.message },
    });
  }
}

async function unwrap(responsePromise) {
  const response = await responsePromise;
  const json = await response.json();
  return json.data;
}

const api = {
  get: (path) => fetchApi(path, { method: "GET" }),
  post: (path, data) =>
    fetchApi(path, { method: "POST", body: JSON.stringify(data) }),
  put: (path, data) =>
    fetchApi(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: (path) => fetchApi(path, { method: "DELETE" }),
};

export async function fetchDashboard() {
  return unwrap(api.get("/dashboard"));
}

export async function fetchLeaderboard() {
  return unwrap(api.get("/leaderboard"));
}

export async function renameMatch(matchId, name) {
  return unwrap(api.put(`/matches/${matchId}/name`, { name }));
}

export async function deleteMatch(matchId) {
  return unwrap(api.delete(`/matches/${matchId}`));
}

export async function register(payload) {
  return unwrap(api.post("/auth/register", payload));
}

export async function login(payload) {
  return unwrap(api.post("/auth/login", payload));
}

export async function logout() {
  return unwrap(api.post("/auth/logout", {}));
}

export async function fetchMe() {
  return unwrap(api.get("/auth/me"));
}

export async function updateMe(payload) {
  return unwrap(api.put("/auth/me", payload));
}

export async function createMatch(payload) {
  return unwrap(api.post("/matches", payload));
}

export async function fetchMatch(matchId) {
  return unwrap(api.get(`/matches/${matchId}`));
}

export async function joinMatch(payload) {
  return unwrap(api.post("/matches/join", payload));
}

export async function refreshMatchInviteCode(matchId) {
  return unwrap(api.post(`/matches/${matchId}/refresh-code`));
}

export async function setMatchReady(matchId, payload) {
  return unwrap(api.post(`/matches/${matchId}/start`, payload));
}

export async function exportMatchData(matchId) {
  const token = getStoredToken();
  const url = `${baseURL}/matches/${matchId}/export`;
  window.open(`${url}?token=${token}`, "_blank");
}

export async function leaveMatch(matchId) {
  return unwrap(api.post(`/matches/${matchId}/leave`, {}));
}
