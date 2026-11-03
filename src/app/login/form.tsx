"use client";
import {useActionState} from 'react';
import {login} from './actions';
export default function LoginForm(){const [state,action,pending]=useActionState(login,{error:''});return <form action={action} className="stack"><label>이메일<input type="email" name="email" autoComplete="username" required maxLength={254}/></label><label>비밀번호<input type="password" name="password" autoComplete="current-password" required maxLength={1024}/></label>{state.error&&<p role="alert" className="error">{state.error}</p>}<button disabled={pending}>{pending?'로그인 중…':'로그인'}</button><p className="small">계정은 교회 관리자를 통해 등록합니다.</p></form>;}
