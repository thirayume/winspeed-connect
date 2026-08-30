# Prosoft WINSpeed context

## Verified document map

| Stage | Document type | Screen audit ID | Series |
|---|---:|---:|---|
| Sales booking | 103 | 2098003048 | `I` or `K` |
| Booking approval | same 103 | 2098003080 | same document |
| Delivery / sale order | 104 | 2098003049 | `I` or `K` |
| Coupon redemption | 116 | 2098003052 | `C` from `I`, `D` from `K` |
| Post invoice | 203 | 2098003084 | `J` from `I`, `N` from `K` |
| Receipt | 206 | 2098003050 | configured receipt series |

The end-to-end series chains are `I → I → C → J` and `K → K → D → N`.

## Booking and approval

- The App or native WINSpeed creates document type `103`.
- Approval updates the same `103` with approval fields such as `AppvFlag` and `AppvDocuNo`.
- `DocuStatus` remains normal while the order awaits fulfillment; approval is not a separate AI document.
- Approval-queue eligibility uses `CheckAll='Y'`. `ValidDays` remains a business value and is not the queue gate.

## Delivery document 104

1. Open delivery/sale order screen and create a new document.
2. Select an approved booking `103`.
3. Verify customer, warehouse, delivery date, vehicle/reference, product, quantity, price, and linked booking.
4. Force the correct series by entering the `I` or `K` prefix when auto-number defaults to another series.
5. For each product line, open product detail and the Coupon tab.
6. Enter tons and coupon quantity, choose the matching coupon series (`C` for `I`, `D` for `K`), and run Calculate.
7. Verify one coupon allocation per delivery line and the expected quantity before saving.
8. Save once all lines, coupons, and totals agree.

Typical 50 kg bag conversion: `bags = tons × 1,000 ÷ 50`. Confirm the product packaging master before applying the formula.

Normal operators cannot edit a saved `104`. Coupon repair, if required, is an authorized support action through `wf.usp_IssueSalesOrderCoupons`, not direct `dbo` editing. `wf.v_DeliveryCouponGaps` supports controlled monitoring.

## Coupon redemption and invoice

- Coupon redemption uses document type `116`. Select every applicable delivery line/coupon and verify the generated numeric move-bill/redemption reference.
- Post Invoice uses document type `203` and produces invoice series `J` from `I`, or `N` from `K`.
- Verify the full source-document trace before billing/receipt.

## Remarks

The Description tab persists ordered plain-text lines in `dbo.SOHDRemark`; it is not equivalent to `SOHD.Desc1/Desc2/Desc3`. Keep `ListNo` continuous. Do not introduce bracket-tag protocols into native remarks.

## Stop points

Stop and escalate for an unapproved booking, wrong series, customer/product mismatch, quantity above reservation, coupon series mismatch, missing coupon calculation, duplicate coupon, invalid totals, unavailable source trace, or any need to directly alter native tables.
