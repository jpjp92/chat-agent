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
    ('AX-07', 'line', [{'name': '매출', 'data': [5, 6, 7, 6, 8, 9, 7, 8, 10, 9, 11, 12]}], [f'{i}월' for i in range(1, 13)], 360),
]

PAGE = """<!doctype html><meta charset=utf-8><body style="margin:0;font-family:sans-serif">
<script>%s</script><script>%s</script><div id=root></div><script>
const CASES = %s;
window.results = {};
for (const [id, type, series, cats, width] of CASES) {
  const ax = ChartAxis.resolveXAxis(type, series, cats);
  const count = ax.categories.length;
  const minW = ax.scale !== 'numeric' && count > 10 ? Math.max(600, count * 40) : '100%%';
  const card = document.createElement('div'); card.style.cssText = `width:${width}px;overflow-x:auto`; card.id = 'card-' + id;
  const inner = document.createElement('div'); inner.style.minWidth = typeof minW === 'number' ? minW + 'px' : minW; inner.style.width = '100%%';
  const el = document.createElement('div'); inner.appendChild(el); card.appendChild(inner); document.getElementById('root').appendChild(card);
  const numeric = ax.scale === 'numeric' ? ChartAxis.numericAxisOptions(ax.series, width < 480) : {};
  new ApexCharts(el, { chart: { type, height: 220, animations: { enabled: false }, toolbar: { show: false } },
    series: ax.series, stroke: { curve: ax.scale === 'numeric' ? 'straight' : 'monotoneCubic', width: 2 }, markers: { size: 4 },
    xaxis: { categories: ax.scale === 'numeric' ? [] : ax.categories, ...numeric,
      labels: { formatter: v => ax.scale === 'numeric' ? ChartAxis.numericTickLabel(v) : v } } }).render();
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
        check('AX-07 12개월 범주 가로 스크롤 유지', res['AX-07']['scale'] == 'category' and scrolls('AX-07'))
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
