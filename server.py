from __future__ import annotations

import json
import hmac
import os
import random
import sqlite3
import sys
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections import defaultdict
from http.cookies import SimpleCookie
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

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
APP_TIMEZONE = ZoneInfo("Europe/Bucharest")
TEAM_COUNT = 3
TEAM_SIZE = 6
ROLE_OPTIONS = {"forward", "middle", "back", "any"}
ROLE_LABELS = {
    "forward": "Atac",
    "middle": "Mijloc",
    "back": "Aparare",
    "any": "Oriunde",
}


def using_postgres() -> bool:
    return bool(DATABASE_URL)


@contextmanager
def get_connection():
    if using_postgres():
        if psycopg is None:
            raise RuntimeError("DATABASE_URL is set but psycopg is not installed.")
        connection = psycopg.connect(DATABASE_URL)
        try:
            yield connection
        finally:
            connection.close()
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    try:
        yield connection
    finally:
        connection.close()


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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
                """
            )
            ensure_registration_columns(connection)
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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
                """
            )
            ensure_registration_columns(connection)
            connection.commit()

    set_setting("signup_mode", "auto", only_if_missing=True)


def ensure_registration_columns(connection) -> None:
    if using_postgres():
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN IF NOT EXISTS preferred_role TEXT NOT NULL DEFAULT 'any'
            """
        )
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN IF NOT EXISTS assigned_team INTEGER
            """
        )
        return

    existing_columns = {
        row[1]
        for row in connection.execute("PRAGMA table_info(registrations)").fetchall()
    }
    if "preferred_role" not in existing_columns:
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN preferred_role TEXT NOT NULL DEFAULT 'any'
            """
        )
    if "assigned_team" not in existing_columns:
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN assigned_team INTEGER
            """
        )


def get_setting(setting_key: str, default: str = "") -> str:
    with get_connection() as connection:
        if using_postgres():
            row = connection.execute(
                "SELECT setting_value FROM app_settings WHERE setting_key = %s",
                (setting_key,),
            ).fetchone()
        else:
            connection.row_factory = sqlite3.Row
            row = connection.execute(
                "SELECT setting_value FROM app_settings WHERE setting_key = ?",
                (setting_key,),
            ).fetchone()

    if row is None:
        return default
    return row[0] if using_postgres() else row["setting_value"]


def set_setting(setting_key: str, setting_value: str, only_if_missing: bool = False) -> None:
    with get_connection() as connection:
        if using_postgres():
            if only_if_missing:
                connection.execute(
                    """
                    INSERT INTO app_settings (setting_key, setting_value)
                    VALUES (%s, %s)
                    ON CONFLICT (setting_key) DO NOTHING
                    """,
                    (setting_key, setting_value),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO app_settings (setting_key, setting_value)
                    VALUES (%s, %s)
                    ON CONFLICT (setting_key)
                    DO UPDATE SET setting_value = EXCLUDED.setting_value
                    """,
                    (setting_key, setting_value),
                )
        else:
            if only_if_missing:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
                    VALUES (?, ?)
                    """,
                    (setting_key, setting_value),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO app_settings (setting_key, setting_value)
                    VALUES (?, ?)
                    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
                    """,
                    (setting_key, setting_value),
                )
            connection.commit()


def signup_mode() -> str:
    value = get_setting("signup_mode", "auto").lower()
    if value not in {"auto", "force_open", "force_closed"}:
        return "auto"
    return value


def normalize_role(value: str | None) -> str:
    role = str(value or "any").strip().lower()
    if role not in ROLE_OPTIONS:
        return "any"
    return role


def current_week_key(now: datetime | None = None) -> str:
    moment = now or datetime.now(APP_TIMEZONE)
    iso_year, iso_week, _ = moment.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def week_label_from_key(week_key: str) -> str:
    year_text, week_text = week_key.split("-W")
    friday = datetime.fromisocalendar(int(year_text), int(week_text), 5).replace(tzinfo=APP_TIMEZONE)
    return friday.strftime("%d %b %Y")


def signup_window_for_week(week_key: str) -> tuple[datetime, datetime]:
    year_text, week_text = week_key.split("-W")
    start = datetime.fromisocalendar(int(year_text), int(week_text), 4).replace(
        hour=11,
        minute=59,
        second=0,
        microsecond=0,
        tzinfo=APP_TIMEZONE,
    )
    end = datetime.fromisocalendar(int(year_text), int(week_text), 5).replace(
        hour=23,
        minute=59,
        second=59,
        microsecond=0,
        tzinfo=APP_TIMEZONE,
    )
    return start, end


def signup_window_payload(now: datetime | None = None) -> dict[str, object]:
    current_time = now or datetime.now(APP_TIMEZONE)
    week_key = current_week_key(current_time)
    start, end = signup_window_for_week(week_key)
    schedule_open = start <= current_time <= end
    current_mode = signup_mode()
    if current_mode == "force_open":
        is_open = True
    elif current_mode == "force_closed":
        is_open = False
    else:
        is_open = schedule_open

    if current_mode == "force_closed":
        message = "Inscrierile sunt oprite manual de admin."
    elif current_mode == "force_open":
        message = "Inscrierile sunt deschise manual de admin."
    elif is_open:
        message = "Inscrierile sunt deschise acum, de joi 11:59 pana vineri la 23:59."
    elif current_time < start:
        message = (
            f"Inscrierile se deschid joi la 11:59. Fereastra pentru aceasta saptamana incepe pe "
            f"{start.strftime('%d %b %Y %H:%M')}."
        )
    else:
        next_week_time = current_time + timedelta(days=7)
        next_start, _ = signup_window_for_week(current_week_key(next_week_time))
        message = (
            f"Fereastra curenta s-a inchis vineri la 23:59. Urmatoarea deschidere este joi pe "
            f"{next_start.strftime('%d %b %Y %H:%M')}."
        )

    return {
        "isOpen": is_open,
        "scheduleOpen": schedule_open,
        "mode": current_mode,
        "message": message,
        "start": start.strftime("%Y-%m-%d %H:%M:%S"),
        "end": end.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "Europe/Bucharest",
    }


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
                SELECT id, submitted_name, created_at, preferred_role, assigned_team
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
                SELECT id, submitted_name, created_at, preferred_role, assigned_team
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
                "role": normalize_role(row[3] if using_postgres() else row["preferred_role"]),
                "roleLabel": ROLE_LABELS[
                    normalize_role(row[3] if using_postgres() else row["preferred_role"])
                ],
                "team": row[4] if using_postgres() else row["assigned_team"],
            }
        )
    return registrations


def insert_registrations(names: list[str], week_key: str) -> None:
    created_at = datetime.now(APP_TIMEZONE).replace(microsecond=0, tzinfo=None)
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


def update_registration_role(registration_id: int, role: str) -> int:
    normalized_role = normalize_role(role)
    with get_connection() as connection:
        if using_postgres():
            updated = connection.execute(
                """
                UPDATE registrations
                SET preferred_role = %s
                WHERE id = %s
                """,
                (normalized_role, registration_id),
            ).rowcount
        else:
            updated = connection.execute(
                """
                UPDATE registrations
                SET preferred_role = ?
                WHERE id = ?
                """,
                (normalized_role, registration_id),
            ).rowcount
            connection.commit()
    return updated


def reset_team_assignments(week_key: str) -> int:
    with get_connection() as connection:
        if using_postgres():
            updated = connection.execute(
                """
                UPDATE registrations
                SET assigned_team = NULL
                WHERE week_key = %s
                """,
                (week_key,),
            ).rowcount
        else:
            updated = connection.execute(
                """
                UPDATE registrations
                SET assigned_team = NULL
                WHERE week_key = ?
                """,
                (week_key,),
            ).rowcount
            connection.commit()
    return updated


def generate_balanced_teams(week_key: str) -> list[dict[str, object]]:
    registrations = fetch_registrations(week_key)
    confirmed_players = [row for row in registrations if row["status"] == "confirmed"][:GREEN_LIMIT]

    if not confirmed_players:
        reset_team_assignments(week_key)
        return []

    buckets: dict[str, list[dict[str, object]]] = defaultdict(list)
    for player in confirmed_players:
        buckets[normalize_role(player.get("role"))].append(player)

    teams = [
        {
            "id": index,
            "players": [],
            "size": 0,
            "roles": {"forward": 0, "middle": 0, "back": 0},
        }
        for index in range(1, TEAM_COUNT + 1)
    ]
    rng = random.SystemRandom()

    def choose_team_for_role(role: str | None) -> dict[str, object]:
        team_pool = teams[:]
        rng.shuffle(team_pool)
        if role in {"forward", "middle", "back"}:
            return min(
                team_pool,
                key=lambda team: (
                    team["roles"][role],
                    team["size"],
                ),
            )
        return min(team_pool, key=lambda team: team["size"])

    assignments: list[tuple[int, int]] = []
    for role in ("forward", "middle", "back", "any"):
        role_players = buckets.get(role, [])
        rng.shuffle(role_players)
        for player in role_players:
            team = choose_team_for_role(role)
            team["players"].append(player)
            team["size"] += 1
            if role in team["roles"]:
                team["roles"][role] += 1
            assignments.append((team["id"], int(player["id"])))

    with get_connection() as connection:
        if using_postgres():
            connection.execute(
                """
                UPDATE registrations
                SET assigned_team = NULL
                WHERE week_key = %s
                """,
                (week_key,),
            )
            if assignments:
                connection.executemany(
                    """
                    UPDATE registrations
                    SET assigned_team = %s
                    WHERE id = %s
                    """,
                    assignments,
                )
        else:
            connection.execute(
                """
                UPDATE registrations
                SET assigned_team = NULL
                WHERE week_key = ?
                """,
                (week_key,),
            )
            if assignments:
                connection.executemany(
                    """
                    UPDATE registrations
                    SET assigned_team = ?
                    WHERE id = ?
                    """,
                    assignments,
                )
            connection.commit()

    return build_team_payload(fetch_registrations(week_key))


def build_team_payload(registrations: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped = {
        index: {
            "id": index,
            "label": f"Echipa {index}",
            "players": [],
            "counts": {"forward": 0, "middle": 0, "back": 0, "any": 0},
        }
        for index in range(1, TEAM_COUNT + 1)
    }

    for registration in registrations:
        team_id = registration.get("team")
        if registration.get("status") != "confirmed" or team_id not in grouped:
            continue
        role = normalize_role(registration.get("role"))
        grouped[team_id]["players"].append(
            {
                "id": registration["id"],
                "name": registration["name"],
                "role": role,
                "roleLabel": ROLE_LABELS[role],
                "position": registration["position"],
            }
        )
        grouped[team_id]["counts"][role] += 1

    return [grouped[index] for index in range(1, TEAM_COUNT + 1) if grouped[index]["players"]]


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
                    "signupWindow": signup_window_payload(),
                    "registrations": registrations,
                    "teams": build_team_payload(registrations),
                    "roleOptions": [
                        {"value": value, "label": label} for value, label in ROLE_LABELS.items()
                    ],
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
        if parsed.path in {"/echipe", "/teams"}:
            self.path = "/teams.html"
            return super().do_GET()
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
        if parsed.path == "/api/admin/signup-mode":
            self.handle_admin_signup_mode()
            return
        if parsed.path == "/api/admin/update-role":
            self.handle_admin_update_role()
            return
        if parsed.path == "/api/admin/generate-teams":
            self.handle_admin_generate_teams()
            return
        if parsed.path == "/api/admin/reset-teams":
            self.handle_admin_reset_teams()
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

        signup_window = signup_window_payload()
        if not signup_window["isOpen"]:
            self.send_json(
                {
                    "error": signup_window["message"],
                    "signupWindow": signup_window,
                },
                status=HTTPStatus.FORBIDDEN,
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
                "signupWindow": signup_window,
                "registrations": registrations,
                "teams": build_team_payload(registrations),
                "roleOptions": [
                    {"value": value, "label": label} for value, label in ROLE_LABELS.items()
                ],
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
        registrations = fetch_registrations(current_week_key())
        response = {
            "deleted": deleted,
            "weekKey": current_week_key(),
            "weekLabel": week_label_from_key(current_week_key()),
            "signupWindow": signup_window_payload(),
            "registrations": registrations,
            "teams": build_team_payload(registrations),
            "authenticated": True,
            "message": (
                f"Au fost sterse {deleted} inscrieri din saptamana curenta."
                if week_key
                else f"Au fost sterse {deleted} inscrieri din toate saptamanile."
            ),
        }
        self.send_json(response)

    def handle_admin_signup_mode(self) -> None:
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

        mode = str(payload.get("mode", "auto")).lower()
        if mode not in {"auto", "force_open", "force_closed"}:
            self.send_json(
                {"error": "Mod invalid pentru placeholder."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        set_setting("signup_mode", mode)
        active_week = current_week_key()
        registrations = fetch_registrations(active_week)
        self.send_json(
            {
                "authenticated": True,
                "mode": mode,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "signupWindow": signup_window_payload(),
                "registrations": registrations,
                "teams": build_team_payload(registrations),
                "message": {
                    "force_closed": "Placeholder-ul a fost activat manual.",
                    "force_open": "Formularul a fost deschis manual.",
                    "auto": "Formularul a revenit la programul automat.",
                }[mode],
            }
        )

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
        registrations = fetch_registrations(active_week)
        self.send_json(
            {
                "deleted": deleted,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "signupWindow": signup_window_payload(),
                "registrations": registrations,
                "teams": build_team_payload(registrations),
                "authenticated": True,
                "message": "Inscrierea selectata a fost stearsa.",
            }
        )

    def handle_admin_update_role(self) -> None:
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

        role = normalize_role(str(payload.get("role", "any")))
        updated = update_registration_role(registration_id, role)
        if updated == 0:
            self.send_json(
                {"error": "Inscrierea nu a fost gasita."},
                status=HTTPStatus.NOT_FOUND,
            )
            return

        active_week = current_week_key()
        registrations = fetch_registrations(active_week)
        self.send_json(
            {
                "authenticated": True,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "signupWindow": signup_window_payload(),
                "registrations": registrations,
                "teams": build_team_payload(registrations),
                "message": f"Postul a fost actualizat la {ROLE_LABELS[role].lower()}.",
            }
        )

    def handle_admin_generate_teams(self) -> None:
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

        active_week = current_week_key()
        registrations = fetch_registrations(active_week)
        confirmed_players = [row for row in registrations if row["status"] == "confirmed"]
        if len(confirmed_players) < TEAM_COUNT:
            self.send_json(
                {"error": "Ai nevoie de cel putin 3 jucatori confirmati pentru a genera echipe."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        teams = generate_balanced_teams(active_week)
        refreshed = fetch_registrations(active_week)
        self.send_json(
            {
                "authenticated": True,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "signupWindow": signup_window_payload(),
                "registrations": refreshed,
                "teams": teams,
                "message": "Echipele au fost generate echilibrat pe baza posturilor setate.",
            }
        )

    def handle_admin_reset_teams(self) -> None:
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

        active_week = current_week_key()
        reset_team_assignments(active_week)
        registrations = fetch_registrations(active_week)
        self.send_json(
            {
                "authenticated": True,
                "weekKey": active_week,
                "weekLabel": week_label_from_key(active_week),
                "signupWindow": signup_window_payload(),
                "registrations": registrations,
                "teams": build_team_payload(registrations),
                "message": "Echipele generate au fost resetate.",
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
