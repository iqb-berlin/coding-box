INSERT INTO login_session_groups (group_label, group_name, token, workspace_id, last_modified) VALUES ('Compatibility fixture', 'compatibility-fixture', 'fixture-group-token', 1, '2026-11-04 12:00:00');
INSERT INTO login_sessions (id,name,workspace_id,group_name,token) VALUES (9101,'fixture-person',1,'compatibility-fixture','fixture-login-token');
INSERT INTO person_sessions (id,code,login_sessions_id,valid_until,token,name_suffix) VALUES (9101,'fixture-code',9101,'2030-01-01 00:00:00','fixture-person-token','');
INSERT INTO tests (id,name,file_id,person_id,laststate,locked,label,running,timestamp_server) VALUES (9101,'BOOKLET.SAMPLE-1','BOOKLET.SAMPLE-1',9101,'{}',false,'Compatibility fixture',true,'2026-11-04 12:00:00');
INSERT INTO units (name,test_id,laststate,original_unit_id) VALUES ('UNIT.SAMPLE',9101,'{"PRESENTATIONCOMPLETE":"yes"}','UNIT.SAMPLE');
INSERT INTO unit_data (unit_name,test_id,part_id,content,ts,response_type) VALUES ('UNIT.SAMPLE',9101,'main','[{"id":"FIXTURE_VAR","value":1,"status":"VALUE_CHANGED"}]',1793793600000,'iqb-standard@1.0');
INSERT INTO unit_logs (unit_name,test_id,logentry,"timestamp") VALUES ('UNIT.SAMPLE',9101,'FOCUS=IN',1793793600000);
INSERT INTO test_logs (booklet_id,logentry,"timestamp") VALUES (9101,'STARTED=1',1793793600000);
