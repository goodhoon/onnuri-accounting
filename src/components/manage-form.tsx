"use client";
import {useActionState} from 'react';import {manage} from '@/app/manage-actions';
export default function ManageForm({operation,children}:{operation:string;children:React.ReactNode}){const [state,action,pending]=useActionState(manage,{error:'',success:''});return <form action={action} className="stack"><input type="hidden" name="operation" value={operation}/>{children}{state.error&&<p role="alert" className="error">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}<button disabled={pending}>{pending?'저장 중…':'저장'}</button></form>;}
