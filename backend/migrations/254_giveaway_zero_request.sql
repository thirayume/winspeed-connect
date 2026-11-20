-- @transaction
-- ============================================================================
-- 254_giveaway_zero_request.sql
-- Owner, 21 Nov 2026: Set Zero must work the same on every company database from one screen (on 20 Nov the
-- second company needed a one-off SQL script), be repeatable, and leave every existing row as it is.
-- One Set Zero now writes one wf.GiveawayZeroLog row in each company database with the same request id and
-- the same moment. RequestId lets a retry after a partial failure finish the remaining databases without
-- adding a second row anywhere. Existing rows keep RequestId NULL. Nothing else changes; no dbo object.
-- Rollback: down/ drops the column.
-- SQL Server 2008 R2, compatibility 80.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF OBJECT_ID('wf.GiveawayZeroLog', 'U') IS NULL
    RAISERROR('GZR_PREREQUISITE_REQUIRED: migration 253', 16, 1);
GO
IF COL_LENGTH('wf.GiveawayZeroLog', 'RequestId') IS NULL
    ALTER TABLE wf.GiveawayZeroLog ADD RequestId UNIQUEIDENTIFIER NULL;
GO
