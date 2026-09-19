#!/usr/bin/env python3
"""Agent-facing Gemini image CLI. Local commands use only the Python standard library."""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

from gemini_image_core import (
    AUTH_HELP, COOKIE_NAMES, GENERATE_URL, RATIOS, Failure, OutputFile,
    decode_png, emit, filter_cookies, operation_timeout, quiet_dependencies, validate_record, verify_identity,
)
from gemini_image_keychain import Keychain

ROOT = Path(__file__).resolve().parents[1]
BIN = str(ROOT / "scripts/gemini-image")
SETUP = f"uv sync --locked --project {ROOT}"
CDP = Path.home() / ".my-pi/.pi/git/github.com/pasky/chrome-cdp-skill/skills/chrome-cdp/scripts/cdp.mjs"
IDENTITY_JS = """JSON.stringify({url: location.href, labels: [...document.querySelectorAll('[aria-label]')].filter(el => el.getClientRects().length && /^Google Account\\s*:/.test(el.getAttribute('aria-label'))).map(el => el.getAttribute('aria-label'))})"""
HELP = {
    "root": "gemini-image [status|auth|generate|logout] [--help]. No arguments reports local setup without network or browser access.",
    "status": "gemini-image status [--help]. Reports local dependencies and saved login presence, not server authentication.",
    "auth": "gemini-image auth --target <explicit-CDP-target> --account <email> [--help]. Imports login from only the selected Gemini page after exact account verification. Requires explicit browser access approval.",
    "generate": 'gemini-image generate --prompt TEXT --output NEW.png [--aspect-ratio 1:1] [--help]. One generation attempt, 190-second overall deadline, 180-second network deadline, no overwrite. Ratios: ' + ", ".join(RATIOS),
    "logout": "gemini-image logout [--help]. Removes only this helper's saved Keychain login; absent login is a successful no-op.",
}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse messages may echo arbitrary input. Return only our own fixed text.
        raise Failure("usage", "Invalid or missing arguments.", self.description, 2)


def parse(argv):
    command = argv[0] if argv and not argv[0].startswith("-") else "root"
    if command not in HELP:
        raise Failure("usage", "Unknown command.", HELP["root"], 2)
    if "--help" in argv or "-h" in argv:
        return None, {"help": HELP[command], "setup": SETUP}
    root = Parser(add_help=False, allow_abbrev=False, description=HELP["root"])
    sub = root.add_subparsers(dest="command")
    for name in ("status", "auth", "generate", "logout"):
        parser = sub.add_parser(name, add_help=False, allow_abbrev=False, description=HELP[name])
        if name == "auth":
            parser.add_argument("--target", required=True)
            parser.add_argument("--account", required=True)
        if name == "generate":
            parser.add_argument("--prompt", required=True)
            parser.add_argument("--output", required=True)
            parser.add_argument("--aspect-ratio", choices=RATIOS, default="1:1")
    args = root.parse_args(argv)
    args.command = args.command or "status"
    if args.command == "generate" and (not args.prompt.strip() or len(args.prompt) > 16000 or "\0" in args.prompt):
        raise Failure("usage", "Prompt must contain 1 to 16000 characters of text.", HELP["generate"], 2)
    if args.command == "auth":
        if not re.fullmatch(r"[A-Fa-f0-9]{8,64}", args.target):
            raise Failure("usage", "Target must be an explicit Chrome CDP target ID or unique prefix of at least 8 hexadecimal characters.", HELP["auth"], 2)
        if not re.fullmatch(r"[^\s@()<>]+@[^\s@()<>]+\.[A-Za-z]{2,}", args.account):
            raise Failure("usage", "Account must be an email address.", HELP["auth"], 2)
    return args, None


def cdp_call(target, command, *arguments):
    if not CDP.is_file() or not shutil.which("node"):
        raise Failure("browser_helper_missing", "The selected-page browser helper is not installed.", "Install the chrome-cdp skill and Node.js 22+ before importing a login.")
    try:
        result = subprocess.run(["node", str(CDP), command, target, *arguments],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=30, check=False)
        if result.returncode:
            raise ValueError
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise Failure("browser_unavailable", "Could not read the explicitly selected Gemini page.", "Check that exact target and Chrome remote debugging; do not select another tab automatically.") from None


def dependencies_present():
    return all(importlib.util.find_spec(name) is not None for name in ("gemini_webapi", "PIL"))


def dispatch(args, store, cdp, backend):
    if args.command == "status":
        return {"bin": BIN.replace(str(Path.home()), "~", 1),
                "description": "Generate a PNG using a saved Gemini web login.",
                "dependencies": "installed" if dependencies_present() else "missing",
                "login": "saved_unverified" if store.exists() else "missing",
                "server_verified": False, "setup": SETUP, "help": AUTH_HELP}
    if args.command == "logout":
        return {"status": "removed" if store.delete() else "already_absent"}
    if args.command == "auth":
        before = cdp(args.target, "eval", IDENTITY_JS)
        verify_identity(before, args.account)
        response = cdp(args.target, "evalraw", "Network.getCookies", '{"urls":["https://gemini.google.com/app"]}')
        cookies = filter_cookies(response.get("cookies", []))
        after = cdp(args.target, "eval", IDENTITY_JS)
        verify_identity(after, args.account)
        if before != after:
            raise Failure("page_changed", "The selected page changed during authentication.", AUTH_HELP)
        store.save({"account": args.account, "cookies": cookies})
        return {"status": "login_saved", "account": args.account, "server_verified": False,
                "help": 'gemini-image generate --prompt "..." --output <new-file.png>'}
    with OutputFile(args.output) as output:
        if backend is None:
            if not dependencies_present():
                raise Failure("setup_required", "Image dependencies are not installed in this interpreter.", SETUP)
            from gemini_image_backend import generate
            backend = generate
        record = validate_record(store.load())
        data, cookies, attempts = asyncio.run(backend(args.prompt, args.aspect_ratio, record))
        png, width, height = decode_png(data)
        # Persist only the two supported cookies, after authenticated image success.
        store.save(validate_record({"account": record["account"], "cookies": cookies}))
        output.commit(png)
        return {"status": "generated", "path": str(output.path), "width": width, "height": height,
                "generation_attempts": attempts, "requested_aspect_ratio": args.aspect_ratio}


def translate_exception(error):
    name = type(error).__name__
    if isinstance(error, (TimeoutError, subprocess.TimeoutExpired)) or name in ("Timeout", "ReadTimeout"):
        return Failure("timeout", "Gemini image generation timed out.", "Do not retry automatically; the request may have completed on Google's side.")
    if name in ("AuthError",):
        return Failure("auth_expired", "Gemini rejected the saved login.", AUTH_HELP)
    if name in ("UsageLimitExceededError", "TemporarilyBlockedError"):
        return Failure("quota", "Gemini rate or quota limit reached.", "Wait before trying again; no automatic retry was attempted.")
    if name == "ImageGenerationError":
        return Failure("no_image", "Gemini could not generate an image.", "Refine the prompt or inspect Gemini manually; no retry was attempted.")
    return Failure("operation_failed", "The operation failed. Dependency details were suppressed.", "Check local setup or inspect Gemini manually; do not retry generation automatically.")


def main(argv=None, *, store=None, cdp=None, backend=None):
    try:
        args, help_result = parse(list(sys.argv[1:] if argv is None else argv))
        if help_result:
            emit(**help_result)
            return 0
        with quiet_dependencies(), operation_timeout(190 if args.command == "generate" else None):
            result = dispatch(args, store or Keychain(), cdp or cdp_call, backend)
        emit(**result)
        return 0
    except KeyboardInterrupt:
        failure = Failure("interrupted", "Interrupted; temporary files and connections were cleaned up.", "Do not retry automatically; generation may have completed remotely.")
    except Failure as error:
        failure = error
    except Exception as error:
        failure = translate_exception(error)
    emit(error=failure.code, message=failure.message, help=failure.help)
    return failure.exit_code


if __name__ == "__main__":
    sys.exit(main())
