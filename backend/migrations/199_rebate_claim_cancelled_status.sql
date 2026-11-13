-- @transaction
-- A reset cancels pending claims but must retain their history. Preserve the
-- existing status expression and add only the CANCELLED alternative.
IF OBJECT_ID('wf.RebateClaim','U') IS NULL
  RAISERROR('RebateClaim is missing',16,1);
ELSE IF (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.RebateClaim')
         AND OBJECT_DEFINITION(object_id) LIKE '%Status%') <> 1
  RAISERROR('Unexpected RebateClaim status constraints',16,1);
ELSE IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.RebateClaim') AND name='chk_RC_Status')
  RAISERROR('Expected RebateClaim status constraint is missing',16,1);
ELSE IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('wf.RebateClaim') AND name='chk_RC_Status'
                AND (is_disabled=1 OR is_not_trusted=1 OR is_not_for_replication=1))
  RAISERROR('RebateClaim status constraint is not trusted or uses replication settings',16,1);
ELSE
BEGIN
  DECLARE @previousStatusCheck nvarchar(max), @statement nvarchar(max),
          @recordedStatusCheck nvarchar(4000), @propertyValue sql_variant;
  SELECT @previousStatusCheck=OBJECT_DEFINITION(object_id) FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('wf.RebateClaim') AND name='chk_RC_Status';
  IF @previousStatusCheck IS NULL BEGIN RAISERROR('Cannot read RebateClaim status constraint',16,1); RETURN; END;
  -- Record the exact expression installed by this migration. This both makes
  -- reruns idempotent and refuses to overwrite an independently edited check.
  SELECT @propertyValue=value FROM sys.extended_properties
    WHERE class=1 AND major_id=OBJECT_ID('wf.RebateClaim') AND minor_id=0
      AND name=N'WF_RebateClaim_Status_199';
  IF EXISTS (SELECT 1 FROM sys.extended_properties
    WHERE class=1 AND major_id=OBJECT_ID('wf.RebateClaim') AND minor_id=0
      AND name=N'WF_RebateClaim_Status_199')
  BEGIN
    SET @recordedStatusCheck=CONVERT(nvarchar(4000),@propertyValue);
    IF @recordedStatusCheck IS NULL OR DATALENGTH(@recordedStatusCheck)<>DATALENGTH(@previousStatusCheck)
       OR @recordedStatusCheck COLLATE Latin1_General_BIN2 <> @previousStatusCheck COLLATE Latin1_General_BIN2
      RAISERROR('RebateClaim status constraint changed after migration 199',16,1);
    RETURN;
  END;
  ALTER TABLE wf.RebateClaim DROP CONSTRAINT chk_RC_Status;
  SET @statement=N'ALTER TABLE wf.RebateClaim WITH CHECK ADD CONSTRAINT chk_RC_Status CHECK (('
    + @previousStatusCheck + N') OR [Status]=N''CANCELLED'')';
  EXEC sp_executesql @statement;
  SELECT @previousStatusCheck=OBJECT_DEFINITION(object_id) FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID('wf.RebateClaim') AND name='chk_RC_Status';
  IF @previousStatusCheck IS NULL OR DATALENGTH(@previousStatusCheck)>8000
  BEGIN RAISERROR('Cannot record RebateClaim status constraint',16,1); RETURN; END;
  SET @recordedStatusCheck=CONVERT(nvarchar(4000),@previousStatusCheck);
  EXEC sys.sp_addextendedproperty @name=N'WF_RebateClaim_Status_199', @value=@recordedStatusCheck,
    @level0type=N'SCHEMA', @level0name=N'wf', @level1type=N'TABLE', @level1name=N'RebateClaim';
END;
GO
