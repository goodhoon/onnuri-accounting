import Shell from '@/components/shell';
import {requireMember} from '@/lib/session';
import {openNotification,readAll} from './actions';
export default async function Notifications(){
 const s=await requireMember();const {data,error}=await s.db.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);
 if(error)throw new Error('알림을 불러오지 못했습니다. Day 4 SQL 적용 여부를 확인하세요.');
 return <Shell name={s.profile.display_name} admin={s.isAdmin}><header><h1>알림함</h1><p>최근 100건 · 새 알림은 페이지를 이동하거나 새로고침하면 표시됩니다.</p></header><form action={readAll}><button>모두 읽음</button></form><section className="panel">{!data?.length&&<p>받은 알림이 없습니다.</p>}{data?.map(n=><article className="history-row" key={n.id}><b>{!n.read_at&&!n.resolved_at?'● ':''}{n.title}</b><p>{n.message}</p><span>{n.resolved_at?'처리 종료':n.read_at?'읽음':'읽지 않음'}</span><time>{new Date(n.created_at).toLocaleString('ko-KR',{timeZone:'Pacific/Auckland'})} (NZ)</time><form action={openNotification}><input type="hidden" name="id" value={n.id}/><button>신청서 보기</button></form></article>)}</section></Shell>;
}
