# Deployment & Operations Guide — WorldFert Sale-App

> [!IMPORTANT]
> **ระบบ On-Premise ของ World Fertilizer ติดตั้งและทำงานอยู่บน Dell PowerEdge R740 (R740-SRV)**
> ภายใต้สภาพแวดล้อม **Ubuntu WSL บน Windows Server 2022**
> ประกอบด้วย **Docker Engine + Docker Compose + Caddy Reverse Proxy (HTTPS/ACME) + Portainer**
> เชื่อมต่อไปยังฐานข้อมูล SQL Server (WinSpeed HQ) โดยตรง

---

## 1. โครงสร้างโฟลเดอร์ Deploy แบบรวมศูนย์

```
deploy/
├── README.md                  # คู่มือภาพรวมการ Deploy และการบำรุงรักษา
├── r740/                      # 🟢 ชุด Deploy หลักสำหรับ R740-SRV (PROD & UAT)
│   ├── deploy-r740.ps1        # PowerShell deploy automation สำหรับ R740
│   ├── r740-deploy.sh         # Linux deploy script ภายใน WSL
│   ├── compose.edge-prod.yml  # Docker Compose สำหรับ Edge Production
│   ├── bootstrap.sh           # Script เริ่มต้นระบบบนเครื่องใหม่
│   ├── migrate-company.sh     # Script migrate ฐานข้อมูลบริษัท
│   ├── targets/               # ค่าคอนฟิกเป้าหมาย (prod.env, uat.env)
│   ├── server/                # Batch files สำหรับ Windows Host:
│   │   ├── Deploy-PROD.bat    # คำสั่ง Deploy Production ใน 1 คลิก
│   │   ├── Deploy-UAT.bat     # คำสั่ง Deploy UAT ใน 1 คลิก
│   │   ├── Deploy-HOTFIX.bat  # คำสั่ง Deploy Hotfix ด่วน
│   │   └── Migrate-Company.bat# คำสั่ง Migrate ฐานข้อมูล
│   ├── host/                  # สคริปต์ตรวจเช็กและบำรุงรักษาเครื่อง Host
│   │   ├── Check-SaleAppHost.ps1
│   │   ├── Refresh-UAT.ps1
│   │   └── SaleApp-KeepAlive.ps1
│   ├── client/                # ติดตั้ง Root CA ใบรับรอง HTTPS บนเครื่องผู้ใช้
│   │   └── Install-SaleAppCert.bat
│   └── sql/                   # สคริปต์ SQL Principals, Backup และ User Permissions
│       ├── r740-prod-principals.sql
│       ├── r740-uat-principals.sql
│       └── r740-grant-app-access.sql
└── wsl-uat/                   # 🟡 ชุดทดสอบ UAT บนเครื่องพัฒนา (WSL2)
    ├── wsl-deploy.sh          # สคริปต์ Deploy บน WSL2
    ├── deploy-wsl.bat         # Batch file สั่งรัน deploy บน Windows
    ├── Caddyfile.uat          # Caddy config สำหรับจำลอง HTTPS บนเครื่อง
    └── uat-compose-quickstart.md
```

---

## 2. ขั้นตอนการ Deploy บน R740-SRV

1. **การ Deploy ปกติ (ผ่าน Windows Server Host):**
   - ไปที่ `D:\SaleApp\server\` หรือรันคำสั่ง:
     - สำหรับ UAT: รัน `Deploy-UAT.bat`
     - สำหรับ PROD: รัน `Deploy-PROD.bat`
2. **การกู้คืนและรีสตาร์ต:**
   - Caddy และ Docker ทำงานแบบ `restart: unless-stopped`
   - หากมีการรีสตาร์ต Windows Server ระบบ WSL และ Docker จะกลับมาทำงานอัตโนมัติผ่าน `SaleApp-KeepAlive.ps1`

---

## 3. เอกสารอ้างอิงฉบับเต็ม
- คู่มือปฏิบัติการ IT และ Deploy บน R740: `docs/sale-app/handover/04-คู่มือปฏิบัติการ-IT-และ-Deploy.docx`
- รันบุ๊กฐานข้อมูล: `docs/DEPLOYMENT-DATABASE-RUNBOOK-V1.7.0.md`
- สถาปัตยกรรมระบบและแผนภาพ 17 แบบ: `docs/sale-app/handover/10-สถาปัตยกรรมระบบและแผนภาพ-World-Fert.docx`
