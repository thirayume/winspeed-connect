# Docker Deployment Guide

WinSpeed Connect — คู่มือ deploy ด้วย Docker Compose  
รองรับทั้ง **Ubuntu On-Premise Server** และ **Railway**

---

## โครงสร้างไฟล์

```
winspeed-connect/
├── docker-compose.yml          <- orchestrate frontend + backend
├── .env.example                <- template env vars (copy -> .env)
├── backend/
│   └── Dockerfile              <- Node.js 22 Alpine image
└── WSSale-App/
    ├── Dockerfile              <- multi-stage: build Vite -> serve nginx
    └── nginx.conf              <- SPA fallback + static caching
```

---

## Option A — Ubuntu On-Premise Server

### Prerequisites

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Verify
docker --version          # Docker 24+
docker compose version    # v2.x
```

### ขั้นตอน Deploy

**1. Clone repo และตั้งค่า env**

```bash
git clone https://github.com/thirayume/winspeed-connect.git
cd winspeed-connect

cp .env.example .env
nano .env   # แก้ค่าให้ตรงกับ server จริง
```

ค่าที่ต้องแก้ใน `.env`:

| ตัวแปร | ค่า |
|---|---|
| `REMOTE_DB_SERVER` | IP ของ SQL Server |
| `REMOTE_DB_PASSWORD` | รหัสผ่าน SA |
| `JWT_SECRET` | random string ยาวๆ (ใช้ `openssl rand -hex 32`) |
| `CORS_ORIGIN` | URL ที่ frontend ใช้เข้าถึง เช่น `http://192.168.1.100` |
| `VITE_API_BASE_URL` | URL ของ backend API เช่น `http://192.168.1.100:3000/api` |

> **หมายเหตุ:** `VITE_API_BASE_URL` ถูก bake เข้า frontend ตอน build  
> ถ้าเปลี่ยน IP ต้อง build ใหม่ด้วย `docker compose build frontend`

**2. Build และ Start**

```bash
# Build images + start services (background)
docker compose up -d --build

# ดู logs
docker compose logs -f

# ตรวจ status
docker compose ps
```

**3. ทดสอบ**

```bash
# Health check backend
curl http://localhost:3000/api/health
# คาดหวัง: {"ok":true,"ts":"..."}

# เปิด browser
open http://localhost        # หรือ http://<server-ip>
```

### Commands ที่ใช้บ่อย

```bash
# อัพเดท code และ redeploy
git pull
docker compose up -d --build

# Restart เฉพาะ backend
docker compose restart backend

# Stop ทุก service
docker compose down

# ดู logs real-time
docker compose logs -f backend
docker compose logs -f frontend

# เข้า shell ใน container
docker compose exec backend sh
docker compose exec frontend sh
```

### Auto-start เมื่อ reboot

`restart: unless-stopped` ใน docker-compose.yml จัดการให้อัตโนมัติ  
ถ้า Docker daemon ตั้ง auto-start แล้ว (ปกติเป็น default) ไม่ต้องทำอะไรเพิ่ม

```bash
# ตรวจว่า Docker daemon auto-start หรือยัง
sudo systemctl is-enabled docker
# ถ้าไม่ได้: sudo systemctl enable docker
```

---

## Option B — Railway (Docker-based)

Railway รองรับ Dockerfile โดยอัตโนมัติ ถ้ามีไฟล์ `Dockerfile` ใน root ของ service

### Backend Service (ที่มีอยู่แล้ว)

1. Railway → Service (winspeed-connect) → Settings → Build
2. ตรวจว่า Builder = **Dockerfile** (จะ detect อัตโนมัติจาก `backend/Dockerfile`)
3. **Networking** → ตรวจ port ตรงกับ `PORT` env var (default: 3000)

Environment Variables ที่ต้องตั้งใน Railway Variables:

```
NODE_ENV=production
PORT=3000
DB_MODE=remote
REMOTE_DB_SERVER=...
REMOTE_DB_PORT=1433
REMOTE_DB_USER=sa
REMOTE_DB_PASSWORD=...
DB_NAME=dbwins_worldfert9
JWT_SECRET=...
CORS_ORIGIN=https://winspeed-connect.vercel.app
```

### Frontend Service (ถ้าต้องการย้ายจาก Vercel)

1. Railway → New Service → GitHub Repo → เลือก `winspeed-connect`
2. Settings → Root Directory: `/WSSale-App`
3. Settings → Build → Builder: Dockerfile
4. Variables:
   ```
   VITE_API_BASE_URL=https://winspeed-connect-backend.up.railway.app/api
   VITE_USE_MOCKUP_DATA=false
   ```
5. Networking → เพิ่ม domain, ตั้ง port = 80

---

## ใช้ Domain จริง + HTTPS (On-Premise)

ใช้ **Nginx reverse proxy + Certbot** นอก Docker:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# สร้าง nginx config สำหรับ domain
sudo nano /etc/nginx/sites-available/winspeed
```

```nginx
server {
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/winspeed /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# ขอ SSL certificate
sudo certbot --nginx -d yourdomain.com
```

แล้วแก้ `.env`:
```
CORS_ORIGIN=https://yourdomain.com
VITE_API_BASE_URL=https://yourdomain.com/api
```

Rebuild frontend:
```bash
docker compose up -d --build frontend
```

---

## Troubleshooting

| อาการ | วิธีแก้ |
|---|---|
| Frontend แสดง "Failed to fetch" | ตรวจ `VITE_API_BASE_URL` ใน `.env` และ rebuild frontend |
| Backend ต่อ DB ไม่ได้ | ตรวจ `REMOTE_DB_SERVER`, `REMOTE_DB_PASSWORD` และ firewall ของ SQL Server |
| Port 80 ถูกใช้งานอยู่ | แก้ใน `docker-compose.yml` เป็น `"8080:80"` แล้ว `docker compose up -d` |
| Railway: connection refused | ตรวจ Networking → port ต้องตรงกับ `PORT` env var |
| Image build นาน | ใช้ `docker compose build --no-cache` ถ้าต้องการ fresh build |

---

## Option C — Self-host ฐานข้อมูล (SQL Server + MySQL) สำหรับ Cloud Production

ใช้เมื่อต้องการย้าย DB มารันเอง (แทน Railway/remote) — เพิ่ม service `sqlserver` + `mysql` ผ่าน **profile `db`**

### 1. เตรียม env
```bash
cp .env.docker.example .env
# แก้: REMOTE_DB_SERVER=sqlserver, MYSQL_HOST=mysql, รหัสผ่านทั้งหมด (ดู docs/SECURITY.md)
```

### 2. (ทางเลือก) เตรียม dump TruckScale
วางไฟล์ `.sql` ใน `db-init/mysql/` → MySQL import อัตโนมัติครั้งแรก (ดู `db-init/mysql/README.md`)

### 3. สตาร์ทครบชุด
```bash
docker compose --profile db up -d        # sqlserver + mysql + backend + frontend
docker compose ps                        # ตรวจ health
```
> ค่าเริ่มต้น (`docker compose up -d` ไม่มี `--profile db`) = backend+frontend เท่านั้น (ใช้ DB ภายนอก)

### 4. สร้าง schema wf บน SQL Server ที่ self-host
```bash
# หลัง sqlserver healthy — รัน migration เข้า DB ใหม่
docker compose exec backend sh -c "cd /app && DB_MODE=remote node run_migrations.js"
# หรือ restore backup WINSpeed (dbo) แล้วจึง migrate wf
```

### บริการและพอร์ต
| Service | Image | Port | Volume |
|---------|-------|------|--------|
| backend | Node 22 (./backend) | 3000 | - |
| frontend | nginx (Vite build) | 80 | - |
| sqlserver | mcr.microsoft.com/mssql/server:2022 | 1433 | mssql_data |
| mysql | mysql:8.0 | 3306 | mysql_data |

### ข้อควรระวัง (Production)
- `MSSQL_PID=Express` ฟรีแต่จำกัด 10GB/DB → เปลี่ยนเป็น Developer/Standard ตาม license จริง
- เปลี่ยนรหัสผ่านทุกตัว (ดู [SECURITY.md](SECURITY.md)) · `CORS_ORIGIN` = domain จริง
- ตั้ง backup volume (`mssql_data`, `mysql_data`) + ทดสอบ restore
- ใส่ TLS ที่ reverse proxy (nginx/Traefik + Let's Encrypt) หน้า frontend/backend
