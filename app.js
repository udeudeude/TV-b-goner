import {
  buildSweepWav,
  estimateSweepSeconds,
  parseFlipper,
  selectCodes,
} from "./ir-core.js?v=brand2";

const $ = (id) => document.getElementById(id);
const popularUsBrands = [
  "Samsung", "LG", "Vizio", "TCL", "Hisense", "Sony",
  "ONN", "Insignia", "Roku", "Philips", "Toshiba", "Sharp",
];
const ui = {
  dbStatus: $("dbStatus"),
  brandSelect: $("brandSelect"),
  databaseCount: $("databaseCount"),
  offCount: $("offCount"),
  toggleCount: $("toggleCount"),
  offButton: $("offButton"),
  toggleButton: $("toggleButton"),
  offButtonMeta: $("offButtonMeta"),
  toggleButtonMeta: $("toggleButtonMeta"),
  sourceName: $("sourceName"),
  emitterMode: $("emitterMode"),
  gapMs: $("gapMs"),
  stop: $("stopButton"),
  progress: $("progress"),
  progressText: $("progressText"),
  progressNumbers: $("progressNumbers"),
  current: $("currentCode"),
  recentCodes: $("recentCodes"),
  fileInput: $("fileInput"),
};

let codes = [];
let running = false;
let currentAudio = null;
let currentUrl = null;
let progressTimer = null;
let currentTimeline = [];
let currentList = [];
let recentCodes = [];
let recentIndex = -1;
let trackRecent = false;

function refreshRecent() {
  ui.recentCodes.replaceChildren();
  for (const entry of recentCodes) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = [entry.brand, entry.model, entry.name]
      .filter(Boolean).join(" · ");

    const replay = document.createElement("button");
    replay.type = "button";
    replay.textContent = "REPLAY";
    replay.disabled = running;
    replay.addEventListener("click", () => playEntries([entry], "Replaying code", false));

    item.append(label, replay);
    ui.recentCodes.append(item);
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function listFor(mode) {
  return selectCodes(codes, mode, ui.brandSelect.value);
}

function refreshBrands() {
  const previous = ui.brandSelect.value;
  const brands = [...new Set(codes.flatMap((code) => code.brands || [code.brand]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const popular = document.createElement("optgroup");
  popular.label = "Popular in the U.S.";
  for (const brand of popularUsBrands) {
    if (brands.includes(brand)) popular.append(new Option(brand.replaceAll("_", " "), brand));
  }

  const alphabetic = document.createElement("optgroup");
  alphabetic.label = "All brands — A to Z";
  for (const brand of brands) {
    alphabetic.append(new Option(brand.replaceAll("_", " "), brand));
  }
  ui.brandSelect.replaceChildren(
    new Option("All brands (full sweep)", ""),
    ...(popular.childElementCount ? [popular] : []),
    ...(alphabetic.childElementCount ? [alphabetic] : []),
  );
  ui.brandSelect.value = brands.includes(previous) ? previous : "";
  ui.brandSelect.disabled = running || !brands.length;
}

function refreshSummary() {
  const off = listFor("off");
  const toggle = listFor("toggle");
  const gap = Number(ui.gapMs.value);

  ui.databaseCount.textContent = listFor("all").length.toLocaleString();
  ui.offCount.textContent = off.length.toLocaleString();
  ui.toggleCount.textContent = toggle.length.toLocaleString();

  ui.offButtonMeta.textContent = `${off.length.toLocaleString()} codes · ${formatDuration(estimateSweepSeconds(off, gap))}`;
  ui.toggleButtonMeta.textContent = `${toggle.length.toLocaleString()} codes · ${formatDuration(estimateSweepSeconds(toggle, gap))}`;

  ui.offButton.disabled = !off.length || running;
  ui.toggleButton.disabled = !toggle.length || running;
  ui.brandSelect.disabled = running || !codes.length;
}

function cleanupAudio() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  currentAudio = null;
  currentUrl = null;
  currentTimeline = [];
  currentList = [];
  trackRecent = false;
}

function finishSweep(label, completed = false) {
  if (completed && currentList.length) {
    ui.progress.value = currentList.length;
    ui.progressNumbers.textContent = `${currentList.length} / ${currentList.length}`;
  }
  cleanupAudio();
  running = false;
  ui.stop.disabled = true;
  ui.progressText.textContent = label;
  ui.current.textContent = "—";
  refreshSummary();
  refreshRecent();
}

function updateProgress() {
  if (!currentAudio || !currentTimeline.length) return;
  const time = currentAudio.currentTime;

  let index = -1;
  for (let i = 0; i < currentTimeline.length; i++) {
    if (time >= currentTimeline[i].start) index = i;
    else break;
  }

  if (index < 0) {
    ui.progressText.textContent = "Priming audio output";
    ui.progressNumbers.textContent = `0 / ${currentTimeline.length}`;
    return;
  }

  if (trackRecent && index !== recentIndex) {
    recentIndex = index;
    recentCodes = currentTimeline
      .slice(Math.max(0, index - 7), index + 1)
      .map(({ entry }) => entry)
      .reverse();
    refreshRecent();
  }

  const code = currentTimeline[index].entry;
  ui.progress.value = index + 1;
  ui.progressNumbers.textContent = `${index + 1} / ${currentTimeline.length}`;
  ui.progressText.textContent = code.action === "off" ? "Explicit OFF" : "Other power code";
  ui.current.textContent = [
    code.brand,
    code.model,
    code.name,
    code.protocol || "raw",
  ].filter(Boolean).join(" · ");
}

function playEntries(list, label, saveRecent) {
  if (!list.length || running) return;

  running = true;
  trackRecent = saveRecent;
  if (saveRecent) {
    recentCodes = [];
    recentIndex = -1;
  }
  refreshSummary();
  refreshRecent();
  ui.stop.disabled = false;
  ui.progress.max = list.length;
  ui.progress.value = 0;
  ui.progressNumbers.textContent = `0 / ${list.length}`;
  ui.progressText.textContent = label;
  ui.current.textContent = "One continuous audio stream";

  const stereo = ui.emitterMode.value === "stereo";
  const gap = Number(ui.gapMs.value);

  let sweep;
  try {
    sweep = buildSweepWav(list, { stereo, gapMs: gap });
  } catch (error) {
    console.error(error);
    finishSweep("Could not build sweep");
    return;
  }

  const url = URL.createObjectURL(sweep.blob);
  const audio = new Audio(url);
  audio.volume = 1;

  currentAudio = audio;
  currentUrl = url;
  currentTimeline = sweep.timeline;
  currentList = list;

  audio.onended = () => {
    updateProgress();
    finishSweep("Complete", true);
  };
  audio.onerror = () => finishSweep("Audio playback failed");
  progressTimer = setInterval(updateProgress, 80);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((error) => {
      if (currentAudio !== audio) return;
      console.error(error);
      finishSweep("Playback was blocked");
    });
  }
}

function runSweep(mode) {
  playEntries(
    listFor(mode),
    mode === "off" ? "Building OFF-only sweep" : "Building other power-code sweep",
    true,
  );
}

function stopSweep() {
  if (!running) return;
  updateProgress();
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
  }
  finishSweep("Stopped");
}

async function loadDatabase() {
  try {
    const response = await fetch("data/power-codes.json", { cache: "no-store" });
    if (!response.ok) throw new Error("database unavailable");
    const db = await response.json();
    codes = db.codes || [];
    ui.dbStatus.textContent = "ready";
    ui.sourceName.textContent = db.source || "IRDB";
  } catch (error) {
    console.error(error);
    ui.dbStatus.textContent = "imports only";
    ui.sourceName.textContent = "local .ir files";
  }
  refreshBrands();
  refreshSummary();
}

ui.offButton.addEventListener("click", () => runSweep("off"));
ui.toggleButton.addEventListener("click", () => runSweep("toggle"));
ui.stop.addEventListener("click", stopSweep);
ui.brandSelect.addEventListener("change", refreshSummary);
ui.gapMs.addEventListener("change", refreshSummary);

ui.fileInput.addEventListener("change", async (event) => {
  let added = 0;
  for (const file of event.target.files) {
    const parsed = parseFlipper(await file.text(), file.name);
    codes.push(...parsed);
    added += parsed.length;
  }
  ui.dbStatus.textContent = `ready + ${added} imported`;
  refreshBrands();
  refreshSummary();
});

loadDatabase();
