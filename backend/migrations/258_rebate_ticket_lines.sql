-- @transaction
-- ============================================================================
-- 258_rebate_ticket_lines.sql
-- Owner, 22 Nov 2026: a customer uses a Rebate ticket inside a normal bill. The ticket line is the ticket's goods at
-- price 0 (WinSpeed's 202 and 107 never carry a bill discount, so a price-0 line is the only shape that keeps the
-- receivable right). A bill may hold several ticket lines. The tickets are deducted when the 103 is issued, returned
-- if that 103 is cancelled before its 116, and the deduction becomes final once the line's 116 is cut.
-- 1. wf.SalesOrderLine.IsRebateTicket marks a draft ticket line (price 0, no Rebate mode, not a giveaway or a
--    WinSpeed ticket line, quantity above zero). Existing rows are 0.
-- 2. wf.RebateTicketReceiptState holds the state of a ticket receipt (RESERVED, FINAL, RELEASED); the receipt and its
--    allocations stay immutable. A receipt with no state row is final (the earlier redeem route).
-- wf only; no dbo object or row changes. Rollback: down/258_rebate_ticket_lines.down.sql (refuses while ticket lines
-- or receipt states exist). SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF OBJECT_ID('wf.SalesOrderLine','U') IS NULL OR OBJECT_ID('wf.RebateTicketRedemptionReceipt','U') IS NULL
 RAISERROR('RTL_PREREQUISITE_REQUIRED',16,1);
GO
IF COL_LENGTH('wf.SalesOrderLine','IsRebateTicket') IS NULL
 ALTER TABLE wf.SalesOrderLine ADD IsRebateTicket bit NOT NULL CONSTRAINT DF_SalesOrderLine_IsRebateTicket DEFAULT (0);
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_SalesOrderLine_RebateTicket' AND parent_object_id=OBJECT_ID('wf.SalesOrderLine'))
 EXEC sp_executesql N'ALTER TABLE wf.SalesOrderLine WITH CHECK ADD CONSTRAINT CK_SalesOrderLine_RebateTicket
  CHECK (IsRebateTicket=0 OR (PricePerTon=0 AND RebatePricingMode IS NULL AND ISNULL(IsGiveaway,0)=0
   AND ISNULL(IsCouponDrawn,0)=0 AND ISNULL(IsControlTicketDrawn,0)=0 AND CouponReservationId IS NULL
   AND RefCouponDocuNo IS NULL AND RefControlTicketNo IS NULL AND QtyTon>0))';
GO
IF OBJECT_ID('wf.RebateTicketReceiptState','U') IS NULL
 CREATE TABLE wf.RebateTicketReceiptState (
  ReceiptId bigint NOT NULL CONSTRAINT PK_RebateTicketReceiptState PRIMARY KEY
   CONSTRAINT FK_RTRS_Receipt REFERENCES wf.RebateTicketRedemptionReceipt(Id),
  Status varchar(10) NOT NULL,
  ReferencePricePerTon decimal(14,2) NULL,
  ReferenceAmount decimal(18,2) NULL,
  FinalRedemptionId int NULL,
  FinalRedemptionNo varchar(25) NULL,
  Reason nvarchar(200) NULL,
  Revision int NOT NULL CONSTRAINT DF_RTRS_Revision DEFAULT (1),
  CreatedAtUtc datetime2 NOT NULL CONSTRAINT DF_RTRS_Created DEFAULT GETUTCDATE(),
  ChangedAtUtc datetime2 NOT NULL CONSTRAINT DF_RTRS_Changed DEFAULT GETUTCDATE(),
  CONSTRAINT CK_RTRS_Status CHECK (Status IN ('RESERVED','FINAL','RELEASED')),
  CONSTRAINT CK_RTRS_Values CHECK (Revision>0 AND (ReferencePricePerTon IS NULL OR ReferencePricePerTon>0)
   AND (ReferenceAmount IS NULL OR ReferenceAmount>=0)
   AND ((Status='FINAL' AND FinalRedemptionId>0 AND FinalRedemptionNo IS NOT NULL)
     OR (Status<>'FINAL' AND FinalRedemptionId IS NULL AND FinalRedemptionNo IS NULL)))
 );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_RTRS_Status' AND object_id=OBJECT_ID('wf.RebateTicketReceiptState'))
 CREATE INDEX IX_RTRS_Status ON wf.RebateTicketReceiptState(Status,ReceiptId);
GO
