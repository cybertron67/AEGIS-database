# Hydra

Login-gated database for cases, warnings, blacklist and evidence images.
Node.js 22.13+ with its built-in SQLite. Two npm packages (express, multer), nothing to compile, no external services.

## Run it
    npm install
    ADMIN_USERNAME=YourRobloxUsername npm start
Open http://localhost:3000. Today's keys are printed in the console when the server starts
(and each time the day rolls over). Sign in with ADMIN_USERNAME + the **admin** key.

## How sign-in works
- Only usernames added under **Users** can sign in.
- A new random key is generated for each role every day (in the timezone set by `KEY_TZ`).
  Admins see and copy them under **Daily keys**; they can also generate a new one at any time
  or sign everyone out.
- The key someone enters decides their access level, but never above the role they were given:
  a member typing the admin key is rejected.
- Sessions end at midnight when the keys change.
- 8 wrong attempts in 10 minutes locks that IP / username out temporarily.

## Roles
| | Member | Admin |
|---|---|---|
| View cases, warnings, blacklist, images, lookup | yes | yes |
| Create cases, add notes, change case status/severity | yes | yes |
| Issue warnings, upload images | yes | yes |
| Add / remove blacklist entries | no | yes |
| Revoke or delete warnings, delete cases/images | no | yes |
| Manage users, see daily keys, audit log | no | yes |

## Deploy
This is a server with a database, so GitHub Pages / Netlify drop won't work.
The database and uploaded images live in DATA_DIR, so the host MUST give you a persistent disk;
otherwise everything is wiped on each redeploy.

### Easiest: Render (about 10 minutes)
1. Create a free GitHub account, make a new private repo, and upload this folder's contents
   (drag the files into the repo page; node_modules and data are git-ignored).
2. On render.com: New > Blueprint > connect that repo. It reads `render.yaml`
   (Starter instance + 1 GB disk) and asks for ADMIN_USERNAME. Enter your Roblox username.
3. Wait for the deploy, open your `*.onrender.com` address, then open the service Logs to read
   today's keys. Sign in with your username + the admin key. After that the Daily keys page shows them.
4. Optional: Settings > Custom Domains to use your own domain (HTTPS is automatic).
Free Render instances can't attach a disk, so use the paid Starter instance. Check render.com/pricing for current prices.

### Other hosts
- Any host that runs Docker (Fly.io, Railway, a VPS): use the included `Dockerfile` and mount a volume at `/data`.
- Plain VPS: install Node 22.13+, `npm install`, set the env vars from `.env.example`, run `npm start`
  behind Caddy or nginx for HTTPS.

Back up DATA_DIR (hydra.db + uploads/) regularly.

## Know the limits
- Keys are shared per role, and usernames aren't verified with Roblox. Anyone who has today's key
  and knows an allowed username can sign in as that person. Treat keys like passwords, share them
  privately, and use "Sign everyone out" if one leaks. Per-user keys or Roblox OAuth would be the next
  step if you need stronger identity.
- Always serve over HTTPS in production.

## Files
server.js (API + auth) · db.js (schema) · views/dashboard.html · public/ (login page, coin animation, dashboard JS/CSS)
