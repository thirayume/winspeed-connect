# Integration controls

## Ownership by stage

| Stage | System of action | Required cross-system evidence |
|---|---|---|
| Draft and verification | WS-Sale-App | App order, verifier, warnings resolved |
| Native booking creation | App → WINSpeed | App ID, WINSpeed 103 number, audit/counter result |
| Native approval | WINSpeed | Same 103 with approval fields and `CheckAll='Y'` eligibility |
| Pre-weigh queue | App → TruckScale | `tbl_keyone.one_App` and plate/customer reference |
| Picking and load | WS-Sale-App | status history and per-line load sequence |
| Weigh and ship | TruckScale + App | ticket sequence/movebill, gross/tare/net, products, evaluation, write-back result |
| Delivery and coupons | WINSpeed | 104 linked to 103, per-line coupon allocation, correct series |
| Redemption and invoice | WINSpeed | 116 and 203 linked through the verified chain |

## Reconciliation keys

Use multiple fields, not plate alone:

- App sales-order ID / App reference.
- WINSpeed `103`/`104` document number and series.
- TruckScale sequence, `movebill`, `one_num`, and exact normalized plate.
- Customer, product, date/time, expected and actual weight.

## Daily control

1. Review pending native approvals and confirmed App orders.
2. Review TruckScale `UNMATCHED`/`MULTI` inbox items and open tickets.
3. Review shipped App orders with write-back/outbox failures.
4. Review delivery documents with coupon gaps through `wf.v_DeliveryCouponGaps`.
5. Trace samples from App order → 103 → TruckScale ticket → 104 → coupon redemption → invoice.
6. Record owner, due time, root cause, corrective action, and closure evidence for every exception.

## Prohibited shortcuts

- Do not reuse another vehicle’s open ticket.
- Do not select a candidate when plate matching is ambiguous without corroborating evidence.
- Do not mark shipping complete from a screenshot alone; verify stored records and integration outcome.
- Do not change `DocuStatus`, coupon rows, counters, or scale rows through ad-hoc SQL.
- Do not treat a queued retry as a completed cross-system update.

## Minimum acceptance criteria

An integrated transaction is complete only when business quantities agree, identifiers are traceable, statuses are compatible, required approval and anomaly evidence exist, no unresolved integration failure remains, and downstream WINSpeed documents use the correct series.
