from __future__ import annotations

import json
import hmac
import ipaddress
import math
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
RATE_LIMIT_SECRET = os.environ.get("RATE_LIMIT_SECRET") or ADMIN_PASSWORD
MAX_NAMES_PER_SUBMISSION = 2
GREEN_LIMIT = 18
ADMIN_SESSION_HOURS = 12
REGISTRATION_SHORT_LIMIT = 3
REGISTRATION_SHORT_WINDOW = timedelta(minutes=10)
REGISTRATION_WEEKLY_LIMIT = 8
RATE_LIMIT_RETENTION = timedelta(days=14)
APP_TIMEZONE = ZoneInfo("Europe/Bucharest")
TEAM_COUNT = 3
TEAM_SIZE = 6
ROLE_OPTIONS = {"forward", "middle", "back", "any"}
ROLE_LABELS = {
    "forward": "Atac",
    "middle": "Mijloc",
    "back": "Apărare",
    "any": "Oriunde",
}
FRIDAY_EVENT = "friday"
WEDNESDAY_EVENT = "wednesday"
EVENT_KEYS = {FRIDAY_EVENT, WEDNESDAY_EVENT}
ROMANIAN_MONTHS = (
    "",
    "Ian",
    "Feb",
    "Mar",
    "Apr",
    "Mai",
    "Iun",
    "Iul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
STATIC_CACHE_SUFFIXES = {".css", ".js", ".svg", ".png", ".webmanifest"}


class RestoreTargetNotEmptyError(Exception):
    pass


def cache_control_for_path(raw_path: str) -> str | None:
    path = urlparse(raw_path).path
    if path.startswith("/api/"):
        return "no-store"
    if path == "/service-worker.js":
        return "no-cache, no-store, must-revalidate"
    if path.endswith(".html"):
        return "no-cache, must-revalidate"
    if Path(path).suffix in STATIC_CACHE_SUFFIXES:
        return "no-cache, must-revalidate"
    return None


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
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
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
                CREATE TABLE IF NOT EXISTS app_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
                """
            )
            ensure_registration_columns(connection)
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_registrations_event_week_created
                ON registrations (event_key, week_key, created_at, id)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS registration_rate_limits (
                    id BIGSERIAL PRIMARY KEY,
                    ip_hash TEXT NOT NULL,
                    event_key TEXT NOT NULL,
                    week_key TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_event_week_created
                ON registration_rate_limits (ip_hash, event_key, week_key, created_at)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_rate_limits_created
                ON registration_rate_limits (created_at)
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
                CREATE TABLE IF NOT EXISTS app_settings (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )
                """
            )
            ensure_registration_columns(connection)
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_registrations_event_week_created
                ON registrations (event_key, week_key, created_at, id)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS registration_rate_limits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ip_hash TEXT NOT NULL,
                    event_key TEXT NOT NULL,
                    week_key TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_event_week_created
                ON registration_rate_limits (ip_hash, event_key, week_key, created_at)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_rate_limits_created
                ON registration_rate_limits (created_at)
                """
            )
            connection.commit()

    set_setting("signup_mode", "auto", only_if_missing=True)
    set_setting("signup_mode_wednesday", "auto", only_if_missing=True)


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
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN IF NOT EXISTS event_key TEXT NOT NULL DEFAULT 'friday'
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
    if "event_key" not in existing_columns:
        connection.execute(
            """
            ALTER TABLE registrations
            ADD COLUMN event_key TEXT NOT NULL DEFAULT 'friday'
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


def normalize_event(value: str | None) -> str:
    event_key = str(value or FRIDAY_EVENT).strip().lower()
    if event_key not in EVENT_KEYS:
        return FRIDAY_EVENT
    return event_key


def signup_setting_key(event_key: str) -> str:
    return "signup_mode_wednesday" if normalize_event(event_key) == WEDNESDAY_EVENT else "signup_mode"


def signup_mode(event_key: str = FRIDAY_EVENT) -> str:
    value = get_setting(signup_setting_key(event_key), "auto").lower()
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


def format_romanian_date(moment: datetime, include_time: bool = False) -> str:
    formatted = f"{moment.day:02d} {ROMANIAN_MONTHS[moment.month]} {moment.year}"
    return f"{formatted} {moment:%H:%M}" if include_time else formatted


def week_label_from_key(week_key: str, event_key: str = FRIDAY_EVENT) -> str:
    year_text, week_text = week_key.split("-W")
    match_day = 3 if normalize_event(event_key) == WEDNESDAY_EVENT else 5
    match_date = datetime.fromisocalendar(int(year_text), int(week_text), match_day).replace(
        tzinfo=APP_TIMEZONE
    )
    return format_romanian_date(match_date)


def signup_window_for_week(
    week_key: str,
    event_key: str = FRIDAY_EVENT,
) -> tuple[datetime, datetime]:
    year_text, week_text = week_key.split("-W")
    if normalize_event(event_key) == WEDNESDAY_EVENT:
        start = datetime.fromisocalendar(int(year_text), int(week_text), 1).replace(
            hour=19,
            minute=30,
            second=0,
            microsecond=0,
            tzinfo=APP_TIMEZONE,
        )
        end = datetime.fromisocalendar(int(year_text), int(week_text), 3).replace(
            hour=19,
            minute=30,
            second=0,
            microsecond=0,
            tzinfo=APP_TIMEZONE,
        )
        return start, end

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


def signup_window_payload(
    now: datetime | None = None,
    event_key: str = FRIDAY_EVENT,
) -> dict[str, object]:
    event_key = normalize_event(event_key)
    current_time = now or datetime.now(APP_TIMEZONE)
    week_key = current_week_key(current_time)
    start, end = signup_window_for_week(week_key, event_key)
    schedule_open = start <= current_time < end if event_key == WEDNESDAY_EVENT else start <= current_time <= end
    current_mode = signup_mode(event_key)
    if current_mode == "force_open":
        is_open = True
    elif current_mode == "force_closed":
        is_open = False
    else:
        is_open = schedule_open

    if current_time < start:
        next_open = start
    else:
        next_week_time = current_time + timedelta(days=7)
        next_open, _ = signup_window_for_week(current_week_key(next_week_time), event_key)

    if current_mode == "force_closed":
        message = "Înscrierile sunt oprite manual de administrator."
    elif current_mode == "force_open":
        message = "Înscrierile sunt deschise manual de administrator."
    elif is_open and event_key == WEDNESDAY_EVENT:
        message = "Înscrierile sunt deschise acum, de luni la 19:30 până miercuri la 19:30."
    elif is_open:
        message = "Înscrierile sunt deschise acum, de joi la 11:59 până vineri la 23:59."
    elif current_time < start:
        if event_key == WEDNESDAY_EVENT:
            message = (
                f"Înscrierile se deschid luni la 19:30. Fereastra pentru această săptămână "
                f"începe pe {format_romanian_date(start, include_time=True)}."
            )
        else:
            message = (
                f"Înscrierile se deschid joi la 11:59. Fereastra pentru această săptămână începe pe "
                f"{format_romanian_date(start, include_time=True)}."
            )
    else:
        next_week_time = current_time + timedelta(days=7)
        next_start, _ = signup_window_for_week(current_week_key(next_week_time), event_key)
        if event_key == WEDNESDAY_EVENT:
            message = (
                f"Fereastra curentă s-a închis miercuri la 19:30. Următoarea deschidere este luni, pe "
                f"{format_romanian_date(next_start, include_time=True)}."
            )
        else:
            message = (
                f"Fereastra curentă s-a închis vineri la 23:59. Următoarea deschidere este joi, pe "
                f"{format_romanian_date(next_start, include_time=True)}."
            )

    return {
        "isOpen": is_open,
        "scheduleOpen": schedule_open,
        "mode": current_mode,
        "message": message,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "nextOpen": next_open.isoformat(),
        "serverNow": current_time.isoformat(),
        "timezone": "Europe/Bucharest",
        "event": event_key,
    }


def sanitize_names(payload: dict[str, object]) -> list[str]:
    raw_names = [payload.get("person1", ""), payload.get("person2", "")]
    names: list[str] = []
    for value in raw_names[:MAX_NAMES_PER_SUBMISSION]:
        cleaned = str(value).strip()
        if cleaned:
            names.append(cleaned)
    return names


def client_ip_from_request(headers, client_address: object = None) -> str:
    forwarded_for = str(headers.get("X-Forwarded-For", ""))
    candidates = [forwarded_for.split(",", 1)[0].strip()]
    if isinstance(client_address, (tuple, list)) and client_address:
        candidates.append(str(client_address[0]).strip())
    elif client_address:
        candidates.append(str(client_address).strip())

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return ipaddress.ip_address(candidate).compressed
        except ValueError:
            continue
    return "unknown"


def hash_client_ip(client_ip: str) -> str:
    secret = RATE_LIMIT_SECRET or "football-attendance-local-rate-limit"
    return hmac.new(secret.encode("utf-8"), client_ip.encode("utf-8"), sha256).hexdigest()


def rate_limit_retry_after_week(now: datetime) -> int:
    local_now = now.astimezone(APP_TIMEZONE) if now.tzinfo else now.replace(tzinfo=APP_TIMEZONE)
    next_week = (local_now + timedelta(days=8 - local_now.isoweekday())).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    return max(1, math.ceil((next_week - local_now).total_seconds()))


def fetch_registrations(
    week_key: str,
    event_key: str = FRIDAY_EVENT,
) -> list[dict[str, object]]:
    event_key = normalize_event(event_key)
    with get_connection() as connection:
        if using_postgres():
            rows = connection.execute(
                """
                SELECT id, submitted_name, created_at, preferred_role, assigned_team
                FROM registrations
                WHERE week_key = %s AND event_key = %s
                ORDER BY created_at ASC, id ASC
                """,
                (week_key, event_key),
            ).fetchall()
        else:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                """
                SELECT id, submitted_name, created_at, preferred_role, assigned_team
                FROM registrations
                WHERE week_key = ? AND event_key = ?
                ORDER BY datetime(created_at) ASC, id ASC
                """,
                (week_key, event_key),
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


def build_registration_backup(
    week_key: str,
    event_key: str = FRIDAY_EVENT,
) -> dict[str, object]:
    event_key = normalize_event(event_key)
    return {
        "backupVersion": 1,
        "eventKey": event_key,
        "weekKey": week_key,
        "weekLabel": week_label_from_key(week_key, event_key),
        "exportedAt": datetime.now(APP_TIMEZONE).isoformat(),
        "registrations": fetch_registrations(week_key, event_key),
    }


def parse_registration_backup(
    payload: dict[str, object],
    expected_week_key: str,
    expected_event_key: str | None = None,
) -> tuple[str, list[dict[str, object]]]:
    if payload.get("backupVersion") != 1:
        raise ValueError("Fișierul de backup nu are o versiune acceptată.")

    raw_event_key = str(payload.get("eventKey", "")).strip().lower()
    if raw_event_key not in EVENT_KEYS:
        raise ValueError("Fișierul de backup nu conține un meci valid.")
    if expected_event_key is not None and raw_event_key != normalize_event(expected_event_key):
        raise ValueError("Backupul aparține celeilalte zile de fotbal.")
    if str(payload.get("weekKey", "")) != expected_week_key:
        raise ValueError("Backupul nu aparține săptămânii curente.")

    raw_registrations = payload.get("registrations")
    if not isinstance(raw_registrations, list) or not raw_registrations:
        raise ValueError("Fișierul de backup nu conține înscrieri.")
    if len(raw_registrations) > 200:
        raise ValueError("Fișierul de backup conține prea multe înscrieri.")

    registrations: list[dict[str, object]] = []
    previous_created_at: datetime | None = None
    for expected_position, raw_registration in enumerate(raw_registrations, start=1):
        if not isinstance(raw_registration, dict):
            raise ValueError("Fișierul de backup conține o înscriere invalidă.")

        try:
            position = int(raw_registration.get("position", 0))
        except (TypeError, ValueError) as error:
            raise ValueError("Ordinea înscrierilor din backup este invalidă.") from error
        if position != expected_position:
            raise ValueError("Ordinea înscrierilor din backup este invalidă.")

        name = str(raw_registration.get("name", "")).strip()
        if not name or len(name) > 80:
            raise ValueError("Backupul conține un nume invalid.")

        created_at_text = str(raw_registration.get("createdAt", "")).strip()
        try:
            created_at = datetime.strptime(created_at_text, "%Y-%m-%d %H:%M:%S")
        except ValueError as error:
            raise ValueError("Backupul conține o dată de înscriere invalidă.") from error
        if previous_created_at is not None and created_at < previous_created_at:
            raise ValueError("Ordinea înscrierilor din backup este invalidă.")
        previous_created_at = created_at

        role = normalize_role(raw_registration.get("role"))
        raw_team = raw_registration.get("team")
        if raw_team is None or raw_event_key == WEDNESDAY_EVENT:
            team = None
        else:
            try:
                team = int(raw_team)
            except (TypeError, ValueError) as error:
                raise ValueError("Backupul conține o echipă invalidă.") from error
            if team not in range(1, TEAM_COUNT + 1):
                raise ValueError("Backupul conține o echipă invalidă.")

        registrations.append(
            {
                "name": name,
                "createdAt": created_at,
                "role": role,
                "team": team,
            }
        )

    return raw_event_key, registrations


def restore_registration_backup(
    registrations: list[dict[str, object]],
    week_key: str,
    event_key: str,
) -> int:
    event_key = normalize_event(event_key)
    with get_connection() as connection:
        if using_postgres():
            connection.execute("LOCK TABLE registrations IN SHARE ROW EXCLUSIVE MODE")
            existing_count = connection.execute(
                "SELECT COUNT(*) FROM registrations WHERE week_key = %s AND event_key = %s",
                (week_key, event_key),
            ).fetchone()[0]
        else:
            connection.execute("BEGIN IMMEDIATE")
            existing_count = connection.execute(
                "SELECT COUNT(*) FROM registrations WHERE week_key = ? AND event_key = ?",
                (week_key, event_key),
            ).fetchone()[0]

        if existing_count:
            raise RestoreTargetNotEmptyError

        for registration in registrations:
            created_at = registration["createdAt"]
            if using_postgres():
                connection.execute(
                    """
                    INSERT INTO registrations (
                        submitted_name,
                        created_at,
                        week_key,
                        event_key,
                        preferred_role,
                        assigned_team
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        registration["name"],
                        created_at,
                        week_key,
                        event_key,
                        registration["role"],
                        registration["team"],
                    ),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO registrations (
                        submitted_name,
                        created_at,
                        week_key,
                        event_key,
                        preferred_role,
                        assigned_team
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        registration["name"],
                        created_at.strftime("%Y-%m-%d %H:%M:%S"),
                        week_key,
                        event_key,
                        registration["role"],
                        registration["team"],
                    ),
                )

    return len(registrations)


def insert_registration_rows(
    connection,
    names: list[str],
    week_key: str,
    event_key: str,
    created_at: datetime,
) -> list[int]:
    inserted_ids: list[int] = []
    if using_postgres():
        for name in names:
            row = connection.execute(
                """
                INSERT INTO registrations (submitted_name, created_at, week_key, event_key)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (name, created_at, week_key, event_key),
            ).fetchone()
            inserted_ids.append(int(row[0]))
    else:
        for name in names:
            cursor = connection.execute(
                """
                INSERT INTO registrations (submitted_name, created_at, week_key, event_key)
                VALUES (?, ?, ?, ?)
                """,
                (name, created_at.strftime("%Y-%m-%d %H:%M:%S"), week_key, event_key),
            )
            inserted_ids.append(int(cursor.lastrowid))
    return inserted_ids


def insert_registrations(
    names: list[str],
    week_key: str,
    event_key: str = FRIDAY_EVENT,
) -> list[int]:
    event_key = normalize_event(event_key)
    created_at = datetime.now(APP_TIMEZONE).replace(microsecond=0, tzinfo=None)
    with get_connection() as connection:
        return insert_registration_rows(connection, names, week_key, event_key, created_at)


def insert_rate_limited_registrations(
    names: list[str],
    week_key: str,
    event_key: str,
    ip_hash: str,
    now: datetime | None = None,
) -> tuple[list[int], dict[str, object] | None]:
    event_key = normalize_event(event_key)
    current_time = now or datetime.now(APP_TIMEZONE)
    if current_time.tzinfo:
        current_time = current_time.astimezone(APP_TIMEZONE)
    else:
        current_time = current_time.replace(tzinfo=APP_TIMEZONE)
    created_at = current_time.replace(microsecond=0, tzinfo=None)
    recent_cutoff = created_at - REGISTRATION_SHORT_WINDOW
    retention_cutoff = created_at - RATE_LIMIT_RETENTION

    with get_connection() as connection:
        if using_postgres():
            lock_key = f"{ip_hash}:{event_key}:{week_key}"
            connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock_key,))
            connection.execute(
                "DELETE FROM registration_rate_limits WHERE created_at < %s",
                (retention_cutoff,),
            )
            rows = connection.execute(
                """
                SELECT created_at
                FROM registration_rate_limits
                WHERE ip_hash = %s AND event_key = %s AND week_key = %s
                ORDER BY created_at ASC
                """,
                (ip_hash, event_key, week_key),
            ).fetchall()
        else:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM registration_rate_limits WHERE created_at < ?",
                (retention_cutoff.strftime("%Y-%m-%d %H:%M:%S"),),
            )
            rows = connection.execute(
                """
                SELECT created_at
                FROM registration_rate_limits
                WHERE ip_hash = ? AND event_key = ? AND week_key = ?
                ORDER BY datetime(created_at) ASC
                """,
                (ip_hash, event_key, week_key),
            ).fetchall()

        submission_times = [
            row[0] if isinstance(row[0], datetime) else datetime.fromisoformat(str(row[0]))
            for row in rows
        ]
        if len(submission_times) >= REGISTRATION_WEEKLY_LIMIT:
            return [], {
                "reason": "weekly",
                "retryAfter": rate_limit_retry_after_week(current_time),
            }

        recent_submissions = [created for created in submission_times if created > recent_cutoff]
        if len(recent_submissions) >= REGISTRATION_SHORT_LIMIT:
            available_at = recent_submissions[0] + REGISTRATION_SHORT_WINDOW
            retry_after = max(1, math.ceil((available_at - created_at).total_seconds()))
            return [], {"reason": "short", "retryAfter": retry_after}

        inserted_ids = insert_registration_rows(
            connection,
            names,
            week_key,
            event_key,
            created_at,
        )
        if using_postgres():
            connection.execute(
                """
                INSERT INTO registration_rate_limits (ip_hash, event_key, week_key, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (ip_hash, event_key, week_key, created_at),
            )
        else:
            connection.execute(
                """
                INSERT INTO registration_rate_limits (ip_hash, event_key, week_key, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (ip_hash, event_key, week_key, created_at.strftime("%Y-%m-%d %H:%M:%S")),
            )
        return inserted_ids, None


def update_registration_role(registration_id: int, role: str) -> int:
    normalized_role = normalize_role(role)
    with get_connection() as connection:
        if using_postgres():
            updated = connection.execute(
                """
                UPDATE registrations
                SET preferred_role = %s
                WHERE id = %s AND event_key = %s
                """,
                (normalized_role, registration_id, FRIDAY_EVENT),
            ).rowcount
        else:
            updated = connection.execute(
                """
                UPDATE registrations
                SET preferred_role = ?
                WHERE id = ? AND event_key = ?
                """,
                (normalized_role, registration_id, FRIDAY_EVENT),
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
                WHERE week_key = %s AND event_key = %s
                """,
                (week_key, FRIDAY_EVENT),
            ).rowcount
        else:
            updated = connection.execute(
                """
                UPDATE registrations
                SET assigned_team = NULL
                WHERE week_key = ? AND event_key = ?
                """,
                (week_key, FRIDAY_EVENT),
            ).rowcount
            connection.commit()
    return updated


def generate_balanced_teams(week_key: str) -> list[dict[str, object]]:
    registrations = fetch_registrations(week_key, FRIDAY_EVENT)
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
                WHERE week_key = %s AND event_key = %s
                """,
                (week_key, FRIDAY_EVENT),
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
                WHERE week_key = ? AND event_key = ?
                """,
                (week_key, FRIDAY_EVENT),
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

    return build_team_payload(fetch_registrations(week_key, FRIDAY_EVENT))


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


def delete_registrations(
    week_key: str | None = None,
    event_key: str | None = None,
) -> int:
    normalized_event = normalize_event(event_key) if event_key is not None else None
    with get_connection() as connection:
        if using_postgres():
            if week_key is None and normalized_event is None:
                deleted = connection.execute("DELETE FROM registrations").rowcount
            elif week_key is None:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE event_key = %s",
                    (normalized_event,),
                ).rowcount
            elif normalized_event is None:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = %s",
                    (week_key,),
                ).rowcount
            else:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = %s AND event_key = %s",
                    (week_key, normalized_event),
                ).rowcount
        else:
            if week_key is None and normalized_event is None:
                deleted = connection.execute("DELETE FROM registrations").rowcount
            elif week_key is None:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE event_key = ?",
                    (normalized_event,),
                ).rowcount
            elif normalized_event is None:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = ?",
                    (week_key,),
                ).rowcount
            else:
                deleted = connection.execute(
                    "DELETE FROM registrations WHERE week_key = ? AND event_key = ?",
                    (week_key, normalized_event),
                ).rowcount
            connection.commit()
    return deleted


def delete_registration_by_id(
    registration_id: int,
    event_key: str = FRIDAY_EVENT,
) -> int:
    event_key = normalize_event(event_key)
    with get_connection() as connection:
        if using_postgres():
            deleted = connection.execute(
                "DELETE FROM registrations WHERE id = %s AND event_key = %s",
                (registration_id, event_key),
            ).rowcount
        else:
            deleted = connection.execute(
                "DELETE FROM registrations WHERE id = ? AND event_key = ?",
                (registration_id, event_key),
            ).rowcount
            connection.commit()
    return deleted


def cleanup_wednesday_registrations(now: datetime | None = None) -> int:
    moment = now or datetime.now(APP_TIMEZONE)
    week_key = current_week_key(moment)
    include_current_week = moment.isoweekday() == 7
    operator = "<=" if include_current_week else "<"

    with get_connection() as connection:
        placeholder = "%s" if using_postgres() else "?"
        deleted = connection.execute(
            f"DELETE FROM registrations WHERE event_key = {placeholder} AND week_key {operator} {placeholder}",
            (WEDNESDAY_EVENT, week_key),
        ).rowcount
    return deleted


def event_from_query(query: str) -> str:
    params = parse_qs(query)
    return normalize_event(params.get("event", [FRIDAY_EVENT])[0])


def attendance_payload(
    event_key: str = FRIDAY_EVENT,
    week_key: str | None = None,
) -> dict[str, object]:
    event_key = normalize_event(event_key)
    active_week = week_key or current_week_key()
    registrations = fetch_registrations(active_week, event_key)
    return {
        "eventKey": event_key,
        "weekKey": active_week,
        "weekLabel": week_label_from_key(active_week, event_key),
        "greenLimit": GREEN_LIMIT,
        "signupWindow": signup_window_payload(event_key=event_key),
        "registrations": registrations,
        "teams": build_team_payload(registrations) if event_key == FRIDAY_EVENT else [],
        "roleOptions": [
            {"value": value, "label": label} for value, label in ROLE_LABELS.items()
        ],
    }


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

    def end_headers(self) -> None:
        cache_control = cache_control_for_path(self.path)
        if cache_control:
            self.send_header("Cache-Control", cache_control)
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/registrations":
            cleanup_wednesday_registrations()
            params = parse_qs(parsed.query)
            week_key = params.get("week", [current_week_key()])[0]
            event_key = normalize_event(params.get("event", [FRIDAY_EVENT])[0])
            self.send_json(attendance_payload(event_key, week_key))
            return
        if parsed.path == "/api/admin/status":
            self.send_json(
                {
                    "enabled": bool(ADMIN_PASSWORD),
                    "authenticated": is_admin_authenticated(self.headers.get("Cookie")),
                }
            )
            return
        if parsed.path == "/api/admin/backup-week":
            self.handle_admin_backup_week(event_from_query(parsed.query))
            return
        if parsed.path in {"/echipe", "/teams"}:
            self.path = "/teams.html"
            return super().do_GET()
        if parsed.path in {"/", "/miercuri", "/miercuri/", "/wednesday", "/wednesday/"}:
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/admin/login":
            self.handle_admin_login()
            return
        if parsed.path == "/api/admin/clear-week":
            self.handle_admin_clear(current_week_key(), event_from_query(parsed.query))
            return
        if parsed.path == "/api/admin/clear-all":
            self.handle_admin_clear(None, event_from_query(parsed.query))
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
        if parsed.path == "/api/admin/restore-week":
            self.handle_admin_restore_week(event_from_query(parsed.query))
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
                {"error": "Completează cel puțin un nume."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        cleanup_wednesday_registrations()
        event_key = normalize_event(str(payload.get("event", FRIDAY_EVENT)))
        request_time = datetime.now(APP_TIMEZONE)
        signup_window = signup_window_payload(now=request_time, event_key=event_key)
        if not signup_window["isOpen"]:
            self.send_json(
                {
                    "error": signup_window["message"],
                    "signupWindow": signup_window,
                },
                status=HTTPStatus.FORBIDDEN,
            )
            return

        week_key = current_week_key(request_time)
        client_ip = client_ip_from_request(
            self.headers,
            getattr(self, "client_address", None),
        )
        submitted_registration_ids, rate_limit = insert_rate_limited_registrations(
            names,
            week_key,
            event_key,
            hash_client_ip(client_ip),
            now=request_time,
        )
        if rate_limit:
            retry_after = int(rate_limit["retryAfter"])
            if rate_limit["reason"] == "weekly":
                error = (
                    "Ai atins limita de 8 înscrieri pentru acest meci în săptămâna curentă."
                )
            else:
                retry_minutes = max(1, math.ceil(retry_after / 60))
                error = (
                    "Ai trimis deja 3 înscrieri în ultimele 10 minute. "
                    f"Încearcă din nou în aproximativ {retry_minutes} minute."
                )
            self.send_json(
                {
                    "error": error,
                    "retryAfter": retry_after,
                    "signupWindow": signup_window,
                },
                status=HTTPStatus.TOO_MANY_REQUESTS,
                headers={"Retry-After": str(retry_after)},
            )
            return

        response = attendance_payload(event_key, week_key)
        response["message"] = "Înscrierea a fost salvată."
        response["submittedRegistrationIds"] = submitted_registration_ids
        response["signupWindow"] = signup_window
        self.send_json(response, status=HTTPStatus.CREATED)

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
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        payload = self.read_json_body()
        if payload is None:
            return

        password = str(payload.get("password", ""))
        if not hmac.compare_digest(password, ADMIN_PASSWORD):
            self.send_json(
                {"error": "Parola de administrator este incorectă."},
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
        body = json.dumps({"message": "Autentificare reușită."}).encode("utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_admin_clear(
        self,
        week_key: str | None,
        event_key: str = FRIDAY_EVENT,
    ) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        event_key = normalize_event(event_key)
        deleted = delete_registrations(week_key, event_key)
        response = attendance_payload(event_key)
        response.update({
            "deleted": deleted,
            "authenticated": True,
            "message": (
                f"Au fost șterse {deleted} înscrieri din săptămâna curentă."
                if week_key
                else f"Au fost șterse {deleted} înscrieri din istoricul acestui meci."
            ),
        })
        self.send_json(response)

    def handle_admin_backup_week(self, event_key: str = FRIDAY_EVENT) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        event_key = normalize_event(event_key)
        active_week = current_week_key()
        filename = f"football-attendance-{event_key}-{active_week}.json"
        self.send_json(
            build_registration_backup(active_week, event_key),
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    def handle_admin_restore_week(self, expected_event_key: str = FRIDAY_EVENT) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        payload = self.read_json_body()
        if payload is None:
            return

        active_week = current_week_key()
        try:
            event_key, registrations = parse_registration_backup(
                payload,
                active_week,
                expected_event_key,
            )
            restored = restore_registration_backup(registrations, active_week, event_key)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        except RestoreTargetNotEmptyError:
            self.send_json(
                {
                    "error": (
                        "Lista curentă nu este goală. Backupul nu a fost importat pentru a evita "
                        "dublarea sau suprascrierea înscrierilor."
                    )
                },
                status=HTTPStatus.CONFLICT,
            )
            return

        response = attendance_payload(event_key, active_week)
        response.update(
            {
                "authenticated": True,
                "restored": restored,
                "message": f"Au fost restaurate {restored} înscrieri în ordinea salvată.",
            }
        )
        self.send_json(response, status=HTTPStatus.CREATED)

    def handle_admin_signup_mode(self) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
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

        event_key = normalize_event(str(payload.get("event", FRIDAY_EVENT)))
        set_setting(signup_setting_key(event_key), mode)
        active_week = current_week_key()
        response = attendance_payload(event_key, active_week)
        response.update(
            {
                "authenticated": True,
                "mode": mode,
                "message": {
                    "force_closed": "Formularul a fost închis manual.",
                    "force_open": "Formularul a fost deschis manual.",
                    "auto": "Formularul a revenit la programul automat.",
                }[mode],
            }
        )
        self.send_json(response)

    def handle_admin_delete_one(self) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
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
                {"error": "ID invalid pentru înscriere."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        event_key = normalize_event(str(payload.get("event", FRIDAY_EVENT)))
        deleted = delete_registration_by_id(registration_id, event_key)
        if deleted == 0:
            self.send_json(
                {"error": "Înscrierea nu a fost găsită."},
                status=HTTPStatus.NOT_FOUND,
            )
            return

        active_week = current_week_key()
        response = attendance_payload(event_key, active_week)
        response.update(
            {
                "deleted": deleted,
                "authenticated": True,
                "message": "Înscrierea selectată a fost ștearsă.",
            }
        )
        self.send_json(response)

    def handle_admin_update_role(self) -> None:
        if not ADMIN_PASSWORD:
            self.send_json(
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
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
                {"error": "ID invalid pentru înscriere."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        role = normalize_role(str(payload.get("role", "any")))
        updated = update_registration_role(registration_id, role)
        if updated == 0:
            self.send_json(
                {"error": "Înscrierea nu a fost găsită."},
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
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

        active_week = current_week_key()
        registrations = fetch_registrations(active_week)
        confirmed_players = [row for row in registrations if row["status"] == "confirmed"]
        if len(confirmed_players) < TEAM_COUNT:
            self.send_json(
                {"error": "Ai nevoie de cel puțin 3 jucători confirmați pentru a genera echipe."},
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
                {"error": "Panoul de administrare nu este configurat."},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        if not is_admin_authenticated(self.headers.get("Cookie")):
            self.send_json(
                {"error": "Autentificare necesară."},
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

    def send_json(
        self,
        payload: dict[str, object],
        status: HTTPStatus = HTTPStatus.OK,
        headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        for header, value in (headers or {}).items():
            self.send_header(header, value)
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
