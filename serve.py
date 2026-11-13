#!/usr/bin/env python3
"""Tiny local server for the site.

The only reason this exists is the custom 404 page: `python -m http.server`
would show its own error page. Run `python serve.py`, then open the printed URL.
"""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            page = ROOT / "404.html"
            if page.is_file():
                body = page.read_bytes()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
        super().send_error(code, message, explain)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the portfolio locally.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()

    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f"Serving {ROOT}")
        print(f"Open http://{args.bind}:{args.port}/")
        print("Press Ctrl+C to stop.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
