-- @transaction
-- Refuse rollback once any source proof or permit exists. No audit/history is deleted.
IF EXISTS(SELECT 1 FROM wf.CouponBridgeDocument) OR EXISTS(SELECT 1 FROM wf.CouponBridgePermit)
 RAISERROR('BRIDGE_HISTORY_PREVENTS_DOWN',16,1);
GO
DROP PROCEDURE wf.sp_CouponBridgeWithdraw;
DROP PROCEDURE wf.sp_CouponBridgeAssertDocument;
DROP TRIGGER wf.WF_CouponBridgeReservationFence;
DROP TRIGGER wf.WF_CouponBridgeRequestFence;
DROP PROCEDURE wf.sp_CouponBridgeResume;
DROP PROCEDURE wf.sp_CouponBridgeRelease;
DROP PROCEDURE wf.sp_CouponBridgeAdopt;
DROP PROCEDURE wf.sp_CouponBridgeFloor;
DROP PROCEDURE wf.sp_CouponBridgeObserve;
DROP PROCEDURE wf.sp_CouponBridgeFinish;
DROP PROCEDURE wf.sp_CouponBridgeRegister;
DROP PROCEDURE wf.sp_CouponBridgePublish;
DROP PROCEDURE wf.sp_CouponBridgeScope;
DROP PROCEDURE wf.sp_CouponBridgeSource;
DROP PROCEDURE wf.sp_CouponBridgePhysical;
DROP VIEW wf.CouponBridgeEffectiveSettlement;
DROP FUNCTION wf.fn_CouponBridgeReservationHeld;
DROP TABLE wf.CouponBridgeSession;
DROP TABLE wf.CouponBridgeReturn;
DROP TABLE wf.CouponBridgeAllocation;
DROP TABLE wf.CouponBridgeLine;
DROP TABLE wf.CouponBridgePermit;
DROP TABLE wf.CouponBridgeDocumentLine;
DROP TABLE wf.CouponBridgeDocument;
DROP TABLE wf.CouponBridgeContract;
GO
