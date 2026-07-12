const fs = require('fs');
let code = fs.readFileSync('routes/so.js', 'utf8');

// 1. POST extract
code = code.replace(
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt, convertFromQuoteId } = order;',
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, salesUserId: impersonatedId, rebateDiscountAmt, convertFromQuoteId, creditDays, truckRemark, billRemark } = order;'
);

// 2. POST SO insert
code = code.replace(
  `soReq.input('salesUserId',      sql.Int,           actualSalesUserId);

        const soR = await soReq.query(\`
          INSERT INTO wf.SalesOrder
            (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, RequestedAt, IsOwnTruck, NoTruckRequired, PSling, Remark, SalesUserId, RebateDiscountAmt, Status)
            OUTPUT inserted.Id
          VALUES (@wfRef, @soPrefix, @custId, @custName, @truckPlate, @controlTicketNo, @deliveryDate, @requestedAt, @isOwnTruck, @noTruckRequired, @pSling, @remark, @salesUserId, @rebateDiscountAmt, 'DRAFT')
        \`);`,
  `soReq.input('salesUserId',      sql.Int,           actualSalesUserId);
        soReq.input('creditDays',       sql.Int,           creditDays != null ? Number(creditDays) : null);
        soReq.input('truckRemark',      sql.NVarChar(500), truckRemark || null);
        soReq.input('billRemark',       sql.NVarChar(500), billRemark || null);

        const soR = await soReq.query(\`
          INSERT INTO wf.SalesOrder
            (WfRef, SoPrefix, CustId, CustName, TruckPlate, ControlTicketNo, DeliveryDate, RequestedAt, IsOwnTruck, NoTruckRequired, PSling, Remark, SalesUserId, RebateDiscountAmt, Status, CreditDays, TruckRemark, BillRemark)
            OUTPUT inserted.Id
          VALUES (@wfRef, @soPrefix, @custId, @custName, @truckPlate, @controlTicketNo, @deliveryDate, @requestedAt, @isOwnTruck, @noTruckRequired, @pSling, @remark, @salesUserId, @rebateDiscountAmt, 'DRAFT', @creditDays, @truckRemark, @billRemark)
        \`);`
);

// 3. POST SOLine insert
code = code.replace(
  `lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
          
          await lr.query(\`
            INSERT INTO wf.SalesOrderLine
              (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn\${giveawayApprovalInsertValues(hasGiveawayApproval)})
          \`);`,
  `lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
          lr.input('loadSequence',         sql.Int,           l.loadSequence != null ? Number(l.loadSequence) : null);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
          
          await lr.query(\`
            INSERT INTO wf.SalesOrderLine
              (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn, LoadSequence\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn, @loadSequence\${giveawayApprovalInsertValues(hasGiveawayApproval)})
          \`);`
);

// 4. PUT extract (SOHD)
code = code.replace(
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt } = order;',
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark } = order;'
);

// 5. PUT SOHD update
code = code.replace(
  `soReq.input('netAmnt', sql.Decimal(18,2), totalAmnt);

        await soReq.query(\`
          UPDATE dbo.SOHD SET CustID=@custId, CustName=@custName, TransRegistration=@truckPlate, Remark=@remark, NetAmnt=@netAmnt WHERE SOID=@id;
          UPDATE wf.SalesOrderExt
          SET SoPrefix=@soPrefix,
              ControlTicketNo=@controlTicketNo,
              DeliveryDate=@deliveryDate,
              RequestedAt=@requestedAt,
              IsOwnTruck=@isOwnTruck,
              NoTruckRequired=@noTruckRequired,
              PSling=@pSling,
              RebateDiscountAmt=@rebateDiscountAmt,
              UpdatedAt=GETUTCDATE()
          WHERE SOID=@id;
        \`);`,
  `soReq.input('netAmnt', sql.Decimal(18,2), totalAmnt);
        soReq.input('creditDays', sql.Int, creditDays != null ? Number(creditDays) : null);
        soReq.input('truckRemark', sql.NVarChar(500), truckRemark || null);
        soReq.input('billRemark', sql.NVarChar(500), billRemark || null);

        await soReq.query(\`
          UPDATE dbo.SOHD SET CustID=@custId, CustName=@custName, TransRegistration=@truckPlate, Remark=@remark, NetAmnt=@netAmnt, CreditDays=@creditDays, Desc1=@truckRemark, Desc2=@billRemark WHERE SOID=@id;
          UPDATE wf.SalesOrderExt
          SET SoPrefix=@soPrefix,
              ControlTicketNo=@controlTicketNo,
              DeliveryDate=@deliveryDate,
              RequestedAt=@requestedAt,
              IsOwnTruck=@isOwnTruck,
              NoTruckRequired=@noTruckRequired,
              PSling=@pSling,
              RebateDiscountAmt=@rebateDiscountAmt,
              CreditDays=@creditDays,
              TruckRemark=@truckRemark,
              BillRemark=@billRemark,
              UpdatedAt=GETUTCDATE()
          WHERE SOID=@id;
        \`);`
);

// 6. PUT SOLineExt insert
code = code.replace(
  `lr.input('isControlTicketDrawn', sql.Bit, l.isControlTicketDrawn ? 1 : 0);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);`,
  `lr.input('isControlTicketDrawn', sql.Bit, l.isControlTicketDrawn ? 1 : 0);
          lr.input('loadSequence', sql.Int, l.loadSequence != null ? Number(l.loadSequence) : null);
          addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);`
);
code = code.replace(
  `INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, RefControlTicketNo, IsControlTicketDrawn\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @netPricePerTon, @isGiveaway, 0, @refControlTicketNo, @isControlTicketDrawn\${giveawayApprovalInsertValues(hasGiveawayApproval)});`,
  `INSERT INTO wf.SalesOrderLineExt (SOID, ListNo, NetPricePerTon, IsGiveaway, RebateBooked, LoadSequence, RefControlTicketNo, IsControlTicketDrawn\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
            VALUES (@soId, @lineNum, @netPricePerTon, @isGiveaway, 0, @loadSequence, @refControlTicketNo, @isControlTicketDrawn\${giveawayApprovalInsertValues(hasGiveawayApproval)});`
);

// 7. PUT extract (DRAFT)
code = code.replace(
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt } = order;',
  'const { soPrefix, custId, custName, truckPlate, controlTicketNo, deliveryDate, requestedAt, isOwnTruck, noTruckRequired, pSling, remark, lines, rebateDiscountAmt, creditDays, truckRemark, billRemark } = order;'
);

// 8. PUT DRAFT SO update
code = code.replace(
  `soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));

      await soReq.query(\`
        UPDATE wf.SalesOrder SET
          SoPrefix = @soPrefix,
          WfRef = @wfRef,
          CustId = @custId,
          CustName = @custName,
          TruckPlate = @truckPlate,
          ControlTicketNo = @controlTicketNo,
          DeliveryDate = @deliveryDate,
          RequestedAt = @requestedAt,
          IsOwnTruck = @isOwnTruck,
          NoTruckRequired = @noTruckRequired,
          PSling = @pSling,
          Remark = @remark,
          RebateDiscountAmt = @rebateDiscountAmt,
          UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      \`);`,
  `soReq.input('rebateDiscountAmt', sql.Decimal(12,2), normalizeRebateDiscount(req, rebateDiscountAmt));
      soReq.input('creditDays', sql.Int, creditDays != null ? Number(creditDays) : null);
      soReq.input('truckRemark', sql.NVarChar(500), truckRemark || null);
      soReq.input('billRemark', sql.NVarChar(500), billRemark || null);

      await soReq.query(\`
        UPDATE wf.SalesOrder SET
          SoPrefix = @soPrefix,
          WfRef = @wfRef,
          CustId = @custId,
          CustName = @custName,
          TruckPlate = @truckPlate,
          ControlTicketNo = @controlTicketNo,
          DeliveryDate = @deliveryDate,
          RequestedAt = @requestedAt,
          IsOwnTruck = @isOwnTruck,
          NoTruckRequired = @noTruckRequired,
          PSling = @pSling,
          Remark = @remark,
          RebateDiscountAmt = @rebateDiscountAmt,
          CreditDays = @creditDays,
          TruckRemark = @truckRemark,
          BillRemark = @billRemark,
          UpdatedAt = GETUTCDATE()
        WHERE Id = @id
      \`);`
);

// 9. PUT DRAFT SOLine insert
code = code.replace(
  `lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
        addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
        
        await lr.query(\`
          INSERT INTO wf.SalesOrderLine
            (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
          VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn\${giveawayApprovalInsertValues(hasGiveawayApproval)})
        \`);`,
  `lr.input('isControlTicketDrawn', sql.Bit,           l.isControlTicketDrawn ? 1 : 0);
        lr.input('loadSequence',         sql.Int,           l.loadSequence != null ? Number(l.loadSequence) : null);
        addGiveawayApprovalInputs(lr, req, l, hasGiveawayApproval);
        
        await lr.query(\`
          INSERT INTO wf.SalesOrderLine
            (SoId, LineNum, GoodId, GoodName, GoodCode, QtyTon, QtyBag, PricePerTon, NetPricePerTon, IsGiveaway, RefControlTicketNo, IsControlTicketDrawn, LoadSequence\${giveawayApprovalInsertColumns(hasGiveawayApproval)})
          VALUES (@soId, @lineNum, @goodId, @goodName, @goodCode, @qtyTon, @qtyBag, @pricePerTon, @netPricePerTon, @isGiveaway, @refControlTicketNo, @isControlTicketDrawn, @loadSequence\${giveawayApprovalInsertValues(hasGiveawayApproval)})
        \`);`
);

fs.writeFileSync('routes/so.js', code, 'utf8');
console.log('so.js patched successfully');
