#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { hasRequiredClientDataKeys, writeMapFiles } = require("./game-data-targets");

const OFFICIAL_GAME_ORIGIN = "https://www.milkywayidle.com";
const OFFICIAL_MAIN_CHUNK_REGEX = /<script[^>]+src=["'](\/static\/js\/main\.[^"']+?\.chunk\.js)["']/i;
const OFFICIAL_GAME_VERSION_REGEX = /var a="production";const i="([^"]+)";/;

function usage() {
    console.log("Usage:");
    console.log("  node scripts/extract-game-data-from-official.js --character-id <id> [options]");
    console.log("");
    console.log("Required:");
    console.log("  --character-id, -c    Character ID used by websocket connection.");
    console.log("");
    console.log("Optional:");
    console.log("  --hash, -k            Local hash for websocket query. Auto-generated if omitted.");
    console.log("  --game-version, -g    Game version. Auto-detected from official main chunk if omitted.");
    console.log("  --version-timestamp, -t");
    console.log("                        Version timestamp query param. Default: 0");
    console.log("  --lang, -l            Language query param. Default: en");
    console.log("  --ws-host             Websocket host. Default: wss://api.milkywayidle.com");
    console.log("  --origin              Websocket Origin header. Default: https://www.milkywayidle.com");
    console.log("  --user-agent          Optional User-Agent header for websocket/api requests.");
    console.log("  --cookie              Auth cookie string for api.milkywayidle.com.");
    console.log("  --cookie-file         File containing cookie string, or a full 'Cookie: ...' header.");
    console.log("  --output, -o          Output directory. Default: src/combatsimulator/data");
    console.log("  --inspect-output, -p  Optional extra output directory (same tracked files again).");
    console.log("                        Missing tracked files are skipped with a warning; optional fallback-backed files are reset.");
    console.log("  --save-raw, -r        Optional path to save the full init_client_data payload JSON.");
    console.log("  --timeout-ms, -m      Timeout waiting for init_client_data. Default: 15000");
    console.log("  --help, -h            Show this help.");
    console.log("");
    console.log("Example:");
    console.log("  node scripts/extract-game-data-from-official.js --character-id 12345 --hash AbCdEf123 --cookie-file tmp/api.cookie.txt --inspect-output tmp/initClientData.decoded --save-raw tmp/initClientData.raw.json");
}

function parseArgs(argv) {
    const args = {
        characterId: "",
        hash: "",
        gameVersion: "",
        versionTimestamp: "0",
        lang: "en",
        wsHost: "wss://api.milkywayidle.com",
        origin: "https://www.milkywayidle.com",
        userAgent: "",
        cookie: "",
        cookieFile: "",
        output: "src/combatsimulator/data",
        inspectOutput: "",
        saveRaw: "",
        timeoutMs: 15000,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--help" || arg === "-h") {
            args.help = true;
            return args;
        }
        if (arg === "--character-id" || arg === "-c") {
            args.characterId = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--hash" || arg === "-k") {
            args.hash = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--game-version" || arg === "-g") {
            args.gameVersion = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--version-timestamp" || arg === "-t") {
            args.versionTimestamp = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--lang" || arg === "-l") {
            args.lang = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--ws-host") {
            args.wsHost = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--origin") {
            args.origin = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--user-agent") {
            args.userAgent = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--cookie") {
            args.cookie = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--cookie-file") {
            args.cookieFile = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--output" || arg === "-o") {
            args.output = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--inspect-output" || arg === "-p") {
            args.inspectOutput = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--save-raw" || arg === "-r") {
            args.saveRaw = String(argv[index + 1] || "").trim();
            index += 1;
            continue;
        }
        if (arg === "--timeout-ms" || arg === "-m") {
            const timeoutValue = Number(argv[index + 1]);
            if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
                throw new Error(`Invalid --timeout-ms value: ${argv[index + 1]}`);
            }
            args.timeoutMs = timeoutValue;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return args;
}

function randomHash(length = 20) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let index = 0; index < length; index += 1) {
        result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return result;
}

function normalizeCookieValue(rawCookie) {
    const raw = String(rawCookie || "").trim();
    if (!raw) {
        return "";
    }

    const headerMatch = raw.match(/^\s*cookie\s*:\s*(.+)$/i);
    if (headerMatch?.[1]) {
        return headerMatch[1].trim();
    }

    return raw;
}

function resolveCookie(args) {
    if (args.cookie) {
        return normalizeCookieValue(args.cookie);
    }
    if (args.cookieFile) {
        const cookieSource = fs.readFileSync(path.resolve(args.cookieFile), "utf8");
        return normalizeCookieValue(cookieSource);
    }
    return "";
}

async function fetchOfficialMainChunkSource() {
    const homeResponse = await fetch(`${OFFICIAL_GAME_ORIGIN}/`);
    if (!homeResponse.ok) {
        throw new Error(`Failed to load official homepage: ${homeResponse.status}`);
    }

    const homeSource = await homeResponse.text();
    const mainChunkMatch = homeSource.match(OFFICIAL_MAIN_CHUNK_REGEX);
    if (!mainChunkMatch?.[1]) {
        throw new Error("Failed to locate official main chunk URL");
    }

    const mainChunkUrl = new URL(mainChunkMatch[1], `${OFFICIAL_GAME_ORIGIN}/`).toString();
    const mainChunkResponse = await fetch(mainChunkUrl);
    if (!mainChunkResponse.ok) {
        throw new Error(`Failed to load official main chunk: ${mainChunkResponse.status}`);
    }

    return mainChunkResponse.text();
}

async function resolveGameVersion(explicitVersion) {
    if (explicitVersion) {
        return explicitVersion;
    }

    const mainChunkSource = await fetchOfficialMainChunkSource();
    const gameVersionMatch = mainChunkSource.match(OFFICIAL_GAME_VERSION_REGEX);
    if (!gameVersionMatch?.[1]) {
        throw new Error("Failed to auto-detect official gameVersion");
    }

    return gameVersionMatch[1];
}

function extractClientDataFromMessage(payload) {
    if (hasRequiredClientDataKeys(payload)) {
        return payload;
    }

    const candidates = [
        payload?.data,
        payload?.initClientData,
        payload?.initClientDataData,
        payload?.clientData,
    ];

    for (const candidate of candidates) {
        if (hasRequiredClientDataKeys(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function checkApiCookieAuth(cookie, userAgent) {
    const headers = {};
    if (cookie) {
        headers.Cookie = cookie;
    }
    if (userAgent) {
        headers["User-Agent"] = userAgent;
    }

    const response = await fetch("https://api.milkywayidle.com/v1/characters", {
        method: "GET",
        headers,
    });

    return response.status;
}

function waitForInitClientData(wsUrl, timeoutMs, wsOptions) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, wsOptions);
        let settled = false;
        let timeoutId = null;

        function finish(error, result) {
            if (settled) {
                return;
            }
            settled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            try {
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
            } catch {
                // no-op
            }

            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        }

        timeoutId = setTimeout(() => {
            finish(new Error(`Timed out after ${timeoutMs}ms waiting for init_client_data`));
        }, timeoutMs);

        ws.on("message", (rawData, isBinary) => {
            let text = "";
            try {
                text = isBinary ? Buffer.from(rawData).toString("utf8") : String(rawData);
                const payload = JSON.parse(text);

                if (payload?.type === "error") {
                    finish(new Error(`Server returned error payload: ${JSON.stringify(payload)}`));
                    return;
                }

                const clientData = extractClientDataFromMessage(payload);
                if (payload?.type === "init_client_data" || clientData) {
                    finish(null, { payload, clientData: clientData || payload });
                }
            } catch (error) {
                finish(new Error(`Failed to parse websocket payload: ${error.message}`));
            }
        });

        ws.on("error", (error) => {
            finish(new Error(`Websocket error: ${error.message}`));
        });

        ws.on("close", (code, reasonBuffer) => {
            if (!settled) {
                const reason = reasonBuffer ? reasonBuffer.toString("utf8") : "";
                finish(new Error(`Websocket closed before init_client_data (code=${code}, reason=${reason || "<empty>"})`));
            }
        });
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        usage();
        return;
    }

    if (!args.characterId) {
        usage();
        process.exitCode = 1;
        return;
    }

    const hash = args.hash || randomHash();
    const gameVersion = await resolveGameVersion(args.gameVersion);
    const cookie = resolveCookie(args);

    const wsHost = args.wsHost.endsWith("/") ? args.wsHost.slice(0, -1) : args.wsHost;
    const outputDir = path.resolve(args.output);
    const inspectOutputDir = args.inspectOutput ? path.resolve(args.inspectOutput) : "";
    const saveRawPath = args.saveRaw ? path.resolve(args.saveRaw) : "";

    const searchParams = new URLSearchParams({
        hash,
        characterId: args.characterId,
        gameVersion,
        versionTimestamp: args.versionTimestamp || "0",
        lang: args.lang || "en",
        isSteam: "0",
    });

    const wsUrl = `${wsHost}/ws?${searchParams.toString()}`;
    const wsHeaders = {};
    if (cookie) {
        wsHeaders.Cookie = cookie;
    }
    if (args.userAgent) {
        wsHeaders["User-Agent"] = args.userAgent;
    }
    const wsOptions = {
        origin: args.origin || undefined,
        headers: Object.keys(wsHeaders).length > 0 ? wsHeaders : undefined,
    };

    console.log(`Connecting websocket: ${wsHost}/ws`);
    console.log(`Character ID: ${args.characterId}`);
    console.log(`Hash: ${hash}`);
    console.log(`Game version: ${gameVersion}`);
    console.log(`Cookie provided: ${cookie ? "yes" : "no"}`);

    if (cookie) {
        const authStatus = await checkApiCookieAuth(cookie, args.userAgent);
        if (authStatus !== 200) {
            throw new Error(`Cookie auth check failed (/v1/characters -> ${authStatus}). Please refresh cookie from browser.`);
        }
    } else {
        console.warn("No cookie provided. Server may close websocket immediately without auth.");
    }

    const result = await waitForInitClientData(wsUrl, args.timeoutMs, wsOptions);

    if (!hasRequiredClientDataKeys(result.clientData)) {
        throw new Error("Received payload does not include required init client maps");
    }

    if (saveRawPath) {
        fs.mkdirSync(path.dirname(saveRawPath), { recursive: true });
        fs.writeFileSync(saveRawPath, `${JSON.stringify(result.payload, null, 4)}\n`, "utf8");
        console.log(`Saved raw payload: ${saveRawPath}`);
    }

    const { written, reset, skipped } = writeMapFiles(result.clientData, outputDir);
    console.log(`Wrote ${written.length} files:`);
    for (const filePath of written) {
        console.log(`- ${filePath}`);
    }
    if (reset.length > 0) {
        console.log(`Reset ${reset.length} optional tracked game-data file to fallback because the payload did not include it:`);
        for (const fileName of reset) {
            console.log(`- ${fileName}`);
        }
    }
    if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} tracked game-data file because the payload did not include it:`);
        for (const fileName of skipped) {
            console.log(`- ${fileName}`);
        }
    }

    if (inspectOutputDir && inspectOutputDir !== outputDir) {
        const {
            written: inspectWritten,
            reset: inspectReset,
            skipped: inspectSkipped,
        } = writeMapFiles(result.clientData, inspectOutputDir);
        console.log(`Also wrote ${inspectWritten.length} files for inspection:`);
        for (const filePath of inspectWritten) {
            console.log(`- ${filePath}`);
        }
        if (inspectReset.length > 0) {
            console.log(`Also reset ${inspectReset.length} optional tracked game-data file for inspection because the payload did not include it:`);
            for (const fileName of inspectReset) {
                console.log(`- ${fileName}`);
            }
        }
        if (inspectSkipped.length > 0) {
            console.log(`Also skipped ${inspectSkipped.length} tracked game-data file for inspection because the payload did not include it:`);
            for (const fileName of inspectSkipped) {
                console.log(`- ${fileName}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
