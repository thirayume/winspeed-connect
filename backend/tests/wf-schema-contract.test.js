'use strict';

/**
 * backend/tests/wf-schema-contract.test.js
 *
 * Offline schema-contract test (R10.1-1)
 *
 * Scans every route and service in backend/routes and backend/services for
 * INSERT INTO wf.<Table> and UPDATE wf.<Table> statements touching the 8 core tables:
 * - RebateClaim
 * - SalesOrder
 * - SalesOrderExt
 * - SalesOrderLine
 * - SalesOrderLineExt
 * - RebateLedger
 * - RebateUsage
 * - RebatePool
 *
 * Asserts that EVERY column referenced exists in the captured schema fixture:
 * docs/sale-app/qa/evidence/claude-r10-1-review-20261005/wf-columns-snapshot.out.txt
 *
 * Specifically verifies that wf.RebateClaim NEVER references UpdatedAt anywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Schema fixture captured directly from sys.columns on live DB (Migration 141 applied)
const SCHEMA_FIXTURE = {
  RebateClaim: [
    'Id', 'PoolId', 'SalesUserId', 'CustId', 'ClaimAmt', 'RemainingAmt', 'Status',
    'CnDocuNo', 'Note', 'ApprovedAt', 'ApprovedBy', 'CreatedAt', 'RegionCode',
    'CurrentTier', 'PeriodYear', 'PeriodMonth', 'RbSOInvID', 'RbDocDate',
    'RbMatchedAt', 'CustomerRatio', 'CompanyRatio', 'CustomerAmount',
    'RetainedAmount', 'IsSelfClaim', 'PolicyVersionId', 'PolicySnapshotId',
    'IdempotencyKey', 'RequestPayloadHash', 'AppliedDraftSoId', 'AppliedSoDocuNo'
  ],
  RebateLedger: [
    'Id', 'PoolId', 'SoId', 'SoLineId', 'CustId', 'GoodId', 'GoodCode', 'QtyTon',
    'PricePerTon', 'NetPricePerTon', 'RebatePerTon', 'RebateAmount', 'RemainingAmt',
    'Status', 'ReversedFlag', 'ReversedAt', 'ReversedNote', 'CreatedAt', 'PlanId',
    'Region'
  ],
  RebatePool: [
    'Id', 'SalesUserId', 'PeriodYear', 'PeriodMonth', 'AccruedAmt', 'ClaimedAmt',
    'AllocatedAmt', 'CreatedAt', 'UpdatedAt'
  ],
  RebateUsage: [
    'Id', 'LedgerId', 'AppliedSOID', 'DeductedAmt', 'CreatedAt'
  ],
  SalesOrder: [
    'Id', 'WfRef', 'SoPrefix', 'CustId', 'CustName', 'TruckPlate', 'ControlTicketNo',
    'DeliveryDate', 'Remark', 'Status', 'SalesUserId', 'ImportFilePath',
    'ImportedDocuNo', 'ImportedAt', 'CreatedAt', 'UpdatedAt', 'RebateDiscountAmt',
    'VerifiedBy', 'VerifiedAt', 'RequestedAt', 'IsOwnTruck', 'NoTruckRequired',
    'PSling', 'CreditDays', 'TruckRemark', 'BillRemark', 'TranspId', 'NotifiedAt',
    'EnteredByUserId', 'TripId', 'PickupDueDays', 'PickupDueDate', 'PickupDueType',
    'ConfirmedAt', 'PickupPolicySnapshotId', 'RequiresPriceApproval',
    'PriceApprovalStatus', 'DocumentRevision', 'PricingFingerprint',
    'AppliedRebateClaimId', 'ClaimDiscountAmt'
  ],
  SalesOrderExt: [
    'SOID', 'WfRef', 'SoPrefix', 'SalesUserId', 'ControlTicketNo', 'DeliveryDate',
    'ImportFilePath', 'ImportedDocuNo', 'ImportedAt', 'CreatedAt', 'UpdatedAt',
    'IsLoaded', 'WeighOutWeight', 'RebateDiscountAmt', 'RequestedAt', 'IsOwnTruck',
    'NoTruckRequired', 'PSling', 'CreditDays', 'TruckRemark', 'BillRemark',
    'TranspId', 'IsUnlocked', 'NotifiedAt', 'EnteredByUserId', 'TripId',
    'PickupDueDate', 'PickupDueType', 'ConfirmedAt', 'PickupPolicySnapshotId',
    'SourceDraftId', 'AppliedRebateClaimId', 'ClaimDiscountAmt'
  ],
  SalesOrderLine: [
    'Id', 'SoId', 'LineNum', 'GoodId', 'GoodCode', 'GoodName', 'QtyTon', 'QtyBag',
    'PricePerTon', 'NetPricePerTon', 'LineAmount', 'RebatePerTon', 'RebateAmount',
    'IsGiveaway', 'RebateBooked', 'CreatedAt', 'RefControlTicketNo',
    'IsControlTicketDrawn', 'GiveawayApprovalStatus', 'GiveawayApprovedBy',
    'GiveawayApprovedAt', 'GiveawayApprovalNote', 'LoadSequence', 'MasterQty',
    'ChildQty', 'CouponReservationId', 'RefCouponDocuNo', 'IsCouponDrawn'
  ],
  SalesOrderLineExt: [
    'SOID', 'ListNo', 'NetPricePerTon', 'IsGiveaway', 'RebateBooked',
    'LoadSequence', 'RefControlTicketNo', 'IsControlTicketDrawn',
    'GiveawayApprovalStatus', 'GiveawayApprovedBy', 'GiveawayApprovedAt',
    'GiveawayApprovalNote', 'MasterQty', 'ChildQty'
  ]
};

const SCHEMA_MAP = {};
for (const [k, v] of Object.entries(SCHEMA_FIXTURE)) {
  SCHEMA_MAP[k.toLowerCase()] = new Set(v.map(c => c.toLowerCase()));
}

function parseTopLevelAssignments(setClause) {
  const assignments = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < setClause.length; i++) {
    const ch = setClause[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      assignments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) assignments.push(current.trim());

  const cols = [];
  for (const a of assignments) {
    const eqIdx = a.indexOf('=');
    if (eqIdx > 0) {
      const lhs = a.slice(0, eqIdx).trim();
      // Match column name (must not start with @)
      const m = lhs.match(/^[\[]?([a-zA-Z0-9_]+)[\]]?$/);
      if (m && !m[1].startsWith('@')) {
        cols.push(m[1]);
      }
    }
  }
  return cols;
}

function getCodeFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getCodeFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('1. Schema Contract: wf.RebateClaim has NO UpdatedAt column in fixture', () => {
  assert.equal(SCHEMA_MAP.rebateclaim.has('updatedat'), false, 'RebateClaim must not have UpdatedAt');
});

test('2. Schema Contract: All INSERT and UPDATE statements in routes/ and services/ match real schema', () => {
  const backendDir = path.resolve(__dirname, '..');
  const targetDirs = [
    path.join(backendDir, 'routes'),
    path.join(backendDir, 'services')
  ];

  const codeFiles = targetDirs.flatMap(getCodeFiles);
  const violations = [];

  for (const file of codeFiles) {
    const relativePath = path.relative(backendDir, file);
    const content = fs.readFileSync(file, 'utf8');

    // 1. Check UPDATE statements on wf.<TableName>
    const updateRegex = /UPDATE\s+wf\.([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?=\s+WHERE|\s*`|\s*"|\s*';|\s*\))/gi;
    let m;
    while ((m = updateRegex.exec(content)) !== null) {
      const tbl = m[1];
      const validCols = SCHEMA_MAP[tbl.toLowerCase()];
      if (!validCols) continue; // Not one of our 8 core tables

      const cols = parseTopLevelAssignments(m[2]);
      for (const col of cols) {
        if (!validCols.has(col.toLowerCase())) {
          violations.push({
            file: relativePath,
            table: tbl,
            op: 'UPDATE',
            column: col
          });
        }
      }
    }

    // 2. Check INSERT statements on wf.<TableName>
    const insertRegex = /INSERT\s+INTO\s+wf\.([a-zA-Z0-9_]+)\s*\(([^)]+)\)/gi;
    let im;
    while ((im = insertRegex.exec(content)) !== null) {
      const tbl = im[1];
      const validCols = SCHEMA_MAP[tbl.toLowerCase()];
      if (!validCols) continue;

      const rawCols = im[2].split(',').map(c => c.trim().replace(/^\[|\]$/g, '')).filter(Boolean);
      for (const col of rawCols) {
        if (col.includes(' ') || col.includes('(')) continue;
        if (!validCols.has(col.toLowerCase())) {
          violations.push({
            file: relativePath,
            table: tbl,
            op: 'INSERT',
            column: col
          });
        }
      }
    }
  }

  assert.deepEqual(violations, [], `Found schema violations in routes/services: ${JSON.stringify(violations, null, 2)}`);
});
