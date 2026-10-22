# UAT clone stack quick start

This root Compose entrypoint starts the Sale-App frontend and API on a Linux container host and targets only the explicitly configured SQL Server clone. It is a UAT aid; it does not provide production HTTPS, does not run migrations, and does not prove the database target or business workflows.

## Host requirement

The images use Linux containers. The reported `no matching manifest for windows(10.0.20348)/amd64` error means Docker is using a Windows-container daemon. Do not replace these images with Windows images. The documented on-prem host is an Ubuntu VM with Docker Engine. Windows Server 2022 is the Hyper-V host; run Compose inside the Ubuntu VM. Docker states that Docker Desktop is not supported on Windows Server 2019/2022. [Docker Desktop on Windows](https://docs.docker.com/desktop/setup/install/windows-install/)

## First run

On the Ubuntu VM, clone the repository and copy `docker.env.example` to `.env`. Fill the local file with the approved clone endpoint, exact server identity, clone database name, dedicated application login, login password, browser origin, and a newly generated JWT secret. Keep `.env` local; it is ignored by Git. Do not use `sa`: `DB_MODE=onprem` refuses that login and validates server, database, engine, transport, and elevated-role state before using a pool.

```bash
cp docker.env.example .env
nano .env
```

For the named SQL Server instance, use the server address in `ONPREM_DB_SERVER`, the instance name in `ONPREM_DB_INSTANCE`, and leave `ONPREM_DB_PORT` blank. SQL Browser/TCP reachability must already be configured and verified by the SQL administrator. If IT provides a fixed TCP port, set `ONPREM_DB_PORT` and leave the instance name blank. Do not change SQL or firewall configuration as part of this Compose setup.

Use these commands after filling `.env`:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
```

The frontend listens on port 8080 by default and proxies `/api` and `/socket.io` to the API over the private Compose network. Set `CORS_ORIGIN` to the browser origin used by staff; for access by LAN name/IP, update both `CORS_ORIGIN` and the app URL accordingly. The API port is not published directly. Background workers and native coupon posting stay disabled in this UAT stack, password change is enforced, and no migration service is included.

## Password rotation

Change the dedicated SQL login password in SQL Server administration, then update only `ONPREM_DB_PASSWORD` in the VM's `.env` file. Recreate the API container so it reads the new value: `docker compose up -d --force-recreate backend`. Generate a separate random `JWT_SECRET` and rotate it in the same private file if it was exposed. Never put either value in `docker.env.example`, Compose YAML, Git, terminal screenshots, or chat. A password already pasted into a conversation should be rotated before deployment.

Container startup is not database verification or UAT. Production remains NO_GO until the separate identity, migration, manual workflow, WinSpeed handoff, backup/recovery, and security gates are accepted.
