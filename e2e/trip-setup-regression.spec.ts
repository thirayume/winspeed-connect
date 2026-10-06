import {test,expect} from '@playwright/test';
test('edit keeps state across parent renders, updates existing trip and resets only on reopening',async({page})=>{
 const errors:string[]=[],writes:any[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const request=route.request();
  if(request.url().includes('/master/trucks-stats')) return route.fulfill({json:[]});
  if(request.method()==='PUT' && request.url().endsWith('/trips/42')){
    writes.push(request.postDataJSON());return route.fulfill({json:{tripId:42,tripCode:'TEST-42',documentRevision:8}});
  }
  throw Error('Unexpected API call: '+request.method()+' '+request.url());
 });
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html');
 await page.getByText('Open editor',{exact:true}).click();
 const plate=page.getByPlaceholder('เช่น กจ70-4088 (เว้นว่างได้สำหรับ Draft Trip)');
 await expect(plate).toHaveValue('');await plate.fill('UAT-42');
 for(let n=0;n<5;n++)await page.getByText('Parent rerender',{exact:true}).click({force:true});
 await expect(plate).toHaveValue('UAT-42');
 await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();
 await expect(page.locator('output')).toContainText('"tripId":42');
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({expectedRevision:7,transRegistration:'UAT-42'});
 await page.getByText('Open editor',{exact:true}).click();await expect(plate).toHaveValue('');
 await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();
 await expect(page.locator('output')).not.toContainText('UAT-42');expect(writes[1].transRegistration).toBeNull();expect(errors).toEqual([]);
});

test('summary uses independent load-plan revision and trip-owned metadata',async({page})=>{
 const writes:any[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/api/**',async route=>{
 const r=route.request(),url=r.url();
 if(url.endsWith('/loading-plan'))return route.fulfill({json:{trip:{loadPlanRevision:3,loadPlanStatus:'DRAFT'},plan:[]}});
 if(url.endsWith('/trips/42')&&r.method()==='GET')return route.fulfill({json:{tripId:42,transRegistration:'SERVER-42',documentRevision:7,tripRemark:'TRIP-ONLY',preSlingRequired:true,pickupDueDate:'2026-10-08',orders:[]}});
 if(url.includes('/master/trucks-stats'))return route.fulfill({json:[]});
 if(r.method()==='PUT'&&url.endsWith('/load-plan')){writes.push(r.postDataJSON());return route.fulfill({json:{loadPlanRevision:4,loadPlanStatus:'SALE_CONFIRMED'}});}
 if(url.endsWith('/confirm')){writes.push(r.postDataJSON());return route.fulfill({json:{message:'confirmed',tripId:42}});}
 throw Error('Unexpected request '+r.method()+' '+url);
 });
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html?summary');
 await page.getByRole('button',{name:'แก้ไขข้อมูลเที่ยวรถ',exact:true}).click();
 await expect(page.getByPlaceholder('แสดงใน Description ทุกบิลของเที่ยว')).toHaveValue('TRIP-ONLY');
 await expect(page.getByLabel('ใช้ Pre-Sling')).toBeChecked();
 await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
 await page.getByRole('button',{name:/ยืนยัน 1 บิล/}).click();
 await page.getByRole('button',{name:'ยืนยันลำดับ',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(2);
 expect(writes[0].expectedPlanRevision).toBe(3);expect(writes[1].expectedRevision).toBe(7);expect(writes[1].transRegistration).toBe('SERVER-42');expect(errors).toEqual([]);
});

test('trip note shows length/hint and blocks non-874 input before API',async({page})=>{
 const writes:any[]=[];
 await page.route('**/api/**',async route=>{
  if(route.request().url().includes('/master/trucks-stats'))return route.fulfill({json:[]});
  writes.push(route.request().postDataJSON());return route.fulfill({json:{tripId:42,tripCode:'TEST-42',documentRevision:8}});
 });
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html');
 await page.getByText('Open editor',{exact:true}).click();
 const note=page.locator('textarea');await expect(note).toHaveAttribute('maxlength','255');
 await note.fill('ทดสอบ😀');await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();
 await expect(page.getByText('หมายเหตุมีอักขระที่ WinSpeed ไม่รองรับ (code page 874)',{exact:true})).toBeVisible();expect(writes).toHaveLength(0);
 await note.fill('ก'.repeat(255));await expect(page.getByText(/ทุกบิลของเที่ยว · 255\/255/)).toBeVisible();
 await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();await expect(page.locator('output')).toContainText('"tripId":42');expect(writes[0].remark.length).toBe(255);
});

test('flat API metadata survives unchanged save; intentional clear is allowed',async({page})=>{
 const writes:any[]=[];
 await page.route('**/api/**',async route=>{
  const r=route.request(),u=r.url();
  if(u.endsWith('/loading-plan'))return route.fulfill({json:{trip:{loadPlanRevision:3},plan:[]}});
  if(u.includes('/master/trucks-stats'))return route.fulfill({json:[]});
  if(r.method()==='GET')return route.fulfill({json:{tripId:42,transRegistration:'SERVER-42',documentRevision:7,tripRemark:'KEEP-NOTE',preSlingRequired:true,pickupDueDate:'2026-10-12',orders:[]}});
  writes.push(r.postDataJSON());return route.fulfill({json:{tripId:42,tripCode:'TEST-42',documentRevision:8}});
 });
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html?summary');
 await page.getByRole('button',{name:'แก้ไขข้อมูลเที่ยวรถ',exact:true}).click();
 await expect(page.locator('textarea')).toHaveValue('KEEP-NOTE');
 await expect(page.getByLabel('ใช้ Pre-Sling')).toBeChecked();
 await expect(page.getByPlaceholder('เช่น กจ70-4088 (เว้นว่างได้สำหรับ Draft Trip)')).toHaveValue('SERVER-42');
 await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();
 expect(writes[0]).toMatchObject({remark:'KEEP-NOTE',pSling:true,transRegistration:'SERVER-42',expectedRevision:7,deliveryDate:'2026-10-12'});
 await page.getByRole('button',{name:'แก้ไขข้อมูลเที่ยวรถ',exact:true}).click();
 await page.locator('textarea').fill('');await page.getByLabel('ใช้ Pre-Sling').uncheck();
 await page.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ'}).click();
 expect(writes[1]).toMatchObject({remark:'',pSling:false});
});

test('failed metadata read cannot open a clearing editor',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({status:503,json:{message:'offline'}}));
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html?summary');
 await expect(page.getByRole('button',{name:'แก้ไขข้อมูลเที่ยวรถ',exact:true})).toBeDisabled();
});

test('active banner keeps server members and plate when portal filter returns no orders',async({page})=>{
 await page.route('**/api/**',r=>{
  const u=r.request().url();
  if(u.endsWith('/trips/42'))return r.fulfill({json:{tripId:42,transRegistration:'SERVER-42',tripRemark:'KEEP',preSlingRequired:true,documentRevision:7,orders:[{id:123,status:'DRAFT'}]}});
  if(u.endsWith('/so/123'))return r.fulfill({json:{id:123,tripId:42,status:'DRAFT',custId:'1001',custName:'CUSTOMER',lines:[]}});
  if(u.includes('/so?'))return r.fulfill({json:{data:[],total:0}});
  if(u.endsWith('/trips/board'))return r.fulfill({json:{data:[]}});
  return r.fulfill({json:[]});
 });
 await page.goto('http://localhost:5173/test-harnesses/trip-setup.html?portal');
 await expect(page.getByText('1 ลูกค้า (1 บิล)',{exact:true})).toBeVisible();
 await expect(page.getByText('SERVER-42',{exact:true})).toBeVisible();
 await page.getByPlaceholder('ค้นหา ลูกค้า / WfRef...').fill('NO-MATCH');
 await page.waitForTimeout(600);
 await expect(page.getByText('1 ลูกค้า (1 บิล)',{exact:true})).toBeVisible();
});
