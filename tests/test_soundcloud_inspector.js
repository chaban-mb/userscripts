const fs = require("fs");
const path = require("path");

const userscriptPath = path.join(__dirname, "../src/SoundCloud Metadata Inspector.user.js");
const snapshotDir = path.join(__dirname, "../snapshots/soundcloud");

let userscriptCode = fs.readFileSync(userscriptPath, "utf8");
userscriptCode = userscriptCode.replace(/==\/UserScript==[\s\S]*?\(\s*function\s*\(\s*\)\s*\{/, "");
userscriptCode = userscriptCode.replace(/\}\s*\)\s*\(\s*\)\s*;?\s*$/, "");

global.window = { addEventListener: () => {} };
global.history = { pushState: () => {}, replaceState: () => {} };
global.location = { href: "https://soundcloud.com/test" };
global.MutationObserver = function() { this.observe = () => {}; };
global.GM = { info: { script: { name: "SoundCloud Metadata Inspector" } } };
global.Node = function() {};

global.document = {
    title: "Test",
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {} } }),
    createTextNode: (t) => ({ text: t }),
    createDocumentFragment: () => ({ appendChild: () => {} }),
    createElementNS: () => ({ setAttribute: () => {}, appendChild: () => {} }),
    getElementById: () => null,
    querySelector: () => null,
    body: { appendChild: () => {} }
};
global.sessionStorage = { getItem: () => null, setItem: () => {} };

const scriptFn = new Function("window", "document", "sessionStorage", "history", "location", "MutationObserver", "Node", `
    ${userscriptCode}
    return { parseEntity, generateInspectorSpec, buildTabContentFromSpec, TAB_REGISTRY };
`);

const { parseEntity, generateInspectorSpec, buildTabContentFromSpec, TAB_REGISTRY } = scriptFn(global.window, global.document, global.sessionStorage, global.history, global.location, global.MutationObserver, global.Node);

const fixtureSpecs = [
    { file: "caravel-releases.json", expectedType: "Playlist", desc: "Compilation playlist (No album title/label leakage)" },
    { file: "cltx-real.json", expectedType: "Album", desc: "Single-artist studio album with track UPC variations" },
    { file: "nelmau-pakene.json", expectedType: "Album", desc: "Pop album with uniform label, UPC & ℗ line" },
    { file: "cltx-rebel-track.json", expectedType: "Single / Track", desc: "Single track payload (CLTX - Rebel)" },
    { file: "nelmau-munsydansanoo-track.json", expectedType: "Single / Track", desc: "Single track payload (Nelma U - Mun sydän sanoo)" },
    { file: "caravel-untzuntz-track.json", expectedType: "Single / Track", desc: "Single track payload (Caravel - Untz Untz)" }
];

console.log("=========================================================================");
console.log("            SOUNDCLOUD METADATA INSPECTOR SUITE VERIFICATION            ");
console.log("=========================================================================\n");

let passedCount = 0;

fixtureSpecs.forEach(({ file, expectedType, desc }, index) => {
    console.log(`[FIXTURE ${index + 1}/${fixtureSpecs.length}] ${file} (${desc})`);
    
    const filePath = path.join(snapshotDir, file);
    if (!fs.existsSync(filePath)) {
        console.error(`  ✕ File not found: ${filePath}`);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const meta = parseEntity(rawData);

    if (!meta) {
        console.error(`  ✕ Failed to parse entity from ${file}`);
        return;
    }

    console.log(`  - Type Parsed: "${meta.type}" (Expected: "${expectedType}")`);
    console.log(`  - Title: "${meta.title}"`);
    console.log(`  - Total Tracks: ${meta.tracks?.length || 1}`);
    console.log(`  - Hoisted Keys: [${Array.from(meta.hoistedKeys || []).join(", ")}]`);

    if (meta.type !== expectedType) {
        console.error(`  ✕ Type mismatch: expected ${expectedType}, got ${meta.type}`);
        return;
    }
    console.log(`  ✓ Format Type Verified`);

    if (file === "caravel-releases.json") {
        if (meta.label !== "—" || meta.albumTitle !== null) {
            console.error(`  ✕ Compilation leakage: label="${meta.label}", albumTitle="${meta.albumTitle}"`);
            return;
        }
        console.log(`  ✓ Label Hoisting Logic Verified (Kept on Track Level)`);
    } else if (file === "cltx-real.json" || file === "nelmau-pakene.json") {
        if (meta.label === "—") {
            console.error(`  ✕ Expected hoisted label for studio album ${file}`);
            return;
        }
        console.log(`  ✓ Label Hoisting Logic Verified (Hoisted)`);
    }

    // Verify Tab Specs and DOM Rendering for all tabs
    for (const tab of TAB_REGISTRY) {
        if (tab.show(meta)) {
            const spec = generateInspectorSpec(meta, tab.id);
            const dom = buildTabContentFromSpec(spec, meta);
        }
    }

    const spec = generateInspectorSpec(meta, "release");
    const exportSpec = generateInspectorSpec(meta, "release", { isExport: true });
    
    const specStr = JSON.stringify(spec);
    const exportSpecStr = JSON.stringify(exportSpec);
    
    console.log(`  ✓ Release & Track Export Specs Generated Cleanly (${specStr.length} bytes / ${exportSpecStr.length} bytes)`);
    passedCount++;
    console.log("");
});

console.log("=========================================================================");
console.log(`VERIFICATION SUMMARY: ${passedCount}/${fixtureSpecs.length} Fixtures Passed All Checks Cleanly!`);
console.log("=========================================================================\n");

if (passedCount !== fixtureSpecs.length) {
    process.exit(1);
}
