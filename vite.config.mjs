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
            output: {
                manualChunks(id) {
                    if (id.includes("exceljs")) {
                        return "exceljs";
                    }

                    if (id.includes("/src/shared/gameDataIndex.generated.json") || id.includes("\\src\\shared\\gameDataIndex.generated.json")) {
                        return "gameData";
                    }

                    if (id.includes("/src/shared/gameDataIndex.js") || id.includes("\\src\\shared\\gameDataIndex.js")) {
                        return "gameData";
                    }

                    if (id.includes("/src/services/playerMapper.js") || id.includes("\\src\\services\\playerMapper.js")) {
                        return "playerMapper";
                    }

                    if (id.includes("/src/combatsimulator/abilityDefinitionResolver") || id.includes("\\src\\combatsimulator\\abilityDefinitionResolver")) {
                        return "playerMapper";
                    }

                    return undefined;
                },
            },
        },
    },
});
