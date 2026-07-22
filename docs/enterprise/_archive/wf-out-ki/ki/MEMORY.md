# Memory Index — World Fert / WINSpeed DB Study

- [User Profile](user_profile.md) — Thirayu: software dev consultant building sales+rebate web app for World Fert
- [DB Connection](db_connection.md) — SQL Server 2022, dbwins_worldfert9, credentials, sqlcmd snippet
- [DB Rules](db_rules.md) — Iron rules: dbo=read-only, write only in schema wf, confirm before non-SELECT
- [DB Structure Overview](db_structure.md) — 669 tables, 4 real FKs, naming-convention relationships, collation
- [Table Row Counts](table_row_counts.md) — Verified row counts for all key tables
- [DocuType Reference](docutype_reference.md) — DocuType codes 103/104/107/108/109/110/202/501
- [GL Flow](gl_flow.md) — Verified GL chain, correct/incorrect joins, GL patterns
- [Units & Quantity](units_quantity.md) — GoodUnitID 1002=ตัน, 1001=ใบ, bag conversion, GoodQty2/GoodPrice2
- [Pricing](pricing.md) — EMSetPriceDT is the source of NET prices; ICPriceHD/DT empty
- [Ticket Flow](ticket_flow.md) — ตั๋วคุม (AI prefix), AppvFlag, WeighTicket gap, what WINSpeed lacks
- [Empty Tables](empty_tables.md) — Tables confirmed empty/unused
- [Output Files](output_files.md) — Files in ./out/ and their contents
