# Fills the organizer's official application form (접수양식 = 기획서) with the ValueLink proposal.
# Keeps the form's own layout: content is written into the eight answer boxes (tables 1–8).
# Usage: python3 docs/build_proposal.py  → docs/밸류링크_ValueLink_접수양식_기획서.docx
import copy
import os
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
FORM = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'research', 'consent.docx')
OUT = os.path.join(HERE, '밸류링크_ValueLink_접수양식_기획서.docx')
IMG = os.path.join(HERE, 'img')

REPO = 'https://github.com/leeshoun888/valuelink'
DEMO = 'https://leeshoun888.github.io/valuelink/'

# Monochrome, like the app: ink for structure, one blue for links.
TEAL = RGBColor(0x1D, 0x1D, 0x1F)
INK = RGBColor(0x1D, 0x1D, 0x1F)
GREY = RGBColor(0x6E, 0x6E, 0x73)
FONT = '맑은 고딕'


def set_cell_bg(cell, hex_):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_)
    tcPr.append(shd)


def style_run(r, size=9.5, bold=False, color=INK, italic=False):
    r.font.name = FONT
    r._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.color.rgb = color


class Box:
    """Writes rich content into one answer cell."""

    def __init__(self, cell):
        self.cell = cell
        for p in list(cell.paragraphs):
            p._element.getparent().remove(p._element)
        self.first = True

    def _p(self, space_before=2, space_after=2):
        p = self.cell.add_paragraph()
        pf = p.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after = Pt(space_after)
        pf.line_spacing = 1.18
        return p

    def rich(self, p, text, size=9.5, color=INK, bold=False):
        # **bold** markup inside a line
        parts = text.split('**')
        for i, part in enumerate(parts):
            if part:
                style_run(p.add_run(part), size=size, bold=bold or i % 2 == 1, color=color)

    def h(self, text):
        p = self._p(8 if not self.first else 2, 3)
        self.first = False
        style_run(p.add_run('■ '), size=10.5, bold=True, color=TEAL)
        style_run(p.add_run(text), size=10.5, bold=True, color=INK)

    def para(self, text, size=9.5, color=INK):
        self.first = False
        self.rich(self._p(), text, size=size, color=color)

    def lead(self, text):
        self.first = False
        p = self._p(2, 6)
        self.rich(p, text, size=11, color=INK, bold=True)

    def bullets(self, items, size=9.3):
        for it in items:
            p = self._p(1, 1)
            p.paragraph_format.left_indent = Cm(0.45)
            p.paragraph_format.first_line_indent = Cm(-0.3)
            style_run(p.add_run('• '), size=size, color=TEAL, bold=True)
            self.rich(p, it, size=size)

    def note(self, text):
        self.para(text, size=7.8, color=GREY)

    def table(self, header, rows, widths=None, size=8.3):
        self.first = False
        t = self.cell.add_table(rows=1, cols=len(header))
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, htext in enumerate(header):
            c = t.rows[0].cells[i]
            set_cell_bg(c, '1D1D1F')
            c.paragraphs[0].text = ''
            style_run(c.paragraphs[0].add_run(htext), size=size, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
        for ri, row in enumerate(rows):
            cells = t.add_row().cells
            for i, v in enumerate(row):
                cells[i].paragraphs[0].text = ''
                self.rich(cells[i].paragraphs[0], str(v), size=size)
                if ri % 2:
                    set_cell_bg(cells[i], 'F5F5F7')
        if widths:
            for row in t.rows:
                for i, w in enumerate(widths):
                    row.cells[i].width = Cm(w)
        self._p(0, 2)

    def image(self, name, width_cm=15.5, caption=None):
        path = os.path.join(IMG, name)
        if not os.path.exists(path):
            self.note(f'[이미지 누락: {name}]')
            return
        p = self._p(4, 2)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(path, width=Cm(width_cm))
        if caption:
            c = self._p(0, 6)
            c.alignment = WD_ALIGN_PARAGRAPH.CENTER
            style_run(c.add_run(caption), size=7.8, color=GREY, italic=True)


def fill_line(doc, label, value):
    """Fill '앱명 / 프로젝트명: ____' style lines."""
    for p in doc.paragraphs:
        if p.text.strip().startswith(label) and '_' in p.text:
            for r in p.runs:
                r.text = ''
            run = p.runs[0] if p.runs else p.add_run()
            run.text = f'{label} {value}'
            style_run(run, size=10, bold=True)



def main():
    doc = Document(FORM)
    fill_line(doc, '앱명 / 프로젝트명:', '밸류링크 (ValueLink): 당신의 현대차를 자산으로 관리하는 가장 스마트한 방법')
    # The form marks each answer row "can't split", so a long answer jumps whole to the next page and
    # leaves a blank one behind. Long answers must flow across pages.
    for i in range(1, 9):
        trPr = doc.tables[i].rows[0]._tr.trPr
        if trPr is not None:
            for el in list(trPr):
                if el.tag.endswith('}cantSplit'):
                    trPr.remove(el)
    boxes = [Box(doc.tables[i].rows[0].cells[0]) for i in range(1, 9)]

    # 1. 한 줄 소개 ───────────────────────────────────────────────
    b = boxes[0]
    b.lead('현대차를 “자산”으로 승격시키는 Pleos Connect 자산 관리 매니저: 차가 스스로 가치를 지키고(충전·창문·전조등 직접 제어), 증명하고(위조 불가 차량 여권), 다음 차와 다음 주인에게 잇습니다(현대 인증중고차 보상판매)')
    b.para('사람들은 차를 집 다음으로 큰 **자산**으로 여기고, 그 가치를 소중히 지키고 싶어 합니다. 밸류링크는 운전자가 아무것도 하지 않아도 **차가 매일 자산 가치를 관리하고 그 기록을 스스로 남기게** 합니다. 그 기록은 현대차그룹의 인증중고차·재구매·정비·리스로 이어집니다. 블루링크가 차를 연결했다면, **밸류링크는 차의 가치를 연결합니다.**')
    b.image('hero.png', 15.6, '밸류링크의 3D 트윈: Blender로 모델링·라이팅을 구운 IONIQ 5 (Pleos Connect 에뮬레이터 차량 기준 비율)')

    # 2. 기획 배경 ────────────────────────────────────────────────
    b = boxes[1]
    b.h('차는 집 다음으로 큰 자산인데, 그 가치가 매일 어떻게 깎이는지 아무도 보여주지 않는다')
    b.bullets([
        '중고차는 **한 달에 약 20만 대**가 거래됩니다(2025년 3월 20만 6,310대, 카이즈유데이터연구소). 그런데 차주가 자기 차 가치를 확인하는 순간은 **팔 때 한 번뿐**입니다.',
        '가치는 팔 때가 아니라 **매일** 결정됩니다. 밤새 100%로 꽂아 둔 충전, 미뤄 둔 경고등, 비 오는 날 열린 창문, 방전된 12V 배터리, 급출발 습관. 이 순간들은 **차만 알고**, 지금은 아무도 기록하지 않습니다.',
    ])
    b.h('전기차에서 문제는 더 커진다: 배터리를 믿지 못하는 중고 시장')
    b.bullets([
        '전기차 누적 등록은 **109만 5천 대**(2026년 6월 말, 국토교통부 통계 보도)로, 중고 전기차 물량이 빠르게 늘고 있습니다.',
        '중고 전기차 값을 가장 크게 좌우하는 것은 **배터리 건강도(SOH)**지만, 구매자는 확인할 방법이 없습니다. 프랑스 조사(Roole, 2025)에서 중고 전기차 구매자 중 시장을 신뢰한다는 응답은 **20%**로, 내연기관차(80%)의 4분의 1이었습니다.',
        '급속충전 비중, 고충전 상태 장시간 유지, 고온 충전은 배터리 열화를 앞당기는 대표 요인입니다. 즉 **충전 습관이 곧 자산 가치**인데, 운전자는 그 사실을 매일 체감하지 못합니다.',
    ])
    b.h('현대차그룹의 페인포인트: 인증중고차는 “팔 차가 없다”')
    b.bullets([
        '현대 인증중고차(2023.10 출범)는 **연식 5년·주행 10만km 이내 무사고** 자사 차량만 매입합니다. 양산·용인 센터의 상품화 역량은 **월 2,700대**인데, 판매 가능 물량은 **1,304대**(같은 시점 케이카 8,486대)로 **인프라 가동률이 24~48%**에 그친다는 분석이 나왔습니다(딜사이트, 2026.06).',
        '원인은 매물 확보입니다. 조건을 만족하는 **관리 잘 된 자사 차량을 찾아내는 채널**이 없습니다. 반대로 소비자는 관리를 잘 해도 그것을 증명할 방법이 없어 밸류링크을 못 받습니다.',
    ])
    b.h('핵심 인사이트')
    b.para('**차량 가치를 지키는 데 필요한 정보와 제어 권한은 전부 차 안에 있다.** 배터리 현재 용량, 충전 상태, 경고등, 창문, 전조등, 주행거리. 폰 앱은 이 중 어느 것도 읽거나 움직일 수 없습니다. Pleos Connect는 처음으로 이것을 3rd-party 앱에 열었고, 밸류링크은 그 위에서 **“가치를 지키는 습관”과 “관리 잘 된 차를 증명하는 기록”을 동시에 만듭니다.**')

    # 3. 주요 기능 및 차량 특화 요소 ─────────────────────────────────
    b = boxes[2]
    b.image('loop.png', 15.8, '그림 1. 밸류링크의 세 단계: 지킨다 → 증명한다 → 잇는다, 그리고 현대차그룹으로 돌아오는 가치')
    b.h('① 지킨다: 차가 직접 움직이는 10가지 가치 지킴 규칙')
    b.table(
        ['상황 (차가 감지)', '차가 하는 일 (Pleos SDK 실제 호출)', '지킨 가치 (근거)'],
        [
            ['집에서 충전기 연결, 상한 100%', '**EvBattery.setEvChargePercentLimit(80)**. 내비 목적지가 80% 주행가능거리를 넘으면 그날만 100%', '완충 1회 회피당 SOH 보존 × 차량가 [가정 계수]'],
            ['폭염 속 완속 충전', '**EvBattery.setEvChargeCurrentDrawLimit(16A)**', '셀 온도 상승 억제'],
            ['주차 중 비(와이퍼) + 창문 열림', '**Window.setWindowPosition(전 창문, 닫힘)**', '실내 침수·시트 클리닝 비용 [가정 15만원]'],
            ['P단 후 1분, 전조등 켜짐', '**Light.setLowBeamLightSwitch(OFF)**', '12V 방전·긴급출동 [가정 3만원]'],
            ['한낮 29℃ 이상 장시간 주차', '**Window.moveWindowBlind**', '내장재 자외선 열화'],
            ['경고등 점등 (TPMS, 12V, EV 시스템 등)', 'Safety.getTelltalesInfo → **NaviHelper.SearchPlace("블루핸즈")**', '미해결 경고등 = 차량가 −2% [가정], 해결 시 회복 기록'],
            ['배터리 12% 이하로 주행', '**NaviHelper.NearbyChargingStations**', '깊은 방전 회피'],
            ['급가속·급제동 반복', '음성 코칭 (TTS), 운전 점수', '타이어·브레이크 가속 마모'],
        ],
        widths=[4.0, 6.6, 5.4],
        size=8.0,
    )
    b.bullets([
        '모든 제어는 **capability 확인 후** 실행하고, 차량이 지원하지 않거나 App Market 승인 전이면 **같은 규칙이 음성 안내로 자동 대체**됩니다. 창문·전조등·블라인드는 **P단 정차가 확인될 때만** 움직입니다.',
    ])
    b.h('② 증명한다: 차가 쓰는 위조 불가 차량 여권')
    b.bullets([
        '**배터리 건강도는 추정이 아니라 차량 실측**: AAOS EV_CURRENT_BATTERY_CAPACITY ÷ INFO_EV_BATTERY_CAPACITY. Pleos Connect 에뮬레이터에서 **77,000 / 77,400 Wh = 99.5%**를 3rd-party 앱 권한으로 실제로 읽었습니다.',
        '주행거리(Odometer)와 **바퀴 회전 수(WHEEL_TICK)로 잰 독립 거리**를 매일 대조 → 계기판 조작 시 불일치로 드러납니다.',
        '하루 한 블록, **이전 블록의 SHA-256을 품는 해시 사슬**. 하루를 지우거나 주행거리를 되돌리면 사슬이 끊깁니다(웹 데모에서 직접 “되돌려 보기” 가능).',
        '에어백 전개 이력·경고등 점등과 해결·충전 습관(급속/완충 비율)까지 기록. **계산과 저장은 전부 온디바이스**, 공유는 차주 동의 시에만.',
    ])
    b.h('③ 잇는다: 가치를 원화로, 매입가로')
    b.bullets([
        '**내 차의 자산 가치**를 연식·주행거리·SOH·경고등·운전 습관·여권 검증 6개 요인으로 분해해 보여줍니다(“배터리 건강도 +2.9%”).',
        '**3년 뒤 가치**: 내 습관 vs 평균 운전자 곡선. 연간 열화 예측(내 습관 1.7%p/년 vs 평균 2.6%p/년)이 그대로 원화 차이가 됩니다.',
        '정차 중 원터치 **여권 기반 보상판매 매입가**(검증 우대 +2%, 7일 보장: 현대 인증중고차 제휴 시나리오). Gleo로 “밸류링크, 내 차 가치 어때?”도 가능합니다.',
    ])
    b.image('car_parked.png', 15.6, '그림 2. 차량 앱(정차): 지금 가치·이번 달 지켜낸 가치·차량 실측 배터리 건강도·충전 상한·밸류링크가 지켜낸 가치·차량 여권. 3D 트윈은 정차 중에만 회전')
    b.h('왜 폰이 아니라 차여야 하는가 (차량특화성)')
    b.table(
        ['필요한 것', '스마트폰 앱', '밸류링크 (Pleos Connect)'],
        [
            ['배터리 건강도', '불가 (추정 또는 정비소 진단)', '**차량이 보고하는 실측값**'],
            ['충전 상한·전류 제어', '불가', '**플러그 꽂는 순간 차가 직접 설정**'],
            ['창문·전조등·블라인드', '불가', '**비·주차 맥락에서 자동 제어**'],
            ['경고등·에어백 이력', '불가', '**텔테일·Safety API로 기록**'],
            ['주행거리 무결성', '사용자 입력', '**Odometer + WHEEL_TICK 이중 기록**'],
            ['맥락', '없음', '주행/정차/충전 상태, 내비 목적지, 집 위치(즐겨찾기)'],
        ],
        widths=[3.8, 4.6, 7.6],
        size=8.2,
    )
    b.para('주행 중에는 **애니메이션 없는 한 장짜리 화면**(운전 점수·오늘 지킨 가치)으로 바뀌고, 안내는 음성이 맡습니다(Pleos 주의분산 가이드). 화면은 차량의 라이트/다크 모드를 그대로 따릅니다.', size=9.0)

    # 4. 주요 사용 시나리오 ─────────────────────────────────────────
    b = boxes[3]
    b.h('시나리오 A. 밸류링크의 하루: 2025 아이오닉 5 롱레인지, 24,812km (웹 콘솔에서 그대로 재생)')
    b.table(
        ['시각', '상황', '밸류링크가 한 일', '지킨 가치'],
        [
            ['08:03', '출근길 급출발 2회', '“조금만 부드럽게 출발해볼까요?” 음성 코칭', '마모 기록'],
            ['08:25', '회사 도착, 아침 안개로 켠 전조등 그대로', 'P단 1분 후 **전조등 OFF**', '+3만원'],
            ['15:00', '소나기, 운전석 창문 열린 채 주차', '와이퍼 감지 → **창문 4개 닫힘**', '+15만원'],
            ['18:38', '퇴근길 **타이어 공기압 경고등**', '“가까운 블루핸즈를 찾아볼까요?” → 내비 검색', '자산 가치 −2% 표시'],
            ['19:20', '블루핸즈 점검 완료, 경고등 꺼짐', '해결 기록을 여권에 봉인', '−2% 회복'],
            ['19:50', '집, 완속 충전 연결 (상한 100%)', '**충전 상한 80%** 자동 설정', 'SOH 보존'],
            ['21:30', '내일 부산(395km) 목적지 설정', '80%로 부족 → **그날만 100%**, 도착 후 80% 복귀', '편의 + 수명'],
        ],
        widths=[1.3, 4.6, 6.5, 3.6],
        size=8.0,
    )
    b.image('car_charging.png', 15.0, '그림 3. 충전 중: 차체가 투명해지며 배터리 팩이 SoC까지 차오르고, 충전 상한(80%)에서 멈추는 모습을 3D로 보여줌')
    b.h('시나리오 B. 차를 팔 때: 3년 뒤의 보상판매')
    b.bullets([
        '정차 중 “자산 가치 리포트” → 여권(주행거리 무결성 ✓, 에어백 전개 없음, SOH 차량 실측, 미해결 경고등 없음)을 동의 하에 현대 인증중고차로 전송 → **검증 우대 매입가 7일 보장**.',
        '현대차는 **조건(5년·10만km·무사고)을 만족하는 관리 잘 된 자사 차량을 먼저** 확보하고, 차주는 신차 보상판매로 자연스럽게 재구매로 넘어갑니다.',
    ])
    b.h('시나리오 C. 리스·렌터카 플릿 (B2B)')
    b.bullets([
        '리스사의 가장 큰 리스크는 **반납 시점의 잔존가치**입니다. 플릿 콘솔은 차량별 SOH·충전 습관·경고등·운전 습관과 **계약 잔존가치 대비 위험**을 보여줍니다.',
        '데이터는 Pleos Fleet API Webhook(Vehicle.Odometer · TractionBattery.SOC · WarningLamp · Acceleration)으로 들어오고, 차 안의 밸류링크이 충전 상한 등을 직접 지킵니다. 시뮬레이션 플릿에서 **밸류링크 사용 차량의 배터리 건강도가 미사용 차량보다 높게** 유지됩니다.',
    ])
    b.image('fleet.png', 15.0, '그림 4. 플릿 콘솔: 현대캐피탈 리스·렌터카 36대(시뮬레이션)의 잔존가치 위험 순 정렬')

    # 5. 개발 계획 ────────────────────────────────────────────────
    b = boxes[4]
    b.h('구현 현황: 기획서가 아니라, Pleos Connect 에뮬레이터에서 동작하는 앱')
    b.bullets([
        f'**GitHub (소스 + release APK)**: {REPO}',
        f'**웹 라이브 데모** (랜딩 · 시연 콘솔 · 차량 앱 · 차량 여권 · 플릿): {DEMO}',
        'Android(AAOS) Kotlin 호스트 + React/TypeScript 가치 엔진(WebView). Vehicle SDK **55개 제어 함수와 AAOS 차량 속성 330여 개를 전수 조사**해, 3rd-party 앱이 실제로 쓸 수 있는 것만으로 설계했습니다.',
    ])
    b.image('arch.png', 15.8, '그림 5. 시스템 구성: 하나의 가치 엔진, 세 개의 화면')
    b.h('Pleos Connect 에뮬레이터 2.1.0 실기 검증 결과')
    b.table(
        ['SDK / API', '호출', '에뮬레이터 결과'],
        [
            ['AAOS CarPropertyManager', 'EV_CURRENT_BATTERY_CAPACITY · INFO_EV_BATTERY_CAPACITY', '**77,000 / 77,400 Wh 읽음 → SOH 99.5%**'],
            ['AAOS', 'EV_CHARGE_STATE · CHARGE_RATE · TIME_REMAINING · PORT_CONNECTED · PERCENT_LIMIT', '구독·읽기 성공'],
            ['AAOS', 'INFO_MAKE / MODEL / MODEL_YEAR · WHEEL_TICK · 속도 · 기어', '“Hyundai 42dot / Connect / 2024”, 바퀴 틱 수신'],
            ['Vehicle · EvBattery', 'setEvChargePercentLimit · setEvChargeCurrentDrawLimit', '**50% → 80% 설정 후 재조회 확인**, 전류 12.5 → 16A'],
            ['Vehicle · Window', 'setWindowPosition (4개 창문)', '**가상 콘솔에서 열린 창문 40% → 0% 닫힘 확인**'],
            ['Vehicle · Light', 'setLowBeamLightSwitch(OFF)', '**가상 콘솔 전조등 LowBeam → Off 확인**'],
            ['Vehicle · Safety', 'getTelltalesInfo (TPMS) · Tire.getLowTirePressure', '경고등 감지 → 제안 표시, 저압 기준 137 kPa'],
            ['Vehicle · Odometer / CarInfo / Door', 'registerDistanceDriven · getVINInfo · checkDoorLockCapabilities', '주행거리 24,812km 수신, 도어 잠금 영역 확인'],
            ['NaviHelper', 'getBookmarkInfo · requestNavigationScreen(SearchPlace)', '즐겨찾기 2건 수신, 블루핸즈 검색 화면'],
            ['Gleo Interface', 'schema.json 5개 함수 → APP_ACTION_RESPONSE', 'GET_CAR_VALUE 등 응답'],
        ],
        widths=[3.3, 7.0, 5.7],
        size=7.6,
    )
    b.image('emulator.png', 15.6, '그림 6. Pleos Connect 에뮬레이터에서 실행 중인 밸류링크: 차량 실측 SOH, 경고등(TPMS) 감지와 블루핸즈 안내, 자동으로 지킨 일')
    b.h('외부 앱 권한 밖의 데이터와 실제 출시 시 경로')
    b.table(
        ['항목', '현재', '실제 출시 시'],
        [
            ['엔진오일·브레이크액·에어백 전개', '권한 허용, 에뮬레이터(EV)에 센서 없음', '실차 지원 시 지금 코드로 동작'],
            ['충전·창문·전조등 제어', '에뮬레이터 동작 확인', 'Vehicle Control SDK 승인 필요(미승인 시 음성 안내)'],
            ['긴급제동·ABS 이벤트, 실제 타이어 압력', '시스템 서명 권한(외부 앱 불가)', '현대차 제휴 선탑재 시 가능, 대안: 텔테일 warningCount'],
            ['여권 머리 해시 앵커링', '앱 내 보관', '인증중고차 제휴 시 서버 앵커링 → 구매자 검증'],
        ],
        widths=[4.6, 5.4, 6.0],
        size=7.8,
    )
    b.h('플랫폼 정책 준수')
    b.bullets([
        '**주의분산**: 주행 중 3D 정지 이미지·스크롤 없음·한 화면 정보만, 안내는 음성. 차량 제어는 P단 정차에서만.',
        '**성능**: 에뮬레이터에서 상시 3D 렌더가 VHAL 하트비트를 지연시키는 것을 발견 → 상태가 바뀔 때만 렌더하는 저전력 모드로 해결, 차량 서비스 재시작 시 자동 재연결(CarServiceLifecycleListener).',
        '**권한 최소화**: 쓰지 않는 공조·시트 권한 제거. 위치·음성은 사용 시점 요청. **보안**: WebViewAssetLoader HTTPS 가상 오리진, 릴리스 원격 디버깅 비활성.',
    ])
    b.h('PT 심사(12/3)까지')
    b.table(
        ['기간', '내용'],
        [
            ['~11/15', '앱·웹·APK·여권·플릿·3D 트윈 1차 완성 (제출 범위, 에뮬레이터 검증 완료)'],
            ['11/16~11/26', 'Vehicle Control SDK 사용 신청, 실차 가용 신호 확대(오일·에어백), 여권 내보내기(PDF·QR)'],
            ['11/27~12/02', '실제 충전 기록으로 열화 계수 보정, 시세 모델 검증, 시연 영상·PT'],
        ],
        widths=[2.6, 13.4],
        size=8.2,
    )

    # 6. 기대효과 및 발전 가능성 ───────────────────────────────────
    b = boxes[5]
    b.h('타깃 고객')
    b.table(
        ['세그먼트', '규모(근거)', '핵심 가치'],
        [
            ['Pleos 차량 개인 차주 (특히 전기차)', '전기차 누적 109만 5천 대(2026.06), Pleos는 2030년 그룹 2,000만 대 탑재 목표(현대차그룹 2026.04)', '매일 보이는 내 차 가치, 배터리 수명, 밸류링크 매각'],
            ['현대 인증중고차', '상품화 역량 월 2,700대 vs 판매 가능 1,304대, 가동률 24~48%(딜사이트 2026.06)', '조건 충족 자사 차량 매물 채널'],
            ['리스·렌터카 플릿 (현대캐피탈 등)', '렌터카 약 101만 대(렌터카연합회 2020.7)', '반납 잔존가치 리스크 감소'],
            ['블루핸즈·신차 영업', '전국 정비망·보상판매', '경고등→정비 예약, 교체 시점→재구매'],
        ],
        widths=[3.8, 7.2, 5.0],
        size=8.0,
    )
    b.h('사용자·리텐션 목표 (목표치와 산정식을 분리 표기)')
    b.table(
        ['지표', '2027', '2028', '2030', '산정식 · 근거'],
        [
            ['Pleos 탑재 차량(국내)', '50만', '150만', '400만', '[목표·가정] 2026.5 그랜저 양산 데뷔 후 차종 확대, 2030 글로벌 2,000만 대 목표의 국내 비중'],
            ['설치율', '20%', '30%', '35%', '[목표·가정] 안전·관리 카테고리 추천, 신차 출고 시 기본 앱 제안'],
            ['MAU', '8.5만', '38만', '119만', '[계산] 탑재 × 설치율 × 월 활성 85% (조작 없이 주행·충전 때마다 자동 동작)'],
            ['30일 리텐션', '70%', '72%', '75%', '[목표·가정] 자동 동작 + 월간 가치 리포트 + 충전마다 접점'],
            ['인증중고차 매물 연결', '연 1,530대', '연 6,840대', '연 2.1만 대', '[계산] MAU × 연 교체율 10% × 조건 충족 60% × 여권 공유 동의 30%. 2030년 월 1,785대 = 현 상품화 역량(월 2,700대)의 66%'],
        ],
        widths=[3.0, 1.4, 1.4, 1.5, 8.7],
        size=7.8,
    )
    b.note('※ [목표·가정]은 팀의 사업 목표이며, [계산]은 표 안의 가정으로 산출했습니다. 외부 수치는 출처를 표기했습니다.')
    b.h('수익 구조: 차주는 무료, 가치는 그룹 안에서 회수')
    b.bullets([
        '**B2C**: 핵심 기능(가치 지킴·여권) 무료. 프리미엄(시세 알림, 상세 리포트, 여권 PDF·QR 공유) 월 2,900원 [가정, 전환 5%] → 2028년 연 약 6.6억 원 [계산].',
        '**B2B 플릿**: 리스·렌터카 차량당 월 3,000원 [가정] → 5만 대 기준 연 18억 원 [계산]. 잔존가치 리스크가 줄어드는 리스사에게는 비용보다 이익이 큰 구조.',
        '**그룹 내부 가치(가장 큼)**: 인증중고차 매물 확보(가동률 개선), 보상판매를 통한 신차 재구매, 블루핸즈 정비 전환, 현대캐피탈 잔존가치 관리. 밸류링크은 **이 네 사업의 고객 접점**이 됩니다.',
    ])
    b.h('사회적 효과와 확장')
    b.bullets([
        '**중고 전기차 신뢰 회복**: 차량 실측 SOH와 위조 불가 이력은 중고 EV 시장의 가장 큰 불신(배터리)을 정면으로 해소합니다. EU 배터리 여권(2027 의무화) 흐름과도 맞닿습니다.',
        '**배터리 수명 연장 = 자원 절약**: 충전 습관 교정으로 열화 속도를 평균 대비 줄이면 배터리 교체·폐기 시점이 늦어집니다.',
        '**로드맵**: 2026 Q4 에뮬레이터 → 실차 검증 · 2027 Pleos App Market 출시, 인증중고차 연동 · 2028 현대캐피탈·렌터카 플릿, 기아·제네시스 확대 · 이후 배터리 2차 사용(ESS) 잔존가치 산정까지.',
    ])

    # 7. 참고자료 ─────────────────────────────────────────────────
    b = boxes[6]
    b.bullets([
        f'GitHub 저장소 (소스 코드 + APK: apk/ 폴더): {REPO}',
        f'웹 라이브 데모: {DEMO}  (#/ 랜딩 · #/console 시연 콘솔 · #/car 차량 앱 · #/passport 차량 여권 · #/fleet 플릿)',
        '시연 영상: 저장소 README 및 docs/ 폴더',
        '3D: tools/blender (IONIQ 5 비율 모델, 패널 라인·AO 베이킹, Cycles 렌더) · 웹/앱 공용 ioniq5.glb',
        '근거 자료: 딜사이트(2026.06) 현대차 인증중고차 매물 확보 분석 · 국토교통부 자동차 등록통계 보도(2026.06) · 카이즈유데이터연구소 중고차 거래량(2025.03) · Roole 중고 전기차 신뢰 조사(2025) · 현대차그룹 Pleos 발표(2026.04)',
    ])
    b.image('passport.png', 12.0, '그림 7. 차량 여권: 이력 무결성, 차량 실측 SOH, 해시 사슬과 “주행거리 되돌려 보기”')
    b.image('console.png', 15.6, '그림 8. 시연 콘솔: 차량 앱, 3D 트윈, Pleos SDK 호출 로그, 3년 가치 예측을 한 화면에')

    # 8. 숏폼 링크 ────────────────────────────────────────────────
    b = boxes[7]
    b.para('(선택) 게시 후 링크 기재 예정')

    doc.save(OUT)
    print('saved', OUT)


if __name__ == '__main__':
    main()
