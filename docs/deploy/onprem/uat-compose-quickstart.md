# UAT clone stack quick start

This root Compose entrypoint starts the Sale-App frontend, API, and Caddy ingress on a Linux container host and targets only the explicitly configured SQL Server clone. Caddy publishes HTTP 80 and HTTPS 443; it uses a local CA for UAT TLS. This does not provide production acceptance, does not run migrations, and does not prove the database target or business workflows.

## Host requirement

The images use Linux containers. The reported `no matching manifest for windows(10.0.20348)/amd64` error means the Docker CLI was reaching a Windows-container daemon. Run Compose in the Ubuntu WSL distribution against its Linux Docker Engine. Before continuing, verify the daemon type:

```bash
docker info --format '{{.OSType}}'
```

The result must be `linux`. If it says `windows`, stop and connect the CLI to the Docker Engine inside Ubuntu WSL. Do not replace these images with Windows images. Docker Desktop's Windows installation is a separate product and is not the engine used by this setup. [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Install WSL on Windows Server](https://learn.microsoft.com/en-us/windows/wsl/install-on-server)

## First run

From the Ubuntu WSL shell, clone the repository and copy `docker.env.example` to `.env` **in the repository root**, beside `docker-compose.yml`. The `.env` inside `docs/deploy/onprem/` belongs to the separate office compose file and is not used by this UAT launcher. Fill the root `.env` with the approved clone endpoint, exact server identity, clone database name, dedicated application login, login password, browser origin, and a newly generated JWT secret. Keep `.env` local; it is ignored by Git. Compose reads this file for interpolation and passes its runtime settings to the backend through `env_file`, so keep only the expected deployment settings in it. Do not use `sa`: `DB_MODE=onprem` refuses that login and validates server, database, engine, transport, and elevated-role state before using a pool.

```bash
cp docker.env.example .env
nano .env
```

Set `HTTP_PORT=80`, `HTTPS_PORT=443`, `APP_DOMAIN` to the host name or IP used in the browser, and `CORS_ORIGIN=https://<APP_DOMAIN>`. Keep `VITE_API_BASE_URL=/api`. Caddy's local CA can issue a UAT certificate for an internal host, but other computers will not trust it until the Caddy root CA is installed in their trust store. For a publicly trusted certificate, use a real DNS name and a separately reviewed public ACME setup instead. [Caddy local HTTPS and trust requirements](https://caddyserver.com/docs/running), [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)

For the named SQL Server instance, use the server address in `ONPREM_DB_SERVER`, the instance name in `ONPREM_DB_INSTANCE`, and leave `ONPREM_DB_PORT` blank. SQL Browser/TCP reachability must already be configured and verified by the SQL administrator. If IT provides a fixed TCP port, set `ONPREM_DB_PORT` and leave the instance name blank. Do not change SQL or firewall configuration as part of this Compose setup.

After filling `.env`, you can run the deployment from Windows by double-clicking [`deploy-wsl.bat`](deploy-wsl.bat). You can double-click it from any directory; it locates the repository root relative to the `.bat` file. It opens the default WSL distribution and calls `wsl-deploy.sh`, which checks for a local Unix-socket context and Linux daemon, validates the UAT services, ports 80/443, clone name, and dedicated non-`sa` login, then builds and starts the stack. It does not run migrations. The script keeps resolved settings in memory and does not print the rendered Compose configuration.

You can also run Compose from the repository root in Ubuntu WSL. The root `docker-compose.yml` is the file used by this UAT stack:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Pull the intended code version before running. The one-click script does not pull code or create/restore a database. If the approved UAT clone does not exist or its dedicated login is not ready, stop before deployment; do not point this stack at the production database or use `sa`.

HTTP on port 80 redirects to HTTPS on port 443. For this internal UAT, Caddy's local root CA must be trusted by each client browser/device; without that trust, HTTPS shows a certificate warning. WSL port forwarding normally makes services available to Windows at localhost; LAN access from other computers depends on the WSL networking mode and Windows firewall/forwarding configuration, which this script does not change. [Microsoft WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)

The API port is not published directly. Background workers and native coupon posting stay disabled in this UAT stack, password change is enforced, and no migration service is included.

## Password rotation

Change the dedicated SQL login password in SQL Server administration, then update only `ONPREM_DB_PASSWORD` in the VM's `.env` file. Recreate the API container so it reads the new value: `docker compose up -d --force-recreate backend`. Generate a separate random `JWT_SECRET` and rotate it in the same private file if it was exposed. Never put either value in `docker.env.example`, Compose YAML, Git, terminal screenshots, or chat. A password already pasted into a conversation should be rotated before deployment.

Container startup is not database verification or UAT. Production remains NO_GO until the separate identity, migration, manual workflow, WinSpeed handoff, backup/recovery, and security gates are accepted.
