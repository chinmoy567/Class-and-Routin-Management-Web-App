# Deploying on Render (free)

One free Render web service runs the Express server and serves the built React client (same origin, so session cookies and CSRF work unchanged). MongoDB is external.

## Limits of the free tier, and what we do about them

| Limit | Effect | What we do |
| --- | --- | --- |
| Sleeps after 15 minutes without traffic | First visit waits about 50 seconds. Socket.IO drops and Agenda jobs stop while asleep. | An external pinger hits `/api/health` every 5 minutes (below). |
| 750 free hours a month | One always-on service uses about 720. | Run only this one service on the account. |
| No database or disk | Sessions, jobs and GridFS need MongoDB. | MongoDB Atlas M0 (free, replica set, 512 MB). |
| 512 MB RAM, no sidecar containers | ClamAV cannot run. | `UPLOADS_ENABLED=false` turns off every upload: profile photo, chat files and the routine `.xlsx` import. These routes answer `503 UPLOADS_DISABLED`. |

## Steps

1. **Atlas.** Create a free M0 cluster. Add a database user. Under Network Access allow `0.0.0.0/0` (Render free has no fixed IP). Copy the `mongodb+srv://...` string and put a database name in it, for example `/crm`.
2. **Secrets.** Generate them once and keep them outside git:
   - `DATA_ENC_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `EMAIL_HMAC_KEY` and `FILE_LINK_KEY`: any long random strings.
   - Losing `DATA_ENC_KEY` or `EMAIL_HMAC_KEY` makes stored emails and phones unreadable. Back them up.
3. **Render.** New, then Blueprint, then pick this repo. `render.yaml` creates the service. Fill the prompted variables: `MONGO_URL`, `DATA_ENC_KEY`, `EMAIL_HMAC_KEY`, `FILE_LINK_KEY`, `SMTP_*`, `MAIL_FROM`, `OPS_ALERT_EMAIL`.
4. **`APP_URL`.** After the first deploy, set it to the service URL (`https://<name>.onrender.com`) and redeploy. Email links use it.
5. **First super admin.** In the service's Shell tab (or from your own machine with `MONGO_URL` pointing at Atlas): `npm run seed:super-admin -- --email <e> --name <n>`.
6. **Keep it awake.** Create a free monitor at UptimeRobot or cron-job.org: HTTP GET `https://<name>.onrender.com/api/health`, every 5 minutes. `/api/health` also checks MongoDB.

## Notes

- Node is pinned to 24.22.2 through `NODE_VERSION` (24.15.0 crashes on some platforms).
- The build installs dev dependencies (`npm ci --include=dev`) because Vite is needed to build the client.
- Only the sleep problem is solved by the pinger. Render free can still restart the service at any time; sessions are in MongoDB, so users stay signed in.
- To turn uploads back on later, host ClamAV elsewhere, set `CLAMAV_HOST`/`CLAMAV_PORT` and `UPLOADS_ENABLED=true`.
