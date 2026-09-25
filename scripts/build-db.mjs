import fs from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const outFile = process.argv[3] || "data/power-codes.json";
if (!root) {
  console.error("usage: node scripts/build-db.mjs <IRDB TVs directory> [output]");
  process.exit(2);
}

const SUPPORTED = new Set(["NEC", "NECext", "Samsung32", "SIRC", "SIRC15", "SIRC20"]);
const preferredBrands = [
  "Samsung",
  "LG",
  "TCL",
  "Hisense",
  "Sony",
  "Vizio",
  "ONN",
  "Roku",
  "Philips",
  "Panasonic",
  "Sharp",
  "Toshiba",
  "Insignia",
  "Fire_TV",
  "Amazon",
];

async function walk(dir) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else if (ent.isFile() && ent.name.endsWith(".ir")) out.push(p);
  }
  return out;
}

function parse(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks = [];
  let block = {};

  const flush = () => {
    if (Object.keys(block).length) blocks.push(block);
    block = {};
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("Filetype:") || line.startsWith("Version:")) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "name" && block.name) flush();

    if (key === "name") block.name = value;
    else if (key === "type") block.type = value;
    else if (key === "protocol") block.protocol = value;
    else if (key === "address") block.address = value;
    else if (key === "command") block.command = value;
    else if (key === "frequency") block.frequency = Number(value);
    else if (key === "duty_cycle") block.duty_cycle = Number(value);
    else if (key === "data") block.data = value.split(/\s+/).map(Number).filter(Number.isFinite);
  }

  flush();
  return blocks;
}

function key(item) {
  if (item.type === "raw") return `raw|${item.frequency}|${(item.data || []).join(",")}`;
  return `${item.protocol}|${item.address}|${item.command}`;
}

function rankBrand(brand) {
  const index = preferredBrands.indexOf(brand);
  return index < 0 ? 999 : index;
}

function compareCandidates(a, b) {
  const actionA = a.action === "off" ? 0 : 1;
  const actionB = b.action === "off" ? 0 : 1;
  return actionA - actionB
    || rankBrand(a.brand) - rankBrand(b.brand)
    || a.brand.localeCompare(b.brand)
    || a.model.localeCompare(b.model);
}

function increment(counter, label) {
  counter[label] = (counter[label] || 0) + 1;
}

function sortedCounter(counter) {
  return Object.fromEntries(
    Object.entries(counter).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

const files = await walk(root);
const candidates = [];
const unsupportedByProtocol = {};
const includedByProtocol = {};
let unsupported = 0;
let powerEntries = 0;

for (const file of files) {
  const rel = path.relative(root, file).split(path.sep);
  const brand = rel[0] || "Unknown";
  const model = rel.slice(1).join("/").replace(/\.ir$/i, "");
  const blocks = parse(await fs.readFile(file, "utf8"));

  for (const block of blocks) {
    if (!/^(power|power_off|off|standby)$/i.test(block.name || "")) continue;
    powerEntries++;

    const action = /^(power_off|off|standby)$/i.test(block.name) ? "off" : "toggle";
    const usable = block.type === "raw"
      ? Number.isFinite(block.frequency) && Array.isArray(block.data) && block.data.length > 1
      : SUPPORTED.has(block.protocol);

    if (!usable) {
      unsupported++;
      increment(
        unsupportedByProtocol,
        block.type === "raw" ? "raw-invalid" : (block.protocol || block.type || "unknown"),
      );
      continue;
    }

    const item = {
      brand,
      model,
      name: block.name,
      action,
      type: block.type,
    };

    if (block.type === "raw") {
      item.frequency = block.frequency;
      item.data = block.data;
      increment(includedByProtocol, "raw");
    } else {
      item.protocol = block.protocol;
      item.address = block.address;
      item.command = block.command;
      increment(includedByProtocol, block.protocol || "unknown");
    }

    candidates.push(item);
  }
}

// Sort before deduplication. When identical commands appear under many brands,
// this keeps the representative attached to a high-priority modern TV brand
// instead of whichever directory happened to be scanned first.
candidates.sort(compareCandidates);

const seen = new Set();
const codes = [];
for (const item of candidates) {
  const identity = key(item);
  if (seen.has(identity)) continue;
  seen.add(identity);
  codes.push(item);
}

const offCodes = codes.filter((code) => code.action === "off").length;
const toggleCodes = codes.length - offCodes;

const payload = {
  generatedAt: new Date().toISOString(),
  source: "flipperdevices/IRDB (MIT)",
  sourceBranch: "dev",
  codes,
  stats: {
    filesScanned: files.length,
    powerEntries,
    candidateUsableEntries: candidates.length,
    codes: codes.length,
    duplicatesRemoved: candidates.length - codes.length,
    offCodes,
    toggleCodes,
    unsupportedPowerEntries: unsupported,
    includedByProtocol: sortedCounter(includedByProtocol),
    unsupportedByProtocol: sortedCounter(unsupportedByProtocol),
  },
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(payload));
console.log(JSON.stringify(payload.stats, null, 2));
