import {test,expect} from '@playwright/test';
const name='dbwins_worldfert9_test',second='dbwins_worldfert2_test';
const draft={server:'sql.example.test',port:1433,database:name,username:'test_app',expectedServerName:'SQL\\TEST',versionPrefix:'10.50.',encrypt:true,legacyTls:false,tdsVersion:'7_3_B',passwordSet:true};
const profile={name,revision:1,draft,active:null,activeRevision:null,testedAt:null};
test.beforeEach(async({page})=>{
  await page.route('**/api/**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.endsWith('/auth/databases'))return route.fulfill({json:{active:name,system:name,primary:name,list:[name,second],canSwitch:true,canSetSystem:true,metaList:[{name,color:'red',badge:'PROD_DB',restrictedRoles:[]},{name:second,color:'yellow',badge:'RD_DB',restrictedRoles:['MANAGER'],isAllowed:false}]}});
    if(pathname.endsWith('/database-connections'))return route.fulfill({json:{configured:true,profiles:[profile,{...profile,name:second,draft:{...draft,database:second}}],audit:[]}});
    throw Error('Unexpected request '+pathname);
  });
  await page.goto('/tests/database-settings.html');
  await expect(page.getByLabel('Connection server',{exact:true})).toBeVisible();
});

test('badge precedes name and restriction label comes from actual database policy',async({page})=>{
  const header=page.getByTestId('database-header');
  await expect(header).toHaveText(/PROD_DB\s*dbwins_worldfert9_test/);
  await expect(page.getByText('สงวนสิทธิ์เฉพาะทีม MANAGER, ADMIN',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Connection password',{exact:true})).toHaveValue('');
  await expect(page.getByRole('button',{name:'บันทึกร่าง connection',exact:true})).toBeDisabled();
});

test('save retains exact special characters, clears password after success, tests saved revision only',async({page})=>{
  const password="  Test$&'\\}ภาษาไทย  ";let saves=0,tests=0;
  await page.route('**/api/database-connections/'+name,async route=>{
    saves++;expect(route.request().postDataJSON()).toMatchObject({revision:1,profile:{...draft,server:'new.example.test',password}});
    await route.fulfill({json:{revision:2}});
  });
  await page.route('**/api/database-connections/'+name+'/test',async route=>{
    tests++;expect(route.request().postDataJSON()).toEqual({revision:2});
    await route.fulfill({json:{revision:2,testedAt:new Date().toISOString()}});
  });
  await page.getByLabel('Connection server',{exact:true}).fill('new.example.test');
  await page.getByLabel('Connection password',{exact:true}).fill(password);
  await expect(page.getByRole('button',{name:'ทดสอบการเชื่อมต่อ',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'บันทึกร่าง connection',exact:true}).click();
  await expect(page.getByLabel('Connection password',{exact:true})).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('ค่าที่ระบบใช้งานยังไม่เปลี่ยน');
  await page.getByRole('button',{name:'ทดสอบการเชื่อมต่อ',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('IT');
  expect(saves).toBe(1);expect(tests).toBe(1);
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  expect(storage).not.toContain(password);
});

test('stale save and background loading retain unsaved data; changing profile requires discard confirmation',async({page})=>{
  await page.route('**/api/database-connections/'+name,route=>route.fulfill({status:409,json:{message:'ข้อมูลเปลี่ยนแล้ว'}}));
  await page.getByLabel('Connection server',{exact:true}).fill('unsaved.example.test');
  await page.getByLabel('Connection password',{exact:true}).fill('TEMP_TEST_ONLY');
  await page.getByRole('button',{name:'บันทึกร่าง connection',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Connection server',{exact:true})).toHaveValue('unsaved.example.test');
  await expect(page.getByLabel('Connection password',{exact:true})).toHaveValue('TEMP_TEST_ONLY');
  page.on('dialog',dialog=>dialog.dismiss());
  await page.getByLabel('เลือก connection',{exact:true}).selectOption(second);
  await expect(page.getByLabel('เลือก connection',{exact:true})).toHaveValue(name);
  await expect(page.getByLabel('Connection server',{exact:true})).toHaveValue('unsaved.example.test');
  await page.getByRole('button',{name:'โหลด connection ล่าสุด',exact:true}).click();
  await expect(page.getByLabel('Connection password',{exact:true})).toHaveValue('TEMP_TEST_ONLY');
});

test('not configured and failed test never enable live activation',async({page})=>{
  await page.route('**/api/database-connections/'+name+'/test',route=>route.fulfill({status:422,json:{message:'ทดสอบไม่ผ่าน'}}));
  await page.getByRole('button',{name:'ทดสอบการเชื่อมต่อ',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Connection server',{exact:true})).toHaveValue(draft.server);
  await expect(page.getByRole('button',{name:/เปิดใช้ connection/})).toHaveCount(0);
  await page.route('**/api/database-connections',route=>route.fulfill({json:{configured:false,profiles:[profile],audit:[]}}));
  await page.getByRole('button',{name:'โหลด connection ล่าสุด',exact:true}).click();
  await expect(page.getByText('IT ต้องเตรียมที่เก็บรหัสผ่านแบบเข้ารหัสบนเซิร์ฟเวอร์ก่อนใช้งานส่วนนี้')).toBeVisible();
  await page.getByLabel('Connection server',{exact:true}).fill('cannot-save.example.test');
  await expect(page.getByRole('button',{name:'บันทึกร่าง connection',exact:true})).toBeDisabled();
});
