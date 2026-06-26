import { register, init, getLocaleFromNavigator, waitLocale } from "svelte-i18n";

// Synchronous registration — no dynamic import, locale data available immediately
import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import zhTW from "../locales/zh-TW.json";

register("en", () => Promise.resolve(en));
register("zh-CN", () => Promise.resolve(zhCN));
register("zh-TW", () => Promise.resolve(zhTW));

const saved = typeof localStorage !== "undefined" && localStorage.getItem("app-lang");
const initialLocale = saved || getLocaleFromNavigator() || "en";

init({
  fallbackLocale: "en",
  initialLocale,
});

// Export a promise so App.svelte can await before mounting
export const i18nReady = waitLocale();

export { _, t } from "svelte-i18n";
