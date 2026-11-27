# LACT patch: read every GDDR7 chip

`0001-read-every-GDDR7-chip-on-clamshell-cards.patch` is one commit on top of
[LACT](https://github.com/ilya-zlobintsev/LACT).

On a GDDR7 card with memory on both sides of the board (clamshell), every memory partition has
four temperature words, one per chip. Stock LACT reads the first word of each half-partition
and shows its bytes as "(Front)" and "(Back)". On GDDR7 those bytes are the same reading, and the
other 16 chips are never read. The patch reads all four words and names the sensors
`VRAM Chip A0 (IC0)` and `VRAM Chip A0 (IC1)`. GDDR6X and single-sided cards keep their stock
sensors and names.

- Applies to LACT `v0.10.0`, `v0.10.1` and master `9afbb07` (CI builds and tests it there).
- On a machine with more than one NVIDIA GPU, build from master: `v0.10.1` and older can read
  the registers of the wrong card.
- Build, install, check and undo: [AGENTS.md](../AGENTS.md).
- Register layout: [docs/chip-map.md](../docs/chip-map.md#the-registers).

The patch changes LACT's code and is under LACT's MIT license.
