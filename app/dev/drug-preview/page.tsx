import { notFound } from 'next/navigation';
import DrugPreview from './DrugPreview';

// dev 전용 — 약 카드의 각인 면 표기 두 방식(MFDS 그대로 / 앞뒤 단정 안 함)을 나란히 비교한다. 프로덕션 빌드에서는 404.
export default function Page() {
    if (process.env.NODE_ENV === 'production') notFound();
    return <DrugPreview />;
}
