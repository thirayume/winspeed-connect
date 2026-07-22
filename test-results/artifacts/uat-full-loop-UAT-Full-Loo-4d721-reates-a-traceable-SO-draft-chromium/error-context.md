# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: uat-full-loop.spec.ts >> UAT Full Loop E2E >> 1. SALES creates a traceable SO draft
- Location: e2e\uat-full-loop.spec.ts:25:7

# Error details

```
Error: GET /so?search=UAT-MRVYVYT5&limit=100 returned 500: {"message":"Invalid column name 'RequestedAt'."}

expect(received).toContain(expected) // indexOf

Expected value: 500
Received array: [200]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e7]: WF
    - navigation [ref=e8]:
      - generic [ref=e9]:
        - button "หลัก" [ref=e10] [cursor=pointer]:
          - img [ref=e11]
          - img [ref=e13]
        - generic [ref=e15]:
          - button "Dashboard" [ref=e16]:
            - img [ref=e17]
          - button "ขาย" [ref=e22]:
            - img [ref=e23]
          - button "เสนอราคา" [ref=e27]:
            - img [ref=e28]
          - button "คลัง" [ref=e31]:
            - img [ref=e32]
          - button "Paper Trail" [ref=e35]:
            - img [ref=e36]
          - button "ตั๋วคงค้าง" [ref=e41]:
            - img [ref=e42]
      - generic [ref=e45]:
        - button "การเงิน" [ref=e47] [cursor=pointer]:
          - img [ref=e48]
          - img [ref=e51]
        - generic:
          - button "รีเบท (App)" [ref=e53]:
            - img [ref=e54]
          - button "ของแถม" [ref=e59]:
            - img [ref=e60]
      - generic [ref=e64]:
        - button "บัญชี" [ref=e66] [cursor=pointer]:
          - img [ref=e67]
          - img [ref=e69]
        - button "ชุดตั๋วคุม" [ref=e71]:
          - img [ref=e72]
    - generic [ref=e75]:
      - button "ออกจากระบบ" [ref=e76]:
        - img [ref=e77]
      - button [ref=e80]:
        - img [ref=e81]
  - generic [ref=e83]:
    - banner [ref=e84]:
      - generic [ref=e85]: ขาย — ใบสั่งขาย (POS)
      - generic [ref=e86]:
        - button "แจ้งเตือน" [ref=e87]:
          - img [ref=e88]
        - generic [ref=e91]:
          - generic [ref=e92]: E
          - generic [ref=e93]:
            - generic [ref=e94]: E2E Sales
            - generic [ref=e95]: SALES
    - main [ref=e96]:
      - generic [ref=e97]:
        - generic [ref=e98]:
          - generic [ref=e99]:
            - heading "Sales Portal" [level=1] [ref=e100]:
              - img [ref=e101]
              - text: Sales Portal
            - paragraph [ref=e105]: สั่งขายปุ๋ย · World Fert Co., Ltd.
          - generic [ref=e106]:
            - button [ref=e107]:
              - img [ref=e108]
            - button "สร้างบิล" [ref=e113]:
              - img [ref=e114]
              - text: สร้างบิล
        - generic [ref=e116]:
          - generic [ref=e117]:
            - generic [ref=e118]:
              - generic [ref=e119]:
                - img [ref=e120]
                - text: กำลังจัดทริปส่งสินค้า
              - generic [ref=e125]:
                - button "แก้ไขทริป" [ref=e126]
                - button "ยกเลิก" [ref=e127]
            - generic [ref=e128]:
              - generic [ref=e129]:
                - generic [ref=e130]: "ลูกค้า:"
                - generic [ref=e131]: คุณสมศักดิ์ ทดสอบ
              - generic [ref=e132]:
                - generic [ref=e133]: "ทะเบียนรถ:"
                - generic [ref=e134]: UAT-MRVYVYT5
              - generic [ref=e135]:
                - generic [ref=e136]: "กำหนดส่ง:"
                - generic [ref=e137]: 22 ก.ค. 2569
            - generic [ref=e138]:
              - button "เพิ่มบิลในทริปนี้" [ref=e139]:
                - img [ref=e140]
                - text: เพิ่มบิลในทริปนี้
              - button "ยืนยันออร์เดอร์" [ref=e141]:
                - img [ref=e142]
                - text: ยืนยันออร์เดอร์
          - generic [ref=e145]:
            - generic [ref=e146]:
              - img [ref=e147]
              - textbox "ค้นหา ลูกค้า / WfRef..." [ref=e150]
            - button "ตัวกรอง" [ref=e152]:
              - img [ref=e153]
              - text: ตัวกรอง
          - generic [ref=e157]:
            - img [ref=e158]
            - paragraph [ref=e162]: ไม่พบบิล
          - generic [ref=e163]:
            - generic [ref=e164]: หน้า 1 / 1 (0 รายการ)
            - generic [ref=e165]:
              - button [disabled] [ref=e166]:
                - img [ref=e167]
              - button [disabled] [ref=e169]:
                - img [ref=e170]
```

# Test source

```ts
  1   | import { expect, type Page } from '@playwright/test';
  2   | 
  3   | export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'W0rldF3rt';
  4   | export const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3000/api';
  5   | 
  6   | const observedPages = new WeakSet<Page>();
  7   | 
  8   | function captureBrowserDiagnostics(page: Page) {
  9   |   if (observedPages.has(page)) return;
  10  |   observedPages.add(page);
  11  |   page.on('pageerror', error => console.error(`[browser:pageerror] ${error.stack || error.message}`));
  12  |   page.on('console', message => {
  13  |     if (message.type() === 'error') console.error(`[browser:console] ${message.text()}`);
  14  |   });
  15  | }
  16  | 
  17  | export type ApiResult<T> = {
  18  |   status: number;
  19  |   body: T;
  20  | };
  21  | 
  22  | export async function login(page: Page, username: string, expectedDisplayName: string) {
  23  |   captureBrowserDiagnostics(page);
  24  |   await page.goto('/');
  25  |   await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
  26  |   await page.locator('input[type="text"]').fill(username);
  27  |   await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  28  |   await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  29  |   await expect(page.getByText(expectedDisplayName, { exact: true })).toBeVisible({ timeout: 15_000 });
  30  | }
  31  | 
  32  | export async function logout(page: Page) {
  33  |   await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  34  |   await expect(page.getByRole('heading', { name: 'WS-Sale-App' })).toBeVisible();
  35  | }
  36  | 
  37  | export async function openSidebar(page: Page, title: string) {
  38  |   const button = page.locator(`aside button[title="${title}"]`);
  39  |   await expect(button).toHaveCount(1);
  40  |   await expect(button).toBeVisible();
  41  |   await button.click({ force: true });
  42  | }
  43  | 
  44  | export async function api<T>(
  45  |   page: Page,
  46  |   path: string,
  47  |   options: { method?: string; data?: unknown; expectedStatuses?: number[] } = {},
  48  | ): Promise<ApiResult<T>> {
  49  |   const token = await page.evaluate(() => localStorage.getItem('wssale_token'));
  50  |   expect(token, `JWT is missing before ${options.method || 'GET'} ${path}`).toBeTruthy();
  51  |   const response = await page.request.fetch(`${API_BASE}${path}`, {
  52  |     method: options.method || 'GET',
  53  |     data: options.data,
  54  |     headers: {
  55  |       Authorization: `Bearer ${token}`,
  56  |       'Content-Type': 'application/json',
  57  |       'X-DB-Target': 'local',
  58  |     },
  59  |   });
  60  |   const text = await response.text();
  61  |   let body: unknown = null;
  62  |   try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  63  |   const allowed = options.expectedStatuses || [200];
  64  |   expect(
  65  |     allowed,
  66  |     `${options.method || 'GET'} ${path} returned ${response.status()}: ${text.slice(0, 500)}`,
> 67  |   ).toContain(response.status());
      |     ^ Error: GET /so?search=UAT-MRVYVYT5&limit=100 returned 500: {"message":"Invalid column name 'RequestedAt'."}
  68  |   return { status: response.status(), body: body as T };
  69  | }
  70  | 
  71  | export async function publicApi<T>(page: Page, path: string): Promise<ApiResult<T>> {
  72  |   const response = await page.request.get(`${API_BASE}${path}`, { headers: { 'X-DB-Target': 'local' } });
  73  |   const text = await response.text();
  74  |   let body: unknown = null;
  75  |   try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  76  |   expect(response.ok(), `GET ${path} returned ${response.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  77  |   return { status: response.status(), body: body as T };
  78  | }
  79  | 
  80  | export async function findOrder(page: Page, wfRefOrPlate: string) {
  81  |   const result = await api<{ data: any[] }>(page, `/so?search=${encodeURIComponent(wfRefOrPlate)}&limit=100`);
  82  |   return result.body.data || [];
  83  | }
  84  | 
  85  | export async function waitForOrderByPlate(page: Page, plate: string) {
  86  |   let order: any | undefined;
  87  |   await expect.poll(async () => {
  88  |     const rows = await findOrder(page, plate);
  89  |     order = rows.find(row => row.truckPlate === plate);
  90  |     return order?.wfRef || null;
  91  |   }, { timeout: 20_000, message: `order with plate ${plate} was not created` }).not.toBeNull();
  92  |   return order!;
  93  | }
  94  | 
  95  | export async function waitForOrderStatus(page: Page, wfRef: string, status: string) {
  96  |   let order: any | undefined;
  97  |   await expect.poll(async () => {
  98  |     const rows = await findOrder(page, wfRef);
  99  |     order = rows.find(row => row.wfRef === wfRef);
  100 |     return order?.status || null;
  101 |   }, { timeout: 25_000, message: `${wfRef} did not reach ${status}` }).toBe(status);
  102 |   return order!;
  103 | }
  104 | 
  105 | export function runSuffix(prefix: string) {
  106 |   const source = process.env.E2E_RUN_ID || Date.now().toString(36);
  107 |   return `${prefix}-${source.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`;
  108 | }
  109 | 
```