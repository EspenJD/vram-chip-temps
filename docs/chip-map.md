# Chip map: where each memory chip sits, and how sure that is

This file holds the facts behind `web/boards.js` and `web/chip-map.json`.

## The boards

Both cards carry 32 GDDR7 chips of 3 GB in clamshell: 16 places on each side of the board,
with the back chip right behind the front chip. Front view (die side, display bracket left,
PCIe edge down): 4 chips above the GPU, a column of 5 on each side, 2 below.

| Card | Board | Source of the measurements |
|---|---|---|
| RTX PRO 6000 Blackwell Workstation Edition | small centre board, about 113 x 116 mm, between the two fans | bare-board photos and teardowns of this card; matches the RTX 5090 FE board within about 1 mm |
| RTX PRO 6000 Blackwell Max-Q Workstation Edition | long board, about 190 x 110 mm, blower past the right end (the PG153 design) | one teardown of this card; the bare board of the design |

Sizes and positions are scaled from photos by the 12 x 14 mm GDDR7 package (about 2 % error).

## Sensor names

The patched LACT names a chip `VRAM Chip <label> (<ic>)`, for example `VRAM Chip A0 (IC1)`:

- letter `A` to `H`: the frame buffer partition (8 per card);
- digit `0` / `1`: the subpartition (2 per partition);
- `IC0` / `IC1`: the two chips of that subpartition. They sit at one place, back to back.

Stock LACT names `VRAM Chip A0 (Front)` and `VRAM Chip A0 (Back)`. On these cards both names
carry the same reading: the IC0 chip. The IC1 chips are not read at all.

## Places (both cards)

| Where (front view) | Labels, in order |
|---|---|
| top row, left to right | E0 E1 D0 D1 |
| right column, top to bottom | C0 C1 B0 B1 A0 |
| bottom row, left to right | H0 A1 |
| left column, top to bottom | F1 F0 G1 G0 H1 |

On the back view the board is mirrored left to right: x becomes `board width - x`.

## How sure is it

| Claim | Confidence | Basis |
|---|---|---|
| Side and letter of each place | high | The block diagram in a partner RTX 5090 schematic (same GB202 package, same pad pattern, same pin-1 corner) and NVIDIA's rule on older GPUs: counter-clockwise from the PCIe-side corner away from the bracket, A1, A0, B1, B0, ... |
| 0 and 1 inside a pair | medium-high | Same chain of names. If one link is wrong, the two chips of every letter swap places. |
| The map on the real cards | supported | A load recording on both cards: the temperature gradient follows the airflow as the map predicts (Max-Q: clear; Workstation: less clear). A top/bottom mirror could not be ruled out. |
| IC0 = front, IC1 = back | WS: medium-high; Max-Q: medium | Load recordings: the IC1 chip rose more than the IC0 chip at 16 of 16 places on the Workstation Edition (+3.7 to +5.0 °C at about 400 W) and reacted later at every power step, as chips under the passive back plate must. The Max-Q showed the same direction, a third of the size. Reasoned from heat, not seen on a board. |

A direct check of the side: warm the back plate of an idle card over the memory for a minute
(warm air or a hand) and see which set rises first.

## The registers

Per frame buffer partition `p` (A = 0 ... H = 7):

| Register | Address |
|---|---|
| status word | `0x009024D0 + p * 0x4000` |
| data word `IC0_SUBP0` | `0x009024C0 + p * 0x4000 + 0x0` (valid bit 24 of the status word) |
| data word `IC0_SUBP1` | `... + 0x4` (valid bit 25) |
| data word `IC1_SUBP0` | `... + 0x8` (valid bit 26) |
| data word `IC1_SUBP1` | `... + 0xC` (valid bit 27) |
| clamshell flag | bit 22 of `0x00900200` |

Temperature = `2 * code - 40` °C, with the code in bits 23:16 of a data word. The chips report
in 2 °C steps.

On a GDDR7 clamshell card every valid data word is one chip: 8 partitions x 4 words = 32 chips.
In 600 register dumps of both cards (38,400 words) all four bytes of a word were equal, so
stock LACT's "(Back)" byte is not a second chip. The IC1 words differ from the IC0 words by
2 to 4 °C at idle and move on their own.

LACT's `VRAM` sensor is a roll-up from NVIDIA's API, not one of these words. On the Workstation
Edition it followed the hottest of all 32 chips (also when an IC1 chip was the hottest), so it
most likely covers both sides already.
