"use server";
import {revalidatePath} from 'next/cache';import {requireMember} from '@/lib/session';
export async function manage(_: {error:string;success:string},form:FormData){const s=await requireMember();if(!s.isAdmin)return {error:'관리자 권한이 필요합니다.',success:''};const v=(k:string)=>String(form.get(k)??'');let name:string,args:Record<string,unknown>;switch(v('operation')){
case 'year':name='save_year';args={p_id:v('id')||null,p_name:v('name'),p_start:v('start'),p_end:v('end'),p_closed:v('closed')==='true'};break;
case 'account':name='save_account';args={p_id:v('id')||null,p_group:v('group'),p_name:v('name'),p_active:v('active')!=='false'};break;
case 'event':name='save_event';args={p_id:v('id')||null,p_name:v('name'),p_org:v('org'),p_start:v('start'),p_end:v('end'),p_active:v('active')!=='false'};break;
case 'org':name='create_org';args={p_parent:v('parent'),p_name:v('name'),p_kind:v('kind')};break;
case 'budget':name='adjust_budget';args={p_year:v('year'),p_org:v('org'),p_event:v('event')||null,p_account:v('account'),p_delta:v('delta'),p_reason:v('reason'),p_expected_revision:Number(v('revision'))};break;
case 'transfer':name='transfer_budget';args={p_from:v('from'),p_to:v('to'),p_amount:v('amount'),p_reason:v('reason'),p_from_revision:Number(v('from_revision')),p_to_revision:Number(v('to_revision'))};break;
default:return {error:'지원하지 않는 요청입니다.',success:''};}
const {error}=await s.db.rpc(name,args);if(error){const message=error.message;const rules:Record<string,string>={'version conflict':'다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 시도해 주세요.','overlapping fiscal year':'회계연도 기간이 기존 연도와 겹칩니다.','dates already in use':'예산이 있는 회계연도의 날짜는 변경할 수 없습니다.','closed':'마감된 회계연도는 변경할 수 없습니다.','negative allocation':'예산을 0 미만으로 줄일 수 없습니다.','insufficient':'이동할 예산이 부족합니다.','event mismatch':'행사 소속이나 기간이 예산과 맞지 않습니다.','invalid money':'금액은 숫자로, 소수 둘째 자리까지 입력해 주세요.','same allocation':'서로 다른 예산 항목을 선택해 주세요.','inactive':'비활성 조직·계정·행사는 사용할 수 없습니다.','hierarchy':'상위 조직과 조직 유형이 맞지 않습니다.','zero adjustment':'0원 변경은 저장할 수 없습니다.'};return {error:Object.entries(rules).find(([k])=>message.includes(k))?.[1]??'저장하지 못했습니다. 필수 항목과 날짜·권한을 확인해 주세요.',success:''};}
for(const path of ['/dashboard','/organizations','/settings/years','/settings/accounts','/events','/budgets'])revalidatePath(path);return {error:'',success:'저장했습니다.'};}
