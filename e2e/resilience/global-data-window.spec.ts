import {test,expect} from '@playwright/test';

test('date setting submits only after edit, retains stale changes, and saves with expected value',async({page})=>{
  let calls=0;
  await page.route('**/api/master/global-data-window',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{startDate:'2026-01-01'}});
    calls++;
    expect(route.request().postDataJSON()).toEqual({startDate:'2026-02-01',expectedStartDate:'2026-01-01'});
    return route.fulfill(calls===1?{status:409,json:{message:'วันเริ่มข้อมูลเปลี่ยนแล้ว'}}:{json:{startDate:'2026-02-01',changed:true}});
  });
  await page.goto('/tests/global-data-window.html');
  const input=page.getByLabel('วันเริ่มข้อมูล',{exact:true}), save=page.getByRole('button',{name:'บันทึกวันเริ่มข้อมูล'});
  await expect(input).toHaveValue('2026-01-01');await expect(save).toBeDisabled();
  await input.fill('2026-02-01');await save.click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(input).toHaveValue('2026-02-01');
  await save.click();await expect(page.getByRole('status')).toContainText('บันทึก');await expect(save).toBeDisabled();
  expect(calls).toBe(2);
});
