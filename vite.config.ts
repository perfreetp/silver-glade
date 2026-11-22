import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    fs: { strict: false },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: {
    exclude: [],
  },
});
