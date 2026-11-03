import Link from 'next/link';
import {redirect} from 'next/navigation';
import {isConfigured} from '@/lib/supabase/server';
export default function Home(){
 if(isConfigured()) redirect('/dashboard');
 return <main className="welcome"><div className="brand">O<span>온누리 재정</span></div><div className="eyebrow">AKL ONNURI · FINANCE</div><h1>함께 맡은 재정,<br/>투명하게 이어갑니다.</h1><p className="lead">오클랜드 온누리교회 회계 시스템</p><section className="notice"><span className="badge">연결 준비 중</span><h2>로그인 환경을 연결해 주세요</h2><p>사용자와 재정 정보를 안전하게 관리하기 위해 Supabase 연결이 필요합니다. 연결 전에는 로그인과 데이터 저장이 비활성화됩니다.</p><p className="small">설치 안내의 환경 변수 설정과 데이터베이스 적용을 완료한 후 시작할 수 있습니다.</p></section><div className="flow">신청자 <b>→</b> 팀장 <b>→</b> 부서장 <b>→</b> 비전위원 <b>→</b> 지급 담당자</div><footer>Day 1 · 로그인 / 조직 / 권한 / 결재선 기반 구현</footer></main>;
}
