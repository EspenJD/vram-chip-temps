#!/usr/bin/env python3
"""Read GPU temperatures from the LACT daemon and serve them as JSON and Prometheus metrics.

LACT answers on a unix socket that a browser cannot reach. This bridge asks it for every GPU's
temperature sensors and serves them over HTTP:

  /temps.json   {"time": ..., "gpus": [{"id", "pci", "name", "temps": {sensor: degC}}]}
  /metrics      lact_temperature_celsius{gpu, card, sensor[, chip, ic]} for Prometheus
  /             the demo page with live data (repo checkout only)

It sends LACT only the read commands "list_devices" and "device_stats".
--once prints the JSON one time and exits. Python 3.9 or newer, no dependencies.
"""

import argparse
import json
import os
import re
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

DEFAULT_SOCKET = "/run/lactd.sock"
CHIP_NAME = re.compile(r"^VRAM Chip ([A-Za-z]+\d+)(?: \((.+)\))?$")
PCI_ADDRESS = re.compile(r"[0-9A-Fa-f]{4}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}\.[0-7]$")
REPO = Path(__file__).resolve().parent.parent
STATIC = ("web", "demo")  # the folders that / may serve
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png"}


class LactError(Exception):
    pass


def lact_request(path, command, args=None, timeout=5.0):
    """One request to the LACT daemon: a JSON line out, a JSON line back. Returns "data"."""
    message = {"command": command}
    if args is not None:
        message["args"] = args
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(timeout)
            conn.connect(path)
            conn.sendall(json.dumps(message).encode() + b"\n")
            buffer = b""
            while not buffer.endswith(b"\n"):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
    except PermissionError as error:
        raise LactError(f"{path}: {error.strerror}. Run as a user in LACT's admin group (daemon.admin_group in /etc/lact/config.yaml).") from error
    except OSError as error:
        raise LactError(f"{path}: {error.strerror or error}. Is lactd running?") from error
    try:
        reply = json.loads(buffer)
    except ValueError as error:
        raise LactError(f"{command}: LACT sent no JSON") from error
    if reply.get("status") != "ok":
        raise LactError(f"{command}: {reply.get('data')}")
    return reply.get("data")


def pci_of(device_id):
    """LACT's id ends with the PCI address: "10DE:2BB1-10DE:204B-0000:81:00.0" -> "0000:81:00.0"."""
    match = PCI_ADDRESS.search(device_id)
    return match.group(0).lower() if match else None


def read_gpus(path):
    """Every GPU that LACT knows, in PCI order, with its temperature sensors in LACT's order."""
    gpus = []
    for device in lact_request(path, "list_devices"):
        stats = lact_request(path, "device_stats", {"id": device["id"]})
        temps = {}
        for name, sensor in (stats.get("temps") or {}).items():
            current = sensor.get("current") if isinstance(sensor, dict) else None
            temps[name] = current if isinstance(current, (int, float)) else None
        gpus.append({"id": device["id"], "pci": pci_of(device["id"]), "name": device.get("name") or "", "temps": temps})
    gpus.sort(key=lambda gpu: (gpu["pci"] is None, gpu["pci"] or "", gpu["id"]))
    return {"time": round(time.time(), 3), "gpus": gpus}


def label_value(text):
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def number(value):
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def metrics(snapshot):
    """Prometheus text format. A chip sensor also gets its chip label and IC as labels."""
    lines = [
        "# HELP lact_temperature_celsius Temperature sensor reading from the LACT daemon.",
        "# TYPE lact_temperature_celsius gauge",
    ]
    for gpu in snapshot["gpus"]:
        for sensor, celsius in gpu["temps"].items():
            if celsius is None:
                continue
            labels = {"gpu": gpu["pci"] or gpu["id"], "card": gpu["name"], "sensor": sensor}
            chip = CHIP_NAME.match(sensor)
            if chip:
                labels["chip"] = chip.group(1)
                if chip.group(2):
                    labels["ic"] = chip.group(2)
            text = ",".join(f'{key}="{label_value(value)}"' for key, value in labels.items())
            lines.append(f"lact_temperature_celsius{{{text}}} {number(celsius)}")
    return "\n".join(lines) + "\n"


class Reader:
    """Reads LACT at most once per `ttl` seconds, however many clients ask."""

    def __init__(self, path, ttl):
        self.path, self.ttl = path, ttl
        self.lock = threading.Lock()
        self.at, self.snapshot = 0.0, None

    def get(self):
        with self.lock:
            if self.snapshot is None or time.monotonic() - self.at >= self.ttl:
                self.snapshot = read_gpus(self.path)
                self.at = time.monotonic()
            return self.snapshot


def handler_for(reader, cors):
    class Handler(BaseHTTPRequestHandler):
        server_version = "lact-chip-temps"

        def send(self, status, body, content_type):
            data = body.encode() if isinstance(body, str) else body
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if cors:
                self.send_header("Access-Control-Allow-Origin", cors)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            if path in ("/temps.json", "/metrics"):
                try:
                    snapshot = reader.get()
                except LactError as error:
                    self.send(503, json.dumps({"error": str(error)}) + "\n", "application/json")
                    return
                if path == "/metrics":
                    self.send(200, metrics(snapshot), "text/plain; version=0.0.4; charset=utf-8")
                else:
                    self.send(200, json.dumps(snapshot) + "\n", "application/json")
                return
            if path == "/":
                self.send_response(302)
                self.send_header("Location", "/demo/?src=/temps.json")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.static(path)

        do_HEAD = do_GET

        def static(self, path):
            if path.endswith("/"):
                path += "index.html"
            parts = [part for part in path.split("/") if part]
            target = REPO.joinpath(*parts).resolve() if parts else REPO
            allowed = any(target.is_relative_to(REPO / folder) for folder in STATIC)
            if not parts or parts[0] not in STATIC or not allowed or not target.is_file():
                self.send(404, "not found\n", "text/plain")
                return
            self.send(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

        def log_message(self, *args):
            pass

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve LACT's GPU temperatures as JSON and Prometheus metrics.")
    parser.add_argument("--socket", default=os.environ.get("LACT_SOCKET", DEFAULT_SOCKET), help=f"LACT socket (default {DEFAULT_SOCKET}, or $LACT_SOCKET)")
    parser.add_argument("--listen", default="127.0.0.1:9737", help="HOST:PORT to serve on (default 127.0.0.1:9737; 0.0.0.0:9737 for the LAN)")
    parser.add_argument("--cache", type=float, default=1.0, help="seconds to reuse one LACT reading (default 1)")
    parser.add_argument("--cors", default="*", help="Access-Control-Allow-Origin value, '' for none (default *)")
    parser.add_argument("--once", action="store_true", help="print the JSON one time and exit")
    args = parser.parse_args(argv)

    if args.once:
        try:
            print(json.dumps(read_gpus(args.socket), indent=2))
        except LactError as error:
            print(f"lact-chip-temps: {error}", file=sys.stderr)
            return 1
        return 0

    host, _, port = args.listen.rpartition(":")
    server = ThreadingHTTPServer((host.strip("[]") or "127.0.0.1", int(port)), handler_for(Reader(args.socket, args.cache), args.cors))
    print(f"lact-chip-temps: http://{args.listen}/ (temps.json, metrics), LACT socket {args.socket}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
