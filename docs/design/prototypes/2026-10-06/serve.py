#!/usr/bin/env python3
"""Serve this throwaway design study, with no build step or network dependencies."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

study = Path(__file__).resolve().parent
root = study.parents[2]
study_path = study.relative_to(root).as_posix()
port = 8765
while True:
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(SimpleHTTPRequestHandler, directory=str(root)))
        break
    except OSError:
        port += 1
        if port > 8775:
            raise
print(f"SeeFood 设计原型：http://127.0.0.1:{port}/{study_path}/?variant=A", flush=True)
print("按 Ctrl+C 停止。浏览器中的示例保存可在工作台重置。", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
