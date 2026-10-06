'use strict';

/**
 * sql-conversion-helpers.js
 *
 * SQL Server 2008 R2 portable conversion helpers & oracle validators.
 * Replaces TRY_CAST / TRY_CONVERT without relying on UDF TRY/CATCH (which is invalid in SQL 2008 UDFs).
 * Avoids raw ISNUMERIC which erroneously yields 1 on '+', '-', '.', '$', '1e2' and overflows on long strings.
 */

/**
 * Generates portable SQL 2008 T-SQL snippet for safe integer casting.
 * Ensures:
 * - NOT NULL and NOT empty after trim
 * - Optional leading sign (+ or -) followed strictly by digits [0-9]
 * - Exact normalized length check and signed 32-bit INT boundaries:
 *   (Max signed 32-bit INT: 2,147,483,647; Min: -2,147,483,648)
 *
 * @param {string} expr - Column name or SQL expression
 * @returns {string} - Safe T-SQL CASE expression returning INT or NULL
 */
function safeIntSql(expr) {
  return `(CASE 
    WHEN ${expr} IS NULL THEN NULL
    WHEN LTRIM(RTRIM(${expr})) = '' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[^0-9+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[+-]%[+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '_%[+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) IN ('+', '-') THEN NULL
    ELSE
      CASE 
        WHEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) + 1 END) > 10 THEN NULL
        WHEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) + 1 END) < 10 THEN CAST(LTRIM(RTRIM(${expr})) AS INT)
        WHEN LTRIM(RTRIM(${expr})) NOT LIKE '-%' AND SUBSTRING(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', ''), PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')), 10) <= '2147483647' THEN CAST(LTRIM(RTRIM(${expr})) AS INT)
        WHEN LTRIM(RTRIM(${expr})) LIKE '-%' AND SUBSTRING(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', ''), PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')), 10) <= '2147483648' THEN CAST(LTRIM(RTRIM(${expr})) AS INT)
        ELSE NULL
      END
  END)`;
}

/**
 * Generates portable SQL 2008 T-SQL snippet for safe BIGINT casting.
 * Fixes R3-01: Normalized length removes invalid - 1 subtraction.
 * Bounds: max signed BIGINT: 9223372036854775807, min: -9223372036854775808.
 */
function safeBigIntSql(expr) {
  return `(CASE 
    WHEN ${expr} IS NULL THEN NULL
    WHEN LTRIM(RTRIM(${expr})) = '' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[^0-9+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[+-]%[+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '_%[+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) IN ('+', '-') THEN NULL
    ELSE
      CASE 
        WHEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) + 1 END) > 19 THEN NULL
        WHEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')) + 1 END) < 19 THEN CAST(LTRIM(RTRIM(${expr})) AS BIGINT)
        WHEN LTRIM(RTRIM(${expr})) NOT LIKE '-%' AND SUBSTRING(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', ''), PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')), 19) <= '9223372036854775807' THEN CAST(LTRIM(RTRIM(${expr})) AS BIGINT)
        WHEN LTRIM(RTRIM(${expr})) LIKE '-%' AND SUBSTRING(REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', ''), PATINDEX('%[^0]%', REPLACE(REPLACE(LTRIM(RTRIM(${expr})), '+', ''), '-', '')), 19) <= '9223372036854775808' THEN CAST(LTRIM(RTRIM(${expr})) AS BIGINT)
        ELSE NULL
      END
  END)`;
}

/**
 * Generates portable SQL 2008 T-SQL snippet for safe DECIMAL(p, s) casting.
 * Fixes R3-02: Exact integer digit counting and rounding carry evaluation in pure T-SQL.
 * Zero intermediate narrowing CASTs, zero POWER(10, ...) overflow risk.
 * Fully supports precision 1..38 and scale 0..precision (including DECIMAL(38,0) and DECIMAL(38,38)).
 */
function safeDecimalSql(expr, precision = 12, scale = 2) {
  const maxIntDigits = precision - scale;
  return `(CASE 
    WHEN ${expr} IS NULL THEN NULL
    WHEN LTRIM(RTRIM(${expr})) = '' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) NOT LIKE '%[0-9]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[^0-9.+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '%[+-]%[+-]%' THEN NULL
    WHEN LTRIM(RTRIM(${expr})) LIKE '_%[+-]%' THEN NULL
    WHEN (CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 AND 
          CHARINDEX('.', LTRIM(RTRIM(${expr})), CHARINDEX('.', LTRIM(RTRIM(${expr}))) + 1) > 0) THEN NULL
    ELSE
      CASE 
        WHEN (
          CASE 
            WHEN LEN(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), CHARINDEX('.', LTRIM(RTRIM(${expr}))) + 1, LEN(LTRIM(RTRIM(${expr})))) ELSE '' END) <= ${scale}
            THEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END)
            WHEN SUBSTRING(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), CHARINDEX('.', LTRIM(RTRIM(${expr}))) + 1, LEN(LTRIM(RTRIM(${expr})))) ELSE '' END, ${scale + 1}, 1) < '5'
            THEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END)
            WHEN ${scale} > 0 AND SUBSTRING(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), CHARINDEX('.', LTRIM(RTRIM(${expr}))) + 1, LEN(LTRIM(RTRIM(${expr})))) ELSE '' END, 1, ${scale}) <> REPLICATE('9', ${scale})
            THEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END)
            WHEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END) = 0
            THEN 1
            WHEN SUBSTRING(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', ''), PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')), (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END)) = REPLICATE('9', (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END))
            THEN (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END) + 1
            ELSE (CASE WHEN PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) = 0 THEN 0 ELSE LEN(REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) - PATINDEX('%[^0]%', REPLACE(REPLACE(CASE WHEN CHARINDEX('.', LTRIM(RTRIM(${expr}))) > 0 THEN SUBSTRING(LTRIM(RTRIM(${expr})), 1, CHARINDEX('.', LTRIM(RTRIM(${expr}))) - 1) ELSE LTRIM(RTRIM(${expr})) END, '+', ''), '-', '')) + 1 END)
          END
        ) > ${maxIntDigits} THEN NULL
        ELSE CAST(LTRIM(RTRIM(${expr})) AS DECIMAL(${precision}, ${scale}))
      END
  END)`;
}

/**
 * JavaScript reference oracle replicating SQL Server TRY_CAST(val AS INT) behavior.
 */
function oracleTryCastInt(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '') return null;

  // Rejects currency symbols, exponential notation, multiple signs, dots
  if (!/^[+-]?\d+$/.test(s)) return null;

  const raw = s.replace(/^[+-]/, '').replace(/^0+/, '');
  if (raw.length > 10) return null;

  const num = Number(s);
  if (!Number.isSafeInteger(num)) return null;
  if (num < -2147483648 || num > 2147483647) return null;

  return num;
}

/**
 * JavaScript reference oracle replicating SQL Server TRY_CAST(val AS BIGINT) behavior.
 */
function oracleTryCastBigInt(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '') return null;

  if (!/^[+-]?\d+$/.test(s)) return null;

  const isNeg = s.startsWith('-');
  const clean = s.replace(/^[+-]/, '').replace(/^0+/, '');
  if (clean.length > 19) return null;
  if (clean.length === 19) {
    if (!isNeg && clean > '9223372036854775807') return null;
    if (isNeg && clean > '9223372036854775808') return null;
  }

  try {
    return BigInt(s);
  } catch (_) {
    return null;
  }
}

/**
 * JavaScript reference oracle replicating SQL Server TRY_CAST(val AS DECIMAL(p, s)) behavior.
 * Returns lossless canonical string representation (or null) to prevent IEEE-754 Number truncation.
 */
function oracleTryCastDecimalString(val, precision = 12, scale = 2) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '') return null;

  // Must match simple numeric with optional sign and single decimal point
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;

  const isNeg = s.startsWith('-');
  const clean = s.replace(/^[+-]/, '');
  const parts = clean.split('.');
  let rawInt = parts[0] ? parts[0].replace(/^0+/, '') : '';
  let intSigLen = rawInt.length;
  let intSigStr = rawInt || '0';
  let fracStr = parts[1] || '';

  const maxIntDigits = precision - scale;
  let effIntLen = intSigLen;

  if (fracStr.length > scale) {
    const roundDigit = parseInt(fracStr[scale], 10);
    if (roundDigit >= 5) {
      const fracLeading = fracStr.slice(0, scale);
      const fracAllNines = scale === 0 || fracLeading === '9'.repeat(scale);
      if (fracAllNines) {
        if (intSigLen === 0) {
          effIntLen = 1;
        } else if (intSigStr === '9'.repeat(intSigLen)) {
          effIntLen = intSigLen + 1;
        }
      }
    }
  }

  if (effIntLen > maxIntDigits) {
    return null; // Arithmetic overflow
  }

  // Exact BigInt computation for the rounded value representation
  const needed = scale + 1;
  const paddedFrac = fracStr.padEnd(needed, '0');
  const keepFrac = paddedFrac.slice(0, scale);
  const roundDigit = parseInt(paddedFrac[scale], 10);

  let combined = BigInt((rawInt || '0') + keepFrac);
  if (roundDigit >= 5) {
    combined += 1n;
  }

  const combStr = combined.toString().padStart(scale + 1, '0');
  const finalInt = combStr.slice(0, combStr.length - scale) || '0';
  const finalFrac = combStr.slice(combStr.length - scale);

  const signStr = isNeg && (finalInt !== '0' || (scale > 0 && finalFrac !== '0'.repeat(scale))) ? '-' : '';
  if (scale === 0) {
    return signStr + finalInt;
  }
  return signStr + finalInt + '.' + finalFrac;
}

/**
 * JavaScript reference oracle replicating SQL Server TRY_CAST(val AS BIGINT) behavior.
 * Returns lossless canonical string representation (or null).
 */
function oracleTryCastBigIntString(val) {
  const bi = oracleTryCastBigInt(val);
  return bi == null ? null : bi.toString();
}

/**
 * JavaScript reference oracle replicating SQL Server TRY_CAST(val AS DECIMAL(p, s)) behavior.
 * Uses exact string/BigInt arithmetic for half-up rounding and overflow detection.
 */
function oracleTryCastDecimal(val, precision = 12, scale = 2) {
  const str = oracleTryCastDecimalString(val, precision, scale);
  if (str === null) return null;
  return Number(str);
}

/**
 * Comprehensive test cases for TRY_CAST conversion verification.
 */
const ORACLE_CONVERSION_FIXTURES = [
  // 1. Null / Empty / Whitespace
  { input: null, expectedInt: null, category: 'null' },
  { input: undefined, expectedInt: null, category: 'undefined' },
  { input: '', expectedInt: null, category: 'empty_string' },
  { input: '   ', expectedInt: null, category: 'whitespace' },
  { input: '\t\n\r', expectedInt: null, category: 'whitespace_control' },

  // 2. Valid positive and negative integers
  { input: '0', expectedInt: 0, category: 'zero' },
  { input: '42', expectedInt: 42, category: 'simple_int' },
  { input: '  100  ', expectedInt: 100, category: 'trimmed_int' },
  { input: '+500', expectedInt: 500, category: 'positive_sign' },
  { input: '-789', expectedInt: -789, category: 'negative_sign' },

  // 3. Integer boundaries (32-bit signed INT)
  { input: '2147483647', expectedInt: 2147483647, category: 'max_int' },
  { input: '-2147483648', expectedInt: -2147483648, category: 'min_int' },
  { input: '2147483648', expectedInt: null, category: 'overflow_positive' },
  { input: '-2147483649', expectedInt: null, category: 'overflow_negative' },
  { input: '999999999999999999', expectedInt: null, category: 'huge_overflow' },

  // 4. BIGINT boundaries (64-bit signed BIGINT) - R3-01 & lossless string transport
  { input: '9223372036854775807', expectedBigInt: 9223372036854775807n, expectedBigIntString: '9223372036854775807', category: 'max_bigint' },
  { input: '9223372036854775808', expectedBigInt: null, expectedBigIntString: null, category: 'overflow_bigint_positive' },
  { input: '-9223372036854775808', expectedBigInt: -9223372036854775808n, expectedBigIntString: '-9223372036854775808', category: 'min_bigint' },
  { input: '-9223372036854775809', expectedBigInt: null, expectedBigIntString: null, category: 'overflow_bigint_negative' },
  { input: '10000000000000000000', expectedBigInt: null, expectedBigIntString: null, category: 'overflow_20_digits_bigint' },

  // 5. Trap cases where ISNUMERIC returns 1 but CAST(AS INT) THROWS
  { input: '1e5', expectedInt: null, category: 'isnumeric_trap_exponent' },
  { input: '2.5e3', expectedInt: null, category: 'isnumeric_trap_scientific' },
  { input: '$100', expectedInt: null, category: 'isnumeric_trap_currency' },
  { input: '1,000', expectedInt: null, category: 'isnumeric_trap_comma' },
  { input: '+', expectedInt: null, category: 'isnumeric_trap_plus' },
  { input: '-', expectedInt: null, category: 'isnumeric_trap_minus' },
  { input: '.', expectedInt: null, category: 'isnumeric_trap_dot' },
  { input: '12.34', expectedInt: null, category: 'isnumeric_trap_decimal_for_int' },

  // 6. Invalid / alphanumeric / control
  { input: 'abc', expectedInt: null, category: 'alpha' },
  { input: '12A34', expectedInt: null, category: 'mixed_alpha' },
  { input: 'TEST', expectedInt: null, category: 'doc_test_string' },
  { input: 'NaN', expectedInt: null, category: 'nan_literal' },
  { input: 'Infinity', expectedInt: null, category: 'infinity' },

  // 7. Thai / Unicode digits (fails standard ASCII INT parsing)
  { input: '๑๒๓', expectedInt: null, category: 'thai_digits' },

  // 8. Leading zeros and length robustness (BR2-04, R3-01)
  { input: '000042', expectedInt: 42, expectedBigInt: 42n, expectedDecimal: 42, expectedDecimalString: '42.00', precision: 12, scale: 2, category: 'leading_zeros' },
  { input: '0'.repeat(45) + '42', expectedInt: 42, expectedBigInt: 42n, expectedDecimal: 42, expectedDecimalString: '42.00', precision: 12, scale: 2, category: 'leading_zeros_over_50_chars' },
  { input: '1234567890' + 'x'.repeat(45), expectedInt: null, expectedBigInt: null, expectedDecimal: null, expectedDecimalString: null, category: 'invalid_suffix_over_50_chars' },

  // 9. Decimal exact rounding and boundary fixtures (BR2-04, R3-02, Package C Lossless)
  { input: '1.005', expectedInt: null, expectedDecimal: 1.01, expectedDecimalString: '1.01', precision: 12, scale: 2, category: 'decimal_half_up_rounding' },
  { input: '-1.005', expectedInt: null, expectedDecimal: -1.01, expectedDecimalString: '-1.01', precision: 12, scale: 2, category: 'decimal_negative_half_up' },
  { input: '9.999', expectedInt: null, expectedDecimal: null, expectedDecimalString: null, precision: 3, scale: 2, category: 'decimal_rounding_overflow' },
  { input: '9.994', expectedInt: null, expectedDecimal: 9.99, expectedDecimalString: '9.99', precision: 3, scale: 2, category: 'decimal_boundary_fit' },
  { input: '-9.999', expectedInt: null, expectedDecimal: null, expectedDecimalString: null, precision: 3, scale: 2, category: 'decimal_negative_rounding_overflow' },
  { input: '.5', expectedInt: null, expectedDecimal: 0.5, expectedDecimalString: '0.50', precision: 12, scale: 2, category: 'decimal_leading_dot' },
  { input: '1.2.3', expectedInt: null, expectedDecimal: null, expectedDecimalString: null, precision: 12, scale: 2, category: 'decimal_multiple_dots' },

  // 10. Large precision boundaries & adjacent 38-digit integers (Package C Lossless Verification)
  // Two adjacent 38-digit integers at max DECIMAL(38,0) boundary
  { input: '9'.repeat(37) + '8', expectedDecimal: Number('9'.repeat(37) + '8'), expectedDecimalString: '9'.repeat(37) + '8', precision: 38, scale: 0, category: 'decimal_38_0_adjacent_prev' },
  { input: '9'.repeat(38), expectedDecimal: Number('9'.repeat(38)), expectedDecimalString: '9'.repeat(38), precision: 38, scale: 0, category: 'decimal_38_0_max' },
  { input: '9'.repeat(38) + '.5', expectedDecimal: null, expectedDecimalString: null, precision: 38, scale: 0, category: 'decimal_38_0_rounding_overflow' },
  // Max DECIMAL(38,38) fractional precision
  { input: '0.123', expectedDecimal: 0.123, expectedDecimalString: '0.123' + '0'.repeat(35), precision: 38, scale: 38, category: 'decimal_38_38_fractional' },
  { input: '0.' + '9'.repeat(37) + '8', expectedDecimal: Number('0.' + '9'.repeat(37) + '8'), expectedDecimalString: '0.' + '9'.repeat(37) + '8', precision: 38, scale: 38, category: 'decimal_38_38_adjacent_prev' },
  { input: '0.' + '9'.repeat(38), expectedDecimal: Number('0.' + '9'.repeat(38)), expectedDecimalString: '0.' + '9'.repeat(38), precision: 38, scale: 38, category: 'decimal_38_38_max' },
  { input: '0.' + '9'.repeat(38) + '5', expectedDecimal: null, expectedDecimalString: null, precision: 38, scale: 38, category: 'decimal_38_38_rounding_overflow' },
];

module.exports = {
  safeIntSql,
  safeBigIntSql,
  safeDecimalSql,
  oracleTryCastInt,
  oracleTryCastBigInt,
  oracleTryCastBigIntString,
  oracleTryCastDecimal,
  oracleTryCastDecimalString,
  ORACLE_CONVERSION_FIXTURES,
};
