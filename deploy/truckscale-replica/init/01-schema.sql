-- สร้างจาก schema จริงของ db_truckscale (9.7.1) เมื่อ 2026-08-30
-- อย่าแก้ด้วยมือ · สร้างใหม่ด้วย scripts/dump-truckscale-schema.js

CREATE DATABASE IF NOT EXISTS db_truckscale
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE db_truckscale;

CREATE TABLE IF NOT EXISTS `tblscale` (
  `s_id` int NOT NULL AUTO_INCREMENT COMMENT 'ลำดับที่',
  `sequence` varchar(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL DEFAULT '00000001' COMMENT 'ลำดับที่ชั่ง',
  `movebill` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'เลขที่ใบเคลื่อนย้าย',
  `one_car_regis` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL DEFAULT '-' COMMENT 'ทะเบียนรถ',
  `Date_In` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '0' COMMENT 'วันที่เข้า',
  `Date_In2` int DEFAULT '0' COMMENT 'วันที่เข้า',
  `Time_In` time NOT NULL DEFAULT '00:00:00' COMMENT 'เวลาเข้า',
  `Date_Out` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL DEFAULT '0' COMMENT 'วันที่ออก',
  `Date_Out2` int DEFAULT '0' COMMENT 'วันที่ออก',
  `Time_Out` time NOT NULL DEFAULT '00:00:00' COMMENT 'เวลาออก',
  `one_num` int NOT NULL DEFAULT '0' COMMENT 'number',
  `one_cus_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'รหัสลูกค้า',
  `one_cus_name` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ชื่อลูกค้า',
  `one_dri_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'รหัสผู้รับสินค้า',
  `one_dri_name` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ชื่อผู้รับสินค้า',
  `one_dri_add` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ที่อยู่ผู้รับสินค้า',
  `weight_in` double DEFAULT '0' COMMENT 'นน.เข้า',
  `weight_out` double DEFAULT '0' COMMENT 'นน.ออก',
  `weight_net` double DEFAULT '0' COMMENT 'นน.รวม',
  `Weigavg` double DEFAULT '0' COMMENT 'นน.เฉลี่ย',
  `s_day` int DEFAULT '0' COMMENT 'วันที่',
  `s_num` int DEFAULT '0' COMMENT 'เลขที่',
  `Computer_w` int DEFAULT '1' COMMENT 'หมายเลขเครื่องชั่ง',
  `weight_Type` int DEFAULT '0' COMMENT 'ชั่งครั้งที่',
  `one_w_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT 'ชั่งรับ' COMMENT 'ประเภทการชั่ง',
  `cust_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ประเภทลูกค้า',
  `cust_Park` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ภูมิ๓าค',
  `one_des` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'หมายเหตุ',
  PRIMARY KEY (`s_id`)
) ENGINE=InnoDB AUTO_INCREMENT=430577 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_bin COMMENT='รายการชั่ง';

CREATE TABLE IF NOT EXISTS `tblproduct_detail` (
  `pd_id` int NOT NULL AUTO_INCREMENT COMMENT 'ลำดับที่',
  `pd_pro_code` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'รหัสสินค้า',
  `pd_pro_name` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ชื่อสินค้า',
  `pd_pro_formula` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ตรา',
  `pd_pro_weight` int NOT NULL DEFAULT '0' COMMENT 'นน/กส',
  `pd_pro_bag` int DEFAULT '0' COMMENT 'กระสอบ',
  `pd_pro_wantWeight` float NOT NULL DEFAULT '0' COMMENT 'น้ำหนักที่ต้องการ',
  `pd_pro_invoid` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL DEFAULT '-' COMMENT 'เลขที่ใบสั่งจ่าย',
  `pd_pro_number` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL DEFAULT '-' COMMENT 'เลขที่ตั๋ว',
  `pd_pro_Godown` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ชื่อโกดัง',
  `one_cus_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'รหัสลูกค้า',
  `cust_name` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ชื่อลูกค้า',
  `one_num` int DEFAULT '0' COMMENT 'number',
  `pd_pro_pUnit` float DEFAULT '0' COMMENT 'ราคา/หน่วย',
  `pd_unit` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'หน่วย',
  `pd_code_godown` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'รหัสโกดัง',
  `one_type` varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'โกดังหรือชื่อเรือ',
  `pd_Destination` varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'สถานที่ปลายทาง',
  `year` int DEFAULT '0' COMMENT 'ปี',
  `pd_auto` varchar(10) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '000000' COMMENT 'รหัสออโต้',
  `sto_text` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ประเภทโกดัง',
  `sto_des` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '0' COMMENT 'หมายเหตุโกดัง',
  PRIMARY KEY (`pd_id`),
  KEY `idx_pd_one_num` (`one_num`)
) ENGINE=InnoDB AUTO_INCREMENT=582082 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_bin;

CREATE TABLE IF NOT EXISTS `tbl_keyone` (
  `one_id` int NOT NULL AUTO_INCREMENT,
  `one_move_id` int DEFAULT '0' COMMENT 'เลขที่เคลื่อนย้าย',
  `one_cus_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'รหัสลูกค้า',
  `one_cus_name` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'ชื่อลูกค้า',
  `one_dri_id` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'รหัสผู้รับสินค้า',
  `one_dri_name` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'ชื่อผู้รับสินค้า',
  `one_dri_add` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'ที่อยู่ผู้รับสินค้า',
  `one_car_regis` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'ทะเบียนรถ',
  `one_des` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '' COMMENT 'หมายเหตุ',
  `one_type` varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ประเภทโกดังหรือท่าเรือ',
  `one_day` int NOT NULL DEFAULT '0' COMMENT 'day',
  `one_num` int NOT NULL DEFAULT '0' COMMENT 'number',
  `one_w_type` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT 'ชั่งรับ' COMMENT 'ประเภทการชั่ง',
  `one_App` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin DEFAULT '-' COMMENT 'ผู้อนุมัติจ่าย',
  `one_datetime` varchar(50) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL COMMENT 'datetime',
  `weight_Type` int DEFAULT '0' COMMENT 'ชั่งครั้งที่',
  PRIMARY KEY (`one_id`)
) ENGINE=InnoDB AUTO_INCREMENT=431986 DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_bin COMMENT='ตารางเก็บข้อมูลก่อนชั่ง';

