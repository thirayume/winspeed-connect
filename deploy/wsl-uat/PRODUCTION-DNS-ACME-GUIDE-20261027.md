# คู่มือเตรียม DNS และ HTTPS สำหรับ Production บน R740-SRV

สถานะปัจจุบัน ณ 27/10/2569: เซิร์ฟเวอร์ R740-SRV มี private IP `172.16.30.169`; ย้าย URL ของ SSRS Web Service และ Report Manager จากพอร์ต 80 ไปพอร์ต 8888 ตามที่ผู้ใช้อนุญาตแล้ว และตรวจไม่พบ listener เดิมบนพอร์ต 80. URL `http://r740-srv:8888/ReportServer_SQL2008` ตอบ HTTP 401 เมื่อยกเลิกหน้าต่างยืนยันตัวตน จึงยืนยันได้เพียงว่า endpoint ตอบสนอง ยังไม่ได้ยืนยันการเปิดรายงานด้วยบัญชีผู้ใช้. พอร์ต 443 เป็น Windows Portproxy (`iphlpsvc`, PID 2720) ส่งต่อ `172.16.30.169:443` ไป `127.0.0.1:443`; ปลายทาง loopback ยังไม่มี listener และไม่มี SSL binding บน HTTP.sys. UAT ใช้ Docker Engine ใน Ubuntu WSL2 และ Caddy เปิด 8080/8444; ยังไม่มี Production stack หรือ WSL listener บน 443. เอกสารนี้เป็นแนวทางเตรียมงาน ไม่ใช่การอนุมัติให้เปิดบริการสู่อินเทอร์เน็ต

## ทางเลือกใบรับรอง

| รูปแบบ | เหมาะกับ | สิ่งที่ต้องมี |
|---|---|---|
| DNS ภายใน + PKI บริษัท | ใช้เฉพาะ LAN/VPN และต้องการเริ่มก่อนโดเมนสาธารณะพร้อม | hostname ภายในที่กำหนดโดย IT, DNS ภายในชี้ไป `172.16.30.169`, ใบรับรองจาก PKI ที่มี SAN ตรงกับ hostname และ chain ที่อุปกรณ์ผู้ใช้เชื่อถือ |
| DNS สาธารณะ + ACME/Let's Encrypt | เข้าถึงจากภายนอกหรือใช้ hostname สาธารณะ | โดเมนที่บริษัทควบคุม, public DNS, เส้นทางเครือข่ายไป R740 และให้ Caddy รับพอร์ต 80/443 หรือใช้ DNS-01 ตามรายละเอียดด้านล่าง |

ใช้ hostname ที่องค์กรเป็นเจ้าของจริง ห้ามใช้ IP `172.16.30.169` เป็นชื่อใบรับรองสาธารณะ และอย่าใช้ `.local` เป็นชื่อระบบใหม่โดยไม่ผ่านนโยบาย DNS ของบริษัท

## ลำดับเตรียม Public DNS + ACME

1. **กำหนดชื่อระบบ** — ขอ FQDN เช่น `sale.<โดเมนบริษัท>` จากผู้ดูแลโดเมน ระบุว่าจะให้บริการจากอินเทอร์เน็ตหรือเฉพาะ LAN/VPN และกำหนดผู้รับแจ้งเตือนใบรับรอง
2. **กำหนด DNS** — เมื่อฝ่ายโดเมนอนุมัติ ให้สร้าง `A` record ไปยัง public IP/NAT ของสำนักงาน ไม่ใช่ private IP `172.16.30.169` โดยตรง เพิ่ม `AAAA` เฉพาะเมื่อ IPv6 ของสำนักงานวิ่งถึง R740 จริง หากผู้ใช้ภายในใช้ split-horizon DNS ให้กำหนดและทดสอบทั้งคำตอบ public และภายในก่อนเปิดใช้
3. **กำหนดเครือข่าย** — สำหรับ HTTP-01/TLS-ALPN-01 ต้องทำให้ public CA เข้าถึง public TCP 80/443 และ forward/firewall ไปยัง Caddy บน R740 ได้ ตรวจสอบ firewall ของ host, edge firewall/router, ISP และ NAT ครบทุกชั้น อย่าเปิด SQL Server, RDP หรือพอร์ต backend สู่อินเทอร์เน็ต
4. **เคลียร์ listener ตามนัด** — SSRS ย้ายไปพอร์ต 8888 แล้ว. ให้ผู้ใช้รายงานตรวจ URL ใหม่ทั้งสองรายการและบันทึกวิธีคืนค่า URL/พอร์ตก่อนเปิด ingress. พอร์ต 443 มี Portproxy อยู่แล้วแต่ปลายทาง `127.0.0.1:443` ยังไม่มีบริการ; ให้ Production Caddy ใช้ปลายทางนั้นหลังได้ FQDN/certificate ที่เชื่อถือได้ และเพิ่มเส้นทางพอร์ต 80 สำหรับ WSL อย่างมีแผน rollback
5. **ตั้ง Caddy ให้ใช้ FQDN จริง** — ใช้ release config ที่ผ่าน review ให้ site block ระบุ FQDN ชัดเจน และ proxy `/api`, `/socket.io` กับเส้นทางที่จำเป็นไป backend ส่วนหน้าเว็บไป frontend เก็บ Caddy `/data` และ `/config` ใน persistent volume; ห้ามลบ volume ใบรับรองระหว่าง redeploy และ pin image เป็น digest ใน release
6. **ทดสอบด้วย ACME staging ก่อน** — ตั้ง ACME directory เป็น `https://acme-staging-v02.api.letsencrypt.org/directory` สำหรับทดสอบ config/การเข้าถึง แล้วจึงนำค่า staging ออกและขอใบรับรอง production เพื่อลดการชน rate limits staging certificate จะไม่ถูก trust โดย browser และห้ามใช้เป็นใบรับรองจริง
7. **ทดสอบจากภายนอกเครือข่ายสำนักงาน** — ตรวจ DNS, HTTP redirect ไป HTTPS, TLS chain/วันหมดอายุ/SAN ให้ตรง FQDN และเรียก API health แบบไม่ใช้ `-k` หรือปิดการตรวจ certificate ตรวจหน้าเว็บและ login ด้วยบัญชีทดสอบที่ได้รับอนุมัติ ตรวจซ้ำจาก LAN/VPN เพื่อจับปัญหา split DNS/NAT loopback
8. **เตรียม renewal/rollback** — Caddy จัดการออกและต่ออายุอัตโนมัติ ให้ persistent storage เขียนได้และอยู่ใน backup ที่ควบคุมสิทธิ์ ตรวจ log/วันหมดอายุเป็นระยะ หากใช้งาน provider DNS API ให้ใช้ token ที่จำกัดสิทธิ์และเก็บเป็น secret ไม่ใส่ใน Caddyfile, repo หรือ chat

### HTTP-01, TLS-ALPN-01 หรือ DNS-01?

- **HTTP-01** ใช้ public TCP 80 และเป็นค่าเริ่มต้นที่ตั้งง่าย เหมาะกับกรณี public DNS ชี้ถูกและ edge ส่ง port 80 ถึง Caddy
- **TLS-ALPN-01** ใช้ public TCP 443; ใช้ได้เมื่อ port 80 มีข้อจำกัดระหว่างการออกใบรับรอง แต่ในระบบนี้ port 443 ยังมี listener ที่ต้องระบุและเคลียร์ก่อน
- **DNS-01** ตรวจ TXT record `_acme-challenge` จึงไม่ต้องเปิด inbound port เพื่อพิสูจน์ชื่อ และเหมาะกับ wildcard/ระบบที่ไม่เปิด public listener อย่างไรก็ตาม Caddy ต้องมี build/plugin สำหรับ DNS provider ที่เลือก และต้องจัดการ DNS API token อย่างระมัดระวัง

หากเว็บใช้เฉพาะ LAN/VPN ให้เริ่มด้วย DNS ภายในและ PKI บริษัทจะเหมาะกว่า public ACME จนกว่าจะมีโดเมนสาธารณะและ network path ที่อนุมัติแล้ว

## รูปแบบ Internal DNS + PKI บริษัท

1. ขอ hostname ภายในจาก IT และให้ internal DNS ชี้ไป `172.16.30.169` เฉพาะเครือข่ายที่อนุญาต
2. ขอ certificate จาก PKI บริษัท โดยระบุ SAN เป็น FQDN เดียวกัน ขอ full chain และ private key ตามขั้นตอนที่บริษัทอนุมัติ
3. วาง certificate/key ใน secret store หรือไฟล์ที่ mount ให้ Caddy แบบ read-only จำกัด ACL ของ private key และไม่ใส่ key ใน Git, image, `.env` หรือ chat
4. ตั้ง Caddy ให้โหลด certificate/key จาก path ที่ mount ไว้ และตั้งขั้นตอนต่ออายุ/เปลี่ยนไฟล์พร้อม reload ที่ไม่ทำให้บริการหยุด
5. ตรวจว่าเครื่องผู้ใช้เชื่อถือ root/intermediate CA ของบริษัท และ browser แสดง FQDN ถูกต้องโดยไม่มีคำเตือน

## เกณฑ์ก่อน Go-Live

- มี hostname ที่เจ้าของระบบอนุมัติและ DNS ตอบตามแผนจากทั้ง LAN และภายนอก (หากเปิด public)
- SSRS ย้ายไปพอร์ต 8888 แล้ว; ผู้ใช้รายงานต้องยืนยันการเปิดรายงานผ่าน URL ใหม่ และมีขั้นตอน rollback ที่บันทึกไว้
- ยืนยัน Windows Portproxy 443 ไป `127.0.0.1:443` และตรวจว่ามี Production Caddy ปลายทางพร้อม certificate ที่เชื่อถือได้; ห้ามชี้ไป UAT `8444`
- ได้รับ certificate ที่เชื่อถือได้, SAN ตรง hostname, renewal ใช้งานได้ และ Caddy storage ถาวร
- production image ถูก pin ด้วย digest, env/secret แยกจาก UAT, และตรวจ target DB เป็น `R740-SRV\SQL2008` / `dbwins_worldfert9`
- มี backup copy นอก R740 และ restore drill บนฐาน TEST พร้อมแผน rollback migration ที่อนุมัติ
- UAT acceptance gates และ migration plan สำหรับ Production ผ่านการ review แล้ว

## แหล่งอ้างอิงทางการ

- Caddy Automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Caddy HTTPS quick start: https://caddyserver.com/docs/quick-starts/https
- Caddy troubleshooting (DNS, ports, split-horizon): https://caddyserver.com/docs/troubleshooting
- Caddy Caddyfile TLS directive: https://caddyserver.com/docs/caddyfile/directives/tls
- Caddy global `acme_ca` option: https://caddyserver.com/docs/caddyfile/options
- Let's Encrypt challenge types: https://letsencrypt.org/docs/challenge-types/
- Let's Encrypt staging environment: https://letsencrypt.org/docs/staging-environment/
- Let's Encrypt rate limits: https://letsencrypt.org/docs/rate-limits/
