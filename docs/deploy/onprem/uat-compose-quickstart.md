# UAT clone stack quick start

This root Compose entrypoint starts the Sale-App frontend, API, and Caddy ingress on a Linux container host and targets only the pinned local UAT2 SQL Server clone. The default local ports are HTTP 8080 and HTTPS 8444 to avoid common host listeners; both are configurable in the root `.env`. Caddy uses a local CA for UAT TLS. This is not the production release path and does not prove business workflows.

## Host requirement

The images use Linux containers. The reported `no matching manifest for windows(10.0.20348)/amd64` error means the Docker CLI was reaching a Windows-container daemon. Run Compose from the Ubuntu WSL distribution against a Linux daemon. If you use Docker Desktop, enable **Settings → Resources → WSL Integration → Ubuntu**; Docker commands from Ubuntu then use Docker Desktop's Linux engine, and the containers appear in Docker Desktop. Select `Ubuntu` in the BAT, not Docker Desktop's internal `docker-desktop` distribution. Do not install a separate Docker Engine inside Ubuntu alongside Docker Desktop. Before continuing, verify the daemon type:

```bash
docker info --format '{{.OSType}}'
```

The result must be `linux`. If it says `windows`, stop and switch Docker Desktop to Linux containers or use the verified Linux daemon exposed to Ubuntu. Do not replace these images with Windows images. See [Docker Desktop WSL integration](https://docs.docker.com/desktop/features/wsl/) and [Microsoft WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands).

## First run

For the Windows launcher flow, copy `docker.env.example` to `.env` **in the repository root**, beside `docker-compose.yml`, and fill it with the WSL-to-Windows SQL endpoint, exact server identity, UAT2 database name, dedicated application login/password, browser origin, and a newly generated JWT secret. The `.env` inside `docs/deploy/onprem/` belongs to a separate office compose file and is not used by this UAT launcher. The BAT's option 2 creates `.env.migrator.local` from its template and opens it for the separate least-privileged migration login/password. Both local files are ignored by Git. If using the manual Ubuntu commands below instead, create and fill both files. Do not use `sa` in either container: the runtime and migration guards reject elevated logins.

```bash
cp docker.env.example .env
nano .env
cp docker.migrator.env.example .env.migrator.local
nano .env.migrator.local
```

Use separate passwords for the app and migrator logins. In either env file, put a value containing `$` inside single quotes so Compose treats it literally. Never show the resolved Compose config because it includes secret values.

Keep `APP_DOMAIN` set to the host name or IP used in the browser and `VITE_API_BASE_URL=/api`. With the defaults, use `HTTP_PORT=8080`, `HTTPS_PORT=8444`, and `CORS_ORIGIN=https://<APP_DOMAIN>:8444`. The wrapper checks the port mapping and CORS origin together. If ports 80/443 are free and you want them, set both ports to 80/443 and set `CORS_ORIGIN=https://<APP_DOMAIN>`; Caddy listens on the configured ports. Caddy's local CA can issue a UAT certificate for an internal host, but other computers will not trust it until the Caddy root CA is installed in their trust store. [Caddy local HTTPS and trust requirements](https://caddyserver.com/docs/running), [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

This machine's UAT target uses fixed TCP port `51433`: with Docker Desktop set `ONPREM_DB_SERVER=host.docker.internal`; with a separate native WSL Docker Engine use the verified Windows gateway IPv4 address reachable from its containers. Set `ONPREM_DB_PORT=51433`, leave `ONPREM_DB_INSTANCE` blank, and retain `ONPREM_DB_NAME=dbwins_worldfert9_uat2` and `ONPREM_EXPECTED_SERVERNAME=AMYOU-YOGA7\V2008R2`. A WSL gateway address is not necessarily reachable from Docker Desktop containers. The SQL administrator must already have configured the SQL listener and the narrowly scoped Windows firewall rule. This deploy script does not change SQL or firewall configuration.

After filling the app environment file and completing the one-time database principal setup below, run [`deploy-wsl.bat`](deploy-wsl.bat) from Windows. It presents a menu: option 1 opens the SQL setup file for you to run manually in SSMS; option 2 creates `.env.migrator.local` from the example if it is missing and opens it for editing; option 3 deploys or redeploys the stack. In option 2, set the migrator password to the same password assigned to `wf_local_uat_migrator` in SSMS. Before deploy, it displays WSL distributions registered for the current Windows account and asks for the exact distro name (default `Ubuntu`). The selected distro must be registered, usable, and running the Linux Docker Engine. The BAT locates the repository root and calls `wsl-deploy.sh` only after you choose option 3. The wrapper checks for the local Linux Docker Engine, validates that the resolved target is exactly UAT2 and that the two credentials are separated, builds the images, runs a read-only migration plan, automatically applies pending migrations for this pinned UAT target, then re-runs the plan and refuses to start the web stack if drift or pending migrations remain. The on-prem target guard now also requires `HAS_DBACCESS('dbwins_worldfert9') = 0` for both app and migrator identities; the wrapper stops before apply if either login can access the source-named production database. Repeated deploys are safe with respect to migrations already recorded in `wf.SchemaMigration`: unchanged migrations are skipped. SQL/migration output is kept out of the command window when the command fails; successful plan summaries and pending migration filenames are shown. The rendered Compose configuration and secrets are never printed. A failure after an apply is not a rollback: stop and inspect the database state before another attempt.

For troubleshooting only, inspect Compose from the repository root in Ubuntu WSL. Use the deploy wrapper to start/redeploy because plain `docker compose up` bypasses the migration plan/apply/verify sequence:

```bash
docker compose config --quiet
docker compose ps
```

The one-click script does not pull code or create/restore a database. Pull the intended code version before running. It is hard-pinned to `dbwins_worldfert9_uat2`; do not edit the guard to point it at production or another database.

HTTP on the configured port redirects to HTTPS on the configured TLS port. For this internal UAT, Caddy's local root CA must be trusted by each client browser/device; without that trust, HTTPS shows a certificate warning. WSL port forwarding normally makes services available to Windows at localhost; LAN access from other computers depends on the WSL networking mode and Windows firewall/forwarding configuration, which this script does not change. [Microsoft WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)

The API port is not published directly. Background workers and native coupon posting stay disabled in this UAT stack, and password change is enforced.

## One-time database setup

The migration container uses `wf_local_uat_migrator`; the API uses `wf_local_uat_app`. In SSMS, connect to `AMYOU-YOGA7\V2008R2` and open **Security → Logins**. Confirm `wf_local_uat_app` is enabled; create `wf_local_uat_migrator` as a SQL Server login if it is missing. Set or reset the two passwords through the SSMS login UI, use separate strong values, and do not add either login to a server role. Keep the app password synchronized with `ONPREM_DB_PASSWORD` in `.env` and the migrator password with `ONPREM_MIGRATOR_PASSWORD` in `.env.migrator.local`. In the BAT menu choose option 1 to open [`local-uat2-principals.sql`](sql/local-uat2-principals.sql), then run the whole file once in SSMS as a SQL administrator. The script selects the pinned UAT2 database itself, checks the server/version and required WINSpeed tables before changing anything, sets both login default databases to UAT2, enables password policy with expiration disabled, creates the dbo-owned `wf` schema if needed, maps the two existing logins, and grants the reviewed app/migrator database permissions. It also creates an empty dbo-owned `wf_reader` compatibility role required by immutable migration 002, with no login or members; incompatible existing roles stop setup. It does not create server logins, set passwords, assign server roles, or run migrations. The SQL Server 2008 migration profile excludes migration 074. If this UAT2 database does not contain the required `dbo` WINSpeed tables/columns, the setup script stops before changes; it is not an empty standalone database target for this deployment.

UAT2 is a separate database restored from a backup, so the restore itself does not link it to the source database. The migrations intentionally change the UAT2 copy. Source review confirms migration 074 (the script with the production database context) is excluded from this SQL Server 2008 profile, and the runner rejects explicit production-database writes; the new identity check also fails closed if either deployment login can access `dbwins_worldfert9`. These checks do not prove that a trigger, stored procedure, linked server, or other indirect database mechanism has no side effects. Confirm the target remains a separate database and preserve a recoverable UAT2 backup before first apply. Never point the UAT launcher at production.

An existing server login alone is insufficient: the database user mapping, schema, and permissions must also be prepared. The launcher stops if either principal, target guard, migration plan, or health check fails. If repeated incorrect passwords lock a SQL login, correct the private settings and have the SQL administrator unlock that login while retaining password policy. Do not paste either password or raw connection diagnostics into chat.

## Password rotation

To create a website administrator after deploying the backend, use BAT option 4 or run `New-Uat2AdminSql.ps1 -Username 'admin'` from this folder. Enter the password at the hidden prompt; the generator hashes it with bcrypt and writes the Git-ignored `sql/local-uat2-create-admin.local.sql`. Run that complete file in SSMS to create the app account; it stops if the username already exists. The generator itself makes no database changes, and neither the generated SQL nor console output contains the plaintext password. SQL Server's `HASHBYTES` is not compatible with the app's bcrypt verifier. Change the temporary password in the app profile after login. These app credentials are separate from the SQL service logins below.

Change the dedicated SQL login password in SQL Server administration, then update only `ONPREM_DB_PASSWORD` in the VM's `.env` file. Recreate the API container so it reads the new value: `docker compose up -d --force-recreate backend`. Generate a separate random `JWT_SECRET` and rotate it in the same private file if it was exposed. Never put either value in `docker.env.example`, Compose YAML, Git, terminal screenshots, or chat. A password already pasted into a conversation should be rotated before deployment.

Container startup is not database verification or UAT. Production remains NO_GO until the separate identity, migration, manual workflow, WinSpeed handoff, backup/recovery, and security gates are accepted.
