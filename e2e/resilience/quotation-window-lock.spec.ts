import { test, expect } from '@playwright/test';
test('a hidden old quotation still locks the trip without exposing or opening its details', async ({ page }) => {
  await page.goto('/tests/quotation-window-lock.html');
  const oldTrip = page.locator('div.rounded-2xl').filter({ hasText: 'FIXTURE-OLD' });
  const newTrip = page.locator('div.rounded-2xl').filter({ hasText: 'FIXTURE-NEW' });
  await expect(oldTrip.getByText('มีใบเสนอราคาค้างก่อนวันเริ่มข้อมูล กรุณาติดต่อผู้ดูแล')).toBeVisible();
  await expect(oldTrip.getByTitle('ต้องยกเลิกใบเสนอราคาก่อน')).toBeDisabled();
  await expect(oldTrip.getByRole('button', { name: 'เปิดใบเสนอราคา' })).toHaveCount(0);
  await expect(newTrip.getByText('รอเสนอราคา Q-NEW')).toBeVisible();
  await expect(newTrip.getByRole('button', { name: 'เปิดใบเสนอราคา' })).toBeVisible();
});
