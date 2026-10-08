'use strict';

/**
 * Status of a WinSpeed document as the boards show it, and the de-duplication rule.
 *
 * A booking (103) that WinSpeed has turned into a sales order (104) keeps both documents under the same number;
 * counting both showed every closed booking twice — once as "waiting for delivery", once as "closed in WinSpeed"
 * (35,224 pairs on the production copy). The Paper Trail board already kept the 104; the dashboard now does too.
 */
function nativeStatusSql(hd = 'hd', ext = 'ext') {
  return `CASE
    WHEN ${hd}.DocuStatus = 'C' THEN 'CANCELLED'
    WHEN ${ext}.WeighOutWeight IS NOT NULL OR ${hd}.clearflag = 'Y' THEN 'SHIPPED'
    WHEN ${hd}.DocuType = 104 THEN 'IMPORTED'
    WHEN ${ext}.IsLoaded = 1 THEN 'LOADED'
    WHEN ${hd}.PkgStatus = 'Y' THEN 'PICKING'
    WHEN ${ext}.IsUnlocked = 1 THEN 'DRAFT'
    WHEN ${hd}.AppvFlag = 'W' AND ${hd}.AppvDocuNo IS NULL THEN 'PENDING_APPROVAL'
    ELSE 'CONFIRMED'
  END`;
}

/** true when the row is not a booking already superseded by its sales order (104) */
function nativeDedupSql(hd = 'hd') {
  return `NOT (${hd}.DocuType = 103 AND EXISTS (SELECT 1 FROM dbo.SOHD d104 WITH (NOLOCK) WHERE d104.DocuType = 104 AND d104.DocuNo = ${hd}.DocuNo))`;
}

module.exports = { nativeStatusSql, nativeDedupSql };
