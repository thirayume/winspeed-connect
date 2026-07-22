/*******************************************/
/**********  Create Trigger ****************/
 create trigger tI_ICCountHD on ICCountHD    
  for INSERT    
  as    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
/* INSERT trigger on ICCountHD */    
/* default body for tI_ICCountHD */    
begin    
  declare  @numrows int,    
           @nullcnt int,    
           @validcnt int,    
           @insDocuID u_ID,    
           @errno   int,    
           @errmsg  varchar(255)    
    
  select @numrows = @@rowcount    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMEmp R/1753 ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(PermitEmpID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMEmp    
        where    
          /* %JoinFKPK(inserted,EMEmp) */    
          inserted.PermitEmpID = EMEmp.EmpID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.PermitEmpID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMEmp does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMJob R/1470 ICCountHD ON CHILD INSERT RESTRICT */    
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
             @errmsg = 'Cannot INSERT ICCountHD because EMJob does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMEmp FK_EMEmpl_ICCountHD_CountEmplID ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(CountEmpID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMEmp    
        where    
          /* %JoinFKPK(inserted,EMEmp) */    
          inserted.CountEmpID = EMEmp.EmpID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.CountEmpID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMEmp does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMEmp FK_EMEmpl_ICCountHD_AuditEmplID ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(AuditEmpID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMEmp    
        where    
          /* %JoinFKPK(inserted,EMEmp) */    
          inserted.AuditEmpID = EMEmp.EmpID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.AuditEmpID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMEmp does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMEmp FK_EMEmpl_ICCountHD_AdjustEmplID ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(AdjustEmpID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMEmp    
        where    
          /* %JoinFKPK(inserted,EMEmp) */    
          inserted.AdjustEmpID = EMEmp.EmpID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.AdjustEmpID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMEmp does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMBrch FK_EMBrch_ICCountHD ICCountHD ON CHILD INSERT RESTRICT */    
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
             @errmsg = 'Cannot INSERT ICCountHD because EMBrch does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMDept R/432 ICCountHD ON CHILD INSERT RESTRICT */    
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
             @errmsg = 'Cannot INSERT ICCountHD because EMDept does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMGoodGroup R_EMGoodGroup_ICCountHD ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(GoodGroupID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMGoodGroup    
        where    
          /* %JoinFKPK(inserted,EMGoodGroup) */    
          inserted.GoodGroupID = EMGoodGroup.GoodGroupID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.GoodGroupID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMGoodGroup does not exist.'    
      goto error    
    end    
  end    
    
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* EMGoodBrand FK_EMGoodBrand_ICCountHD ICCountHD ON CHILD INSERT RESTRICT */    
  if    
    /* %ChildFK(" or",update) */    
    update(GoodBrandID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,EMGoodBrand    
        where    
          /* %JoinFKPK(inserted,EMGoodBrand) */    
          inserted.GoodBrandID = EMGoodBrand.GoodBrandID    
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
    select @nullcnt = count(*) from inserted where    
      inserted.GoodBrandID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because EMGoodBrand does not exist.'    
      goto error    
    end    
  end    
   
   
/* ERwin Builtin Tue Oct 01 19:17:27 2002 */    
  /* ICStockHD  ICCountHD ON CHILD INSERT RESTRICT */    
/*  if  */  
    /* %ChildFK(" or",update) */    
/*    update(RefDocuID)    
  begin    
    select @nullcnt = 0    
    select @validcnt = count(*)    
      from inserted,ICStockHD    
        where    */  
          /* %JoinFKPK(inserted,ICStockHD) */    
   /*       inserted.RefDocuID = ICStockHD.DocuID  */  
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */    
  /*  select @nullcnt = count(*) from inserted where    
      inserted.RefDocuID is null    
    if @validcnt + @nullcnt != @numrows    
    begin    
      select @errno  = 30002,    
             @errmsg = 'Cannot INSERT ICCountHD because ICStockHD does not exist.'    
      goto error    
    end    
  end   */  
    
    
  return    
error:    
    raiserror @errno @errmsg    
    rollback transaction    
end    
