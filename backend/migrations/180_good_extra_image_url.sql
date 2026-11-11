-- Migration 180: เพิ่มคอลัมน์ ImageUrl ในตาราง wf.GoodExtra สำหรับจัดเก็บรูปภาพสินค้าและของแถม
IF NOT EXISTS (
  SELECT 1 FROM sys.columns 
  WHERE object_id = OBJECT_ID('wf.GoodExtra') 
    AND name = 'ImageUrl'
)
BEGIN
  ALTER TABLE wf.GoodExtra ADD ImageUrl NVARCHAR(MAX) NULL;
END;

