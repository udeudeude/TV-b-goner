const SAMPLE_RATE = 48000;
const AMP = 0.97;
const SUPPORTED = new Set(["raw","NEC","NECext","Samsung32","SIRC","SIRC15","SIRC20"]);

const $ = (id) => document.getElementById(id);
const ui = {
  dbStatus: $("dbStatus"), codeCount: $("codeCount"), sourceName: $("sourceName"),
  emitterMode: $("emitterMode"), sweepMode: $("sweepMode"), gapMs: $("gapMs"),
  go: $("goButton"), stop: $("stopButton"), progress: $("progress"),
  progressText: $("progressText"), progressNumbers: $("progressNumbers"),
  current: $("currentCode"), fileInput: $("fileInput")
};

let codes = [];
let running = false;
let currentAudio = null;

function hexValue(s) {
  return Number.parseInt((s || "0").replace(/[^0-9a-f]/gi, ""), 16) || 0;
}

function bytesLE(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).map(x => Number.parseInt(x,16) & 255);
}

function bitsLSB(value, count) {
  const out = [];
  for (let i=0; i<count; i++) out.push((value >> i) & 1);
  return out;
}

function pulseDistance(bits, leaderMark, leaderSpace, bitMark, zeroSpace, oneSpace, trailerMark=bitMark) {
  const p = [leaderMark, leaderSpace];
  for (const b of bits) p.push(bitMark, b ? oneSpace : zeroSpace);
  if (trailerMark) p.push(trailerMark);
  return p;
}

function encodeNec(entry) {
  const a = bytesLE(entry.address);
  const c = bytesLE(entry.command);
  const addr = (a[0] || 0) | ((a[1] || 0) << 8);
  const cmd = c[0] || 0;
  let bytes;
  if (entry.protocol === "NECext") {
    bytes = [addr & 255, (addr >> 8) & 255, cmd, (~cmd) & 255];
  } else {
    const aa = addr & 255;
    bytes = [aa, (~aa) & 255, cmd, (~cmd) & 255];
  }
  const bits = bytes.flatMap(b => bitsLSB(b,8));
  return {frequency: 38000, pattern: pulseDistance(bits,9000,4500,560,560,1690)};
}

function encodeSamsung(entry) {
  const a = bytesLE(entry.address);
  const c = bytesLE(entry.command);
  const bytes = [a[0]||0, a[1]||0, c[0]||0, c[1]||0];
  const bits = bytes.flatMap(b => bitsLSB(b,8));
  return {frequency: 38000, pattern: pulseDistance(bits,4500,4500,560,560,1690)};
}

function encodeSirc(entry) {
  const command = hexValue(entry.command) & 0x7f;
  const address = hexValue(entry.address);
  const n = entry.protocol === "SIRC20" ? 20 : entry.protocol === "SIRC15" ? 15 : 12;
  const bits = [
    ...bitsLSB(command,7),
    ...bitsLSB(address, n - 7)
  ];
  const p = [2400,600];
  for (const b of bits) p.push(b ? 1200 : 600, 600);
  return {frequency: 40000, pattern: p};
}

function toSignal(entry) {
  if (entry.type === "raw") return {frequency: entry.frequency || 38000, pattern: entry.data};
  if (entry.protocol === "NEC" || entry.protocol === "NECext") return encodeNec(entry);
  if (entry.protocol === "Samsung32") return encodeSamsung(entry);
  if (entry.protocol === "SIRC" || entry.protocol === "SIRC15" || entry.protocol === "SIRC20") return encodeSirc(entry);
  return null;
}

function selectedCodes() {
  const mode = ui.sweepMode.value;
  const filtered = codes.filter(c => {
    if (!toSignal(c)) return false;
    if (mode === "off") return c.action === "off";
    if (mode === "toggle") return c.action === "toggle";
    return true;
  });
  return filtered.sort((a,b) => {
    const pa = a.action === "off" ? 0 : 1;
    const pb = b.action === "off" ? 0 : 1;
    return pa - pb || (a.brand || "").localeCompare(b.brand || "");
  });
}

function refreshCount() {
  const n = selectedCodes().length;
  ui.codeCount.textContent = n.toLocaleString();
  ui.go.disabled = !n || running;
}

function framesForUs(us) {
  return Math.max(0, Math.round(us * SAMPLE_RATE / 1_000_000));
}

function synthesize(signal, stereo=false) {
  const channels = stereo ? 2 : 1;
  const frameCount = signal.pattern.reduce((n,us)=>n+framesForUs(us),0);
  const pcm = new Float32Array(frameCount * channels);
  const audioToneHz = Math.max(1, signal.frequency / 2);
  const step = 2 * Math.PI * audioToneHz / SAMPLE_RATE;
  let frame = 0;
  let on = true;

  for (const us of signal.pattern) {
    const count = framesForUs(us);
    let phase = 0;
    for (let i=0; i<count; i++, frame++) {
      const s = on ? Math.sin(phase) * AMP : 0;
      if (channels === 1) pcm[frame] = s;
      else {
        pcm[frame*2] = s;
        pcm[frame*2+1] = -s;
      }
      phase += step;
      if (phase >= 2*Math.PI) phase -= 2*Math.PI;
    }
    on = !on;
  }
  return {pcm, channels, frames: frame};
}

function wavBlob(signal, stereo=false) {
  const {pcm, channels, frames} = synthesize(signal, stereo);
  const bytesPerSample = 2;
  const dataBytes = pcm.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o,s) => [...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  str(0,"RIFF"); v.setUint32(4,36+dataBytes,true); str(8,"WAVE");
  str(12,"fmt "); v.setUint32(16,16,true); v.setUint16(20,1,true);
  v.setUint16(22,channels,true); v.setUint32(24,SAMPLE_RATE,true);
  v.setUint32(28,SAMPLE_RATE*channels*bytesPerSample,true);
  v.setUint16(32,channels*bytesPerSample,true); v.setUint16(34,16,true);
  str(36,"data"); v.setUint32(40,dataBytes,true);
  let o=44;
  for (let i=0;i<pcm.length;i++,o+=2) {
    const s = Math.max(-1,Math.min(1,pcm[i]));
    v.setInt16(o, s < 0 ? s*32768 : s*32767, true);
  }
  return {blob:new Blob([buf],{type:"audio/wav"}), duration:frames/SAMPLE_RATE};
}

async function playSignal(signal, stereo) {
  const {blob,duration} = wavBlob(signal, stereo);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  audio.volume = 1;
  await audio.play();
  await new Promise(resolve => {
    const done = () => resolve();
    audio.addEventListener("ended", done, {once:true});
    audio.addEventListener("error", done, {once:true});
    setTimeout(done, duration*1000 + 300);
  });
  URL.revokeObjectURL(url);
  currentAudio = null;
}

async function runSweep() {
  const list = selectedCodes();
  if (!list.length || running) return;
  running = true;
  ui.go.disabled = true; ui.stop.disabled = false;
  ui.progress.max = list.length; ui.progress.value = 0;
  const stereo = ui.emitterMode.value === "stereo";
  const gap = Number(ui.gapMs.value);

  for (let i=0; i<list.length && running; i++) {
    const c = list[i];
    ui.progressText.textContent = c.action === "off" ? "OFF sweep" : "Power sweep";
    ui.progressNumbers.textContent = `${i+1} / ${list.length}`;
    ui.current.textContent = [c.brand,c.model,c.name,c.protocol || "raw"].filter(Boolean).join(" · ");
    const sig = toSignal(c);
    if (sig) {
      try { await playSignal(sig, stereo); } catch (e) { console.warn(e); }
    }
    ui.progress.value = i+1;
    if (running) await new Promise(r => setTimeout(r,gap));
  }

  running = false;
  ui.stop.disabled = true;
  ui.progressText.textContent = "Ready";
  ui.current.textContent = "—";
  refreshCount();
}

function stopSweep() {
  running = false;
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
  ui.stop.disabled = true;
  ui.progressText.textContent = "Stopped";
  refreshCount();
}

function parseFlipper(text, source="import") {
  const lines = text.replace(/\r/g,"").split("\n");
  const blocks = [];
  let b = {};
  const flush = () => {
    if (Object.keys(b).length) blocks.push(b);
    b = {};
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("Filetype:") || line.startsWith("Version:")) continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "name" && b.name) flush();
    if (key === "name") b.name = value;
    else if (key === "type") b.type = value;
    else if (key === "protocol") b.protocol = value;
    else if (key === "address") b.address = value;
    else if (key === "command") b.command = value;
    else if (key === "frequency") b.frequency = Number(value);
    else if (key === "data") b.data = value.split(/\s+/).map(Number).filter(Number.isFinite);
  }
  flush();
  return blocks
    .filter(x => /^(power|power_off|off|standby)$/i.test(x.name || ""))
    .map(x => ({
      ...x, source,
      action: /^(power_off|off|standby)$/i.test(x.name) ? "off" : "toggle",
      brand: source, model: ""
    }))
    .filter(x => x.type === "raw" ? Array.isArray(x.data) && x.data.length : SUPPORTED.has(x.protocol));
}

async function loadDatabase() {
  try {
    const res = await fetch("data/power-codes.json", {cache:"no-store"});
    if (!res.ok) throw new Error("database unavailable");
    const db = await res.json();
    codes = db.codes || [];
    ui.dbStatus.textContent = "ready";
    ui.sourceName.textContent = db.source || "IRDB";
  } catch (e) {
    ui.dbStatus.textContent = "imports only";
    ui.sourceName.textContent = "local .ir";
  }
  refreshCount();
}

ui.go.addEventListener("click", runSweep);
ui.stop.addEventListener("click", stopSweep);
ui.sweepMode.addEventListener("change", refreshCount);
ui.fileInput.addEventListener("change", async (ev) => {
  let added = 0;
  for (const f of ev.target.files) {
    const parsed = parseFlipper(await f.text(), f.name);
    codes.push(...parsed); added += parsed.length;
  }
  ui.dbStatus.textContent = `ready + ${added} imported`;
  refreshCount();
});

loadDatabase();
