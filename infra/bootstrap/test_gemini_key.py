"""Tests for gemini_key.py (CI infra job). A local stand-in plays Google; no real key is used."""

import http.server
import io
import threading
import unittest
from contextlib import redirect_stdout
from unittest import mock

import gemini_key

GOOD = "AQ.Ab8" + "x1Y2z3" * 8 + "_-q"  # same character set as a real key, not a real one


class StandInGoogle(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.headers.get("x-goog-api-key") == GOOD and self.path.endswith(gemini_key.CHECK_MODEL)
        self.send_response(200 if ok else 401)
        self.end_headers()
        self.wfile.write(b'{"name":"models/x"}' if ok else b'{"error":{"message":"API key not valid."}}')

    def log_message(self, *args):
        pass


class GeminiKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), StandInGoogle)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.api = f"http://127.0.0.1:{cls.server.server_port}/v1beta/models/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def run_main(self, pasted):
        out = io.StringIO()
        with mock.patch("getpass.getpass", return_value=pasted), \
                mock.patch.object(gemini_key, "save") as save, redirect_stdout(out):
            code = gemini_key.main(self.api)
        return code, save, out.getvalue()

    def test_cleans_what_a_phone_paste_adds(self):
        for pasted in (GOOD, f"  {GOOD}\n", f"\x1b[200~{GOOD}\x1b[201~", f"[200~{GOOD}[201~", f"{GOOD}\r\n", f"'{GOOD}'"):
            with self.subTest(pasted=pasted):
                self.assertEqual(gemini_key.clean_key(pasted), GOOD)

    def test_saves_only_what_google_accepts(self):
        code, save, out = self.run_main(f"\x1b[200~{GOOD}\x1b[201~")
        self.assertEqual(code, 0)
        save.assert_called_once_with(GOOD)
        self.assertIn("Google accepted", out)

    def test_refused_key_changes_nothing_and_is_never_printed(self):
        wrong = GOOD[:-4] + "zzzz"
        code, save, out = self.run_main(wrong)
        self.assertEqual(code, 1)
        save.assert_not_called()
        self.assertIn("NOT saved", out)
        self.assertIn("HTTP 401 API key not valid.", out)
        self.assertNotIn(wrong[3:], out)

    def test_empty_paste_skips(self):
        code, save, out = self.run_main("\n")
        self.assertEqual(code, 0)
        save.assert_not_called()
        self.assertIn("nothing was pasted", out)

    def test_unreachable_google_changes_nothing(self):
        out = io.StringIO()
        with mock.patch("getpass.getpass", return_value=GOOD), \
                mock.patch.object(gemini_key, "save") as save, redirect_stdout(out):
            code = gemini_key.main("http://127.0.0.1:9/v1beta/models/")
        self.assertEqual(code, 1)
        save.assert_not_called()
        self.assertIn("could not reach Google", out.getvalue())


if __name__ == "__main__":
    unittest.main()
