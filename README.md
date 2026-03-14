# Football Attendance App

Small web app for weekly football attendance:

- signup form with up to 2 names per submission
- PostgreSQL on Render, with SQLite fallback for local development
- automatic weekly grouping
- first 18 registrations highlighted in green
- later registrations highlighted in yellow

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

Then open [http://localhost:8000](http://localhost:8000).

## Project structure

- `server.py` - HTTP server, API, SQLite logic
- `requirements.txt` - Python dependencies
- `static/index.html` - page layout
- `static/styles.css` - styling
- `static/app.js` - form submit + live table refresh
- `data/attendance.db` - SQLite fallback database for local development only

## Make it available from anywhere

You can deploy this app on a small VPS or on a platform that supports Python web apps.

Simple options:

- Render
- Railway
- Fly.io
- a VPS with `python3 server.py` behind Nginx

## Publish on Render

This repo now includes `render.yaml`, so the easiest option is:

1. Create a GitHub repository and upload this project.
2. Go to [Render](https://render.com) and sign in.
3. Click `New +` -> `Blueprint`.
4. Connect your GitHub repo.
5. Render will detect `render.yaml` and create the web service.
6. After deploy finishes, you will get a public URL like `https://football-attendance.onrender.com`.

Important:

- Render free web services can sleep when unused.
- `render.yaml` now provisions a Render Postgres database and injects `DATABASE_URL` into the web service automatically.
- Local development still works without Postgres because the app falls back to SQLite if `DATABASE_URL` is not set.

## PostgreSQL migration notes

The app now prefers PostgreSQL whenever `DATABASE_URL` exists.

For your existing Render service:

1. Sync the updated `render.yaml` in Render.
2. Let Render create `football-attendance-db`.
3. Redeploy the web service.

Important:

- Existing data stored in the old SQLite file on Render will not be copied automatically into PostgreSQL.
- New signups after redeploy will go into Postgres.
