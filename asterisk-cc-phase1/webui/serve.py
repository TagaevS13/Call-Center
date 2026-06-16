#!/usr/bin/env python3
"""Static Web UI + REST API (/api/*) backed by Postgres.

HTTP for API legacy; HTTPS required for agent WebRTC (microphone in browser).

Usage:
    python serve.py            # http://0.0.0.0:8080 + optional https
    python serve.py 9000
"""
from __future__ import annotations

import os
import ssl
import sys
import http.server
import socketserver
import threading
from pathlib import Path

try:
    from cc_api import handle_api
except ImportError:
    handle_api = None  # type: ignore

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
TLS_PORT = int(os.environ.get("WEBUI_TLS_PORT", "9443"))
ROOT = Path(__file__).parent.resolve()
TLS_CERT = os.environ.get(
    "CC_TLS_CERT",
    "/asterisk-etc/keys/asterisk.pem" if Path("/asterisk-etc/keys/asterisk.pem").is_file() else "",
)
TLS_KEY = os.environ.get(
    "CC_TLS_KEY",
    "/asterisk-etc/keys/asterisk.key" if Path("/asterisk-etc/keys/asterisk.key").is_file() else "",
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/") and handle_api:
            handle_api(self)
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.startswith("/api/") and handle_api:
            handle_api(self)
            return
        self.send_error(405)

    def do_POST(self):
        if self.path.startswith("/api/") and handle_api:
            handle_api(self)
            return
        self.send_error(405)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def run_http() -> None:
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"HTTP  http://0.0.0.0:{PORT}/  (без микрофона в Agent)", flush=True)
        httpd.serve_forever()


def run_https() -> None:
    cert = Path(TLS_CERT)
    key = Path(TLS_KEY)
    if not cert.is_file() or not key.is_file():
        print(f"HTTPS skipped: cert={cert} key={key}", flush=True)
        return
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
    httpd = ThreadingHTTPServer(("0.0.0.0", TLS_PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    host = os.environ.get("PUBLIC_DOMAIN", "172.16.6.183")
    print(f"HTTPS https://0.0.0.0:{TLS_PORT}/  Agent: https://{host}:{TLS_PORT}/agent/", flush=True)
    httpd.serve_forever()


def main() -> None:
    threading.Thread(target=run_https, name="https", daemon=True).start()
    try:
        run_http()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
