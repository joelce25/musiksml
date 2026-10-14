"""Supervise the token provider and API as one Railway service."""

import os
import signal
import subprocess
import sys
import threading
import time
from importlib.metadata import version

import requests

stopping = threading.Event()
children = []


def shutdown(*_):
    stopping.set()
    for child in children:
        if child.poll() is None:
            child.terminate()


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)
try:
    expected = version("bgutil-ytdlp-pot-provider")
    provider_url = os.getenv("YOUTUBE_POT_BASE_URL", "http://127.0.0.1:4416").rstrip(
        "/"
    )
    if provider_url == "http://127.0.0.1:4416":
        children.append(
            subprocess.Popen(
                [
                    "node",
                    "/pot-provider/server/build/main.js",
                    "--port",
                    "4416",
                    "--host",
                    "127.0.0.1",
                ]
            )
        )
    deadline = time.monotonic() + 20
    with requests.Session() as session:
        session.trust_env = False
        while not stopping.is_set():
            try:
                response = session.get(provider_url + "/ping", timeout=1)
                response.raise_for_status()
                if response.json().get("version") != expected:
                    raise RuntimeError(
                        "The token provider and Python plugin must have identical versions"
                    )
                break
            except requests.RequestException:
                if time.monotonic() >= deadline or any(
                    c.poll() is not None for c in children
                ):
                    raise RuntimeError(
                        "The token provider failed to become ready"
                    ) from None
                stopping.wait(0.2)
    if not stopping.is_set():
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "server:app",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    os.getenv("PORT", "8000"),
                ]
            )
        )
        while not stopping.wait(0.5):
            if any(child.poll() is not None for child in children):
                raise RuntimeError(
                    "A required service stopped; shutting down the container"
                )
finally:
    shutdown()
    for child in children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
