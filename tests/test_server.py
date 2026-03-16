from __future__ import annotations

import io
import json
import tempfile
import unittest
from datetime import datetime
from http import HTTPStatus
from pathlib import Path
from unittest.mock import patch

import server


class FakeAttendanceHandler(server.AttendanceHandler):
    def __init__(
        self,
        path: str,
        method: str = "GET",
        payload: dict[str, object] | None = None,
        cookie: str | None = None,
    ) -> None:
        self.path = path
        self.command = method
        raw_body = json.dumps(payload).encode("utf-8") if payload is not None else b""
        self.headers = {
            "Content-Length": str(len(raw_body)),
        }
        if cookie:
            self.headers["Cookie"] = cookie
        self.rfile = io.BytesIO(raw_body)
        self.wfile = io.BytesIO()
        self.response_status = None
        self.response_headers: dict[str, list[str]] = {}

    def send_response(self, code, message=None):  # type: ignore[override]
        self.response_status = int(code)

    def send_header(self, keyword, value):  # type: ignore[override]
        self.response_headers.setdefault(keyword, []).append(value)

    def end_headers(self):  # type: ignore[override]
        return

    def send_error(self, code, message=None, explain=None):  # type: ignore[override]
        self.send_json({"error": message or explain or "Eroare"}, status=code)

    def log_message(self, format, *args):  # type: ignore[override]
        return

    def json_body(self) -> dict[str, object]:
        body = self.wfile.getvalue().decode("utf-8")
        return json.loads(body) if body else {}


class AttendanceServerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = server.DB_PATH
        self.original_database_url = server.DATABASE_URL
        self.original_admin_password = server.ADMIN_PASSWORD

        server.DB_PATH = Path(self.tempdir.name) / "attendance.db"
        server.DATABASE_URL = None
        server.ADMIN_PASSWORD = "test-admin"
        server.ensure_database()
        self.week_key = server.current_week_key()

    def tearDown(self) -> None:
        self.tempdir.cleanup()
        server.DB_PATH = self.original_db_path
        server.DATABASE_URL = self.original_database_url
        server.ADMIN_PASSWORD = self.original_admin_password

    def dispatch(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
        cookie: str | None = None,
    ) -> tuple[int, dict[str, object], dict[str, list[str]]]:
        handler = FakeAttendanceHandler(path=path, method=method, payload=payload, cookie=cookie)
        if method == "GET":
            handler.do_GET()
        elif method == "POST":
            handler.do_POST()
        elif method == "DELETE":
            handler.do_DELETE()
        else:  # pragma: no cover
            raise ValueError(f"Unsupported method {method}")
        return handler.response_status or 0, handler.json_body(), handler.response_headers

    def login_admin(self) -> str:
        status, payload, headers = self.dispatch(
            "POST",
            "/api/admin/login",
            payload={"password": "test-admin"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["message"], "Autentificare reusita.")
        return headers["Set-Cookie"][0].split(";", 1)[0]

    def seed_registrations(self, count: int = 18) -> list[dict[str, object]]:
        server.insert_registrations([f"Jucator {index}" for index in range(1, count + 1)], self.week_key)
        return server.fetch_registrations(self.week_key)

    def test_sanitize_names_trims_and_limits_to_two_entries(self) -> None:
        names = server.sanitize_names(
            {
                "person1": "  Ion  ",
                "person2": " Popescu ",
                "person3": " Ignored ",
            }
        )
        self.assertEqual(names, ["Ion", "Popescu"])

    def test_normalize_role_falls_back_to_any(self) -> None:
        self.assertEqual(server.normalize_role("forward"), "forward")
        self.assertEqual(server.normalize_role("keeper"), "any")
        self.assertEqual(server.normalize_role(None), "any")

    def test_week_label_from_key_uses_friday_date(self) -> None:
        self.assertEqual(server.week_label_from_key("2026-W12"), "20 Mar 2026")

    def test_signup_window_payload_closed_before_opening(self) -> None:
        moment = datetime(2026, 3, 19, 11, 58, tzinfo=server.APP_TIMEZONE)
        with patch("server.signup_mode", return_value="auto"):
            payload = server.signup_window_payload(moment)
        self.assertFalse(payload["isOpen"])
        self.assertFalse(payload["scheduleOpen"])
        self.assertIn("11:59", payload["message"])

    def test_signup_window_payload_open_inside_window(self) -> None:
        moment = datetime(2026, 3, 19, 12, 0, tzinfo=server.APP_TIMEZONE)
        with patch("server.signup_mode", return_value="auto"):
            payload = server.signup_window_payload(moment)
        self.assertTrue(payload["isOpen"])
        self.assertTrue(payload["scheduleOpen"])
        self.assertIn("Inscrierile sunt deschise acum", payload["message"])

    def test_signup_window_payload_closed_after_window(self) -> None:
        moment = datetime(2026, 3, 21, 0, 1, tzinfo=server.APP_TIMEZONE)
        with patch("server.signup_mode", return_value="auto"):
            payload = server.signup_window_payload(moment)
        self.assertFalse(payload["isOpen"])
        self.assertFalse(payload["scheduleOpen"])
        self.assertIn("Urmatoarea deschidere", payload["message"])

    def test_signup_window_payload_force_modes_override_schedule(self) -> None:
        moment = datetime(2026, 3, 18, 10, 0, tzinfo=server.APP_TIMEZONE)
        with patch("server.signup_mode", return_value="force_open"):
            payload = server.signup_window_payload(moment)
        self.assertTrue(payload["isOpen"])
        self.assertFalse(payload["scheduleOpen"])
        self.assertIn("deschise manual", payload["message"])

        with patch("server.signup_mode", return_value="force_closed"):
            payload = server.signup_window_payload(moment)
        self.assertFalse(payload["isOpen"])
        self.assertFalse(payload["scheduleOpen"])
        self.assertIn("oprite manual", payload["message"])

    def test_admin_session_token_is_recognized_and_invalid_cookie_is_rejected(self) -> None:
        cookie = f"admin_session={server.create_admin_session()}"
        self.assertTrue(server.is_admin_authenticated(cookie))
        self.assertFalse(server.is_admin_authenticated("admin_session=invalid"))

    def test_admin_status_reports_enabled_and_authentication(self) -> None:
        status, payload, _ = self.dispatch("GET", "/api/admin/status")
        self.assertEqual(status, 200)
        self.assertTrue(payload["enabled"])
        self.assertFalse(payload["authenticated"])

        cookie = self.login_admin()
        status, payload, _ = self.dispatch("GET", "/api/admin/status", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertTrue(payload["authenticated"])

    def test_admin_login_rejects_wrong_password(self) -> None:
        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/login",
            payload={"password": "gresita"},
        )
        self.assertEqual(status, HTTPStatus.UNAUTHORIZED)
        self.assertEqual(payload["error"], "Parola de admin este incorecta.")

    def test_registration_requires_at_least_one_name(self) -> None:
        status, payload, _ = self.dispatch(
            "POST",
            "/api/registrations",
            payload={"person1": "   ", "person2": ""},
        )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertEqual(payload["error"], "Completeaza cel putin un nume.")

    def test_registration_is_blocked_when_signup_is_force_closed(self) -> None:
        server.set_setting("signup_mode", "force_closed")
        status, payload, _ = self.dispatch(
            "POST",
            "/api/registrations",
            payload={"person1": "Ion"},
        )
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertIn("oprite manual", payload["error"])

    def test_registration_can_be_created_when_signup_is_force_open(self) -> None:
        server.set_setting("signup_mode", "force_open")
        status, payload, _ = self.dispatch(
            "POST",
            "/api/registrations",
            payload={"person1": "Ion", "person2": "Vlad"},
        )
        self.assertEqual(status, HTTPStatus.CREATED)
        self.assertEqual(len(payload["registrations"]), 2)
        self.assertEqual(payload["registrations"][0]["status"], "confirmed")

    def test_registrations_payload_marks_first_18_confirmed_and_rest_waiting(self) -> None:
        self.seed_registrations(count=19)
        status, payload, _ = self.dispatch("GET", "/api/registrations")
        self.assertEqual(status, 200)
        self.assertEqual(payload["registrations"][17]["status"], "confirmed")
        self.assertEqual(payload["registrations"][18]["status"], "waiting")

    def test_update_role_rejects_invalid_registration_id(self) -> None:
        cookie = self.login_admin()
        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/update-role",
            payload={"id": "abc", "role": "forward"},
            cookie=cookie,
        )
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertEqual(payload["error"], "ID invalid pentru inscriere.")

    def test_invalid_role_is_normalized_to_any(self) -> None:
        registrations = self.seed_registrations(count=1)
        cookie = self.login_admin()
        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/update-role",
            payload={"id": registrations[0]["id"], "role": "portar"},
            cookie=cookie,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["registrations"][0]["role"], "any")

    def test_generate_teams_requires_minimum_number_of_confirmed_players(self) -> None:
        self.seed_registrations(count=2)
        cookie = self.login_admin()
        status, payload, _ = self.dispatch("POST", "/api/admin/generate-teams", cookie=cookie)
        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn("cel putin 3", payload["error"])

    def test_admin_can_delete_single_registration(self) -> None:
        registrations = self.seed_registrations(count=3)
        cookie = self.login_admin()
        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/delete-registration",
            payload={"id": registrations[1]["id"]},
            cookie=cookie,
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["registrations"]), 2)
        remaining_names = [registration["name"] for registration in payload["registrations"]]
        self.assertNotIn("Jucator 2", remaining_names)

    def test_admin_can_clear_current_week(self) -> None:
        self.seed_registrations(count=4)
        cookie = self.login_admin()
        status, payload, _ = self.dispatch("POST", "/api/admin/clear-week", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(payload["deleted"], 4)
        self.assertEqual(payload["registrations"], [])

    def test_admin_can_clear_all_weeks(self) -> None:
        self.seed_registrations(count=3)
        previous_week = "2026-W01"
        server.insert_registrations(["Arhivat"], previous_week)
        cookie = self.login_admin()
        status, payload, _ = self.dispatch("POST", "/api/admin/clear-all", cookie=cookie)
        self.assertEqual(status, 200)
        self.assertEqual(payload["deleted"], 4)
        self.assertEqual(server.fetch_registrations(self.week_key), [])
        self.assertEqual(server.fetch_registrations(previous_week), [])

    def test_delete_admin_session_returns_no_content(self) -> None:
        status, payload, headers = self.dispatch("DELETE", "/api/admin/session")
        self.assertEqual(status, HTTPStatus.NO_CONTENT)
        self.assertEqual(payload, {})
        self.assertIn("Set-Cookie", headers)

    def test_get_registrations_includes_role_options_and_team_payload(self) -> None:
        self.seed_registrations(count=6)
        status, payload, _ = self.dispatch("GET", "/api/registrations")
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["roleOptions"]), 4)
        self.assertEqual(payload["teams"], [])

    def test_generate_balanced_teams_distributes_roles_evenly(self) -> None:
        registrations = self.seed_registrations()
        roles = ["forward"] * 6 + ["middle"] * 6 + ["back"] * 6
        for registration, role in zip(registrations, roles):
            server.update_registration_role(int(registration["id"]), role)

        teams = server.generate_balanced_teams(self.week_key)

        self.assertEqual(len(teams), 3)
        for team in teams:
            self.assertEqual(len(team["players"]), 6)
            self.assertEqual(team["counts"]["forward"], 2)
            self.assertEqual(team["counts"]["middle"], 2)
            self.assertEqual(team["counts"]["back"], 2)

    def test_admin_can_update_roles_generate_and_reset_teams(self) -> None:
        registrations = self.seed_registrations()
        cookie = self.login_admin()

        role_cycle = ["forward", "middle", "back"]
        for index, registration in enumerate(registrations):
            status, payload, _ = self.dispatch(
                "POST",
                "/api/admin/update-role",
                payload={"id": registration["id"], "role": role_cycle[index % 3]},
                cookie=cookie,
            )
            self.assertEqual(status, 200)
            self.assertIn("Postul a fost actualizat", payload["message"])

        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/generate-teams",
            cookie=cookie,
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["teams"]), 3)
        self.assertEqual(sum(len(team["players"]) for team in payload["teams"]), 18)
        self.assertTrue(all(registration["team"] in {1, 2, 3} for registration in payload["registrations"][:18]))

        status, payload, _ = self.dispatch(
            "POST",
            "/api/admin/reset-teams",
            cookie=cookie,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["teams"], [])
        self.assertTrue(all(registration["team"] is None for registration in payload["registrations"]))

    def test_generate_teams_requires_admin_authentication(self) -> None:
        self.seed_registrations()
        status, payload, _ = self.dispatch("POST", "/api/admin/generate-teams")
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "Autentificare necesara.")

    def test_registrations_payload_exposes_roles_and_team_metadata(self) -> None:
        registrations = self.seed_registrations()
        for registration in registrations[:6]:
            server.update_registration_role(int(registration["id"]), "forward")
        server.generate_balanced_teams(self.week_key)

        status, payload, _ = self.dispatch("GET", "/api/registrations")
        self.assertEqual(status, 200)
        self.assertIn("teams", payload)
        self.assertIn("roleOptions", payload)
        self.assertEqual(payload["roleOptions"][0]["label"], "Atac")
        self.assertTrue(any(registration["team"] for registration in payload["registrations"][:6]))


if __name__ == "__main__":
    unittest.main()
