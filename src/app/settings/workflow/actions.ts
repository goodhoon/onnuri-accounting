"use server";
import {revalidatePath} from 'next/cache';
import {requireMember} from '@/lib/session';
import {validateSteps} from '@/lib/domain';
export async function saveWorkflow(_: {error:string;success:string},form:FormData){const s=await requireMember();if(!s.isAdmin)return {error:'관리자 권한이 필요합니다.',success:''};let steps;try{steps=validateSteps(JSON.parse(String(form.get('steps')??'')));}catch(e){return {error:e instanceof Error?e.message:'결재선을 확인해 주세요.',success:''};}const {error}=await s.db.rpc('save_workflow',{p_steps:steps,p_expected_version:Number(form.get('version'))});if(error)return {error:error.message.includes('version conflict')?'다른 관리자가 변경했습니다. 새로고침 후 다시 시도해 주세요.':'저장하지 못했습니다. 결재선과 연결 상태를 확인해 주세요.',success:''};revalidatePath('/settings/workflow');revalidatePath('/dashboard');return {error:'',success:'새 결재선 버전을 저장했습니다.'};}
