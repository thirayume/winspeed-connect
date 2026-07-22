
create trigger tI_SOInvHD on SOInvHD
  for INSERT
  as
/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
/* INSERT trigger on SOInvHD */
/* default body for tI_SOInvHD */
begin
  declare  @numrows int,
           @nullcnt int,
           @validcnt int,
           @insSOInvID u_ID,
           @errno   int,
           @errmsg  varchar(255)

  select @numrows = @@rowcount
/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCNRemarkType R/2087 SOInvHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CNRemarkTypeID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCNRemarkType
        where
          /* %JoinFKPK(inserted,EMCNRemarkType) */
          inserted.CNRemarkTypeID = EMCNRemarkType.CNRemarkTypeID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CNRemarkTypeID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because EMCNRemarkType does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* CSCommit R/1820 SOInvHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(CSCommitID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,CSCommit
        where
          /* %JoinFKPK(inserted,CSCommit) */
          inserted.CSCommitID = CSCommit.CSCommitID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.CSCommitID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because CSCommit does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMJob R/1765 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMJob does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* SMSat R/1180 SOInvHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(PostID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,SMSat
        where
          /* %JoinFKPK(inserted,SMSat) */
          inserted.PostID = SMSat.GlobalID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.PostID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because SMSat does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMIntroduce R/835 SOInvHD ON CHILD INSERT RESTRICT */
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
      inserted.IntroduceID is n
ull
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because EMIntroduce does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCust R/819 SOInvHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(ARID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted,EMCust
        where
          /* %JoinFKPK(inserted,EMCust) */
          inserted.ARID = EMCust.CustID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.ARID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because EMCust does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCust R/765 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMCust does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMTransp R/764 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMTransp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMTranspArea R/763 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMTranspArea does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMSaleArea R/762 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMSaleArea does not exist.'
      goto error
    end
  end


/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCurrType R/761 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMCurrType does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCurr R/760 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMCurr does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMBrch R/759 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMBrch does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMEmp R/758 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMEmp does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMVATGroup R/757 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMVATGroup does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMDept R/756 SOInvHD ON CHILD INSERT RESTRICT */
  if
    /* %ChildFK(" or",update) */
    update(DeptID)
  begin
    select @nullcnt = 0
    select @validcnt = count(*)
      from inserted
,EMDept
        where
          /* %JoinFKPK(inserted,EMDept) */
          inserted.DeptID = EMDept.DeptID
    /* %NotnullFK(inserted," is null","select @nullcnt = count(*) from inserted where"," and") */
    select @nullcnt = count(*) from inserted where
      inserted.DeptID is null
    if @validcnt + @nullcnt != @numrows
    begin
      select @errno  = 30002,
             @errmsg = 'Cannot INSERT SOInvHD because EMDept does not exist.'
      goto error
    end
  end

/* ERwin Builtin Thu Aug 14 08:48:34 2003 */
  /* EMCreditTerm R/323 SOInvHD ON CHILD INSERT RESTRICT */
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
             @errmsg = 'Cannot INSERT SOInvHD because EMCreditTerm does not exist.'
      goto error
    end
  end



  return
error:
    raiserror @errno @errmsg
    rollback transaction
end

