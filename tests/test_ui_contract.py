from __future__ import annotations

import json
import re
import struct
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"


class IdCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(str(attributes["id"]))


class FrontendContractTestCase(unittest.TestCase):
    def test_pages_have_unique_ids_and_accessibility_landmarks(self) -> None:
        for filename in ("index.html", "teams.html"):
            with self.subTest(filename=filename):
                source = (STATIC_DIR / filename).read_text(encoding="utf-8")
                parser = IdCollector()
                parser.feed(source)
                self.assertEqual(len(parser.ids), len(set(parser.ids)))
                self.assertIn('class="skip-link"', source)
                self.assertIn('id="continut-principal"', source)
                self.assertIn('class="sr-only"', source)

    def test_attendance_page_keeps_critical_responsive_contracts(self) -> None:
        source = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        enhancements = (STATIC_DIR / "ui-enhancements.css").read_text(encoding="utf-8")

        self.assertIn('id="countdown-card"', source)
        self.assertIn('id="connection-status"', source)
        self.assertIn('role="progressbar"', source)
        self.assertIn(".content-grid.is-closed", enhancements)
        self.assertIn("@media (max-width: 700px)", enhancements)
        self.assertIn("@media (max-width: 340px)", enhancements)
        self.assertIn("prefers-reduced-motion", enhancements)
        self.assertRegex(enhancements, r"\.attendance-list-table \.name-cell\s*\{")
        self.assertIn("width: clamp(108px, 31vw, 122px)", enhancements)
        self.assertIn(".attendance-list-table .time-date", enhancements)
        self.assertIn("border-left: 1px solid", enhancements)

    def test_manifest_and_service_worker_cover_the_app_shell(self) -> None:
        manifest = json.loads((STATIC_DIR / "manifest.webmanifest").read_text(encoding="utf-8"))
        worker = (STATIC_DIR / "service-worker.js").read_text(encoding="utf-8")
        attendance_page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")

        self.assertEqual(manifest["lang"], "ro")
        self.assertEqual(manifest["display"], "standalone")
        self.assertTrue(manifest["icons"])
        self.assertIn('url.pathname.startsWith("/api/")', worker)
        self.assertIn('cache: "reload"', worker)
        self.assertIn('cache: "no-store"', worker)
        app_script = (STATIC_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("navigator.serviceWorker.controller", app_script)
        self.assertIn('addEventListener("controllerchange"', app_script)
        self.assertIn('/styles.css?v=20260831-1', attendance_page)
        self.assertIn('/app.js?v=20260831-1', attendance_page)

        shell_match = re.search(r"const APP_SHELL = \[(.*?)\];", worker, re.DOTALL)
        self.assertIsNotNone(shell_match)
        shell_paths = re.findall(r'["`](/[^"`]+)["`]', shell_match.group(1))
        for asset_path in shell_paths:
            if asset_path in {"/", "/miercuri", "/echipe"}:
                continue
            with self.subTest(asset=asset_path):
                asset_filename = asset_path.split("?", 1)[0].lstrip("/")
                self.assertTrue((STATIC_DIR / asset_filename).exists())

        expected_icon_sizes = {
            "app-icon-192.png": (192, 192),
            "app-icon-512.png": (512, 512),
        }
        for filename, expected_size in expected_icon_sizes.items():
            with self.subTest(icon=filename):
                png = (STATIC_DIR / filename).read_bytes()
                self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", png[16:24]), expected_size)

    def test_primary_page_uses_romanian_diacritics(self) -> None:
        source = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        legacy_phrases = (
            "Prezenta saptamanala",
            "Inscrierile sunt inchise",
            "Lista de asteptare",
            "Trimite inscrierea",
        )
        for phrase in legacy_phrases:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, source)


if __name__ == "__main__":
    unittest.main()
