'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();const requests=[];
    await page.route('**/api/rebate-pool/conversion-requests',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:{items:[],limit:50,database:'dbwins_worldfert9_uat_fz'}});
      const body=route.request().postDataJSON();requests.push(body);
      if(requests.length===1)return route.fulfill({status:503,json:{message:'ชั่วคราว'}});
      return route.fulfill({json:{id:8,status:'PENDING',replayed:true}});
    });
    await page.goto('http://127.0.0.1:5179/tests/rebate-conversion-request.html');
    const submit=page.getByRole('button',{name:'ยื่นคำขอ'});await submit.waitFor();
    await page.getByRole('button',{name:'เลือกลูกค้า'}).click();await page.getByRole('button',{name:'ลูกค้าตัวอย่าง'}).click();
    await page.getByRole('button',{name:'เลือกสินค้า'}).click();await page.getByRole('button',{name:'ปุ๋ยตัวอย่าง'}).click();
    await page.getByLabel('จำนวนที่ขอ (ตัน)').fill('0.5');await page.getByLabel('หมายเหตุ').fill('ทดลอง');
    await submit.click();await page.getByRole('button',{name:'ตกลง'}).click();
    await page.getByText('ชั่วคราว').waitFor();await page.getByRole('button',{name:'ตกลง'}).click();
    await page.waitForTimeout(400);assert.equal(await page.getByLabel('หมายเหตุ').inputValue(),'ทดลอง');
    await submit.click();await page.getByRole('button',{name:'ตกลง'}).click();
    await page.getByText('ยื่นคำขอ #8 แล้ว',{exact:false}).waitFor();
    assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
    assert.equal(requests[0].expectedDatabase,'dbwins_worldfert9_uat_fz');assert.equal(requests[0].requestedTons,0.5);
    console.log('REBATE_REQUEST_BROWSER=PASS');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
