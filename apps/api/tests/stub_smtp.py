"""A socket server that speaks just enough SMTP to accept or refuse one message.

Real delivery is the part of a mail integration that breaks, so the tests talk to a
server over a real socket rather than asserting against a mock. It advertises only
AUTH PLAIN so smtplib picks the single-round-trip mechanism and the handshake stays
small enough to read.
"""
from __future__ import annotations

import socket
import threading


class StubSmtpServer:
    def __init__(self, *, reject_data: bool = False, offer_auth: bool = True) -> None:
        self.reject_data = reject_data
        self.offer_auth = offer_auth
        self.messages: list[str] = []
        self.recipients: list[str] = []
        self.authenticated = False
        self._sock = socket.socket()
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(8)
        self._sock.settimeout(0.2)
        self.port: int = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def __enter__(self) -> "StubSmtpServer":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=3)
        self._sock.close()

    def _serve(self) -> None:
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except (TimeoutError, OSError):
                continue
            try:
                self._handle(conn)
            finally:
                conn.close()

    def _handle(self, conn: socket.socket) -> None:
        conn.settimeout(3)
        stream = conn.makefile("rwb")

        def reply(line: str) -> None:
            stream.write(line.encode() + b"\r\n")
            stream.flush()

        reply("220 stub.invalid ESMTP")
        in_data = False
        body: list[str] = []
        while True:
            raw = stream.readline()
            if not raw:
                return
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if in_data:
                if line == ".":
                    in_data = False
                    self.messages.append("\n".join(body))
                    body.clear()
                    reply("550 5.7.1 stub refuses this message" if self.reject_data else "250 2.0.0 queued")
                else:
                    # Dot-stuffing: a body line starting with a dot arrives doubled.
                    body.append(line[1:] if line.startswith("..") else line)
                continue
            verb = line.split(" ", 1)[0].upper()
            if verb in ("EHLO", "HELO"):
                reply("250-stub.invalid")
                reply("250 AUTH PLAIN" if self.offer_auth else "250 8BITMIME")
            elif verb == "AUTH":
                self.authenticated = True
                reply("235 2.7.0 authenticated")
            elif verb == "MAIL":
                reply("250 2.1.0 sender ok")
            elif verb == "RCPT":
                self.recipients.append(line.partition(":")[2].strip().strip("<>"))
                reply("250 2.1.5 recipient ok")
            elif verb == "DATA":
                in_data = True
                reply("354 go ahead")
            elif verb == "RSET":
                reply("250 2.0.0 reset")
            elif verb == "NOOP":
                reply("250 2.0.0 ok")
            elif verb == "QUIT":
                reply("221 2.0.0 bye")
                return
            else:
                reply("502 5.5.2 not implemented")


def closed_port() -> int:
    """A port with nothing listening, for the unreachable-host tests."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = int(sock.getsockname()[1])
    sock.close()
    return port
