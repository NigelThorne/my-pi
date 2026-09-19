"""Offline safety tests. Never access Chrome, Keychain or Google."""
import asyncio
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))


class InstallationTests(unittest.TestCase):
    def test_helper_module_exists(self):
        self.assertTrue((SCRIPTS / "gemini_image.py").is_file(), "CLI helper must exist")


# Allow the first red run to report a missing implementation as an assertion.
if (SCRIPTS / "gemini_image.py").exists():
    import gemini_image as cli
    from gemini_image_core import Failure, RequestGuard, OutputFile, filter_cookies, verify_identity, quiet_dependencies

    class CoreTests(unittest.TestCase):
        def test_toon_preserves_backslash_and_controls(self):
            from gemini_image_core import emit
            output = io.StringIO()
            value = "\\banana\\file\b\f😀"
            with contextlib.redirect_stdout(output):
                emit(value=value)
            self.assertEqual(json.loads(output.getvalue().split(": ", 1)[1]), value)
            self.assertIn("\\u0008", output.getvalue())
            self.assertIn("\\u000c", output.getvalue())

        def test_identity_is_exact_and_google_only(self):
            verify_identity({"url": "https://gemini.google.com/app", "labels": ["Google Account: Jane Doe (jane@example.com)"]}, "jane@example.com")
            for data in [
                {"url": "https://gemini.google.com.evil.test", "labels": ["Google Account: jane@example.com"]},
                {"url": "https://gemini.google.com/app", "labels": ["Google Account: notjane@example.com"]},
                {"url": "https://gemini.google.com/u/1/app", "labels": ["Google Account: jane@example.com"]},
                {"url": "https://gemini.google.com/app?authuser=1", "labels": ["Google Account: jane@example.com"]},
                {"url": "https://gemini.google.com/app", "labels": ["jane@example.com"]},
                {"url": "https://gemini.google.com/app", "labels": ["Google Account: jane@example.com", "Google Account: other@example.com"]},
            ]:
                with self.subTest(data=data), self.assertRaises(Failure):
                    verify_identity(data, "jane@example.com")

        def test_cookie_filter_minimal_and_rejects_ambiguity(self):
            cookies = [{"name": n, "value": "SECRET_" + n, "domain": ".google.com", "path": "/", "secure": True} for n in cli.COOKIE_NAMES]
            cookies += [{"name": "OTHER", "value": "IGNORE", "domain": ".google.com"}]
            self.assertEqual(set(filter_cookies(cookies)), set(cli.COOKIE_NAMES))
            with self.assertRaises(Failure):
                filter_cookies(cookies + [dict(cookies[0], value="DIFFERENT")])
            with self.assertRaises(Failure):
                filter_cookies([dict(c, domain=".evil.test") for c in cookies])

        def test_output_preflight_existing_symlink_suffix_parent(self):
            with tempfile.TemporaryDirectory() as d:
                p = Path(d) / "x.png"
                p.write_text("original")
                for invalid in [p, Path(d) / "x.jpg", Path(d) / "missing/x.png"]:
                    with self.subTest(invalid=invalid), self.assertRaises(Failure):
                        with OutputFile(invalid):
                            pass
                p.unlink()
                p.symlink_to(Path(d) / "not-there")
                with self.assertRaises(Failure):
                    with OutputFile(p):
                        pass

        def test_atomic_commit_refuses_concurrent_creation_and_cleans_temp(self):
            with tempfile.TemporaryDirectory() as d:
                p = Path(d) / "x.png"
                with OutputFile(p) as output:
                    p.write_bytes(b"competitor")
                    with self.assertRaises(Failure):
                        output.commit(b"our image")
                self.assertEqual(p.read_bytes(), b"competitor")
                self.assertEqual([x.name for x in Path(d).iterdir()], ["x.png"])

        def test_overall_deadline_cleans_output(self):
            from gemini_image_core import operation_timeout
            import time
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(TimeoutError):
                    with operation_timeout(0.02), OutputFile(Path(d) / "x.png"):
                        time.sleep(1)
                self.assertEqual(list(Path(d).iterdir()), [])

        def test_output_cleanup_on_interrupt(self):
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(KeyboardInterrupt):
                    with OutputFile(Path(d) / "x.png"):
                        raise KeyboardInterrupt
                self.assertEqual(list(Path(d).iterdir()), [])

        def test_quiet_suppresses_python_and_native_output(self):
            code = 'from gemini_image_core import quiet_dependencies; import os\nwith quiet_dependencies():\n print("SECRET"); os.write(2,b"SECRET")\nprint("safe")'
            result = subprocess.run([sys.executable, "-c", code], env={**os.environ, "PYTHONPATH": str(SCRIPTS)}, capture_output=True, text=True)
            self.assertEqual(result.stdout, "safe\n")
            self.assertEqual(result.stderr, "")

    class GuardTests(unittest.IsolatedAsyncioTestCase):
        async def test_only_one_actual_generation_and_no_redirect_follow(self):
            guard = RequestGuard()
            calls = []
            async def request(method, url, **kwargs):
                calls.append((method, url, kwargs))
                return SimpleNamespace(status_code=200, headers={})
            await guard.request(request, "POST", cli.GENERATE_URL, allow_redirects=True)
            with self.assertRaises(Failure):
                await guard.request(request, "POST", cli.GENERATE_URL)
            self.assertEqual(len(calls), 1)
            self.assertIs(calls[0][2]["allow_redirects"], False)

        async def test_post_redirect_never_replayed(self):
            guard = RequestGuard()
            calls = []
            async def request(method, url, **kwargs):
                calls.append(url)
                return SimpleNamespace(status_code=307, headers={"location": cli.GENERATE_URL})
            with self.assertRaises(Failure):
                await guard.request(request, "POST", cli.GENERATE_URL)
            self.assertEqual(len(calls), 1)

        async def test_get_redirects_bounded_and_revalidated(self):
            guard = RequestGuard()
            calls = []
            async def request(method, url, **kwargs):
                calls.append(url)
                return SimpleNamespace(status_code=302, headers={"location": "https://evil.test/SECRET"})
            with self.assertRaises(Failure):
                await guard.request(request, "GET", "https://lh3.googleusercontent.com/image")
            self.assertEqual(len(calls), 1)
            calls.clear()
            async def loop(method, url, **kwargs):
                calls.append(url)
                return SimpleNamespace(status_code=302, headers={"location": "/loop"})
            with self.assertRaises(Failure):
                await guard.request(loop, "GET", "https://lh3.googleusercontent.com/image")
            self.assertLessEqual(len(calls), 4)

        async def test_invalid_destinations_never_reach_transport(self):
            async def forbidden(*args, **kwargs):
                self.fail("transport called")
            for url in ["http://gemini.google.com/app", "https://evilgoogle.com/", "https://google.com@evil.test/", "https://google.com:444/", "https://google.com\\@evil.test/", "file:///tmp/x"]:
                with self.subTest(url=url), self.assertRaises(Failure):
                    await RequestGuard().request(forbidden, "GET", url)
            with self.assertRaises(Failure):
                await RequestGuard().request(forbidden, "POST", "https://google.com/anything")

    class CliTests(unittest.TestCase):
        def invoke(self, args, **kwargs):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = cli.main(args, **kwargs)
            return code, out.getvalue()

        def test_help_unknown_missing_flags_without_dependencies(self):
            for args in [["--help"], ["generate", "--help"], ["auth", "--help"], ["logout", "--help"], ["status", "--help"]]:
                code, text = self.invoke(args)
                self.assertEqual(code, 0)
                self.assertIn("help:", text)
            for args in [["no-such-command"], ["generate", "--wat"], ["auth"], ["generate", "--prompt", "x"], ["status", "--account", "x"], ["generate", "--pro", "x", "--output", "x.png"]]:
                code, text = self.invoke(args)
                self.assertEqual(code, 2)
                self.assertIn("error:", text)
                self.assertIn("help:", text)

        def test_local_status_and_idempotent_logout(self):
            store = SimpleNamespace(exists=lambda: False, delete=lambda: False)
            code, text = self.invoke([], store=store)
            self.assertEqual(code, 0)
            self.assertIn('login: "missing"', text)
            self.assertIn('server_verified: false', text)
            code, text = self.invoke(["logout"], store=store)
            self.assertEqual(code, 0)
            self.assertIn("already_absent", text)

        def test_validation_before_store_or_generation(self):
            class Forbidden:
                def __getattr__(self, name):
                    raise AssertionError("Keychain used before validation")
            with tempfile.TemporaryDirectory() as d:
                p = Path(d) / "exists.png"
                p.touch()
                for args in [
                    ["generate", "--prompt", "hi", "--output", str(p)],
                    ["generate", "--prompt", " ", "--output", str(Path(d)/"new.png")],
                    ["generate", "--prompt", "x", "--output", str(Path(d)/"new.png"), "--aspect-ratio", "invalid"],
                ]:
                    code, text = self.invoke(args, store=Forbidden())
                    self.assertEqual(code, 2)

        def test_upstream_quota_and_no_image_classification(self):
            for name, expected in [("UsageLimitExceededError", "quota"), ("ImageGenerationError", "no_image")]:
                error = type(name, (Exception,), {})("SECRET server response")
                failure = cli.translate_exception(error)
                self.assertEqual(failure.code, expected)
                self.assertNotIn("SECRET", failure.message)

        def test_raw_dependency_exception_never_printed(self):
            def fail():
                raise RuntimeError("SECRET_COOKIE raw upstream URL")
            code, text = self.invoke(["status"], store=SimpleNamespace(exists=fail))
            self.assertEqual(code, 1)
            self.assertNotIn("SECRET", text)
            self.assertNotIn("RuntimeError", text)

        def test_auth_verifies_before_and_after_cookie_read(self):
            calls, saved = [], []
            identity = {"url": "https://gemini.google.com/app", "labels": ["Google Account: Jane (jane@example.com)"]}
            cookies = [{"name": n, "value": "SECRET", "domain": ".google.com", "path": "/", "secure": True} for n in cli.COOKIE_NAMES]
            def cdp(target, command, *args):
                calls.append(command)
                return identity if command == "eval" else {"cookies": cookies}
            code, text = self.invoke(["auth", "--target", "ABCDEF123", "--account", "jane@example.com"], store=SimpleNamespace(save=saved.append), cdp=cdp)
            self.assertEqual(code, 0)
            self.assertEqual(calls, ["eval", "evalraw", "eval"])
            self.assertEqual(set(saved[0]["cookies"]), set(cli.COOKIE_NAMES))
            self.assertNotIn("SECRET", text)

        def test_generate_success_saves_png_and_only_rotated_supported_cookies(self):
            try:
                from PIL import Image
            except ImportError:
                self.skipTest("install locked dependencies")
            image = io.BytesIO()
            Image.new("RGB", (4, 3)).save(image, "JPEG")
            saved, calls = [], []
            record = {"account": "jane@example.com", "cookies": dict.fromkeys(cli.COOKIE_NAMES, "SECRET")}
            async def backend(prompt, ratio, login):
                calls.append((prompt, ratio))
                print("SECRET dependency stdout")
                print("SECRET dependency stderr", file=sys.stderr)
                return image.getvalue(), dict.fromkeys(cli.COOKIE_NAMES, "ROTATED"), 1
            with tempfile.TemporaryDirectory() as d:
                output = Path(d) / "result.png"
                code, text = self.invoke(["generate", "--prompt", "test", "--output", str(output)], store=SimpleNamespace(load=lambda: record, save=saved.append), backend=backend)
                self.assertEqual(code, 0)
                self.assertTrue(output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
                self.assertEqual(len(list(Path(d).iterdir())), 1)
            self.assertEqual(calls, [("test", "1:1")])
            self.assertEqual(saved[0]["cookies"], dict.fromkeys(cli.COOKIE_NAMES, "ROTATED"))
            self.assertNotIn("SECRET", text)
            self.assertNotIn("ROTATED", text)
            self.assertIn("width: 4", text)

        def test_invalid_image_does_not_save_login_or_output(self):
            try:
                import PIL
            except ImportError:
                self.skipTest("install locked dependencies")
            record = {"account": "jane@example.com", "cookies": dict.fromkeys(cli.COOKIE_NAMES, "SECRET")}
            async def backend(*args):
                return b"<html>SECRET</html>", record["cookies"], 1
            with tempfile.TemporaryDirectory() as d:
                code, text = self.invoke(["generate", "--prompt", "test", "--output", str(Path(d) / "result.png")], store=SimpleNamespace(load=lambda: record, save=lambda _: self.fail("saved")), backend=backend)
                self.assertEqual(code, 1)
                self.assertEqual(list(Path(d).iterdir()), [])
                self.assertNotIn("SECRET", text)

        def test_mismatched_account_does_not_read_cookies(self):
            calls = []
            def cdp(target, command, *args):
                calls.append(command)
                return {"url": "https://gemini.google.com/app", "labels": ["Google Account: other@example.com"]}
            code, text = self.invoke(["auth", "--target", "ABCDEF123", "--account", "jane@example.com"], cdp=cdp, store=SimpleNamespace(save=lambda _: self.fail("saved")))
            self.assertEqual(code, 1)
            self.assertEqual(calls, ["eval"])

if __name__ == "__main__":
    unittest.main()
