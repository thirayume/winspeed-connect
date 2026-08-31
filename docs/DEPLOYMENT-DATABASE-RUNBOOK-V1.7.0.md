# WorldFert Operational Runbook: Database Maintenance, Backup/Restore & Deployment Guide (v1.7.0)

> **Comprehensive Guide for Database Synchronization, Backup/Restore, Deployment Workflows, and CI/CD Automation**

---

## 📌 Executive Summary

This document provides step-by-step instructions for:
1. **Database Cloning:** Cloning Production DBs (`dbwins_worldfert9`, `db_truckscale`) to Test DBs (`dbwins_worldfert9_test`, `db_truckscale_test`) for `https://test.thirayu.online`.
2. **Backup & Restore Workflows:**
   - Restoring local `.bak` / `.sql` files into Production or Test databases.
   - Taking ad-hoc backups and downloading them to your workstation.
3. **Application Deployment Workflows:**
   - Deploying Frontend/Backend to Production (`app.thirayu.online`).
   - Deploying Frontend/Backend to Test (`test.thirayu.online`).
   - Deploying to both environments simultaneously.
4. **CI/CD & Pipeline Automation:** Recommended GitHub Actions workflow for automated testing and deployment.

---

## 📂 Quick Command Reference Table

All scripts are located in: `c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows\`

| Task / Objective | Command to Execute (from `deploy/cloud-vps/windows/`) |
|---|---|
| **1. Health Check** | `08-health-check.bat` |
| **2. Deploy to Production** | `03-remote-deploy.bat` |
| **3. Deploy to Test Stack** | `13-deploy-test-app.bat` |
| **4. One-Shot Clone DBs + Deploy Test Stack** | `14-prepare-full-test-system.bat` |
| **5. Clone Production DBs to Test DBs** | `12-clone-databases-to-test.bat` |
| **6. Upload Local Backup File to VPS** | `02-upload-backup.bat mssql C:\path\to\db.bak` |
| **7. Restore MSSQL to Production** | `04-restore-mssql.bat dbwins_worldfert9.bak` |
| **8. Restore MySQL to Production** | `05-restore-mysql.bat db_truckscale.sql.gz` |
| **9. Trigger Immediate Production Backup** | `06-run-backup-now.bat` |
| **10. Download Latest Backups to Workstation** | `07-download-latest-backups.bat` |
| **11. View Logs (Production Backend)** | `11-manage-stack.bat logs backend 200` |
| **12. View Logs (Test Backend)** | `11-manage-stack.bat logs backend-test 200` |

---

## 🗄️ PART 1: Database Cloning (Production → Test)

### Objective
Copy the latest live data from Production (`dbwins_worldfert9` & `db_truckscale`) into the isolated Test environment (`dbwins_worldfert9_test` & `db_truckscale_test`) without downtime or affecting live users.

### Option A: Standard Database Clone Only
Run from your Windows workstation terminal:
```cmd
cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
12-clone-databases-to-test.bat
```
*   **What it does:**
    1. Runs a read-only preflight check.
    2. Takes online snapshots of production MSSQL and MySQL databases.
    3. Safely backs up existing test databases before replacing them.
    4. Restores snapshots under `dbwins_worldfert9_test` and `db_truckscale_test`.
    5. Disables scheduled background events in MySQL test DB to avoid duplicate background jobs.
    6. Compares table and row counts to ensure 100% data fidelity.

### Option B: One-Shot Full Refresh (Clone DBs + Deploy Latest Test App)
If you want to update both the Test DBs **and** deploy the latest frontend/backend code to `test.thirayu.online`:
```cmd
cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
14-prepare-full-test-system.bat
```
*   **Confirmation Phrase:** Type `REBUILD-FULL-TEST` when prompted.

---

## 💾 PART 2: Backup & Restore Workflows

### Scenario 2.1: Restore Local `.bak` (MSSQL) or `.sql/.gz` (MySQL) to Production DB
If you have a database backup file on your local computer and want to import it into the server:

1. **Step 1: Upload the file via SFTP**
   ```cmd
   cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
   02-upload-backup.bat mssql C:\Backups\dbwins_worldfert9.bak
   ```
   *(For MySQL, use `02-upload-backup.bat mysql C:\Backups\db_truckscale.sql.gz`)*

2. **Step 2: Execute the Restore Command on VPS**
   ```cmd
   04-restore-mssql.bat dbwins_worldfert9.bak
   ```
   *(For MySQL, use `05-restore-mysql.bat db_truckscale.sql.gz`)*

   > [!IMPORTANT]
   > The restore script automatically creates a pre-restore safety snapshot in `/outgoing` before replacing the target database.

---

### Scenario 2.2: Take Ad-Hoc Production Backup & Download to Local Workstation
1. **Trigger Immediate Backup on Server:**
   ```cmd
   06-run-backup-now.bat
   ```
2. **Download Backups to `C:\WorldFert-Backups`:**
   ```cmd
   07-download-latest-backups.bat
   ```
   *   Files will be saved with SHA-256 integrity checksums verified.

---

## 🚀 PART 3: Application Deployment Workflows

### Scenario 3.1: Deploy to Production (`app.thirayu.online`)
To push code changes to the live production site:
```cmd
cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
03-remote-deploy.bat
```
*   **What it does:** Packages local frontend and backend code, uploads to VPS over SSH, builds Docker images (`worldfert-frontend`, `worldfert-backend`), runs DB migrations, restarts containers, and verifies zero-downtime health.

---

### Scenario 3.2: Deploy to Test Environment (`test.thirayu.online`)
To push code changes to the isolated test site only:
```cmd
cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
13-deploy-test-app.bat
```
*   **Confirmation Phrase:** Type `DEPLOY-TEST-APP` when prompted.
*   **Features:** Displays permanent **TEST SYSTEM** badge in UI, uses `DISABLE_BACKGROUND_WORKERS=true` to avoid sending real LINE notifications or duplicate webhooks.

---

### Scenario 3.3: Deploy to Both Production & Test
To update code on both environments in one sequence:
```cmd
cd c:\MyWork\WorldFert\winspeed-frontend\deploy\cloud-vps\windows
03-remote-deploy.bat && 13-deploy-test-app.bat
```

---

## 🔄 PART 4: Recommended CI/CD GitHub Actions Pipeline

To automate deployment whenever code is pushed to `main` or `staging` branches, create `.github/workflows/deploy.yml` in your repository:

```yaml
name: WorldFert CI/CD Pipeline

on:
  push:
    branches:
      - main
      - staging

jobs:
  test-and-build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: 'WSSale-App/package-lock.json'

      - name: Install Frontend Dependencies & Build Check
        run: |
          npm --prefix WSSale-App ci
          npm --prefix WSSale-App run build

      - name: Install Backend Dependencies & Audit
        run: |
          npm --prefix backend ci

  deploy-production:
    needs: test-and-build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Deploy to Hostinger Production VPS via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/worldfert/app
            git pull origin main
            ./deploy/cloud-vps/server/deploy-release.sh

  deploy-test:
    needs: test-and-build
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Deploy to Hostinger Test VPS via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/worldfert/app
            git pull origin staging
            ./deploy/cloud-vps/server/deploy-test-app.sh
```

---

## 🌐 Summary of URLs & Ports

| Component | URL / Endpoint | Port | Environment |
|---|---|---|---|
| **Production App** | `https://app.thirayu.online` | 443 | Production |
| **Production API** | `https://api.thirayu.online` | 443 | Production |
| **Test App** | `https://test.thirayu.online` | 443 | Test / Staging |
| **Test API** | `https://api-test.thirayu.online` | 443 | Test / Staging |
| **Portainer Dashboard** | `https://portainer.thirayu.online` | 443 | Management |
| **MSSQL Database** | `mssql.thirayu.online` | 1433 | DB Engine |
| **MySQL Database** | `mysql.thirayu.online` | 3306 | DB Engine |
| **SFTP Server** | `76.13.190.104` | 22 | File Transfer |

---

## 🎯 ชี้ stack ทดสอบไปฐานที่หน้างานใช้จริง

ค่าปริยายของ `docker-compose.test.yml` ให้ test ใช้คอนเทนเนอร์ `mssql`/`mysql` บน VPS
ซึ่งเป็นสำเนาที่โคลนมา ไม่ใช่ฐานที่ WINSpeed บนเครื่องผู้ดูแลใช้อยู่

ถ้าต้องการให้ test ตรงกับหน้างาน ตั้งค่าเหล่านี้ใน `deploy/cloud-vps/.env`
แล้ว deploy stack ทดสอบใหม่ (`13-deploy-test-app.bat`) — **ไม่กระทบ production**

```env
TEST_MSSQL_SERVER=20.255.185.14
TEST_MSSQL_PORT=1433
MSSQL_TEST_DATABASE=dbwins_worldfert9

TEST_MYSQL_HOST=reseau.proxy.rlwy.net
TEST_MYSQL_PORT=42508
MYSQL_TEST_DATABASE=db_truckscale

TS_PRODUCTION_HOSTS=reseau.proxy.rlwy.net
```

### สิ่งที่ต้องรู้ก่อนทำ

**test จะเขียนลงฐานจริง** — ไม่ใช่แค่อ่าน แอปเขียนคิวก่อนชั่งและ write-back ลง
`db_truckscale` เหมือนโปรแกรมชั่ง `TS_PRODUCTION_HOSTS` จึงต้องตั้งให้ครบ
ตัว `assertWritableTarget()` จะปฏิเสธการเขียนเมื่อ `NODE_ENV` ไม่ใช่ `production`
และปลายทางอยู่ในรายชื่อ — test ตั้ง `NODE_ENV: test` ไว้แล้ว ตัวกันจึงทำงาน

**เดิมตัวกันนี้ไม่เคยทำงานเลย** — `TS_PRODUCTION_HOSTS` ประกาศไว้ใน `.env.example`
แต่ไม่ถูกส่งเข้าคอนเทนเนอร์ทั้ง prod และ test แก้แล้วในทั้งสองไฟล์

**ชื่อฐานของ test เคยไม่มีค่าปริยาย** — `${MSSQL_TEST_DATABASE}` กับ `${MYSQL_TEST_DATABASE}`
ถ้า `.env` ไม่ได้ตั้ง (ซึ่งตอนนี้ไม่ได้ตั้ง) จะได้ชื่อฐานว่าง แล้วต่อไม่ติดแบบไม่มีข้อความบอก
ใส่ค่าปริยาย `dbwins_worldfert9_test` / `db_truckscale_test` ไว้แล้ว
