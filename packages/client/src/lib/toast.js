import { writable, get } from "svelte/store";
import { _ } from "./i18n.js";

export const toasts = writable([]);

let toastId = 0;

function resolveMessage(message, params) {
  if (!message) return "";
  const t = get(_);
  // Try to translate; if the key doesn't exist, svelte-i18n returns the key itself
  const translated = t(message, params);
  return translated !== message ? translated : message;
}

function remove(id) {
  toasts.update((items) => items.filter((t) => t.id !== id));
}

export const toast = {
  show(message, type = "info", duration = 3000, params) {
    const id = toastId++;
    toasts.update((items) => [
      ...items,
      { id, message: resolveMessage(message, params), type, duration },
    ]);
    setTimeout(() => remove(id), duration);
  },
  success(message, params) {
    this.show(message, "success", 3000, params);
  },
  warning(message, params) {
    this.show(message, "warning", 3000, params);
  },
  error(message, params) {
    this.show(message, "error", 3000, params);
  },
  info(message, params) {
    this.show(message, "info", 3000, params);
  },
  fromError(error, fallbackMessage, params) {
    const serverMessage =
      error?.response?.data?.message || error?.message;
    this.error(serverMessage || fallbackMessage, params);
  },
};

export default toast;
