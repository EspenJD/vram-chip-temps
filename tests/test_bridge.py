"""python3 -m unittest discover -s tests: the bridge against a fake LACT daemon."""

import importlib.util
import json
import os
import shutil
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("bridge", ROOT / "bridge" / "lact-chip-temps.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

WS = "10DE:2BB1-10DE:204B-0000:81:00.0"
MAXQ = "10DE:2BB4-10DE:204C-0000:41:00.0"


def sensor(current):
    return {"current": current, "crit": None, "crit_hyst": None, "primary": False, "display_only": True}


# Shaped like LACT's answers: list_devices, then device_stats per device.
DEVICES = [
    {"id": WS, "name": "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", "device_type": "Dedicated"},
    {"id": MAXQ, "name": "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition", "device_type": "Dedicated"},
]
STATS = {
    WS: {"temps": {"GPU": sensor(31.0), "GPU Hotspot": sensor(33.0), "VRAM Chip A0 (IC0)": sensor(28.0), "VRAM Chip A0 (IC1)": sensor(30.5)}},
    MAXQ: {"temps": {"GPU": sensor(35.0), "VRAM Chip A0 (IC0)": sensor(None), 'odd "name"': sensor(40.0)}},
}


class FakeLact:
    """A unix socket server that answers like lactd and records the commands."""

    def __init__(self, path):
        self.path, self.commands = path, []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen()
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            with conn:
                request = json.loads(conn.makefile().readline())
                self.commands.append(request["command"])
                if request["command"] == "list_devices":
                    reply = {"status": "ok", "data": DEVICES}
                elif request["command"] == "device_stats":
                    reply = {"status": "ok", "data": STATS[request["args"]["id"]]}
                else:
                    reply = {"status": "error", "data": "unknown"}
                conn.sendall(json.dumps(reply).encode() + b"\n")

    def close(self):
        self.server.close()


class BridgeTest(unittest.TestCase):
    def setUp(self):
        # A short folder: a unix socket path has a length limit (104 bytes on macOS).
        self.dir = tempfile.mkdtemp(dir="/tmp" if os.path.isdir("/tmp") else None)
        self.sock = os.path.join(self.dir, "lactd.sock")
        self.lact = FakeLact(self.sock)

    def tearDown(self):
        self.lact.close()
        shutil.rmtree(self.dir)

    def test_read_gpus_sorts_by_pci_and_flattens_temps(self):
        snapshot = bridge.read_gpus(self.sock)
        self.assertEqual([gpu["pci"] for gpu in snapshot["gpus"]], ["0000:41:00.0", "0000:81:00.0"])
        self.assertEqual(snapshot["gpus"][1]["temps"], {"GPU": 31.0, "GPU Hotspot": 33.0, "VRAM Chip A0 (IC0)": 28.0, "VRAM Chip A0 (IC1)": 30.5})
        self.assertIsNone(snapshot["gpus"][0]["temps"]["VRAM Chip A0 (IC0)"])
        self.assertEqual(set(self.lact.commands), {"list_devices", "device_stats"})

    def test_metrics(self):
        text = bridge.metrics(bridge.read_gpus(self.sock))
        self.assertIn('lact_temperature_celsius{gpu="0000:81:00.0",card="NVIDIA RTX PRO 6000 Blackwell Workstation Edition",sensor="VRAM Chip A0 (IC1)",chip="A0",ic="IC1"} 30.5\n', text)
        self.assertIn('sensor="GPU"} 31\n', text)
        self.assertIn('sensor="odd \\"name\\""} 40\n', text)
        self.assertNotIn('gpu="0000:41:00.0",card="NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition",sensor="VRAM Chip A0 (IC0)"', text)
        self.assertTrue(text.startswith("# HELP lact_temperature_celsius"))

    def test_once_prints_json_and_fails_without_lact(self):
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(bridge.main(["--once", "--socket", self.sock]), 0)
        self.assertEqual(len(json.loads(out.getvalue())["gpus"]), 2)
        err = StringIO()
        with redirect_stderr(err):
            self.assertEqual(bridge.main(["--once", "--socket", os.path.join(self.dir, "missing.sock")]), 1)
        self.assertIn("Is lactd running?", err.getvalue())

    def test_http(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.handler_for(bridge.Reader(self.sock, 1.0), "*"))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None

        opener = urllib.request.build_opener(NoRedirect)

        def get(path):
            try:
                with opener.open(base + path) as response:
                    return response.status, dict(response.headers), response.read()
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, dict(error.headers), error.read()

        try:
            status, headers, body = get("/temps.json")
            self.assertEqual(status, 200)
            self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
            self.assertEqual(len(json.loads(body)["gpus"]), 2)
            status, _, body = get("/metrics")
            self.assertEqual(status, 200)
            self.assertIn(b"lact_temperature_celsius{", body)
            status, headers, _ = get("/")
            self.assertEqual((status, headers["Location"]), (302, "/demo/?src=/temps.json"))
            self.assertEqual(get("/demo/")[0], 200)
            self.assertEqual(get("/web/chip-view.js")[0], 200)
            for path in ["/bridge/lact-chip-temps.py", "/web/../bridge/lact-chip-temps.py", "/web/%2e%2e/bridge/lact-chip-temps.py", "/README.md", "/web/missing.js"]:
                self.assertEqual(get(path)[0], 404, path)
            # One LACT reading serves every request within the cache time.
            reads = self.lact.commands.count("list_devices")
            get("/temps.json")
            self.assertEqual(self.lact.commands.count("list_devices"), reads)
            self.lact.close()
            os.unlink(self.sock)
            server.RequestHandlerClass = bridge.handler_for(bridge.Reader(self.sock, 1.0), "*")
            status, _, body = get("/temps.json")
            self.assertEqual(status, 503)
            self.assertIn("Is lactd running?", json.loads(body)["error"])
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
