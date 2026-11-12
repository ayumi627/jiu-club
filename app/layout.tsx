import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'揪是有局｜團購與儲值', description:'多人團購、下午茶點餐、獨立錢包與記帳'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-Hant"><body>{children}</body></html>}
