"""Security.framework binding tests using only an in-memory fake library."""
import ctypes
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


class KeychainTests(unittest.TestCase):
    def test_binding_exists(self):
        self.assertTrue((Path(__file__).resolve().parents[1] / "scripts/gemini_image_keychain.py").exists())

    def test_in_memory_roundtrip_and_ui_restoration(self):
        from gemini_image_keychain import Keychain
        lib = FakeSecurity()
        store = Keychain(lib, lib)
        self.assertFalse(store.exists())
        record = {"account": "jane@example.com", "cookies": {"__Secure-1PSID": "SECRET", "__Secure-1PSIDTS": "SECRET2"}}
        store.save(record)
        self.assertTrue(store.exists())
        self.assertEqual(store.load(), record)
        record["cookies"]["__Secure-1PSIDTS"] = "ROTATED"
        store.save(record)
        self.assertEqual(store.load(), record)
        self.assertTrue(store.delete())
        self.assertFalse(store.delete())
        self.assertTrue(lib.interaction)
        self.assertTrue(all(lib.suppressed))

    def test_denied_access_sanitized_and_ui_restored(self):
        from gemini_image_keychain import Keychain
        from gemini_image_core import Failure
        lib = FakeSecurity()
        lib.denied = True
        with self.assertRaises(Failure) as failure:
            Keychain(lib, lib).load()
        self.assertEqual(failure.exception.code, "keychain_denied")
        self.assertTrue(lib.interaction)


class FakeSecurity:
    def __init__(self):
        self.value = None
        self.interaction = True
        self.suppressed = []
        self.denied = False

    def SecKeychainGetUserInteractionAllowed(self, out):
        out._obj.value = self.interaction
        return 0

    def SecKeychainSetUserInteractionAllowed(self, value):
        self.interaction = bool(value)
        return 0

    def SecKeychainFindGenericPassword(self, keychain, slen, service, alen, account, length, password, item):
        self.suppressed.append(not self.interaction)
        if self.denied:
            return -25308
        if self.value is None:
            return -25300
        item._obj.value = 1
        if password:
            self.buffer = ctypes.create_string_buffer(self.value)
            password._obj.value = ctypes.addressof(self.buffer)
            length._obj.value = len(self.value)
        return 0

    def SecKeychainAddGenericPassword(self, keychain, slen, service, alen, account, size, data, item):
        self.suppressed.append(not self.interaction)
        self.value = ctypes.string_at(data, size)
        return 0

    def SecKeychainItemModifyAttributesAndData(self, item, attrs, size, data):
        self.suppressed.append(not self.interaction)
        self.value = ctypes.string_at(data, size)
        return 0

    def SecKeychainItemDelete(self, item):
        self.suppressed.append(not self.interaction)
        self.value = None
        return 0

    def SecKeychainItemFreeContent(self, attrs, password):
        return 0

    def CFRelease(self, item):
        pass

if __name__ == "__main__":
    unittest.main()
