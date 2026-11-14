'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let switched=false;let allowed=true;
  await page.route('**/api/auth/databases',route=>route.fulfill({json:{
   active:switched?'dbwins_worldfert9_uat_fz6':'dbwins_worldfert9_uat_fz3',system:'dbwins_worldfert9_uat_fz6',
   list:allowed?['dbwins_worldfert9_uat_fz6']:[],canSwitch:true,selectionBlocked:!switched,themes:{},
   metaList:[{name:'dbwins_worldfert9_uat_fz6',color:'green',badge:'UAT',isAllowed:allowed}],
  }}));
  await page.route('**/api/auth/switch-database',route=>{
   assert.equal(route.request().method(),'POST');assert.equal(route.request().postDataJSON().database,'dbwins_worldfert9_uat_fz6');
   switched=true;return route.fulfill({json:{accessToken:'test-only-token',database:'dbwins_worldfert9_uat_fz6',isDefault:true}});
  });
  const url='http://127.0.0.1:5179/tests/database-switch-recovery.html';
  await page.goto(url);await page.getByRole('button',{name:/fz3/}).click();
  await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:/fz6/}).first().click()]);
  await page.getByText('dbwins_worldfert9_uat_fz6').waitFor();assert.equal(switched,true);
  assert.equal(await page.getByRole('button',{name:/fz6/}).count(),0,'No switch button for a single active target');
  switched=false;allowed=false;await page.reload();
  await page.getByText('dbwins_worldfert9_uat_fz3').waitFor();
  assert.equal(await page.getByRole('button',{name:/fz3/}).count(),0,'No switch button for an inaccessible target');
  console.log('DATABASE_SWITCH_RECOVERY_BROWSER=PASS');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
