# คู่มือ LINE Login + LINE OA (Messaging API) — WS-Sale-App

> 📌 **สถานะปัจจุบัน: ยังไม่ได้ตั้งค่า และ *ไม่จำเป็น* ต่อการใช้งาน**
> ไม่ใส่ค่า LINE ระบบทำงานได้ปกติทุกอย่าง แค่ปุ่ม **Login with LINE** จะใช้ไม่ได้
> เอกสารนี้ทำไว้ล่วงหน้าสำหรับตอนที่จะออกแบบ LINE OA / LINE Login ใหม่ให้รองรับ code version นี้

---

## 1. โค้ดมี 2 ระบบ LINE ที่แยกกันคนละตัว

หลายคนสับสนว่าเป็นเรื่องเดียวกัน — **ไม่ใช่** ต้องสร้าง channel คนละอันใน LINE Developers

| | **LINE Login** | **LINE Messaging API (OA)** |
|---|---|---|
| ใช้ทำอะไร | ให้พนักงาน login ด้วย LINE แทนรหัสผ่าน | ส่งแจ้งเตือนเข้า LINE ของพนักงาน |
| ประเภท channel | **LINE Login** | **Messaging API** |
| env ที่ใช้ | `LINE_LOGIN_*` (4 ตัว) | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` |
| endpoint | `/api/auth/line/*` | `/api/line/*` |
| จำเป็นไหม | ไม่ | ไม่ |

---

## 2. LINE Login — flow ที่โค้ดทำจริง

```
ผู้ใช้กด "Login with LINE" ที่หน้า login
   │
   ├─► GET /api/auth/line/start          สร้าง state แล้ว redirect ไป LINE
   │
   ├─► LINE ให้ผู้ใช้ยืนยันตัวตน
   │
   └─► GET /api/auth/line/callback       แลก code เป็น token + ดึง profile
          │
          ├── เจอ LineUserId ใน wf.AppUser ─► login สำเร็จ redirect กลับพร้อม token
          │
          └── ไม่เจอ (ครั้งแรก) ─────────► redirect กลับพร้อม line_link_token
                                             หน้าเว็บให้กรอก username/password เดิม
                                             ─► POST /api/auth/line/link
                                                ผูก LineUserId เข้ากับบัญชีนั้น
```

**สำคัญ:** ระบบ**ไม่สร้างบัญชีใหม่**จาก LINE — ผู้ใช้ต้องมีบัญชีในระบบอยู่ก่อน (จาก `seed_admin.js`)
แล้วผูก LINE เข้ากับบัญชีเดิมครั้งแรกครั้งเดียว → ครั้งต่อไปกดปุ่มเดียวเข้าได้เลย

**เก็บข้อมูลที่** `wf.AppUser` (migration `035_line_login_app_user.sql`):
`LineUserId` (unique) · `LineDisplayName` · `LinePictureUrl` · `LineLinkedAt`

**endpoint ทั้งหมด**
| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/auth/line/start` | เริ่ม OAuth |
| GET | `/api/auth/line/callback` | รับกลับจาก LINE |
| POST | `/api/auth/line/link` | ผูก LINE กับบัญชีเดิม (มี rate limit) |
| GET | `/api/auth/line/status` | เช็คว่าตั้งค่า LINE Login ไว้หรือยัง |

---

## 3. ตั้งค่า LINE Login (ทีละขั้น)

### 3.1 สร้าง channel
1. เข้า [LINE Developers Console](https://developers.line.biz/console/) → login ด้วย LINE
2. สร้าง **Provider** (ชื่อบริษัท เช่น World Fertilizer)
3. **Create a new channel** → เลือก **LINE Login**
4. กรอกชื่อ/รูป/หมวดหมู่ → App types เลือก **Web app**

### 3.2 ลงทะเบียน Callback URL ใน LINE Console

แท็บ **LINE Login** → **Callback URL** — ต้องลงทะเบียน **ทุกโดเมนที่จะใช้จริง**

| ปลายทาง | Callback URL ที่ต้องลงทะเบียน |
|---|---|
| B · Coolify | `https://api.178-104-120-21.sslip.io/api/auth/line/callback` |
| C · On-Prem | `https://api.<ddns>/api/auth/line/callback` |
| dev ในเครื่อง | `http://localhost:3000/api/auth/line/callback` |

> ใส่ได้หลายบรรทัด (dev + production พร้อมกัน) — **ควรใส่ให้ครบทุกปลายทางตั้งแต่แรก**
> ⚠️ ต้องตรงทุกตัวอักษร รวม `https` และ `/api` — LINE ตรวจ `redirect_uri` กับรายการนี้เสมอ
> ผิดนิดเดียวได้ `invalid_request` **แม้จะไม่ได้ตั้ง env ก็ตาม** (ดูข้อ 3.3)

### 3.3 เอาค่ามาใส่ env

แท็บ **Basic settings** → คัดลอก **Channel ID** และ **Channel secret**

```ini
# บังคับ 2 ตัวนี้ — ไม่มีแล้ว /line/start ตอบ 400 "LINE Login is not configured"
LINE_LOGIN_CHANNEL_ID=1234567890
LINE_LOGIN_CHANNEL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 2 ตัวนี้ "ไม่บังคับ" — ไม่ตั้งระบบจะสร้างเองจาก request (ดูตารางด้านล่าง)
LINE_LOGIN_CALLBACK_URL=
LINE_LOGIN_SUCCESS_REDIRECT=
```

> 🔄 **เปลี่ยนตั้งแต่ v1.2.1** — เดิม 2 ตัวหลังเป็นค่าบังคับ ตอนนี้มี dynamic fallback
> ออกแบบมาเพื่อให้ backend ตัวเดียวรองรับหลายโดเมนได้ (เรามี 3 ปลายทาง deploy)

| ตัวแปร | ไม่ตั้งแล้วเกิดอะไร |
|---|---|
| `LINE_LOGIN_CALLBACK_URL` | สร้างจาก request: `{x-forwarded-proto \|\| protocol}://{host}/api/auth/line/callback` |
| `LINE_LOGIN_SUCCESS_REDIRECT` | ใช้ **origin ของ `Referer`** ที่กดปุ่มมา · ถ้าไม่มี → `http://localhost:5173` |

**ตั้งเมื่อไรดี**
- **ไม่ต้องตั้ง** — เมื่อมีปลายทางเดียว/หลายปลายทาง และ reverse proxy ส่ง `X-Forwarded-Proto` ถูก (Traefik ของ Coolify และ Caddy ของ on-prem ส่งให้อยู่แล้ว)
- **ควรตั้ง** — เมื่อต้องการบังคับโดเมนตายตัว หรือ proxy ไม่ส่ง `X-Forwarded-Proto` (จะได้ `http://` ผิด)

**กลไกภายใน:** ค่า callback/redirect ที่ตัดสินใจตอน `/line/start` ถูกฝังใน OAuth `state`
ซึ่ง **เซ็นด้วย HMAC-SHA256 และหมดอายุใน 10 นาที** → ตอน `/line/callback` อ่านกลับจาก state
ไม่ใช่จาก env ทำให้หลายโดเมนใช้ backend เดียวกันได้อย่างปลอดภัย

- **Coolify** → wf-backend → Environment Variables → Developer view → เพิ่มค่า → **Redeploy**
- **On-Prem** → แก้ `deploy/onprem/.env` → `docker compose up -d`

### 3.4 เปิด scope
แท็บ **LINE Login** → **OpenID Connect** → เปิด · ต้องมี scope `profile` และ `openid`

### 3.5 ทดสอบ
```bash
curl https://api.<โดเมน>/api/auth/line/status
```
ควรตอบว่าตั้งค่าแล้ว → เปิดหน้า login กด **Login with LINE** → ครั้งแรกจะให้กรอก username/password เพื่อผูกบัญชี

---

## 4. LINE OA / Messaging API (แจ้งเตือน)

### endpoint
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/api/line/webhook` | LINE ยิงเข้ามา · ตรวจ `x-line-signature` |
| POST | `/api/line/notify` | ให้แอปส่งข้อความ (ต้อง login ก่อน) · ใช้ push message |
| GET | `/api/line/status` | เช็คสถานะการตั้งค่า |

### ตั้งค่า
1. LINE Developers → Create channel → **Messaging API** (คนละอันกับ LINE Login)
2. แท็บ **Messaging API**:
   - **Channel access token** → กด Issue แล้วคัดลอก
   - **Webhook URL** = `https://api.<โดเมน>/api/line/webhook` → **Use webhook = เปิด**
   - ปิด **Auto-reply messages** และ **Greeting messages** (ไม่งั้นบอทตอบทับ)
3. แท็บ **Basic settings** → คัดลอก **Channel secret**

```ini
LINE_CHANNEL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxx....
```

> ⚠️ **2 ตัวนี้ยังไม่มีใน `.env.coolify.example`** — ต้องเพิ่มเองตอนจะใช้จริง
> ⚠️ ผู้ใช้ต้อง **เพิ่ม OA เป็นเพื่อน** ก่อน ไม่งั้น push message ส่งไม่ถึง

---

## 5. ตาราง env ทั้งหมด

| ตัวแปร | ระบบ | ตัวอย่าง |
|---|---|---|
| `LINE_LOGIN_CHANNEL_ID` | Login | `1234567890` |
| `LINE_LOGIN_CHANNEL_SECRET` | Login | (32 ตัวอักษร) |
| `LINE_LOGIN_CALLBACK_URL` | Login | *(ไม่บังคับ)* `https://api.<domain>/api/auth/line/callback` |
| `LINE_LOGIN_SUCCESS_REDIRECT` | Login | *(ไม่บังคับ)* `https://<domain>` |
| `LINE_CHANNEL_SECRET` | OA | (32 ตัวอักษร) |
| `LINE_CHANNEL_ACCESS_TOKEN` | OA | (ยาวมาก) |

---

## 6. ข้อควรพิจารณาตอนออกแบบใหม่

ถ้าจะรื้อ LINE OA / LINE Login ใหม่ให้เข้ากับ code version นี้ ประเด็นที่ควรตัดสินใจก่อนลงมือ:

**ก) หนึ่ง OA ทุกลูกค้า หรือแยกต่อลูกค้า**
- แยกต่อลูกค้า = ลูกค้าเห็นแบรนด์ตัวเอง · ข้อมูลไม่ปนกัน · **เหมาะกับโมเดล SaaS ของเรา**
  แต่ลูกค้าต้องสร้าง channel เอง แล้วเอา 6 ค่ามาใส่ (ใส่ไว้ในใบสั่งงานลูกค้าใน `CLONE-RECIPE.md`)
- OA เดียว = จัดการง่ายกว่า แต่ต้องแยกผู้ใช้ด้วย `LineUserId` เอง และแบรนด์เป็นของเรา

**ข) การผูกบัญชีครั้งแรก**
ตอนนี้ให้กรอก username/password เดิมเพื่อผูก — ทางเลือกอื่น: ให้ ADMIN ผูกให้จากหน้า User Management (ปลอดภัยกว่า พนักงานไม่ต้องรู้รหัสตัวเอง) หรือใช้ LINE OA ส่งลิงก์ผูกเฉพาะบุคคล

**ค) `LineUserId` ต่างกันคนละ channel**
ผู้ใช้คนเดียวกันจะได้ `LineUserId` **คนละค่า** ใน LINE Login channel กับ Messaging API channel
ถ้าจะให้ทั้ง login และแจ้งเตือนเป็นคนเดียวกัน ต้องใช้ **LINE Login + Messaging API ที่อยู่ Provider เดียวกัน** และเปิด **Linked OA** ในหน้า LINE Login (สำคัญมาก มักพลาดข้อนี้)

**ง) ขอบเขตการแจ้งเตือน**
ตอนนี้มี `/api/line/notify` เป็น push แบบทั่วไป ยังไม่ผูกกับ event ทางธุรกิจ
ถ้าจะทำจริงควรกำหนดก่อนว่าจะแจ้งอะไร เช่น SO รออนุมัติ · ชั่งออกไม่ตรง SO · rebate ใกล้หมดอายุ
แล้วยิงจาก `wf.Outbox` (มี worker อยู่แล้ว) เพื่อกัน notification หายเวลา LINE ล่ม

**จ) ความเป็นส่วนตัว (PDPA)**
`LineDisplayName` / `LinePictureUrl` เป็นข้อมูลส่วนบุคคล — ระบบมี `wf` retention/DSAR (migration `028`) ควรรวม field พวกนี้เข้าไปในนโยบายลบข้อมูลด้วย

---

## 7. แก้ปัญหา

| อาการ | สาเหตุ |
|---|---|
| `invalid_request` ตอน redirect ไป LINE | Callback URL **ไม่ได้ลงทะเบียนใน LINE Console** · ถ้าไม่ได้ตั้ง env ให้ดูว่า proxy ส่ง `X-Forwarded-Proto`/`Host` ถูกไหม (ได้ `http://` แทน `https://` จะไม่ตรงรายการ) |
| กดปุ่มแล้วไม่มีอะไรเกิดขึ้น | ยังไม่ได้ตั้ง 4 ตัวแปร `LINE_LOGIN_*` (เช็คด้วย `/api/auth/line/status`) |
| login ผ่านแต่เด้งกลับหน้า login | `LINE_LOGIN_SUCCESS_REDIRECT` ผิดโดเมน หรือชนกับ `CORS_ORIGIN` · ถ้าไม่ได้ตั้ง ระบบใช้ origin ของ `Referer` — เบราว์เซอร์ที่ตัด referer จะตกไป `localhost:5173` |
| `invalid LINE state` / `LINE state expired` | ทิ้งหน้า login ค้างเกิน **10 นาที** แล้วค่อยกด · หรือ `JWT_SECRET` เปลี่ยนระหว่างทาง (state เซ็นด้วย secret เดียวกัน) |
| ผูกบัญชีแล้วแต่ครั้งต่อไปยังให้ผูกอีก | `LineUserId` ไม่ได้ถูกบันทึก — ตรวจสิทธิ์ `wf_owner` เขียน `wf.AppUser` ได้ไหม |
| webhook ขึ้น 401/403 | `LINE_CHANNEL_SECRET` ผิด → ตรวจ `x-line-signature` ไม่ผ่าน |
| push ไม่ถึงผู้ใช้ | ผู้ใช้ยังไม่ได้เพิ่ม OA เป็นเพื่อน · หรือใช้ `LineUserId` ข้าม channel |
