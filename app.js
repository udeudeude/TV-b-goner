import {
  buildSweepWav,
  estimateSweepSeconds,
  parseFlipper,
  selectCodes,
} from "./ir-core.js";

const $ = (id) => document.getElementById(id);
const ui = {
  dbStatus: $("dbStatus"),
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
  fileInput: $("fileInput"),
};

let codes = [];
let running = false;
let currentAudio = null;
let currentUrl = null;
let progressTimer = null;
let currentTimeline = [];
let currentList = [];

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function listFor(mode) {
  return selectCodes(codes, mode);
}

function refreshSummary() {
  const off = listFor("off");
  const toggle = listFor("toggle");
  const gap = Number(ui.gapMs.value);

  ui.databaseCount.textContent = codes.length.toLocaleString();
  ui.offCount.textContent = off.length.toLocaleString();
  ui.toggleCount.textContent = toggle.length.toLocaleString();

  ui.offButtonMeta.textContent = `${off.length.toLocaleString()} codes · ${formatDuration(estimateSweepSeconds(off, gap))}`;
  ui.toggleButtonMeta.textContent = `${toggle.length.toLocaleString()} codes · ${formatDuration(estimateSweepSeconds(toggle, gap))}`;

  ui.offButton.disabled = !off.length || running;
  ui.toggleButton.disabled = !toggle.length || running;
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

function runSweep(mode) {
  const list = listFor(mode);
  if (!list.length || running) return;

  running = true;
  refreshSummary();
  ui.stop.disabled = false;
  ui.progress.max = list.length;
  ui.progress.value = 0;
  ui.progressNumbers.textContent = `0 / ${list.length}`;
  ui.progressText.textContent = mode === "off" ? "Building OFF-only sweep" : "Building other power-code sweep";
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

  audio.onended = () => finishSweep("Complete", true);
  audio.onerror = () => finishSweep("Audio playback failed");
  progressTimer = setInterval(updateProgress, 80);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((error) => {
      console.error(error);
      finishSweep("Playback was blocked");
    });
  }
}

function stopSweep() {
  if (!running) return;
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
  refreshSummary();
}

ui.offButton.addEventListener("click", () => runSweep("off"));
ui.toggleButton.addEventListener("click", () => runSweep("toggle"));
ui.stop.addEventListener("click", stopSweep);
ui.gapMs.addEventListener("change", refreshSummary);

ui.fileInput.addEventListener("change", async (event) => {
  let added = 0;
  for (const file of event.target.files) {
    const parsed = parseFlipper(await file.text(), file.name);
    codes.push(...parsed);
    added += parsed.length;
  }
  ui.dbStatus.textContent = `ready + ${added} imported`;
  refreshSummary();
});

loadDatabase();
