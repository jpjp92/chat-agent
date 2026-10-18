'use client';

import dynamic from 'next/dynamic';
import ErrorBoundary, { AppErrorFallback } from '../components/ErrorBoundary';

// ssr: false — App 트리는 localStorage·document·AudioContext·canvas 등을 쓴다.
// 브라우저 전용 API 는 전부 이 페이지 경계에서 막는다.
const App = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return (
    <ErrorBoundary fallback={<AppErrorFallback />}>
      <App />
    </ErrorBoundary>
  );
}
