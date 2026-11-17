-- Synthetic rehearsal data only. Apply after Liquibase update to a disposable database.
DO $$
DECLARE
  workspace_id_value integer;
  person_id_value integer;
  info_id_value integer;
  booklet_id_value integer;
  unit_id_value integer;
  response_id_value integer;
  job_id_value integer;
BEGIN
  IF strpos(current_database(), 'pr1186_migration') <> 1 THEN
    RAISE EXCEPTION 'This fixture is restricted to disposable pr1186_migration* databases';
  END IF;
  INSERT INTO workspace(name) VALUES ('Migration ÄÖÜ ß 🙂') RETURNING id INTO workspace_id_value;
  INSERT INTO persons(workspace_id,"group",login,code,consider)
    VALUES(workspace_id_value,'Gruppe Ä','migration-login','migration-code',true) RETURNING id INTO person_id_value;
  INSERT INTO bookletinfo(name,size) VALUES('MIGRATION',0) RETURNING id INTO info_id_value;
  INSERT INTO booklet(infoid,personid) VALUES(info_id_value,person_id_value) RETURNING id INTO booklet_id_value;
  INSERT INTO unit(bookletid,name,alias) VALUES(booklet_id_value,'MIGRATION-UNIT','Migration-Ä') RETURNING id INTO unit_id_value;
  INSERT INTO response(unitid,variableid,status,value,subform,status_v1,code_v1,score_v1,status_v2,code_v2,score_v2,status_v3,code_v3,score_v3)
    VALUES(unit_id_value,'V1',3,'{"answer":[0,true,null,"Äß🙂"]}','',5,7,2,5,8,3,5,9,4)
    RETURNING id INTO response_id_value;
  INSERT INTO response(unitid,variableid,status,value,subform,status_v1,code_v1,score_v1,code_v3)
    VALUES(unit_id_value,'V2',3,'"  whitespace\nunchanged  "','a',5,-99,0,2147483647),
          (unit_id_value,'V3',1,NULL,'',NULL,NULL,NULL,NULL);
  INSERT INTO chunk(unitid,key,type,variables,ts)
    VALUES(unit_id_value,'a','state','V1,V2',10),(unit_id_value,'b','state','V3',20),
          (unit_id_value,'b','state','V3',20);
  INSERT INTO unitlaststate(unitid,key,value) VALUES(unit_id_value,'PAGE','1'),(unit_id_value,'STATUS','done');
  INSERT INTO bookletlog(bookletid,key,parameter,ts)
    VALUES(booklet_id_value,'test','same',10),(booklet_id_value,'test','same',10);
  INSERT INTO unitlog(unitid,key,parameter,ts)
    VALUES(unit_id_value,'test','Ä🙂',10),(unit_id_value,'test','Ä🙂',10);
  INSERT INTO session(bookletid,browser,os,screen,ts)
    VALUES(booklet_id_value,'test-browser','test-os','1920x1080',10),
          (booklet_id_value,'test-browser','test-os','1920x1080',10);
  INSERT INTO file_upload(workspace_id,filename,file_id,file_type,data)
    VALUES(workspace_id_value,'migration.voud','MIGRATION-UNIT','Unit','<Unit>Äß🙂</Unit>');
  INSERT INTO coding_job(workspace_id,name) VALUES(workspace_id_value,'Migration coding') RETURNING id INTO job_id_value;
  INSERT INTO coding_job_unit(coding_job_id,response_id,unit_name,variable_id,variable_anchor,booklet_name,person_login,person_code,code,score)
    VALUES(job_id_value,response_id_value,'MIGRATION-UNIT','V1','anchor','MIGRATION','migration-login','migration-code',7,2);
END $$;
