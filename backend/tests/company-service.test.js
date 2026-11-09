'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_COMPANY,
  normalizeCompanyRecord,
  getCompanyInfo,
  clearCompanyCache,
} = require('../services/company-service');

test('normalizeCompanyRecord: falls back to DEFAULT_COMPANY on null/empty input', () => {
  const empty = normalizeCompanyRecord(null);
  assert.equal(empty.compName, 'บริษัท เวิลด์ เฟอท จำกัด');
  assert.equal(empty.compNameEng, 'WORLD FERT CO., LTD.');
  assert.equal(empty.taxId, '0105531024397');
});

test('normalizeCompanyRecord: trims whitespace and maps EMComp fields properly', () => {
  const row = {
    CompID: '1',
    CompCode: ' 001 ',
    CompName: ' บริษัท เวิลด์ เฟอท จำกัด ',
    CompOwner: ' บริษัท เวิลด์ เฟอท จำกัด ',
    TaxID: ' 0105531024397 ',
    Addr1: ' 933 อาคารรวมทนุไทย ',
    Addr2: ' เขตพระนคร กรุงเทพฯ ',
    Addr3: '',
    Tel: ' 02 2218444 ',
    Fax: ' 02 2263069 ',
    Email: ' worldfert_office@yahoo.com ',
    Homepage: null,
    CompNameEng: ' WORLD FERT CO., LTD. ',
    CompOwnerEng: ' WORLDFERT CO., LTD. ',
    Addr1Eng: ' 933 Mahachai Road ',
    Addr2Eng: ' Bangkok Thailand ',
    Addr3Eng: null,
    TaxID13: ' 0105531024397 ',
  };

  const norm = normalizeCompanyRecord(row);
  assert.equal(norm.compCode, '001');
  assert.equal(norm.compName, 'บริษัท เวิลด์ เฟอท จำกัด');
  assert.equal(norm.compNameEng, 'WORLD FERT CO., LTD.');
  assert.equal(norm.compOwnerEng, 'WORLDFERT CO., LTD.');
  assert.equal(norm.taxId, '0105531024397');
  assert.equal(norm.taxId13, '0105531024397');
  assert.equal(norm.addr1, '933 อาคารรวมทนุไทย');
  assert.equal(norm.addr3, null);
  assert.equal(norm.tel, '02 2218444');
  assert.equal(norm.email, 'worldfert_office@yahoo.com');
});

test('getCompanyInfo: fetches from queryFn and caches result', async () => {
  clearCompanyCache();
  let queryCount = 0;
  const mockQuery = async () => {
    queryCount++;
    return {
      recordset: [
        {
          CompCode: '001',
          CompName: 'บริษัท เวิลด์ เฟอท จำกัด',
          CompNameEng: 'WORLD FERT CO., LTD.',
          TaxID: '0105531024397',
        },
      ],
    };
  };

  const first = await getCompanyInfo({ customQueryFn: mockQuery });
  assert.equal(first.compNameEng, 'WORLD FERT CO., LTD.');
  assert.equal(queryCount, 1);

  // Cached call
  const second = await getCompanyInfo({ customQueryFn: mockQuery });
  assert.equal(second.compNameEng, 'WORLD FERT CO., LTD.');
  assert.equal(queryCount, 1); // Should not increase

  // Force refresh
  const third = await getCompanyInfo({ forceRefresh: true, customQueryFn: mockQuery });
  assert.equal(third.compNameEng, 'WORLD FERT CO., LTD.');
  assert.equal(queryCount, 2); // Increased

  // Plain array result (as returned by db.query in production)
  const arrayQuery = async () => [
    {
      CompCode: '001',
      CompName: 'บริษัท เวิลด์ เฟอท จำกัด (จากฐานจริง)',
      CompNameEng: 'WORLD FERT CO., LTD. (PROD)',
      TaxID: '0105531024397',
    },
  ];
  const fourth = await getCompanyInfo({ forceRefresh: true, customQueryFn: arrayQuery });
  assert.equal(fourth.compName, 'บริษัท เวิลด์ เฟอท จำกัด (จากฐานจริง)');
  assert.equal(fourth.compNameEng, 'WORLD FERT CO., LTD. (PROD)');
});

