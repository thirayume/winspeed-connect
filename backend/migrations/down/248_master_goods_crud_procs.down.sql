-- Rollback of 248: remove the goods / goods group procedures. Rows they created stay; WinSpeed owns them.
IF OBJECT_ID('wf.sp_MasterDeleteGood', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterDeleteGood;
IF OBJECT_ID('wf.sp_MasterSetGoodStatus', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterSetGoodStatus;
IF OBJECT_ID('wf.sp_MasterUpdateGood', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterUpdateGood;
IF OBJECT_ID('wf.sp_MasterCreateGood', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterCreateGood;
IF OBJECT_ID('wf.sp_MasterDeleteGoodGroup', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterDeleteGoodGroup;
IF OBJECT_ID('wf.sp_MasterSaveGoodGroup', 'P') IS NOT NULL DROP PROCEDURE wf.sp_MasterSaveGoodGroup;
