#!/usr/bin/env python3
"""Statische SPA-server voor de pitwall-lab, met fallback naar index.html."""
import http.server
import os
import socketserver
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "dist")
PORT = int(sys.argv[2] if len(sys.argv) > 2 else 8090)
CERT = os.environ.get("LAB_CERT")
KEY = os.environ.get("LAB_KEY")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.translate_path(self.path.split("?")[0])
        if not os.path.exists(path) or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html"))):
            if "." not in os.path.basename(path):
                self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler)
if CERT and KEY:
    import ssl

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT, KEY)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    print(f"serving {ROOT} on https://0.0.0.0:{PORT}", flush=True)
else:
    print(f"serving {ROOT} on http://0.0.0.0:{PORT}", flush=True)
with httpd:
    httpd.serve_forever()
