'use strict';
const {sql,wfQuery}=require('../db');
const {enqueue}=require('./outbox');
const {advanceDocuNoCounter,readBookCounter,RUN_CODE_BY_PREFIX}=require('./winspeed-counter');
const {writeAudit,auditUser,SCREEN}=require('./winspeed-audit');
const {resolveApprovalPolicy}=require('./approval');
const {calculateConfirmationPickupDue,normalizeDateString,getBangkokDateString,diffBangkokCalendarDays}=require('./so-pickup-policy');
const {advanceAppliedClaimAtConfirm}=require('./rebate-claim-apply');
const {matchGiveawayItem,findMatchingQuota}=require('./giveaway-matcher');
const {linePieces}=require('./giveaway-quota');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function transactionQuery(tx) { return async (text,inputs={})=>{
  const r=new sql.Request(tx);for(const [k,{type,value}] of Object.entries(inputs))r.input(k,type,value);return r.query(text);
}; }
async function lockConfirmationResource(tx, resource) {
 const r=await tx.request().input('resource',sql.NVarChar(255),resource).query(`
 DECLARE @result INT;
 EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 SELECT @result AS LockResult;`);
 if (!(Number(r.recordset?.[0]?.LockResult)>=0)) fail('Confirmation lock unavailable',409);
}
// Caller owns the transaction. Trip lock precedes sorted draft locks on both entry paths.
async function confirmDraft({tx:confirmationTx,draftId,user,ip,expectedRevision,expectedTripId,explicitPickup,truckPlate}) {
 const req={user,ip}; const confirmationQuery=transactionQuery(confirmationTx);
 await lockConfirmationResource(confirmationTx,'ConfirmSO_'+draftId);
 let so=(await confirmationQuery('SELECT * FROM wf.SalesOrder WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id', {id:{type:sql.Int,value:Number(draftId)}})).recordset[0];
 if(!so || so.Status!=='DRAFT') fail('Draft already converted or unavailable',409);
 if(expectedTripId!==undefined && Number(so.TripId||0)!==Number(expectedTripId||0)) fail('Trip membership changed; reload',409);
 if(expectedRevision!==undefined && Number(so.DocumentRevision)!==Number(expectedRevision)) fail('SO revision changed; reload',409);
 if(user.role==='SALES' && Number(so.SalesUserId)!==Number(user.sub)) fail('Cannot confirm another salesperson document',403);
 if(user.role!=='ADMIN' && !so.VerifiedAt) fail('ต้องตรวจซ้ำ (Counter-Sales) ก่อนยืนยัน (FR-022)');
 const isControlTicket = Boolean(so.IsControlTicket) || so.TruckPlate === 'ตั๋วคุม' || so.SoPrefix === 'AI';
 const isNoTruck = Boolean(so.NoTruckRequired) || isControlTicket;
 if (isControlTicket) {
   so.TruckPlate = 'ตั๋วคุม';
   so.NoTruckRequired = 1;
   await confirmationQuery('UPDATE wf.SalesOrder SET NoTruckRequired = 1, TruckPlate = @plate WHERE Id = @id', {
     plate: { type: sql.NVarChar(30), value: 'ตั๋วคุม' },
     id: { type: sql.Int, value: so.Id }
   });
 } else {
   const rawPlate = String(truckPlate === undefined ? so.TruckPlate || '' : truckPlate || '').trim();
   const cleanPlate = rawPlate && !['ยังไม่ระบุรถ', 'ไม่ระบุทะเบียนรถ', 'ตั๋วคุม'].includes(rawPlate) ? rawPlate : null;
   so.TruckPlate = cleanPlate;
   await confirmationQuery('UPDATE wf.SalesOrder SET TruckPlate = @plate WHERE Id = @id', {
     plate: { type: sql.NVarChar(30), value: so.TruckPlate },
     id: { type: sql.Int, value: so.Id }
   });
 }
 if (!so.TruckPlate && !isNoTruck) fail('ต้องระบุทะเบียนรถหรือไม่ใช้รถก่อนยืนยัน');
 const approvals=(await confirmationQuery('SELECT Status,DocumentRevision FROM wf.PriceApproval WITH (UPDLOCK,HOLDLOCK) WHERE SoId=@id',{id:{type:sql.Int,value:so.Id}})).recordset;
 if(so.RequiresPriceApproval && (so.PriceApprovalStatus!=='APPROVED' || approvals.some(a=>a.Status==='PENDING') || !approvals.some(a=>a.Status==='APPROVED' && Number(a.DocumentRevision)===Number(so.DocumentRevision))))fail('การอนุมัติราคาไม่ครบหรือไม่ตรง revision');
 const quote=(await confirmationQuery(`SELECT TOP 1 q.Id FROM wf.QuotationSourceSO src JOIN wf.Quotation q ON q.Id=src.QuoteId
 WHERE src.SoId=@id AND q.Status IN ('DRAFT','SENT','EXPIRED') AND NOT EXISTS
 (SELECT 1 FROM wf.QuotationSourceSO a JOIN wf.Quotation aq ON aq.Id=a.QuoteId WHERE a.SoId=@id AND aq.Status='ACCEPTED')`,{id:{type:sql.Int,value:so.Id}})).recordset[0];
 if(quote)fail('ต้องยืนยันใบเสนอราคาก่อน');
 const lines=(await confirmationQuery('SELECT * FROM wf.SalesOrderLine WITH (UPDLOCK,HOLDLOCK) WHERE SoId=@id ORDER BY LineNum',{id:{type:sql.Int,value:so.Id}})).recordset;
 if(!lines.length)fail('ไม่พบรายการสินค้า');
 if(lines.some(l=>l.IsGiveaway && l.GiveawayApprovalStatus!=='APPROVED'))fail('ของแถมยังไม่ได้รับอนุมัติ');
 const credit=(await confirmationQuery('SELECT CreditHold FROM wf.CreditMaster WITH (UPDLOCK,HOLDLOCK) WHERE CustId=@c',{c:{type:sql.NVarChar(20),value:String(so.CustId)}})).recordset[0];
 if(credit?.CreditHold) {const policy=await resolveApprovalPolicy('CREDIT_OVERRIDE');if(user.role!=='ADMIN' && user.role!==policy?.RequiredRole)fail('ลูกค้าถูกระงับเครดิต ต้องอนุมัติก่อน');}
 const collision=(await confirmationQuery('SELECT TOP 1 SOID FROM dbo.SOHD WHERE DocuType=103 AND DocuNo=@ref',{ref:{type:sql.NVarChar(30),value:so.WfRef}})).recordset[0];
 // R12 K-F1: WINSpeed may have issued this number since the draft was saved (its counter passed it)
 const counterPassed=await bookCounterPassed(confirmationQuery,so.SoPrefix,so.WfRef);
 if(collision || counterPassed) {
   const previous=so.WfRef;so.WfRef=await allocateWorkflowRef(confirmationTx,so.SoPrefix);
   await confirmationQuery('UPDATE wf.SalesOrder SET WfRef=@ref,UpdatedAt=GETUTCDATE() WHERE Id=@id',{ref:{type:sql.NVarChar(30),value:so.WfRef},id:{type:sql.Int,value:so.Id}});
   await audit(confirmationTx,so.Id,user.sub,'WFREF_REASSIGNED','DRAFT','DRAFT',previous+' -> '+so.WfRef,ip);
 }
 const pickupResult=await calculateConfirmationPickupDue({explicitDate:explicitPickup || (so.PickupDueType==='EXPLICIT' ? normalizeDateString(so.PickupDueDate,{isWallClock:true}) : null),confirmedAt:new Date()});
 if(pickupResult.policy.strictMode && diffBangkokCalendarDays(pickupResult.pickupDueDate,getBangkokDateString())<0)fail('ไม่อนุญาตวันรับสินค้าในอดีต (Strict Mode)');
 const rebateDiscountAmt=Number(so.RebateDiscountAmt)||0;

 // R9-1: Reject if total discount exceeds bill subtotal
 const billSubtotal = lines.reduce((sum, l) => sum + (l.IsGiveaway ? 0 : Number(l.QtyTon || 0) * Number(l.PricePerTon || 0)), 0);
 if (rebateDiscountAmt > billSubtotal) {
   fail(`ยอดส่วนลด Rebate (฿${rebateDiscountAmt.toLocaleString()}) เกินมูลค่าสินค้าในบิล (฿${billSubtotal.toLocaleString()})`, 400);
 }
 let newSoid=null;
      // 1. Persist pickup due date to draft before conversion
      await confirmationQuery(`
        UPDATE wf.SalesOrder
        SET PickupDueDate = @pDueDate,
            PickupDueType = @pDueType,
            ConfirmedAt = @confirmedAt,
            PickupPolicySnapshotId = @pSnapId
        WHERE Id = @soId
      `, {
        soId: { type: sql.Int, value: so.Id },
        pDueDate: { type: sql.Date, value: pickupResult.pickupDueDate ? new Date(pickupResult.pickupDueDate) : null },
        pDueType: { type: sql.VarChar(20), value: pickupResult.pickupDueType },
        confirmedAt: { type: sql.DateTime2, value: pickupResult.confirmedAt },
        pSnapId: { type: sql.Int, value: pickupResult.pickupPolicySnapshotId },
      });

      // 2. เรียก Stored Procedure เพื่อย้ายข้อมูลจาก wf.SalesOrder ไป SOHD (Winspeed)
      const spReq = new sql.Request(confirmationTx);
      spReq.input('SoId', sql.Int, so.Id);
      spReq.output('NewSoid', sql.VarChar(50));
      const spRes = await spReq.execute('wf.sp_ConfirmSalesOrder');
      
      newSoid = spRes.output.NewSoid;
      if (!newSoid) throw new Error('ย้ายข้อมูลไปยัง Winspeed ไม่สำเร็จ (ไม่ได้ SOID กลับมา)');

      // 3. Ensure native SO preserves PickupDueDate, PickupDueType, ConfirmedAt, PickupPolicySnapshotId, NoTruckRequired (SO-03, C1)
      // R9-8: Remove redundant UPDATE dbo.SOHD SET TransRegistration (sp_ConfirmSalesOrder already wrote the plate)
      await confirmationQuery(`
        UPDATE wf.SalesOrderExt
        SET SourceDraftId = @sourceDraftId,
            PickupDueDate = @pDueDate,
            PickupDueType = @pDueType,
            ConfirmedAt = @confirmedAt,
            PickupPolicySnapshotId = @pSnapId,
            NoTruckRequired = @noTruckRequired,
            AppliedRebateClaimId = @appliedRebateClaimId,
            ClaimDiscountAmt = @claimDiscountAmt,
            UpdatedAt = GETUTCDATE()
        WHERE SOID = @newSoid;
      `, {
        newSoid: { type: sql.VarChar(50), value: String(newSoid) },
        sourceDraftId: {type:sql.Int,value:so.Id},
        pDueDate: { type: sql.Date, value: pickupResult.pickupDueDate ? new Date(pickupResult.pickupDueDate) : null },
        pDueType: { type: sql.VarChar(20), value: pickupResult.pickupDueType },
        confirmedAt: { type: sql.DateTime2, value: pickupResult.confirmedAt },
        pSnapId: { type: sql.Int, value: pickupResult.pickupPolicySnapshotId },
        noTruckRequired: { type: sql.Bit, value: isControlTicket ? 1 : (so.NoTruckRequired ? 1 : 0) },
        appliedRebateClaimId: { type: sql.Int, value: so.AppliedRebateClaimId ? Number(so.AppliedRebateClaimId) : null },
        claimDiscountAmt: { type: sql.Decimal(12, 2), value: Number(so.ClaimDiscountAmt || 0) }
      });

      // 4. Carry over coupon reservations from draft SO to confirmed native SOID
      await confirmationQuery(`
        UPDATE wf.CouponReservation
        SET CarrierSoId = @newSoid,
            CarrierDocuNo = @wfRef,
            UpdatedAt = GETUTCDATE()
        WHERE CarrierSoId = @oldSoId
      `, {
        newSoid: { type: sql.VarChar(50), value: String(newSoid) },
        oldSoId: { type: sql.VarChar(50), value: String(so.Id) },
        wfRef: {type:sql.VarChar(50),value:so.WfRef}
      });


    // ตั๋วปุ๋ยไม่ได้ออกที่ขั้นนี้ — sp_ConfirmSalesOrder สร้างใบสั่งจอง (103)
    // และตั๋วผูกกับใบส่งขาย (104) เท่านั้น (111,210 แถวในระบบเป็น 104 ล้วน
    // ส่วนใบสั่งจองจริง 61,439 ใบเป็น CouponFlag='N' ทุกใบ ซึ่งถูกต้องแล้ว)
    // ใบส่งขายกับตั๋วเกิดตอนเจ้าหน้าที่เปิดเอกสารต่อใน WINSpeed · ดู 098/099

    if (true) {
      await confirmationQuery(`
        UPDATE q
        SET q.Status = 'CONVERTED',
            q.ConvertedSoId = COALESCE(q.ConvertedSoId, @sourceSoId),
            q.UpdatedAt = GETUTCDATE()
        FROM wf.Quotation q
        WHERE q.Status = 'ACCEPTED'
          AND EXISTS (
            SELECT 1
            FROM wf.QuotationSourceSO src
            WHERE src.QuoteId = q.Id
              AND src.SoId = @sourceSoId
          )
          AND NOT EXISTS (
            SELECT 1
            FROM wf.QuotationSourceSO src
            LEFT JOIN wf.SalesOrder draftSo ON draftSo.Id = src.SoId
            WHERE src.QuoteId = q.Id
              AND draftSo.Status = 'DRAFT'
          )
      `, { sourceSoId: { type: sql.Int, value: so.Id } });
    }

    // 2. (Moved to SHIPPED) ตั้ง Rebate accrual
    // await bookRebateAccrual({ ...so, Id: newSoid }, lines, req.user.sub);

    // R9-1: Separate claim-sourced amount from ledger-sourced "เบิก Rebate มาใช้" amount
    const claimDiscountAmt = Number(so.ClaimDiscountAmt || 0);
    const ledgerDiscountToConsume = Math.max(0, rebateDiscountAmt - claimDiscountAmt);

    // 2.5 Consume Rebate (FIFO) - only for the ledger portion to avoid double deduction!
    if (ledgerDiscountToConsume > 0) {
      await consumeRebateAccrual(so.CustId, newSoid, ledgerDiscountToConsume, confirmationQuery);
    }

    // 2.6 Advance applied rebate claim status to CN_ISSUED (R10-2, R10.1-1: Fail closed if unverified; wf.RebateClaim has no UpdatedAt)
    // L-3: Set RemainingAmt = 0, store WinSpeed DocuNo (e.g. I69-04233) in AppliedSoDocuNo, and append SOID in Note
    const appliedClaimId = so.AppliedRebateClaimId ? Number(so.AppliedRebateClaimId) : null;
    if (appliedClaimId) {
      const docR = await confirmationQuery(`SELECT DocuNo FROM dbo.SOHD WHERE SOID = @soid`, {
        soid: { type: sql.VarChar(50), value: String(newSoid) }
      });
      const resolvedDocuNo = docR.recordset?.[0]?.DocuNo || so.WfRef || String(newSoid);

      await advanceAppliedClaimAtConfirm(confirmationQuery, {
        claimId: appliedClaimId,
        draftId: so.Id,
        custId: String(so.CustId),
        docuNo: resolvedDocuNo,
        soid: newSoid
      });
    }

    // 2.7 Auto-deduct Giveaway Quota (FR-AutoDeduct, U-4, U-5)
    const giveawayLines = lines.filter(l => l.IsGiveaway || l.isGiveaway);
    const targetSalesUserId = so.SalesUserId || req.user.sub;
    for (const gl of giveawayLines) {
      let mapBrand = null;
      let mapItem = null;
      try {
        const mapRows = (await confirmationQuery(`
          SELECT Brand, ItemName FROM wf.GiveawayItemMapping 
          WHERE GoodID = @g AND ISNUMERIC(Brand) = 0 AND ItemName NOT IN (N'รถเกษตร', N'ปุ๋ยเทพ')
          ORDER BY Id ASC
        `, { g: { type: sql.VarChar(50), value: String(gl.GoodId || gl.goodId) } })).recordset;
        if (mapRows && mapRows.length > 0) {
          mapBrand = mapRows[0].Brand;
          mapItem = mapRows[0].ItemName;
        }
      } catch {}

      const matched = matchGiveawayItem({
        goodId: gl.GoodId || gl.goodId,
        goodName: gl.GoodName || gl.goodName,
        brand: mapBrand,
        itemName: mapItem
      });

      let y = new Date().getFullYear();
      if (y < 2500) y += 543;
      let regRow = (await confirmationQuery(`SELECT TOP 1 Region, EmpId, EmpCode FROM wf.GiveawayBudget WHERE SalesUserId=@su AND PeriodYear=@y`, { su: { type: sql.Int, value: targetSalesUserId }, y: { type: sql.Int, value: y } })).recordset[0];
      if (!regRow && req.user.sub) {
        regRow = (await confirmationQuery(`SELECT TOP 1 Region, EmpId, EmpCode FROM wf.GiveawayBudget WHERE SalesUserId=@su AND PeriodYear=@y`, { su: { type: sql.Int, value: req.user.sub }, y: { type: sql.Int, value: y } })).recordset[0];
      }
      if (regRow) {
        // U-4: เขียนชื่อตรา/รายการตามบรรทัดงบจริงของภาค เพื่อให้ยอดเบิกตัดงบบรรทัดเดียวกับที่ตรวจโควต้า
        const budgetRows = (await confirmationQuery(
          `SELECT Region, Brand, ItemName FROM wf.GiveawayBudget WHERE Region=@rg AND PeriodYear=@y`,
          { rg: { type: sql.NVarChar(60), value: regRow.Region }, y: { type: sql.Int, value: y } }
        )).recordset || [];
        const budgetLine = findMatchingQuota({ goodId: gl.GoodId || gl.goodId, goodName: gl.GoodName || gl.goodName, brand: mapBrand, itemName: mapItem }, budgetRows);
        if (budgetLine) { matched.brand = budgetLine.Brand; matched.itemName = budgetLine.ItemName; }
        // U-4 / U-5: Quantity in PIECES
        const pieceQty = linePieces(gl);
        await confirmationQuery(`
          INSERT INTO wf.GiveawayWithdrawal (SalesUserId, EmpId, EmpCode, Region, PeriodYear, IssueMonth, Brand, ItemName, Qty, CustId, SoId, Note, Source)
          VALUES (@su, @ei, @ec, @rg, @y, @mo, @br, @it, @qy, @cu, @so, @nt, 'APP')
        `, {
          su: { type: sql.Int, value: targetSalesUserId },
          ei: { type: sql.NVarChar(20), value: regRow.EmpId || null },
          ec: { type: sql.NVarChar(20), value: regRow.EmpCode || null },
          rg: { type: sql.NVarChar(60), value: regRow.Region },
          y: { type: sql.Int, value: y },
          mo: { type: sql.Int, value: new Date().getMonth() + 1 },
          br: { type: sql.NVarChar(50), value: matched.brand },
          it: { type: sql.NVarChar(100), value: matched.itemName },
          qy: { type: sql.Decimal(12,2), value: pieceQty },
          cu: { type: sql.NVarChar(20), value: so.CustId ? String(so.CustId) : null },
          so: { type: sql.Int, value: Number(newSoid) },
          nt: { type: sql.NVarChar(300), value: `ตัดโควต้าอัตโนมัติจากบิล ${so.WfRef || so.Id}` }
        });
      }
    }

    // 3. Audit log (บันทึกโดยใช้ newSoid)
    await audit(confirmationTx, newSoid, req.user.sub, 'CONFIRMED', 'DRAFT', 'CONFIRMED', null, req.ip);
    
    // ยกเลิก 03/09/2569 — ไม่ผลักใบชั่งล่วงหน้าเข้า MySQL อีกแล้ว
    // insertPreWeighTicket(so).catch(err => console.error('[truckscale] Push error:', err));
    
    // เดินตัวนับของ WINSpeed ให้ทันเลขที่แอปเพิ่งออกไป ไม่งั้นหน้าจอ WINSpeed
    // จะเสนอเลขที่ถูกใช้ไปแล้วให้พนักงานคนถัดไป
    await advanceDocuNoCounter(so.WfRef, {query: confirmationQuery, strict: true});

    // ขั้นนี้สร้างแถวใหม่ใน dbo.SOHD ผ่าน sp_ConfirmSalesOrder — เอกสารที่โผล่ใน
    // WINSpeed โดยไม่มีรอยว่าใครสร้าง คือสิ่งที่ผู้ตรวจถามหาเป็นอันดับแรก
    await writeAudit({ screen: SCREEN.SO_CONFIRM, action: 'I', docuNo: so.WfRef,
      docuDate: so.DeliveryDate || new Date(), refId: newSoid, username: auditUser(req.user),
      note: `ยืนยันใบสั่งขายจากแอป (ลูกค้า ${so.CustId})` }, {query: confirmationQuery, strict: true});

    // FR-029 outbox: reliable integration event (idempotent ต่อ SO)
    await enqueue('SO_CONFIRMED', newSoid, { soId: newSoid, custId: so.CustId, by: req.user.sub }, `SO_CONFIRMED:${newSoid}`, {query: confirmationQuery, strict: true});
    return ({
      id: newSoid,
      status: 'CONFIRMED',
      pickupDueDate: pickupResult.pickupDueDate,
      pickupDueType: pickupResult.pickupDueType,
      confirmedAt: pickupResult.confirmedAt,
      pickupPolicySnapshotId: pickupResult.pickupPolicySnapshotId,
    });

}

async function allocateWorkflowRef(tx, soPrefix) {
  const yy = (new Date().getFullYear() + 543 - 2500).toString().slice(-2);
  const prefixYear = `${soPrefix}${yy}`;
  // UPDLOCK + HOLDLOCK บน wf.SalesOrder ทำให้คำขอที่เข้ามาพร้อมกันเข้าคิวกัน
  // ตัวที่สองจะรอจนตัวแรก commit แล้วจึงเห็นแถวใหม่และคำนวณ MAX ได้ถูก
  // dbo.SOHD อ่านด้วย NOLOCK เท่านั้น — ห้ามล็อกตารางของ WINSpeed
  const maxResult = await tx.request()
    .input('prefixYear', sql.NVarChar(10), prefixYear)
    .query(`
      SELECT ISNULL(MAX(RefSuffix), 0) AS MaxSuffix
      FROM (
        SELECT CASE
          WHEN SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20) NOT LIKE '%[^0-9]%'
           AND SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20) <> ''
           AND LEN(SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20)) <= 15
          THEN CONVERT(BIGINT, SUBSTRING(WfRef, LEN(@prefixYear) + 2, 20))
        END AS RefSuffix
        FROM wf.SalesOrder WITH (UPDLOCK, HOLDLOCK)
        WHERE WfRef LIKE @prefixYear + '-%'
        UNION ALL
        SELECT CASE
          WHEN SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20) NOT LIKE '%[^0-9]%'
           AND SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20) <> ''
           AND LEN(SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20)) <= 15
          THEN CONVERT(BIGINT, SUBSTRING(DocuNo, LEN(@prefixYear) + 2, 20))
        END AS RefSuffix
        FROM dbo.SOHD WITH (NOLOCK)
        WHERE DocuType = 103 AND DocuNo LIKE @prefixYear + '-%'
      ) refs
      WHERE RefSuffix IS NOT NULL;
    `);
  // เดินทีละหนึ่ง
  //
  // เดิมเป็น MAX + NEXT VALUE FOR wf.WfRefSeq ซึ่ง WfRefSeq เป็นตัวนับที่โตขึ้นเรื่อย ๆ
  // ไม่เคยรีเซ็ต ผลคือช่องว่างของเลขที่เอกสาร **ขยายแบบทวีคูณ** เพราะเลขที่เพิ่งจอง
  // กลายเป็น MAX ของรอบถัดไป แล้วถูกบวกด้วยค่าลำดับที่โตขึ้นอีก
  //
  //   วัดจริงบน UAT — เริ่มที่ I69-02422 สร้างสามใบติดกันได้
  //     I69-02425 · I69-02428 · I69-02432
  //   สามใบกินเลขไป 10 หมายเลข ข้ามทิ้ง 7 หมายเลข
  //
  // เลขที่เอกสารขายเป็นหลักฐานทางภาษี ช่องว่างต้องอธิบายได้เสมอว่าหายไปไหน
  // ความปลอดภัยจากการชนกันมาจาก unique index บน WfRef คู่กับการล็อกด้านบน
  // ไม่ใช่จากการเว้นช่วงเลขทิ้งไว้
  // R12 K-F1: WINSpeed's own counter for this prefix (I or K, whichever table holds it now)
  // is the third source, so the app never issues a number WINSpeed already gave out
  const runQuery = (text, inputs = {}) => {
    const r = tx.request();
    for (const [k, v] of Object.entries(inputs)) r.input(k, v.type, v.value);
    return r.query(text);
  };
  const counterSuffix = await bookCounterSuffix(runQuery, soPrefix, prefixYear);
  const nextSuffix = Math.max(Number(maxResult.recordset?.[0]?.MaxSuffix || 0), counterSuffix) + 1;
  return `${prefixYear}-${String(nextSuffix).padStart(5, '0')}`;
}

async function bookCounterSuffix(queryFn, soPrefix, prefixYear) {
  const runCode = RUN_CODE_BY_PREFIX[String(soPrefix || '').slice(0, 1)];
  if (!runCode) return 0;
  try {
    const { lastNo } = await readBookCounter(queryFn, runCode, soPrefix);
    const m = new RegExp(`^${prefixYear}-(\\d{5})$`).exec(String(lastNo || ''));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

async function bookCounterPassed(queryFn, soPrefix, wfRef) {
  const ref = String(wfRef || '');
  const m = /^([IK]\d{2})-(\d{5})$/.exec(ref);
  if (!m) return false;
  return (await bookCounterSuffix(queryFn, soPrefix, m[1])) >= Number(m[2]);
}

async function audit(tx, soId, userId, action, fromStatus, toStatus, note, ipAddress) {
  // R12 item 4: record the Access As actor next to the effective user (column from migration 144)
  const { currentActorId, hasColumn } = require('./request-context');
  const withActor = await hasColumn(wfQuery, 'wf.SalesOrderAudit', 'ActorUserId');
  const sqlStr = withActor ? `
    INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress, ActorUserId)
    VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip, @actorUserId)
  ` : `
    INSERT INTO wf.SalesOrderAudit (SoId, UserId, Action, FromStatus, ToStatus, Note, IpAddress)
    VALUES (@soId, @userId, @action, @fromStatus, @toStatus, @note, @ip)
  `;
  const params = {
    ...(withActor ? { actorUserId: { type: sql.Int, value: currentActorId() ?? userId } } : {}),
    soId:       { type: sql.VarChar(50),  value: String(soId) },
    userId:     { type: sql.Int,          value: userId },
    action:     { type: sql.NVarChar(50), value: action },
    fromStatus: { type: sql.NVarChar(20), value: fromStatus || null },
    toStatus:   { type: sql.NVarChar(20), value: toStatus || null },
    note:       { type: sql.NVarChar(500),value: note || null },
    ip:         { type: sql.NVarChar(45), value: ipAddress || null },
  };

  if (tx && typeof tx.request === 'function') {
    const req = tx.request();
    for (const [k, { type, value }] of Object.entries(params)) req.input(k, type, value);
    await req.query(sqlStr);
  } else {
    await wfQuery(sqlStr, params);
  }
}

async function consumeRebateAccrual(custId, newSoid, rebateDiscountAmt, queryFn = wfQuery) {
  if (!rebateDiscountAmt || rebateDiscountAmt <= 0) return;
  let remainingToDeduct = Number(rebateDiscountAmt);

  const ledgersR = await queryFn(
    `SELECT Id, RemainingAmt FROM wf.RebateLedger WITH (UPDLOCK,HOLDLOCK) 
     WHERE CustId = @custId AND Status = 'PENDING' AND RemainingAmt > 0 AND ReversedFlag = 0 
     ORDER BY CreatedAt ASC`,
    { custId: { type: sql.VarChar(20), value: String(custId || '') } }
  );

  const availableCents = ledgersR.recordset.reduce((sum,row) => sum + Math.round(Number(row.RemainingAmt)*100),0);
  if (availableCents < Math.round(remainingToDeduct*100)) {
    const error = new Error('ยอด Rebate คงเหลือไม่เพียงพอ');
    error.status = 409;
    throw error;
  }
  for (const ledger of ledgersR.recordset) {
    if (remainingToDeduct <= 0) break;
    
    const deduct = Math.min(remainingToDeduct, Number(ledger.RemainingAmt));
    remainingToDeduct -= deduct;
    
    await queryFn(
      `UPDATE wf.RebateLedger 
       SET RemainingAmt = RemainingAmt - @deduct,
           Status = CASE WHEN RemainingAmt - @deduct <= 0 THEN 'CLAIMED' ELSE Status END
       WHERE Id = @id`,
      { deduct: { type: sql.Decimal(12,2), value: deduct }, id: { type: sql.Int, value: ledger.Id } }
    );
    
    await queryFn(
      `INSERT INTO wf.RebateUsage (LedgerId, AppliedSOID, DeductedAmt) VALUES (@ledgerId, @soid, @deduct)`,
      { ledgerId: { type: sql.Int, value: ledger.Id }, soid: { type: sql.VarChar(50), value: newSoid }, deduct: { type: sql.Decimal(12,2), value: deduct } }
    );
  }
}


module.exports={confirmDraft,lockConfirmationResource,allocateWorkflowRef,consumeRebateAccrual,advanceAppliedClaimAtConfirm};
