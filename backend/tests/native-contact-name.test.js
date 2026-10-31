'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

const directory = path.join(__dirname, '../migrations');
const read = file => fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n');
const text = read('163_native_contact_name.sql');
const batches = splitBatches(text);
const declaration = name => new RegExp('^ALTER PROCEDURE wf\\.' + name + '\\b', 'im');
const body = (batchList, name) => {
  const found = batchList.filter(b => declaration(name).test(b));
  assert.equal(found.length, 1, name);
  return found[0].slice(found[0].search(declaration(name))).trim() + '\n';
};

// WINSpeed: 103 ContactName = the customer's default contact; the 104, its 202 and the 107 copy it.
const procedures = [
  ['sp_ConfirmSalesOrder', '137_booking_description_and_rebate.sql', [
    ['        SELECT @DeptID = DeptID FROM dbo.EMEmp WHERE EmpID = @EmpID;\n',
     '        SELECT @DeptID = DeptID FROM dbo.EMEmp WHERE EmpID = @EmpID;\n' +
     "        -- WINSpeed puts the customer's default contact on the booking; the 104, 202 and 107 copy it.\n" +
     '        DECLARE @ContactName VARCHAR(255);\n' +
     "        SELECT TOP 1 @ContactName = ContactName FROM dbo.EMCustContact WHERE CustID = @CustId AND IsDefault = 'Y' ORDER BY ListNo, ContactID;\n"],
    ['            SOID, DocuNo, CustID, CustName, DocuDate,', '            SOID, DocuNo, CustID, CustName, ContactName, DocuDate,'],
    ['            @NewSoid, @DocuNo, @CustId, @CustName, @NativeDocuDate,', '            @NewSoid, @DocuNo, @CustId, @CustName, @ContactName, @NativeDocuDate,'],
  ]],
  ['usp_CreateCompleteInitialDelivery', '158_r740_native_uat_target.sql', [
    ['  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag)\n',
     '  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,AppvFlag,PkgStatus,Refeflag,CouponFlag,ContactName)\n'],
    ["  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'Y'\n FROM dbo.SOHD WHERE SOID=@SOID;\n",
     "  ResvAmnt1,ResvAmnt2,ResvAmnt3,ResvAmnt4,VATGroupID,QuotStatus,'W','N',Refeflag,'Y',ContactName\n FROM dbo.SOHD WHERE SOID=@SOID;\n"],
    ['  CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag)\n SELECT SaleAreaID,@FinanceId,',
     '  CutAdvnFlag,SONo,ReplaceFlag,LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)\n SELECT SaleAreaID,@FinanceId,'],
    ["'N',@No,'N',1,CustName,0,0,'Y' FROM dbo.SOHD WHERE SOID=@NewId;\n",
     "'N',@No,'N',1,CustName,0,0,'Y',ContactName FROM dbo.SOHD WHERE SOID=@NewId;\n"],
  ]],
  ['usp_PostInitialCouponInvoice', '162_native_107_scale_slip.sql', [
    ['LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag)\n SELECT SaleAreaID,@New,',
     'LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,CouponFlag,ContactName)\n SELECT SaleAreaID,@New,'],
    ["LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,'Y' FROM dbo.SOInvHD WHERE SOInvID=@Finance AND Docutype=202;\n",
     "LastRevExchRate,CustName,AdvnGainLost,sumbaseadvance,'Y',ContactName FROM dbo.SOInvHD WHERE SOInvID=@Finance AND Docutype=202;\n"],
  ]],
];

test('migration 163 is transactional, portable and changes no dbo structure', () => {
  assert.match(text, /^-- @transaction/m);
  assert.equal(batches.length, 4);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b/i);
  assert.doesNotMatch(text, /dbwins_worldfert/i);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});

for (const [name, source, edits] of procedures) {
  test(`${name} equals migration ${source.slice(0, 3)} plus only the ContactName edits`, () => {
    let expected = body(splitBatches(read(source)), name);
    for (const [from, to] of edits) {
      assert.equal(expected.split(from).length - 1, 1, 'anchor must occur once: ' + from.slice(0, 50));
      expected = expected.replace(from, () => to);
    }
    assert.equal(body(batches, name), expected);
  });
}

test('the contact comes from the default customer contact and is copied down unchanged', () => {
  const booking = body(batches, 'sp_ConfirmSalesOrder');
  assert.match(booking, /FROM dbo\.EMCustContact WHERE CustID = @CustId AND IsDefault = 'Y'/);
  const delivery = body(batches, 'usp_CreateCompleteInitialDelivery');
  assert.equal((delivery.match(/,ContactName\)/g) || []).length, 2, '104 and 202 column lists');
  assert.equal((delivery.match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
  const invoice = body(batches, 'usp_PostInitialCouponInvoice');
  assert.match(invoice, /'Y',ContactName FROM dbo\.SOInvHD WHERE SOInvID=@Finance AND Docutype=202/);
  assert.equal((invoice.match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
});
