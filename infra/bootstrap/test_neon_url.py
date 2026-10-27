"""Tests for neon_url.py (CI infra job: python3 -m unittest discover -s infra/bootstrap)."""

import unittest

from neon_url import convert

HOST = "ep-frosty-king-a75yhuh3.ap-southeast-2.aws.neon.tech"
POOLED = f"postgresql://neondb_owner:p%40ss@ep-frosty-king-a75yhuh3-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DIRECT = f"postgres://neondb_owner:p%40ss@{HOST}/neondb?sslmode=require"
QUERY = "?sslmode=verify-full&channel_binding=require"


class ConvertTest(unittest.TestCase):
    def test_pooled_and_direct_from_either_form(self):
        for given in (POOLED, DIRECT, f"psql '{POOLED}'", f"  {DIRECT}\n"):
            with self.subTest(given=given):
                self.assertEqual(
                    convert(given, "pooled"),
                    f"postgresql://neondb_owner:p%40ss@ep-frosty-king-a75yhuh3-pooler.ap-southeast-2.aws.neon.tech/neondb{QUERY}",
                )
                self.assertEqual(convert(given, "direct"), f"postgresql://neondb_owner:p%40ss@{HOST}/neondb{QUERY}")
                self.assertEqual(convert(given, "role"), "neondb_owner")

    def test_rejects_without_echoing_the_input(self):
        bad = [
            "mysql://u:secret@ep-x.aws.neon.tech/db",
            "postgresql://u:secret@db.example.com/db",
            "postgresql://u@ep-x.aws.neon.tech/db",
            "postgresql://u:secret@ep-x.aws.neon.tech/",
            "",
        ]
        for given in bad:
            with self.subTest(given=given), self.assertRaises(ValueError) as caught:
                convert(given, "pooled")
            self.assertNotIn("secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
