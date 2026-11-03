import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSteps,defaultSteps,canManage,safeNext} from '../src/lib/domain.ts';
test('기본 결재선은 팀장 → 부서장 → 비전위원 → 지급',()=>{assert.deepEqual(validateSteps(defaultSteps),defaultSteps);});
test('이름 변경·단계 추가·순서 변경 허용',()=>{const steps=[defaultSteps[1],{...defaultSteps[0],label:'담당 팀장'},{label:'추가 승인',role:'vision_member',kind:'approval'},defaultSteps[2],defaultSteps[3]];assert.equal(validateSteps(steps).length,5);});
test('지급 순서·역할·누락·중복 검증',()=>{for(const steps of [[defaultSteps[3],defaultSteps[0]],[defaultSteps[0],defaultSteps[1]],[defaultSteps[0],{...defaultSteps[3],role:'team_leader'}],[defaultSteps[0],defaultSteps[0],defaultSteps[3]],[defaultSteps[0],{...defaultSteps[1],role:'admin'},defaultSteps[3]],[],null])assert.throws(()=>validateSteps(steps));});
test('라벨 정리 및 길이 제한',()=>{assert.equal(validateSteps([{...defaultSteps[0],label:' 팀장 '},defaultSteps[3]])[0].label,'팀장');assert.throws(()=>validateSteps([{...defaultSteps[0],label:' '},defaultSteps[3]]));assert.throws(()=>validateSteps([{...defaultSteps[0],label:'가'.repeat(51)},defaultSteps[3]]));});
test('일반 승인자는 설정 권한 없음',()=>{assert.equal(canManage('admin'),true);for(const role of ['applicant','team_leader','department_head','vision_member','payment_officer','auditor',''])assert.equal(canManage(role),false);});
test('리디렉션 외부 경로 차단',()=>{for(const path of ['//evil.test','https://evil.test','/\\evil','/\n/evil',null])assert.equal(safeNext(path),'/dashboard');assert.equal(safeNext('/organizations'),'/organizations');});
