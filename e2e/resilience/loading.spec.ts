import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    await route.fulfill({json:path.includes('/so') ? {data:[],total:0} : []});
  });
  await page.goto('/tests/loading-resilience.html');
  await expect(page.getByTestId('create-so-dialog')).toBeVisible();
});
test('typing survives background trip refresh and a slow request, without a blocking overlay',async({page})=>{
  const input=page.getByPlaceholder('หมายเหตุบิลนี้...');
  await input.fill('USER-UNSAVED');
  await page.getByRole('button',{name:'Refresh trip',exact:true}).click();
  await expect(input).toHaveValue('USER-UNSAVED');
  await page.route('**/api/slow',async route=>{await new Promise(r=>setTimeout(r,1500));await route.fulfill({json:{ok:true}});});
  const read=page.evaluate(()=> (window as any).regression.req('/slow'));
  await expect(page.getByTestId('global-loader')).toBeVisible();
  await expect(page.getByTestId('global-loader')).toHaveCSS('pointer-events','none');
  await input.fill('STILL-TYPING');
  await read;
  await expect(input).toHaveValue('STILL-TYPING');
  await expect(page.getByTestId('global-loader')).toHaveCount(0);
});

test('trip setup retains edits and rejects cancel/navigation after a parent refresh',async({page})=>{
  await page.getByRole('button',{name:'Trip setup',exact:true}).click();
  const dialog=page.getByTestId('trip-setup-dialog');
  const note=page.getByPlaceholder('แสดงใน Description ทุกบิลของเที่ยว');
  await note.fill('UNSAVED-TRIP');
  await page.getByRole('button',{name:'Refresh trip setup',exact:true}).click();
  await expect(note).toHaveValue('UNSAVED-TRIP');
  let confirmations=0;
  page.on('dialog',async d=>{confirmations++;await d.dismiss();});
  await dialog.getByRole('button',{name:'ยกเลิก',exact:true}).click();
  await expect(note).toHaveValue('UNSAVED-TRIP');
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).regression.useAppStore.getState().activePortal)).toBe('sales');
  expect(confirmations).toBe(2);
});

test('trip save freezes its controls, keeps the opened revision, and retains values on conflict',async({page})=>{
  await page.getByRole('button',{name:'Trip setup',exact:true}).click();
  const dialog=page.getByTestId('trip-setup-dialog');
  const note=page.getByPlaceholder('แสดงใน Description ทุกบิลของเที่ยว');
  await note.fill('KEEP-AFTER-CONFLICT');
  await page.getByRole('button',{name:'Refresh trip setup',exact:true}).click();
  let sent:any;
  await page.route('**/api/trips/99',async route=>{
    sent=route.request().postDataJSON();
    await new Promise(r=>setTimeout(r,700));
    await route.fulfill({status:409,json:{message:'TRIP_REVISION_CONFLICT'}});
  });
  await dialog.getByRole('button',{name:'บันทึกการแก้ไขเที่ยวรถ',exact:true}).click();
  await expect(dialog.locator('[aria-busy="true"]')).toHaveAttribute('inert','');
  await expect(dialog.getByRole('button',{name:'ยกเลิก',exact:true})).toBeDisabled();
  await expect(page.getByText('TRIP_REVISION_CONFLICT',{exact:true})).toBeVisible();
  expect(sent.expectedRevision).toBe(3);
  expect(sent.remark).toBe('KEEP-AFTER-CONFLICT');
  await expect(note).toHaveValue('KEEP-AFTER-CONFLICT');
  await expect(dialog.getByRole('button',{name:'ยกเลิก',exact:true})).toBeEnabled();
});

test('discarding a trip clears its guard and a reopened editor uses the latest snapshot',async({page})=>{
  await page.getByRole('button',{name:'Trip setup',exact:true}).click();
  const note=page.getByPlaceholder('แสดงใน Description ทุกบิลของเที่ยว');
  await note.fill('DISCARD-THIS-TEST-EDIT');
  await page.getByRole('button',{name:'Refresh trip setup',exact:true}).click();
  let confirmations=0;
  page.on('dialog',async d=>{confirmations++;await d.accept();});
  await page.getByRole('button',{name:'ปิดข้อมูลการจัดส่ง',exact:true}).click();
  await expect(page.getByTestId('trip-setup-dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Trip setup',exact:true}).click();
  await expect(note).toHaveValue('SERVER REFRESH');
  await page.getByRole('button',{name:'ปิดข้อมูลการจัดส่ง',exact:true}).click();
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  expect(confirmations).toBe(1);
});
test('declining close and navigation preserves the unsaved editor',async({page})=>{
  const input=page.getByPlaceholder('หมายเหตุบิลนี้...');
  await input.fill('DO-NOT-LOSE');
  page.on('dialog',dialog=>dialog.dismiss());
  await page.getByTestId('btn-close-dialog').click();
  await expect(input).toHaveValue('DO-NOT-LOSE');
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  await expect(input).toHaveValue('DO-NOT-LOSE');
  expect(await page.evaluate(()=>(window as any).regression.useAppStore.getState().activePortal)).toBe('sales');
});
test('concurrent identical GETs coalesce, writes do not, and timeouts clear activity without clearing fields',async({page})=>{
  let reads=0,writes=0;
  await page.route('**/api/coalesce',async route=>{
    if(route.request().method()==='GET')reads++;else writes++;
    await new Promise(r=>setTimeout(r,150));await route.fulfill({json:{ok:true}});
  });
  await page.evaluate(async()=>{
    const {req}= (window as any).regression;
    await Promise.all(Array.from({length:20},()=>req('/coalesce')));
    await Promise.all([req('/coalesce',{method:'POST'}),req('/coalesce',{method:'POST'})]);
  });
  expect(reads).toBe(1);expect(writes).toBe(2);
  await page.route('**/api/timeout',async route=>{await new Promise(r=>setTimeout(r,400));await route.fulfill({json:{}}).catch(()=>{});});
  expect(await page.evaluate(async()=>{try{await (window as any).regression.req('/timeout',{timeoutMs:30});}catch(e:any){return e.code;}})).toBe('REQUEST_TIMEOUT');
  await expect.poll(()=>page.evaluate(()=>(window as any).regression.useAppStore.getState().globalLoadingCount)).toBe(0);
});
test('late 401 from an old token does not clear the newer login',async({page})=>{
  await page.route('**/api/expired',async route=>{await new Promise(r=>setTimeout(r,200));await route.fulfill({status:401,json:{message:'expired'}});});
  expect(await page.evaluate(async()=>{
    const {req,setToken}=(window as any).regression;
    setToken('old-fixture');const p=req('/expired').catch(()=>null);setToken('new-fixture');await p;
    return localStorage.getItem('wssale_token');
  })).toBe('new-fixture');
});

test('a delayed profile read cannot overwrite personal details already being edited',async({page})=>{
  await page.route('**/api/auth/me',async route=>{
    await new Promise(r=>setTimeout(r,700));
    await route.fulfill({json:{id:999,username:'fixture',role:'SALES',phone:'SERVER-OLD'}});
  });
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  const phone=page.locator('input[type="tel"]');
  await phone.fill('USER-UNSAVED');
  await expect.poll(()=>page.evaluate(()=>(window as any).regression.useAppStore.getState().globalLoadingCount)).toBe(0);
  await expect(phone).toHaveValue('USER-UNSAVED');
  page.on('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Navigate',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).regression.useAppStore.getState().activePortal)).toBe('sales');
});
test('event bursts serialize refreshes and run one trailing refresh',async({page})=>{
  expect(await page.evaluate(async()=>{
    let calls=0,active=0,peak=0;const {refreshQueue}=(window as any).regression;
    const q=refreshQueue(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,80));active--;},10);
    for(let i=0;i<30;i++)q.request();
    await new Promise(r=>setTimeout(r,40));for(let i=0;i<30;i++)q.request();
    await new Promise(r=>setTimeout(r,220));q.stop();return {calls,peak};
  })).toEqual({calls:2,peak:1});
});

test('only the submitted profile form pauses editing and a failed save retains inputs',async({page})=>{
  await page.route('**/api/auth/me',route=>route.fulfill({json:{id:999,username:'fixture',role:'SALES',phone:'OLD'}}));
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  const phone=page.locator('input[type="tel"]');
  await expect(phone).toHaveValue('OLD');
  await phone.fill('UNSAVED-PHONE');
  await page.route('**/api/auth/profile',async route=>{
    await new Promise(r=>setTimeout(r,700));
    await route.fulfill({status:503,json:{message:'RETRY-LATER'}});
  });
  await page.getByRole('button',{name:'บันทึกข้อมูล',exact:true}).click();
  await expect(page.locator('form')).toHaveAttribute('inert','');
  await expect(page.getByText('RETRY-LATER',{exact:true})).toBeVisible();
  await expect(page.locator('form')).not.toHaveAttribute('inert','');
  await expect(phone).toHaveValue('UNSAVED-PHONE');
});
test('warehouse refresh keeps the weighing form mounted and its unsaved values',async({page})=>{
  const order={id:101,status:'LOADED',custName:'Fixture customer',wfRef:'TEST',truckPlate:'TEST',
    lines:[{lineNo:1,goodId:'1',goodName:'Fixture',qtyTon:1,pricePerTon:100}]};
  await page.route('**/api/so?*',route=>route.fulfill({json:{data:route.request().url().includes('LOADED')?[order]:[],total:1}}));
  await page.getByRole('button',{name:'Warehouse',exact:true}).click();
  await page.getByRole('button',{name:'เครื่องชั่ง (ชั่งออก)',exact:true}).click();
  await page.getByRole('button',{name:'ระบุน้ำหนักชั่งออก',exact:true}).click();
  await page.getByTestId('weigh-gross').fill('1200');
  await page.route('**/api/so?*',async route=>{
    await new Promise(r=>setTimeout(r,700));await route.fulfill({json:{data:[order],total:1}});
  });
  await page.getByRole('button',{name:'รีเฟรชรายการคลัง',exact:true}).click({force:true});
  await expect(page.getByTestId('weigh-gross')).toHaveValue('1200');
  await expect(page.getByRole('button',{name:'รีเฟรชรายการคลัง',exact:true})).toBeEnabled();
  await expect(page.getByTestId('weigh-gross')).toHaveValue('1200');
});
test('transient profile failure offers retry instead of deleting the login session',async({page})=>{
  await page.addInitScript(()=>{
    const payload=btoa(JSON.stringify({sub:999,exp:Math.floor(Date.now()/1000)+3600}));
    localStorage.setItem('wssale_token','fixture.'+payload+'.fixture');
    localStorage.removeItem('wssale_user');
  });
  await page.route('**/api/auth/me',route=>route.fulfill({status:503,json:{message:'temporary failure'}}));
  await page.goto('/');
  await expect(page.getByRole('button',{name:/เชื่อมต่อระบบไม่ได้ชั่วคราว/})).toBeVisible();
  expect(await page.evaluate(()=>Boolean(localStorage.getItem('wssale_token')))).toBe(true);
});
test('hidden-page refreshes wait until resume and disposal cancels pending work',async({page})=>{
  expect(await page.evaluate(async()=>{
    let calls=0;const q=(window as any).regression.refreshQueue(()=>{calls++;},10);
    q.pause(true);for(let i=0;i<20;i++)q.request();
    await new Promise(r=>setTimeout(r,40));const hidden=calls;
    q.pause(false);await new Promise(r=>setTimeout(r,40));const resumed=calls;
    q.request();q.stop();await new Promise(r=>setTimeout(r,40));return{hidden,resumed,disposed:calls};
  })).toEqual({hidden:0,resumed:1,disposed:1});
});

test('changing only the quotation expiry date still warns before closing',async({page})=>{
  await page.getByRole('button',{name:'Quotation',exact:true}).click();
  await page.getByRole('button',{name:'+7 วัน',exact:true}).click();
  let warned=false;
  page.on('dialog',async dialog=>{warned=true;await dialog.dismiss();});
  await page.getByRole('button',{name:'ปิดใบเสนอราคา',exact:true}).click();
  expect(warned).toBe(true);
  await expect(page.getByRole('button',{name:'+15 วัน',exact:true})).toBeVisible();
});
test('read sharing is scoped to token and timed-out writes are never retried',async({page})=>{
  let reads=0,writes=0;
  await page.route('**/api/scoped',async route=>{
    reads++;await new Promise(r=>setTimeout(r,100));await route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/write-timeout',async route=>{
    writes++;await new Promise(r=>setTimeout(r,300));await route.fulfill({json:{ok:true}}).catch(()=>{});
  });
  const result=await page.evaluate(async()=>{
    const {req,setToken}=(window as any).regression;
    setToken('actor-1');const a=req('/scoped');setToken('actor-2');await Promise.all([a,req('/scoped')]);
    try{await req('/write-timeout',{method:'POST',timeoutMs:30});}catch(e:any){return {code:e.code,message:e.message};}
  });
  expect(reads).toBe(2);expect(writes).toBe(1);
  expect(result.code).toBe('REQUEST_TIMEOUT');expect(result.message).toContain('ตรวจรายการก่อนบันทึกซ้ำ');
});
