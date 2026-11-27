// node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BOARDS, SIDES } from "../web/boards.js";
import { chipFigures, readTemps, sortSensors } from "../web/chip-view.js";

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"].flatMap((letter) => [`${letter}0`, `${letter}1`]);
const sample = JSON.parse(readFileSync(new URL("../demo/samples/load.json", import.meta.url), "utf8"));
const patched = (ic) => LABELS.map((label) => `VRAM Chip ${label} (${ic})`);
const WS = "NVIDIA RTX PRO 6000 Blackwell Workstation Edition";

test("each board has the 16 labels A0 to H1 once, inside the board, without overlap", () => {
  for (const [name, board] of BOARDS) {
    const labels = board.places.map(([label]) => label).sort();
    assert.deepEqual(labels, [...LABELS].sort(), name);
    const [width, height] = board.size;
    for (const [label, cx, cy, w, h] of board.places) {
      assert.ok(cx - w / 2 >= 0 && cx + w / 2 <= width && cy - h / 2 >= 0 && cy + h / 2 <= height, `${name} ${label} inside`);
    }
    for (const [i, a] of board.places.entries()) {
      for (const b of board.places.slice(i + 1)) {
        const apart = Math.abs(a[1] - b[1]) >= (a[3] + b[3]) / 2 || Math.abs(a[2] - b[2]) >= (a[4] + b[4]) / 2;
        assert.ok(apart, `${name} ${a[0]} and ${b[0]} overlap`);
      }
    }
  }
});

test("the patched LACT names fill both sides of a known board", () => {
  const names = ["GPU", "GPU Hotspot", "VRAM", ...LABELS.flatMap((label) => [`VRAM Chip ${label} (IC0)`, `VRAM Chip ${label} (IC1)`])];
  const sorted = sortSensors(names, BOARDS.get(WS));
  assert.equal(sorted.core, "GPU");
  assert.equal(sorted.hot, "GPU Hotspot");
  assert.equal(sorted.chips.length, 32);
  assert.equal(sorted.sides.front.size, 16);
  assert.equal(sorted.sides.back.size, 16);
  assert.equal(sorted.sides.front.get("A0"), "VRAM Chip A0 (IC0)");
  assert.equal(sorted.sides.back.get("A0"), "VRAM Chip A0 (IC1)");
  assert.deepEqual(sorted.loose, []);
});

test("stock LACT names fill the front only; (Back) is the same reading and is left out", () => {
  const names = ["GPU", ...LABELS.flatMap((label) => [`VRAM Chip ${label} (Front)`, `VRAM Chip ${label} (Back)`])];
  const sorted = sortSensors(names, BOARDS.get(WS));
  assert.equal(sorted.chips.length, 16);
  assert.equal(sorted.sides.front.size, 16);
  assert.equal(sorted.sides.back.size, 0);
  assert.deepEqual(sorted.loose, []);
});

test("an unknown card keeps every chip sensor, including Front and Back", () => {
  const names = ["edge", "junction", "VRAM Chip A0 (Front)", "VRAM Chip A0 (Back)", "VRAM Chip A1"];
  const sorted = sortSensors(names, undefined);
  assert.equal(sorted.core, "edge");
  assert.equal(sorted.hot, "junction");
  assert.deepEqual(sorted.chips, names.slice(2));
  assert.deepEqual(sorted.loose, []);
});

test("chip sensors that have no place on a known board are loose", () => {
  const names = [...patched("IC0"), "VRAM Chip J0 (IC0)", "VRAM Chip A0 (IC7)"];
  const sorted = sortSensors(names, BOARDS.get(WS));
  assert.deepEqual(sorted.loose, ["VRAM Chip J0 (IC0)", "VRAM Chip A0 (IC7)"]);
});

test("readTemps takes LACT objects and plain numbers", () => {
  const values = readTemps({ GPU: { current: 31, crit: 98 }, "VRAM Chip A0 (IC0)": 28, "VRAM Chip A0 (IC1)": { current: null }, bad: "x" });
  assert.deepEqual([...values], [["GPU", 31], ["VRAM Chip A0 (IC0)", 28], ["VRAM Chip A0 (IC1)", null], ["bad", null]]);
});

test("figures of the recorded sample", () => {
  const maxq = sample.gpus.find((gpu) => gpu.name.includes("Max-Q"));
  const values = readTemps(maxq.temps);
  const sorted = sortSensors([...values.keys()], BOARDS.get(maxq.name));
  const figures = chipFigures(sorted.chips, values);
  assert.equal(figures.count, 32);
  assert.equal(figures.max, 80);
  assert.equal(figures.min, 70);
  assert.equal(figures.mean, 76);
  assert.equal(chipFigures([], values), null);
});

test("SIDES puts IC0 on the front and IC1 on the back", () => {
  assert.equal(SIDES.get("IC0"), "front");
  assert.equal(SIDES.get("IC1"), "back");
});
