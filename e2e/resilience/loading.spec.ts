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
test('event bursts serialize refreshes and run one trailing refresh',async({page})=>{
  expect(await page.evaluate(async()=>{
    let calls=0,active=0,peak=0;const {refreshQueue}=(window as any).regression;
    const q=refreshQueue(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,80));active--;},10);
    for(let i=0;i<30;i++)q.request();
    await new Promise(r=>setTimeout(r,40));for(let i=0;i<30;i++)q.request();
    await new Promise(r=>setTimeout(r,220));q.stop();return {calls,peak};
  })).toEqual({calls:2,peak:1});
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
