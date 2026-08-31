---
documentId: "WF-RPT-002"
title: "รายงานต้นฉบับของ TruckScale — บัญชีรายการและที่มาของข้อมูล"
version: "v1.0"
status: Draft
owner: "Integration"
normative: false
---

# รายงานต้นฉบับของ TruckScale

สำรวจจากไฟล์ `.rpt` จริง 41 ใบใน `Requirements/Truckscale`
ดึงชื่อตารางและฟิลด์ออกจากตัวไฟล์โดยตรง ไม่ได้เดาจากชื่อรายงาน

ทุกใบต่อฐานผ่าน `DSN=TruckScales;UID=root;DBQ=db_truckscale` — คือฐานเดียวกับที่
โปรแกรมชั่งใช้ ไม่ได้มีฐานแยกสำหรับรายงาน

## รายงานทั้งหมด

| # | ไฟล์ | ตารางที่ใช้ | จำนวนฟิลด์ |
|---|---|---|---|
| 1 | `ReportByMoveBillGroup.rpt` | tblproduct_detail, tblscale | 29 |
| 2 | `ReportKangChang.rpt` | tblproduct_detail, tblscale | 29 |
| 3 | `Report_Boat.rpt` | tbl_boat | 4 |
| 4 | `Report_BoatDetail.rpt` | tblscale, tblproduct_detail | 31 |
| 5 | `Report_BoatGroup.rpt` | tblproduct_detail, tblscale | 32 |
| 6 | `Report_BoatGroup2.rpt` | tblscale, tblproduct_detail | 31 |
| 7 | `Report_ByCustomerDetail.rpt` | tblproduct_detail, tblscale | 32 |
| 8 | `Report_ByCustomerGroup.rpt` | tblscale, tblproduct_detail | 31 |
| 9 | `Report_ByCustomerGroup2.rpt` | tblproduct_detail, tblscale | 31 |
| 10 | `Report_ByDate.rpt` | tblproduct_detail, tblscale | 29 |
| 11 | `Report_ByDateDetail.rpt` | tblproduct_detail, tblscale | 31 |
| 12 | `Report_ByDateGroup.rpt` | tblproduct_detail, tblscale | 32 |
| 13 | `Report_ByGodownDetail.rpt` | tblscale, tblproduct_detail | 31 |
| 14 | `Report_ByGodownGroup.rpt` | tblproduct_detail, tblscale | 32 |
| 15 | `Report_ByGodownGroup2.rpt` | tblproduct_detail, tblscale | 32 |
| 16 | `Report_ByMoveBillDetail.rpt` | tblscale, tblproduct_detail | 29 |
| 17 | `Report_ByPalitGroup.rpt` | tblproduct_detail, tblscale | 32 |
| 18 | `Report_ByParkDetail.rpt` | tblproduct_detail, tblscale | 32 |
| 19 | `Report_ByParkGroup.rpt` | tblproduct_detail, tblscale | 31 |
| 20 | `Report_ByProductDetail.rpt` | tblproduct_detail, tblscale | 32 |
| 21 | `Report_ByProductGrop2.rpt` | tblproduct_detail, tblscale | 32 |
| 22 | `Report_ByProductGroup.rpt` | tblscale, tblproduct_detail | 31 |
| 23 | `Report_ByTuaDetail.rpt` | tblproduct_detail, tblscale | 31 |
| 24 | `Report_ByTuaGroup.rpt` | tblscale, tblproduct_detail | 31 |
| 25 | `Report_ByTuaGroup2.rpt` | tblscale, tblproduct_detail | 31 |
| 26 | `Report_BypalitDetail.rpt` | tblscale, tblproduct_detail | 31 |
| 27 | `Report_Customer.rpt` | tblcustomer | 8 |
| 28 | `Report_CustypeDetail.rpt` | tblscale, tblproduct_detail | 31 |
| 29 | `Report_CustypeGroup.rpt` | tblscale, tblproduct_detail | 31 |
| 30 | `Report_Driver.rpt` | — | 6 |
| 31 | `Report_Godown.rpt` | — | 4 |
| 32 | `Report_Goods.rpt` | tblproduct | 6 |
| 33 | `Report_KeyOne.rpt` | tbl_keyone, tblproduct_detail | 27 |
| 34 | `Report_ParkGroup2.rpt` | tblproduct_detail, tblscale | 32 |
| 35 | `Report_keyoneGroup.rpt` | tblproduct_detail, tbl_keyone | 28 |
| 36 | `RptBULK.rpt` | tblproduct_detail | 15 |
| 37 | `RptKlungSinKa.rpt` | tblproduct_detail | 16 |
| 38 | `RptOther.rpt` | tblproduct_detail | 15 |
| 39 | `RptSaYPan.rpt` | tblproduct_detail | 16 |
| 40 | `RptSent.rpt` | tblproduct_detail, tblscale | 29 |
| 41 | `Rpt_Receive.rpt` | tblproduct_detail, tblscale | 29 |

## ฟิลด์ที่ถูกใช้บ่อยที่สุด

| ฟิลด์ | จำนวนรายงานที่ใช้ |
|---|---|
| `cust_name` | 37 |
| `one_cus_id` | 37 |
| `one_num` | 36 |
| `one_type` | 36 |
| `pd_auto` | 36 |
| `pd_code_godown` | 36 |
| `pd_id` | 36 |
| `pd_pro_bag` | 36 |
| `pd_pro_code` | 36 |
| `pd_pro_formula` | 36 |
| `pd_pro_invoid` | 36 |
| `pd_pro_name` | 36 |
| `pd_pro_number` | 36 |
| `pd_pro_weight` | 36 |
| `pd_unit` | 36 |
| `one_car_regis` | 32 |
| `one_cus_name` | 32 |
| `one_des` | 32 |
| `one_dri_add` | 32 |
| `one_dri_id` | 32 |
| `one_dri_name` | 32 |
| `one_w_type` | 32 |
| `cust_type` | 31 |
| `s_day` | 30 |
| `s_id` | 30 |

## ฟิลด์รายใบ

### `ReportByMoveBillGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

### `ReportKangChang.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

### `Report_Boat.rpt`

ตาราง: `tbl_boat`

`bo_des` · `bo_id` · `bo_name` · `sto_des`

### `Report_BoatDetail.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_BoatGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_BoatGroup2.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByCustomerDetail.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByCustomerGroup.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByCustomerGroup2.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByDate.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByDateDetail.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByDateGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByGodownDetail.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByGodownGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByGodownGroup2.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByMoveBillDetail.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByPalitGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByParkDetail.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByParkGroup.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByProductDetail.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByProductGrop2.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByProductGroup.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByTuaDetail.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByTuaGroup.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_ByTuaGroup2.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_BypalitDetail.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_Customer.rpt`

ตาราง: `tblcustomer`

`cust_address` · `cust_district` · `cust_name` · `cust_province` · `cust_tel` · `cust_type` · `cust_zipcode` · `one_cus_id`

### `Report_CustypeDetail.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_CustypeGroup.rpt`

ตาราง: `tblscale` · `tblproduct_detail`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_Driver.rpt`

`dri_add` · `dri_des` · `dri_id` · `dri_name` · `dri_tel` · `tbl_driver`

### `Report_Godown.rpt`

`sto_code` · `sto_des` · `sto_name` · `sto_text`

### `Report_Goods.rpt`

ตาราง: `tblproduct`

`brand_name` · `proc_code` · `proc_cost` · `proc_name` · `proc_unit` · `proc_weight`

### `Report_KeyOne.rpt`

ตาราง: `tbl_keyone` · `tblproduct_detail`

`cust_name` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_datetime` · `one_day` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_id` · `one_move_id` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `sto_text`

### `Report_ParkGroup2.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_n` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `sto_des` · `sto_text` · `weight_in` · `weight_net` · `weight_out`

### `Report_keyoneGroup.rpt`

ตาราง: `tblproduct_detail` · `tbl_keyone`

`cust_name` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_datetime` · `one_day` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_id` · `one_move_id` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `sto_des` · `sto_text`

### `RptBULK.rpt`

ตาราง: `tblproduct_detail`

`cust_name` · `one_cus_id` · `one_num` · `one_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit`

### `RptKlungSinKa.rpt`

ตาราง: `tblproduct_detail`

`cust_name` · `one_cus_id` · `one_num` · `one_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `sto_text`

### `RptOther.rpt`

ตาราง: `tblproduct_detail`

`cust_name` · `one_cus_id` · `one_num` · `one_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit`

### `RptSaYPan.rpt`

ตาราง: `tblproduct_detail`

`cust_name` · `one_cus_id` · `one_num` · `one_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `sto_text`

### `RptSent.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

### `Rpt_Receive.rpt`

ตาราง: `tblproduct_detail` · `tblscale`

`cust_name` · `cust_type` · `one_car_regis` · `one_cus_id` · `one_cus_name` · `one_des` · `one_dri_add` · `one_dri_id` · `one_dri_name` · `one_num` · `one_type` · `one_w_type` · `pd_auto` · `pd_code_godown` · `pd_id` · `pd_pro_bag` · `pd_pro_code` · `pd_pro_formula` · `pd_pro_invoid` · `pd_pro_name` · `pd_pro_number` · `pd_pro_weight` · `pd_unit` · `s_day` · `s_id` · `s_num` · `weight_in` · `weight_net` · `weight_out`

