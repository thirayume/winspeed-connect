USE dbwins_worldfert9;

SELECT TOP 50
    h.SOID,
    h.DocuNo,
    CONVERT(varchar, h.DocuDate, 23)    AS DocuDate,
    DATEDIFF(day, h.DocuDate, GETDATE()) AS age_days,
    h.CustID,
    c.CustName,
    h.TransRegistration                 AS truck_plate,
    h.NetAmnt,
    h.AppvFlag,
    h.DocuStatus,
    d.GoodID,
    g.GoodName1                         AS product_name,
    d.GoodQty2                          AS qty_ton,
    d.GoodPrice2                        AS price_per_ton
FROM dbo.SOHD        h WITH (NOLOCK)
JOIN dbo.SODT        d WITH (NOLOCK) ON d.SOID    = h.SOID
JOIN dbo.EMGood      g WITH (NOLOCK) ON g.GoodID  = d.GoodID
LEFT JOIN dbo.EMCust c WITH (NOLOCK) ON c.CustID  = h.CustID
WHERE h.DocuType   = 103
  AND h.AppvFlag   = 'W'       -- รอชั่ง
  AND h.DocuStatus = 'Y'       -- active เท่านั้น
ORDER BY h.DocuDate ASC, h.SOID ASC;  -- เก่าสุดขึ้นก่อน