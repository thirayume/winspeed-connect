Text                                                                                                                                                                                                                                                           
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------


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
                                                                                                                                                                                                                 
  /* EMCreditTerm ?????????? SOHD ON CHILD INSERT RESTRICT */
                                                                                                                                                                                                
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
                                                                                                                                                                                                                                                          
