-- Organizational codes are new internal IDs, not approved accounting codes.
-- Source: 2026 ver.0224 organization chart supplied in this project.
-- No personal names become login users or authority automatically.
-- 세례팀/새벽팀/통역팀 omitted: parent division is cut off in photo.
begin;
insert into public.org_units(id,parent_id,code,name,kind,sort_order) values
('23a70606-4070-5720-8b4d-44c3e2a249de',null,'ONNURI','오클랜드 온누리교회','church',0),
('f2fa6bd8-7a1c-534b-bee3-7b41b113e5bd','23a70606-4070-5720-8b4d-44c3e2a249de','PASTORAL','목회본부','headquarters',1),
('a29e9749-fd9f-5664-97f8-cdd166c23479','23a70606-4070-5720-8b4d-44c3e2a249de','MINISTRY','사역본부','headquarters',2),
('f6b5428c-8150-5c7b-a6cc-55d0fdb9fb89','23a70606-4070-5720-8b4d-44c3e2a249de','OPERATIONS','운영본부','headquarters',3),
('7964f71b-64d8-5c72-8ca3-21999558a182','f2fa6bd8-7a1c-534b-bee3-7b41b113e5bd','COMMUNITY','공동체분과','division',4),
('095e9ab5-0a1f-5e64-bd85-11cc33ea4823','7964f71b-64d8-5c72-8ca3-21999558a182','COMMUNITY_01','새가족팀','team',5),
('4559cc66-1fe2-58be-bb10-22c8692b02c3','7964f71b-64d8-5c72-8ca3-21999558a182','COMMUNITY_02','순/다락방','team',6),
('a16cd44b-b0fe-5f59-93e5-b9ddce99b65c','f2fa6bd8-7a1c-534b-bee3-7b41b113e5bd','NEXTGEN','차세대분과','division',7),
('3a695b92-0ccd-54ec-9bf8-5893aca9e2d0','a16cd44b-b0fe-5f59-93e5-b9ddce99b65c','NEXTGEN_01','예수님의 꿈아이','team',8),
('615ebad0-bbf3-576e-b10e-22f853006d32','a16cd44b-b0fe-5f59-93e5-b9ddce99b65c','NEXTGEN_02','꿈이 자라는 땅','team',9),
('3eaa8c6b-669e-57bd-9034-1e400b93a46e','a16cd44b-b0fe-5f59-93e5-b9ddce99b65c','NEXTGEN_03','파워웨이브','team',10),
('b6712433-b92b-5c64-9dd4-8dc3377b62a6','f2fa6bd8-7a1c-534b-bee3-7b41b113e5bd','YOUNG','대학청년분과','division',11),
('dbd9eedd-d31f-54ad-a53f-de6be9fc4353','b6712433-b92b-5c64-9dd4-8dc3377b62a6','YOUNG_01','홀리임팩트','team',12),
('fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','a29e9749-fd9f-5664-97f8-cdd166c23479','WORSHIP','예배분과','division',13),
('6e00046b-52cf-5b86-80d7-42096c02d225','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_01','주일예배팀 1·2','team',14),
('ae3c3ddd-2f9f-5675-a208-a12cbee0ce9b','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_02','수요예배팀','team',15),
('ee9217d1-f74f-5a39-aaf4-a7b6e97d5ba9','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_03','음향팀','team',16),
('7f4c5b7a-7759-5c16-a832-334d5c8e2499','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_04','미디어팀','team',17),
('ff2c7d57-b07c-5df1-bf14-e6a1a598a9ea','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_05','데코팀','team',18),
('c65c9857-398a-5b99-95a9-0854b39734b9','fe5fa580-92c3-5c20-b527-fb2ee0e8c5e9','WORSHIP_06','성찬팀','team',19),
('0c59bb2b-7dfa-543b-afde-b7765138de0d','a29e9749-fd9f-5664-97f8-cdd166c23479','NURTURE','양육분과','division',20),
('6b4961ad-8bc8-5c1f-a588-c73eecf3c02c','0c59bb2b-7dfa-543b-afde-b7765138de0d','NURTURE_01','일대일양육','team',21),
('69bd2db7-fe5e-5810-8dee-88bba8968a49','0c59bb2b-7dfa-543b-afde-b7765138de0d','NURTURE_02','통독/필사','team',22),
('508ca17c-cbbe-5d8a-951e-4b20537656dd','0c59bb2b-7dfa-543b-afde-b7765138de0d','NURTURE_03','스쿨','team',23),
('f9efc9a4-680d-5f0a-b647-d9dd2742be94','a29e9749-fd9f-5664-97f8-cdd166c23479','MISSION','선교분과','division',24),
('6e7d9fba-b565-545a-8727-689ca4d80574','f6b5428c-8150-5c7b-a6cc-55d0fdb9fb89','FINANCE','재정분과','division',25),
('c2d97116-8c5a-55a6-bd77-4a474fb1e638','6e7d9fba-b565-545a-8727-689ca4d80574','FINANCE_01','헌금계수팀','team',26),
('d501c7fb-efc7-5524-b167-ed52d7709d65','6e7d9fba-b565-545a-8727-689ca4d80574','FINANCE_02','회계','team',27),
('218711a5-2eee-57dc-b93f-da30e77943bc','f6b5428c-8150-5c7b-a6cc-55d0fdb9fb89','FACILITIES','시설운영분과','division',28),
('0223905e-cb69-50dc-940b-b86daa9c9a07','218711a5-2eee-57dc-b93f-da30e77943bc','FACILITIES_01','시설팀','team',29),
('191a37d1-4ace-5fc1-8c76-690cbdda998c','218711a5-2eee-57dc-b93f-da30e77943bc','FACILITIES_02','주차팀','team',30),
('3c9252e0-b16d-5bdb-b13e-edcf5c9fd84c','218711a5-2eee-57dc-b93f-da30e77943bc','FACILITIES_03','셔틀팀','team',31),
('41759c8b-2962-5173-b831-11f509e712e7','218711a5-2eee-57dc-b93f-da30e77943bc','FACILITIES_04','러빙핸드','team',32),
('dc7e5823-743d-5472-9a83-d41405c700a0','f6b5428c-8150-5c7b-a6cc-55d0fdb9fb89','SERVICE','봉사분과','division',33),
('0a415b83-f8ef-5849-a3ce-e2f40a6ef9a5','dc7e5823-743d-5472-9a83-d41405c700a0','SERVICE_01','안내팀','team',34),
('dd514053-460c-5973-928b-f4647c3890e9','dc7e5823-743d-5472-9a83-d41405c700a0','SERVICE_02','애찬팀','team',35),
('aade5dbe-36fe-5423-bc44-70f5fc6a49c9','dc7e5823-743d-5472-9a83-d41405c700a0','SERVICE_03','토요애찬팀','team',36);
insert into public.workflow_versions(id,version) values('4d0ba4cf-40e1-5d8c-a302-ee2e6f82f7a8',1);
insert into public.workflow_steps(workflow_id,position,label,role,kind) values
('4d0ba4cf-40e1-5d8c-a302-ee2e6f82f7a8',1,'팀장','team_leader','approval'),
('4d0ba4cf-40e1-5d8c-a302-ee2e6f82f7a8',2,'부서장','department_head','approval'),
('4d0ba4cf-40e1-5d8c-a302-ee2e6f82f7a8',3,'비전위원','vision_member','approval'),
('4d0ba4cf-40e1-5d8c-a302-ee2e6f82f7a8',4,'지급 담당자','payment_officer','payment');
commit;
