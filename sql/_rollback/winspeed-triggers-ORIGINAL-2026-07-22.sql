-- ORIGINAL trigger definitions (before legacy raiserror fix) — 2026-07-22T18:26:12.155Z
-- restore: run each block as-is (they are CREATE TRIGGER; drop the existing trigger first if needed)


-- ===== tD_SODT =====
GO

CREATE TRIGGER tD_SODT ON SODT
	FOR DELETE AS
/* ERwin Builtin Sat Feb 09 11:07:39 2002 */
/* DELETE TRIGGER on SODT */
BEGIN
	DECLARE	@errno	INT,
			@errmsg	VARCHAR(255)
    /* ERwin Builtin Sat Feb 09 11:07:38 2002 */
    /* SODT สั่งขาย SOPickingDT ON PARENT DELETE RESTRICT */
	IF EXISTS (
		SELECT * FROM deleted, SOPickingDT
		WHERE SOPickingDT.SOID = deleted.SOID
		AND SOPickingDT.RefListNo = deleted.ListNo )
	BEGIN
		SELECT	@errno = 30001,
				@errmsg = 'Cannot DELETE SODT because SOPickingDT exists.'
		GOTO error
	END

    /* ERwin Builtin Sat Feb 09 11:07:38 2002 */
    /* SODT อธิบาย Detail SODTRemark ON PARENT DELETE CASCADE */
	DELETE SODTRemark
	FROM SODTRemark, deleted
	WHERE SODTRemark.SOID = deleted.SOID
	AND SODTRemark.RefListNo = deleted.ListNo

    /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
    /* SODT รายการที่อ้างอิง SODT ON PARENT DELETE RESTRICT */
	IF EXISTS (
		SELECT * FROM deleted, SODT
		WHERE SODT.RefSOID = deleted.SOID
		AND SODT.RefListNo = deleted.ListNo )
	BEGIN
		SELECT	@errno = 30001,
				@errmsg = 'Cannot DELETE SODT because SODT exists.'
		GOTO error
	END

    /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
    RETURN
ERROR:
	RAISERROR @errno @errmsg  
    ROLLBACK TRANSACTION
END

GO

-- ===== tD_SOHD =====
GO

CREATE trigger [dbo].[tD_SOHD] on [dbo].[SOHD]  
  for DELETE  
  as  
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
/* DELETE trigger on SOHD */  
/* default body for tD_SOHD */  
begin  
  declare  @numrows int,  
           @nullcnt int,  
           @validcnt int,  
           @insSOID u_ID,  
           @errno   int,  
           @errmsg  varchar(255)  
  
  select @numrows = @@rowcount  

/* ERwin Builtin Sat Mar 29 08:40:56 2003 */    
    /* SOHD R/1201 WHHD ON PARENT DELETE RESTRICT */    
    if exists (    
      select * from deleted,whhd    
      where    
        /*  %JoinFKPK(ARReceHD,deleted," = "," and") */    
        whhd.refid = deleted.SOID   
        and whhd.docuCopyType = deleted.docutype   
    )    
    begin    
      select @errno  = 30001,    
             @errmsg = 'Cannot DELETE SOHD because WHHD exists.'    
      goto error    
    end
  
   /* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/1228 WHDT ON PARENT DELETE RESTRICT */  
    if exists (  
      select docuid from deleted,WHDT  
      where  
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */  
        WHDT.DocuCopyType = 104
        and WHDT.DocuCopyID = deleted.SOID  
    )  
    begin  
      select @errno  = 30001,  
             @errmsg = 'Cannot DELETE SOHD because WHDT exists.'  
      goto error  
    end 
  
  /* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/1228 SOInvDT ON PARENT DELETE RESTRICT */  
    if exists (  
      select soinvid from deleted,SOInvdt  
      where  
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */  
        SOInvDT.refedocutype = 104
        and SOInvdt.RefId = deleted.SOID  
        and Soinvdt.docutype in (107,108)
    )  
    begin  
      select @errno  = 30001,  
             @errmsg = 'Cannot DELETE SOHD because SOInvDT exists.'  
      goto error  
    end 
    
    
     /* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/1228 SOInvDT ON PARENT DELETE RESTRICT */  
    if exists (  
      select soinvid from deleted,SOInvdt  
      where  
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */          
        SOInvdt.RefId = deleted.SOID  
        and Soinvdt.docutype in (106, 202)
    )  
    begin  
      select @errno  = 30001,  
             @errmsg = 'Cannot DELETE SOHD because SOInvDT exists.'  
      goto error  
    end 
    
  
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/1228 SOPickingDT ON PARENT DELETE RESTRICT */  
    if exists (  
      select * from deleted,SOPickingDT  
      where  
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */  
        SOPickingDT.SOID = deleted.SOID  
    )  
    begin  
      select @errno  = 30001,  
             @errmsg = 'Cannot DELETE SOHD because SOPickingDT exists.'  
      goto error  
    end  
  
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/652 SODT ON PARENT DELETE CASCADE */  
    delete SODT  
      from SODT,deleted  
      where  
        /*  %JoinFKPK(SODT,deleted," = "," and") */  
        SODT.SOID = deleted.SOID  
  
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/293 SOHD ON PARENT DELETE RESTRICT */  
    if exists (  
      select * from deleted,SOHD  
      where  
        /*  %JoinFKPK(SOHD,deleted," = "," and") */  
        SOHD.RefSOID = deleted.SOID  
    )  
    begin  
      select @errno  = 30001,  
             @errmsg = 'Cannot DELETE SOHD because SOHD exists.'  
      goto error  
    end  
  
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */  
    /* SOHD R/321 SOHDRemark ON PARENT DELETE CASCADE */  
    delete SOHDRemark  
      from SOHDRemark,deleted  
      where  
        /*  %JoinFKPK(SOHDRemark,deleted," = "," and") */  
        SOHDRemark.SOID = deleted.SOID  
        
    delete WFCoupon  
      from WFCoupon,deleted  
      where  
        /*  %JoinFKPK(SOHDRemark,deleted," = "," and") */  
        WFCoupon.Docuid = deleted.SOID  

  return  
error:  
    raiserror @errno @errmsg  
    rollback transaction  
end

GO

-- ===== tI_SODT =====
GO


create trigger tI_SODT on SODT
  for INSERT
  as
/* ERwin Builtin Sat Feb 09 11:07:39 2002 */
/* INSERT trigger on SODT */
begin
  declare  @numrows int,
           @nullcnt int,
           @validcnt int,
           @errno   int,
           @errmsg  varchar(255)

  select @numrows = @@rowcount
  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMJob R/452 SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(JobID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMJob
        where
          /* %JoinFKPK(inserted,EMJob) */
          inserted.JobID = EMJob.JobID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.JobID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMJob does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SOHD R/312 SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(SOID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SOHD
        where
          /* %JoinFKPK(inserted,SOHD) */
          inserted.SOID = SOHD.SOID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because SOHD does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับStock SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodStockUnitID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodStockUnitID = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodStockUnitID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับ2 SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodUnitID2)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodUnitID2 = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodUnitID2 is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SODT รายการที่อ้างอิง SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(RefSOID) or
    update(RefListNo)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SODT
        where
          /* %JoinFKPK(inserted,SODT) */
          inserted.RefSOID = SODT.SOID and
          inserted.RefListNo = SODT.ListNo
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.RefSOID is null and
      inserted.RefListNo is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because SODT does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับเปรียบเทียบ SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodCompareUnitID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodCompareUnitID = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodCompareUnitID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMVATGroup VAT Class SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(VATGroupID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMVATGroup
        where
          /* %JoinFKPK(inserted,EMVATGroup) */
          inserted.VATGroupID = EMVATGroup.VATGroupID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.VATGroupID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMVATGroup does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับ1 SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodUnitID1)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodUnitID1 = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodUnitID1 is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMInve คลังสินค้า SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(InveID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMInve
        where
          /* %JoinFKPK(inserted,EMInve) */
          inserted.InveID = EMInve.InveID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.InveID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMInve does not exist.'
      goto error
    end
  end

  
/* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMLoca ที่เก็บสินค้า SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(LocaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMLoca
        where
          /* %JoinFKPK(inserted,EMLoca) */
    inserted.InveID = EMLoca.InveID and
    inserted.LocaID = EMLoca.LocaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.LocaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMLoca does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGood สินค้า SODT ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGood
        where
          /* %JoinFKPK(inserted,EMGood) */
          inserted.GoodID = EMGood.GoodID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SODT because EMGood does not exist.'
      goto error
    end
  end


  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  return
error:
    raiserror @errno @errmsg
    rollback transaction
end

GO

-- ===== tI_SOHD =====
GO


create trigger tI_SOHD on SOHD
  for INSERT
  as
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
/* INSERT trigger on SOHD */
/* default body for tI_SOHD */
begin
  declare  @numrows int,
           @nullcnt int,
           @validcnt int,
           @insSOID u_ID,
           @errno   int,
           @errmsg  varchar(255)

  select @numrows = @@rowcount
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMDept R/1154 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(DeptID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMDept
        where
          /* %JoinFKPK(inserted,EMDept) */
          inserted.DeptID = EMDept.DeptID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.DeptID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMDept does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCust R/1153 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CustID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCust
        where
          /* %JoinFKPK(inserted,EMCust) */
          inserted.CustID = EMCust.CustID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CustID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMCust does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMTranspArea R/1152 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(TranspAreaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMTranspArea
        where
          /* %JoinFKPK(inserted,EMTranspArea) */
          inserted.TranspAreaID = EMTranspArea.TranspAreaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.TranspAreaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMTranspArea does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMTransp R/1151 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(TranspID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMTransp
        where
          /* %JoinFKPK(inserted,EMTransp) */
          inserted.TranspID = EMTransp.TranspID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.TranspID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMTransp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCurr R/1150 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CurrID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCurr
        where
          /* %JoinFKPK(inserted,EMCurr) */
          inserted.CurrID = EMCurr.CurrID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CurrID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMCurr does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCurrType R/1149 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CurrTypeID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCurrType
        where
          /* %JoinFKPK(inserted,EMCurrType) */
          inserted.CurrTypeID = EMCurrType.CurrTypeID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CurrTypeID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMCurrType does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMEmp R/1148 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(EmpID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMEmp
        where
          /* %JoinFKPK(inserted,EMEmp) */
          inserted.EmpID = EMEmp.EmpID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.EmpID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMEmp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMBrch R/1147 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(BrchID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMBrch
        where
          /* %JoinFKPK(inserted,EMBrch) */
          inserted.BrchID = EMBrch.BrchID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.BrchID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMBrch does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMSaleArea R/1146 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(SaleAreaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMSaleArea
        where
          /* %JoinFKPK(inserted,EMSaleArea) */
          inserted.SaleAreaID = EMSaleArea.SaleAreaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.SaleAreaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMSaleArea does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMVATGroup R/1145 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(VATGroupID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMVATGroup
        where
          /* %JoinFKPK(inserted,EMVATGroup) */
          inserted.VATGroupID = EMVATGroup.VATGroupID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.VATGroupID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMVATGroup does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMIntroduce R/836 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(IntroduceID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMIntroduce
        where
          /* %JoinFKPK(inserted,EMIntroduce) */
          inserted.IntroduceID = EMIntroduce.IntroduceID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.IntroduceID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMIntroduce does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCreditTerm เครดิตเทอม SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CreditID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCreditTerm
        where
          /* %JoinFKPK(inserted,EMCreditTerm) */
          inserted.CreditID = EMCreditTerm.CreditID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CreditID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because EMCreditTerm does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/293 SOHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(RefSOID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SOHD
        where
          /* %JoinFKPK(inserted,SOHD) */
          inserted.RefSOID = SOHD.SOID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.RefSOID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOHD because SOHD does not exist.'
      goto error
    end
  end



  return
error:
    raiserror @errno @errmsg
    rollback transaction
end

GO

-- ===== tU_SODT =====
GO


create trigger tU_SODT on SODT
  for UPDATE
  as
/* ERwin Builtin Sat Feb 09 11:07:39 2002 */
/* UPDATE trigger on SODT */
begin
  declare  @numrows int,
           @nullcnt int,
           @validcnt int,
           @insSOID u_ID, 
           @insListNo u_ListNo,
           @errno   int,
           @errmsg  varchar(255)

  select @numrows = @@rowcount
  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SODT สั่งขาย SOPickingDT ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID) or
    update(ListNo)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID, 
             @insListNo = inserted.ListNo
        from inserted
      update SOPickingDT
      set
        /*  %JoinFKPK(SOPickingDT,@ins," = ",",") */
        SOPickingDT.SOID = @insSOID,
        SOPickingDT.RefListNo = @insListNo
      from SOPickingDT,inserted,deleted
      where
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */
        SOPickingDT.SOID = deleted.SOID and
        SOPickingDT.RefListNo = deleted.ListNo
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SODT UPDATE because more than one row has been affected.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SODT อธิบาย Detail SODTRemark ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID) or
    update(ListNo)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID, 
             @insListNo = inserted.ListNo
        from inserted
      update SODTRemark
      set
        /*  %JoinFKPK(SODTRemark,@ins," = ",",") */
        SODTRemark.SOID = @insSOID,
        SODTRemark.RefListNo = @insListNo
      from SODTRemark,inserted,deleted
      where
        /*  %JoinFKPK(SODTRemark,deleted," = "," and") */
        SODTRemark.SOID = deleted.SOID and
        SODTRemark.RefListNo = deleted.ListNo
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SODT UPDATE because more than one row has been affected.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SODT รายการที่อ้างอิง SODT ON PARENT UPDATE RESTRICT */
  if
    /* %ParentPK(" or",update) */
    update(SOID) or
    update(ListNo)
  begin
    if exists (
      select * from deleted,SODT
      where
        /*  %JoinFKPK(SODT,deleted," = "," and") */
        SODT.RefSOID = deleted.SOID and
        SODT.RefListNo = deleted.ListNo
    )
    begin
      select @errno  = 30005,
             @errmsg = 'Cannot UPDATE SODT because SODT exists.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMJob R/452 SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(JobID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMJob
        where
          /* %JoinFKPK(inserted,EMJob) */
          inserted.JobID = EMJob.JobID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.JobID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMJob does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SOHD R/312 SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(SOID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SOHD
        where
          /* %JoinFKPK(inserted,SOHD) */
          inserted.SOID = SOHD.SOID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
    @errmsg = 'Cannot UPDATE SODT because SOHD does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับStock SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodStockUnitID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodStockUnitID = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodStockUnitID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับ2 SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodUnitID2)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodUnitID2 = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodUnitID2 is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* SODT รายการที่อ้างอิง SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(RefSOID) or
    update(RefListNo)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SODT
        where
          /* %JoinFKPK(inserted,SODT) */
          inserted.RefSOID = SODT.SOID and
          inserted.RefListNo = SODT.ListNo
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.RefSOID is null and
      inserted.RefListNo is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because SODT does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับเปรียบเทียบ SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodCompareUnitID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodCompareUnitID = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodCompareUnitID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMVATGroup VAT Class SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(VATGroupID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMVATGroup
        where
          /* %JoinFKPK(inserted,EMVATGroup) */
          inserted.VATGroupID = EMVATGroup.VATGroupID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.VATGroupID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMVATGroup does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGoodUnit หน่วยนับ1 SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodUnitID1)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGoodUnit
        where
          /* %JoinFKPK(inserted,EMGoodUnit) */
          inserted.GoodUnitID1 = EMGoodUnit.GoodUnitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodUnitID1 is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMGoodUnit does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMInve คลังสินค้า SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(InveID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMInve
        where
          /* %JoinFKPK(inserted,EMInve) */
          inserted.InveID = EMInve.InveID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.InveID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMInve does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMLoca ที่เก็บสินค้า SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(LocaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMLoca
        where
          /* %JoinFKPK(inserted,EMLoca) */
          inserted.LocaID = EMLoca.LocaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.LocaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMLoca does not exist.'
      goto error
    end
  end

  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  /* EMGood สินค้า SODT ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(GoodID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMGood
        where
          /* %JoinFKPK(inserted,EMGood) */
          inserted.GoodID = EMGood.GoodID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.GoodID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SODT because EMGood does not exist.'
      goto error
    end
  end


  /* ERwin Builtin Sat Feb 09 11:07:39 2002 */
  return
error:
    raiserror @errno @errmsg
    rollback transaction
end

GO

-- ===== tU_SOHD =====
GO


create trigger tU_SOHD on SOHD
  for UPDATE
  as
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
/* UPDATE trigger on SOHD */
/* default body for tU_SOHD */
begin
  declare  @numrows int,
           @nullcnt int,
           @validcnt int,
           @insSOID u_ID,
           @errno   int,
           @errmsg  varchar(255)

  select @numrows = @@rowcount
/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMDept R/1154 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(DeptID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMDept
        where
          /* %JoinFKPK(inserted,EMDept) */
          inserted.DeptID = EMDept.DeptID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.DeptID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMDept does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCust R/1153 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CustID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCust
        where
          /* %JoinFKPK(inserted,EMCust) */
          inserted.CustID = EMCust.CustID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CustID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMCust does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMTranspArea R/1152 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(TranspAreaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMTranspArea
        where
          /* %JoinFKPK(inserted,EMTranspArea) */
          inserted.TranspAreaID = EMTranspArea.TranspAreaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.TranspAreaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMTranspArea does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMTransp R/1151 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(TranspID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMTransp
        where
          /* %JoinFKPK(inserted,EMTransp) */
          inserted.TranspID = EMTransp.TranspID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.TranspID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMTransp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCurr R/1150 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CurrID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCurr
        where
          /* %JoinFKPK(inserted,EMCurr) */
          inserted.CurrID = EMCurr.CurrID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CurrID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMCurr does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCurrType R/1149 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CurrTypeID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCurrType
        where
          /* %JoinFKPK(inserted,EMCurrType) */
          inserted.CurrTypeID = EMCurrType.CurrTypeID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CurrTypeID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMCurrType does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMEmp R/1148 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(EmpID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMEmp
        where
          /* %JoinFKPK(inserted,EMEmp) */
          inserted.EmpID = EMEmp.EmpID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.EmpID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMEmp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMBrch R/1147 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(BrchID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMBrch
        where
          /* %JoinFKPK(inserted,EMBrch) */
          inserted.BrchID = EMBrch.BrchID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.BrchID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMBrch does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMSaleArea R/1146 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(SaleAreaID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMSaleArea
        where
          /* %JoinFKPK(inserted,EMSaleArea) */
          inserted.SaleAreaID = EMSaleArea.SaleAreaID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.SaleAreaID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMSaleArea does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMVATGroup R/1145 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(VATGroupID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMVATGroup
        where
          /* %JoinFKPK(inserted,EMVATGroup) */
          inserted.VATGroupID = EMVATGroup.VATGroupID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.VATGroupID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMVATGroup does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMIntroduce R/836 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(IntroduceID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMIntroduce
        where
          /* %JoinFKPK(inserted,EMIntroduce) */
          inserted.IntroduceID = EMIntroduce.IntroduceID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.IntroduceID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMIntroduce does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* EMCreditTerm เครดิตเทอม SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CreditID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCreditTerm
        where
          /* %JoinFKPK(inserted,EMCreditTerm) */
          inserted.CreditID = EMCreditTerm.CreditID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CreditID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because EMCreditTerm does not exist.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/293 SOHD ON CHILD UPDATE RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(RefSOID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SOHD
        where
          /* %JoinFKPK(inserted,SOHD) */
          inserted.RefSOID = SOHD.SOID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.RefSOID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30007,
             @errmsg = 'Cannot UPDATE SOHD because SOHD does not exist.'
      goto error
    end
  end


/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/1228 SOPickingDT ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID
        from inserted
      update SOPickingDT
      set
        /*  %JoinFKPK(SOPickingDT,@ins," = ",",") */
        SOPickingDT.SOID = @insSOID
      from SOPickingDT,inserted,deleted
      where
        /*  %JoinFKPK(SOPickingDT,deleted," = "," and") */
        SOPickingDT.SOID = deleted.SOID
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SOHD UPDATE because more than one row has been affected.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/652 SODT ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID
        from inserted
      update SODT
      set
        /*  %JoinFKPK(SODT,@ins," = ",",") */
        SODT.SOID = @insSOID
      from SODT,inserted,deleted
      where
        /*  %JoinFKPK(SODT,deleted," = "," and") */
        SODT.SOID = deleted.SOID
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SOHD UPDATE because more than one row has been affected.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/293 SOHD ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID
        from inserted
      update SOHD
      set
        /*  %JoinFKPK(SOHD,@ins," = ",",") */
        SOHD.RefSOID = @insSOID
      from SOHD,inserted,deleted
      where
        /*  %JoinFKPK(SOHD,deleted," = "," and") */
        SOHD.RefSOID = deleted.SOID
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SOHD UPDATE because more than one row has been affected.'
      goto error
    end
  end

/* ERwin Builtin Mon Jan 06 15:49:00 2003 */
  /* SOHD R/321 SOHDRemark ON PARENT UPDATE CASCADE */
  if
    /* %ParentPK(" or",update) */
    update(SOID)
  begin
    if @numrows = 1
    begin
      select @insSOID = inserted.SOID
        from inserted
      update SOHDRemark
      set
        /*  %JoinFKPK(SOHDRemark,@ins," = ",",") */
        SOHDRemark.SOID = @insSOID
      from SOHDRemark,inserted,deleted
      where
        /*  %JoinFKPK(SOHDRemark,deleted," = "," and") */
        SOHDRemark.SOID = deleted.SOID
    end
    else
    begin
      select @errno = 30006,
             @errmsg = 'Cannot cascade SOHD UPDATE because more than one row has been affected.'
      goto error
    end
  end


  return
error:
    raiserror @errno @errmsg
    rollback transaction
end

GO
