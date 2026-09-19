"""In-process macOS Keychain access. No CLI, plaintext backend or UI prompts."""
from contextlib import contextmanager
import ctypes as C
import json
import sys

from gemini_image_core import Failure, AUTH_HELP, validate_record

SERVICE = b"pi.gemini-image.v1"
ACCOUNT = b"login"
NOT_FOUND = -25300


class Keychain:
    def __init__(self, security=None, core=None):
        self.security = security
        self.core = core

    def _bind(self):
        if self.security is not None:
            return
        if sys.platform != "darwin":
            raise Failure("unsupported_platform", "Gemini login storage requires macOS Keychain.")
        self.security = C.CDLL("/System/Library/Frameworks/Security.framework/Security")
        self.core = C.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        signatures = {
            "SecKeychainGetUserInteractionAllowed": [C.POINTER(C.c_bool)],
            "SecKeychainSetUserInteractionAllowed": [C.c_bool],
            "SecKeychainFindGenericPassword": [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.POINTER(C.c_uint32), C.POINTER(C.c_void_p), C.POINTER(C.c_void_p)],
            "SecKeychainAddGenericPassword": [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_void_p, C.POINTER(C.c_void_p)],
            "SecKeychainItemModifyAttributesAndData": [C.c_void_p, C.c_void_p, C.c_uint32, C.c_void_p],
            "SecKeychainItemDelete": [C.c_void_p],
            "SecKeychainItemFreeContent": [C.c_void_p, C.c_void_p],
        }
        for name, args in signatures.items():
            fn = getattr(self.security, name)
            fn.argtypes = args
            fn.restype = C.c_int32
        self.core.CFRelease.argtypes = [C.c_void_p]
        self.core.CFRelease.restype = None

    @staticmethod
    def _check(status):
        if status:
            raise Failure("keychain_denied", "Keychain is locked, denied access, or unavailable. No prompt was opened.", "Unlock the login Keychain and grant access to this Python executable in Keychain Access, then retry the command.")

    @contextmanager
    def _no_ui(self):
        self._bind()
        previous = C.c_bool()
        self._check(self.security.SecKeychainGetUserInteractionAllowed(C.byref(previous)))
        self._check(self.security.SecKeychainSetUserInteractionAllowed(False))
        try:
            yield
        finally:
            self.security.SecKeychainSetUserInteractionAllowed(previous.value)

    @contextmanager
    def _find(self, read=False):
        item, password, length = C.c_void_p(), C.c_void_p(), C.c_uint32()
        try:
            status = self.security.SecKeychainFindGenericPassword(
                None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT,
                C.byref(length) if read else None,
                C.byref(password) if read else None, C.byref(item),
            )
            if status != NOT_FOUND:
                self._check(status)
            value = None
            if status == 0 and read:
                if length.value > 32768:
                    raise Failure("invalid_login", "Saved login is not valid.", AUTH_HELP)
                value = C.string_at(password, length.value)
            yield status != NOT_FOUND, item, value
        finally:
            if password.value:
                self.security.SecKeychainItemFreeContent(None, password)
            if item.value:
                self.core.CFRelease(item)

    def exists(self):
        with self._no_ui(), self._find() as (exists, _, _):
            return exists

    def load(self):
        with self._no_ui(), self._find(read=True) as (exists, _, data):
            if not exists:
                raise Failure("login_missing", "No Gemini login is saved.", AUTH_HELP)
            try:
                return validate_record(json.loads(data))
            except (ValueError, UnicodeError):
                raise Failure("invalid_login", "Saved login is not valid.", AUTH_HELP) from None

    def save(self, record):
        validate_record(record)
        data = json.dumps(record, separators=(",", ":")).encode()
        with self._no_ui(), self._find() as (exists, item, _):
            if exists:
                status = self.security.SecKeychainItemModifyAttributesAndData(item, None, len(data), data)
            else:
                status = self.security.SecKeychainAddGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, len(data), data, None)
            self._check(status)

    def delete(self):
        with self._no_ui(), self._find() as (exists, item, _):
            if exists:
                self._check(self.security.SecKeychainItemDelete(item))
            return exists
