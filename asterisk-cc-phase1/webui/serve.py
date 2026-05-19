#!/usr/bin/env python3
"""Tiny static server for the Agent and Supervisor UIs.

Usage:
    python serve.py            # listens on http://localhost:8080
    python serve.py 9000       # custom port
"""
import sys
import http.server
import socketserver
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = Path(__file__).parent.resolve()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving CC UIs from {ROOT} on http://localhost:{PORT}")
    print(f"  Portal:     http://localhost:{PORT}/")
    print(f"  Agent:      http://localhost:{PORT}/agent/")
    print(f"  Supervisor: http://localhost:{PORT}/supervisor/")
    print(f"  Admin:      http://localhost:{PORT}/admin/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
