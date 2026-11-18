'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),h=require('./helpers/route-harness.cjs');
const user={sub:8,role:'ADMIN'};let scenario='header',orderReads=0,lineReads=0,existingReads=0,options;
const auth=require.resolve('../middleware/auth');require.cache[auth]={id:auth,filename:auth,loaded:true,exports:{requireAuth:(req,_res,next)=>{req.user=user;next();},requireCapability:()=>((_req,_res,next)=>next()),requireRole:()=>((_req,_res,next)=>next())}};
const cost=require.resolve('../services/cost-authority');require.cache[cost]={id:cost,filename:cost,loaded:true,exports:{assertPricesAboveCost:async()=>({missingCost:[]}),assertPriceBookLinesSellable:async()=>{},evaluateSellingPriceFloor:async()=>({})}};
const db=h.installDbStub(({text})=>{
 if(/OBJECT_ID\('wf\.QuotationSourceSO'/.test(text))return [{HasTable:1}];
 if(/AS HasNativeTables/.test(text))return [{HasNativeTables:1,HasLinkColumns:1}];
 if(/SELECT SourceKind, Id, WfRef/.test(text)){orderReads++;return [{SourceKind:'APP',Id:1,WfRef:'QA',CustId:'1',CustName:'Synthetic',Status:scenario==='header'&&orderReads===2?'CONFIRMED':'DRAFT',SalesUserId:8,OwnerEmpId:null,TruckPlate:'',DeliveryDate:null}];}
 if(/SELECT TOP 1 q\.QuoteNo/.test(text)){existingReads++;return scenario==='duplicate'&&existingReads===2?[{QuoteNo:'SYNTHETIC'}]:[];}
 if(/FROM wf\.SalesOrderLine sol/.test(text)){lineReads++;return [{GoodId:'1',GoodCode:'P',GoodName:'Synthetic',QtyTon:scenario==='line'&&lineReads===2?2:1,PricePerTon:10,NetPricePerTon:10,IsGiveaway:0}];}
 return [];
});
db.stub.pools=()=>({ready:Promise.resolve(),ownerPool:{request:()=>db.tx.request()}});
db.stub.wfTransaction=async(fn,opts)=>{options=opts;return fn(db.tx);};
let app;test.before(async()=>{app=await h.startApp([['/api/quotation','../../routes/quotation']]);});test.after(async()=>app.close());
for(const [name,expected] of [['header','SO ต้นทาง'],['duplicate','ถูกผูก'],['line','รายการสินค้า']])test(`changed ${name} is rejected under transaction locks before any writes`,async()=>{
 scenario=name;orderReads=0;lineReads=0;existingReads=0;db.calls.length=0;
 const r=await app.call('POST','/api/quotation/from-so-trip',{body:{soIds:[1]}});
 assert.equal(r.status,409,JSON.stringify(r.body));assert.match(r.body.message,new RegExp(expected));
 assert.equal(options.isolationLevel,db.stub.sql.ISOLATION_LEVEL.SERIALIZABLE);
 assert.match(db.calls.filter(c=>/SELECT SourceKind, Id, WfRef/.test(c.text))[1].text,/UPDLOCK, HOLDLOCK/);
 assert.ok(!db.calls.some(c=>/INSERT INTO wf\.Quotation|UPDATE wf\.SalesOrder/.test(c.text)));
});
