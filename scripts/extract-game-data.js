#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const TARGET_MAP_FILES = {
    abilityDetailMap: "abilityDetailMap.json",
    achievementDetailMap: "achievementDetailMap.json",
    actionDetailMap: "actionDetailMap.json",
    combatMonsterDetailMap: "combatMonsterDetailMap.json",
    itemDetailMap: "itemDetailMap.json",
    openableLootDropMap: "openableLootDropMap.json",
};

function usage() {
    console.log("Usage:");
    console.log("  node scripts/extract-game-data.js --input <file> [--output <dir>]");
    console.log("");
    console.log("Options:");
    console.log("  --input,  -i   Input file path.");
    console.log("                Supports one of:");
    console.log("                1) compressed localStorage initClientData string");
    console.log("                2) decompressed init client JSON object");
    console.log("  --output, -o   Output directory. Default:");
    console.log("                src/combatsimulator/data");
    console.log("  --help,   -h   Show this help.");
}

function parseArgs(argv) {
    const args = { input: null, output: "src/combatsimulator/data" };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            args.help = true;
            return args;
        }
        if (arg === "--input" || arg === "-i") {
            args.input = argv[i + 1];
            i++;
            continue;
        }
        if (arg === "--output" || arg === "-o") {
            args.output = argv[i + 1];
            i++;
            continue;
        }
    }

    return args;
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function hasTargetMaps(obj) {
    if (!obj || typeof obj !== "object") {
        return false;
    }
    return Object.keys(TARGET_MAP_FILES).every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function collectStringCandidates(raw) {
    const candidates = [];
    const trimmed = raw.trim();

    if (trimmed.length > 0) {
        candidates.push(trimmed);
    }

    const parsed = tryParseJson(trimmed);
    if (typeof parsed === "string" && parsed.trim().length > 0) {
        candidates.push(parsed.trim());
    }

    if (parsed && typeof parsed === "object") {
        if (typeof parsed.initClientData === "string" && parsed.initClientData.trim().length > 0) {
            candidates.push(parsed.initClientData.trim());
        }
        if (typeof parsed.data === "string" && parsed.data.trim().length > 0) {
            candidates.push(parsed.data.trim());
        }
    }

    return candidates;
}

function resolveClientData(rawText) {
    const direct = tryParseJson(rawText);
    if (hasTargetMaps(direct)) {
        return direct;
    }

    if (direct && typeof direct === "object") {
        if (hasTargetMaps(direct.data)) {
            return direct.data;
        }
        if (hasTargetMaps(direct.clientData)) {
            return direct.clientData;
        }
    }

    const candidates = collectStringCandidates(rawText);
    for (const candidate of candidates) {
        const parsedCandidate = tryParseJson(candidate);
        if (hasTargetMaps(parsedCandidate)) {
            return parsedCandidate;
        }

        const decompressed = LZString.decompressFromUTF16(candidate);
        if (!decompressed) {
            continue;
        }

        const parsedDecompressed = tryParseJson(decompressed);
        if (hasTargetMaps(parsedDecompressed)) {
            return parsedDecompressed;
        }
        if (parsedDecompressed && typeof parsedDecompressed === "object") {
            if (hasTargetMaps(parsedDecompressed.data)) {
                return parsedDecompressed.data;
            }
            if (hasTargetMaps(parsedDecompressed.clientData)) {
                return parsedDecompressed.clientData;
            }
        }
    }

    return null;
}

function writeMapFiles(clientData, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const written = [];

    for (const [mapKey, fileName] of Object.entries(TARGET_MAP_FILES)) {
        const value = clientData[mapKey];
        if (!value || typeof value !== "object") {
            throw new Error(`Missing required map: ${mapKey}`);
        }

        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
        written.push(filePath);
    }

    return written;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }

    if (!args.input) {
        usage();
        process.exitCode = 1;
        return;
    }

    const inputPath = path.resolve(args.input);
    const outputDir = path.resolve(args.output);
    const raw = fs.readFileSync(inputPath, "utf8");
    const clientData = resolveClientData(raw);

    if (!clientData) {
        throw new Error(
            "Unable to resolve init client data. Provide either compressed localStorage initClientData string or decompressed JSON object.",
        );
    }

    const written = writeMapFiles(clientData, outputDir);
    console.log(`Wrote ${written.length} files:`);
    for (const filePath of written) {
        console.log(`- ${filePath}`);
    }
}

const LZString = {
    decompressFromUTF16(input) {
        if (input == null) {
            return "";
        }
        if (input === "") {
            return null;
        }
        return this._decompress(input.length, 16384, (index) => input.charCodeAt(index) - 32);
    },

    _decompress(length, resetValue, getNextValue) {
        const dictionary = [];
        let next;
        let enlargeIn = 4;
        let dictSize = 4;
        let numBits = 3;
        let entry = "";
        const result = [];
        let i;
        let w;
        let bits;
        let resb;
        let maxpower;
        let power;
        let c;
        const data = { val: getNextValue(0), position: resetValue, index: 1 };

        for (i = 0; i < 3; i++) {
            dictionary[i] = i;
        }

        bits = 0;
        maxpower = Math.pow(2, 2);
        power = 1;
        while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
        }

        switch (bits) {
            case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = String.fromCharCode(bits);
                break;
            case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = String.fromCharCode(bits);
                break;
            case 2:
                return "";
            default:
                return null;
        }

        dictionary[3] = c;
        w = c;
        result.push(c);

        while (true) {
            if (data.index > length) {
                return "";
            }

            bits = 0;
            maxpower = Math.pow(2, numBits);
            power = 1;
            while (power !== maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position === 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
            }

            switch ((c = bits)) {
                case 0:
                    bits = 0;
                    maxpower = Math.pow(2, 8);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = String.fromCharCode(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 1:
                    bits = 0;
                    maxpower = Math.pow(2, 16);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = String.fromCharCode(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 2:
                    return result.join("");
                default:
                    break;
            }

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }

            if (dictionary[c]) {
                entry = dictionary[c];
            } else if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return null;
            }

            result.push(entry);

            dictionary[dictSize++] = w + entry.charAt(0);
            enlargeIn--;
            w = entry;

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }
        }
    },
};

main();
