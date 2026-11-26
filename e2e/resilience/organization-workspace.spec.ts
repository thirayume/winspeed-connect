import {test,expect} from '@playwright/test';
const staff={Id:1,Username:'qa-user',DisplayName:'QA staff',Role:'SALES',RoleCode:'SALES',RoleCodes:['SALES'],IsActive:true,EmpId:501,EmpCode:'QA-EMP-001'};
async function mock(page:any){
 const calls:any[]=[];
 await page.route('**/api/**',async(route:any)=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();calls.push({path,method});
  const data=path.endsWith('/auth/users')||path.endsWith('/auth/org-users')?[staff]:path.endsWith('/master/employees')?[{EmpID:501,EmpCode:staff.EmpCode,EmpName:staff.DisplayName,IsActive:1}]:path.endsWith('/auth/sales-territories')?{data:[],database:'qa_org'}:path.endsWith('/admin-management/roles')?{roles:[],actions:{},menus:{admin:['ADMIN']},editable:[]}:path.endsWith('/auth/org-hints')?{data:[]}:[];
  await route.fulfill({json:data});
 });
 return calls;
}
test('native Employee edit retains stale input and saves the reviewed snapshot/database without creating credentials',async({page})=>{
 const calls=await mock(page);let writes=0;
 let profile={EmpID:501,EmpCode:'QA-EMP-001',EmpName:'QA original',EmpTitle:null,HeadCode:null,ExpectedSnapshot:'<employee EmpID="501"/>'};
 await page.route('**/api/auth/native-employees/QA-EMP-001',async route=>{
  if(route.request().method()==='PUT'){
   writes++;const body=route.request().postDataJSON();expect(body).toMatchObject({name:'QA corrected',expectedDatabase:'qa_org',expectedSnapshot:profile.ExpectedSnapshot,create:false,syncLinkedName:true});
   if(writes===1)return route.fulfill({status:409,json:{message:'QA snapshot changed'}});
   profile={...profile,EmpName:body.name,ExpectedSnapshot:'<employee EmpID="501" Revision="2"/>'};
  }
  await route.fulfill({json:{data:profile,database:'qa_org'}});
 });
 await page.goto('/tests/admin-console.html');
 await page.getByText('ข้อมูล Employee ต้นทาง WinSpeed',{exact:true}).click();
 await page.getByLabel('ค้นรหัส Employee ต้นทาง').fill('QA-EMP-001');await page.getByRole('button',{name:'อ่านข้อมูล',exact:true}).click();
 await expect(page.getByLabel('ชื่อ Employee ต้นทาง')).toHaveValue('QA original');
 await page.getByLabel('ชื่อ Employee ต้นทาง').fill('QA corrected');await page.getByLabel('เหตุผลแก้ Employee').fill('QA metadata correction');
 await page.getByRole('button',{name:'บันทึก Employee',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('QA snapshot changed');
 await expect(page.getByLabel('ชื่อ Employee ต้นทาง')).toHaveValue('QA corrected');expect(writes).toBe(1);
 await page.getByRole('button',{name:'บันทึก Employee',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึก Employee พร้อมประวัติแล้ว');
 expect(writes).toBe(2);expect(calls.some(c=>c.method==='POST')).toBeFalsy();
});
test('a missing native Employee creates metadata explicitly and does not create an app or native login',async({page})=>{
 const calls=await mock(page);let saved:any;
 await page.route('**/api/auth/native-employees/QA-NEW',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{data:null,database:'qa_org'}});
  saved=route.request().postDataJSON();expect(saved).toMatchObject({name:'QA new employee',create:true,expectedSnapshot:'',expectedDatabase:'qa_org'});
  await route.fulfill({json:{data:{EmpID:502,EmpCode:'QA-NEW',EmpName:saved.name,EmpTitle:null,HeadCode:null,ExpectedSnapshot:'QA-created'},database:'qa_org'}});
 });
 await page.goto('/tests/admin-console.html');await page.getByText('ข้อมูล Employee ต้นทาง WinSpeed',{exact:true}).click();
 await page.getByLabel('ค้นรหัส Employee ต้นทาง').fill('QA-NEW');await page.getByRole('button',{name:'อ่านข้อมูล',exact:true}).click();
 await page.getByLabel('ชื่อ Employee ต้นทาง').fill('QA new employee');await page.getByLabel('เหตุผลแก้ Employee').fill('QA approved employee creation');
 await page.getByRole('button',{name:'บันทึก Employee',exact:true}).click();await expect(page.getByRole('status')).toContainText('บันทึก Employee พร้อมประวัติแล้ว');
 expect(saved).not.toHaveProperty('password');expect(saved).not.toHaveProperty('username');expect(calls.some(c=>c.method==='POST')).toBeFalsy();
});
test('territory editor keeps input on a conflict and records distinct sale/promotion types',async({page})=>{
 await mock(page);let writes=0;let items:any[]=[];
 await page.route('**/api/auth/sales-territories',route=>route.fulfill({json:{data:items,database:'qa_org'}}));
 await page.route('**/api/auth/sales-territories/QA-PROMO',async route=>{
  const body=route.request().postDataJSON();writes++;expect(body).toMatchObject({type:'PROMOTION',ownerUserId:1,provinces:['ขอนแก่น'],expectedRevision:0,expectedDatabase:'qa_org'});
  if(writes===1)return route.fulfill({status:409,json:{message:'QA territory changed'}});
  items=[{TerritoryCode:'QA-PROMO',TerritoryName:body.name,TerritoryType:body.type,OwnerUserId:1,OwnerName:'QA staff',EmpCode:'QA-EMP-001',IsActive:true,Revision:1,provinces:body.provinces}];
  await route.fulfill({json:{ok:true,revision:1}});
 });
 await page.goto('/tests/admin-console.html');await page.getByRole('tab',{name:'เขตพื้นที่รับผิดชอบ'}).click();await page.getByRole('button',{name:'เพิ่มเขตพื้นที่'}).click();
 await page.getByLabel('รหัสเขต',{exact:true}).fill('QA-PROMO');await page.getByLabel('ชื่อเขต',{exact:true}).fill('QA promotion');await page.getByLabel('ประเภทเขต').selectOption('PROMOTION');
 await page.getByLabel('ผู้รับผิดชอบเขต').selectOption('1');await page.getByLabel('จังหวัดรับผิดชอบ').fill('ขอนแก่น');await page.getByLabel('เหตุผลแก้ไขเขต').fill('QA territory correction');
 await page.getByRole('button',{name:'บันทึกพื้นที่'}).click();await expect(page.getByRole('alert')).toContainText('QA territory changed');expect(writes).toBe(1);
 await expect(page.getByLabel('ประเภทเขต')).toHaveValue('PROMOTION');await page.getByRole('button',{name:'บันทึกพื้นที่'}).click();
 await expect(page.getByRole('form',{name:'แก้ไขเขตพื้นที่'})).toHaveCount(0);await expect(page.getByText('QA promotion',{exact:true})).toBeVisible();expect(writes).toBe(2);
});
for(const viewer of ['manager','c-level'])test(`${viewer} can read the organization and territory page without management actions`,async({page})=>{
 await mock(page);await page.goto('/tests/admin-console.html?viewer='+viewer);
 await expect(page.getByRole('tab',{name:/ผังองค์กร/})).toBeVisible();await expect(page.getByRole('tab',{name:/ผู้ใช้งาน/})).toHaveCount(0);
 await page.getByRole('tab',{name:'เขตพื้นที่รับผิดชอบ'}).click();await expect(page.getByRole('heading',{name:'เขตขายและเขตส่งเสริมการขาย'})).toBeVisible();
 await expect(page.getByRole('button',{name:'เพิ่มเขตพื้นที่'})).toHaveCount(0);await expect(page.getByText('ข้อมูล Employee ต้นทาง WinSpeed',{exact:true})).toHaveCount(0);
});
