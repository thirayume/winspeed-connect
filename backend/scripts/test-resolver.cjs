'use strict';
const db = require('../db');
const { resolveNativeDocumentChain, detectReferenceCandidates } = require('../services/native-document-resolver');

(async () => {
  await db.runWithTarget('remote_b', async () => {
    console.log('--- Test 1: Booking DocuNo I69-04068 ---');
    const r1 = await resolveNativeDocumentChain({ reference: 'I69-04068' });
    console.log('r1 resolved:', r1.resolved, 'bookings:', r1.chain?.bookings.length, 'deliveries:', r1.chain?.deliveries.length, 'coupons:', r1.chain?.coupons.length);
    console.log('r1 coupon:', r1.chain?.coupons[0]?.couponNo, 'remaQty:', r1.chain?.coupons[0]?.remainingQtyTon);

    console.log('\n--- Test 2: AppvDocuNo AI69-06789 ---');
    const r2 = await resolveNativeDocumentChain({ reference: 'AI69-06789' });
    console.log('r2 resolved:', r2.resolved, 'coupons:', r2.chain?.coupons.length, 'coupon:', r2.chain?.coupons[0]?.couponNo);

    console.log('\n--- Test 3: Delivery DocuNo I69-03699 ---');
    const r3Ambiguous = await resolveNativeDocumentChain({ reference: 'I69-03699' });
    console.log('r3 without entityType isAmbiguous:', r3Ambiguous.isAmbiguous, 'candidates:', r3Ambiguous.candidates?.map(c => `${c.entityType}:${c.id}:${c.custName}`));
    const r3 = await resolveNativeDocumentChain({ entityType: 'DELIVERY', reference: 'I69-03699' });
    console.log('r3 with entityType DELIVERY resolved:', r3.resolved, 'bookings:', r3.chain?.bookings.length, 'coupons:', r3.chain?.coupons.length);

    console.log('\n--- Test 4: CouponNo C6906916 ---');
    const r4 = await resolveNativeDocumentChain({ reference: 'C6906916' });
    console.log('r4 resolved:', r4.resolved, 'bookings:', r4.chain?.bookings[0]?.docuNo, 'coupon:', r4.chain?.coupons[0]?.couponNo);

    console.log('\n--- Test 5: Full downstream K69-02552 ---');
    const r5 = await resolveNativeDocumentChain({ reference: 'K69-02552' });
    console.log('r5 resolved:', r5.resolved, 'deliveries:', r5.chain?.deliveries.length, 'coupons:', r5.chain?.coupons.length, 'redemptions:', r5.chain?.redemptions.length, 'invoices:', r5.chain?.invoices.length);
    console.log('r5 invoice:', r5.chain?.invoices[0]?.docuNo, 'redemption:', r5.chain?.redemptions[0]?.docuNo);

    console.log('\n--- Test 6: Duplicate CouponNo D6302491 ---');
    const r6 = await resolveNativeDocumentChain({ reference: 'D6302491' });
    console.log('r6 isAmbiguous:', r6.isAmbiguous, 'candidates:', r6.candidates?.length);
    if (r6.candidates) {
      console.log('Candidates:', r6.candidates.map(c => ({ id: c.id, docuNo: c.docuNo, custName: c.custName })));
    }

    console.log('\n--- Test 7: Exact CouponID 154572 ---');
    const r7 = await resolveNativeDocumentChain({ entityType: 'COUPON', exactId: 154572 });
    console.log('r7 resolved:', r7.resolved, 'coupon:', r7.chain?.coupons[0]?.couponNo, 'cust:', r7.chain?.coupons[0]?.ownerCustName);
  });
})().catch(console.error).finally(() => process.exit(0));
