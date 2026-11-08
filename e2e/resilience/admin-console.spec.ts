import {test,expect} from '@playwright/test';
const actions={'so.create':['SALES','ADMIN'],'users.manage':['ADMIN'],'roles.manage':['ADMIN']};
const roles=['ADMIN','SALES','C_LEVEL'].map(Code=>({Code,Name:Code,BaseRole:Code,permissions:Code==='ADMIN'?Object.keys(actions):['so.create'],Revision:1,MemberCount:1}));
const users=Array.from({length:33},(_,i)=>({Id:i+1,Username:`fixture-${i+1}`,DisplayName:`Person ${i+1}`,Role:'SALES',RoleCode:'SALES',RoleCodes:i===0?['SALES','C_LEVEL']:['SALES'],IsActive:i!==32,EmpId:null}));
test.beforeEach(async({page})=>{
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=path.endsWith('/auth/users')||path.endsWith('/auth/org-users')?users:path.endsWith('/admin-management/roles')?{roles,actions,menus:{admin:['ADMIN']},editable:Object.keys(actions)}:path.endsWith('/auth/org-hints')?{data:[]}:[];
    await route.fulfill({json});
  });
  await page.goto('/tests/admin-console.html');
  await expect(page.getByLabel('เลือก fixture-1',{exact:true})).toBeVisible();
});
test('active-only default, current-page selection and filter changes clear batch selection',async({page})=>{
  await page.getByLabel('เลือกผู้ใช้หน้านี้ทั้งหมด').check();
  await expect(page.getByRole('button',{name:'จัดการที่เลือก (30)',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
  await expect(page.getByRole('button',{name:'จัดการที่เลือก (0)',exact:true})).toBeDisabled();
  await expect(page.getByLabel('เลือก fixture-33',{exact:true})).toHaveCount(0);
  await page.getByLabel('รวมผู้ปิดใช้งาน').check();
  await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
  await expect(page.getByLabel('เลือก fixture-33',{exact:true})).toBeVisible();
});
test('multi-role editor retains changes after a conflict and cancel is guarded',async({page})=>{
  await page.getByTitle('แก้ไขข้อมูลผู้ใช้',{exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('tab',{name:/บทบาท/}).click();
  await expect(dialog.getByLabel('SALES (SALES)',{exact:true})).toBeChecked();
  await expect(dialog.getByLabel('C_LEVEL (C_LEVEL)',{exact:true})).toBeChecked();
  await dialog.getByLabel('C_LEVEL (C_LEVEL)',{exact:true}).uncheck();
  await page.route('**/api/auth/users/1',route=>route.fulfill({status:409,json:{message:'stale roles'}}));
  await dialog.getByRole('button',{name:/บันทึก/}).click();
  await expect(dialog.getByRole('alert')).toContainText('409');
  await expect(dialog.getByLabel('C_LEVEL (C_LEVEL)',{exact:true})).not.toBeChecked();
  page.on('dialog',d=>d.dismiss());
  await dialog.getByRole('button',{name:'ปิดข้อมูลผู้ใช้'}).click();
  await expect(dialog).toBeVisible();
});
test('batch clears LINE for exactly the selected users and does not retry a mutation',async({page})=>{
  for(const id of [1,2,3,4,5])await page.getByLabel(`เลือก fixture-${id}`,{exact:true}).check();
  await page.getByRole('button',{name:'จัดการที่เลือก (5)',exact:true}).click();
  await page.getByLabel('คำสั่ง',{exact:true}).selectOption('clear-line');
  let calls=0;
  await page.route('**/api/admin-management/users/batch',async route=>{calls++;expect(route.request().postDataJSON()).toMatchObject({ids:[1,2,3,4,5],action:'clear-line'});await route.fulfill({json:{count:5,credentials:[]}});});
  await page.getByLabel('ตรวจรายชื่อผู้ใช้ 5 คนและยืนยันคำสั่งนี้แล้ว').check();
  await page.getByRole('button',{name:'ยืนยันดำเนินการ',exact:true}).click();
  await expect(page.getByText(/ดำเนินการสำเร็จ 5 คน/)).toBeVisible();expect(calls).toBe(1);
});
test('reserved ADMIN is visible but immutable',async({page})=>{
  await page.getByRole('tab',{name:/บทบาท/}).click();
  await page.getByRole('button',{name:/ADMIN.*Root/}).click();
  const checks=page.locator('input[type=checkbox]');
  expect(await checks.count()).toBeGreaterThan(0);
  for(const check of await checks.all())await expect(check).toBeDisabled();
});
test('manager can view organization through limited endpoint without user-management access',async({page})=>{
  await page.goto('/tests/admin-console.html?viewer=manager');
  await expect(page.getByRole('tab',{name:/ผังองค์กร/})).toBeVisible();
  await expect(page.getByRole('tab',{name:/ผู้ใช้งาน/})).toHaveCount(0);
  await expect(page.getByText('โหลดข้อมูลผังองค์กรไม่สำเร็จ')).toHaveCount(0);
});
