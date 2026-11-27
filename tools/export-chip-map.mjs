// Writes web/chip-map.json from web/boards.js, for dashboards that do not run JavaScript.
//   node tools/export-chip-map.mjs          write the file
//   node tools/export-chip-map.mjs --check  exit 1 if the file differs from boards.js
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOARDS, SIDES } from "../web/boards.js";

const target = fileURLToPath(new URL("../web/chip-map.json", import.meta.url));
const rect = ([cx, cy, width, height]) => ({ x: cx, y: cy, width, height });

export function chipMap() {
  const cards = {};
  for (const [name, board] of BOARDS) {
    const [width, height] = board.size;
    cards[name] = {
      board: { width, height },
      die: rect(board.die),
      chips: board.places.map(([label, ...at]) => ({ label, ...rect(at) })),
    };
  }
  return {
    about:
      "Places of the GDDR7 memory chips on the board, in millimetres. Origin top left of the board, " +
      "x right, y down, seen from the front: die side, display bracket left, PCIe edge down. " +
      "x and y are the centre of a chip. A place has one chip on the front and one right behind it on " +
      "the back: on the back view x is board.width - x. LACT sensor 'VRAM Chip <label> (<ic>)' is the " +
      "chip on side sides[<ic>]. Basis and confidence: docs/chip-map.md.",
    units: "mm",
    sides: Object.fromEntries(SIDES),
    cards,
  };
}

// One line per leaf object (a chip, a size), so that a diff shows which chip moved.
const text =
  JSON.stringify(chipMap(), null, 2).replace(/\{[^{}[\]]*\}/g, (leaf) => JSON.stringify(JSON.parse(leaf)).replace(/([:,])/g, "$1 ")) + "\n";
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {}
  if (current !== text) {
    console.error("web/chip-map.json is out of date: run node tools/export-chip-map.mjs");
    process.exit(1);
  }
  console.log("web/chip-map.json matches web/boards.js");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
}
