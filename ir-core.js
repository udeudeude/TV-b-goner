export const SAMPLE_RATE = 48_000;
export const AMP = 32_000;
export const SUPPORTED_PROTOCOLS = new Set([
  "raw",
  "NEC",
  "NECext",
  "Samsung32",
  "SIRC",
  "SIRC15",
  "SIRC20",
]);

export function bytesLE(s) {
  return (s || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => Number.parseInt(x, 16) & 0xff);
}

export function littleEndianValue(s) {
  return bytesLE(s).reduce((value, byte, i) => value + byte * (2 ** (8 * i)), 0);
}

export function bitsLSB(value, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.floor(value / (2 ** i)) & 1);
  return out;
}

function pulseDistance(bits, leaderMark, leaderSpace, bitMark, zeroSpace, oneSpace, trailerMark = bitMark) {
  const pattern = [leaderMark, leaderSpace];
  for (const bit of bits) pattern.push(bitMark, bit ? oneSpace : zeroSpace);
  if (trailerMark) pattern.push(trailerMark);
  return pattern;
}

export function encodeNec(entry) {
  const addressBytes = bytesLE(entry.address);
  const commandBytes = bytesLE(entry.command);
  const address = (addressBytes[0] || 0) | ((addressBytes[1] || 0) << 8);
  const command = commandBytes[0] || 0;

  let bytes;
  if (entry.protocol === "NECext") {
    bytes = [address & 0xff, (address >> 8) & 0xff, command, (~command) & 0xff];
  } else {
    const a = address & 0xff;
    bytes = [a, (~a) & 0xff, command, (~command) & 0xff];
  }

  return {
    frequency: 38_000,
    pattern: pulseDistance(bytes.flatMap((b) => bitsLSB(b, 8)), 9000, 4500, 560, 560, 1690),
  };
}

export function encodeSamsung(entry) {
  const address = bytesLE(entry.address);
  const command = bytesLE(entry.command);
  const bytes = [address[0] || 0, address[1] || 0, command[0] || 0, command[1] || 0];

  return {
    frequency: 38_000,
    pattern: pulseDistance(bytes.flatMap((b) => bitsLSB(b, 8)), 4500, 4500, 560, 560, 1690),
  };
}

export function encodeSirc(entry) {
  const bitCount = entry.protocol === "SIRC20" ? 20 : entry.protocol === "SIRC15" ? 15 : 12;
  const command = littleEndianValue(entry.command) & 0x7f;
  const addressBits = bitCount - 7;
  const addressMask = (2 ** addressBits) - 1;
  const address = littleEndianValue(entry.address) & addressMask;

  const bits = [
    ...bitsLSB(command, 7),
    ...bitsLSB(address, addressBits),
  ];

  const frame = [2400, 600];
  for (const bit of bits) frame.push(bit ? 1200 : 600, 600);

  // Sony receivers expect SIRC commands to be repeated. Keep each frame on
  // the standard ~45 ms start-to-start period and send three frames.
  const frameUs = frame.reduce((sum, us) => sum + us, 0);
  frame[frame.length - 1] += Math.max(0, 45_000 - frameUs);

  return {
    frequency: 40_000,
    pattern: [...frame, ...frame, ...frame],
  };
}

export function toSignal(entry) {
  if (entry.type === "raw") {
    return {
      frequency: entry.frequency || 38_000,
      pattern: Array.isArray(entry.data) ? entry.data : [],
    };
  }
  if (entry.protocol === "NEC" || entry.protocol === "NECext") return encodeNec(entry);
  if (entry.protocol === "Samsung32") return encodeSamsung(entry);
  if (entry.protocol === "SIRC" || entry.protocol === "SIRC15" || entry.protocol === "SIRC20") return encodeSirc(entry);
  return null;
}

export function selectCodes(codes, mode = "all") {
  return codes.filter((code) => {
    if (!toSignal(code)) return false;
    if (mode === "off") return code.action === "off";
    if (mode === "toggle") return code.action === "toggle";
    return true;
  });
}

export function parseFlipper(text, source = "import") {
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
    else if (key === "data") block.data = value.split(/\s+/).map(Number).filter(Number.isFinite);
  }
  flush();

  return blocks
    .filter((x) => /^(power|power_off|off|standby)$/i.test(x.name || ""))
    .map((x) => ({
      ...x,
      source,
      action: /^(power_off|off|standby)$/i.test(x.name) ? "off" : "toggle",
      brand: source,
      model: "",
    }))
    .filter((x) => (
      x.type === "raw"
        ? Array.isArray(x.data) && x.data.length > 1
        : SUPPORTED_PROTOCOLS.has(x.protocol)
    ));
}

export function framesForUs(us, sampleRate = SAMPLE_RATE) {
  return Math.max(0, Math.round((Math.max(0, us) * sampleRate) / 1_000_000));
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function writeWavHeader(view, channels, dataBytes) {
  const bytesPerSample = 2;
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
}

export function estimateSweepSeconds(entries, gapMs = 140, prePadMs = 80, postPadMs = 40) {
  const signals = entries.map(toSignal).filter(Boolean);
  const signalUs = signals.reduce(
    (sum, signal) => sum + signal.pattern.reduce((part, us) => part + Math.max(0, us), 0),
    0,
  );
  const gapsMs = Math.max(0, signals.length - 1) * gapMs;
  return (signalUs / 1_000_000) + (gapsMs + prePadMs + postPadMs) / 1000;
}

export function buildSweepWav(entries, {
  stereo = false,
  gapMs = 140,
  prePadMs = 80,
  postPadMs = 40,
} = {}) {
  const items = entries
    .map((entry) => ({ entry, signal: toSignal(entry) }))
    .filter((item) => item.signal && item.signal.pattern.length);

  const channels = stereo ? 2 : 1;
  const gapFrames = Math.round((Math.max(0, gapMs) * SAMPLE_RATE) / 1000);
  const prePadFrames = Math.round((Math.max(0, prePadMs) * SAMPLE_RATE) / 1000);
  const postPadFrames = Math.round((Math.max(0, postPadMs) * SAMPLE_RATE) / 1000);

  const signalFrames = items.map(({ signal }) => (
    signal.pattern.reduce((sum, us) => sum + framesForUs(us), 0)
  ));

  const totalFrames = prePadFrames
    + signalFrames.reduce((sum, frames) => sum + frames, 0)
    + Math.max(0, items.length - 1) * gapFrames
    + postPadFrames;

  const dataBytes = totalFrames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeWavHeader(view, channels, dataBytes);

  const timeline = [];
  let frame = prePadFrames;

  const writeSample = (frameIndex, sample) => {
    const offset = 44 + frameIndex * channels * 2;
    view.setInt16(offset, sample, true);
    if (channels === 2) view.setInt16(offset + 2, -sample, true);
  };

  items.forEach(({ entry, signal }, itemIndex) => {
    const startFrame = frame;
    const toneHz = Math.max(1, signal.frequency / 2);
    const phaseInc = (toneHz * 2 * Math.PI) / SAMPLE_RATE;
    let on = true;

    for (const durationUs of signal.pattern) {
      const count = framesForUs(durationUs);
      if (on) {
        let phase = 0;
        for (let i = 0; i < count; i++) {
          writeSample(frame + i, Math.round(Math.sin(phase) * AMP));
          phase += phaseInc;
          if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
        }
      }
      frame += count;
      on = !on;
    }

    const endFrame = frame;
    timeline.push({
      entry,
      start: startFrame / SAMPLE_RATE,
      end: endFrame / SAMPLE_RATE,
    });

    if (itemIndex < items.length - 1) frame += gapFrames;
  });

  frame += postPadFrames;

  return {
    blob: new Blob([buffer], { type: "audio/wav" }),
    duration: totalFrames / SAMPLE_RATE,
    timeline,
    byteLength: buffer.byteLength,
    channels,
  };
}
