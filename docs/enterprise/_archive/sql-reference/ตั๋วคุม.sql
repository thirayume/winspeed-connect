--มี 4 combinations ต้องจัด:

--AppvFlag	DocuStatus	ความหมาย	จำนวน
--W	Y	รอชั่ง (ค้าง)	28,290
--Y	Y	ผ่านแล้ว/ออกบิลแล้ว	24,632
--W	N	ถูกยกเลิก (รอชั่ง)	126
--Y	N	ถูกยกเลิก (หลังอนุมัติ)	1,047
--เขียน query ทั้งสองชุด:


--Used 3 tools
--ข้อมูลชัดเจนดีแล้ว ตรวจสถานะ pending อีกนิด:

--Used PowerShell
--ข้อมูลครบ ทราบแล้วว่า:

--ค้าง: AppvFlag='W' → AppvDocuNo ยัง NULL (ยังไม่ได้เลขตั๋วคุม)
--เสร็จสิ้น: AppvFlag='Y' → AppvDocuNo = AI64-XXXXX (มีเลขตั๋วคุมแล้ว)
--เขียน query ทั้ง 2 ชุด:

--ชุดที่ 1 — ตั๋วคุม ยังค้าง (รอชั่ง / ยังไม่อนุมัติ) — 100 แรกจากเก่าสุด
SELECT TOP 100
    h.DocuNo            AS เลขใบจอง,
    h.DocuDate          AS วันที่จอง,
    h.AppvDocuNo        AS เลขตั๋วคุม,       -- NULL = ยังไม่มีตั๋วคุม
    c.CustName          AS ลูกค้า,
    h.TransRegistration AS ทะเบียนรถ,
    h.Desc1             AS รายละเอียด1,
    h.Desc2             AS รายละเอียด2,
    h.NetAmnt           AS ยอดสุทธิ,
    N'รอชั่ง'           AS สถานะ
FROM  dbo.SOHD h
JOIN  dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuType   = 103
  AND h.AppvFlag   = 'W'
  AND h.DocuStatus = 'Y'
ORDER BY h.DocuDate ASC;

--ชุดที่ 2 — ตั๋วคุม เสร็จสิ้น (อนุมัติแล้ว / มีเลขตั๋วคุม AI) — 100 แรกจากเก่าสุด
SELECT TOP 100
    h.AppvDocuNo        AS เลขตั๋วคุม,
    h.DocuNo            AS เลขใบจอง,
    h.DocuDate          AS วันที่จอง,
    h.AppvDate          AS วันที่อนุมัติ,
    c.CustName          AS ลูกค้า,
    h.TransRegistration AS ทะเบียนรถ,
    h.Desc1             AS รายละเอียด1,
    h.Desc2             AS รายละเอียด2,
    h.NetAmnt           AS ยอดสุทธิ,
    N'เสร็จสิ้น'        AS สถานะ
FROM  dbo.SOHD h
JOIN  dbo.EMCust c ON c.CustID = h.CustID
WHERE h.DocuType   = 103
  AND h.AppvFlag   = 'Y'
  AND h.DocuStatus = 'Y'
ORDER BY h.DocuDate ASC;

----ชุดรวม — ดู 2 สถานะในคิวรีเดียว (UNION ALL)
---- ยังค้าง (100 แรกจากเก่าสุด)
--SELECT TOP 100
--    N'รอชั่ง'           AS สถานะ,
--    h.DocuNo            AS เลขใบจอง,
--    h.AppvDocuNo        AS เลขตั๋วคุม,
--    h.DocuDate          AS วันที่จอง,
--    CAST(NULL AS DATETIME) AS วันที่อนุมัติ,
--    c.CustName          AS ลูกค้า,
--    h.TransRegistration AS ทะเบียนรถ,
--    h.Desc1             AS รายละเอียด1,
--    h.Desc2             AS รายละเอียด2,
--    h.NetAmnt           AS ยอดสุทธิ
--FROM  dbo.SOHD h
--JOIN  dbo.EMCust c ON c.CustID = h.CustID
--WHERE h.DocuType = 103 AND h.AppvFlag = 'W' AND h.DocuStatus = 'Y'
--ORDER BY h.DocuDate ASC

--UNION ALL

---- เสร็จสิ้น (100 แรกจากเก่าสุด)
--SELECT TOP 100
--    N'เสร็จสิ้น'        AS สถานะ,
--    h.DocuNo,
--    h.AppvDocuNo,
--    h.DocuDate,
--    h.AppvDate,
--    c.CustName,
--    h.TransRegistration,
--    h.Desc1,
--    h.Desc2,
--    h.NetAmnt
--FROM  dbo.SOHD h
--JOIN  dbo.EMCust c ON c.CustID = h.CustID
--WHERE h.DocuType = 103 AND h.AppvFlag = 'Y' AND h.DocuStatus = 'Y'
--ORDER BY h.DocuDate ASC;

--หมายเหตุ
--ค้าง (W)	เสร็จสิ้น (Y)
--จำนวนทั้งหมด	28,290	24,632
--AppvDocuNo	NULL	AI64-XXXXX
--AppvDate	NULL	มีวันที่
--DocuDate ที่เก่าสุด	2019-01-03	2021-11-12


