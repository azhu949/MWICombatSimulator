#!/usr/bin/env node

import { syncOfficialTranslations } from "./official-translation-sync.mjs";

const check = process.argv.slice(2).includes("--check");

try {
    const result = await syncOfficialTranslations({ check });
    const action = check ? "Verified" : (result.changedFiles.length > 0 ? "Updated" : "Already current");
    console.log(`${action} official en/zh translations: ${result.domainCount} domains, ${result.itemCount} items.`);
    for (const filePath of result.changedFiles) {
        console.log(`- ${filePath}`);
    }
} catch (error) {
    console.error(`Official translation ${check ? "check" : "sync"} failed: ${error.message || error}`);
    process.exitCode = 1;
}
