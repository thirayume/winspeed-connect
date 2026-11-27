-- @transaction
-- Keep the forward-only counter and its audit history. Rewinding would reuse
-- document numbers. Removing these wf hooks does not alter native triggers.
IF OBJECT_ID('wf.Native116CounterOnReceipt','TR') IS NOT NULL DROP TRIGGER wf.Native116CounterOnReceipt;
IF OBJECT_ID('wf.Native116CounterOnComplete','TR') IS NOT NULL DROP TRIGGER wf.Native116CounterOnComplete;
IF OBJECT_ID('wf.sp_Native116AdvanceNumberCounter','P') IS NOT NULL DROP PROCEDURE wf.sp_Native116AdvanceNumberCounter;
GO
