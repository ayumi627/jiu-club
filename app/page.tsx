'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {User} from '@supabase/supabase-js';
import {Coffee,Wallet,Users,Plus,LogOut,ReceiptText,ImageUp,ChevronRight,Copy,Check,Trash2} from 'lucide-react';

type Club={id:string;name:string;invite_code:string};
type Member={user_id:string;nickname:string;role:string};
type Campaign={id:string;club_id:string;title:string;shop:string;closes_at:string;status:string};
type Product={id:string;campaign_id:string;name:string;price:number};
type Topup={id:string;club_id:string;user_id:string;amount:number;note:string;status:string;created_at:string};
type Order={id:string;campaign_id:string;user_id:string;total:number;status:string;created_at:string};
type Ledger={id:string;user_id:string;delta:number;type:string;note:string;created_at:string};
const money=(n:number)=>'NT$ '+Number(n).toLocaleString('zh-TW');
const fmt=(x:string)=>new Date(x).toLocaleString('zh-TW',{hour12:false});
const errorMsg=(x:unknown)=>x instanceof Error ? x.message:String(x);
const toLocal=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
export default function Home(){
 const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [clubs,setClubs]=useState<Club[]>([]),[clubId,setClubId]=useState(''),[members,setMembers]=useState<Member[]>([]);
 const [campaigns,setCampaigns]=useState<Campaign[]>([]),[products,setProducts]=useState<Product[]>([]),[topups,setTopups]=useState<Topup[]>([]),[orders,setOrders]=useState<Order[]>([]),[ledger,setLedger]=useState<Ledger[]>([]);
 const [tab,setTab]=useState<'campaigns'|'wallet'|'account'>('campaigns'),[selected,setSelected]=useState(''),[amount,setAmount]=useState('300'),[note,setNote]=useState('');
 const [clubName,setClubName]=useState(''),[nickname,setNickname]=useState(''),[invite,setInvite]=useState('');
 const [title,setTitle]=useState(''),[shop,setShop]=useState(''),[closes,setCloses]=useState(()=>toLocal(new Date(Date.now()+86400000)));
 const [productName,setProductName]=useState(''),[productPrice,setProductPrice]=useState(''),[cart,setCart]=useState<Record<string,number>>({});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[balances,setBalances]=useState<Record<string,number>>({});
 const client=useMemo(()=>{try{return supabase()}catch{return null}},[]);
 const selectedClub=clubs.find(c=>c.id===clubId), current=campaigns.find(c=>c.id===selected),member=members.find(m=>m.user_id===user?.id),isAdmin=member?.role==='admin';
 const currentProducts=products.filter(p=>p.campaign_id===selected), total=currentProducts.reduce((s,p)=>s+(cart[p.id]||0)*p.price,0);
 const balance=balances[user?.id||'']||0;
 const notify=(x:string)=>{setMessage(x);window.setTimeout(()=>setMessage(''),5500)};
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn()}catch(e){notify('操作失敗：'+errorMsg(e))}finally{setBusy(false)}};
 const rpc=async(name:string,args:Record<string,unknown>)=>{if(!client)throw Error('尚未設定 Supabase');const {data,error}=await client.rpc(name,args);if(error)throw error;return data};
 const loadClubs=useCallback(async(uid:string)=>{
   if(!client)return;
   const {data:ms,error}=await client.from('memberships').select('club_id').eq('user_id',uid);
   if(error)throw error;
   const ids=(ms||[]).map((x:{club_id:string})=>x.club_id);
   if(!ids.length){setClubs([]);setClubId('');return}
   const {data,error:err}=await client.from('clubs').select('*').in('id',ids).order('created_at',{ascending:false});
   if(err)throw err;
   setClubs(data||[]);setClubId(old=>ids.includes(old)?old:ids[0]);
 },[client]);
 const reload=useCallback(async()=>{
   if(!client||!clubId||!user)return;
   const queries=await Promise.all([
     client.from('memberships').select('*').eq('club_id',clubId),
     client.from('campaigns').select('*').eq('club_id',clubId).order('created_at',{ascending:false}),
     client.from('topup_requests').select('*').eq('club_id',clubId).order('created_at',{ascending:false}),
     client.from('orders').select('*').eq('club_id',clubId).order('created_at',{ascending:false}),
     client.from('ledger').select('*').eq('club_id',clubId).order('created_at',{ascending:false})]);
   for(const q of queries)if(q.error)throw q.error;
   const mm=queries[0].data||[],cc=queries[1].data||[];
   setMembers(mm);setCampaigns(cc);setTopups(queries[2].data||[]);setOrders(queries[3].data||[]);setLedger(queries[4].data||[]);
   const ids=cc.map(x=>x.id);
   if(ids.length){const {data,error}=await client.from('products').select('*').in('campaign_id',ids);if(error)throw error;setProducts(data||[])}else setProducts([]);
   setSelected(old=>ids.includes(old)?old:(ids[0]||''));
   const admins=mm.some(m=>m.user_id===user.id&&m.role==='admin');
   const target=admins?mm.map(x=>x.user_id):[user.id];
   const result=await Promise.all(target.map(async(id)=>{
     const {data,error}=await client.rpc('balance_for',{cid:clubId,uid:id});
     if(error)throw error;return [id,Number(data)] as const;
   }));setBalances(Object.fromEntries(result));
 },[client,clubId,user]);
 useEffect(()=>{
   if(!client){setReady(true);return}
   client.auth.getUser().then(({data})=>{setUser(data.user);setReady(true)});
   const {data:{subscription}}=client.auth.onAuthStateChange((_event,s)=>{setUser(s?.user||null)});
   return ()=>subscription.unsubscribe();
 },[client]);
 useEffect(()=>{if(user)loadClubs(user.id).catch(e=>notify(errorMsg(e)));else{setClubs([]);setClubId('')}},[user,loadClubs]);
 useEffect(()=>{if(clubId&&user)reload().catch(e=>notify(errorMsg(e)))},[clubId,user,reload]);
 const authenticate=async(signup:boolean)=>run(async()=>{
   if(!client)throw Error('請先設定環境變數');
   const {error}=signup?await client.auth.signUp({email,password}):await client.auth.signInWithPassword({email,password});
   if(error)throw error;notify(signup?'註冊成功；若已啟用郵件驗證，請先收信啟用帳號':'登入成功');
 });
 const google=()=>run(async()=>{if(!client)throw Error('Supabase 未設定');const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin}});if(error)throw error});
 const submitTopup=()=>run(async()=>{if(!Number.isInteger(Number(amount))||Number(amount)<=0)throw Error('請輸入正確金額');await rpc('request_topup',{p_club:clubId,p_amount:Number(amount),p_note:note});setNote('');notify('儲值申請已送出，管理員確認收到款項後才會入帳');await reload()});
 const addProduct=(name=productName,price=Number(productPrice))=>run(async()=>{await rpc('add_product',{p_campaign:selected,p_name:name,p_price:price});setProductName('');setProductPrice('');notify('商品已新增');await reload()});
 const recognize=async(file:File)=>run(async()=>{
   if(file.size>6_000_000)throw Error('圖片不能超過 6 MB');
   if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('僅支援 JPG、PNG、WebP');
   if(!client)throw Error('登入失敗');
   const {data:{session}}=await client.auth.getSession();if(!session)throw Error('請重新登入');
   const raw=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('圖片讀取失敗'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file)});
   const r=await fetch('/api/recognize-menu',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`},body:JSON.stringify({image:raw,mimeType:file.type})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'辨識失敗');
   if(!data.items?.length){notify('沒有辨識出明確品名及價格，請手動新增');return}
   const lines=(data.items as {name:string;price:number}[]).map(x=>`${x.name} | ${x.price}`).join('\n');
   const edited=window.prompt('AI 辨識結果：請逐行確認／修改（格式：品名 | 價格），按確定後匯入。',lines);
   if(edited===null)return;
   const parsed=edited.split('\n').map(x=>x.split('|').map(s=>s.trim())).filter(x=>x.length===2&&x[0]&&/^\d+$/.test(x[1])&&Number(x[1])<=1000000);
   if(!parsed.length)throw Error('沒有可匯入的有效商品');
   let done=0;for(const [name,price] of parsed){await rpc('add_product',{p_campaign:selected,p_name:name,p_price:Number(price)});done++}
   notify(`已匯入 ${done} 項商品，請再次檢查清單`);await reload();
 });
 const downloadCsv=()=>{
   const rows=[['時間','團名','團員','類型','異動金額','備註'],...ledger.map(x=>[fmt(x.created_at),selectedClub?.name||'',members.find(m=>m.user_id===x.user_id)?.nickname||x.user_id,x.type,String(x.delta),x.note])];
   const csv='\ufeff'+rows.map(row=>row.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(',')).join('\r\n');
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='揪是有局-帳務明細.csv';a.click();URL.revokeObjectURL(a.href);
 };
 if(!ready)return <main className="center">載入中…</main>;
 if(!client)return <main className="center"><h1>🍯 揪是有局</h1><p>請先部署並設定 Supabase 環境變數，詳見 README。</p></main>;
 if(!user)return <main className="auth"><section className="authbox"><span className="emoji">🍯</span><h1>揪是有局</h1><p>每個人都能開團的下午茶小帳房</p><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/><label>密碼（至少 6 碼）</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"/><button disabled={busy} onClick={()=>authenticate(false)}>Email 登入</button><button className="outline" disabled={busy} onClick={()=>authenticate(true)}>註冊新帳號</button><div className="or">或</div><button className="google" disabled={busy} onClick={google}>使用 Google 登入</button><p className="hint">註冊後可以建立自己的團，或透過邀請碼加入其他人的團。</p></section>{message&&<aside className="toast">{message}</aside>}</main>;
 return <main className="layout"><header><div className="brand"><span>🍯</span><div><strong>揪是有局</strong><small>開團・點餐・記帳</small></div></div><div className="userbar"><span>{user.email}</span><button className="iconbtn" title="登出" onClick={()=>client.auth.signOut()}><LogOut size={18}/></button></div></header>
 <div className="shell"><aside className="sidebar"><div className="sidetitle">我的團</div><select value={clubId} onChange={e=>{setClubId(e.target.value);setTab('campaigns');setCart({})}}><option value="">請選擇團</option>{clubs.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><nav><button className={tab==='campaigns'?'active':''} onClick={()=>setTab('campaigns')}><Coffee size={18}/> 開團／點餐</button><button className={tab==='wallet'?'active':''} onClick={()=>setTab('wallet')}><Wallet size={18}/> 錢包／儲值</button><button className={tab==='account'?'active':''} onClick={()=>setTab('account')}><Users size={18}/> 團員／帳務</button></nav><div className="sidebalance"><small>我的可用餘額</small><strong>{money(balance)}</strong></div></aside>
 <section className="content">{message&&<div className="alert">{message}</div>}
 {!clubId?<div className="two"><section className="panel"><h2>建立新團</h2><p>每個人都能成為團主，建立自己的獨立團購帳本。</p><label>團名稱</label><input placeholder="例如：7F 下午茶團" value={clubName} onChange={e=>setClubName(e.target.value)}/><label>你在這團的暱稱</label><input placeholder="例如：Yumi" value={nickname} onChange={e=>setNickname(e.target.value)}/><button disabled={busy} onClick={()=>run(async()=>{await rpc('create_club',{p_name:clubName,p_nickname:nickname});setClubName('');await loadClubs(user.id);notify('建立成功！')})}>建立團購社群</button></section><section className="panel"><h2>加入其他人的團</h2><p>向團主索取邀請碼，每個團的餘額彼此獨立。</p><label>邀請碼</label><input placeholder="輸入團主提供的邀請碼" value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())}/><label>你在這團的暱稱</label><input placeholder="例如：Ayu" value={nickname} onChange={e=>setNickname(e.target.value)}/><button disabled={busy} onClick={()=>run(async()=>{await rpc('join_club',{p_code:invite,p_nickname:nickname});setInvite('');await loadClubs(user.id);notify('加入成功！')})}>加入團購社群</button></section></div>:
 <>
 <div className="heading"><div><h1>{selectedClub?.name}</h1><p>嗨，{member?.nickname||user.email}！{isAdmin?'你是這團的管理員':'一起來點下午茶吧'}</p></div><span className="role">{isAdmin?'管理員':'團員'}</span></div>
 {tab==='campaigns'&&<div className="stack">{isAdmin&&<section className="panel"><h2><Plus size={18}/> 開新團</h2><div className="fields"><div><label>團購主題</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例：週五抹茶下午茶"/></div><div><label>店名</label><input value={shop} onChange={e=>setShop(e.target.value)} placeholder="例：抹茶研究所"/></div><div><label>截止時間</label><input type="datetime-local" value={closes} onChange={e=>setCloses(e.target.value)}/></div></div><button disabled={busy} onClick={()=>run(async()=>{await rpc('create_campaign',{p_club:clubId,p_title:title,p_shop:shop,p_closes_at:new Date(closes).toISOString()});setTitle('');setShop('');notify('開團成功');await reload()})}>建立團購</button></section>}
 <div className="two maincols"><section className="panel"><h2>團購列表</h2>{campaigns.length===0?<p className="empty">目前還沒有團購，請團主建立第一團。</p>:campaigns.map(c=><button key={c.id} className={'campaign '+(selected===c.id?'selected':'')} onClick={()=>{setSelected(c.id);setCart({})}}><span><strong>{c.title}</strong><small>{c.shop||'未填店名'} · 截止 {fmt(c.closes_at)}</small></span><span className="right"><em className={c.status==='open'&&new Date(c.closes_at)>new Date()?'green':''}>{c.status==='open'&&new Date(c.closes_at)>new Date()?'開放中':'已截止'}</em><ChevronRight size={16}/></span></button>)}</section>
 <section className="panel"><h2>{current?.title||'請選擇團購'}</h2>{current&&<><p>{current.shop||'未填店名'} · 截止 {fmt(current.closes_at)}</p>{isAdmin&&current.status==='open'&&new Date(current.closes_at)>new Date()&&<div className="adminarea"><h3>管理商品／菜單辨識</h3><div className="fields"><div><label>商品名稱</label><input value={productName} onChange={e=>setProductName(e.target.value)} placeholder="珍珠鮮奶茶"/></div><div><label>價格</label><input type="number" min="0" value={productPrice} onChange={e=>setProductPrice(e.target.value)} placeholder="65"/></div></div><div className="inline"><button disabled={busy||!productName||productPrice===''} onClick={()=>addProduct()}>手動新增</button><label className={'upload '+(busy?'disabled':'')}><ImageUp size={17}/> 上傳菜單辨識<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f)recognize(f);e.target.value=''}}/></label></div><small>照片辨識後須人工確認商品及價格，才會正式匯入。</small></div>}
 <div className="productlist">{currentProducts.length===0?<p className="empty">團主尚未新增商品</p>:currentProducts.map(p=><div className="product" key={p.id}><span><strong>{p.name}</strong><small>{money(p.price)}</small></span>{current.status==='open'&&new Date(current.closes_at)>new Date()&&<div className="stepper"><button aria-label="減少" onClick={()=>setCart(old=>({...old,[p.id]:Math.max(0,(old[p.id]||0)-1)}))}>−</button><span>{cart[p.id]||0}</span><button aria-label="增加" onClick={()=>setCart(old=>({...old,[p.id]:Math.min(99,(old[p.id]||0)+1)}))}>＋</button></div>}</div>)}</div>
 {current.status==='open'&&new Date(current.closes_at)>new Date()&&<div className="checkout"><span>合計 <strong>{money(total)}</strong></span><button disabled={busy||total<=0} onClick={()=>run(async()=>{const items=Object.entries(cart).filter(([,qty])=>qty>0).map(([product_id,qty])=>({product_id,qty}));await rpc('place_order',{p_campaign:selected,p_items:items});setCart({});notify('下單成功，已從儲值餘額扣款');await reload()})}>送出訂單</button></div>}
 {isAdmin&&<button className="outline slim" disabled={busy} onClick={()=>run(async()=>{await rpc('set_campaign_status',{p_campaign:selected,p_status:current.status==='open'?'closed':'open'});await reload()})}>{current.status==='open'?'手動結團':'重新開團（截止時間不變）'}</button>}</>}</section></div>
 <section className="panel"><h2><ReceiptText size={18}/> {isAdmin?'本團訂單':'我的訂單'}</h2>{orders.length===0?<p className="empty">還沒有訂單</p>:<div className="tablewrap"><table><thead><tr><th>時間</th><th>團購</th>{isAdmin&&<th>團員</th>}<th>金額</th><th>狀態</th><th></th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{fmt(o.created_at)}</td><td>{campaigns.find(c=>c.id===o.campaign_id)?.title}</td>{isAdmin&&<td>{members.find(m=>m.user_id===o.user_id)?.nickname}</td>}<td>{money(o.total)}</td><td>{o.status==='placed'?'已成立':'已取消'}</td><td>{o.status==='placed'&&<button className="linkbtn" disabled={busy} onClick={()=>{if(window.confirm('確定取消並退款？'))run(async()=>{await rpc('cancel_order',{p_order:o.id});notify('取消成功，已記錄退款');await reload()})}}>取消</button>}</td></tr>)}</tbody></table></div>}</section></div>}
 {tab==='wallet'&&<div className="stack"><section className="balancehero"><small>我的可用儲值餘額</small><strong>{money(balance)}</strong><span>各團錢包獨立，必須由管理員確認收款才會增加餘額</span></section><div className="two"><section className="panel"><h2>申請儲值</h2><p>請先依團主指示轉帳或付款，再申請入帳。</p><label>金額（NT$）</label><input type="number" min="1" value={amount} onChange={e=>setAmount(e.target.value)}/><label>付款備註（可填末五碼）</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例：已轉帳 末五碼 12345"/><button disabled={busy} onClick={submitTopup}>送出儲值申請</button></section><section className="panel"><h2>儲值申請紀錄</h2>{topups.filter(t=>t.user_id===user.id).length===0?<p className="empty">尚無儲值申請</p>:topups.filter(t=>t.user_id===user.id).map(t=><div className="record" key={t.id}><span><strong>{money(t.amount)}</strong><small>{fmt(t.created_at)} · {t.note}</small></span><em>{t.status==='pending'?'待審核':t.status==='approved'?'已入帳':'未通過'}</em></div>)}</section></div>{isAdmin&&<section className="panel"><h2>待確認收款</h2>{topups.filter(t=>t.status==='pending').length===0?<p className="empty">目前沒有待審核款項</p>:topups.filter(t=>t.status==='pending').map(t=><div className="record" key={t.id}><span><strong>{members.find(m=>m.user_id===t.user_id)?.nickname} — {money(t.amount)}</strong><small>{fmt(t.created_at)} · {t.note}</small></span><div className="inline"><button className="danger outline slim" disabled={busy} onClick={()=>run(async()=>{await rpc('review_topup',{p_id:t.id,p_approve:false});notify('已拒絕');await reload()})}>拒絕</button><button className="slim" disabled={busy} onClick={()=>{if(window.confirm('已實際確認收到款項？確認後會入帳。'))run(async()=>{await rpc('review_topup',{p_id:t.id,p_approve:true});notify('已確認收款並入帳');await reload()})}}>確認收款</button></div></div>)}</section>}<section className="panel"><h2>我的錢包異動</h2>{ledger.filter(l=>l.user_id===user.id).length===0?<p className="empty">還沒有帳務紀錄</p>:ledger.filter(l=>l.user_id===user.id).map(l=><div className="record" key={l.id}><span><strong>{({topup:'儲值',order:'訂單扣款',refund:'訂單退款',adjustment:'調整'} as Record<string,string>)[l.type]}</strong><small>{fmt(l.created_at)} · {l.note}</small></span><strong className={l.delta>0?'positive':''}>{l.delta>0?'+':''}{money(l.delta)}</strong></div>)}</section></div>}
 {tab==='account'&&<div className="stack"><section className="panel"><h2>團員與邀請</h2><p>邀請碼（分享給其他人加入）：</p><div className="invite"><strong>{selectedClub?.invite_code}</strong><button className="outline slim" onClick={()=>{navigator.clipboard.writeText(selectedClub?.invite_code||'');notify('邀請碼已複製')}}><Copy size={15}/> 複製</button></div><div className="membergrid">{members.map(m=><div className="member" key={m.user_id}><span>{m.nickname} {m.role==='admin'?'👑':''}</span>{isAdmin&&<strong>{money(balances[m.user_id]||0)}</strong>}</div>)}</div></section>{isAdmin&&<section className="panel"><div className="sectionhead"><h2>團內帳務報表</h2><button className="outline slim" onClick={downloadCsv}>匯出 CSV</button></div><div className="stats"><span>團員數 <strong>{members.length}</strong></span><span>已入帳儲值 <strong>{money(ledger.filter(l=>l.type==='topup').reduce((s,l)=>s+l.delta,0))}</strong></span><span>淨消費 <strong>{money(-ledger.filter(l=>l.type==='order'||l.type==='refund').reduce((s,l)=>s+l.delta,0))}</strong></span></div><div className="tablewrap"><table><thead><tr><th>時間</th><th>團員</th><th>類別</th><th>金額</th><th>備註</th></tr></thead><tbody>{ledger.map(l=><tr key={l.id}><td>{fmt(l.created_at)}</td><td>{members.find(m=>m.user_id===l.user_id)?.nickname}</td><td>{l.type}</td><td>{money(l.delta)}</td><td>{l.note}</td></tr>)}</tbody></table></div></section>}</div>}
 </>}
 </section></div><footer>揪是有局 © 2026 · 團員資料依團隔離 · 本服務不代收款項</footer></main>;
}
