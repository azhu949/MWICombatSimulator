import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
    base: "./",
    plugins: [vue()],
    server: {
        port: 5173,
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(process.cwd(), "index.html"),
                legacy: resolve(process.cwd(), "legacy.html"),
            },
        },
    },
});
