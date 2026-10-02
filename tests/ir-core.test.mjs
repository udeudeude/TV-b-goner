import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDatabase } from "../scripts/build-db.mjs";

import {
  buildSweepWav,
  encodeNec,
  encodeSamsung,
  encodeSirc,
  estimateSweepSeconds,
  littleEndianValue,
  parseFlipper,
  selectCodes,
  toSignal,
} from "../ir-core.js";

function pulseDistanceBytes(signal) {
  const bitSpaces = signal.pattern.slice(3, -1).filter((_, i) => i % 2 === 0);
  assert.equal(bitSpaces.length, 32);
  return Array.from({ length: 4 }, (_, byte) => bitSpaces
    .slice(byte * 8, byte * 8 + 8)
    .reduce((value, space, bit) => value | (Number(space > 1000) << bit), 0));
}

test("Flipper little-endian values are decoded correctly", () => {
  assert.equal(littleEndianValue("15 00 00 00"), 0x15);
  assert.equal(littleEndianValue("34 12 00 00"), 0x1234);
});

test("NECext transmits Flipper's full 16-bit address and command", () => {
  // Flipper's file-format example uses a command whose high byte is not ~0x5D.
  const signal = encodeNec({
    protocol: "NECext",
    address: "EE 87 00 00",
    command: "5D A0 00 00",
  });
  assert.deepEqual(pulseDistanceBytes(signal), [0xEE, 0x87, 0x5D, 0xA0]);
});

test("ordinary NEC still supplies the inverted address and command", () => {
  const signal = encodeNec({ protocol: "NEC", address: "40 00 00 00", command: "12 00 00 00" });
  assert.deepEqual(pulseDistanceBytes(signal), [0x40, 0xBF, 0x12, 0xED]);
});

test("Samsung32 sends the repeated address and inverted command", () => {
  // The deployed database's Samsung Power_off is address 07, command 98.
  const signal = encodeSamsung({ address: "07 00 00 00", command: "98 00 00 00" });
  assert.deepEqual(pulseDistanceBytes(signal), [0x07, 0x07, 0x98, 0x67]);
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

test("brand filter includes shared signals and displays that brand's model", () => {
  const codes = [
    {
      type: "parsed", protocol: "NEC", address: "01", command: "02", action: "toggle",
      brand: "Samsung", model: "Samsung model", name: "Power",
      brands: ["Samsung", "LG"],
      brandDetails: { Samsung: { model: "Samsung model", name: "Power" }, LG: { model: "LG model", name: "Power" } },
    },
    { type: "parsed", protocol: "NEC", address: "01", command: "03", action: "off", brand: "Samsung" },
  ];

  assert.deepEqual(selectCodes(codes, "toggle", "LG").map((x) => [x.brand, x.model]), [["LG", "LG model"]]);
  assert.equal(selectCodes(codes, "off", "LG").length, 0);
  assert.equal(estimateSweepSeconds(selectCodes(codes, "off", "LG")), 0);
  assert.equal(selectCodes(codes, "all", "Samsung").length, 2);
});

test("database builder retains shared brands without mixing OFF and toggle", async () => {
  const root = mkdtempSync(join(tmpdir(), "tv-b-goner-"));
  const input = join(root, "TVs");
  const output = join(root, "codes.json");
  const signal = (name, command) => `name: ${name}\ntype: parsed\nprotocol: NEC\naddress: 01 00 00 00\ncommand: ${command} 00 00 00\n`;
  try {
    mkdirSync(join(input, "Samsung"), { recursive: true });
    mkdirSync(join(input, "LG"), { recursive: true });
    writeFileSync(join(input, "Samsung", "S.ir"), signal("Power", "02") + signal("Off", "03"));
    writeFileSync(join(input, "LG", "L.ir"), signal("Power", "02") + signal("Power", "03"));
    await buildDatabase(input, output);
    const { codes } = JSON.parse(readFileSync(output, "utf8"));

    assert.equal(codes.length, 3);
    assert.deepEqual(selectCodes(codes, "toggle", "LG").map((x) => x.model), ["L", "L"]);
    assert.equal(selectCodes(codes, "off", "LG").length, 0);
    assert.equal(selectCodes(codes, "off", "Samsung").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

  const firstMark = Math.round(sweep.timeline[0].start * 48_000);
  const samples = Array.from({ length: 20 }, (_, i) => [
    view.getInt16(44 + (firstMark + i) * 4, true),
    view.getInt16(46 + (firstMark + i) * 4, true),
  ]);
  assert.ok(samples.some(([left]) => left !== 0));
  assert.ok(samples.every(([left, right]) => left === -right));
});
