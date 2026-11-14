'use strict';
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage(),requests=[];let active=null;
  await page.route('**/api/rebate-pool/admin/reset',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{enabled:true,environment:'uat',
      primaryDatabase:'dbwins_worldfert9_uat_fz',manifestDigest:'a'.repeat(64),
      databases:[{database:'dbwins_worldfert9_uat_fz',server:'fixture'}],activeRequestId:active}});
    const body=route.request().postDataJSON();requests.push(body);active=body.requestId;
    if(requests.length===1)return route.fulfill({status:503,json:{message:'คำขอขัดข้อง'}});
    active=null;return route.fulfill({json:{complete:true,requestId:body.requestId,replayed:true,generation:1}});
  });
  await page.goto('http://127.0.0.1:5179/tests/rebate-reset-setting.html');
  const field=page.getByLabel('พิมพ์ RESET เพื่อยืนยัน');await field.waitFor();await field.fill('RESET');
  await page.getByRole('button',{name:'ยืนยันเริ่มยอด Rebate ใหม่'}).click();
  await page.getByText('คำขอขัดข้อง').waitFor();
  await page.reload();await page.getByText('พบคำขอของคุณที่ยังไม่เสร็จ').waitFor();
  await field.fill('RESET');await page.getByRole('button',{name:'ดำเนินคำขอเดิมต่อ'}).click();
  await page.getByText('เริ่มรอบ Rebate ใหม่เรียบร้อย',{exact:false}).waitFor();
  assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
  assert.equal(requests[0].expectedPrimaryDatabase,'dbwins_worldfert9_uat_fz');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('rebate-reset:')).length),0);
  console.log('REBATE_RESET_BROWSER_RETRY=PASS');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
