const TOKEN_KEY = "krps_token";
const USER_KEY = "krps_username";

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token) {
  if (!token) {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getStoredUser() {
  return window.localStorage.getItem(USER_KEY) ?? "";
}

export function setStoredUser(username) {
  if (!username) {
    window.localStorage.removeItem(USER_KEY);
    return;
  }
  window.localStorage.setItem(USER_KEY, username);
}
