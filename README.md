# Football Attendance

Weekly football attendance app with separate Friday and Wednesday signup lists, admin controls, and a dedicated Friday team-builder view for creating 3 balanced teams from the first 18 confirmed players.

## Preview

![Football Attendance Preview](docs/attendance-preview.png)

## What It Does

- public weekly signup form with up to 2 names per submission
- separate public lists and automatic match dates for Friday and Wednesday
- event-specific venue links that open the correct destination in Google Maps
- distinct blue Friday and green pitch-inspired Wednesday visual themes
- live countdown to the next opening or current closing time
- adaptive layout that prioritizes signup while open and the roster while closed
- detailed confirmation showing each submitted player's position and status
- one private management link per submission, saved in the browser and shareable with the second player
- per-player withdrawal with confirmation and automatic waiting-list promotion
- inactive cancellation audit history for authenticated admins
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
  - clear all historical registrations
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
- `/inscriere/<private-token>` - private management page created after a new submission

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
- review self-withdrawn registrations as inactive audit rows
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

Withdrawn rows stay in the database as inactive audit records. Public ordering ignores
inactive rows, so the first waiting player moves automatically into the first 18. Existing
rows created before this feature have no token and remain removable only by an admin.

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
- active/inactive state and withdrawal timestamp

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
  and management-token hashes are preserved
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
- cancellation rate limiting and inactive admin audit visibility
- backup restoration of management-token hashes and inactive state

Frontend coverage includes:

- initial dashboard rendering
- signup form behavior
- detailed multi-player success feedback
- browser persistence and display of private management links
- authoritative countdown rendering
- offline cached-list fallback
- Wednesday route copy and event-aware requests
- admin backup restore behavior
- locked state behavior
- accessibility and responsive UI contracts
- manifest and service-worker app-shell validation
- team-builder rendering
- team generation refresh behavior

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
```

## Project Structure

- [server.py](server.py) - API, storage, admin logic, routing
- [static/index.html](static/index.html) - main attendance page
- [static/app.js](static/app.js) - main page behavior
- [static/manage.html](static/manage.html) - private registration-management page
- [static/manage.js](static/manage.js) - private-link loading, copying, and withdrawal behavior
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
