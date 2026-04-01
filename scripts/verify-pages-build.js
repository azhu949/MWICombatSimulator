const fs = require("fs");
const path = require("path");

const distDir = path.resolve(process.cwd(), "dist");
const errors = [];

function assertCondition(condition, message) {
    if (!condition) {
        errors.push(message);
    }
}

function readText(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function fileExists(filePath) {
    return fs.existsSync(filePath);
}

assertCondition(fileExists(distDir), "Missing dist directory. Run `npm run build` first.");

if (!fileExists(distDir)) {
    errors.forEach((message) => console.error(`[verify-pages-build] ${message}`));
    process.exit(1);
}

const indexHtmlPath = path.join(distDir, "index.html");
assertCondition(fileExists(indexHtmlPath), "Missing dist/index.html.");

if (fileExists(indexHtmlPath)) {
    const indexHtml = readText(indexHtmlPath);
    assertCondition(
        indexHtml.includes('src="./assets/'),
        "index.html should reference scripts with relative ./assets/ path."
    );
    assertCondition(
        indexHtml.includes('href="./assets/'),
        "index.html should reference styles/preloads with relative ./assets/ path."
    );
}

const assetsDir = path.join(distDir, "assets");
assertCondition(fileExists(assetsDir), "Missing dist/assets directory.");

let mainBundlePath = "";
let workerBundleName = "";
let multiWorkerBundleName = "";

if (fileExists(assetsDir)) {
    const assetFileNames = fs.readdirSync(assetsDir);
    const mainBundleName = assetFileNames.find((name) => /^(main|index)-.*\.js$/.test(name));
    workerBundleName = assetFileNames.find((name) => /^worker-.*\.js$/.test(name)) || "";
    multiWorkerBundleName = assetFileNames.find((name) => /^multiWorker-.*\.js$/.test(name)) || "";

    assertCondition(Boolean(mainBundleName), "Missing main JS bundle in dist/assets.");
    assertCondition(Boolean(workerBundleName), "Missing worker JS bundle in dist/assets.");
    assertCondition(Boolean(multiWorkerBundleName), "Missing multiWorker JS bundle in dist/assets.");

    if (mainBundleName) {
        mainBundlePath = path.join(assetsDir, mainBundleName);
    }
}

if (mainBundlePath && fileExists(mainBundlePath)) {
    const mainBundleContent = readText(mainBundlePath);

    if (workerBundleName) {
        assertCondition(
            mainBundleContent.includes(workerBundleName),
            `Main bundle does not reference worker bundle (${workerBundleName}).`
        );
    }

    if (multiWorkerBundleName) {
        assertCondition(
            mainBundleContent.includes(multiWorkerBundleName),
            `Main bundle does not reference multiWorker bundle (${multiWorkerBundleName}).`
        );
    }
}

if (errors.length > 0) {
    errors.forEach((message) => console.error(`[verify-pages-build] ${message}`));
    process.exit(1);
}

console.log("[verify-pages-build] All checks passed.");
