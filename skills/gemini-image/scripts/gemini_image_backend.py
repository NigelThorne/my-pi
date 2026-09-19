"""Bounded HanaokaYuzu adapter. Imported only by generation, never by auth/status."""
import asyncio
from contextlib import contextmanager, ExitStack
import importlib
from types import SimpleNamespace
from unittest.mock import patch

from gemini_image_core import COOKIE_NAMES, Failure, RequestGuard, AUTH_HELP

TIMEOUT_SECONDS = 180


@contextmanager
def upstream_policy(guard):
    from curl_cffi import CurlOpt
    from curl_cffi.requests import AsyncSession, Cookies
    from curl_cffi.requests.session import RetryStrategy
    from gemini_webapi import GeminiClient
    from gemini_webapi.constants import BROWSER_TYPE, Headers
    from gemini_webapi.utils import logger
    client_module = importlib.import_module("gemini_webapi.client")
    access = importlib.import_module("gemini_webapi.utils.get_access_token")
    rotation = importlib.import_module("gemini_webapi.utils.rotate_1psidts")
    browser = importlib.import_module("gemini_webapi.utils.load_browser_cookies")
    utils = importlib.import_module("gemini_webapi.utils")

    # The helper is a one-shot process. Remove loguru's original native stderr sink.
    logger.remove()

    class GuardedSession(AsyncSession):
        def __init__(self):
            super().__init__(impersonate=BROWSER_TYPE, allow_redirects=False,
                             retry=0, timeout=TIMEOUT_SECONDS, trust_env=False,
                             verify=True, curl_options={CurlOpt.PROXY: "", CurlOpt.FOLLOWLOCATION: 0})

        async def request(self, method, url, **kwargs):
            self.retry = RetryStrategy(count=0)
            self.allow_redirects = False
            kwargs["verify"] = True
            return await guard.request(super().request, method, url, **kwargs)

    async def saved_cookie_init(base_cookies, **kwargs):
        session = GuardedSession()
        try:
            # Only the supplied jar. No cache, browser, preflight or guest fallback.
            if isinstance(base_cookies, Cookies):
                session.cookies.update(base_cookies)
            else:
                for name in COOKIE_NAMES:
                    value = base_cookies.get(name)
                    if not value:
                        raise Failure("login_missing", "Saved Gemini login is incomplete.", AUTH_HELP)
                    session.cookies.set(name, value, domain=".google.com", secure=True)
            response = await session.get("https://gemini.google.com/app", headers=Headers.GEMINI.value)
            payload = access._extract_payload(response)
            if not payload or not payload[0]:
                raise Failure("auth_expired", "Gemini did not accept the saved login.", AUTH_HELP)
            return access.InitSession(*payload, client=session, cookie_source="Keychain")
        except BaseException:
            await session.close()
            raise

    class MemoryClient(GeminiClient):
        async def _init_rpc(self):
            from gemini_webapi.constants import AccountStatus
            # Upstream defaults to AVAILABLE and leaves it unchanged for empty RPCs.
            # Require a parsed status response before authenticated generation.
            self.account_status = AccountStatus.UNAUTHENTICATED
            # Account availability is necessary; recent chats and usage history are not.
            await self._fetch_user_status()

        async def _generate(self, *args, **kwargs):
            # Disable upstream's decorated retries. The guard also stops its inner loop.
            kwargs["current_retry"] = 0
            async for output in super()._generate(*args, **kwargs):
                yield output

    def noop(*args, **kwargs):
        return None

    async def no_rotation(*args, **kwargs):
        return None

    with ExitStack() as stack:
        stack.enter_context(patch.object(client_module, "get_access_token", saved_cookie_init))
        for module in (client_module, rotation, utils):
            for name in ("save_cookies", "clear_cookies_cache"):
                if hasattr(module, name):
                    stack.enter_context(patch.object(module, name, noop))
            if hasattr(module, "rotate_1psidts"):
                stack.enter_context(patch.object(module, "rotate_1psidts", no_rotation))
        for module in (access, rotation):
            stack.enter_context(patch.object(module, "_get_cookies_cache_path", noop))
        stack.enter_context(patch.object(access, "_load_cached_jar", noop))
        for module in (access, browser):
            stack.enter_context(patch.object(module, "load_browser_cookies", lambda *a, **k: {}))
        yield SimpleNamespace(session=GuardedSession, client=MemoryClient)


async def download_image(session, url):
    data = bytearray()
    async with session.stream("GET", url) as response:
        async for chunk in response.aiter_content():
            if len(data) + len(chunk) > 30 * 1024 * 1024:
                raise Failure("invalid_image", "Downloaded image exceeds the size limit.")
            data.extend(chunk)
    return bytes(data)


async def generate_with_client(client, prompt, ratio, guard):
    from gemini_webapi.constants import AccountStatus
    from gemini_webapi.types import GeneratedImage
    try:
        await client.init(timeout=TIMEOUT_SECONDS, auto_close=False, auto_refresh=False,
                          watchdog_timeout=TIMEOUT_SECONDS, verbose=False)
        if client.account_status != AccountStatus.AVAILABLE:
            raise Failure("auth_unavailable", "Gemini account is not available for authenticated generation.", AUTH_HELP)
        result = await client.generate_content(
            f"Generate exactly one image. Desired aspect ratio: {ratio}.\n\n{prompt}",
            temporary=True,
        )
        images = [image for image in result.images if isinstance(image, GeneratedImage)]
        if not images:
            raise Failure("no_image", "Gemini returned no generated image.", "Refine the prompt or inspect Gemini manually; no retry was attempted.")
        # Avoid upstream save(), full-size RPCs, raw text URL chains and disk caches.
        data = await download_image(client._live_client, images[0].url)
        cookies = {}
        for cookie in client._live_client.cookies.jar:
            if cookie.name in COOKIE_NAMES and cookie.domain in (".google.com", "google.com") and not cookie.is_expired():
                cookies[cookie.name] = cookie.value
        if set(cookies) != set(COOKIE_NAMES):
            raise Failure("auth_expired", "Gemini login cookies became unavailable.", AUTH_HELP)
        return data, cookies, guard.generations
    finally:
        async with asyncio.timeout(5):
            await client.close()


async def generate(prompt, ratio, record):
    guard = RequestGuard()
    with upstream_policy(guard) as policy:
        client = policy.client(secure_1psid=record["cookies"]["__Secure-1PSID"],
                               secure_1psidts=record["cookies"]["__Secure-1PSIDTS"])
        async with asyncio.timeout(TIMEOUT_SECONDS):
            return await generate_with_client(client, prompt, ratio, guard)
