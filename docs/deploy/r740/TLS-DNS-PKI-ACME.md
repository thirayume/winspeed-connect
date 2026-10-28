# HTTPS บน R740: DNS, PKI บริษัท และ ACME

สถานะ 28 ต.ค. 2569: UAT ใช้ `https://172.16.30.169:8444` ผ่าน Caddy internal CA ได้แล้ว
แต่ DNS และ PKI บริษัทยังไม่ได้ดำเนินการ ส่วน Production ยังไม่มี stack ที่ให้บริการบน 443
การเตรียม portproxy/firewall 80/443 เสร็จแล้ว ไม่ใช่หลักฐานว่าเปิด Production HTTPS สำเร็จ

## เลือกแนวทางใบรับรอง

| แนวทาง | สิ่งที่ต้องเตรียม | การเชื่อถือจากเครื่องผู้ใช้ |
|---|---|---|
| ชั่วคราว: IP + Caddy internal CA | เจ้าของเลือกแนวทางนี้สำหรับ Production ระหว่างรอ DNS/PKI แล้ว | ต้องติดตั้ง root ที่ตรวจ fingerprint แล้วบนอุปกรณ์ทุกเครื่อง |
| DNS ภายใน + PKI บริษัท | FQDN จริง, DNS A record, server certificate/chain และ private key บนเซิร์ฟเวอร์ | เครื่องผู้ใช้ต้องเชื่อถือ root/intermediate ของบริษัท และเข้าถึงจุดตรวจเพิกถอนได้ |
| โดเมนสาธารณะ + ACME | โดเมนที่องค์กรควบคุมและวิธีพิสูจน์สิทธิ์ | ใช้ trust ของ CA ที่เลือก พร้อมระบบต่ออายุ |

Caddy รองรับทั้ง internal issuer และไฟล์ใบรับรอง/กุญแจที่ออกให้แล้ว
([เอกสาร TLS ของ Caddy](https://caddyserver.com/docs/caddyfile/directives/tls)).

## ข้อมูลที่ให้ IT จัดเตรียม

1. FQDN Production และ UAT ที่ไม่ซ้ำกัน, ผู้ดูแล DNS, DNS zone และ TTL ช่วงเปลี่ยนระบบ
   ใช้ชื่อที่ IT จัดให้จริง; ไม่มีชื่อโดเมนที่กำหนดแทนไว้ในระบบตอนนี้
2. A record ภายในชี้ไป `172.16.30.169`; บันทึก AAAA เฉพาะเมื่อเส้นทาง IPv6 ใช้งานได้จริง
3. สำหรับ PKI: SAN ต้องตรงกับ FQDN ที่ผู้ใช้เปิด, มี server-auth usage, ไม่หมดอายุ,
   chain ครบ และ private key ตรงกับ certificate ให้ IT ตรวจบนเซิร์ฟเวอร์เอง
4. แจ้งเฉพาะ **ตำแหน่งไฟล์** certificate/full chain/key, issuer, วันหมดอายุ และผู้รับผิดชอบ
   ต่ออายุ ไม่ส่ง private key, รหัสผ่าน PFX หรือ DNS API token ในแชต/อีเมล/รีโป
5. เก็บไฟล์ใต้ `D:\SaleApp\prod\config\tls` นอก Git จำกัด ACL ให้ผู้ดูแลกับ process ที่อ่านจริง
   หากต้นฉบับเป็น PFX ให้ IT แปลง/นำเข้าในเครื่องโดยป้อนรหัสผ่านแบบซ่อนค่า
6. ระบุช่องทางติดตั้ง root/intermediate บนอุปกรณ์ และ URL CRL/OCSP ที่ client ต้องเข้าถึง

## งานปรับ release ก่อนใช้ PKI

ไฟล์ ingress ปัจจุบัน `docs/deploy/onprem/Caddyfile.uat` ใช้ `tls internal` เสมอ
การเปลี่ยน `APP_DOMAIN` อย่างเดียว **ไม่ทำให้ใช้ PKI หรือ ACME** ต้องทำ release ดังนี้ก่อน:

1. เพิ่ม TLS mode ที่ตรวจจาก target ใน Git และตั้งชื่อ DNS/CORS ให้ตรงกัน
2. เพิ่มการส่ง certificate/key ให้ Caddy เป็นไฟล์แบบอ่านอย่างเดียวจาก server config
   ไม่ฝัง key ใน Docker image และไม่ส่งให้ backend/migrator; ปรับ Compose validator ให้ตรวจ
   เฉพาะ mount ที่อนุมัติ ปัจจุบัน validator ไม่ยอมรับ host bind mount
3. สำหรับ PKI ให้ site block ใช้ certificate chain และ key ที่ mount แล้ว เช่นรูปแบบ
   `tls /run/tls/fullchain.pem /run/tls/server.key` โดย path นี้เป็นตัวอย่างใน container
4. ทดสอบ config ด้วย `caddy validate` ใน image ที่จะ deploy; ตรวจ cert/key/chain, สิทธิ์อ่าน
   และการต่ออายุ/rollback ใน UAT ก่อน promote ห้ามแก้ Caddyfile ใน container ที่รันอยู่
5. เปลี่ยน DNS/target/CORS ใน release เดียวกัน แล้วทดสอบผู้ใช้จริงด้วยชื่อ DNS ใหม่
   เก็บใบรับรองเดิมและ config เดิมเพื่อ rollback ตามแผนของ IT

## ACME สำหรับระบบภายใน

ถ้าใช้โดเมนที่องค์กรควบคุมแต่เปิดแอปเฉพาะ LAN/VPN ให้พิจารณา DNS-01: พิสูจน์สิทธิ์ผ่าน
public DNS TXT โดยไม่ต้องเปิดแอปให้เข้าจากอินเทอร์เน็ต เลือก provider หลังทราบ DNS จริง,
เพิ่ม provider module ใน Caddy image, และให้ token มีสิทธิ์เฉพาะ zone/record ที่จำเป็น
([Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)).

HTTP-01 ต้องให้ CA เข้าถึงพอร์ต 80 จากภายนอก และ TLS-ALPN-01 ใช้ 443 อย่าเปลี่ยน firewall
จากวง LAN เดิมเป็น public เพื่อทดลองโดยไม่ได้เตรียมเส้นทางและขอบเขตใช้งานให้ครบ
การใช้ DNS-01 ต้องคง public validation record ไว้ตามขั้นตอนต่ออายุ แม้ A record ภายในจะเป็น
private IP ใช้ staging CA ทดสอบ challenge ก่อนขอใบจริง และเฝ้าติดตามวันหมดอายุ/ผลต่ออายุ
([Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)).

## ตรวจรับ HTTPS หลัง deploy

- จากเครื่องผู้ใช้: DNS ต้อง resolve ถูก host และ HTTPS ต้องผ่าน chain, SAN, เวลา และนโยบาย
  revocation ของบริษัทโดยไม่กดข้าม certificate warning
- เปิด `/`, `/api/health`, login และ API หลัง login ตรวจ SQL `up` และไม่มี mixed content/CORS error
- HTTP 80 ต้อง redirect ไปชื่อ Production บน HTTPS 443; UAT 8091 ต้องยังไป 8444
- ตรวจว่าพอร์ต 443 รับ certificate ของ Production และไม่ได้ส่งต่อไป UAT 8444
- SSRS ที่ `http://R740-SRV:8888/Reports_SQL2008` และ `ReportServer_SQL2008` ต้องยังใช้ได้
- ทดลอง renew/reload แล้วตรวจ cert ใหม่; มีผู้รับผิดชอบและช่องทางแจ้งเตือนก่อนหมดอายุ

ผลตรวจปัจจุบัน: UAT ผ่าน Python TLS validation ด้วย public Caddy root และ IP SAN, TLS 1.3
Windows Schannel ผ่านคำสั่งทดสอบยังรายงานว่าไม่ทราบสถานะเพิกถอนของ private CA จึงยังไม่ถือว่า
ทุก client ผ่านนโยบายบริษัท ห้ามแก้ด้วยการปิด TLS/revocation validation ทั่วเครื่อง

Public root fingerprint (DER SHA-256):
`372F32028D78F537D652F300E3650F5D3D3CBAFF207FB8D9A8ED86DAF31D0FA8`.
ใช้ installer ที่ pin fingerprint ไว้ใน `client/Install-SaleAppCert.bat` เมื่อต้องใช้ CA ชั่วคราว
installer นี้ไม่ได้ทำให้ private CA กลายเป็นใบรับรอง PKI บริษัท
