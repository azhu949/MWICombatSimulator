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

const localeFiles = [
    path.join(distDir, "locales", "en", "common.json"),
    path.join(distDir, "locales", "zh", "common.json"),
];

localeFiles.forEach((localeFile) => {
    assertCondition(fileExists(localeFile), `Missing locale file: ${path.relative(distDir, localeFile)}`);
});

const assetsDir = path.join(distDir, "assets");
assertCondition(fileExists(assetsDir), "Missing dist/assets directory.");

let mainBundlePath = "";
let workerBundleName = "";
let multiWorkerBundleName = "";

if (fileExists(assetsDir)) {
    const assetFileNames = fs.readdirSync(assetsDir);
    const mainBundleName = assetFileNames.find((name) => /^main-.*\.js$/.test(name));
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

const legacyHtmlPath = path.join(distDir, "legacy.html");
assertCondition(fileExists(legacyHtmlPath), "Missing dist/legacy.html.");

if (fileExists(legacyHtmlPath)) {
    const legacyHtml = readText(legacyHtmlPath);
    assertCondition(
        legacyHtml.includes('src="js/i18n.js"'),
        "legacy.html should include js/i18n.js for legacy i18n fallback."
    );
}

const legacyI18nPath = path.join(distDir, "js", "i18n.js");
assertCondition(fileExists(legacyI18nPath), "Missing dist/js/i18n.js.");

if (errors.length > 0) {
    errors.forEach((message) => console.error(`[verify-pages-build] ${message}`));
    process.exit(1);
}

console.log("[verify-pages-build] All checks passed.");
