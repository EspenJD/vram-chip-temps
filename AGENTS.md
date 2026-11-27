# AGENTS.md

For AI agents that set this up or change it. Humans: see [README.md](README.md). Chip facts and
their confidence: [docs/chip-map.md](docs/chip-map.md).

## What is here

| Path | What |
|---|---|
| `lact/0001-read-every-GDDR7-chip-on-clamshell-cards.patch` | LACT daemon patch: on GDDR7 clamshell cards, read all 4 temperature words per partition (32 chips) and name them `VRAM Chip A0 (IC0)` / `(IC1)`. New module `vram_temps.rs` with unit tests. GDDR6X and single-sided cards keep their stock names. |
| `bridge/lact-chip-temps.py` | LACT socket to HTTP: `/temps.json`, `/metrics` (Prometheus), `/` (demo, live). Python 3.9+, stdlib only. |
| `web/chip-view.js`, `web/chip-view.css`, `web/boards.js` | The board view. ES modules, no dependencies, no build step. |
| `web/chip-map.json` | Generated from `boards.js`: `node tools/export-chip-map.mjs`. Never edit it by hand. |
| `demo/` | Demo page. `samples/load.json` is a real recording (both cards at their power cap). |
| `tests/` | `npm test` (Node 18+), `python3 -m unittest discover -s tests`. CI also builds patched LACT. |

## Rules

- **Ask the owner before you restart `lactd`.** A daemon start applies the LACT config again
  (clocks, offsets, power caps, fan curves) to every GPU. Restart only with idle GPUs: no
  training, inference or benchmark running. Read GPU use first (`nvidia-smi`).
- Do not write `/etc/lact/config.yaml`. The patch needs no config change.
- The LACT socket also takes commands that change clocks and power. The bridge sends only
  `list_devices` and `device_stats`; keep it that way. For checks, send only those two.
- The bridge has no authentication. Keep the default `127.0.0.1` unless the owner asks for the
  LAN (`--listen 0.0.0.0:9737`).
- Keep the stock LACT package installed: its CLI and GUI talk to the patched daemon.

## 1. Read the current state (read only)

```sh
systemctl status lactd --no-pager | head -5
systemctl cat lactd                       # note any drop-in that already sets ExecStart
ls -l /run/lactd.sock                     # the socket group = LACT's admin group
python3 bridge/lact-chip-temps.py --once  # or: echo '{"command":"list_devices"}' | nc -U /run/lactd.sock
nvidia-smi --query-gpu=index,name,pci.bus_id,utilization.gpu,power.draw --format=csv
```

Read the chip sensor names in the `--once` output:

| Names | Meaning | Next |
|---|---|---|
| `VRAM Chip A0 (IC0)`, `(IC1)` | Patched already (32 per RTX PRO 6000). | Skip to step 5. |
| `VRAM Chip A0 (Front)`, `(Back)` | Stock LACT on a clamshell card: 16 chips, each shown twice. | Patch (steps 2 to 4). |
| `VRAM Chip A0`, no side | Single-sided card: LACT reads every chip already. | No patch. Use the bridge and the grid view. |
| no `VRAM Chip` names | LACT reads no per-chip sensors on this card. | The patch does not help. |

A permission error on the socket: run as a user in the socket's group (`daemon.admin_group` in
`/etc/lact/config.yaml`; LACT's default is the first that exists of `wheel`, `sudo`).

LACT from Flatpak runs its daemon differently: this file does not cover it. Report that.

## 2. Pick the LACT source

- **More than one NVIDIA GPU: build from upstream master at or after `72fc8cf` (PR #1248).**
  LACT v0.10.1 and older map the driver's device id from the NVML minor number, which can
  differ after a boot; register reads, the chip temperatures among them, can then come from the
  wrong card.
- CI builds and tests the patch on master `9afbb07597d23a89dd35a91931af401c5b1ff3f5`. The patch
  also applies to `v0.10.0` and `v0.10.1`.
- Before you patch a newer master, check that upstream does not read the IC1 words itself:
  `grep -rn "IC1" lact-daemon/src/server/gpu_controller/nvidia/`. If it does, use upstream.

## 3. Build

Ubuntu 24.04 / Debian 12 packages shown; other distros need the same libraries (clang, libdrm,
pkg-config). Build as a normal user, not root.

```sh
sudo apt-get install -y git curl build-essential pkg-config clang libclang-dev libdrm-dev
command -v cargo || { curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal; . "$HOME/.cargo/env"; }
git clone https://github.com/ilya-zlobintsev/LACT.git && cd LACT
git checkout 9afbb07597d23a89dd35a91931af401c5b1ff3f5
git apply ../vram-chip-temps/lact/0001-read-every-GDDR7-chip-on-clamshell-cards.patch
cargo test -p lact-daemon --no-default-features --features nvidia --lib vram_temps
cargo build -p lact --release --no-default-features --features nvidia   # = make build-release-headless
```

- `rust-toolchain.toml` in LACT pins the Rust version; rustup installs it on the first cargo call.
- The headless build is daemon + CLI without the GTK GUI. AMD and Intel support stay in.
- Result: `target/release/lact`. About 3 to 10 minutes.

## 4. Install (systemd drop-in) and restart

```sh
sudo install -D -m 0755 target/release/lact /usr/local/libexec/lact-chip-temps/lact
sudo mkdir -p /etc/systemd/system/lactd.service.d
printf '[Service]\nExecStart=\nExecStart=/usr/local/libexec/lact-chip-temps/lact daemon\n' \
  | sudo tee /etc/systemd/system/lactd.service.d/50-chip-temps.conf
sudo systemctl daemon-reload
systemctl cat lactd | grep ExecStart      # the last ExecStart= line must be the new binary
```

If another drop-in already sets `ExecStart` (step 1), ask the owner which binary to keep.

Then, with the owner's yes and idle GPUs:

```sh
nvidia-smi -q -d CLOCK,POWER > /tmp/lact-before.txt
sudo systemctl restart lactd
```

## 5. Verify

```sh
systemctl is-active lactd && journalctl -u lactd -b --since "-5min" --no-pager | tail -20
python3 bridge/lact-chip-temps.py --once | grep -c '(IC1)'   # 16 per RTX PRO 6000
nvidia-smi -q -d CLOCK,POWER | diff /tmp/lact-before.txt - | head   # power limits and clock locks unchanged
```

- An RTX PRO 6000 shows 35 sensors: `GPU`, `GPU Hotspot`, `VRAM`, then `VRAM Chip A0 (IC0)`,
  `VRAM Chip A0 (IC1)` ... `VRAM Chip H1 (IC1)`.
- At idle the IC0 and IC1 chip of a label differ in most pairs (2 to 4 °C). If every pair is
  equal, the IC1 words are not read: stop and report.
- Expect current clocks and temperatures in the diff to move; power limits and clock locks
  must not.

## 6. Roll back

```sh
sudo mv /etc/systemd/system/lactd.service.d/50-chip-temps.conf /tmp/
sudo systemctl daemon-reload
sudo systemctl restart lactd    # owner's yes, idle GPUs
```

## Updates

The drop-in pins the daemon to your build. A LACT package update then changes only the CLI and
GUI, not the daemon. Rebuild with the patch for each LACT release you want. When upstream LACT
reads all chips itself, remove the drop-in; the view also needs the names upstream picks
(`SIDES` in `web/boards.js`).

## Run the bridge as a service

Use a user that can read the socket (step 1). Example `/etc/systemd/system/lact-chip-temps.service`:

```ini
[Unit]
Description=LACT chip temperatures over HTTP
After=lactd.service

[Service]
User=CHANGE_ME
ExecStart=/usr/bin/python3 /opt/vram-chip-temps/bridge/lact-chip-temps.py --listen 127.0.0.1:9737
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Check: `curl -s 127.0.0.1:9737/temps.json | head -c 300` and `curl -s 127.0.0.1:9737/metrics | grep -c '^lact_'`.

Options: `--socket PATH` (or `$LACT_SOCKET`), `--cache SECONDS` (one LACT read serves every
request within it, default 1), `--cors ORIGIN` (default `*`; `''` sends none), `--once`.

## Feed a dashboard

`/temps.json` (shortened: an RTX PRO 6000 has 35 sensors):

```json
{
  "time": 1795817082.671,
  "gpus": [
    {
      "id": "10DE:2BB4-10DE:204C-0000:41:00.0",
      "pci": "0000:41:00.0",
      "name": "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition",
      "temps": {"GPU": 37.0, "GPU Hotspot": 38.0, "VRAM": 36.0, "VRAM Chip A0 (IC0)": 32.0, "VRAM Chip A0 (IC1)": 30.0}
    }
  ]
}
```

A sensor with no reading is `null`. GPUs are in PCI order.

**Web page.** Copy `web/` next to the page, or load it from the bridge. The view takes the
`temps` object as the bridge or LACT's `device_stats` gives it:

```html
<link rel="stylesheet" href="web/chip-view.css">
<div id="gpu0"></div>
<script type="module">
  import { ChipView } from "./web/chip-view.js";
  const read = async () => (await (await fetch("http://127.0.0.1:9737/temps.json")).json()).gpus[0];
  const gpu = await read();
  const view = new ChipView(document.getElementById("gpu0"), { card: gpu.name, heat: [40, 100] });
  view.update(gpu.temps);                                    // returns { max, min, mean, spread, count } or null
  setInterval(async () => view.update((await read()).temps), 2000);
</script>
```

The card name must match a `BOARDS` key in `web/boards.js` exactly; other cards get a grid.
Options: `heat` (°C at the cool and the hot colour), `figures: false` (hide the four figures).
Colours: the `--vct-*` custom properties in `chip-view.css`. Layout follows the container width:
wide (720 px and up) whole boards, medium (470 px and up) cut-outs side by side, narrow stacked.

**Prometheus / Grafana.** Scrape `/metrics`. One gauge, `lact_temperature_celsius`, labels
`gpu` (PCI address), `card`, `sensor`, and for chips `chip` and `ic`. Queries:

```promql
max by (gpu) (lact_temperature_celsius{chip!=""})                          # hottest chip per card
avg by (gpu, ic) (lact_temperature_celsius{chip!=""})                      # front (IC0) vs back (IC1)
```

LACT's own OpenTelemetry exporter (`daemon.metrics.collector_address` in `/etc/lact/config.yaml`,
see LACT `docs/EXPORTER.md`) sends `lact_gpu_temperature` with a `sensor` label: with the patch
that includes all 32 chips. It is a LACT config change: owner's yes and a daemon restart.

**Own drawing.** `web/chip-map.json` has every chip's centre and size in millimetres, front view.

## Add a card

1. Get the exact name from `list_devices`.
2. Measure the board from a bare-board photo, front view (die side, bracket left, PCIe down),
   in millimetres; scale by a known part (a GDDR7 package is 12 x 14 mm).
3. Add an entry to `BOARDS` in `web/boards.js` with the shape of `WORKSTATION`. Place labels only
   with a source for the letter map; without one, leave the card out (it gets the grid).
4. `node tools/export-chip-map.mjs`, `npm test`, look at the demo page.

## Change and test

- `npm test`: web tests and the check that `chip-map.json` matches `boards.js`.
- `python3 -m unittest discover -s tests`: the bridge against a fake LACT socket.
- The patch: CI job `lact-patch` applies it to the pinned LACT commit and runs the unit tests
  and the headless build. To change the patch, edit it in a LACT checkout, then
  `git format-patch -1 --stdout > lact/0001-...patch`.
- Screenshots: render `demo/` with headless Chrome from the sample data only; no host names,
  PCI addresses or user data in them.
- Commits: Conventional Commits.
