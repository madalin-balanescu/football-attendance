from __future__ import annotations

import json
import hmac
import os
import sqlite3
import sys
from base64 import urlsafe_b64decode, urlsafe_b64encode
from http.cookies import SimpleCookie
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import psycopg
except ImportError:  # pragma: no cover - local fallback when dependency is not installed yet.
    psycopg = None


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "data" / "attendance.db"
DATABASE_URL = os.environ.get("DATABASE_URL")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
MAX_NAMES_PER_SUBMISSION = 2
GREEN_LIMIT = 18
ADMIN_SESSION_HOURS = 12


def using_postgres() -> bool:
    return bool(DATABASE_URL)


@contextmanager
def get_connection():
    if using_postgres():
        if psycopg is None:
            raise RuntimeError("DATABASE_URL is set but psycopg is not installed.")
        with psycopg.connect(DATABASE_URL) as connection:
            yield connection
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        yield connection


def ensure_database() -> None:
    with get_connection() as connection:
        if using_postgres():
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS registrations (
                    id BIGSERIAL PRIMARY KEY,
                    submitted_name TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    week_key TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_registrations_week_created
                ON registrations (week_key, created_at, id)
                """
            )
        else:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS registrations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    submitted_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    week_key TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_registrations_week_created
                ON registrations (week_key, created_at, id)
                """
            )
            connection.commit()


def current_week_key(now: datetime | None = None) -> str:
    moment = now or datetime.now()
    iso_year, iso_week, _ = moment.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def week_label_from_key(week_key: str) -> str:
    year_text, week_text = week_key.split("-W")
    week_start = datetime.fromisocalendar(int(year_text), int(week_text), 1)
    week_end = week_start + timedelta(days=6)
    return f"{week_start.strftime('%d %b %Y')} - {week_end.strftime('%d %b %Y')}"


def sanitize_names(payload: dict[str, object]) -> list[str]:
    raw_names = [payload.get("person1", ""), payload.get("person2", "")]
    names: list[str] = []
    for value in raw_names[:MAX_NAMES_PER_SUBMISSION]:
        cleaned = str(value).strip()
        if cleaned:
            names.append(cleaned)
    return names


def fetch_registrations(week_key: str) -> list[dict[str, object]]:
    with get_connection() as connection:
        if using_postgres():
            rows = connection.execute(
                """
                SELECT id, submitted_name, created_at
                FROM registrations
                WHERE week_key = %s
                ORDER BY created_at ASC, id ASC
                """,
                (week_key,),
            ).fetchall()
        else:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                """
                SELECT id, submitted_name, created_at
                FROM registrations
                WHERE week_key = ?
                ORDER BY datetime(created_at) ASC, id ASC
                """,
                (week_key,),
            ).fetchall()

    registrations: list[dict[str, object]] = []
    for index, row in enumerate(rows, start=1):
        created_at = row[2] if using_postgres() else row["created_at"]
        if isinstance(created_at, datetime):
            created_at_text = created_at.strftime("%Y-%m-%d %H:%M:%S")
        else:
            created_at_text = str(created_at)

        registrations.append(
            {
                "position": index,
                "id": row[0] if using_postgres() else row["id"],
                "name": row[1] if using_postgres() else row["submitted_name"],
                "createdAt": created_at_text,
                "status": "confirmed" if index <= GREEN_LIMIT else "waiting",
            }
        )
    return registrations


def insert_registrations(names: list[str], week_key: str) -> None:
    created_at = datetime.now().replace(microsecond=0)
    with get_connection() as connection:
        if using_postgres():
            connection.executemany(
                """
                INSERT INTO registrations (submitted_name, created_at, week_key)
                VALUES (%s, %s, %s)
                """,
                [(name, created_at, week_key) for name in names],
            )
        else:
            connection.executemany(
                """
                INSERT INTO registrations (submitted_name, created_at, week_key)
                VALUES (?, ?, ?)
                """,
                [(name, created_at.strftime("%Y-%m-%d %H:%M:%S"), week_key) for name in names],
            )
            connection.commit()


def delete_registrations(week_key: str | None = None) -> int:
    with get_connection() as connection:
        if using_postgres():
            if week_key is None:
                deleted = connection.execute("DELETE FROM registrations").rowcount
            else:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = %s",
                    (week_key,),
                ).rowcount
        else:
            if week_key is None:
                deleted = connection.execute("DELETE FROM registrations").rowcount
            else:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = ?",
                    (week_key,),
                ).rowcount
            connection.commit()
    return deleted


def delete_registration_by_id(registration_id: int) -> int:
    with get_connection() as connection:
        if using_postgres():
            deleted = connection.execute(
                "DELETE FROM registrations WHERE id = %s",
                (registration_id,),
            ).rowcount
        else:
            deleted = connection.execute(
                "DELETE FROM registrations WHERE id = ?",
                (registration_id,),
            ).rowcount
            connection.commit()
    return deleted


def create_admin_session() -> str:
    expires_at = int((datetime.now() + timedelta(hours=ADMIN_SESSION_HOURS)).timestamp())
    message = f"{expires_at}".encode("utf-8")
    signature = hmac.new(ADMIN_PASSWORD.encode("utf-8"), message, sha256).hexdigest()
    token = f"{expires_at}:{signature}"
    return urlsafe_b64encode(token.encode("utf-8")).decode("ascii")


def is_admin_authenticated(cookie_header: str | None) -> bool:
    if not ADMIN_PASSWORD or not cookie_header:
        return False

    cookie = SimpleCookie()
    cookie.load(cookie_header)
    morsel = cookie.get("admin_session")
    if morsel is None:
        return False

    try:
        decoded = urlsafe_b64decode(morsel.value.encode("ascii")).decode("utf-8")
        expires_text, signature = decoded.split(":", 1)
        expires_at = int(expires_text)
    except (ValueError, UnicodeDecodeError):
        return False

    if expires_at < int(datetime.now().timestamp()):
        return False

    expected = hmac.new(
        ADMIN_PASSWORD.encode("utf-8"),
        expires_text.encode("utf-8"),
        sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


def print_usage() -> None:
    print("Usage:")
    print("  python3 server.py")
    print("  python3 server.py clear-week")
    print("  python3 server.py clear-all")


class AttendanceHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/registrations":
            params = parse_qs(parsed.query)
            week_key = params.get("week", [current_week_key()])[0]
            registrations = fetch_registrations(week_key)
            self.send_json(
                {
                    "weekKey": week_key,
                    "weekLabel": week_label_from_key(week_key),
                    "greenLimit": GREEN_LIMIT,
                    "registrations": registrations,
                }
            )
            return
        if parsed.path == "/api/admin/status":
            self.send_json(
                {
                    "enabled": bool(ADMIN_PASSWORD),
                    "authenticated": is_admin_authenticated(self.headers.get("Cookie")),
                }
            )
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/admin/login":
            self.handle_admin_login()
            return
        if parsed.path == "/api/admin/clear-week":
            self.handle_admin_clear(current_week_key())
            return
        if parsed.path == "/api/admin/clear-all":
            self.handle_admin_clear(None)
            return
        if parsed.path == "/api/admin/delete-registration":
            self.handle_admin_delete_one()
            return
        if parsed.path != "/api/registrations":
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return

        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return

        names = sanitize_names(payload)
        if not names:
            self.send_json(
                {"error": "Completeaza cel putin un nume."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        week_key = current_week_key()
        insert_registrations(names, week_key)
        registrations = fetch_registrations(week_key)
        self.send_json(
            {
                "message": "Inscrierea a fost salvata.",
                "weekKey": week_key,
                "weekLabel": week_label_from_key(week_key),
                "greenLimit": GREEN_LIMIT,
                "registrations": registrations,
            },
            status=HTTPStatus.CREATED,
        )

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/admin/session":
            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")
            return

        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header(
            "Set-Cookie",
            "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        )
        self.end_headers()

    def handle_admin_login(self) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de admin nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        payload = self.read_json_body()
        if payload is None:
            return

        password = str(payload.get("password", ""))
        if not hmac.compare_digest(password, ADMIN_PASSWORD):
            self.send_json(
                {"error": "Parola de admin este incorecta."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        token = create_admin_session()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header(
            "Set-Cookie",
            f"admin_session={token}; Path=/; Max-Age={ADMIN_SESSION_HOURS * 3600}; HttpOnly; SameSite=Lax",
        )
        body = json.dumps({"message": "Autentificare reusita."}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_admin_clear(self, week_key: str | None) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de admin nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesara."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        deleted = delete_registrations(week_key)
        response = {
            "deleted": deleted,
            "weekKey": current_week_key(),
            "weekLabel": week_label_from_key(current_week_key()),
            "registrations": fetch_registrations(current_week_key()),
            "authenticated": True,
            "message": (
                f"Au fost sterse {deleted} inscrieri din saptamana curenta."
                if week_key
                else f"Au fost sterse {deleted} inscrieri din toate saptamanile."
            ),
        }
        self.send_json(response)

    def handle_admin_delete_one(self) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de admin nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesara."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        payload = self.read_json_body()
        if payload is None:
            return

        try:
            registration_id = int(payload.get("id", 0))
        except (TypeError, ValueError):
            self.send_json(
                {"error": "ID invalid pentru inscriere."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        deleted = delete_registration_by_id(registration_id)
        if deleted == 0:
            self.send_json(
                {"error": "Inscrierea nu a fost gasita."},
                status=HTTPStatus.NOT_FOUND,
            )
            return

        active_week = current_week_key()
        self.send_json(
            {
                "deleted": deleted,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "registrations": fetch_registrations(active_week),
                "authenticated": True,
                "message": "Inscrierea selectata a fost stearsa.",
            }
        )

    def read_json_body(self) -> dict[str, object] | None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return None

        raw_body = self.rfile.read(content_length)
        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return None

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    ensure_database()
    app = ThreadingHTTPServer((HOST, PORT), AttendanceHandler)
    print(f"Football attendance app running on http://{HOST}:{PORT}")
    app.serve_forever()


if __name__ == "__main__":
    ensure_database()

    if len(sys.argv) == 1:
        run()
    elif sys.argv[1] == "clear-week":
        active_week = current_week_key()
        deleted = delete_registrations(active_week)
        print(f"Deleted {deleted} registrations for {active_week}.")
    elif sys.argv[1] == "clear-all":
        deleted = delete_registrations()
        print(f"Deleted {deleted} registrations from all weeks.")
    else:
        print_usage()
        raise SystemExit(1)
