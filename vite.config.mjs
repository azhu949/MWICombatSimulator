import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "fs";
import { resolve } from "path";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

export default defineConfig({
    base: "./",
    plugins: [vue()],
    define: {
        __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    server: {
        port: 5173,
    },
    build: {
        rollupOptions: {
            input: resolve(process.cwd(), "index.html"),
        },
    },
});
