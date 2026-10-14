import { notFound } from 'next/navigation';
import LoadingPreview from './LoadingPreview';

// dev 전용 — 응답 대기 표시(오브 + 문구) 시나리오 미리보기. 프로덕션 빌드에서는 404.
export default function Page() {
    if (process.env.NODE_ENV === 'production') notFound();
    return <LoadingPreview />;
}
