'use strict';
const directAbsent={NativeStageLedger:0,NativeAdmissionLedger:0,NativeRecoveryLedger:0,NativeSetOptionsLedger:0,NativeIdRangeLedger:0,NativeRecoveryVisible:0,NativeStageVisible:0,NativeStageCouponVisible:0,NativeStageReceiptVisible:0};
const absent={...directAbsent,BridgeLedger:0,BridgePermit:0,BridgeLine:0,BridgeReturn:0,BridgeView:0,BridgeSchemaSelect:1};
const current={...directAbsent,BridgeLedger:1,BridgePermit:1,BridgeLine:1,BridgeReturn:1,BridgeView:1,BridgeSchemaSelect:1,
 BridgePermitSelect:1,BridgeLineSelect:1,BridgeReturnSelect:1,BridgeViewSelect:1};
const direct={...current,NativeStageLedger:1,NativeAdmissionLedger:1,NativeRecoveryLedger:1,NativeSetOptionsLedger:1,NativeIdRangeLedger:1,NativeRecoveryVisible:1,NativeRecoveryExecute:1,NativeStageVisible:1,NativeStageCouponVisible:1,NativeStageReceiptVisible:1,
 NativeStageSelect:1,NativeStageCouponSelect:1,NativeStageReceiptSelect:1};
module.exports={absent,current,direct};
