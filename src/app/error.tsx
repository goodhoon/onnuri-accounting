"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="auth"><section className="panel"><h1>요청을 처리하지 못했습니다</h1><p>연결 상태와 권한을 확인한 후 다시 시도해 주세요.</p><button onClick={reset}>다시 시도</button></section></main>;}
