import {test,expect} from '@playwright/test';
test('same-region sales request, lender approval and partial/full repayments use the individual loan API',async({page})=>{
 let actor=2,status='',returned=0,requests=0,decisions=0,returns=0;
 const legacy:string[]=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  let json:unknown={};
  const option=(Id:number,SalesUserId:number,DisplayName:string)=>({Id,SalesUserId,DisplayName,Region:'ภาคเดียวกัน',GoodId:'500',GoodName:'ของแถมทดสอบ',ItemName:'TEST',RemainingQty:100,canBorrowInto:SalesUserId===actor});
  if(path.endsWith('/borrow-requests'))legacy.push(path);
  if(path.endsWith('/quota-loans/options'))json={database:'fixture',items:url.searchParams.has('borrowerBudgetId')?
   [option(11,1,'ผู้ให้ยืม'),option(22,2,'ผู้ยืม')]:[option(actor===1?11:22,actor,actor===1?'ผู้ให้ยืม':'ผู้ยืม')]};
  else if(path.endsWith('/quota-loans/requests')){requests++;status='PENDING';json={Id:1};}
  else if(path.endsWith('/quota-loans/1/decision')){decisions++;status='APPROVED';json={id:1,status};}
  else if(path.endsWith('/quota-loans/1/repay')){returns++;returned+=Number(route.request().postDataJSON().quantity);if(returned===10)status='RETURNED';json={id:1,status};}
  else if(path.endsWith('/quota-loans'))json={database:'fixture',items:status?[{id:1,status,revision:1,quantity:10,returnedQty:returned,outstanding:10-returned,
   lenderName:'ผู้ให้ยืม',borrowerName:'ผู้ยืม',goodName:'ของแถมทดสอบ',reason:'test',isOpening:false,
   canDecide:status==='PENDING'&&actor===1,canCancel:status==='PENDING'&&actor===2,canRepay:status==='APPROVED'&&actor===2}]:[]};
  await route.fulfill({headers,json});
 });
 await page.goto('/tests/giveaway-quota-loans.html');
 await page.getByLabel('งบของผู้ยืม').selectOption('22');
 await page.getByRole('combobox',{name:'ผู้ให้ยืม',exact:true}).selectOption('11');
 await page.getByLabel('จำนวนที่ขอยืม').fill('10');await page.getByLabel('เหตุผลการยืม').fill('test');
 await page.getByRole('button',{name:'ยื่นขอยืมโควต้า',exact:true}).click();
 await page.getByRole('button',{name:'ตกลง',exact:true}).click();
 await expect(page.getByText('รอผู้ให้ยืมอนุมัติ',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'อนุมัติยืม',exact:true})).toHaveCount(0);
 actor=1;await page.getByRole('button',{name:'ฝ่ายขายผู้ให้ยืม',exact:true}).click();
 await page.getByRole('button',{name:'อนุมัติยืม',exact:true}).click();
 await page.getByRole('heading',{name:'ระบุข้อมูล'}).locator('..').getByRole('textbox').fill('approve');
 await page.getByRole('button',{name:'ตกลง',exact:true}).click();await page.getByRole('button',{name:'ตกลง',exact:true}).click();
 await expect(page.getByText('มีโควต้าค้างคืน',{exact:false})).toBeVisible();
 actor=2;await page.getByRole('button',{name:'ฝ่ายขายผู้ยืม',exact:true}).click();
 for(const qty of ['4','6']){
  await page.getByRole('button',{name:'คืนโควต้า',exact:true}).click();
  await page.getByRole('heading',{name:'ระบุข้อมูล'}).locator('..').getByRole('textbox').fill(qty);
  await page.getByRole('button',{name:'ตกลง',exact:true}).click();
  await page.getByRole('heading',{name:'ระบุข้อมูล'}).locator('..').getByRole('textbox').fill('return');
  await page.getByRole('button',{name:'ตกลง',exact:true}).click();await page.getByRole('button',{name:'ตกลง',exact:true}).click();
  await expect(page.getByText(qty==='4'?'คืนแล้ว 4':'คืนครบแล้ว',{exact:false})).toBeVisible();
 }
 await expect(page.getByRole('button',{name:'คืนโควต้า',exact:true})).toHaveCount(0);
 expect([requests,decisions,returns]).toEqual([1,1,2]);expect(legacy).toEqual([]);
});
