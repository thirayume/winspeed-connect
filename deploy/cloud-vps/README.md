# WorldFert Cloud VPS deployment (Docker Compose, no Coolify, no tunnel)

This package deploys the frontend, backend, SQL Server, MySQL and Portainer on one x86-64 Ubuntu VPS. Application and Portainer traffic use HTTPS. MSSQL, MySQL and SFTP listen on the VPS public IPv4; the provider firewall restricts database/SFTP access to approved public client IPs. The tested Hostinger profile leaves UFW inactive and treats Hostinger Firewall as the authoritative ingress control.

## Tested Hostinger pilot (2026-08-28)

- VPS ID `1935135`, KVM 2, Malaysia, Ubuntu 24.04 LTS, 2 vCPU, 8 GB RAM, 100 GB disk.
- Public IP `76.13.190.104`; hostname `srv1935135.hstgr.cloud`.
- Primary domain: `thirayu.online`; root and `www` redirect to the application.
- Frontend/API/Portainer: `app.thirayu.online`, `api.thirayu.online`, `portainer.thirayu.online`.
- MSSQL/MySQL: `mssql.thirayu.online:1433`, `mysql.thirayu.online:3306`.
- The original `*.srv1935135.hstgr.cloud` names remain certificate aliases during the transition.
- Allowlisted management/SFTP/database CIDR at test time: `58.11.84.165/32`.
- Hostinger Firewall: 22/1433/3306 from the allowlist, 80/443 from Any, default Drop.
  **Editing rules in hPanel does nothing until you press Synchronize.** The rule list updates
  immediately and looks correct, but the server keeps enforcing the previous set until the sync
  completes (up to 5 minutes). This cost us an afternoon on 2026-09-02: the rules read as expected
  while every connection still timed out.
  `deploy/cloud-vps/server/allowlist.sh` manages **ufw**, which this profile leaves inactive — it has
  no effect here. The authoritative control is the hPanel firewall.
  Diagnosing it: port 80/443 open while 22/1433/3306 time out means the host is up and only the
  allowlist is wrong. Check your current address with `curl -sS https://api.ipify.org` — the ISP
  hands out a new one periodically, and a stale entry looks identical to a missing one.
- All six containers, HTTPS, public database TLS authentication, SFTP key-only transfer, restore, manual backup, download and SHA-256 verification passed.

## Public endpoints

| Service | Address | Protection |
|---|---|---|
| Frontend | `https://APP_DOMAIN` | Caddy TLS |
| API | `https://API_DOMAIN` | Caddy TLS |
| Test frontend | `https://test.ROOT_DOMAIN` | Caddy TLS; isolated test application |
| Test API | `https://api-test.ROOT_DOMAIN` | Caddy TLS; isolated test application |
| Portainer | `https://PORTAINER_DOMAIN` | Caddy TLS; no direct public 9000/9443 |
| MSSQL | `MSSQL_DOMAIN:1433` | forced TLS + IP allowlist |
| MySQL | `MYSQL_DOMAIN:3306` | required TLS + IP allowlist |
| SFTP | `SERVER_PUBLIC_IP:22` | key-only, chrooted `wfbackup` account |

Public IP does not mean open to the whole internet. Use `/32` rules for the office/client public IP whenever possible. The escape hatch `ALLOW_DATABASES_FROM_ANYWHERE=true` is deliberately required before `0.0.0.0/0` is accepted.

## SFTP folders

```text
/incoming/mssql       upload .bak or .bak.gz and matching .sha256
/incoming/mysql       upload .sql or .sql.gz and matching .sha256
/outgoing/mssql       download generated MSSQL backups
/outgoing/mysql       download generated MySQL backups
/manifests            latest job status and database CA certificate
```

Uploads use a `.part` name and are renamed only after the transfer succeeds. Upload never triggers restore automatically.

## First deployment from Windows

1. Install Windows OpenSSH Client. Run `windows\00-check-prerequisites.bat`.
2. Create two Ed25519 key pairs with `ssh-keygen`: deploy and SFTP.
3. Add the deploy public key to Hostinger hPanel under VPS Settings → SSH keys.
4. Run `windows\09-generate-hostinger-profile.ps1` once with `-ServerIp`, `-ServerHostname`, and `-AllowedCidr`; it creates the ignored `.env`, server config, BAT config, and protected credential summary.
5. Configure the provider firewall: 80/443 public, 22/1433/3306 only from approved CIDRs, default Drop.
6. Run `windows\01-prepare-server.bat`, then `windows\03-remote-deploy.bat`.
7. Upload backups with `02-upload-backup.bat`, restore MSSQL and MySQL, then run `08-health-check.bat`.

Example:

```bat
02-upload-backup.bat mssql C:\Backup\dbwins_worldfert9.bak
02-upload-backup.bat mysql C:\Backup\db_truckscale.sql.gz
04-restore-mssql.bat dbwins_worldfert9.bak
05-restore-mysql.bat db_truckscale.sql.gz
08-health-check.bat
```

Use shell-safe generated secrets (`A-Z`, `a-z`, `0-9`, `_ . : @ % + , = -`). Avoid quotes, spaces, dollar signs and ampersands because the server-side backup/restore tools load this environment file directly.

## Weekly backup

`deploy-release.sh` installs cron automatically:

```text
Sunday 02:00 Asia/Bangkok
```

Each run creates and validates `.bak.gz` and `.sql.gz`, writes SHA-256 manifests, and retains 35 days in the tested Hostinger profile. Run an ad-hoc backup with `06-run-backup-now.bat`; download and verify the latest pair with `07-download-latest-backups.bat`.

Backups left on the same VPS do not protect against total VPS loss. Since this design intentionally does not use S3, download the weekly pair to a separate company workstation/NAS through SFTP and test a restore at least quarterly.

## Clone current databases for bug reproduction

Use `12-clone-databases-to-test.bat` to take online snapshots of the current VPS databases and restore them under separate test names on the same MSSQL/MySQL containers. The production database names are validated and never dropped or replaced. If a test target already exists, the script saves a verified safety backup in SFTP `/outgoing` before replacing it.

```bat
windows\12-clone-databases-to-test.bat
windows\12-clone-databases-to-test.bat all dbwins_worldfert9_test db_truckscale_test
windows\12-clone-databases-to-test.bat mssql dbwins_bug_123_test db_truckscale_test
windows\12-clone-databases-to-test.bat mysql dbwins_worldfert9_test db_truckscale_bug_123_test
```

The wrapper runs a read-only preflight, checks container health and disk space, then requires the confirmation text `CLONE-TO-TEST`. Target names must contain `test`, `qa`, `uat` or `sandbox`. It performs `DBCC CHECKDB ... PHYSICAL_ONLY` for MSSQL, `mysqlcheck` for MySQL and compares source/target table counts. Copied MySQL scheduled events are disabled to reduce accidental background activity in the test database.

After a successful default clone, use the existing host, port and credentials with only the database name changed:

| Engine | Host and port | Test database | Users |
|---|---|---|---|
| MSSQL | `mssql.thirayu.online:1433` | `dbwins_worldfert9_test` | `wf_reader`, `wf_owner`, `sa` |
| MySQL | `mysql.thirayu.online:3306` | `db_truckscale_test` | `wfapp`, `root` |

The live backend continues to use the production database names from `.env`; the clone command does not change or restart it. Do not redirect the public production backend to the test databases.

## Isolated test frontend/backend and full test environment

Two Windows wrappers prepare the test environment without rebuilding or restarting Production:

```bat
rem Deploy/rebuild only the test frontend and backend; test DBs must already exist.
windows\13-deploy-test-app.bat

rem One-shot: clone both current Production DBs, then deploy test frontend/backend.
windows\14-prepare-full-test-system.bat
```

Both commands upload the current local Backend/Frontend source, install the server helpers, run a read-only preflight and require an exact confirmation phrase. The first command requires `DEPLOY-TEST-APP`; the full command requires `REBUILD-FULL-TEST`. The full workflow stops only existing test app containers, safety-backs up and replaces only the test databases, then starts the test application.

Default isolated components:

| Component | Address/name | Production impact |
|---|---|---|
| Test frontend | `https://test.thirayu.online` / `wf-frontend-test` | Separate image/container |
| Test API | `https://api-test.thirayu.online/api` / `wf-backend-test` | Separate JWT and container |
| Test MSSQL | `dbwins_worldfert9_test` in `wf-mssql` | Separate database name |
| Test MySQL | `db_truckscale_test` in `wf-mysql` | Separate database name; copied events disabled |

The test backend starts with `NODE_ENV=test`, a separately generated JWT secret, blank LINE/Webhook credentials and `DISABLE_BACKGROUND_WORKERS=true`. Therefore copied outbox jobs, polling and TruckScale sync do not run automatically. Interactive API operations can change the test databases, which is the intended behavior for bug reproduction. The test frontend displays a permanent **TEST SYSTEM** badge.

Custom bug-specific database names are supported:

```bat
windows\14-prepare-full-test-system.bat dbwins_bug_123_test db_truckscale_bug_123_test
windows\13-deploy-test-app.bat dbwins_bug_123_test db_truckscale_bug_123_test
```

Target names must contain `test`, `qa`, `uat` or `sandbox`. The generated test-only secrets and selected database names are stored root-only at `/opt/worldfert/secrets/test-stack/test-stack.env`; Production `.env` and the protected workstation credential vault remain unchanged. Test exports/uploads use separate Docker volumes.

Server-side management, when connected through SSH:

```bash
sudo APP_DIR=/opt/worldfert/app /opt/worldfert/app/deploy/cloud-vps/server/deploy-test-app.sh status
sudo APP_DIR=/opt/worldfert/app /opt/worldfert/app/deploy/cloud-vps/server/deploy-test-app.sh logs backend-test 200
sudo APP_DIR=/opt/worldfert/app /opt/worldfert/app/deploy/cloud-vps/server/deploy-test-app.sh stop
```

`stop` removes only test app containers and keeps test databases and test volumes. Re-run `13-deploy-test-app.bat` to start/rebuild them. Portainer will show the test containers alongside Production, with the `wf-*-test` suffix.

## Seven-day pilot monitor

Start a lightweight seven-day monitor after deployment. It samples container health, API/database health, load, available RAM, swap and root-disk usage every five minutes. Business data is not read or changed.

```bat
windows\10-pilot-monitor.bat install 7
windows\10-pilot-monitor.bat report
windows\10-pilot-monitor.bat stop
```

Metrics remain on the VPS at `/var/log/worldfert-pilot/metrics.csv`. Collection stops writing new samples after the planned end time; run `stop` after the final report to remove the cron schedule while preserving the metrics.

## Exact connection matrix

Plain-text passwords are deliberately excluded from this README and the general runbook. The generated protected file `.local-secrets\CREDENTIALS.txt` contains the actual database and application passwords. Portainer has a separate root-only credential file and can be displayed directly to the operator terminal with the command below.

| Client/service | Host | Port | Database/path | Username | Password reference |
|---|---|---:|---|---|---|
| MSSQL read-only | `mssql.thirayu.online` | 1433 | `dbwins_worldfert9` | `wf_reader` | `WF_READER_PASSWORD` in protected `CREDENTIALS.txt` |
| MSSQL controlled write | `mssql.thirayu.online` | 1433 | `dbwins_worldfert9` | `wf_owner` | `WF_OWNER_PASSWORD` in protected `CREDENTIALS.txt` |
| MSSQL administration | `mssql.thirayu.online` | 1433 | `dbwins_worldfert9` | `sa` | `MSSQL_SA_PASSWORD` in protected `CREDENTIALS.txt` |
| MySQL application | `mysql.thirayu.online` | 3306 | `db_truckscale` | `wfapp` | `MYSQL_PASSWORD` in protected `CREDENTIALS.txt` |
| MySQL administration | `mysql.thirayu.online` | 3306 | `db_truckscale` | `root` | `MYSQL_ROOT_PASSWORD` in protected `CREDENTIALS.txt` |
| SFTP | `76.13.190.104` | 22 | `/incoming`, `/outgoing`, `/manifests` | `wfbackup` | Ed25519 key; no password |
| Portainer | `https://portainer.thirayu.online` | 443 | Docker environment | `admin` | `11-manage-stack.bat portainer-credentials` |

Use `wf_reader` for reporting and inspection, `wf_owner` only for approved data maintenance, and `sa`/MySQL `root` only for controlled DBA work. The backend currently uses `sa` inside the private Docker network for application compatibility; this does not make `sa` the recommended external client account.

The CA file is `.local-secrets\worldfert-db-ca.crt` on the administrator workstation and `/manifests/certs/worldfert-db-ca.crt` through SFTP.

### SSMS for MSSQL

1. Server name: `mssql.thirayu.online,1433`.
2. Authentication: SQL Server Authentication; choose `wf_reader`, `wf_owner` or `sa` according to the task.
3. Database: `dbwins_worldfert9`.
4. Set Encryption to `Mandatory` and leave **Trust server certificate** unchecked after importing `worldfert-db-ca.crt` into Windows Trusted Root Certification Authorities.
5. `Trust server certificate=True` is a migration-only fallback. Keep the Hostinger source-IP allowlist in place and return it to unchecked after the CA is installed.

### DBeaver for MSSQL

Create a SQL Server connection with host `mssql.thirayu.online`, port `1433`, database `dbwins_worldfert9` and the selected SQL login. In SSL/driver properties set encryption on, certificate validation on and `trustServerCertificate=false`; add `worldfert-db-ca.crt` to the Java/driver trust configuration if DBeaver does not use the Windows certificate store. Test Connection must succeed without accepting an unknown certificate.

### DBeaver for MySQL

Create a MySQL connection with host `mysql.thirayu.online`, port `3306`, database `db_truckscale`, user `wfapp` and the `MYSQL_PASSWORD` value. In SSL settings select `VERIFY_CA` or `VERIFY_IDENTITY` and choose `worldfert-db-ca.crt` as CA certificate. `REQUIRED` is a migration-only fallback because it encrypts traffic without fully verifying server identity.

## Domain and DNS

In Hostinger hPanel → Domains → DNS, keep existing MX, TXT and unrelated records. The tested zone uses TTL 300 and these A records, all pointing to `76.13.190.104`:

| Name | Type | Value |
|---|---|---|
| `@` | A | `76.13.190.104` |
| `app` | A | `76.13.190.104` |
| `api` | A | `76.13.190.104` |
| `mssql` | A | `76.13.190.104` |
| `mysql` | A | `76.13.190.104` |
| `portainer` | A | `76.13.190.104` |
| `test` | A | `76.13.190.104` |
| `api-test` | A | `76.13.190.104` |
| `www` | CNAME | `thirayu.online` |

After DNS resolves, apply all application-domain values, rebuild, issue application TLS certificates, rotate database certificates and run health checks with:

```bat
windows\11-manage-stack.bat domain-set thirayu.online
```

## Operations manager: environment, deploy and rebuild

The Windows wrapper uses the protected `windows\remote-config.bat` and never prints secret values in `env-show` or `env-get`. Every environment edit creates a timestamped backup on the VPS before validation. A failed Compose validation restores the previous `.env` automatically.

```bat
windows\11-manage-stack.bat status
windows\11-manage-stack.bat health
windows\11-manage-stack.bat connections
windows\11-manage-stack.bat env-show
windows\11-manage-stack.bat env-get APP_DOMAIN
windows\11-manage-stack.bat env-set APP_VERSION 1.0.1
windows\11-manage-stack.bat env-edit
windows\11-manage-stack.bat env-backups
windows\11-manage-stack.bat env-rollback latest
windows\11-manage-stack.bat deploy
windows\11-manage-stack.bat rebuild backend
windows\11-manage-stack.bat restart frontend
windows\11-manage-stack.bat logs backend 200
windows\11-manage-stack.bat backup-now
windows\11-manage-stack.bat portainer-credentials
```

Run `deploy` after a valid `.env` change. Use `rebuild` when source code or a Dockerfile changed, `restart` for a clean process restart without rebuilding, and `logs` for diagnosis. The remote deployment script preserves the authoritative VPS `.env` by default; use `03-remote-deploy.bat --sync-env` only when intentionally replacing it with the protected local `.env`.

Portainer is for visual status, logs, restart and basic container inspection at `https://portainer.thirayu.online`. It is reachable only through Caddy on port 443; do not publish 9000/9443 or grant Portainer administrator access to general application users. Configuration changes should remain in versioned Compose/Caddy files and be applied with the manager so the next deploy does not overwrite one-off UI changes.

## Important limits

- SQL Server Linux containers require an x86-64 VPS. Do not select an ARM plan.
- SQL Server Express is free but limited to 10 GB per database. The restore script blocks an oversized backup.
- Current application behavior still uses `sa` inside the private Docker network. External day-to-day access should use a dedicated least-privilege login; keep `sa` for controlled administration only.
- Database restore is destructive and requires an explicit confirmation token. A pre-restore safety backup is created when an existing database is present.
