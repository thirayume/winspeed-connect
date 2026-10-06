'use strict';

const assert = require('assert/strict');
const path = require('path');
const db = require(path.resolve('backend/db'));

const testFixtures = [
  { input: 'กระสอบ 0-0-60   ผง รถเกษตร', expected: '0-0-60' },
  { input: 'กระสอบ 0-0-60   เม็ด  ตรารถเกษตร', expected: '0-0-60' },
  { input: 'กระสอบ 3-3-33   เชิงผสม ตรารถเกษตร', expected: '3-3-33' },
  { input: 'กระสอบ 8-24-24 เชิงผสม ตรารถเกษตร', expected: '8-24-24' },
  { input: 'กระสอบ 15-15-15 เชิงผสม ตรารถเกษตร', expected: '15-15-15' },
  { input: 'กระสอบ 12-4-40 เชิงผสม ตรารถเกษตร', expected: '12-4-40' },
  { input: 'กระสอบ 16-11-14 เชิงผสม ตรารถเกษตร', expected: '16-11-14' },
  { input: 'สูตร 2 ปุ๋ยเคมี 15-15-15 ตรารถเกษตร', expected: '15-15-15' },
  { input: 'ถุงใน', expected: 'ถุงใน' },
  { input: 'ด้าย', expected: 'ด้าย' }
];

async function verifyFormulaExtraction() {
  await db.pools().ready;
  console.log('Testing formula extraction logic on 10 real product fixtures...\n');

  for (const tc of testFixtures) {
    const q = `
      DECLARE @GoodName NVARCHAR(MAX) = @input;
      DECLARE @Name NVARCHAR(MAX);
      SET @Name = LTRIM(RTRIM(ISNULL(@GoodName, N'')));
      DECLARE @Result NVARCHAR(100);

      IF @Name = N'' SET @Result = N'';
      ELSE
      BEGIN
        DECLARE @Padded NVARCHAR(MAX), @Pos INT, @NextSpace INT, @Token NVARCHAR(100);
        SET @Padded = N' ' + @Name + N' ';
        SET @Pos = PATINDEX(N'% [0-9]%-%[0-9]%-%[0-9]% %', @Padded);
        
        WHILE @Pos > 0 AND @Result IS NULL
        BEGIN
            SET @Pos = @Pos + 1;
            SET @NextSpace = CHARINDEX(N' ', @Padded, @Pos);
            SET @Token = SUBSTRING(@Padded, @Pos, @NextSpace - @Pos);
            
            IF @Token LIKE N'[0-9]%-[0-9]%-[0-9]%' AND @Token NOT LIKE N'%[^0-9-]%'
            BEGIN
                SET @Result = @Token;
            END;
            ELSE
            BEGIN
                SET @Padded = SUBSTRING(@Padded, @NextSpace, LEN(@Padded));
                SET @Pos = PATINDEX(N'% [0-9]%-%[0-9]%-%[0-9]% %', @Padded);
            END;
        END;

        IF @Result IS NULL AND PATINDEX(N'%[0-9]%-%[0-9]%-%[0-9]%', @Name) > 0
        BEGIN
            DECLARE @Start INT, @Space INT;
            SET @Start = PATINDEX(N'%[0-9]%-%[0-9]%-%[0-9]%', @Name);
            SET @Space = CHARINDEX(N' ', @Name + N' ', @Start);
            SET @Result = RTRIM(SUBSTRING(@Name, @Start, @Space - @Start));
        END;

        IF @Result IS NULL
            SET @Result = LEFT(@Name, 100);
      END;

      SELECT @Result AS Extracted;
    `;
    const res = await db.wfQuery(q, { input: { type: db.sql.NVarChar, value: tc.input } });
    const actual = res.recordset[0].Extracted;
    console.log(`Input:    "${tc.input}"`);
    console.log(`Expected: "${tc.expected}"`);
    console.log(`Actual:   "${actual}"`);
    assert.equal(actual, tc.expected, `Mismatch for input "${tc.input}"`);
    console.log('✓ PASS\n');
  }

  console.log('All 10 fixtures extracted correctly with zero regressions!');
}

verifyFormulaExtraction().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
