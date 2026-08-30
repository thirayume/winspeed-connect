# WS-Sale-App context

## Roles

Current role codes include `ADMIN`, `C_LEVEL`, `SALES`, `COUNTER_SALES`, `WAREHOUSE`, `ACCOUNTING`, `MANAGER`, `APPROVER`, and `WEIGHBRIDGE`. Route-level authorization is authoritative; the navigation menu is not proof of permission.

## Sales-order lifecycle

| App status | Thai meaning | Operational meaning |
|---|---|---|
| `DRAFT` | ร่าง | Editable App order |
| `PENDING_APPROVAL` | รออนุมัติใน WINSpeed | Native 103 awaits approval |
| `CONFIRMED` | รอจัดส่ง | Approved/ready for warehouse flow |
| `PICKING` | รอรับสินค้า | Warehouse has accepted picking |
| `LOADED` | โหลดสินค้า | Load sequence/actual loading recorded |
| `SHIPPED` | ส่งออกจากตาชั่ง | Valid weigh result recorded and shipped |
| `IMPORTED` | ปิด SO ใน WINSpeed | Downstream WINSpeed closure/import complete |
| `CANCELLED` | ยกเลิก | Controlled cancellation complete |

## Normal order flow

1. Create a draft with customer, delivery/requested date, plate/transport, products, tons, price, giveaways/rebate, warehouse/control ticket, load sequence, and remarks as applicable.
2. Resolve any warnings for sales-owner mapping and credit data.
3. Counter Sales, Manager, Admin, or C-Level verifies the draft. Admin may bypass the verification gate, so the procedural review remains required.
4. Confirm only after accepted quotation, approved giveaway, credit clearance, price floor, and verification checks pass.
5. Confirmation calls `wf.sp_ConfirmSalesOrder`, creates native WINSpeed `103`, advances the native counter, records audit, and submits the TruckScale pre-weigh ticket.
6. Warehouse starts picking (`CONFIRMED → PICKING`).
7. Warehouse records load sequence and completes loading (`PICKING → LOADED`).
8. Weighbridge/warehouse ships with gross and tare (`LOADED → SHIPPED`). Gross must be positive, tare non-negative, and net positive.

## Weight control

- Expected kilograms derive from order tons.
- Current default tolerance bands are approximately +2% to +5%, producing `OK`, `UNDERWEIGHT`, or `OVERWEIGHT` evaluation according to configuration.
- For abnormal weight, require a reason, approver, and photographic/supporting evidence as a procedural ISO control. The current UI/API does not enforce all of these fields in every path.
- Use the normal Store/Scale workflow for controlled shipping. Treat Quick Ship as an exception path requiring equivalent evidence and authorization.

## Change, unlock, and cancellation

- Unlock of a `PICKING` order is restricted to APPROVER, ADMIN, MANAGER, ACCOUNTING, or C_LEVEL and reverses the relevant reservation/rebate effects.
- Ordinary users submit edit/unlock/cancel requests with a meaningful reason. Duplicate pending requests are blocked.
- Once downstream invoice evidence exists, edit/unlock/cancel is locked.
- Use the controlled App request flow. Do not directly delete or edit native database rows.

## Audit evidence

Retain the App order ID, native document number, actor/timestamp, verification and approval evidence, change-request reason/resolution, weight ticket, anomaly evidence, integration result/outbox state, and downstream document references.
