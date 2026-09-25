import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSweepWav,
  encodeSirc,
  littleEndianValue,
  parseFlipper,
  selectCodes,
  toSignal,
} from "../ir-core.js";

test("Flipper little-endian values are decoded correctly", () => {
  assert.equal(littleEndianValue("15 00 00 00"), 0x15);
  assert.equal(littleEndianValue("34 12 00 00"), 0x1234);
});

test("Sony SIRC power command uses the Flipper command byte and repeats three frames", () => {
  const signal = encodeSirc({
    protocol: "SIRC",
    address: "01 00 00 00",
    command: "15 00 00 00",
  });

  assert.equal(signal.frequency, 40_000);
  assert.equal(signal.pattern.reduce((sum, us) => sum + us, 0), 135_000);

  // command 0x15 starts LSB-first 1,0,1,0,1,0,0
  assert.deepEqual(signal.pattern.slice(0, 10), [
    2400, 600,
    1200, 600,
    600, 600,
    1200, 600,
    600, 600,
  ]);
});

test("selected codes preserve database priority order", () => {
  const codes = [
    { type: "parsed", protocol: "NEC", address: "01", command: "01", action: "off", brand: "Samsung" },
    { type: "parsed", protocol: "NEC", address: "02", command: "02", action: "toggle", brand: "Samsung" },
    { type: "parsed", protocol: "NEC", address: "03", command: "03", action: "toggle", brand: "LG" },
  ];

  assert.deepEqual(selectCodes(codes, "all").map((x) => x.brand), ["Samsung", "Samsung", "LG"]);
  assert.equal(selectCodes(codes, "off").length, 1);
});

test("Flipper import extracts power commands only", () => {
  const parsed = parseFlipper(`Filetype: IR signals file
Version: 1
#
name: Power
type: parsed
protocol: SIRC
address: 01 00 00 00
command: 15 00 00 00
#
name: Vol_up
type: parsed
protocol: SIRC
address: 01 00 00 00
command: 12 00 00 00
`, "Sony test");

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Power");
  assert.ok(toSignal(parsed[0]));
});

test("sweep is emitted as one stereo WAV with a timeline", async () => {
  const entries = [
    { type: "parsed", protocol: "NEC", address: "01", command: "01", action: "off", brand: "A" },
    { type: "parsed", protocol: "NEC", address: "02", command: "02", action: "toggle", brand: "B" },
  ];
  const sweep = buildSweepWav(entries, { stereo: true, gapMs: 100, prePadMs: 10, postPadMs: 10 });

  assert.equal(sweep.channels, 2);
  assert.equal(sweep.timeline.length, 2);
  assert.ok(sweep.timeline[1].start > sweep.timeline[0].end);
  assert.ok(sweep.byteLength > 44);

  const view = new DataView(await sweep.blob.arrayBuffer());
  assert.equal(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48_000);
});
