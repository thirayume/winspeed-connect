'use strict';
// Explicit legacy-schema fixture for tests with hand-built SQL stubs.
module.exports = text => String(text).includes('NATIVE_HOLD_SCHEMA_V1') ? {
  recordset:[{...require('./coupon-bridge-metadata').absent,NativeHoldSchemaState:'NATIVE_HOLD_SCHEMA_V1',Ledger220:0,HeaderVisible:0,LineVisible:0,SchemaSelect:1}],
} : String(text).includes('NATIVE_CUT_EVIDENCE_SCHEMA_V1') ? {
  recordset:[{EvidenceSchemaState:'NATIVE_CUT_EVIDENCE_SCHEMA_V1',Ledger223:0,EvidenceVisible:0,SchemaSelect:1}],
} : String(text).includes('COUPON_RECOVERY_READINESS_V1') ? {
  recordset:[{...require('./coupon-bridge-metadata').absent,RecoverySchemaState:'COUPON_RECOVERY_READINESS_V1',Ledger232:0,EditHoldVisible:0,Ledger231:0,RecoveryVisible:0,SchemaSelect:1}],
} : String(text).includes('COUPON_LEGACY_SETTLEMENT_SCHEMA_V1') ? {
  recordset:[{SchemaState:'COUPON_LEGACY_SETTLEMENT_SCHEMA_V1',SettlementTable:null,ConsumedLength:null,SchemaSelect:1}],
} : null;
