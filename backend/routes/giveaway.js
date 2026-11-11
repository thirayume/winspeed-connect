/**
 * giveaway.js — ของแถม (qty model จาก xls)
 * งบ = จำนวนชิ้น ต่อ ภาค(พนักงาน) × ตรา × รายการ · คงเหลือ = งบ − เบิก
 * ⚠ เขียนเฉพาะ schema wf · อ่าน dbo.EMEmp (read-only)
 */
const router = require('express').Router();
const { sql, query, wfQuery, wfTransaction } = require('../db');
const { requireAuth, requireRole, requireCapability } = require('../middleware/auth');
const { logChangeEvent } = require('../services/policy-contract');
const { matchGiveawayItem } = require('../services/giveaway-matcher');

const budgetKey = (region, year, brand, item, goodId = null, salesUserId = null) =>
  `${region}|${year}|${brand}|${item}${goodId ? `|G:${goodId}` : ''}${salesUserId ? `|U:${salesUserId}` : ''}`;

// R12 O-4: SALES/MANAGER see their own + team records and regions
const { getVisibleScope, scopeFilter, inScope, canViewSalesUser } = require('../services/visible-scope');

const POSITION_REGION_MAP = {
  'SALE-NORTH':   { code: '04', name: 'ภาคเหนือ' },
  'SALE-CENTRAL': { code: '02', name: 'ภาคกลาง-ตะวันตก' },
  'SALE-EAST':    { code: '06', name: 'ภาคตะวันออก' },
  'SALE-SOUTH':   { code: '05', name: 'ภาคใต้' },
  'SALE-ISAN-U':  { code: '10', name: 'ภาคอีสานบน' },
  'SALE-ISAN-M':  { code: '11', name: 'ภาคอีสานกลาง' },
  'SALE-ISAN-L':  { code: '12', name: 'ภาคอีสานล่าง' },
  'SALE-PTHEP':   { code: '13', name: 'ภาคปุ๋ยเทพ 1' },
  'PTHEP-HEAD':   { code: '13', name: 'ภาคปุ๋ยเทพ 1' },
  'SALE-GOV':     { code: '15', name: 'โรงงานและหน่วยงานราชการ' },
  'DIR-SALE-GOV': { code: '15', name: 'โรงงานและหน่วยงานราชการ' },
  'COUNTER-SALE': { code: '16', name: 'เคาน์เตอร์เซลล์' },
  'COUNTER-HEAD': { code: '16', name: 'เคาน์เตอร์เซลล์' },
};

const REGION_NAME_ALIAS_TO_CODE = {
  'กรุงเทพและปริมณฑล': '01',
  'ภาคกลาง': '02',
  'ภาคกลาง-ตะวันตก': '02',
  'ภาคตะวันออกเฉียงเหนือ': '03',
  'ภาคเหนือ': '04',
  'ภาคใต้': '05',
  'ภาคตะวันออก': '06',
  'ภาคอีสานบน': '10',
  'ภาคอีสานกลาง': '11',
  'ภาคอีสานล่าง': '12',
  'ภาคปุ๋ยเทพ 1': '13',
  'ภาคปุ๋ยเทพ 2': '14',
  'โรงงานและหน่วยงานราชการ': '15',
  'เคาน์เตอร์เซลล์': '16',
  'ไม่ระบุ': '99',
};

function inferRegionCode(regionName) {
  const key = String(regionName || '').trim();
  return REGION_NAME_ALIAS_TO_CODE[key] || null;
}

function getRegionAliases(regionName) {
  const key = String(regionName || '').trim();
  if (!key) return [];
  const code = inferRegionCode(key);
  if (!code) return [key];
  const matches = Object.entries(REGION_NAME_ALIAS_TO_CODE)
    .filter(([, c]) => c === code)
    .map(([name]) => name);
  return matches.includes(key) ? matches : [key, ...matches];
}

async function hasExtendedBudgetSchema() {
  try {
    const r = await wfQuery(`SELECT COL_LENGTH('wf.GiveawayBudget', 'GoodId') AS Len`);
    return Boolean(r?.recordset?.[0]?.Len);
  } catch {
    return false;
  }
}

async function resolveMasterGood(goodId) {
  if (!goodId) return null;
  try {
    const r = await query(`
      SELECT TOP 1 g.GoodID, g.GoodCode, g.GoodName1 AS GoodName,
             CASE
               WHEN g.GoodName1 LIKE N'%ตรารถเกษตร%' OR g.GoodName1 LIKE N'%รถเกษตร%' THEN N'รถเกษตร'
               WHEN g.GoodName1 LIKE N'%ตราปุ๋ยเทพ%' OR g.GoodName1 LIKE N'%ปุ๋ยเทพ%' THEN N'ปุ๋ยเทพ'
               ELSE N'ทั่วไป'
             END AS NormalizedBrand
      FROM dbo.EMGood g WITH (NOLOCK)
      WHERE g.GoodID = @gid
    `, { gid: { type: sql.VarChar(50), value: String(goodId) } });
    const row = Array.isArray(r) ? r[0] : r?.recordset?.[0];
    if (!row) return null;
    const matched = matchGiveawayItem({ goodId: row.GoodID, goodName: row.GoodName, brand: row.NormalizedBrand });
    return {
      GoodID: String(row.GoodID),
      GoodCode: row.GoodCode || null,
      GoodName: row.GoodName || null,
      Brand: matched.brand || row.NormalizedBrand || 'ทั่วไป',
      ItemName: matched.itemName || row.GoodName,
    };
  } catch {
    return null;
  }
}

async function loadOrgRoster(scope) {
  let saleRegions = [];
  let orgStaff = [];
  try {
    const srRes = await wfQuery(`
      SELECT RegionCode, RegionName, Description, IsActive
      FROM wf.SaleRegion WITH (NOLOCK)
      WHERE ISNULL(IsActive, 1) = 1
      ORDER BY RegionCode ASC
    `);
    saleRegions = srRes?.recordset || [];
  } catch {
    saleRegions = [];
  }

  try {
    const sf = scopeFilter(scope, { userCol: 'u.Id', prefix: 'orgu' });
    const staffRes = await wfQuery(`
      SELECT u.Id AS UserId, u.Username, u.DisplayName, u.Role, u.EmpId,
             e.EmpCode, e.EmpName,
             u.PositionCode, p.PositionName, p.OrgUnit, p.Tier,
             ua.RegionCode AS AssignedRegionCode,
             sr.RegionName AS AssignedRegionName
      FROM wf.AppUser u
      LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId
      LEFT JOIN wf.OrgPosition p ON p.PositionCode = u.PositionCode
      OUTER APPLY (
        SELECT TOP 1 x.RegionCode
        FROM wf.UserSaleArea x
        WHERE x.UserId = u.Id
        ORDER BY x.IsPrimary DESC, x.Id ASC
      ) ua
      LEFT JOIN wf.SaleRegion sr ON sr.RegionCode = ua.RegionCode
      WHERE ISNULL(u.IsActive, 1) = 1
        AND (
          u.Role IN ('SALES', 'COUNTER_SALES')
          OR u.PositionCode LIKE 'SALE-%'
          OR u.PositionCode IN ('COUNTER-HEAD', 'COUNTER-SALE', 'PROMO-STAFF', 'PTHEP-HEAD', 'DIR-SALE-GOV', 'SMGR-NCES', 'SMGR-ISAN')
          OR ua.RegionCode IS NOT NULL
        )
        AND ${sf.sql}
      ORDER BY u.DisplayName ASC
    `, sf.inputs);
    const regionNameByCode = new Map(saleRegions.map(r => [String(r.RegionCode), r.RegionName]));
    orgStaff = (staffRes?.recordset || []).map(row => {
      const posInfo = row.PositionCode ? POSITION_REGION_MAP[String(row.PositionCode).toUpperCase()] : null;
      const code = row.AssignedRegionCode || posInfo?.code || null;
      const regionName = row.AssignedRegionName || (code ? regionNameByCode.get(String(code)) : null) || posInfo?.name || 'ส่วนกลาง / ไม่ระบุเขต';
      return {
        UserId: Number(row.UserId),
        Username: row.Username,
        DisplayName: row.DisplayName,
        Role: row.Role,
        EmpId: row.EmpId ? String(row.EmpId) : null,
        EmpCode: row.EmpCode || null,
        EmpName: row.EmpName || row.DisplayName || null,
        PositionCode: row.PositionCode || null,
        PositionName: row.PositionName || null,
        OrgUnit: row.OrgUnit || null,
        RegionCode: code ? String(code) : null,
        RegionName: regionName,
      };
    });
  } catch {
    orgStaff = [];
  }
  return { saleRegions, orgStaff };
}

router.use(requireAuth);

// R12 item 8: ยืมได้สูงสุดกี่ % ของโควต้าคงเหลือของผู้ให้ยืม (wf.SystemSetting, ค่าเริ่มต้น 100)
async function borrowMaxPct(queryFn = wfQuery) {
  try {
    const r = await queryFn(`SELECT SettingValue FROM wf.SystemSetting WITH (NOLOCK) WHERE SettingKey = 'GIVEAWAY_BORROW_MAX_PCT'`);
    const n = parseInt(r?.recordset?.[0]?.SettingValue, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 100) return n;
  } catch { /* setting table unavailable */ }
  return 100;
}

function borrowLimit(remaining, pct) {
  return Math.floor(Math.max(0, Number(remaining) || 0) * pct) / 100;
}

const APPROVER_ROLES = ['ADMIN', 'MANAGER', 'C_LEVEL'];

const YEAR = (q) => {
  let y = Number(q) || new Date().getFullYear();
  if (y < 2500) y += 543;
  return y;
};

// GET /api/giveaway/org-roster — เขตการขายและรายชื่อพนักงานจากผังองค์กร (synced from SaleRegion + OrgPosition + UserSaleArea)
router.get('/org-roster', async (req, res) => {
  try {
    const scope = await getVisibleScope(req.user);
    const { saleRegions, orgStaff } = await loadOrgRoster(scope);
    res.json({ regions: saleRegions, staff: orgStaff });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/regions?year= — สรุปต่อภาค (พนักงาน) ซิงก์กับผังองค์กรและเขตการขายหลัก
router.get('/regions', async (req, res) => {
  try {
    const year = YEAR(req.query.year);
    const scope = await getVisibleScope(req.user);
    const sf = scopeFilter(scope, { userCol: 'v.SalesUserId', prefix: 'gr' });
    const r = await wfQuery(`
      SELECT v.Region,
             v.SalesUserId,
             v.EmpCode,
             v.EmpId,
             e.EmpName,
             u.DisplayName,
             u.PositionCode,
             p.PositionName,
             p.OrgUnit,
             SUM(v.BudgetQty)    AS TotalBudget,
             SUM(v.WithdrawnQty) AS TotalWithdrawn,
             SUM(v.RemainingQty) AS TotalRemaining,
             COUNT(*)            AS ItemCount,
             SUM(CASE WHEN v.RemainingQty < 0 THEN 1 ELSE 0 END) AS OverCount,
             SUM(CASE WHEN v.RemainingQty < 0 THEN ABS(v.RemainingQty) ELSE 0 END) AS OverQty
      FROM wf.v_GiveawayBudgetStatus v
      LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpCode = v.EmpCode
      LEFT JOIN wf.AppUser u ON u.Id = v.SalesUserId
      LEFT JOIN wf.OrgPosition p ON p.PositionCode = u.PositionCode
      WHERE v.PeriodYear = @y AND (${sf.sql}${scope.all ? ' OR v.SalesUserId IS NULL' : ''})
      GROUP BY v.Region, v.SalesUserId, v.EmpCode, v.EmpId, e.EmpName, u.DisplayName, u.PositionCode, p.PositionName, p.OrgUnit
      ORDER BY v.Region
    `, { y: { type: sql.Int, value: year }, ...sf.inputs });

    const budgetRows = r.recordset || [];
    const { saleRegions, orgStaff } = await loadOrgRoster(scope);
    const regionNameByCode = new Map(saleRegions.map(sr => [String(sr.RegionCode), sr.RegionName]));
    const staffById = new Map(orgStaff.map(st => [Number(st.UserId), st]));

    const combined = [];
    const seenUserRegionKeys = new Set();
    const seenRegionCodes = new Set();

    // 1. Existing budget rows enriched with OrgPosition & RegionCode
    for (const row of budgetRows) {
      const uid = row.SalesUserId != null ? Number(row.SalesUserId) : null;
      const st = uid ? staffById.get(uid) : null;
      const code = inferRegionCode(row.Region) || st?.RegionCode || null;
      const displayRegion = row.Region || (code ? regionNameByCode.get(code) : null) || 'ไม่ระบุ';
      if (code) seenRegionCodes.add(code);
      if (uid) seenUserRegionKeys.add(`${uid}|${code || displayRegion}`);

      combined.push({
        Region: displayRegion,
        RegionCode: code,
        RegionLabel: st?.RegionName || (code ? regionNameByCode.get(code) : null) || displayRegion,
        SalesUserId: uid,
        EmpCode: row.EmpCode || st?.EmpCode || null,
        EmpId: row.EmpId || st?.EmpId || null,
        EmpName: row.DisplayName || row.EmpName || st?.EmpName || (uid ? null : 'งบส่วนกลางประจำภาค'),
        PositionCode: row.PositionCode || st?.PositionCode || null,
        PositionName: row.PositionName || st?.PositionName || null,
        OrgUnit: row.OrgUnit || st?.OrgUnit || null,
        TotalBudget: Number(row.TotalBudget || 0),
        TotalWithdrawn: Number(row.TotalWithdrawn || 0),
        TotalRemaining: Number(row.TotalRemaining || 0),
        ItemCount: Number(row.ItemCount || 0),
        OverCount: Number(row.OverCount || 0),
        OverQty: Number(row.OverQty || 0),
        HasQuota: true,
      });
    }

    // 2. Active Org staff who have not yet been allocated any giveaway budget row this year
    for (const st of orgStaff) {
      const keyByCode = `${st.UserId}|${st.RegionCode || st.RegionName}`;
      const alreadyHasAnyRowForUser = combined.some(x => x.SalesUserId === st.UserId);
      if (seenUserRegionKeys.has(keyByCode) || alreadyHasAnyRowForUser) continue;
      seenUserRegionKeys.add(keyByCode);
      if (st.RegionCode) seenRegionCodes.add(st.RegionCode);

      combined.push({
        Region: st.RegionName,
        RegionCode: st.RegionCode,
        RegionLabel: st.RegionName,
        SalesUserId: st.UserId,
        EmpCode: st.EmpCode,
        EmpId: st.EmpId,
        EmpName: st.DisplayName || st.EmpName || st.Username,
        PositionCode: st.PositionCode,
        PositionName: st.PositionName,
        OrgUnit: st.OrgUnit,
        TotalBudget: 0,
        TotalWithdrawn: 0,
        TotalRemaining: 0,
        ItemCount: 0,
        OverCount: 0,
        OverQty: 0,
        HasQuota: false,
      });
    }

    // 3. Official regions from wf.SaleRegion that have no assigned salesperson/quota yet (visible to Elevated roles)
    if (scope.all) {
      for (const sr of saleRegions) {
        const code = String(sr.RegionCode);
        if (code === '99') continue;
        const alreadyCovered = seenRegionCodes.has(code) || combined.some(x => x.Region === sr.RegionName);
        if (!alreadyCovered) {
          combined.push({
            Region: sr.RegionName,
            RegionCode: code,
            RegionLabel: sr.RegionName,
            SalesUserId: null,
            EmpCode: null,
            EmpId: null,
            EmpName: 'งบส่วนกลางประจำภาค (ยังไม่ระบุพนักงาน)',
            PositionCode: null,
            PositionName: null,
            OrgUnit: 'ขาย-การตลาด',
            TotalBudget: 0,
            TotalWithdrawn: 0,
            TotalRemaining: 0,
            ItemCount: 0,
            OverCount: 0,
            OverQty: 0,
            HasQuota: false,
          });
        }
      }
    }

    combined.sort((a, b) =>
      String(a.RegionCode || '99').localeCompare(String(b.RegionCode || '99'))
      || String(a.Region).localeCompare(String(b.Region), 'th')
      || String(a.EmpName || '').localeCompare(String(b.EmpName || ''), 'th')
    );

    res.json(combined);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/budget-lines?region=&regionCode=&salesUserId=&year= — งบรายรายการของภาค/พนักงาน
router.get('/budget-lines', async (req, res) => {
  try {
    const { region, regionCode, salesUserId, includeShared } = req.query;
    if (!region && !regionCode && !salesUserId) return res.status(400).json({ message: 'region จำเป็น' });
    const year = YEAR(req.query.year);
    const scope = await getVisibleScope(req.user);
    const sf = scopeFilter(scope, { userCol: 'b.SalesUserId', prefix: 'gb' });
    const hasExt = await hasExtendedBudgetSchema();
    const resolvedCode = regionCode || (region ? inferRegionCode(region) : null);

    const conds = ['v.PeriodYear = @y'];
    const inputs = { y: { type: sql.Int, value: year }, ...sf.inputs };

    if (region && resolvedCode && hasExt) {
      conds.push('(v.Region = @rg OR v.RegionCode = @rc)');
      inputs.rg = { type: sql.NVarChar(60), value: region };
      inputs.rc = { type: sql.VarChar(10), value: resolvedCode };
    } else if (region) {
      conds.push('v.Region = @rg');
      inputs.rg = { type: sql.NVarChar(60), value: region };
    } else if (resolvedCode && hasExt) {
      conds.push('v.RegionCode = @rc');
      inputs.rc = { type: sql.VarChar(10), value: resolvedCode };
    }

    if (salesUserId !== undefined && salesUserId !== '') {
      if (salesUserId === 'REGION' || salesUserId === 'NULL' || salesUserId === '0') {
        conds.push('v.SalesUserId IS NULL');
      } else if (Number.isInteger(Number(salesUserId)) && Number(salesUserId) > 0) {
        inputs.suFilter = { type: sql.Int, value: Number(salesUserId) };
        if (includeShared === 'false') {
          conds.push('v.SalesUserId = @suFilter');
        } else {
          conds.push('(v.SalesUserId = @suFilter OR v.SalesUserId IS NULL)');
        }
      }
    }

    if (!scope.all) {
      conds.push(`EXISTS (SELECT 1 FROM wf.GiveawayBudget b WHERE b.Id = v.Id AND (${sf.sql}))`);
    }

    const r = await wfQuery(`
      SELECT v.*,
             u.DisplayName AS SalesUserName,
             u.PositionCode AS SalesPositionCode,
             p.PositionName AS SalesPositionName
      FROM wf.v_GiveawayBudgetStatus v
      LEFT JOIN wf.AppUser u ON u.Id = v.SalesUserId
      LEFT JOIN wf.OrgPosition p ON p.PositionCode = u.PositionCode
      WHERE ${conds.join(' AND ')}
      ORDER BY CASE WHEN v.SalesUserId IS NULL THEN 1 ELSE 0 END ASC, v.Brand, v.ItemName
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/withdrawals?region=&salesUserId=&year= — log การเบิก
router.get('/withdrawals', async (req, res) => {
  try {
    const { region, salesUserId } = req.query;
    const conds = ['PeriodYear = @y'];
    const inputs = { y: { type: sql.Int, value: YEAR(req.query.year) } };
    if (region) {
      const aliases = getRegionAliases(region);
      const orConds = aliases.map((alias, idx) => {
        const key = `rg${idx}`;
        inputs[key] = { type: sql.NVarChar(60), value: alias };
        return `Region = @${key}`;
      });
      conds.push(`(${orConds.join(' OR ')})`);
    }
    if (salesUserId && Number.isInteger(Number(salesUserId)) && Number(salesUserId) > 0) {
      conds.push('(SalesUserId = @suFilter OR SalesUserId IS NULL)');
      inputs.suFilter = { type: sql.Int, value: Number(salesUserId) };
    }
    const sf = scopeFilter(await getVisibleScope(req.user), { userCol: 'SalesUserId', prefix: 'gw' });
    conds.push(sf.sql); Object.assign(inputs, sf.inputs);
    const r = await wfQuery(`
      SELECT TOP 300 * FROM wf.GiveawayWithdrawal
      WHERE ${conds.join(' AND ')}
      ORDER BY IssueMonth DESC, Id DESC
    `, inputs);
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/items?brand= — แคตตาล็อกของแถม (ดึงโดยตรงจาก WINSpeed GoodGroupID = 1005 ส่งเสริมการขาย)
router.get('/items', async (req, res) => {
  try {
    const { brand, includeInactive } = req.query;
    const inactiveFilter = includeInactive === 'true'
      ? ''
      : `AND ISNULL(g.Inactive, 'A') = 'A'`;
    const items = await query(`
      SELECT g.GoodID AS Id,
             g.GoodID,
             CASE 
               WHEN g.GoodName1 LIKE N'%ตรารถเกษตร%' OR g.GoodName1 LIKE N'%รถเกษตร%' THEN N'ตรารถเกษตร'
               WHEN g.GoodName1 LIKE N'%ตราปุ๋ยเทพ%' OR g.GoodName1 LIKE N'%ปุ๋ยเทพ%' THEN N'ตราปุ๋ยเทพ'
               ELSE N'ส่วนกลาง'
             END AS Brand,
             g.GoodName1 AS ItemName,
             g.GoodName1 AS GoodName,
             CASE
               WHEN g.GoodName1 LIKE N'%กระเป๋า%' THEN 'BAG'
               WHEN g.GoodName1 LIKE N'%เสื้อ%' THEN 'SHIRT'
               WHEN g.GoodName1 LIKE N'%แบนเนอร์%' OR g.GoodName1 LIKE N'%Board%' OR g.GoodName1 LIKE N'%ผ้าใบ%' OR g.GoodName1 LIKE N'%ป้าย%' THEN 'BANNER'
               ELSE 'OTHER'
             END AS ItemType,
             g.GoodCode,
             g.StockQty,
             g.RemaQty,
             ISNULL(gx.BagPerTon, 20) AS BagPerTon,
             ISNULL(gx.WeightKgPerBag, 50.0) AS WeightKgPerBag,
             gx.ImageUrl,
             ISNULL(u.GoodUnitName, N'ชิ้น') AS Unit,
             ISNULL(g.Inactive, 'A') AS Inactive
      FROM dbo.EMGood g WITH (NOLOCK)
      LEFT JOIN wf.GoodExtra gx WITH (NOLOCK) ON gx.GoodId = g.GoodID
      LEFT JOIN dbo.EMGoodUnit u WITH (NOLOCK) ON u.GoodUnitID = COALESCE(g.SaleGoodUnitID, g.MainGoodUnitID)
      WHERE g.GoodGroupID = 1005
        ${inactiveFilter}
        AND g.GoodName1 NOT LIKE N'%ไม่ใช้%' AND g.GoodName1 NOT LIKE N'%ยกเลิก%'
      ORDER BY g.GoodCode ASC
    `);
    let result = items || [];
    if (brand) {
      result = result.filter(x => x.Brand.toLowerCase().includes(brand.toLowerCase()));
    }
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/withdrawals — บันทึกการเบิกใหม่ (Source='APP')
router.post('/withdrawals', requireRole('SALES', 'COUNTER_SALES', 'ADMIN', 'MANAGER', 'APPROVER', 'C_LEVEL'), async (req, res) => {
  try {
    const { region, brand, itemName, goodId, goodCode, goodName, salesUserId, qty, issueMonth, custId, note } = req.body;
    if (!region || (!itemName && !goodId) || !qty)
      return res.status(400).json({ message: 'region, itemName/goodId, qty จำเป็น' });
    const year = YEAR(req.body.periodYear);
    const masterGood = goodId ? await resolveMasterGood(goodId) : null;
    const effBrand = brand || masterGood?.Brand || 'ทั่วไป';
    const effItem = itemName || masterGood?.ItemName || masterGood?.GoodName || String(goodId);
    const effGoodId = goodId ? String(goodId) : null;
    const effGoodCode = goodCode || masterGood?.GoodCode || null;
    const effGoodName = goodName || masterGood?.GoodName || null;

    let su = salesUserId ? Number(salesUserId) : null;
    let ei = null;
    let ec = null;
    if (su) {
      const uRow = (await wfQuery(`SELECT u.Id, u.EmpId, e.EmpCode FROM wf.AppUser u LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId WHERE u.Id = @id`, { id: { type: sql.Int, value: su } })).recordset?.[0];
      if (uRow) { ei = uRow.EmpId ? String(uRow.EmpId) : null; ec = uRow.EmpCode || null; }
    } else {
      const b = (await wfQuery(
        `SELECT TOP 1 SalesUserId, EmpId, EmpCode FROM wf.GiveawayBudget WHERE Region=@rg AND PeriodYear=@y ORDER BY CASE WHEN SalesUserId IS NOT NULL THEN 0 ELSE 1 END`,
        { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year } }
      )).recordset?.[0] || {};
      su = b.SalesUserId ?? null; ei = b.EmpId ?? null; ec = b.EmpCode ?? null;
    }

    const hasExt = await hasExtendedBudgetSchema();
    if (hasExt) {
      await wfQuery(`
        INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, GoodId, GoodCode, GoodName, Qty, CustId, Note, Source)
        VALUES (@su, @ei, @ec, @rg, @y, @mo, @br, @it, @gid, @gc, @gn, @qy, @cu, @nt, 'APP')`, {
          su: { type: sql.Int, value: su },
          ei: { type: sql.NVarChar(20), value: ei },
          ec: { type: sql.NVarChar(20), value: ec },
          rg: { type: sql.NVarChar(60), value: region },
          y:  { type: sql.Int, value: year },
          mo: { type: sql.Int, value: issueMonth || (new Date().getMonth() + 1) },
          br: { type: sql.NVarChar(50), value: effBrand },
          it: { type: sql.NVarChar(100), value: effItem },
          gid: { type: sql.VarChar(50), value: effGoodId },
          gc:  { type: sql.NVarChar(50), value: effGoodCode },
          gn:  { type: sql.NVarChar(200), value: effGoodName },
          qy: { type: sql.Decimal(12,2), value: Number(qty) },
          cu: { type: sql.NVarChar(20), value: custId || null },
          nt: { type: sql.NVarChar(300), value: note || null },
        });
    } else {
      await wfQuery(`
        INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, CustId, Note, Source)
        VALUES (@su, @ei, @ec, @rg, @y, @mo, @br, @it, @qy, @cu, @nt, 'APP')`, {
          su: { type: sql.Int, value: su },
          ei: { type: sql.NVarChar(20), value: ei },
          ec: { type: sql.NVarChar(20), value: ec },
          rg: { type: sql.NVarChar(60), value: region },
          y:  { type: sql.Int, value: year },
          mo: { type: sql.Int, value: issueMonth || (new Date().getMonth() + 1) },
          br: { type: sql.NVarChar(50), value: effBrand },
          it: { type: sql.NVarChar(100), value: effItem },
          qy: { type: sql.Decimal(12,2), value: Number(qty) },
          cu: { type: sql.NVarChar(20), value: custId || null },
          nt: { type: sql.NVarChar(300), value: note || null },
        });
    }

    const st = (await wfQuery(
      `SELECT BudgetQty, WithdrawnQty, RemainingQty FROM wf.v_GiveawayBudgetStatus
       WHERE Region=@rg AND PeriodYear=@y AND ${hasExt ? '((@gid IS NOT NULL AND GoodId=@gid) OR (Brand=@br AND ItemName=@it))' : '(Brand=@br AND ItemName=@it)'}
         AND (@su IS NULL OR SalesUserId=@su OR SalesUserId IS NULL)`,
      { rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year },
        gid: { type: sql.VarChar(50), value: effGoodId }, br: { type: sql.NVarChar(50), value: effBrand },
        it: { type: sql.NVarChar(100), value: effItem }, su: { type: sql.Int, value: su } }
    )).recordset?.[0];
    res.json({ ok: true, status: st, isOverBudget: st ? Number(st.RemainingQty) < 0 : false });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/budgets — สร้างหรือปรับปรุงงบ (เชื่อมสินค้า 98 รายการ & ระบุรายภาคหรือรายพนักงาน)
router.post('/budgets', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const { region, regionCode, salesUserId, empId, empCode, goodId, goodCode, goodName, brand, itemName, budgetQty, reason } = req.body;
    if (!region) return res.status(400).json({ message: 'region จำเป็น' });
    if (!goodId && (!brand || !itemName)) return res.status(400).json({ message: 'กรุณาเลือกรายการของแถม (goodId หรือ brand/itemName)' });
    const qtyNum = Number(budgetQty);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) return res.status(400).json({ message: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' });
    const year = YEAR(req.body.periodYear);

    const masterGood = goodId ? await resolveMasterGood(goodId) : null;
    const effBrand = brand || masterGood?.Brand || 'ทั่วไป';
    const effItem = itemName || masterGood?.ItemName || masterGood?.GoodName || String(goodId);
    const effGoodId = goodId ? String(goodId) : null;
    const effGoodCode = goodCode || masterGood?.GoodCode || null;
    const effGoodName = goodName || masterGood?.GoodName || null;
    const effRegionCode = regionCode || inferRegionCode(region) || null;
    const su = salesUserId ? Number(salesUserId) : null;

    let resolvedEmpId = empId || null;
    let resolvedEmpCode = empCode || null;
    if (su && (!resolvedEmpId || !resolvedEmpCode)) {
      const uRow = (await wfQuery(
        `SELECT u.EmpId, e.EmpCode FROM wf.AppUser u LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId WHERE u.Id = @id`,
        { id: { type: sql.Int, value: su } }
      )).recordset?.[0];
      if (uRow) {
        if (!resolvedEmpId && uRow.EmpId) resolvedEmpId = String(uRow.EmpId);
        if (!resolvedEmpCode && uRow.EmpCode) resolvedEmpCode = uRow.EmpCode;
      }
    }

    const hasExt = await hasExtendedBudgetSchema();
    const matchWhere = hasExt && effGoodId
      ? `Region=@rg AND PeriodYear=@y AND ISNULL(SalesUserId, 0)=ISNULL(@su, 0) AND (GoodId=@gid OR (GoodId IS NULL AND Brand=@br AND ItemName=@it))`
      : `Region=@rg AND PeriodYear=@y AND ${hasExt ? 'ISNULL(SalesUserId, 0)=ISNULL(@su, 0) AND ' : ''}Brand=@br AND ItemName=@it`;

    const existing = (await wfQuery(
      `SELECT TOP 1 Id, BudgetQty, WithdrawnQty, RemainingQty FROM wf.v_GiveawayBudgetStatus WHERE ${matchWhere}`,
      {
        rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year },
        su: { type: sql.Int, value: su }, gid: { type: sql.VarChar(50), value: effGoodId },
        br: { type: sql.NVarChar(50), value: effBrand }, it: { type: sql.NVarChar(100), value: effItem },
      }
    )).recordset?.[0] || null;

    let budgetId = existing?.Id || null;
    if (existing) {
      if (hasExt) {
        await wfQuery(`
          UPDATE wf.GiveawayBudget
          SET BudgetQty=@bq, GoodId=COALESCE(@gid, GoodId), GoodCode=COALESCE(@gc, GoodCode), GoodName=COALESCE(@gn, GoodName),
              RegionCode=COALESCE(@rc, RegionCode), SalesUserId=COALESCE(@su, SalesUserId), EmpId=COALESCE(@ei, EmpId), EmpCode=COALESCE(@ec, EmpCode),
              UpdatedAt=GETUTCDATE()
          WHERE Id=@id`, {
            id: { type: sql.Int, value: existing.Id }, bq: { type: sql.Decimal(12,2), value: qtyNum },
            gid: { type: sql.VarChar(50), value: effGoodId }, gc: { type: sql.NVarChar(50), value: effGoodCode },
            gn: { type: sql.NVarChar(200), value: effGoodName }, rc: { type: sql.VarChar(10), value: effRegionCode },
            su: { type: sql.Int, value: su }, ei: { type: sql.NVarChar(20), value: resolvedEmpId }, ec: { type: sql.NVarChar(20), value: resolvedEmpCode },
          });
      } else {
        await wfQuery(`UPDATE wf.GiveawayBudget SET BudgetQty=@bq, UpdatedAt=GETUTCDATE() WHERE Id=@id`,
          { id: { type: sql.Int, value: existing.Id }, bq: { type: sql.Decimal(12,2), value: qtyNum } });
      }
    } else {
      if (hasExt) {
        const ins = await wfQuery(`
          INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, RegionCode, PeriodYear, Brand, ItemName, GoodId, GoodCode, GoodName, BudgetQty)
          OUTPUT INSERTED.Id
          VALUES (@su, @ei, @ec, @rg, @rc, @y, @br, @it, @gid, @gc, @gn, @bq)`, {
            su: { type: sql.Int, value: su }, ei: { type: sql.NVarChar(20), value: resolvedEmpId }, ec: { type: sql.NVarChar(20), value: resolvedEmpCode },
            rg: { type: sql.NVarChar(60), value: region }, rc: { type: sql.VarChar(10), value: effRegionCode }, y: { type: sql.Int, value: year },
            br: { type: sql.NVarChar(50), value: effBrand }, it: { type: sql.NVarChar(100), value: effItem },
            gid: { type: sql.VarChar(50), value: effGoodId }, gc: { type: sql.NVarChar(50), value: effGoodCode },
            gn: { type: sql.NVarChar(200), value: effGoodName }, bq: { type: sql.Decimal(12,2), value: qtyNum },
          });
        budgetId = ins?.recordset?.[0]?.Id || null;
      } else {
        const ins = await wfQuery(`
          INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
          OUTPUT INSERTED.Id
          VALUES (@su, @ei, @ec, @rg, @y, @br, @it, @bq)`, {
            su: { type: sql.Int, value: su }, ei: { type: sql.NVarChar(20), value: resolvedEmpId }, ec: { type: sql.NVarChar(20), value: resolvedEmpCode },
            rg: { type: sql.NVarChar(60), value: region }, y: { type: sql.Int, value: year },
            br: { type: sql.NVarChar(50), value: effBrand }, it: { type: sql.NVarChar(100), value: effItem },
            bq: { type: sql.Decimal(12,2), value: qtyNum },
          });
        budgetId = ins?.recordset?.[0]?.Id || null;
      }
    }

    await logChangeEvent(null, {
      entityType: 'GIVEAWAY_BUDGET',
      entityId: budgetKey(region, year, effBrand, effItem, effGoodId, su),
      action: existing ? 'UPDATE' : 'CREATE',
      beforeJson: existing ? { budgetQty: Number(existing.BudgetQty), withdrawnQty: Number(existing.WithdrawnQty) } : null,
      afterJson: { budgetQty: qtyNum, goodId: effGoodId, goodCode: effGoodCode, goodName: effGoodName, salesUserId: su },
      reasonCode: 'GIVEAWAY_QUOTA_SETTING',
      reasonText: reason ? String(reason).slice(0, 500) : null,
      userId: String(req.user.sub),
      ipAddress: req.ip,
    });
    const warning = existing && qtyNum < Number(existing.WithdrawnQty || 0)
      ? `งบใหม่ (${qtyNum}) น้อยกว่ายอดเบิกแล้ว (${Number(existing.WithdrawnQty)}) — โควต้าคงเหลือจะติดลบ` : null;
    res.json({ ok: true, id: budgetId, warning });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PUT /api/giveaway/budgets/:id — แก้ไขรายการโควต้า (จำนวน, สินค้าจาก 98 รายการ, หรือพนักงาน)
router.put('/budgets/:id', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'รหัสรายการไม่ถูกต้อง' });
    const current = (await wfQuery(`SELECT * FROM wf.v_GiveawayBudgetStatus WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset?.[0];
    if (!current) return res.status(404).json({ message: 'ไม่พบรายการโควต้า' });

    const { region, regionCode, salesUserId, empId, empCode, goodId, goodCode, goodName, brand, itemName, budgetQty, reason } = req.body;
    const qtyNum = budgetQty !== undefined ? Number(budgetQty) : Number(current.BudgetQty);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) return res.status(400).json({ message: 'จำนวนงบต้องเป็นตัวเลขไม่ติดลบ' });

    const masterGood = goodId ? await resolveMasterGood(goodId) : null;
    const effRegion = region || current.Region;
    const effRegionCode = regionCode || inferRegionCode(effRegion) || current.RegionCode || null;
    const effGoodId = goodId !== undefined ? (goodId ? String(goodId) : null) : (current.GoodId || null);
    const effGoodCode = goodCode !== undefined ? goodCode : (masterGood?.GoodCode ?? current.GoodCode ?? null);
    const effGoodName = goodName !== undefined ? goodName : (masterGood?.GoodName ?? current.GoodName ?? null);
    const effBrand = brand || masterGood?.Brand || current.Brand;
    const effItem = itemName || masterGood?.ItemName || current.ItemName;

    let effSalesUserId = current.SalesUserId ?? null;
    let effEmpId = current.EmpId ?? null;
    let effEmpCode = current.EmpCode ?? null;
    if (salesUserId !== undefined) {
      effSalesUserId = salesUserId ? Number(salesUserId) : null;
      if (effSalesUserId) {
        const uRow = (await wfQuery(`SELECT u.EmpId, e.EmpCode FROM wf.AppUser u LEFT JOIN dbo.EMEmp e WITH (NOLOCK) ON e.EmpID = u.EmpId WHERE u.Id = @uid`, { uid: { type: sql.Int, value: effSalesUserId } })).recordset?.[0];
        effEmpId = empId !== undefined ? empId : (uRow?.EmpId ? String(uRow.EmpId) : null);
        effEmpCode = empCode !== undefined ? empCode : (uRow?.EmpCode || null);
      } else {
        effEmpId = empId !== undefined ? empId : null;
        effEmpCode = empCode !== undefined ? empCode : null;
      }
    }

    const hasExt = await hasExtendedBudgetSchema();
    if (hasExt) {
      await wfQuery(`
        UPDATE wf.GiveawayBudget
        SET Region=@rg, RegionCode=@rc, SalesUserId=@su, EmpId=@ei, EmpCode=@ec,
            Brand=@br, ItemName=@it, GoodId=@gid, GoodCode=@gc, GoodName=@gn, BudgetQty=@bq, UpdatedAt=GETUTCDATE()
        WHERE Id=@id`, {
          id: { type: sql.Int, value: id },
          rg: { type: sql.NVarChar(60), value: effRegion }, rc: { type: sql.VarChar(10), value: effRegionCode },
          su: { type: sql.Int, value: effSalesUserId }, ei: { type: sql.NVarChar(20), value: effEmpId }, ec: { type: sql.NVarChar(20), value: effEmpCode },
          br: { type: sql.NVarChar(50), value: effBrand }, it: { type: sql.NVarChar(100), value: effItem },
          gid: { type: sql.VarChar(50), value: effGoodId }, gc: { type: sql.NVarChar(50), value: effGoodCode }, gn: { type: sql.NVarChar(200), value: effGoodName },
          bq: { type: sql.Decimal(12,2), value: qtyNum },
        });
    } else {
      await wfQuery(`
        UPDATE wf.GiveawayBudget
        SET Region=@rg, SalesUserId=@su, EmpId=@ei, EmpCode=@ec, Brand=@br, ItemName=@it, BudgetQty=@bq, UpdatedAt=GETUTCDATE()
        WHERE Id=@id`, {
          id: { type: sql.Int, value: id },
          rg: { type: sql.NVarChar(60), value: effRegion }, su: { type: sql.Int, value: effSalesUserId },
          ei: { type: sql.NVarChar(20), value: effEmpId }, ec: { type: sql.NVarChar(20), value: effEmpCode },
          br: { type: sql.NVarChar(50), value: effBrand }, it: { type: sql.NVarChar(100), value: effItem },
          bq: { type: sql.Decimal(12,2), value: qtyNum },
        });
    }

    await logChangeEvent(null, {
      entityType: 'GIVEAWAY_BUDGET',
      entityId: budgetKey(effRegion, current.PeriodYear, effBrand, effItem, effGoodId, effSalesUserId),
      action: 'UPDATE',
      beforeJson: {
        budgetQty: Number(current.BudgetQty), withdrawnQty: Number(current.WithdrawnQty),
        brand: current.Brand, itemName: current.ItemName, goodId: current.GoodId || null, salesUserId: current.SalesUserId || null,
      },
      afterJson: {
        budgetQty: qtyNum, brand: effBrand, itemName: effItem, goodId: effGoodId, goodCode: effGoodCode, goodName: effGoodName, salesUserId: effSalesUserId,
      },
      reasonCode: 'GIVEAWAY_QUOTA_EDIT',
      reasonText: reason ? String(reason).slice(0, 500) : null,
      userId: String(req.user.sub),
      ipAddress: req.ip,
    });

    const warning = qtyNum < Number(current.WithdrawnQty || 0)
      ? `งบใหม่ (${qtyNum}) น้อยกว่ายอดเบิกแล้ว (${Number(current.WithdrawnQty)}) — โควต้าคงเหลือจะติดลบ` : null;
    res.json({ ok: true, id, warning });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// DELETE /api/giveaway/budgets/:id — ลบรายการโควต้า (บันทึก Audit Log เสมอ)
router.delete('/budgets/:id', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: 'รหัสรายการไม่ถูกต้อง' });
    const force = req.query.force === 'true';
    const current = (await wfQuery(`SELECT * FROM wf.v_GiveawayBudgetStatus WHERE Id = @id`, { id: { type: sql.Int, value: id } })).recordset?.[0];
    if (!current) return res.status(404).json({ message: 'ไม่พบรายการโควต้า' });

    if (Number(current.WithdrawnQty || 0) > 0 && !force) {
      return res.status(409).json({
        message: `รายการ "${current.GoodName || current.ItemName}" มียอดเบิกแล้ว ${Number(current.WithdrawnQty).toLocaleString()} ชิ้น กรุณายืนยันอีกครั้งหากต้องการลบ`,
        withdrawnQty: Number(current.WithdrawnQty),
        requiresConfirm: true,
      });
    }

    await wfQuery(`DELETE FROM wf.GiveawayBudget WHERE Id = @id`, { id: { type: sql.Int, value: id } });
    await logChangeEvent(null, {
      entityType: 'GIVEAWAY_BUDGET',
      entityId: budgetKey(current.Region, current.PeriodYear, current.Brand, current.ItemName, current.GoodId || null, current.SalesUserId || null),
      action: 'DELETE',
      beforeJson: {
        budgetQty: Number(current.BudgetQty), withdrawnQty: Number(current.WithdrawnQty || 0),
        brand: current.Brand, itemName: current.ItemName, goodId: current.GoodId || null, goodName: current.GoodName || null,
        salesUserId: current.SalesUserId || null,
      },
      afterJson: null,
      reasonCode: 'GIVEAWAY_QUOTA_DELETE',
      reasonText: req.body?.reason ? String(req.body.reason).slice(0, 500) : (req.query.reason ? String(req.query.reason).slice(0, 500) : null),
      userId: String(req.user.sub),
      ipAddress: req.ip,
    });
    res.json({ ok: true, id });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/budget-history?region=&year= — audit trail of quota settings and borrow moves (R12 item 8)
router.get('/budget-history', requireCapability('giveaway.budget'), async (req, res) => {
  try {
    const { region } = req.query;
    if (!region) return res.status(400).json({ message: 'region จำเป็น' });
    const year = YEAR(req.query.year);
    const aliases = getRegionAliases(region);
    const changeInputs = {};
    const prefixConds = aliases.map((alias, idx) => {
      const key = `prefix${idx}`;
      changeInputs[key] = { type: sql.NVarChar(120), value: `${alias}|${year}|%` };
      return `e.EntityId LIKE @${key}`;
    });
    const changes = (await wfQuery(`
      SELECT TOP 300 e.EventId AS Id, e.EntityId, e.Action, e.BeforeJson, e.AfterJson, e.ReasonText, e.UserId, e.CreatedAt, u.DisplayName AS UserName
      FROM wf.ChangeEvent e
      LEFT JOIN wf.AppUser u ON CAST(u.Id AS VARCHAR(50)) = e.UserId
      WHERE e.EntityType = 'GIVEAWAY_BUDGET' AND (${prefixConds.join(' OR ')})
      ORDER BY e.EventId DESC
    `, changeInputs)).recordset || [];

    const borrowInputs = { y: { type: sql.Int, value: year } };
    const regionConds = aliases.map((alias, idx) => {
      borrowInputs[`rg${idx}`] = { type: sql.NVarChar(60), value: alias };
      borrowInputs[`tag1_${idx}`] = { type: sql.NVarChar(80), value: `%[REQ_RG:${alias}]%` };
      borrowInputs[`tag2_${idx}`] = { type: sql.NVarChar(80), value: `%[LEN_RG:${alias}]%` };
      return `b.Region = @rg${idx} OR b.Reason LIKE @tag1_${idx} OR b.Reason LIKE @tag2_${idx} OR EXISTS (SELECT 1 FROM wf.GiveawayBudget g WHERE g.Region = @rg${idx} AND g.PeriodYear = @y AND g.SalesUserId IN (b.RequesterId, b.LenderId))`;
    });
    const borrows = (await wfQuery(`
      SELECT TOP 300 b.*, rq.DisplayName AS RequesterName, ln.DisplayName AS LenderName
      FROM wf.GiveawayBorrowRequest b
      JOIN wf.AppUser rq ON rq.Id = b.RequesterId
      JOIN wf.AppUser ln ON ln.Id = b.LenderId
      WHERE b.PeriodYear = @y AND (${regionConds.join(' OR ')})
      ORDER BY b.RequestedAt DESC
    `, borrowInputs)).recordset || [];
    res.json({ changes, borrows });
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/my-quota — Get user's quota (current user or target sales user)
router.get('/my-quota', async (req, res) => {
  try {
    const year = YEAR(req.query.year);
    const targetUserId = req.query.salesUserId ? Number(req.query.salesUserId) : req.user.id;
    if (!(await canViewSalesUser(req.user, targetUserId))) {
      return res.status(403).json({ message: 'ดูโควต้าของพนักงานขายคนอื่นได้เฉพาะคนในทีม' });
    }
    const r = await wfQuery(`
      SELECT * FROM wf.v_GiveawayBudgetStatus
      WHERE SalesUserId = @u AND PeriodYear = @y
    `, { u: { type: sql.Int, value: targetUserId }, y: { type: sql.Int, value: year } });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// GET /api/giveaway/available-lenders — Get users who have quota for an item
router.get('/available-lenders', async (req, res) => {
  try {
    const { brand, itemName } = req.query;
    const year = YEAR(req.query.year);
    if (!brand || !itemName) return res.status(400).json({ message: 'brand and itemName are required' });
    const r = await wfQuery(`
      SELECT v.SalesUserId, v.EmpId, v.EmpCode, v.Region, v.RemainingQty, u.DisplayName
      FROM wf.v_GiveawayBudgetStatus v
      JOIN wf.AppUser u ON u.Id = v.SalesUserId
      WHERE v.Brand = @b AND v.ItemName = @i AND v.PeriodYear = @y AND v.RemainingQty > 0 AND v.SalesUserId != @u
      ORDER BY v.RemainingQty DESC
    `, {
      b: { type: sql.NVarChar(50), value: brand },
      i: { type: sql.NVarChar(100), value: itemName },
      y: { type: sql.Int, value: year },
      u: { type: sql.Int, value: req.user.id }
    });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// POST /api/giveaway/borrow-requests — Request to borrow quota
router.post('/borrow-requests', requireCapability('giveaway.borrow'), async (req, res) => {
  try {
    const { lenderId, region, requesterRegion, lenderRegion, brand, itemName, qty, reason } = req.body;
    if (!lenderId || !brand || !itemName || !qty) {
      return res.status(400).json({ message: 'ข้อมูลจำเป็นไม่ครบถ้วน (lenderId, brand, itemName, qty)' });
    }

    // U-6: Block borrowing from yourself
    if (Number(req.user.id) === Number(lenderId)) {
      return res.status(400).json({ message: 'ไม่สามารถขอยืมโควตาจากตนเองได้' });
    }

    const year = YEAR(req.body.periodYear);
    const borrowQty = Number(qty);
    if (isNaN(borrowQty) || borrowQty <= 0) {
      return res.status(400).json({ message: 'จำนวนที่ขอยืมต้องมากกว่า 0' });
    }

    // U-6: ภาคของผู้ขอและผู้ให้ยืมมาจากงบในระบบ ไม่เชื่อค่าที่หน้าจอส่งมา (ใช้ค่าที่ส่งมาเฉพาะเมื่อไม่มีงบ)
    const lenderLine = (await wfQuery(
      `SELECT TOP 1 Region, RemainingQty FROM wf.v_GiveawayBudgetStatus WHERE SalesUserId=@u AND PeriodYear=@y AND Brand=@br AND ItemName=@it`,
      { u: { type: sql.Int, value: Number(lenderId) }, y: { type: sql.Int, value: year }, br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0];
    if (!lenderLine) {
      return res.status(400).json({ message: `ผู้ให้ยืมไม่มีงบของแถม ${brand} ${itemName} ในปี ${year}` });
    }
    const requesterLine = (await wfQuery(
      `SELECT TOP 1 Region FROM wf.GiveawayBudget WHERE SalesUserId=@u AND PeriodYear=@y ORDER BY CASE WHEN Brand=@br AND ItemName=@it THEN 0 ELSE 1 END`,
      { u: { type: sql.Int, value: Number(req.user.id) }, y: { type: sql.Int, value: year }, br: { type: sql.NVarChar(50), value: brand }, it: { type: sql.NVarChar(100), value: itemName } }
    )).recordset?.[0];
    const lenRegion = String(lenderLine.Region || '').trim();
    const reqRegion = String(requesterLine?.Region || requesterRegion || region || '').trim();
    if (!reqRegion) {
      return res.status(400).json({ message: 'ไม่พบภาคของผู้ขอยืม (ยังไม่มีงบของแถมในปีนี้) กรุณาระบุภาค' });
    }
    if (reqRegion === lenRegion) {
      return res.status(400).json({ message: 'ผู้ขอและผู้ให้ยืมอยู่ภาคเดียวกัน ไม่ต้องยืมโควต้า' });
    }

    // R12 item 8: เพดานการยืม
    const pct = await borrowMaxPct();
    const limit = borrowLimit(lenderLine.RemainingQty, pct);
    if (borrowQty > limit) {
      return res.status(400).json({ message: `ขอยืมได้ไม่เกิน ${limit} ชิ้น (${pct}% ของโควต้าคงเหลือ ${Number(lenderLine.RemainingQty)} ชิ้น)` });
    }

    // Check if columns RequesterRegion and LenderRegion exist in schema
    let hasRegionCols = false;
    try {
      const colCheck = await wfQuery(`SELECT COL_LENGTH('wf.GiveawayBorrowRequest', 'RequesterRegion') AS HasCol`);
      hasRegionCols = !!colCheck.recordset?.[0]?.HasCol;
    } catch (_) {}

    let r;
    if (hasRegionCols) {
      r = await wfQuery(`
        INSERT INTO wf.GiveawayBorrowRequest (RequesterId, LenderId, Region, RequesterRegion, LenderRegion, PeriodYear, Brand, ItemName, Qty, Reason, Status)
        OUTPUT INSERTED.Id
        VALUES (@req, @len, @rg, @reqRg, @lenRg, @y, @br, @it, @qty, @rs, 'PENDING')
      `, {
        req: { type: sql.Int, value: req.user.id },
        len: { type: sql.Int, value: Number(lenderId) },
        rg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        reqRg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        lenRg: { type: sql.NVarChar(60), value: lenRegion || reqRegion },
        y: { type: sql.Int, value: year },
        br: { type: sql.NVarChar(50), value: brand },
        it: { type: sql.NVarChar(100), value: itemName },
        qty: { type: sql.Decimal(12,2), value: borrowQty },
        rs: { type: sql.NVarChar(200), value: reason || '' }
      });
    } else {
      // Store region metadata in Reason tag for backwards compatibility when columns aren't in live DB
      const reasonMeta = `[REQ_RG:${reqRegion || lenRegion}][LEN_RG:${lenRegion || reqRegion}] ${reason || ''}`.trim();
      r = await wfQuery(`
        INSERT INTO wf.GiveawayBorrowRequest (RequesterId, LenderId, Region, PeriodYear, Brand, ItemName, Qty, Reason, Status)
        OUTPUT INSERTED.Id
        VALUES (@req, @len, @rg, @y, @br, @it, @qty, @rs, 'PENDING')
      `, {
        req: { type: sql.Int, value: req.user.id },
        len: { type: sql.Int, value: Number(lenderId) },
        rg: { type: sql.NVarChar(60), value: reqRegion || lenRegion },
        y: { type: sql.Int, value: year },
        br: { type: sql.NVarChar(50), value: brand },
        it: { type: sql.NVarChar(100), value: itemName },
        qty: { type: sql.Decimal(12,2), value: borrowQty },
        rs: { type: sql.NVarChar(200), value: reasonMeta }
      });
    }

    res.json({ ok: true, id: r.recordset[0].Id });
  } catch (e) {
    console.error('[giveaway-borrow-requests] error:', e);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึกคำขอยืมโควตา: ' + e.message });
  }
});

// GET /api/giveaway/borrow-requests — Get pending borrow requests for the current user (either requester, lender, or approver)
router.get('/borrow-requests', async (req, res) => {
  try {
    // R12 O-4: requests where the requester or the lender is in the user's own + team scope
    const scope = await getVisibleScope(req.user);
    const byReq = scopeFilter(scope, { userCol: 'b.RequesterId', prefix: 'bq' });
    const byLen = scopeFilter(scope, { userCol: 'b.LenderId', prefix: 'bl' });
    const r = await wfQuery(`
      SELECT b.*, req.DisplayName as RequesterName, len.DisplayName as LenderName
      FROM wf.GiveawayBorrowRequest b
      JOIN wf.AppUser req ON req.Id = b.RequesterId
      JOIN wf.AppUser len ON len.Id = b.LenderId
      WHERE ${scope.all ? '1=1' : `(${byReq.sql} OR ${byLen.sql})`}
      ORDER BY b.RequestedAt DESC
    `, { ...byReq.inputs, ...byLen.inputs });
    res.json(r.recordset || []);
  } catch (e) { console.error(e); res.status(500).json({ message: e.message }); }
});

// PATCH /api/giveaway/borrow-requests/:id/resolve — Approve or Reject in one atomic transaction (U-6)
// R12 O-4: a team-scoped manager resolves only requests whose requester or lender is in the team
async function requireBorrowRequestInScope(req, res, next) {
  try {
    const scope = await getVisibleScope(req.user);
    if (scope.all) return next();
    const cur = (await wfQuery(`SELECT RequesterId, LenderId FROM wf.GiveawayBorrowRequest WHERE Id=@id`,
      { id: { type: sql.Int, value: Number(req.params.id) || 0 } })).recordset?.[0];
    if (cur && !inScope(scope, { userId: cur.RequesterId, extraUserIds: [cur.LenderId] })) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลคำขอยืมโควตา' });
    }
    next();
  } catch (e) { res.status(500).json({ message: e.message }); }
}

router.patch('/borrow-requests/:id/resolve', requireBorrowRequestInScope, async (req, res) => {
  try {
    const { approve, note } = req.body;
    const reqId = Number(req.params.id);
    if (!reqId) return res.status(400).json({ message: 'รหัสคำขอไม่ถูกต้อง' });

    // Reject flow — ผู้ให้ยืม ผู้ขอ (ยกเลิกคำขอตัวเอง) หรือ ADMIN/MANAGER/C_LEVEL เท่านั้น
    if (!approve) {
      const cur = (await wfQuery(`SELECT RequesterId, LenderId, Status FROM wf.GiveawayBorrowRequest WHERE Id=@id`, { id: { type: sql.Int, value: reqId } })).recordset?.[0];
      if (!cur) return res.status(404).json({ message: 'ไม่พบข้อมูลคำขอยืมโควตา' });
      const uid = Number(req.user.id);
      if (uid !== Number(cur.LenderId) && uid !== Number(cur.RequesterId) && !APPROVER_ROLES.includes(req.user.role)) {
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ปฏิเสธคำขอนี้' });
      }
      const rejectRes = await wfQuery(`
        UPDATE wf.GiveawayBorrowRequest 
        SET Status = 'REJECTED', ApproverId = @u, Note = @n, ResolvedAt = GETUTCDATE()
        WHERE Id = @id AND Status = 'PENDING'
      `, {
        id: { type: sql.Int, value: reqId },
        u: { type: sql.Int, value: req.user.id },
        n: { type: sql.NVarChar(500), value: note || null },
      });
      if (!rejectRes.rowsAffected?.[0]) {
        return res.status(409).json({ message: 'คำขอนี้ถูกดำเนินการไปแล้วหรือไม่พบข้อมูล' });
      }
      return res.json({ ok: true, status: 'REJECTED' });
    }

    // Approve flow: Atomic transaction with UPDLOCK/ROWLOCK
    await wfTransaction(async (tx) => {
      // 1. Lock and fetch the borrow request
      const bReq = (await tx.request()
        .input('id', sql.Int, reqId)
        .query(`SELECT * FROM wf.GiveawayBorrowRequest WITH (UPDLOCK, ROWLOCK) WHERE Id = @id`)).recordset?.[0];

      if (!bReq) {
        throw Object.assign(new Error('ไม่พบข้อมูลคำขอยืมโควตา'), { status: 404 });
      }
      if (bReq.Status !== 'PENDING') {
        throw Object.assign(new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว'), { status: 409 });
      }

      // Check permission: only Lender or ADMIN/MANAGER/C_LEVEL can resolve
      if (Number(req.user.id) !== Number(bReq.LenderId) && !APPROVER_ROLES.includes(req.user.role)) {
        throw Object.assign(new Error('คุณไม่มีสิทธิ์อนุมัติคำขอนี้'), { status: 403 });
      }

      // 2. Resolve lender region and requester region
      let lenderRegion = bReq.LenderRegion || null;
      let requesterRegion = bReq.RequesterRegion || null;

      // Extract from reason tag if not in columns
      if (!lenderRegion || !requesterRegion) {
        const reasonStr = String(bReq.Reason || '');
        const reqMatch = reasonStr.match(/\[REQ_RG:([^\]]+)\]/);
        const lenMatch = reasonStr.match(/\[LEN_RG:([^\]]+)\]/);
        if (reqMatch) requesterRegion = reqMatch[1];
        if (lenMatch) lenderRegion = lenMatch[1];
      }

      // Fallback: look up regions from GiveawayBudget
      if (!lenderRegion) {
        const lBudgetRow = (await tx.request()
          .input('len', sql.Int, bReq.LenderId)
          .input('y', sql.Int, bReq.PeriodYear)
          .input('br', sql.NVarChar(50), bReq.Brand)
          .input('it', sql.NVarChar(100), bReq.ItemName)
          .query(`
            SELECT TOP 1 Region FROM wf.GiveawayBudget
            WHERE SalesUserId = @len AND PeriodYear = @y AND Brand = @br AND ItemName = @it
          `)).recordset?.[0];
        lenderRegion = lBudgetRow?.Region || bReq.Region;
      }

      if (!requesterRegion) {
        const rBudgetRow = (await tx.request()
          .input('req', sql.Int, bReq.RequesterId)
          .input('y', sql.Int, bReq.PeriodYear)
          .query(`
            SELECT TOP 1 Region FROM wf.GiveawayBudget
            WHERE SalesUserId = @req AND PeriodYear = @y
          `)).recordset?.[0];
        requesterRegion = rBudgetRow?.Region || bReq.Region;
      }

      // 3. Lock lender budget row and verify quota
      const lenderBudget = (await tx.request()
        .input('rg', sql.NVarChar(60), lenderRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT Id, BudgetQty, SalesUserId, EmpCode, EmpId
          FROM wf.GiveawayBudget WITH (UPDLOCK, ROWLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      if (!lenderBudget) {
        throw Object.assign(new Error(`ไม่พบงบโควตาของผู้ให้ยืมในภาค "${lenderRegion}" สำหรับ ${bReq.Brand} ${bReq.ItemName}`), { status: 400 });
      }

      // Calculate lender's withdrawn quantity
      const lenderWithdrawal = (await tx.request()
        .input('rg', sql.NVarChar(60), lenderRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT ISNULL(SUM(Qty), 0) AS Withdrawn
          FROM wf.GiveawayWithdrawal WITH (UPDLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      const currentLenderRemaining = Number(lenderBudget.BudgetQty) - Number(lenderWithdrawal?.Withdrawn || 0);
      const borrowQty = Number(bReq.Qty);

      if (currentLenderRemaining < borrowQty) {
        throw Object.assign(new Error(`โควตาคงเหลือของผู้ให้ยืมไม่เพียงพอ (คงเหลือ ${currentLenderRemaining} ชิ้น, ขอยืม ${borrowQty} ชิ้น)`), { status: 400 });
      }
      // R12 item 8: ตรวจเพดานการยืมซ้ำตอนอนุมัติ (โควต้าอาจลดลงหลังยื่นคำขอ)
      const pct = await borrowMaxPct((text) => tx.request().query(text));
      const limit = borrowLimit(currentLenderRemaining, pct);
      if (borrowQty > limit) {
        throw Object.assign(new Error(`ยืมได้ไม่เกิน ${limit} ชิ้น (${pct}% ของโควต้าคงเหลือ ${currentLenderRemaining} ชิ้น)`), { status: 400 });
      }

      // 4. Deduct from lender region row
      await tx.request()
        .input('id', sql.Int, lenderBudget.Id)
        .input('qty', sql.Decimal(12, 2), borrowQty)
        .query(`
          UPDATE wf.GiveawayBudget
          SET BudgetQty = BudgetQty - @qty, UpdatedAt = GETUTCDATE()
          WHERE Id = @id
        `);

      // 5. Add to requester region row (or create if missing)
      const requesterBudget = (await tx.request()
        .input('rg', sql.NVarChar(60), requesterRegion)
        .input('y', sql.Int, bReq.PeriodYear)
        .input('br', sql.NVarChar(50), bReq.Brand)
        .input('it', sql.NVarChar(100), bReq.ItemName)
        .query(`
          SELECT Id, BudgetQty
          FROM wf.GiveawayBudget WITH (UPDLOCK, ROWLOCK)
          WHERE Region = @rg AND PeriodYear = @y AND Brand = @br AND ItemName = @it
        `)).recordset?.[0];

      if (requesterBudget) {
        await tx.request()
          .input('id', sql.Int, requesterBudget.Id)
          .input('qty', sql.Decimal(12, 2), borrowQty)
          .query(`
            UPDATE wf.GiveawayBudget
            SET BudgetQty = BudgetQty + @qty, UpdatedAt = GETUTCDATE()
            WHERE Id = @id
          `);
      } else {
        // Fetch requester info from AppUser
        const reqUser = (await tx.request()
          .input('uid', sql.Int, bReq.RequesterId)
          .query(`SELECT Id, EmpId FROM wf.AppUser WHERE Id = @uid`)).recordset?.[0];

        await tx.request()
          .input('su', sql.Int, bReq.RequesterId)
          .input('ei', sql.NVarChar(20), reqUser?.EmpId || null)
          .input('ec', sql.NVarChar(20), reqUser?.EmpId || null)
          .input('rg', sql.NVarChar(60), requesterRegion)
          .input('y', sql.Int, bReq.PeriodYear)
          .input('br', sql.NVarChar(50), bReq.Brand)
          .input('it', sql.NVarChar(100), bReq.ItemName)
          .input('qty', sql.Decimal(12, 2), borrowQty)
          .query(`
            INSERT INTO wf.GiveawayBudget (SalesUserId, EmpId, EmpCode, Region, PeriodYear, Brand, ItemName, BudgetQty)
            VALUES (@su, @ei, @ec, @rg, @y, @br, @it, @qty)
          `);
      }

      // 6. Mark borrow request as APPROVED
      const finalUpdate = await tx.request()
        .input('id', sql.Int, reqId)
        .input('u', sql.Int, req.user.id)
        .input('n', sql.NVarChar(500), note || null)
        .query(`
          UPDATE wf.GiveawayBorrowRequest
          SET Status = 'APPROVED', ApproverId = @u, Note = @n, ResolvedAt = GETUTCDATE()
          WHERE Id = @id AND Status = 'PENDING'
        `);

      if (!finalUpdate.rowsAffected?.[0]) {
        throw Object.assign(new Error('คำขอนี้ได้รับการดำเนินการไปแล้ว'), { status: 409 });
      }

      // R12 item 8: the quota move is part of the budget audit trail
      await logChangeEvent(tx, {
        entityType: 'GIVEAWAY_BUDGET',
        entityId: budgetKey(lenderRegion, bReq.PeriodYear, bReq.Brand, bReq.ItemName),
        action: 'BORROW_OUT',
        afterJson: { borrowRequestId: reqId, qty: borrowQty, toRegion: requesterRegion },
        reasonCode: 'GIVEAWAY_BORROW',
        reasonText: note || null,
        userId: String(req.user.sub),
        ipAddress: req.ip,
      });
      await logChangeEvent(tx, {
        entityType: 'GIVEAWAY_BUDGET',
        entityId: budgetKey(requesterRegion, bReq.PeriodYear, bReq.Brand, bReq.ItemName),
        action: 'BORROW_IN',
        afterJson: { borrowRequestId: reqId, qty: borrowQty, fromRegion: lenderRegion },
        reasonCode: 'GIVEAWAY_BORROW',
        reasonText: note || null,
        userId: String(req.user.sub),
        ipAddress: req.ip,
      });
    });

    res.json({ ok: true, status: 'APPROVED' });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    console.error('[giveaway-borrow-resolve] error:', e);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอนุมัติคำขอยืมโควตา: ' + e.message });
  }
});

module.exports = router;
