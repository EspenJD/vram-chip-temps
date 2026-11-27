// Per-chip memory temperature view for one GPU card. No dependencies, no build step.
//
//   import { ChipView } from "./chip-view.js";
//   const view = new ChipView(document.querySelector("#gpu0"), { card: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition" });
//   view.update(temps); // call it again with every new reading
//
// temps is the "temps" object of LACT's device_stats answer ({ "VRAM Chip A0 (IC0)": { current: 31 }, ... })
// or a plain map of sensor name to degrees Celsius ({ "VRAM Chip A0 (IC0)": 31, ... }).
//
// A card that boards.js knows is drawn to scale, in millimetres, as its bare board seen from the
// front and from the back, with every chip where the board has it, and the GPU die with the core
// and hotspot readings. Any other card gets a plain grid with one tile per chip sensor.
// chip-view.css picks one of three layouts from the width of the container.
//
// The view is built once per set of sensor names; update() then writes only what changed.
// Colours are not computed here: update() sets "--t" (0 = cool, 1 = hot) on each shape and
// chip-view.css mixes the two theme colours from it.
import { BOARDS, RING, SIDES } from "./boards.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// "VRAM Chip A0 (IC0)": the label A0 (frame buffer partition A, subpartition 0) and the chip IC0.
const CHIP_NAME = /^VRAM Chip ([A-Za-z]+\d+)(?: \((.+)\))?$/;
// LACT's die sensors: "GPU" and "GPU Hotspot" on NVIDIA, "edge" and "junction" on AMD.
const CORE = ["GPU", "edge"];
const HOTSPOT = ["GPU Hotspot", "junction"];
const HEAT = [40, 100]; // °C at the cool and the hot end of the colour scale
const TILE = [20, 12]; // a tile of the plain grid, mm: room for "A0 Front"
const TILE_GAP = 2;
const GRID_COLUMNS = 8;
const EDGE = 1; // around a drawing, for the outlines at its edge, mm
const BAND_INSET = 0.8; // a band is drawn this much smaller, to stand clear of the chips
const FADE = "5%"; // of a frame's width, where the board goes on past the edge of the frame

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
const mm = (value) => Math.round(value * 100) / 100;
// Give chip-view.css lengths in millimetres, as numbers: { w: 12 } sets --w.
function setSizes(node, sizes) {
  for (const [key, value] of Object.entries(sizes)) node.style.setProperty(`--${key}`, String(mm(value)));
}

// A rectangle from the board data: [cx, cy, width, height, corner radius, turned by degrees].
function box(style, [cx, cy, width, height, radius = 0, turn = 0]) {
  const inset = style === "band" ? BAND_INSET : 0;
  const node = svg("rect", {
    class: `vct-${style}`,
    x: mm(cx - width / 2 + inset),
    y: mm(cy - height / 2 + inset),
    width: mm(width - 2 * inset),
    height: mm(height - 2 * inset),
    rx: radius + inset,
  });
  if (turn) node.setAttribute("transform", `rotate(${turn} ${cx} ${cy})`);
  return node;
}

// The viewBox of the two drawings of a board: the board, the parts that reach over its edge
// (the DisplayPort sockets of the Max-Q do) and EDGE. The back is the board turned around its
// vertical axis, so its x runs the other way. Both get one height: the two boards line up.
function viewBoxes(board) {
  const [width, height] = board.size;
  const reach = (side) => {
    let [left, top, right, bottom] = [0, 0, width, height]; // in the front view
    for (const [, cx, cy, w, h, , turn = 0] of [...board.holes, ...board[side]]) {
      const cos = Math.abs(Math.cos((turn * Math.PI) / 180));
      const sin = Math.abs(Math.sin((turn * Math.PI) / 180));
      const [dx, dy] = [(w * cos + h * sin) / 2, (w * sin + h * cos) / 2];
      [left, top, right, bottom] = [Math.min(left, cx - dx), Math.min(top, cy - dy), Math.max(right, cx + dx), Math.max(bottom, cy + dy)];
    }
    return { left, top, right, bottom };
  };
  const [front, back] = [reach("front"), reach("back")];
  const top = Math.min(front.top, back.top) - EDGE;
  const tall = Math.max(front.bottom, back.bottom) + EDGE - top;
  return {
    front: [front.left - EDGE, top, front.right - front.left + 2 * EDGE, tall],
    back: [width - back.right - EDGE, top, back.right - back.left + 2 * EDGE, tall],
  };
}
// Every card is drawn at one scale. PAIR is the room that the widest two boards side by side
// and the tallest board need, in millimetres; chip-view.css fits that into the container.
const VIEWS = new Map([...BOARDS.values()].map((board) => [board, viewBoxes(board)]));
const PAIR = [
  Math.max(...[...VIEWS.values()].map(({ front, back }) => front[2] + back[2])),
  Math.max(...[...VIEWS.values()].map(({ front }) => front[3])),
];

// LACT's temps object or a plain map -> Map of sensor name to °C (null: no reading).
export function readTemps(temps) {
  const out = new Map();
  for (const [name, value] of Object.entries(temps ?? {})) {
    const celsius = value !== null && typeof value === "object" ? value.current : value;
    out.set(name, typeof celsius === "number" && Number.isFinite(celsius) ? celsius : null);
  }
  return out;
}

// Sort sensor names into the die readings, the memory chips and the rest. On a card with board
// data a chip sensor belongs to a place on one side of the board. One that does not (a label
// the board does not have, a side that SIDES does not name, a place that is taken) is "loose".
// Stock LACT's "(Back)" twin of a "(Front)" reading is the same reading: it is left out.
export function sortSensors(names, board) {
  const core = names.find((name) => CORE.includes(name)) ?? null;
  const hot = names.find((name) => HOTSPOT.includes(name)) ?? null;
  const chips = []; // every memory chip sensor that counts, for the figures
  const sides = { front: new Map(), back: new Map() }; // label -> sensor name
  const loose = [];
  const labels = new Set(board?.places.map(([label]) => label));
  const all = new Set(names);
  for (const name of names) {
    const chip = CHIP_NAME.exec(name);
    if (!chip) continue;
    const [, label, ic] = chip;
    if (board && ic === "Back" && all.has(`VRAM Chip ${label} (Front)`)) continue;
    chips.push(name);
    if (!board) continue;
    const side = sides[SIDES.get(ic)];
    if (side && labels.has(label) && !side.has(label)) side.set(label, name);
    else loose.push(name);
  }
  return { core, hot, chips, sides, loose };
}

// Hottest, coolest, average and spread of the readings of these chips; null if none has one.
export function chipFigures(names, values) {
  const read = names.map((name) => values.get(name)).filter((celsius) => celsius != null);
  if (read.length === 0) return null;
  const max = Math.max(...read);
  const min = Math.min(...read);
  return { max, min, mean: read.reduce((sum, celsius) => sum + celsius, 0) / read.length, spread: max - min, count: read.length };
}

// A shape that shows one reading: the value as text at x, y and the sensor's name with its
// reading as the tooltip. Without a sensor the shape is an empty outline.
function mark(spots, shape, name, size, x, y) {
  const group = svg("g");
  if (!name) {
    shape.classList.add("vct-off");
    group.append(shape);
    return group;
  }
  const spot = { name, shape, title: svg("title"), text: svg("text", { class: size, x, y: mm(y) }), value: undefined };
  spots.push(spot);
  group.append(spot.title, shape, spot.text);
  return group;
}

// One memory chip: its footprint [label, cx, cy, width, height] with the label and the value.
function tile(spots, [label, cx, cy, width, height], name) {
  const shape = svg("rect", { class: "vct-heat", x: mm(cx - width / 2), y: mm(cy - height / 2), width, height, rx: 1.2 });
  const group = mark(spots, shape, name, "vct-value", cx, cy + 4.3);
  if (name) spots.at(-1).chip = true;
  group.append(svg("text", { class: "vct-label", x: cx, y: mm(cy - 1.5) }, label));
  return group;
}

// One side of a board, to scale. The data is the front view. The fixed parts of the back are
// mirrored as a group; its chips are put at the mirrored x, because text must not be mirrored.
function drawSide(spots, board, side, viewBox, chips, die) {
  const back = side === "back";
  const [width] = board.size;
  const root = svg("svg", { class: "vct-drawing", viewBox: viewBox.map(mm).join(" ") });
  const fixed = svg("g", back ? { transform: `translate(${width}) scale(-1 1)` } : {});
  fixed.append(svg("path", { class: "vct-board", d: board.outline }));
  // The GPU package is on the front; the back shows where it is behind the board.
  fixed.append(box(back ? "behind" : "pkg", [...board.package, 1.5]));
  fixed.append(...[...board.holes, ...board[side]].map(([style, ...at]) => box(style, at)));
  root.append(fixed);
  if (!back) {
    // The die shows the core temperature; the round spot on it is the hotspot reading.
    const [cx, cy] = board.die;
    root.append(mark(spots, box("heat", [...board.die, 1.5]), die.core, "vct-core", cx, cy - 6.4));
    root.append(mark(spots, svg("circle", { class: "vct-heat vct-spot", cx, cy: mm(cy + 4.2), r: 7.6 }), die.hot, "vct-value", cx, cy + 6.1));
  }
  root.append(...board.places.map(([label, cx, ...rest]) => tile(spots, [label, back ? mm(width - cx) : cx, ...rest], chips.get(label))));
  return root;
}

// A known card: the front and the back of its board, each in a frame under its title. A frame
// shows its whole drawing or cuts the RING part out of it; chip-view.css picks one by width.
function drawBoards(spots, card, board, sorted) {
  const [width] = board.size;
  const pair = html("div", "vct-boards");
  setSizes(pair, { rw: RING[0], rh: RING[1], pw: PAIR[0], ph: PAIR[1] });
  for (const side of ["front", "back"]) {
    const viewBox = VIEWS.get(board)[side];
    const drawing = drawSide(spots, board, side, viewBox, sorted.sides[side], sorted);
    drawing.setAttribute("role", "img");
    drawing.setAttribute("aria-label", `${side === "back" ? "Back" : "Front"} of the board of the ${card.replace(/^NVIDIA /, "")}: ${board.places.length} memory chips`);
    // Where the RING part starts in this view, and where the drawing starts in the RING part.
    const cut = side === "back" ? width - board.ring[0] - RING[0] : board.ring[0];
    const frame = html("div", "vct-frame");
    setSizes(frame, { w: viewBox[2], h: viewBox[3], rx: viewBox[0] - cut, ry: viewBox[1] - board.ring[1] });
    // Where the board goes on past the left or right edge of the RING part, that edge fades out.
    if (cut > 0) frame.style.setProperty("--fl", FADE);
    if (cut + RING[0] < width) frame.style.setProperty("--fr", FADE);
    frame.append(drawing);
    const half = html("div", "vct-side");
    half.append(html("div", "vct-head", side.toUpperCase()), frame);
    pair.append(half);
  }
  return pair;
}

// A card without board data: one tile per chip sensor, in name order. It claims no place and
// no side, so the tile shows the whole name after "VRAM Chip".
function drawGrid(spots, chips) {
  const [width, height] = TILE;
  const columns = Math.min(GRID_COLUMNS, chips.length);
  const rows = Math.ceil(chips.length / GRID_COLUMNS);
  const size = [columns * (width + TILE_GAP) - TILE_GAP + 2 * EDGE, rows * (height + TILE_GAP) - TILE_GAP + 2 * EDGE];
  const root = svg("svg", { class: "vct-drawing vct-grid", viewBox: [-EDGE, -EDGE, ...size].join(" ") });
  setSizes(root, { w: size[0], h: size[1] });
  chips.forEach((name, n) => {
    const cx = (n % GRID_COLUMNS) * (width + TILE_GAP) + width / 2;
    const cy = Math.floor(n / GRID_COLUMNS) * (height + TILE_GAP) + height / 2;
    const [, label, ic] = CHIP_NAME.exec(name);
    root.append(tile(spots, [ic ? `${label} ${ic}` : label, cx, cy, width, height], name));
  });
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `${chips.length} memory chip sensors`);
  return root;
}

const FIGURES = [
  ["max", "HOTTEST CHIP"],
  ["min", "COOLEST CHIP"],
  ["mean", "CHIP AVERAGE"],
  ["spread", "CHIP SPREAD"],
];

export class ChipView {
  // container: the element to draw into. options.card: the card name as LACT reports it.
  // options.heat: [cool, hot] in °C for the colour scale. options.figures: false hides the
  // four figures under the drawing.
  constructor(container, { card = "", heat = HEAT, figures = true } = {}) {
    this.container = container;
    this.card = card;
    this.heat = heat;
    this.figures = figures;
    this.key = null;
    this.root = html("div", "vct");
    container.append(this.root);
  }

  // Draw new readings. Returns { max, min, mean, spread, count } of the memory chips, or null.
  update(temps) {
    const values = readTemps(temps);
    const names = [...values.keys()];
    const key = names.join("\n");
    if (key !== this.key) this.build(names);
    for (const spot of this.spots) {
      const celsius = values.get(spot.name) ?? null;
      if (spot.value === celsius) continue;
      spot.value = celsius;
      setText(spot.text, celsius == null ? "–" : `${Math.round(celsius)}${spot.chip ? "" : "°"}`);
      this.setHeat(spot.shape, celsius);
      setText(spot.title, `${spot.name}: ${celsius == null ? "no reading" : `${celsius} °C`}`);
    }
    // The hottest chip of the drawing stands out, unless all of them read the same.
    const shown = this.spots.filter((spot) => spot.chip && spot.value != null);
    const top = Math.max(...shown.map((spot) => spot.value));
    const even = shown.every((spot) => spot.value === top);
    for (const spot of this.spots) spot.shape.classList.toggle("vct-max", Boolean(spot.chip) && spot.value === top && !even);
    for (const sensor of this.loose) setText(sensor.value, values.get(sensor.name) == null ? "–" : `${values.get(sensor.name)} °C`);
    const figures = chipFigures(this.sorted.chips, values);
    for (const [key, node] of this.figureNodes) {
      setText(node, figures == null ? "–" : String(Math.round(figures[key] * 10) / 10));
    }
    return figures;
  }

  // Colour a shape by temperature; null is "no reading". Written only when it changed.
  setHeat(node, celsius) {
    const [cool, hot] = this.heat;
    const t = celsius == null ? "" : String(Math.round(Math.min(1, Math.max(0, (celsius - cool) / (hot - cool))) * 100) / 100);
    if (node.dataset.t === t) return;
    node.dataset.t = t;
    node.classList.toggle("vct-off", t === "");
    node.style.setProperty("--t", t || "0");
  }

  build(names) {
    this.key = names.join("\n");
    this.spots = [];
    const board = BOARDS.get(this.card);
    const sorted = sortSensors(names, board);
    this.sorted = sorted;
    this.root.replaceChildren();
    if (sorted.chips.length > 0) {
      this.root.append(board ? drawBoards(this.spots, this.card, board, sorted) : drawGrid(this.spots, sorted.chips));
    }
    this.loose = sorted.loose.map((name) => ({ name, value: html("b") }));
    if (this.loose.length > 0) {
      const list = html("div", "vct-loose");
      for (const sensor of this.loose) {
        const item = html("span", "", sensor.name + " ");
        item.append(sensor.value);
        list.append(item);
      }
      this.root.append(list);
    }
    this.figureNodes = new Map();
    if (this.figures && sorted.chips.length > 0) {
      const row = html("div", "vct-figures");
      for (const [key, label] of FIGURES) {
        const value = html("span", "vct-figure-value");
        const cell = html("div", "vct-figure");
        const line = html("div");
        line.append(value, html("span", "vct-unit", " °C"));
        cell.append(line, html("div", "vct-figure-label", label));
        row.append(cell);
        this.figureNodes.set(key, value);
      }
      this.root.append(row);
    }
  }
}
