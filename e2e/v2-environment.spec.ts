import { test, expect } from '@playwright/test';
const api = process.env.E2E_API_BASE || 'http://localhost:3000/api';
test('v2 baseline reports SQL Server readiness and version', async ({ request }) => {
 const response = await request.get(api + '/health'); expect(response.ok()).toBeTruthy();
 const body = await response.json(); expect(body.version).toBe('2.0.0'); expect(body.db.sqlserver).toBe('up'); expect(body.db.weighing).toBe('winspeed:WGHD');
});
test('Hostinger test rejects a request to switch to localhost database', async ({ request }) => {
 test.skip(!api.startsWith('https://api-test.thirayu.online/'), 'Hostinger-specific isolation gate');
 const response = await request.get(api + '/dbinfo', { headers: { 'X-DB-Target': 'local' } });
 expect(response.status()).toBe(400);
});
test('test frontend serves a built application', async ({ request, baseURL }) => {
 const response = await request.get(baseURL!); expect(response.ok()).toBeTruthy();
 const html = await response.text(); expect(html).toContain('id="root"'); expect(html).toContain('/assets/');
 const modulePath = html.match(/<script[^>]+src="([^"]+\.js)"/); expect(modulePath).not.toBeNull();
 const bundle = await request.get(new URL(modulePath![1],baseURL!).href); expect(bundle.ok()).toBeTruthy();
 const source = await bundle.text(); expect(source).toContain('https://api-test.thirayu.online/api'); expect(source).not.toContain('https://test-api.thirayu.online');
});
