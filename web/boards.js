// Board geometry of the GPU cards that chip-view.js can draw, keyed by the card name that LACT
// reports. A card that is not here gets a plain grid instead of a board drawing.
//
// All numbers are millimetres in the bounding box of the main board: origin top left, x right,
// y down, in the front view: the die side of the board with the display bracket left and the
// PCIe edge down. Parts on the back are given in that view too; chip-view.js mirrors them when
// it draws the back. A rectangle is [cx, cy, width, height]: its centre and its size.
//
// Sizes and positions were measured on teardown photos, scaled by the 12 x 14 mm GDDR7 package
// (about 2 % error). Which chip label sits at which place is not documented by NVIDIA for these
// boards: docs/chip-map.md says where it comes from and how sure each part is.

// A place holds two chips: one on the front and one right behind it on the back. The patched
// LACT names the two sensors of a place "VRAM Chip A0 (IC0)" and "VRAM Chip A0 (IC1)". IC0 on
// the front and IC1 on the back comes from load recordings on both cards: the IC1 chips heat
// later and run hotter, as chips under the passive back plate must. It was not seen on a board.
// Stock LACT reads only the IC0 chips and calls that one reading "(Front)" and "(Back)": the
// "(Front)" name is the IC0 chip, the "(Back)" name is the same reading again and is not drawn.
// This map is the only place that knows the side.
export const SIDES = new Map([
  ["IC0", "front"],
  ["IC1", "back"],
  ["Front", "front"],
]);

// Size of the part of a board that a narrow view shows: the GPU with the 16 places around it
// and a margin. It is the same for every card, so that one millimetre is as large on both.
export const RING = [120, 122];

// The 16 places are the same pattern on both boards: 4 above the GPU, 5 right, 2 below, 5 left.
// Each entry is [label, cx, cy, width, height].
const WORKSTATION = {
  size: [113.4, 115.7], // of the board
  ring: [-3.25, -3.15], // top left corner of the RING part: the whole board, it is almost square
  outline:
    "M4.8,0 83.1,0 88.7,5.2 85.5,8.2 91.1,14.7 106.5,5 109.7,8.1 113.4,8.1 113.4,23 112.2,23.4 112,27.5 113.3,27.9 " +
    "113.4,96.1 112,96.1 112,104.1 113.4,104.1 113.4,107.4 109.3,107.9 107,109.6 108.8,111.7 108.8,115.7 66.5,115.7 " +
    "63.8,111.4 39.2,111.4 36.1,114.7 9.8,114.7 0.1,108.6 0.3,18.9 1.2,18.9 1.2,12.6 0.1,12.6 0.1,8.2 4.1,8 5.4,6.6 5.4,5.1 4.8,4Z",
  package: [50.1, 58.1, 61.9, 54.7],
  die: [50.1, 58.1, 24.4, 31.4],
  places: [
    ["E0", 29.9, 22.9, 12, 14], ["E1", 43.4, 22.9, 12, 14], ["D0", 56.9, 22.9, 12, 14], ["D1", 70.5, 22.9, 12, 14],
    ["C0", 91.7, 31, 14.1, 12], ["C1", 91.9, 44.5, 14.1, 12], ["B0", 91.9, 58.1, 14.1, 12], ["B1", 91.9, 71.5, 14.1, 12], ["A0", 92, 85, 14.1, 12],
    ["A1", 69.2, 91.9, 14.1, 12], ["H0", 31.3, 91.9, 14.1, 12],
    ["H1", 8.2, 85, 14.1, 12], ["G0", 8.3, 71.5, 14.1, 12], ["G1", 8.4, 58.1, 14.1, 12], ["F0", 8.4, 44.5, 14.1, 12], ["F1", 8.5, 31, 14.1, 12],
  ],
  // Other parts: [style, cx, cy, width, height, corner radius, turned by degrees]. On the front:
  front: [
    ["band", 52.6, 6.7, 54.5, 12.1], // power stages above, right of and below the GPU
    ["band", 106.8, 55.5, 12.6, 86.1],
    ["band", 72.2, 104.7, 60.4, 13.7],
    // 12V-2x6 power plug in the notch of the top edge. Measured: its 17.5 x 16.5 mm box and
    // the 45 degrees. The 14 x 10 mm body is an assumption that fills that box.
    ["part", 92.1, 8.8, 14, 10, 1.5, 45],
  ],
  // Through the board, seen on both sides: the screw holes of the GPU cooler.
  holes: [
    ["hole", 19.5, 21.1, 4, 4, 2],
    ["hole", 80.7, 21.1, 4, 4, 2],
    ["hole", 19.5, 94.9, 4, 4, 2],
    ["hole", 80.7, 94.8, 4, 4, 2],
  ],
  // On the back, seen on the bare board of this card.
  back: [
    ["band", 50.2, 58.5, 38.2, 36], // capacitors behind the GPU die
    ["part", 50.2, 87.5, 21.1, 5.4, 1], // connector of the flex cable to the display output board
    ["part", 27.4, 105.1, 22.2, 5, 1], // connector to the board with the PCIe fingers
  ],
};

const MAX_Q = {
  size: [190, 110.3],
  ring: [32.7, -5.85], // the board is longer than the RING part: it is the part around the GPU
  // The bite in the right edge is the measured arc around the blower wheel: radius 38.6 mm
  // about (213.9, 47.4). Below it the PCIe hook and the finger tab with its key notch.
  outline:
    "M0,0 190,0 190,17.1A38.6,38.6 0 0 0 190,77.7L190,95.1 161.9,95.1 158.8,92.1 140.4,92.1 140.4,102.6 145.9,102.6 " +
    "145.9,107 145.2,107.8 133,107.8 133,101.7 130.3,101.7 130.3,110.3 58.3,110.3 58.3,101.9 56.4,101.9 56.4,110.3 " +
    "45.2,110.3 45.2,95.1 0,95.1Z",
  package: [92.7, 50.4, 63.1, 56.1],
  die: [92.7, 50.4, 23.9, 31.1],
  places: [
    ["E0", 71.6, 12.7, 12, 14], ["E1", 85.9, 12.7, 12, 14], ["D0", 99.9, 12.7, 12, 14], ["D1", 114.2, 12.7, 12, 14],
    ["C0", 135.8, 22.5, 14, 12], ["C1", 135.8, 36.2, 14, 12], ["B0", 135.8, 50.4, 14, 12], ["B1", 135.8, 64.4, 14, 12], ["A0", 135.8, 78.5, 14, 12],
    ["A1", 112.7, 87.5, 14, 12], ["H0", 72.5, 87.5, 14, 12],
    ["H1", 49.9, 78.4, 14, 12], ["G0", 49.9, 64.3, 14, 12], ["G1", 49.9, 50.4, 14, 12], ["F0", 49.9, 36.2, 14, 12], ["F1", 49.9, 22.4, 14, 12],
  ],
  front: [
    ["band", 26, 44.7, 8, 72.8], // power stage columns left and right of the memory
    ["band", 160, 44.7, 8, 72.8],
    ["part", 5.7, 19.9, 19, 16, 1.5], // 4 DisplayPort sockets; they reach 3.8 mm over the bracket edge
    ["part", 5.7, 41.4, 19, 16, 1.5],
    ["part", 5.7, 62.9, 19, 16, 1.5],
    ["part", 5.7, 84.4, 19, 16, 1.5],
  ],
  holes: [], // the cooler holes of this board were not measured
  // Seen on the bare board of this design. Three more pads on the back cover parts that are
  // not identified: they are not drawn.
  back: [["band", 92.9, 50, 30, 30]], // capacitors behind the GPU die
};

export const BOARDS = new Map([
  ["NVIDIA RTX PRO 6000 Blackwell Workstation Edition", WORKSTATION],
  ["NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition", MAX_Q],
]);
