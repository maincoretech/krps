import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import postcssPresetEnv from "postcss-preset-env";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@krps/shared": path.resolve(__dirname, "../shared"),
    },
  },
  css: {
    postcss: {
      plugins: [postcssPresetEnv()],
    },
  },
  plugins: [svelte()],
});
