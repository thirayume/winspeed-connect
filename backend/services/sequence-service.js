'use strict';

/**
 * sequence-service.js
 *
 * Dialect-agnostic sequence and monotonic counter service.
 * Supports:
 * - WfRefSeq (Workflow Sales Order reference numbering)
 * - QuoteRefSeq (Quotation reference numbering)
 *
 * Implements:
 * 1. Concurrency Safety: Atomic UPDLOCK/ROWLOCK updates on wf.SequenceCounter.
 * 2. High-Water Bootstrap: Auto-initializes from max existing business IDs if absent.
 * 3. Non-Reuse Policy: Allocations occur outside consumer transactions to preserve
 *    monotonic sequence progression without gap reclamation on rollback.
 * 4. Engine Parity: Dynamic SQL dispatch for native NEXT VALUE FOR on SQL 2012+ / 2022,
 *    avoiding static compilation errors on SQL Server 2008 R2.
 */

let sql;
try {
  const db = require('../db');
  sql = db.sql;
} catch (_) {
  sql = { NVarChar: len => ({ type: 'NVarChar', length: len }) };
}

const SUPPORTED_SEQUENCES = {
  WfRefSeq: {
    name: 'WfRefSeq',
    schema: 'wf',
    prefix: 'WF',
    defaultStart: 1,
  },
  QuoteRefSeq: {
    name: 'QuoteRefSeq',
    schema: 'wf',
    prefix: 'QU',
    defaultStart: 1,
  },
};

/**
 * Portable SQL batch to fetch the next value of a sequence.
 * 1. Checks if sys.sequences exists (SQL 2012+ / 2022) and contains @seqName.
 * 2. If yes, dynamically evaluates NEXT VALUE FOR wf.<seqName>.
 * 3. If no, performs atomic UPDATE WITH (UPDLOCK, ROWLOCK) on wf.SequenceCounter.
 */
const GET_NEXT_SEQUENCE_SQL = `
DECLARE @seqName NVARCHAR(64) = @sequenceName;
DECLARE @nextVal BIGINT = NULL;

-- Path A: Native Sequence on SQL Server 2012+ / SQL Server 2022
-- Dynamic sp_executesql isolates modern-only sys.sequences catalog from SQL 2008 compilation
DECLARE @hasSeq INT = 0;
IF OBJECT_ID('sys.sequences') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @has = COUNT(*) FROM sys.sequences WHERE name = @name AND schema_id = SCHEMA_ID(''wf'')',
    N'@name NVARCHAR(64), @has INT OUTPUT',
    @name = @seqName, @has = @hasSeq OUTPUT;
END

IF @hasSeq > 0
BEGIN
  DECLARE @dynSql NVARCHAR(200) = N'SELECT NEXT VALUE FOR wf.' + QUOTENAME(@seqName) + N' AS Seq';
  EXEC sp_executesql @dynSql;
  RETURN;
END

-- Path B: Monotonic Counter Table on SQL Server 2008 R2 (or fallback)
-- Schema is provisioned via migration (001/002); runtime does not execute DDL

-- Step 1: Read existing counter under atomic row-level update lock
DECLARE @curVal BIGINT = NULL;
SELECT @curVal = CurrentValue
FROM wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
WHERE SequenceName = @seqName;

-- Step 2: Compute bounded high-water mark across active document tables
DECLARE @highWater BIGINT = 0;
IF @seqName = 'WfRefSeq'
BEGIN
  SELECT @highWater = ISNULL(MAX(RefSuffix), 0)
  FROM (
    SELECT CASE 
      WHEN WfRef LIKE '%-%' 
       AND LEN(SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25)) <= 9
       AND SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) NOT LIKE '%[^0-9]%'
       AND SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) <> ''
      THEN CAST(SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) AS INT)
    END AS RefSuffix
    FROM wf.SalesOrder WITH (NOLOCK)
    UNION ALL
    SELECT CASE 
      WHEN DocuNo LIKE '%-%' 
       AND LEN(SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25)) <= 9
       AND SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) NOT LIKE '%[^0-9]%'
       AND SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) <> ''
      THEN CAST(SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) AS INT)
    END AS RefSuffix
    FROM dbo.SOHD WITH (NOLOCK)
    WHERE DocuType = 103
  ) docRefs
  WHERE RefSuffix IS NOT NULL;
END
ELSE IF @seqName = 'QuoteRefSeq'
BEGIN
  SELECT @highWater = ISNULL(MAX(RefSuffix), 0)
  FROM (
    SELECT CASE 
      WHEN QuoteNo LIKE '%-%' 
       AND LEN(SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25)) <= 9
       AND SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) NOT LIKE '%[^0-9]%'
       AND SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) <> ''
      THEN CAST(SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) AS INT)
    END AS RefSuffix
    FROM wf.Quotation WITH (NOLOCK)
  ) qRefs
  WHERE RefSuffix IS NOT NULL;
END

-- Step 3: Atomic update or insert ensuring allocated value strictly exceeds high-water mark
IF @curVal IS NULL
BEGIN
  SET @nextVal = @highWater + 1;
  BEGIN TRY
    INSERT INTO wf.SequenceCounter (SequenceName, CurrentValue, UpdatedAt)
    VALUES (@seqName, @nextVal, GETUTCDATE());
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER() IN (2627, 2601)
    BEGIN
      UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
      SET @nextVal = CurrentValue = CASE 
        WHEN CurrentValue < @highWater THEN @highWater + 1 
        ELSE CurrentValue + 1 
      END,
      UpdatedAt = GETUTCDATE()
      WHERE SequenceName = @seqName;
    END
    ELSE
    BEGIN
      DECLARE @errMsg NVARCHAR(4000) = ERROR_MESSAGE();
      RAISERROR ('%s', 16, 1, @errMsg);
      RETURN;
    END
  END CATCH
END
ELSE
BEGIN
  -- Row exists (whether seeded with 0, existing-low, or normal sequence progression)
  UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
  SET @nextVal = CurrentValue = CASE 
    WHEN CurrentValue < @highWater THEN @highWater + 1 
    ELSE CurrentValue + 1 
  END,
  UpdatedAt = GETUTCDATE()
  WHERE SequenceName = @seqName;
END

SELECT @nextVal AS Seq;
`;

/**
 * Allocates the next monotonic sequence value.
 *
 * @param {Function} queryFn - Database query function (e.g. wfQuery)
 * @param {string} sequenceName - 'WfRefSeq' or 'QuoteRefSeq'
 * @returns {Promise<number>} - Next allocated sequence integer
 */
async function getNextSequenceValue(queryFn, sequenceName) {
  if (!SUPPORTED_SEQUENCES[sequenceName]) {
    throw new Error(`Unsupported sequence name: "${sequenceName}". Supported: ${Object.keys(SUPPORTED_SEQUENCES).join(', ')}`);
  }

  const result = await queryFn(GET_NEXT_SEQUENCE_SQL, {
    sequenceName: { type: sql.NVarChar(64), value: sequenceName },
  });

  const row = result && result.recordset && result.recordset[0];
  if (!row || row.Seq == null) {
    throw new Error(`Failed to allocate next sequence value for "${sequenceName}"`);
  }

  return Number(row.Seq);
}

/**
 * Bootstraps the sequence counter from existing documents if counter is below max.
 */
async function bootstrapSequenceHighWater(queryFn, sequenceName) {
  if (sequenceName === 'WfRefSeq') {
    await queryFn(`
      IF OBJECT_ID('wf.SequenceCounter', 'U') IS NOT NULL
      BEGIN
        DECLARE @maxDoc BIGINT = 0;
        SELECT @maxDoc = ISNULL(MAX(RefSuffix), 0)
        FROM (
          SELECT CASE 
            WHEN WfRef LIKE '%-%' 
             AND LEN(SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25)) <= 9
             AND SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) NOT LIKE '%[^0-9]%'
             AND SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) <> ''
            THEN CAST(SUBSTRING(WfRef, CHARINDEX('-', WfRef) + 1, 25) AS INT)
          END AS RefSuffix
          FROM wf.SalesOrder WITH (NOLOCK)
          UNION ALL
          SELECT CASE 
            WHEN DocuNo LIKE '%-%' 
             AND LEN(SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25)) <= 9
             AND SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) NOT LIKE '%[^0-9]%'
             AND SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) <> ''
            THEN CAST(SUBSTRING(DocuNo, CHARINDEX('-', DocuNo) + 1, 25) AS INT)
          END AS RefSuffix
          FROM dbo.SOHD WITH (NOLOCK)
          WHERE DocuType = 103
        ) refs
        WHERE RefSuffix IS NOT NULL;
        
        IF NOT EXISTS (SELECT 1 FROM wf.SequenceCounter WITH (UPDLOCK, ROWLOCK) WHERE SequenceName = 'WfRefSeq')
        BEGIN
          BEGIN TRY
            INSERT INTO wf.SequenceCounter (SequenceName, CurrentValue, UpdatedAt)
            VALUES ('WfRefSeq', @maxDoc, GETUTCDATE());
          END TRY
          BEGIN CATCH
            IF ERROR_NUMBER() IN (2627, 2601)
            BEGIN
              UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
              SET CurrentValue = CASE WHEN CurrentValue < @maxDoc THEN @maxDoc ELSE CurrentValue END,
                  UpdatedAt = GETUTCDATE()
              WHERE SequenceName = 'WfRefSeq';
            END
          END CATCH
        END
        ELSE
        BEGIN
          UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
          SET CurrentValue = CASE WHEN CurrentValue < @maxDoc THEN @maxDoc ELSE CurrentValue END,
              UpdatedAt = GETUTCDATE()
          WHERE SequenceName = 'WfRefSeq';
        END
      END
    `);
  } else if (sequenceName === 'QuoteRefSeq') {
    await queryFn(`
      IF OBJECT_ID('wf.SequenceCounter', 'U') IS NOT NULL
      BEGIN
        DECLARE @maxQuote BIGINT = 0;
        SELECT @maxQuote = ISNULL(MAX(RefSuffix), 0)
        FROM (
          SELECT CASE 
            WHEN QuoteNo LIKE '%-%' 
             AND LEN(SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25)) <= 9
             AND SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) NOT LIKE '%[^0-9]%'
             AND SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) <> ''
            THEN CAST(SUBSTRING(QuoteNo, CHARINDEX('-', QuoteNo) + 1, 25) AS INT)
          END AS RefSuffix
          FROM wf.Quotation WITH (NOLOCK)
        ) refs
        WHERE RefSuffix IS NOT NULL;
        
        IF NOT EXISTS (SELECT 1 FROM wf.SequenceCounter WITH (UPDLOCK, ROWLOCK) WHERE SequenceName = 'QuoteRefSeq')
        BEGIN
          BEGIN TRY
            INSERT INTO wf.SequenceCounter (SequenceName, CurrentValue, UpdatedAt)
            VALUES ('QuoteRefSeq', @maxQuote, GETUTCDATE());
          END TRY
          BEGIN CATCH
            IF ERROR_NUMBER() IN (2627, 2601)
            BEGIN
              UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
              SET CurrentValue = CASE WHEN CurrentValue < @maxQuote THEN @maxQuote ELSE CurrentValue END,
                  UpdatedAt = GETUTCDATE()
              WHERE SequenceName = 'QuoteRefSeq';
            END
          END CATCH
        END
        ELSE
        BEGIN
          UPDATE wf.SequenceCounter WITH (UPDLOCK, ROWLOCK)
          SET CurrentValue = CASE WHEN CurrentValue < @maxQuote THEN @maxQuote ELSE CurrentValue END,
              UpdatedAt = GETUTCDATE()
          WHERE SequenceName = 'QuoteRefSeq';
        END
      END
    `);
  }
}

module.exports = {
  SUPPORTED_SEQUENCES,
  GET_NEXT_SEQUENCE_SQL,
  getNextSequenceValue,
  bootstrapSequenceHighWater,
};
