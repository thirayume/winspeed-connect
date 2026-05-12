# WINSpeed Data Mapping & Requirements

This document outlines the mapping between the WSSale App entities and the WINSpeed SQL Server production database.

## 1. Entity Mapping

| App Entity | Production Table | Primary Key | Description |
| :--- | :--- | :--- | :--- |
| **Customer** | `EMCust` | `CustID` | Customer master data |
| **Item** | `EMGood` | `GoodID` | Product/Good master data |
| **Sales Order** | `SOHD` | `SOID` | Sales Order header |
| **Order Line** | `SODT` | `SOID`, `ListNo` | Sales Order line items |
| **Vendor** | `EMVendor` | `VendorID` | Supplier master data |

---

## 2. Detailed Field Mapping

### Customer (`EMCust`)
| App Property | DB Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `CustID` | `CustID` | `int` | Primary Key |
| `CustName` | `CustName` | `varchar` | Main display name |
| `CustCode` | `CustCode` | `varchar` | External reference code |

### Item / Product (`EMGood`)
| App Property | DB Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `GoodID` | `GoodID` | `int` | Primary Key |
| `GoodCode` | `GoodCode` | `varchar` | SKU / Part Number |
| `GoodName` | `GoodName1` | `varchar` | Primary description |
| `GoodPrice1`| `StandardSalePrce`| `money` | Base selling price |
| `Unit` | `MainGoodUnitID` | `int` | Unit of measure reference |
| `Category` | `GoodGroupID` | `int` | Grouping reference |
| `StockQty` | `StockQty` | `decimal` | Current physical stock |
| `DailyCapacity` | *N/A* | `int` | **Simulated** (Calculated in Backend) |

### Sales Order Header (`SOHD`)
| App Property | DB Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `SOID` | `SOID` | `int` | Primary Key |
| `DocuNo` | `DocuNo` | `varchar` | Order Number (e.g., SO2605-001) |
| `CustID` | `CustID` | `int` | Link to `EMCust` |
| `DocuDate` | `DocuDate` | `datetime` | Order placement date |
| `TotalAmt` | `NetAmnt` | `money` | Final total after tax/disc |
| `EmpID` | `EmpID` | `int` | Salesperson ID |
| `Status` | *Calculated* | `string` | Derived from Flag columns (see below) |

### Sales Order Detail (`SODT`)
| App Property | DB Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `SOID` | `SOID` | `int` | Link to `SOHD` |
| `ListNo` | `ListNo` | `smallint`| Line sequence number |
| `GoodID` | `GoodID` | `int` | Link to `EMGood` |
| `GoodQty1` | `GoodQty1` | `decimal` | Ordered quantity |
| `GoodPrice1`| `GoodPrice1` | `money` | Unit price at time of order |

---

## 3. Status Mapping Logic

The application `Status` field is derived from three boolean flags in `SOHD`:

| App Status | `AppvFlag` | `PkgStatus` | `clearflag` |
| :--- | :---: | :---: | :---: |
| **Draft** | N | N | N |
| **Confirmed** | Y | N | N |
| **Picking** | Y | Y | N |
| **Shipped** | Y | Y | Y |

---

## 4. Backend SQL Requirements

- **Database:** `dbwins_demo` (Local) / `WINSpeed` (Production)
- **Schema:** `dbo`
- **Authentication:** Windows Authentication (Trusted Connection)
- **Driver:** `msnodesqlv8`

---

## 5. Testing & Verification

For manual database verification and CRUD testing, use the provided SQL script:
- **SQL Script:** [test_queries.sql](./test_queries.sql)

This script contains standard queries for creating, reading, updating, and deleting sales orders using the WINSpeed table structures.

