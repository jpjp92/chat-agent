'use client';

import dynamic from 'next/dynamic';
import ErrorBoundary, { AppErrorFallback } from '../components/ErrorBoundary';

// ssr: false — App tree uses localStorage, document, AudioContext, canvas etc.
// All browser-only APIs are guarded here at the page boundary.
const App = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return (
    <ErrorBoundary fallback={<AppErrorFallback />}>
      <App />
    </ErrorBoundary>
  );
}
