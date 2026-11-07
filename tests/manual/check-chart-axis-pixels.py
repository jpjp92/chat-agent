"""
차트 x축 픽셀 간격 검사 — `python3 tests/manual/check-chart-axis-pixels.py`
계획: docs/plans/PLAN_CHART_AXIS_261105.md §4 (완료 기준은 렌더링이 아니라 좌표)

운영 판정 함수(components/chart-axis.ts)를 esbuild 로 번들해 실제 ApexCharts(node_modules) 와 함께 띄우고,
점(marker)의 화면 x 좌표 간격 비율과 가로 스크롤 여부를 잰다. ChartRenderer 의 축·너비 규칙을 그대로 옮긴다.
필요: python playwright + chromium. 네트워크 접근 없음(로컬 파일만).
"""
import json, math, os, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
bundle = subprocess.run(
    [os.path.join(ROOT, 'node_modules', '.bin', 'esbuild'), os.path.join(ROOT, 'components', 'chart-axis.ts'),
     '--bundle', '--format=iife', '--global-name=ChartAxis'],
    check=True, capture_output=True, text=True).stdout
apex = open(os.path.join(ROOT, 'node_modules', 'apexcharts', 'dist', 'apexcharts.js'), encoding='utf-8').read()

def pts(xs, f): return [{'x': x, 'y': f(x)} for x in xs]
CASES = [
    ('AX-01', 'line', [{'name': 'y', 'data': pts([0, 1, 2, 10], lambda x: x * x)}], [], 700),
    ('AX-02', 'line', [{'name': 'y', 'data': pts([-3 + i * 0.5 for i in range(13)], lambda x: x * x)}], [], 360),
    ('AX-03', 'line', [{'name': 'y', 'data': pts([-math.pi + i * math.pi / 4 for i in range(9)], math.sin)}], [], 360),
    ('AX-04', 'line', [{'name': 'n', 'data': [1006645, 862835, 640089, 272337, 260562]}], ['1970', '1980', '2000', '2020', '2021'], 700),
    ('AX-05', 'bar', [{'name': 'n', 'data': [27, 26, 25, 23, 24, 25]}], ['2020', '2021', '2022', '2023', '2024', '2025'], 360),
    ('AX-06', 'scatter', [{'name': 'p', 'data': [{'x': 1, 'y': 2}, {'x': 2, 'y': 4}, {'x': 3, 'y': 1}]}], [], 360),
    # 12개월은 모바일에서도 스크롤 없이 한 화면(11-07 — 스크롤되면 오른쪽 절반이 잘렸다)
    ('AX-07', 'line', [{'name': '환율', 'data': [1391, 1423, 1457, 1467, 1456, 1449, 1486, 1487, 1490, 1527, 1497, 1406]}], [f'{2025 + (i + 8) // 12}년 {(i + 8) % 12 + 1}월' for i in range(12)], 360),
    ('AX-10', 'bar', [{'name': 'n', 'data': list(range(30))}], [f'항목{i}' for i in range(30)], 360),
    # 모델이 함수 샘플을 {x,y} 대신 등간격 숫자 범주 61개로 보낸 경우(11-05 실화면: 스크롤로 −3~−1.3 만 보임)
    ('AX-08', 'line', [{'name': 'y', 'data': [round((-3 + i * 0.1) ** 2, 2) for i in range(61)]}], [f'{-3 + i * 0.1:.1f}' for i in range(61)], 360),
]

PAGE = """<!doctype html><meta charset=utf-8><body style="margin:0;font-family:sans-serif">
<script>%s</script><script>%s</script><div id=root></div><script>
const CASES = %s;
window.results = {};
for (const [id, type, series, cats, width] of CASES) {
  const ax = ChartAxis.resolveXAxis(type, series, cats);
  const count = ax.categories.length;
  const minW = ax.scale !== 'numeric' && count > 24 ? count * 28 : '100%%';
  const card = document.createElement('div'); card.style.cssText = `width:${width}px;overflow-x:auto`; card.id = 'card-' + id;
  const inner = document.createElement('div'); inner.style.minWidth = typeof minW === 'number' ? minW + 'px' : minW; inner.style.width = '100%%';
  const el = document.createElement('div'); inner.appendChild(el); card.appendChild(inner); document.getElementById('root').appendChild(card);
  const numeric = ax.scale === 'numeric' ? ChartAxis.numericAxisOptions(ax.series, width < 480) : {};
  new ApexCharts(el, { chart: { type, height: 220, animations: { enabled: false }, toolbar: { show: false } },
    series: ax.series, stroke: { curve: ax.scale === 'numeric' ? 'straight' : 'monotoneCubic', width: 2 }, markers: { size: 4 },
    yaxis: { labels: { style: { fontSize: width < 480 ? '9px' : '12px' } } }, grid: { padding: { bottom: width < 480 ? 8 : 0 } }, xaxis: { categories: ax.scale === 'numeric' ? [] : ax.categories, ...numeric,
      labels: { offsetY: width < 480 ? 4 : 0, rotate: ax.scale === 'numeric' ? 0 : (width < 480 ? -55 : -45), hideOverlappingLabels: true, style: { fontSize: width < 480 ? '8px' : '11px' }, formatter: v => ax.scale === 'numeric' ? ChartAxis.numericTickLabel(v) : v } } }).render();
  window.results[id + ':opts'] = numeric;
  window.results[id] = { scale: ax.scale };
}
</script>"""

def main():
    html = PAGE % (apex, bundle, json.dumps(CASES))
    path = os.path.join(tempfile.mkdtemp(), 'axis.html')
    open(path, 'w', encoding='utf-8').write(html)
    fails = 0
    def check(name, cond, detail=''):
        nonlocal fails
        print(('✅ ' if cond else '❌ ') + name + ('' if cond else f'\n     {detail}'))
        if not cond: fails += 1
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 800, 'height': 2400}); pg.goto('file://' + path)
        pg.wait_for_timeout(1500)
        def xs(cid):
            # 점 중심 x — 마커(선·산점도) 또는 막대 중심
            return sorted(pg.eval_on_selector_all(f'#card-{cid} .apexcharts-marker, #card-{cid} .apexcharts-bar-area',
                'els => els.map(e => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; })'))
        def scrolls(cid): return pg.eval_on_selector(f'#card-{cid}', 'e => e.scrollWidth > e.clientWidth + 1')
        res = pg.evaluate('window.results')

        x = xs('AX-01'); r = (x[3] - x[2]) / (x[2] - x[1]) if len(x) == 4 else 0
        check(f'AX-01 2→10 간격 = 1→2 의 8배 (측정 {r:.2f})', res['AX-01']['scale'] == 'numeric' and abs(r - 8) / 8 < 0.03, x)
        x = xs('AX-02')
        check(f'AX-02 y = x² 모바일 스크롤 없음·점 13개 (점 {len(x)})', not scrolls('AX-02') and len(x) == 13)
        x = xs('AX-03'); mid = (x[0] + x[-1]) / 2 if x else 0
        check('AX-03 sin(x) 0 교차 x 가 가운데', len(x) == 9 and abs(x[4] - mid) / (x[-1] - x[0]) < 0.03, x)
        x = xs('AX-04')
        ok4 = len(x) == 5 and abs((x[2] - x[1]) / (x[1] - x[0]) - 2) < 0.06 and abs((x[4] - x[3]) / (x[1] - x[0]) - 0.1) < 0.03
        check('AX-04 불규칙 연도 간격 보존(1980→2000 = 2배, 2020→2021 = 0.1배)', ok4, x)
        x = xs('AX-05'); d = [x[i + 1] - x[i] for i in range(len(x) - 1)]
        check('AX-05 연도 막대 6개 등간격(category)', res['AX-05']['scale'] == 'category' and len(x) == 6 and max(d) - min(d) < 1.5, d)
        check('AX-06 산점도 numeric·마커 3개', res['AX-06']['scale'] == 'numeric' and len(xs('AX-06')) == 3)
        check('AX-07 12개월 범주 모바일 스크롤 없음', res['AX-07']['scale'] == 'category' and not scrolls('AX-07'))
        # 보이는 x 라벨끼리, x 라벨과 y 라벨이 겹치지 않는다
        boxes = pg.evaluate('''() => { const g = s => [...document.querySelectorAll('#card-AX-07 ' + s)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
          return { x: g('.apexcharts-xaxis-label'), y: g('.apexcharts-yaxis-label') }; }''')
        ov = lambda a, b: a['left'] < b['right'] - 1 and b['left'] < a['right'] - 1 and a['top'] < b['bottom'] - 1 and b['top'] < a['bottom'] - 1
        # 회전 라벨은 사각 영역이 서로 겹쳐 보이므로 x 라벨끼리는 오른쪽 끝 간격으로 잰다(회전 글자 높이 8px 이상)
        rs = sorted(b['right'] for b in boxes['x'])
        xo = sum(1 for i in range(len(rs) - 1) if rs[i + 1] - rs[i] < 8)
        xy = sum(ov(a, b) for a in boxes['x'] for b in boxes['y'])
        check(f'AX-07 라벨 겹침 없음 (x 라벨 {len(boxes["x"])}개, x끼리 {xo}·x-y {xy})', xo == 0 and xy == 0)
        # y축 맨 아래 라벨과 x축 라벨 사이 세로 간격(11-07 모바일: 1,300 과 2025 가 맞닿아 보였다)
        gap = min(b['top'] for b in boxes['x']) - max(b['bottom'] for b in boxes['y'])
        check(f'AX-07 y 맨 아래 라벨과 x 라벨 간격 ≥ 4px (측정 {gap:.1f})', gap >= 4)
        # x 라벨이 차트 SVG 아래로 잘리지 않는다(오프셋을 주면 Apex 가 높이에 넣지 않아 잘렸다, 11-07)
        for cid in ['AX-02', 'AX-07']:
            g2 = pg.evaluate(f'''() => {{ const q = s => [...document.querySelectorAll('#card-{cid} ' + s)].map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
              return Math.min(...q('.apexcharts-xaxis-label').map(r => r.top)) - Math.max(...q('.apexcharts-yaxis-label').map(r => r.bottom)); }}''')
            check(f'{cid} y-x 라벨 간격 ≥ 4px (측정 {g2:.1f})', g2 >= 4)
            hx = pg.evaluate(f'''() => {{ const plot = document.querySelector('#card-{cid} .apexcharts-grid').getBoundingClientRect();
              return plot.left - Math.max(...[...document.querySelectorAll('#card-{cid} .apexcharts-yaxis-label')].map(e => e.getBoundingClientRect().right)); }}''')
            check(f'{cid} y 라벨 오른쪽 끝과 그래프 시작 간격 ≥ 4px (측정 {hx:.1f})', hx >= 4)
            cut = pg.evaluate(f'''() => {{ const svg = document.querySelector('#card-{cid} svg').getBoundingClientRect();
              return Math.max(...[...document.querySelectorAll('#card-{cid} .apexcharts-xaxis-label')].map(e => e.getBoundingClientRect().bottom)) - svg.bottom; }}''')
            check(f'{cid} x 라벨이 SVG 안 (초과 {cut:.1f}px)', cut <= 0.5)
        check('AX-10 범주 30개는 가로 스크롤', scrolls('AX-10'))
        ends = pg.evaluate('''() => { const p = document.querySelector('#card-AX-08 .apexcharts-line path, #card-AX-08 path.apexcharts-line');
          const c = document.querySelector('#card-AX-08').getBoundingClientRect(); const b = p.getBoundingClientRect();
          return [b.left >= c.left - 1, b.right <= c.right + 1]; }''')
        check('AX-08 등간격 숫자 범주 61개 → numeric·스크롤 없음·선 전체가 카드 안', res['AX-08']['scale'] == 'numeric' and not scrolls('AX-08') and all(ends), ends)
        # 선이 데이터 최솟값 아래로 꺼지지 않는다(Apex monotoneCubic 결함 회피 확인)
        dip = pg.evaluate('''() => { const p = document.querySelector('#card-AX-01 .apexcharts-line path, #card-AX-01 path.apexcharts-line');
          const L = p.getTotalLength(); let m = -1; for (let i = 0; i <= 400; i++) m = Math.max(m, p.getPointAtLength(L * i / 400).y);
          return m - p.getPointAtLength(0).y; }''')
        check(f'AX-01 선이 최솟값 아래로 안 꺼짐 (초과 {dip:.2f}px)', dip < 0.5)
        ticks = pg.eval_on_selector_all('#card-AX-04 .apexcharts-xaxis-label tspan', 'e => e.map(t => t.textContent)')
        check(f'AX-04 눈금이 깔끔한 간격 {ticks}', len(ticks) >= 3 and all(t.isdigit() and int(t) % 10 == 0 for t in ticks))
        pg.screenshot(path=os.path.join(os.path.dirname(path), 'axis.png'), full_page=True)
        print('screenshot:', os.path.join(os.path.dirname(path), 'axis.png'))
        b.close()
    print(f"\n{'🟢' if fails == 0 else '🔴'} fail {fails}")
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
