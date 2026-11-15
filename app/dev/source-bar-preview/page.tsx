import { notFound } from 'next/navigation';
import SourceBarPreview from './SourceBarPreview';

// dev 전용 — 출처 칩·접힌 바·시트를 고정 데이터로 그려 실측한다(PLAN_UI_MEASURE_261115 §3). 프로덕션 빌드에서는 404
export default function Page() {
    if (process.env.NODE_ENV === 'production') notFound();
    return <SourceBarPreview />;
}
