export const accountGroups: Record<string,string>={'41':'헌금수입','42':'활동수입','43':'기타수입','51':'인건비','52':'일반운영비','53':'시설비','54':'교육·사역비','55':'교통·여비','56':'장비비','57':'선교·구제비','58':'분담금','59':'기타지출'};
export function cents(value:string):bigint{if(!/^-?\d{1,12}(\.\d{1,2})?$/.test(value))throw new Error('금액은 소수 둘째 자리까지 입력해 주세요.');const neg=value.startsWith('-'),[a,b='']=value.replace('-','').split('.');return (BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(neg?-1n:1n);}
export function totalMoney(values:string[]):string{const n=values.reduce((a,b)=>a+cents(b),0n);return `${n<0n?'-':''}${(n<0n?-n:n)/100n}.${((n<0n?-n:n)%100n).toString().padStart(2,'0')}`;}
export function money(value:string|number){return Number(value).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});}
export type Option={id:string;name:string};
