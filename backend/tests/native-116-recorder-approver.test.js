'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./helpers/route-harness.cjs').installDbStub(() => []);
const { splitBatches } = require('../run_migrations');
const { assertNoCrossDbWrite } = require('../safety-validator');

const directory = path.join(__dirname, '../migrations');
const text = fs.readFileSync(path.join(directory, '160_native_116_recorder_approver.sql'), 'utf8');
const batches = splitBatches(text);
const declaration = /^ALTER PROCEDURE wf\.usp_CreateInitialManualRedemption\b/i;

// The only changes allowed against migration 158's procedure body (owner decision 2026-10-30).
const edits = [
  [',@AppvEmp int,@DataHash varchar(64);',
    ',@AppvEmp int,@DataHash varchar(64),@SaveEmp int,@ApproverId int,@ApproverActor int,@ApprovedAt datetime,@Self bit;'],
  [" BEGIN RAISERROR('MR_ACTOR_UNAVAILABLE',16,1); RETURN; END;\n",
    " BEGIN RAISERROR('MR_ACTOR_UNAVAILABLE',16,1); RETURN; END;\n" +
    ' SELECT @SaveEmp=emp.EmpID FROM wf.AppUser u WITH(UPDLOCK,HOLDLOCK)\n' +
    ' JOIN dbo.EMEmp emp WITH(UPDLOCK,HOLDLOCK) ON CONVERT(varchar(30),emp.EmpID)=u.EmpId WHERE u.Id=@UserId;\n' +
    " IF @SaveEmp IS NULL BEGIN RAISERROR('MR_RECORDER_MAPPING_REQUIRED',16,1); RETURN; END;\n"],
  ['@AppvEmp=emp.EmpID,@DataHash=r.ApprovedDataHash\n',
    '@AppvEmp=emp.EmpID,@DataHash=r.ApprovedDataHash,\n  @ApproverId=u.Id,@ApproverActor=a.Id,@ApprovedAt=r.ApprovedAt,@Self=r.SelfApproval\n'],
  [" IF @Plate IS NULL OR @Receiver IS NULL OR @AppvEmp IS NULL BEGIN RAISERROR('MR_APPROVAL_REQUIRED',16,1); RETURN; END;\n",
    " IF @Plate IS NULL OR @Receiver IS NULL OR @AppvEmp IS NULL OR @ApprovedAt IS NULL OR @Self IS NULL BEGIN RAISERROR('MR_APPROVAL_REQUIRED',16,1); RETURN; END;\n" +
    ' IF NOT EXISTS(SELECT 1 FROM wf.NativeApproverEmployee WITH(UPDLOCK,HOLDLOCK) WHERE EmpID=@AppvEmp AND IsEnabled=1)\n' +
    " BEGIN RAISERROR('MR_APPROVER_NOT_LISTED',16,1); RETURN; END;\n"],
  [' INSERT INTO dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,AppvEmpID,SumGoodQty,DocuStatus,IsCheckAll)\n' +
    " VALUES(@New,@No,@Today,116,@Receiver,@Plate,@AppvEmp,@Qty,'N','Y');\n",
    ' INSERT INTO dbo.WFRedemtionHD(RedemtionID,DocuNo,DocuDate,DocuType,IssueName,CarLicense,SaveEmpID,SumGoodQty,DocuStatus,IsCheckAll)\n' +
    " VALUES(@New,@No,@Today,116,@Receiver,@Plate,@SaveEmp,@Qty,'N','Y');\n"],
  [" VALUES(@SOID,@RequestId,@Fingerprint,@Delivery,@Coupon,@New,@No,@UserId,@ActorId,@Before,@Audit,@Event,@DataHash,'O25-116-MANUAL-UAT2-v1');\n",
    " VALUES(@SOID,@RequestId,@Fingerprint,@Delivery,@Coupon,@New,@No,@UserId,@ActorId,@Before,@Audit,@Event,@DataHash,'O25-116-MANUAL-UAT2-v1');\n" +
    ' INSERT INTO wf.NativeDocumentApproval(DocuType,NativeDocID,NativeDocNo,SourceSOID,RequestId,RecorderUserId,RecorderActorId,RecorderEmpID,\n' +
    '  ApproverUserId,ApproverActorId,ApproverEmpID,SelfApproval,ApprovedAt,PolicyVersion)\n' +
    " VALUES(116,@New,@No,@SOID,@RequestId,@UserId,@ActorId,@SaveEmp,@ApproverId,@ApproverActor,@AppvEmp,@Self,@ApprovedAt,'O25-116-MANUAL-UAT2-v1');\n"],
];

test('migration 160 is transactional, portable and changes only the wf schema structure', () => {
  assert.match(text, /^-- @transaction/m);
  assert.equal(batches.length, 6);
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|INDEX)\s+(\[?dbo\]?\.)/i);
  assert.doesNotMatch(text, /CREATE\s+OR\s+ALTER|\bTHROW\b|\bIIF\s*\(|TRY_CONVERT|\bCONCAT\s*\(|\bOFFSET\b|DROP\s+\w+\s+IF\s+EXISTS/i);
  assert.doesNotMatch(text, /dbwins_worldfert/i);
  for (const batch of batches) assert.doesNotThrow(() => assertNoCrossDbWrite(batch));
});

test('the approver list starts with every WinSpeed employee and is never re-seeded over owner edits', () => {
  const seed = batches.find(b => /^INSERT INTO wf\.NativeApproverEmployee/i.test(b.trim()));
  assert.ok(seed);
  assert.match(seed, /SELECT e\.EmpID,N'migration 160 seed' FROM dbo\.EMEmp e\s+WHERE NOT EXISTS\(SELECT 1 FROM wf\.NativeApproverEmployee a WHERE a\.EmpID=e\.EmpID\)/);
  assert.doesNotMatch(seed, /EmpStatus|EmpType/);
  const roster = batches.find(b => /CREATE TABLE wf\.NativeApproverEmployee/.test(b));
  assert.match(roster, /IsEnabled bit NOT NULL CONSTRAINT DF_NativeApproverEmployee_IsEnabled DEFAULT 1/);
  const history = batches.find(b => /CREATE TABLE wf\.NativeApproverEmployeeHistory/.test(b));
  assert.match(history, /ChangedById int NOT NULL,ChangedByActorId int NOT NULL/);
  const approvals = batches.find(b => /CREATE TABLE wf\.NativeDocumentApproval/.test(b));
  assert.match(approvals, /PRIMARY KEY\(DocuType,NativeDocID\)/);
  assert.match(approvals, /UNIQUE\(DocuType,RequestId\)/);
});

test('the 116 writer equals migration 158 plus only the recorder/approver edits', () => {
  const original = splitBatches(fs.readFileSync(path.join(directory, '158_r740_native_uat_target.sql'), 'utf8'))
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

test('the writer keeps the UAT target guard, records SaveEmpID and never writes AppvEmpID', () => {
  const body = batches.find(b => declaration.test(b.trim()));
  assert.equal((body.match(/wf\.fn_IsInitialNativeUatTarget\(\)<>1/g) || []).length, 1);
  assert.doesNotMatch(body, /AppvEmpID/);
  assert.match(body, /INSERT INTO dbo\.WFRedemtionHD\([^)]*\bSaveEmpID\b[^)]*\)/);
  assert.match(body, /INSERT INTO wf\.NativeDocumentApproval/);
  assert.ok(body.indexOf('MR_RECORDER_MAPPING_REQUIRED') < body.indexOf('INSERT INTO dbo.WFRedemtionHD'));
  assert.ok(body.indexOf('MR_APPROVER_NOT_LISTED') < body.indexOf('INSERT INTO dbo.WFRedemtionHD'));
});
