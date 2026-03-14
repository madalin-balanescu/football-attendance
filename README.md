# Football Attendance App

Small web app for weekly football attendance:

- signup form with up to 2 names per submission
- SQLite database persistence
- automatic weekly grouping
- first 18 registrations highlighted in green
- later registrations highlighted in yellow

## Run locally

```bash
python3 server.py
```

Then open [http://localhost:8000](http://localhost:8000).

## Project structure

- `server.py` - HTTP server, API, SQLite logic
- `static/index.html` - page layout
- `static/styles.css` - styling
- `static/app.js` - form submit + live table refresh
- `data/attendance.db` - SQLite database created automatically on first run

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

- Render free instances can sleep when unused.
- The SQLite database is stored on the server filesystem, so on free hosting it may be reset on redeploy or instance replacement.

## Better database for production

If you want the data to stay safe long term, the next upgrade should be:

- deploy the app on Render or Railway
- move the database from SQLite to PostgreSQL

If you want, I can make that upgrade next so the app is properly production-ready.
