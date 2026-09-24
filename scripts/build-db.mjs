import fs from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const outFile = process.argv[3] || "data/power-codes.json";
if (!root) {
  console.error("usage: node scripts/build-db.mjs <IRDB TVs directory> [output]");
  process.exit(2);
}

const SUPPORTED = new Set(["NEC","NECext","Samsung32","SIRC","SIRC15","SIRC20"]);
const preferredBrands = ["Samsung","LG","TCL","Hisense","Sony","Vizio","ONN","Roku","Philips","Panasonic","Sharp","Toshiba","Insignia","Fire_TV","Amazon"];

async function walk(dir) {
  const out = [];
  for (const ent of await fs.readdir(dir,{withFileTypes:true})) {
    const p = path.join(dir,ent.name);
    if (ent.isDirectory()) out.push(...await walk(p));
    else if (ent.isFile() && ent.name.endsWith(".ir")) out.push(p);
  }
  return out;
}

function parse(text) {
  const lines=text.replace(/\r/g,"").split("\n");
  const blocks=[]; let b={};
  const flush=()=>{ if(Object.keys(b).length) blocks.push(b); b={}; };
  for(const raw of lines){
    const line=raw.trim();
    if(!line || line.startsWith("#") || line.startsWith("Filetype:") || line.startsWith("Version:")) continue;
    const m=line.match(/^([^:]+):\s*(.*)$/); if(!m) continue;
    const k=m[1].trim().toLowerCase(), v=m[2].trim();
    if(k==="name" && b.name) flush();
    if(k==="name") b.name=v;
    else if(k==="type") b.type=v;
    else if(k==="protocol") b.protocol=v;
    else if(k==="address") b.address=v;
    else if(k==="command") b.command=v;
    else if(k==="frequency") b.frequency=Number(v);
    else if(k==="duty_cycle") b.duty_cycle=Number(v);
    else if(k==="data") b.data=v.split(/\s+/).map(Number).filter(Number.isFinite);
  }
  flush(); return blocks;
}

function key(x) {
  if (x.type === "raw") return `raw|${x.frequency}|${(x.data||[]).join(",")}`;
  return `${x.protocol}|${x.address}|${x.command}`;
}

const files = await walk(root);
const seen = new Set();
const codes = [];
let unsupported = 0;

for (const file of files) {
  const rel = path.relative(root,file).split(path.sep);
  const brand = rel[0] || "Unknown";
  const model = rel.slice(1).join("/").replace(/\.ir$/i,"");
  const blocks = parse(await fs.readFile(file,"utf8"));
  for (const b of blocks) {
    if (!/^(power|power_off|off|standby)$/i.test(b.name || "")) continue;
    const action = /^(power_off|off|standby)$/i.test(b.name) ? "off" : "toggle";
    const usable = b.type === "raw"
      ? Number.isFinite(b.frequency) && Array.isArray(b.data) && b.data.length > 1
      : SUPPORTED.has(b.protocol);
    if (!usable) { unsupported++; continue; }
    const item = {brand,model,name:b.name,action,type:b.type};
    if (b.type === "raw") {
      item.frequency=b.frequency; item.data=b.data;
    } else {
      item.protocol=b.protocol; item.address=b.address; item.command=b.command;
    }
    const k=key(item); if(seen.has(k)) continue; seen.add(k); codes.push(item);
  }
}

codes.sort((a,b)=>{
  const ao=a.action==="off"?0:1, bo=b.action==="off"?0:1;
  if(ao!==bo) return ao-bo;
  const ap=preferredBrands.indexOf(a.brand), bp=preferredBrands.indexOf(b.brand);
  const ar=ap<0?999:ap, br=bp<0?999:bp;
  return ar-br || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model);
});

const payload = {
  generatedAt:new Date().toISOString(),
  source:"flipperdevices/IRDB (MIT)",
  sourceBranch:"dev",
  codes,
  stats:{filesScanned:files.length,codes:codes.length,unsupportedPowerEntries:unsupported}
};
await fs.mkdir(path.dirname(outFile),{recursive:true});
await fs.writeFile(outFile,JSON.stringify(payload));
console.log(JSON.stringify(payload.stats));
