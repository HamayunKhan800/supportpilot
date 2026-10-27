"""Tests for gh_secret.py's token handling (CI infra job; no network, no PyNaCl needed)."""

import unittest

from gh_secret import GitHubError, check_token_shape, clean_token, describe_token

TOKEN = "github_pat_" + "A1b2C3d4E5" * 8 + "xyz"  # same shape as a real one, not a real one


class TokenTest(unittest.TestCase):
    def test_cleans_what_a_phone_paste_adds(self):
        for pasted in (TOKEN, f"  {TOKEN}\n", f"\x1b[200~{TOKEN}\x1b[201~", f"{TOKEN}\r\n", f"'{TOKEN}'"):
            with self.subTest(pasted=pasted):
                self.assertEqual(clean_token(pasted), TOKEN)
                check_token_shape(clean_token(pasted))

    def test_refuses_other_text_and_never_echoes_it(self):
        for pasted in ("", "bash supportpilot/infra/bootstrap/github-keys.sh", "postgresql://u:secretpw@ep-x.neon.tech/db", TOKEN[:40]):
            with self.subTest(pasted=pasted), self.assertRaises(GitHubError) as caught:
                check_token_shape(clean_token(pasted))
            self.assertNotIn("secretpw", str(caught.exception))
            self.assertNotIn(TOKEN[11:30], str(caught.exception))

    def test_description_shows_only_length_and_start(self):
        self.assertEqual(describe_token(TOKEN), f"got {len(TOKEN)} characters starting with 'gith'")
        self.assertEqual(describe_token(""), "nothing was pasted")


if __name__ == "__main__":
    unittest.main()
