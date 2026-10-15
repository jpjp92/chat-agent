import { notFound } from 'next/navigation';
import WeatherPreview from './WeatherPreview';

// dev 전용 — 날씨 카드를 표본 데이터로 띄워 상태별 모습을 확인한다. 프로덕션 빌드에서는 404.
export default function Page() {
    if (process.env.NODE_ENV === 'production') notFound();
    return <WeatherPreview />;
}
