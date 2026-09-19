"""Dependency-free validation, output safety and network policy."""
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urljoin, urlsplit

COOKIE_NAMES = ("__Secure-1PSID", "__Secure-1PSIDTS")
GENERATE_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
BATCH_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute"
RATIOS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
AUTH_HELP = 'gemini-image auth --target <explicit-CDP-target> --account <email>'


class Failure(Exception):
    def __init__(self, code, message=None, help=None, exit_code=1):
        self.code = code
        self.message = message or code
        self.help = help or "gemini-image --help"
        self.exit_code = exit_code
        super().__init__(self.message)


def emit(**data):
    # Flat TOON. Escape each original character, not already-escaped JSON text.
    escapes = {chr(c): f"\\u{c:04x}" for c in range(32)}
    escapes.update({"\n": "\\n", "\r": "\\r", "\t": "\\t", "\\": "\\\\", '"': '\\"'})
    for key, value in data.items():
        if isinstance(value, str):
            if any(0xD800 <= ord(c) <= 0xDFFF for c in value):
                raise ValueError("invalid Unicode scalar")
            encoded = '"' + "".join(escapes.get(c, c) for c in value) + '"'
        else:
            encoded = json.dumps(value, allow_nan=False)
        print(f"{key}: {encoded}")


def validate_url(url):
    try:
        if not isinstance(url, str) or any(ord(c) < 33 or c == "\\" for c in url):
            raise ValueError
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.fragment:
            raise ValueError
        if not any(host == domain or host.endswith("." + domain) for domain in ("google.com", "googleusercontent.com")):
            raise ValueError
        return parsed
    except ValueError:
        raise Failure("unsafe_destination", "Blocked an unexpected network destination.", "Do not retry automatically; inspect the helper's destination policy.") from None


def verify_identity(data, account):
    if not isinstance(data, dict):
        raise Failure("account_unverified", "Could not verify the selected Gemini account.", AUTH_HELP)
    parsed = validate_url(data.get("url", ""))
    # Only the default account route is supported. /u/1 or authuser=1 can show
    # another account while exporting the same domain cookies used by /app.
    if not (parsed.path == "/app" or parsed.path.startswith("/app/")) or parsed.query:
        raise Failure("account_route", "Use the default Gemini account page without account selectors or query parameters.", "Open https://gemini.google.com/app manually, then run " + AUTH_HELP)
    labels = data.get("labels", [])
    emails = set()
    for label in labels:
        if isinstance(label, str) and re.match(r"^Google Account\s*:", label):
            emails.update(re.findall(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", label))
    if parsed.hostname != "gemini.google.com" or emails != {account}:
        raise Failure("account_mismatch", "Selected Gemini page does not identify exactly the requested Google account.", AUTH_HELP)


def filter_cookies(cookies):
    values = {}
    for cookie in cookies:
        name = cookie.get("name")
        if name not in COOKIE_NAMES:
            continue
        if cookie.get("domain") not in (".google.com", "google.com") or cookie.get("path") != "/" or cookie.get("secure") is not True:
            continue
        value = cookie.get("value")
        if not isinstance(value, str) or not value or any(ord(c) < 33 or ord(c) > 126 for c in value):
            continue
        if name in values and values[name] != value:
            raise Failure("ambiguous_cookies", "More than one Gemini login matched the selected page.", AUTH_HELP)
        values[name] = value
    if set(values) != set(COOKIE_NAMES):
        raise Failure("missing_cookies", "The selected page does not have both required Gemini login cookies.", AUTH_HELP)
    return values


def validate_record(record):
    if not isinstance(record, dict) or not isinstance(record.get("account"), str) or not isinstance(record.get("cookies"), dict):
        raise Failure("invalid_login", "Saved login is not valid.", AUTH_HELP)
    cookies = record["cookies"]
    if set(cookies) != set(COOKIE_NAMES) or any(not isinstance(v, str) or not v or any(ord(c) < 33 or ord(c) > 126 for c in v) for v in cookies.values()):
        raise Failure("invalid_login", "Saved login is not valid.", AUTH_HELP)
    return record


class RequestGuard:
    """All requests, including stream requests, cross this boundary once per send."""
    def __init__(self):
        self.generations = 0
        self.requests = 0

    async def request(self, send, method, url, **kwargs):
        method = method.upper()
        for hop in range(4):
            parsed = validate_url(str(url))
            base = f"https://{parsed.hostname}{parsed.path}"
            if method not in ("GET", "POST") or (method == "POST" and base not in (GENERATE_URL, BATCH_URL)):
                raise Failure("unsafe_request", "Blocked an unexpected write request.")
            if base == GENERATE_URL:
                if method != "POST" or self.generations:
                    raise Failure("retry_blocked", "A second generation attempt was blocked.", "Do not retry automatically; the first request may have completed.")
                self.generations += 1
            self.requests += 1
            if self.requests > 30:
                raise Failure("request_limit", "The request limit was reached.", "Do not retry automatically.")
            kwargs["allow_redirects"] = False
            kwargs["max_redirects"] = 0
            response = await send(method, str(url), **kwargs)
            status = response.status_code
            if status in (401, 403):
                await self._close(response)
                raise Failure("auth_expired", "Gemini rejected the saved login.", AUTH_HELP)
            if status == 429:
                await self._close(response)
                raise Failure("quota", "Gemini rate or quota limit reached.", "Wait before making another request; do not retry automatically.")
            if 300 <= status < 400:
                await self._close(response)
                if method != "GET":
                    raise Failure("write_redirect", "A write redirect was blocked without replaying the request.", "Do not retry automatically; the request may have completed.")
                location = response.headers.get("location")
                if not location or hop == 3:
                    raise Failure("redirect_limit", "Image redirect chain was invalid or too long.")
                url = urljoin(str(url), location)
                # Never forward query parameters, explicit credentials or request bodies.
                kwargs = {k: v for k, v in kwargs.items() if k in ("timeout", "stream")}
                continue
            if status >= 400:
                await self._close(response)
                raise Failure("remote_error", "Gemini returned an unsuccessful response.", "Do not retry automatically; check the Gemini page manually.")
            return response

    @staticmethod
    async def _close(response):
        close = getattr(response, "aclose", None)
        if close:
            await close()


class OutputFile:
    """Hold the destination directory open, then publish with an atomic no-clobber link."""
    def __init__(self, path):
        self.path = Path(path).expanduser().absolute()
        self.dirfd = None
        self.temp = None

    def __enter__(self):
        try:
            if self.path.suffix.lower() != ".png" or os.path.lexists(self.path):
                raise OSError
            self.dirfd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            fd, path = tempfile.mkstemp(prefix=".gemini-image-", dir=self.path.parent)
            self.temp = Path(path).name
            os.close(fd)
            return self
        except (OSError, ValueError):
            self.__exit__(None, None, None)
            raise Failure("invalid_output", "Output must be a new .png file in an existing writable directory.", 'gemini-image generate --prompt "..." --output <new-file.png>', 2) from None

    def commit(self, data):
        try:
            fd = os.open(self.temp, os.O_WRONLY | os.O_TRUNC | os.O_NOFOLLOW, dir_fd=self.dirfd)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.link(self.temp, self.path.name, src_dir_fd=self.dirfd, dst_dir_fd=self.dirfd, follow_symlinks=False)
        except OSError:
            raise Failure("output_write", "Could not publish the image without overwriting an existing file.", "Choose a new writable output path; generation may already have completed.") from None

    def __exit__(self, *args):
        if self.dirfd is not None:
            try:
                if self.temp:
                    os.unlink(self.temp, dir_fd=self.dirfd)
            finally:
                os.close(self.dirfd)
                self.dirfd = None


def decode_png(data):
    from PIL import Image
    import warnings
    if len(data) > 30 * 1024 * 1024:
        raise Failure("invalid_image", "Downloaded image exceeds the size limit.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > 25_000_000 or image.format not in ("PNG", "JPEG", "WEBP"):
                    raise ValueError
                image.load()
                pixels = image.convert("RGB" if image.mode != "RGBA" else "RGBA")
                output = io.BytesIO()
                pixels.save(output, format="PNG")
                return output.getvalue(), image.width, image.height
    except TimeoutError:
        raise
    except Exception:
        raise Failure("invalid_image", "Gemini did not return a decodable image.", "Inspect Gemini manually; no output file was saved.") from None


@contextmanager
def operation_timeout(seconds):
    """One-shot CLI deadline, including synchronous image decoding and Keychain calls."""
    if seconds is None:
        yield
        return
    import signal
    import time
    def expired(*args):
        raise TimeoutError
    previous_handler = signal.getsignal(signal.SIGALRM)
    started = time.monotonic()
    signal.signal(signal.SIGALRM, expired)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0]:
            signal.setitimer(signal.ITIMER_REAL, max(0.001, previous_timer[0] - (time.monotonic() - started)), previous_timer[1])


@contextmanager
def quiet_dependencies():
    """Discard native, Python and logger output before handling secrets."""
    sys.stdout.flush()
    sys.stderr.flush()
    original = [os.dup(1), os.dup(2)]
    with open(os.devnull, "w") as sink:
        try:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            from contextlib import redirect_stdout, redirect_stderr
            with redirect_stdout(sink), redirect_stderr(sink):
                yield
        finally:
            for target, saved in zip((1, 2), original):
                os.dup2(saved, target)
                os.close(saved)
