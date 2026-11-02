/** 비교 샘플 — 앞 4개는 server/agent/prompt.ts 의 json:diagram 예시 그대로, 뒤는 현행 canvas 의 약점을 드러내는 경계값. */
export const SAMPLES: { name: string; note?: string; data: Record<string, unknown> }[] = [
    { name: 'inclined_plane (프롬프트 예시)', data: { type: 'inclined_plane', title: '경사면 힘 분석', angle: 30, showBaseline: true, showAngle: true, forces: [
        { label: '중력 (mg)', angle: 90, magnitude: 1.5, color: '#0066CC' }, { label: '수직항력 (N)', angle: -60, magnitude: 1.3, color: '#FFA500' },
        { label: '평행 분력 (mg sinθ)', angle: 30, magnitude: 0.75, color: '#00CC00' }, { label: '마찰력 (f)', angle: 210, magnitude: 0.5, color: '#FF0000' }] } },
    { name: 'free_body (프롬프트 예시)', data: { type: 'free_body', title: '물체에 작용하는 힘', object: { shape: 'circle', label: '공' }, forces: [
        { label: '중력 (mg)', angle: 270, magnitude: 1.5, color: '#3b82f6' }, { label: '부력 (F)', angle: 90, magnitude: 1.0, color: '#f59e0b' },
        { label: '항력 (D)', angle: 180, magnitude: 0.4, color: '#ef4444' }] } },
    { name: 'projectile 45° (프롬프트 예시)', data: { type: 'projectile', title: '포물선 운동 (45°)', launchAngle: 45, label: '공', showComponents: true } },
    { name: 'collision (프롬프트 예시)', data: { type: 'collision', title: '운동량 보존', elastic: true,
        before: [{ label: 'A', mass: '2kg', velocity: 3, color: '#3b82f6' }, { label: 'B', mass: '1kg', velocity: 0, color: '#ef4444' }],
        after: [{ label: 'A', mass: '2kg', velocity: 1, color: '#3b82f6' }, { label: 'B', mass: '1kg', velocity: 4, color: '#ef4444' }] } },
    { name: 'inclined_plane 스페인어 라벨', note: 'canvas 는 키워드 밖 라벨을 버린다', data: { type: 'inclined_plane', title: 'Plano inclinado', angle: 30, forces: [
        { label: 'Peso (P)', angle: 270, magnitude: 1.5, color: '#0066CC' }, { label: 'Fuerza normal', angle: 60, magnitude: 1.3, color: '#FFA500' },
        { label: 'Rozamiento', angle: 210, magnitude: 0.5, color: '#FF0000' }] } },
    { name: 'projectile 75°', note: 'canvas 는 높이를 280px 로 잘라 H/R 비율이 틀린다', data: { type: 'projectile', title: '포물선 운동 (75°)', launchAngle: 75, label: '공' } },
];
