import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!url || !anon || !apiKey) return NextResponse.json({error:'伺服器尚未完成 AI 設定'}, {status:503});
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({error:'請先登入'}, {status:401});
    const authClient = createClient(url, anon, {auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error} = await authClient.auth.getUser(token);
    if (error || !user) return NextResponse.json({error:'登入已失效'}, {status:401});
    const body = await request.json();
    const image = body?.image;
    const mimeType = body?.mimeType;
    if (!['image/jpeg','image/png','image/webp'].includes(mimeType) || typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 9_000_000)
      return NextResponse.json({error:'請上傳小於約 6MB 的 JPG／PNG／WebP 照片'}, {status:400});
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:'POST', headers:{'content-type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({contents:[{parts:[
        {text:'辨識圖片中的菜單商品，僅擷取圖片明確顯示的品名與台幣單價。回傳 JSON 物件：{"items":[{"name":"商品名稱","price":50}]}。不確定的商品不要猜測，若無標價則忽略；忽略套餐總價、促銷敘述與重複項目。最多 60 項。'},
        {inline_data:{mime_type:mimeType,data:image}}
      ]}], generationConfig:{responseMimeType:'application/json',temperature:0.1,maxOutputTokens:3000}}),
      signal:AbortSignal.timeout(25000)
    });
    if (!response.ok) return NextResponse.json({error:`AI 辨識暫時不可用（${response.status}）`}, {status:502});
    const json = await response.json();
    const raw = json?.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text??'').join('') || '';
    const parsed = JSON.parse(raw);
    const items = (Array.isArray(parsed.items)?parsed.items:[]).slice(0,60).filter((x:unknown):x is {name:string;price:number}=>{
      if (!x || typeof x !== 'object') return false;
      const item=x as Record<string,unknown>;
      return typeof item.name==='string' && item.name.trim().length>0 && item.name.length<=100 && Number.isInteger(item.price) && Number(item.price)>=0 && Number(item.price)<=100000;
    }).map((x:{name:string;price:number})=>({name:x.name.trim(),price:x.price}));
    return NextResponse.json({items});
  } catch {return NextResponse.json({error:'無法辨識，請改用手動輸入或稍後重試'}, {status:500});}
}
