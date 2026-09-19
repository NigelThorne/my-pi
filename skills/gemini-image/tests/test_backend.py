"""Real pinned upstream objects, fake transport only. Run in the skill's venv."""
import asyncio
import importlib
import io
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

try:
    import gemini_webapi
    from PIL import Image
    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False


@unittest.skipUnless(HAS_DEPS, "install locked dependencies to run backend tests")
class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_policy_no_cache_browser_or_transport_retries(self):
        from gemini_image_backend import upstream_policy
        from gemini_image_core import RequestGuard, GENERATE_URL, Failure
        from curl_cffi.requests import AsyncSession
        from curl_cffi.requests.exceptions import ConnectionError
        access = importlib.import_module("gemini_webapi.utils.get_access_token")
        rotation = importlib.import_module("gemini_webapi.utils.rotate_1psidts")
        browser = importlib.import_module("gemini_webapi.utils.load_browser_cookies")
        original_get_token = gemini_webapi.client.get_access_token
        calls = []
        async def transport(session, method, url, **kwargs):
            calls.append(kwargs)
            raise ConnectionError("SECRET")
        with patch.object(AsyncSession, "_request_once", transport), upstream_policy(RequestGuard()) as policy:
            session = policy.session()
            try:
                self.assertEqual(session.retry.count, 0)
                self.assertFalse(session.allow_redirects)
                self.assertEqual(browser.load_browser_cookies(), {})
                self.assertIsNone(rotation._get_cookies_cache_path({"SECRET": "SECRET"}))
                self.assertIsNone(rotation.save_cookies({"SECRET": "SECRET"}))
                with self.assertRaises(ConnectionError):
                    await session.post(GENERATE_URL)
                with self.assertRaises(Failure):
                    await session.post(GENERATE_URL)
                self.assertEqual(len(calls), 1)
                self.assertIs(calls[0]["allow_redirects"], False)
            finally:
                await session.close()
        self.assertIs(gemini_webapi.client.get_access_token, original_get_token)

    async def test_saved_cookie_init_has_no_guest_browser_or_cache_fallback(self):
        from gemini_image_backend import upstream_policy
        from gemini_image_core import RequestGuard, Failure
        from curl_cffi.requests import AsyncSession
        calls = []
        async def transport(session, method, url, **kwargs):
            calls.append(url)
            return SimpleNamespace(status_code=200, text="not an authenticated page", headers={})
        with patch.object(AsyncSession, "_request_once", transport), upstream_policy(RequestGuard()) as policy:
            with self.assertRaises(Failure):
                await gemini_webapi.client.get_access_token({"__Secure-1PSID": "SECRET", "__Secure-1PSIDTS": "SECRET2"})
        self.assertEqual(calls, ["https://gemini.google.com/app"])

    async def test_missing_account_status_prevents_generation(self):
        from gemini_image_backend import upstream_policy, generate_with_client
        from gemini_image_core import RequestGuard, Failure
        from curl_cffi.requests import AsyncSession
        from unittest.mock import AsyncMock
        calls = []
        async def transport(session, method, url, **kwargs):
            calls.append((method, str(url)))
            text = '{"SNlM0e":"test-token"}' if method == "GET" else "[]"
            return SimpleNamespace(status_code=200, text=text, headers={})
        guard = RequestGuard()
        with patch.object(AsyncSession, "_request_once", transport), upstream_policy(guard) as policy:
            client = policy.client(secure_1psid="test-cookie", secure_1psidts="test-cookie-ts")
            with patch.object(policy.client, "generate_content", new_callable=AsyncMock) as generate:
                generate.return_value = SimpleNamespace(images=[])
                with self.assertRaises(Failure) as failure:
                    await generate_with_client(client, "prompt", "1:1", guard)
                self.assertEqual(failure.exception.code, "auth_unavailable")
                generate.assert_not_awaited()
        self.assertEqual(guard.generations, 0)
        self.assertEqual(len(calls), 2)

    async def test_png_decoded_and_html_rejected(self):
        from gemini_image_core import decode_png, Failure
        data = io.BytesIO()
        Image.new("RGB", (4, 3)).save(data, "JPEG")
        png, width, height = decode_png(data.getvalue())
        self.assertEqual((width, height), (4, 3))
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        with self.assertRaises(Failure):
            decode_png(b"<html>SECRET login page</html>")
        with self.assertRaises(Failure):
            decode_png(b"\x89PNG\r\n\x1a\nnot really an image")

    async def test_download_is_streamed_bounded_and_closed(self):
        from contextlib import asynccontextmanager
        from gemini_image_backend import download_image
        from gemini_image_core import Failure
        closed = []
        class Session:
            @asynccontextmanager
            async def stream(self, method, url):
                self.assertion = (method, url)
                async def chunks():
                    for _ in range(31):
                        yield b"x" * (1024 * 1024)
                try:
                    yield SimpleNamespace(aiter_content=chunks)
                finally:
                    closed.append(True)
        with self.assertRaises(Failure) as failure:
            await download_image(Session(), "https://lh3.googleusercontent.com/test")
        self.assertEqual(failure.exception.code, "invalid_image")
        self.assertEqual(closed, [True])

    async def test_no_image_does_not_download_and_closes(self):
        from gemini_image_backend import generate_with_client
        from gemini_image_core import RequestGuard, Failure
        from gemini_webapi.constants import AccountStatus
        closed = []
        class Client:
            account_status = AccountStatus.AVAILABLE
            async def init(self, **kwargs):
                self.init_args = kwargs
            async def generate_content(self, *args, **kwargs):
                return SimpleNamespace(images=[])
            async def close(self):
                closed.append(True)
        client = Client()
        with self.assertRaises(Failure) as failure:
            await generate_with_client(client, "prompt", "1:1", RequestGuard())
        self.assertEqual(failure.exception.code, "no_image")
        self.assertIs(client.init_args["auto_refresh"], False)
        self.assertEqual(closed, [True])

    async def test_generation_closes_on_cancellation(self):
        from gemini_image_backend import generate_with_client
        from gemini_image_core import RequestGuard
        closed = []
        class Client:
            async def init(self, **kwargs):
                await asyncio.Event().wait()
            async def close(self):
                closed.append(True)
        with self.assertRaises(TimeoutError):
            async with asyncio.timeout(0.02):
                await generate_with_client(Client(), "prompt", "1:1", RequestGuard())
        self.assertEqual(closed, [True])

if __name__ == "__main__":
    unittest.main()
