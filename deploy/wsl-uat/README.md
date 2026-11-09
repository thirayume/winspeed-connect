# On-Premise — จุดเริ่มติดตั้ง

12/10/2569 · Preparation only · **Production NO_GO**

อ่าน [คู่มือ IT / CI-CD](../../02-ONPREM-AND-CICD.md) และ [แผน/เกณฑ์ตรวจรับ](../../03-IMPLEMENTATION-PLAN.md) ก่อนดำเนินการ

## ชุดติดตั้งที่ใช้ต่อ

| ไฟล์ | หน้าที่ |
|---|---|
| docker-compose.office.yml | Caddy + API + web; API ต่อ HQ SQL ผ่าน VPN ด้วย DB_MODE=onprem ไม่มี SQL container |
| .env.office.example | แบบฟอร์มค่าระบบ; กรอก endpoint ที่ตรวจยืนยันและ credentials ของบัญชีเฉพาะระบบ |
| office-setup.sh | เตรียมไฟล์ runtime ภายในโฟลเดอร์นี้; สร้าง secret เมื่อขาด ไม่เริ่ม services |
| Caddyfile | Public HTTPS และ reverse proxy |
| sql/office-logins.sql | SQL provisioning ที่ต้องได้รับอนุมัติแยก ไม่รันจากการย้ายไฟล์ครั้งนี้ |
| templates/ | แบบเสนอ PROD/UAT และ CI candidate; ยังไม่แทนชุด office และไม่อนุมัติให้ deploy |

ใช้ working tree ทั้ง repository เพราะ build contexts อยู่ที่ `../../../backend` และ `../../../WSSale-App` เมื่อเรียก Compose จากโฟลเดอร์นี้ ห้ามคัดลอกเฉพาะ docs/ แล้วสั่ง build

## ขั้นตอนสำหรับรอบติดตั้งที่ได้รับอนุมัติ

```bash
cd /path/to/winspeed-frontend/docs/deploy/onprem
# เตรียมค่าระบบและบัญชีตามคู่มือ 02; ตรวจด้วยมือก่อนรัน setup
bash office-setup.sh
# ตรวจ configuration เท่านั้น; ไม่ควรเผยผล config ที่มี secrets
docker compose -f docker-compose.office.yml config --quiet
docker compose -f docker-compose.office.yml build
# เริ่ม services / ตรวจ connection / migration ต้องผ่าน gates และอนุมัติ target ก่อน
```

`.env` เดิมย้ายมาที่นี่แบบ opaque; **ยังไม่ยืนยันว่าค่าข้างในถูกต้องกับ HQ/VM ที่จะติดตั้ง** อย่าใช้อัตโนมัติเพราะไฟล์มีอยู่แล้ว `.env` และ `.env.migrator.local` ห้ามเข้า Git/ภาพ/container image/log

ชุด Cloud, workflow deploy Hostinger และ bootstrap แบบ restore SQL container เก่าถูกถอนจาก working tree ตามคำสั่งเจ้าของ เก็บ source ประวัติใน `docs/archive/retired-deployment-20261012.zip` เท่านั้น การนำ workflow ออกยังไม่ได้เปลี่ยน GitHub หรือ server จนกว่าจะมี push ที่เจ้าของอนุมัติ

ห้ามใช้ deployment เป็นทางลัดเปิด native flag หรือยุบ migration ที่ apply แล้ว ทุก migration ต้องคง checksum และผ่านแผน/รับตรวจตามเล่ม 05
