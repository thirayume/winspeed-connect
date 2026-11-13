import {test,expect} from '@playwright/test';

test('organization editor sees multi-role review and changing a position does not change roles',async({page})=>{
  const position={PositionCode:'STALE-KEY',PositionName:'ฝ่ายขาย',OrgUnit:'ขาย-การตลาด',Tier:1,ReportsTo:null,DefaultRole:'MANAGER',CanApprove:true,IsActive:true};
  const user={Id:1,Username:'fixture-1',DisplayName:'Person 1',Role:'SALES',RoleCodes:['SALES','C_LEVEL'],Roles:['SALES','C_LEVEL'],PositionCode:null,IsActive:true};
  const occupant={...user,Id:2,Username:'fixture-2',DisplayName:'Person 2',EmpCode:'EMP-00002',PositionCode:'STALE-KEY'};
  let writes=0;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='PATCH'&&url.pathname.endsWith('/auth/users/1')){
      writes++;expect(route.request().postDataJSON()).toEqual({positionCode:'STALE-KEY',expectedPositionCode:null});
      return route.fulfill({json:{ok:true}});
    }
    const json=url.pathname.endsWith('/auth/users')?[user,occupant]:url.pathname.endsWith('/auth/org-positions')?[position]:url.pathname.endsWith('/auth/org-hints')?{data:[]}:url.pathname.endsWith('/admin-management/roles')?{roles:[],actions:{},menus:{},editable:[]}:[];
    await route.fulfill({json});
  });
  await page.goto('/tests/admin-console.html');
  await page.getByRole('tab',{name:/ผังองค์กร/}).click();
  await expect(page.getByText('Role แนะนำ:',{exact:false})).toBeVisible();
  await expect(page.getByText('STALE-KEY',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('บทบาทของ Person 2')).toHaveText('SALESC_LEVEL');
  await expect(page.getByText('EMP-00002',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/มอบหมายคน/}).click();
  const select=page.locator('select').filter({has:page.locator('option[value="1"]')});
  await select.selectOption('1');
  await expect(page.getByText(/Role ที่ได้รับปัจจุบัน:/)).toContainText('SALES, C_LEVEL');
  await expect(page.getByText(/Role แนะนำของตำแหน่งใหม่:/)).toContainText('MANAGER');
  await expect(page.getByText(/บันทึกนี้ไม่เปลี่ยน Role/)).toBeVisible();
  await page.getByRole('button',{name:'บันทึกการมอบหมาย'}).click();
  await expect.poll(()=>writes).toBe(1);
});
