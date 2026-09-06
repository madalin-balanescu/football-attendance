# Football Attendance

Weekly football attendance app with separate Friday and Wednesday signup lists, browser-local player management, public withdrawal visibility, admin controls, and a Friday team builder for creating 3 balanced teams from the first 18 confirmed players.

## Preview

![Football Attendance Preview](docs/attendance-preview.png)

Current Friday dashboard with a populated roster and the public `Jucători retrași` shortcut.

## What It Does

- public weekly signup form with up to 2 names per submission
- separate public lists and automatic match dates for Friday and Wednesday
- event-specific venue links that open the correct destination in Google Maps
- distinct blue Friday and green pitch-inspired Wednesday visual themes
- adaptive layout that prioritizes signup while open and the roster while closed
- detailed confirmation showing each submitted player's position and status
- one day-specific `Înscrierea ta` view combining registrations saved in this browser
- private submission links remain available for sharing with the players in that submission
- per-player withdrawal with confirmation and automatic waiting-list promotion
- a separate mobile-friendly, public removal history for the current session
- installable PWA shell with offline UI and last-known-list fallback
- keyboard, reduced-motion, forced-color, and screen-reader accessibility support
- first 18 players marked as confirmed
- extra players placed on the waiting list
- database-backed registration rate limiting using hashed client IPs
- admin login protected by `ADMIN_PASSWORD`
- admin tools to:
  - force the form open, closed, or automatic
  - download and safely restore the selected current-week list
  - delete one registration
  - clear the current week
  - clear all registrations for the selected event
- dedicated `/echipe` page for:
  - assigning each confirmed player a preferred role
  - generating 3 balanced teams
  - resetting generated teams

## Main Routes

- `/` - Friday attendance page
- `/miercuri` - Wednesday attendance page
- `/wednesday` - alias for the Wednesday attendance page
- `/echipe` - team builder page
- `/teams` - alias for the team builder page
- `/inscrierile-mele?event=friday` or `?event=wednesday` - personal registrations for the selected day (`friday` by default)
- `/inscriere/<private-token>` - private management page created after a new submission
- `/istoric?event=friday` or `/istoric?event=wednesday` - current-session removal history (visible to everyone)

## Tech Stack

- Python standard-library HTTP server
- SQLite by default
- optional PostgreSQL support through `DATABASE_URL`
- plain HTML, CSS, and JavaScript on the frontend

## Local Development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ADMIN_PASSWORD="test123"
python3 server.py
```

Then open:

- [http://localhost:8000](http://localhost:8000)
- [http://localhost:8000/miercuri](http://localhost:8000/miercuri)
- [http://localhost:8000/echipe](http://localhost:8000/echipe)
- [http://localhost:8000/inscrierile-mele?event=friday](http://localhost:8000/inscrierile-mele?event=friday)
- [http://localhost:8000/istoric?event=friday](http://localhost:8000/istoric?event=friday)

## Environment Variables

- `ADMIN_PASSWORD`
  Enables admin access and signs the admin session cookie.

- `DATABASE_URL`
  If set, the app uses PostgreSQL.

- `RATE_LIMIT_SECRET`
  Signs anonymized client-IP hashes used by registration rate limiting. Render Blueprints
  generate this value automatically. For an existing manually configured service, add a
  long random value in the Render environment before deploying.

- `HOST`
  Defaults to `0.0.0.0`.

- `PORT`
  Defaults to `8000`.

## Admin Features

After setting `ADMIN_PASSWORD`, the admin panel becomes available in the UI.

Attendance page admin actions are scoped to the selected Friday or Wednesday event:

- force signup open
- force signup closed
- switch back to automatic window handling
- download the selected current-week list as JSON
- restore that JSON into an empty list for the same event and ISO week
- delete one row
- clear the current week
- clear all weeks for that event

Team-builder page admin actions:

- log in using the same admin session
- assign a role for each confirmed player:
  - `Atac`
  - `Mijloc`
  - `Apărare`
  - `Oriunde`
- generate 3 balanced teams
- reset generated teams

## Signup Rules

Friday automatic mode:

- signup opens every Thursday at `11:59`
- signup closes every Friday at `23:59`

Wednesday automatic mode:

- signup opens every Monday at `19:30`
- signup closes Wednesday at `19:30`, when the `19:30-21:30` match starts
- Wednesday registrations are removed on Sunday
- if Render sleeps through Sunday, cleanup runs before the first request in the new week

Outside each event's window, its form is locked. Friday and Wednesday admin overrides are stored independently.

Each client IP can submit at most:

- 3 registration forms per 10 minutes
- 8 registration forms per event in the current ISO week

A form containing two names counts as one submission. Limits are isolated between Friday
and Wednesday, stored in the configured database, and use one-way HMAC hashes instead of
raw IP addresses.

Every new public submission receives a cryptographically random private management token.
The raw token is returned once in the management URL and saved by the frontend in that
browser. SQLite/PostgreSQL stores only its SHA-256 hash. Both names in the same form share
the link but have separate `Retrage` actions. A withdrawal requires the private token,
registration ID, and explicit confirmation; names alone cannot remove a registration.
Cancellation attempts are limited to 5 per client IP in 10 minutes.

The saved-links panel shows a single `Vezi înscrierea` entry. It combines players from
saved submissions for the selected football day, with match dates and a separate withdrawal
action per player.
Both `Retrage-te` and `Vezi înscrierea` preserve Friday/Wednesday context; the return link
opens that same day's roster. The API response determines the day of each registration,
so outdated browser labels cannot mix players from different days.
On mobile, `Retrage-te` stays hidden until the current browser has saved at least one
registration link for the selected football day. The visible navigation actions divide
the available width evenly, using two columns without `Retrage-te` and three with it.
Existing saved links are included automatically, duplicate links/players are shown once,
and confirmed expired links are removed. Temporary network errors keep links for retry.
New saves no longer discard older links at a fixed ten-link limit.

This grouping uses the private links in the same browser, not a name, IP address, or login.
Each withdrawal still requires that player's original submission token. Sharing an original
private link grants access only to that submission. The combined page URL itself contains
no tokens and does not grant access on another browser; open the original private links
there to add those registrations. Links already lost from browser storage cannot be
reconstructed from player names. No new account or server-side identity is created.

Withdrawn rows remain inactive until the list resets. Both self-withdrawals and individual
organizer deletions write a removal record in the same database transaction. Public ordering
ignores inactive rows, so the first waiting player moves automatically into the first 18.
Existing rows created before private management links have no token and remain removable
only by an admin.

### Current-session removal history

The red `Jucători retrași` status pill beside `Primele 18` and `Lista de așteptare` opens a separate public page.
It shows the selected football day's current ISO week only, newest removals first, with
name, match date, signup time, removal time, and who removed the player. A source filter
separates organizer removals and voluntary withdrawals. Phone layouts show labeled cards.
Everyone can view history without logging in through `/api/removal-history`. Removal, reset,
backup, and restore controls retain their existing authorization requirements. History is
never stored in the offline cache, so outdated removals do not remain after a session reset.

The history follows the session lifecycle:

- individual organizer deletion and self-withdrawal add a record; repeated attempts do not duplicate it
- clearing the current week or all lists for an event also clears that event's corresponding history
- Wednesday's scheduled cleanup removes that week's roster and history on Sunday, Europe/Bucharest time
- cleanup runs when the roster, history, or public submission endpoint is requested; if no request arrives Sunday, the next week's first such request performs catch-up cleanup
- a new ISO week starts with empty removal history for both events; old Friday rosters retain their existing storage behavior, but old removal history expires

On startup, the app migrates surviving inactive self-withdrawals for the current week,
keeping their original timestamps. Unknown timestamps display as `Necunoscut`.
Organizer deletions and withdrawals already physically erased before this feature cannot
be reconstructed from the remaining database. The app does not invent missing records.

The current-week JSON backup includes removal history, even when no registrations remain.
Restore validates the same event/week and preserves removal identities, so removed players
stay removed and repeated history-only restores do not create duplicate records.
SQLite requires version 3.35 or newer for transactional `DELETE ... RETURNING`.

Admin can override this with:

- `force_open`
- `force_closed`
- `auto`

## Data Model

Registrations store:

- submitted name
- creation timestamp
- ISO week key
- event key (`friday` or `wednesday`)
- preferred role
- generated team assignment
- management-token hash (never the raw token)
- active/inactive state, withdrawal timestamp, and a stable removal key

Current-session removal records store the player name, registration timestamp, event/week,
removal timestamp (when known), and source (`organizer` or `self`). They contain no private
management tokens or token hashes.

App settings store:

- Friday signup mode
- Wednesday signup mode

Rate-limit records store:

- anonymized client-IP hash
- event and ISO week
- successful form submission timestamp
- anonymized client-IP hashes and timestamps for cancellation attempts

## Deployment

This repo includes [render.yaml](render.yaml), so the simplest deployment path is Render.
The included configuration uses SQLite and does not provision PostgreSQL.

### SQLite snapshot workflow on Render

Render's free web-service filesystem is temporary. Before every deploy:

1. Open the Friday or Wednesday page whose current list must be preserved.
2. Log in to the admin panel.
3. Select `Salvează lista curentă` and keep the downloaded JSON file.
4. Deploy the existing Render service.
5. Open the same football-day page and log in as admin again.
6. If the current list is empty, select `Restaurează lista salvată` and choose the JSON file.

Restore safety rules:

- the backup must belong to the same event and current ISO week
- the target list must be completely empty
- existing rows are never deleted, replaced, or merged
- player order, registration timestamps, roles, Friday team assignments, inactive audit state,
  management-token hashes, and current-session removal history are preserved
- backups never contain raw management tokens; restored private links continue to work through their hashes
- admin restores do not consume public submission rate limits

Initial deployment flow:

1. Push the repo to GitHub.
2. Create a Render Blueprint or manual web service.
3. Select this repository.
4. Add `ADMIN_PASSWORD` in the Render environment.
5. Add a long random `RATE_LIMIT_SECRET` when using a manually configured service.

## Tests

Backend coverage includes:

- signup window logic
- Friday and Wednesday list isolation
- Sunday cleanup and Monday catch-up
- database migration of existing rows to Friday
- registration validation
- short-window and weekly registration rate limits
- event isolation and anonymized IP storage for rate limits
- registration ordering
- admin authentication
- current-week backup export and guarded restore
- delete / clear actions
- role assignment
- team generation
- team reset
- private-link authentication and hash-only token storage
- confirmed-player withdrawal and waiting-list promotion
- cancellation rate limiting and public current-session history visibility
- transactional organizer/self removal history, migration, and rollback on history write failures
- session expiration, manual resets, and event isolation
- history-only backups and duplicate/conflicting removal identity validation
- backup restoration of management-token hashes and inactive state

Frontend coverage includes:

- initial dashboard rendering
- signup form behavior
- detailed multi-player success feedback
- browser persistence and one combined entry for saved private management links
- multiple-submission aggregation, token-scoped withdrawal, deduplication, expired-link cleanup, and partial-failure retry
- day-specific withdrawal shortcut visibility based on registrations saved in the current browser
- offline cached-list fallback
- Wednesday route copy and event-aware requests
- admin backup restore behavior
- locked state behavior
- accessibility and responsive UI contracts
- manifest and service-worker app-shell validation
- team-builder rendering
- team generation refresh behavior
- separate removal-history navigation, source filtering, escaped names, empty state, public access, and offline behavior

Run everything:

```bash
python3 -Wd -m unittest discover -s tests -v
node --test tests/test_frontend.js
```

Additional quick checks:

```bash
python3 -m py_compile server.py
node --check static/app.js
node --check static/manage.js
node --check static/teams.js
node --check static/history.js
node --check static/service-worker.js
```

## Project Structure

- [server.py](server.py) - API, storage, admin logic, routing
- [static/index.html](static/index.html) - main attendance page
- [static/app.js](static/app.js) - main page behavior
- [static/manage.html](static/manage.html) - private and combined registration-management page
- [static/manage.js](static/manage.js) - day-specific aggregation, private-link loading, and withdrawal behavior
- [static/history.html](static/history.html) and [static/history.js](static/history.js) - public current-session removal history
- [static/teams.html](static/teams.html) - dedicated team-builder page
- [static/teams.js](static/teams.js) - team-builder interactions
- [static/styles.css](static/styles.css) - shared styling
- [static/ui-enhancements.css](static/ui-enhancements.css) - adaptive layout, accessibility, and interaction styling
- [static/manifest.webmanifest](static/manifest.webmanifest) - installable app metadata
- [static/service-worker.js](static/service-worker.js) - offline app-shell caching
- [tests/test_server.py](tests/test_server.py) - backend integration tests
- [tests/test_ui_contract.py](tests/test_ui_contract.py) - static accessibility, responsive, and PWA contracts
- [tests/test_frontend.js](tests/test_frontend.js) - frontend script tests
- [tests/frontend_harness.js](tests/frontend_harness.js) - fake DOM test harness
- [render.yaml](render.yaml) - Render deployment config

## Notes

- the app uses SQLite unless `DATABASE_URL` is provided
- Render's free filesystem can reset on deploy, restart, or idle spin-down
- use the admin snapshot workflow whenever the current list must survive a Render reset
- snapshot restore is a recovery workflow, not persistent storage
