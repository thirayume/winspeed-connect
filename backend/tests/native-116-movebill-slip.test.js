'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

const directory = path.join(__dirname, '../migrations');
const text = fs.readFileSync(path.join(directory, '161_native_116_movebill_slip.sql'), 'utf8');
const batches = splitBatches(text);
const declaration = /^ALTER PROCEDURE wf\.usp_CreateInitialManualRedemption\b/i;

// Owner decision 2026-10-31: the 116 number is the transport slip (the scale's MoveBill, or a
// typed slip as an exception). These are the only changes allowed against migration 160's body.
const edits = [
  [",@ApprovedAt datetime,@Self bit;",
   ",@ApprovedAt datetime,@Self bit,@Slip varchar(25),@SlipSource varchar(20),@ScaleEvent int,@ScaleNet int,@Exception bit,@ApproverRole varchar(30);"],
  ["  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))\n",
   ""],
  ["  @ApproverId=u.Id,@ApproverActor=a.Id,@ApprovedAt=r.ApprovedAt,@Self=r.SelfApproval\n",
   "  @ApproverId=u.Id,@ApproverActor=a.Id,@ApprovedAt=r.ApprovedAt,@Self=r.SelfApproval,\n  @Slip=r.SlipNo,@SlipSource=r.SlipSource,@ScaleEvent=r.ScaleEventId,@ScaleNet=r.ScaleNetKg,@Exception=r.ExceptionRequired,@ApproverRole=u.Role\n"],
  [" DECLARE @Last varchar(50),@Format varchar(50),@Next int,@No varchar(25),@G int;\n SELECT @Last=RTRIM(LastNo),@Format=RTRIM(RunFormat) FROM dbo.EMRunBrch WITH(UPDLOCK,HOLDLOCK) WHERE BrchID=1 AND RunCode='redemption';\n IF @Format IS NULL OR @Format<>'yy010000' OR @Last IS NULL OR LEN(@Last)<>8 OR @Last NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'\n  OR LEFT(@Last,2)<>RIGHT(CONVERT(varchar(4),YEAR(@Today)+543),2)\n BEGIN RAISERROR('MR_COUNTER_UNSUPPORTED',16,1); RETURN; END;\n SET @Next=CONVERT(int,@Last); SET @G=0;\n WHILE @G<1000 BEGIN\n  SET @Next=@Next+1; SET @G=@G+1; SET @No=CONVERT(varchar(25),@Next);\n  IF LEN(@No)<>8 OR LEFT(@No,2)<>LEFT(@Last,2) BEGIN RAISERROR('MR_NUMBER_EXHAUSTED',16,1); RETURN; END;\n  IF NOT EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@No) BREAK;\n END;\n IF @G>=1000 BEGIN RAISERROR('MR_NUMBER_EXHAUSTED',16,1); RETURN; END;\n",
   " DECLARE @No varchar(25);\n IF @Slip IS NULL OR LEN(@Slip)<>7 OR @Slip NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9]' OR @SlipSource NOT IN('SCALE','MANUAL') OR @Exception IS NULL\n BEGIN RAISERROR('MR_SLIP_INVALID',16,1); RETURN; END;\n IF EXISTS(SELECT 1 FROM dbo.WFRedemtionHD WITH(UPDLOCK,HOLDLOCK) WHERE DocuNo=@Slip)\n BEGIN RAISERROR('MR_SLIP_IN_USE',16,1); RETURN; END;\n IF @SlipSource='SCALE' AND((SELECT COUNT(*) FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))<>1\n  OR NOT EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE Id=@ScaleEvent AND WGType='SO' AND SPID=@SOID AND RTRIM(Status)='3'\n   AND RTRIM(MoveBill)=@Slip AND RTRIM(CarNo)=@Plate AND WeightNet=@ScaleNet AND WeightNet>0)\n  OR @Exception<>CASE WHEN ABS(@ScaleNet-@Qty*1000)<=@Qty*20 THEN 0 ELSE 1 END)\n BEGIN RAISERROR('MR_SCALE_CHANGED',16,1); RETURN; END;\n IF @SlipSource='MANUAL' AND(@Exception<>1\n  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE WGType='SO' AND SPID IN(@SOID,@Delivery))\n  OR EXISTS(SELECT 1 FROM dbo.WGHD WITH(UPDLOCK,HOLDLOCK) WHERE RTRIM(MoveBill)=@Slip))\n BEGIN RAISERROR('MR_SCALE_CHANGED',16,1); RETURN; END;\n IF @Exception=1 AND(@Self<>0 OR @ApproverRole NOT IN('MANAGER','C_LEVEL','ADMIN'))\n BEGIN RAISERROR('MR_EXCEPTION_APPROVER_REQUIRED',16,1); RETURN; END;\n SET @No=@Slip;\n"],
  [" UPDATE dbo.EMRunBrch SET LastNo=@No WHERE BrchID=1 AND RunCode='redemption' AND LastNo=@Last AND RunFormat=@Format;\n IF @@ROWCOUNT<>1 BEGIN RAISERROR('MR_COUNTER_UNSUPPORTED',16,1); RETURN; END;\n",
   ""],
  ["SET @Note=N'O25-116-MANUAL-UAT2-v1; UAT_SIMULATION; request='+@RequestId;",
   "SET @Note=N'O25-116-MANUAL-UAT2-v1; UAT_SIMULATION; slip='+@SlipSource+N'; request='+@RequestId;"],
];

test('migration 161 is transactional, portable and only adds wf columns', () => {
  assert.match(text, /^-- @transaction/m);
  assert.equal(batches.length, 3);
  assert.match(batches[1], /ALTER TABLE wf\.NativeManualRedemptionRequest ADD SlipNo varchar\(25\) NULL/);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b|DROP\s+\w+\s+IF\s+EXISTS/i);
  assert.doesNotMatch(text, /dbwins_worldfert/i);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});

test('the 116 writer equals migration 160 plus only the slip edits', () => {
  const original = splitBatches(fs.readFileSync(path.join(directory, '160_native_116_recorder_approver.sql'), 'utf8'))
    .filter(b => declaration.test(b.trim()));
  const replacement = batches.filter(b => declaration.test(b.trim()));
  assert.equal(original.length, 1); assert.equal(replacement.length, 1);
  let expected = original[0].trim() + '\n';
  for (const [from, to] of edits) {
    assert.equal(expected.split(from).length - 1, 1, 'anchor must occur once: ' + from.slice(0, 50));
    expected = expected.replace(from, () => to);
  }
  assert.equal(replacement[0].trim() + '\n', expected);
});

test('the writer numbers 116 from the slip, never from the redemption counter, and keeps its guards', () => {
  const body = batches.find(b => declaration.test(b.trim()));
  assert.doesNotMatch(body, /EMRunBrch|MR_COUNTER_UNSUPPORTED|MR_NUMBER_EXHAUSTED|AppvEmpID/);
  assert.equal((body.match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
  assert.match(body, /SET @No=@Slip;/);
  assert.match(body, /RTRIM\(MoveBill\)=@Slip AND RTRIM\(CarNo\)=@Plate AND WeightNet=@ScaleNet/);
  assert.match(body, /ABS\(@ScaleNet-@Qty\*1000\)<=@Qty\*20/);
  assert.match(body, /IF @Exception=1 AND\(@Self<>0 OR @ApproverRole NOT IN\('MANAGER','C_LEVEL','ADMIN'\)\)/);
  for (const code of ['MR_SLIP_INVALID', 'MR_SLIP_IN_USE', 'MR_SCALE_CHANGED', 'MR_EXCEPTION_APPROVER_REQUIRED'])
    assert.ok(body.indexOf(code) < body.indexOf('INSERT INTO dbo.WFRedemtionHD'), code);
  assert.match(body, /PolicyVersion='O25-116-MANUAL-UAT2-v1'/);
});
