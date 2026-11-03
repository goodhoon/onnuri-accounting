import './globals.css';
import type {Metadata} from 'next';
export const dynamic='force-dynamic';
export const metadata: Metadata={title:'온누리 재정 | AKL Onnuri',description:'오클랜드 온누리교회 재정 관리',robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>;}
