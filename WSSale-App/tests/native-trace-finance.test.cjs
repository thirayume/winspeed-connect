const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server');const React=require('react');
const file=path.resolve(__dirname,'../src/components/master/NativeTraceFinance.tsx');
const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const component=new Module(file,module);component.filename=file;component.paths=Module._nodeModulePaths(path.dirname(file));component._compile(compiled,file);
const {NativeTraceFinance}=component.exports;
const finance=[{soInvId:801,docuNo:'I69-00001',docuType:202,docuDate:'2026-10-25',netAmnt:18200},{soInvId:802,docuNo:'J69-00001',docuType:107,docuDate:'2026-10-25',netAmnt:18200}];
test('real flat trace contract displays116 number/quantity/invoice and distinguishes202 from107',()=>{
 const html=renderToStaticMarkup(React.createElement(NativeTraceFinance,{redemptions:[{redemptionId:701,redemptionDocuNo:'69000001',couponId:501,couponNo:'C6900001',redeemedQtyTon:1,unitName:'ตัน',invoiceDocuNo:'J69-00001',invoiceDocuType:107}],invoices:finance}));
 for(const text of ['69000001','C6900001','1 ตัน','J69-00001','เอกสารลูกหนี้ (202)','Invoice / ใบกำกับภาษี (107)'])assert.ok(html.includes(text),text);
 for(const text of ['undefined','116-#','36,400','ยังไม่มี Invoice 107'])assert.ok(!html.includes(text),text);
});
test('a202-only trace does not claim Invoice107; unknown types keep their own label',()=>{
 const html=renderToStaticMarkup(React.createElement(NativeTraceFinance,{invoices:[finance[0],{...finance[1],docuType:209,docuNo:'OTHER'}]}));
 assert.ok(html.includes('เอกสารลูกหนี้ (202)'));assert.ok(html.includes('ยังไม่มี Invoice 107'));assert.ok(html.includes('เอกสารการเงิน (209)'));assert.ok(!html.includes('Invoice / ใบกำกับภาษี (107)'));
});
