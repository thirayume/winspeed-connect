# TruckScale context

## Record model

- `tbl_keyone`: pre-weigh queue with customer, plate, type, description, App reference, and datetime.
- `tblscale`: one weigh-in/out cycle with sequence, `movebill`, plate, in/out date and time, weight in/out/net, operator/scale, and `one_num`.
- `tblproduct_detail`: product, bag weight, bag count, target tons, document/ticket reference, warehouse/destination, and `one_num`.

One `tblscale` row represents one complete cycle. `movebill` can repeat and is not a database-wide unique key.

## Native operating sequence

Native button captions may differ by installation. Use the verified record fields and post-conditions:

1. Select the correct pre-weigh queue entry or create the ticket with customer, plate, transaction type, and reference.
2. Confirm the scale is stable and zeroed; capture `weight_in` for the outbound flow.
3. Retain the ticket sequence and identify the vehicle before loading.
4. After loading, retrieve the same open ticket using sequence, `movebill`, or exact plate.
5. Confirm customer, plate, products, and document reference; capture `weight_out`.
6. Verify `weight_net = weight_out - weight_in`, and that all values are positive and plausible.
7. Complete `movebill`, scale/operator, product details, and any required destination/warehouse data.
8. Save/print and verify output date/time, `one_num`, weight values, and that the cycle is no longer open.

## App integration

- Confirmation inserts a pre-weigh entry into `tbl_keyone` unless the plate already has an open scale ticket.
- Shipping write-back first searches an open ticket by `movebill`; if none is found, it uses exact plate.
- More than one open ticket for the same plate returns `ambiguous_match`; the integration must not guess.
- When no open ticket exists, controlled write-back can insert a fallback sequence beginning `WF`.
- Product details are written/replaced under the ticket `one_num`.
- Connection and query timeouts are intentionally short. A failed write can enter an outbox for later retry; it is not equivalent to a successful TruckScale update.

## Inbox synchronization

- Sync polls by `s_id` watermark and refreshes open rows, normally every 60 seconds.
- `wf.WeighInbox` is upserted idempotently by sequence.
- Plate matching can produce `MATCHED`, `MULTI`, or `UNMATCHED`.
- Ambiguous candidates require manual review/match; eligible roles include ADMIN, MANAGER, WAREHOUSE, WEIGHBRIDGE, COUNTER_SALES, and C_LEVEL.

## Stop points

Stop for connection loss, unstable/unzeroed scale, duplicate or multiple open tickets, plate/customer/product mismatch, `gross <= tare`, missing output date/time, implausible net weight, abnormal weight without approved evidence, or write-back/outbox failure.
