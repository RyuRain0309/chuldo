"""
Windows UI Automation 스크래퍼.

Electron이 자식 프로세스로 실행한다.
- stdout: NDJSON(한 줄 = JSON 객체 하나)으로 결과를 flush
- stdin : Electron이 보내는 제어 명령(NDJSON)을 읽어서 실행

윈도우 이름은 버전/언어/참가자 수에 따라 달라지므로("참가자", "참가자 (25)",
"Participants" 등) 정확 매칭 대신 부분 일치(in 연산자)로 찾는다.
"""

import sys
import json
import re
import time
import argparse
import ctypes
import ctypes.wintypes as wintypes

# Windows에서 파이프로 리다이렉트되면 파이썬이 OS 로케일 인코딩(cp949 등)을 쓰는데,
# Electron 쪽은 UTF-8로 디코딩하므로 여기서 무조건 UTF-8로 고정한다.
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import uiautomation as auto

DEFAULT_KEYWORDS = ['참가자', 'Participants']

WM_MOUSEWHEEL = 0x020A
_user32 = ctypes.windll.user32
_user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
_user32.PostMessageW.restype = wintypes.BOOL


def post_wheel(hwnd, x, y, delta):
    """실제 마우스 커서를 건드리지 않고, 창에 WM_MOUSEWHEEL 메시지만 전달(PostMessage)해
    스크롤을 흉내낸다. (x, y)는 스크린 좌표. delta는 표준 1노치 단위인 120의 배수.
    마우스 휠은 좌표 기반으로 라우팅되므로(WindowFromPoint), 지정한 좌표(리스트 영역)에만
    정확히 꽂힌다 — 키보드 메시지(WM_KEYDOWN)와 달리 창 전체로 새지 않는다."""
    wparam = (delta & 0xFFFF) << 16
    lparam = ((y & 0xFFFF) << 16) | (x & 0xFFFF)
    return bool(_user32.PostMessageW(hwnd, WM_MOUSEWHEEL, wparam, lparam))


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def find_window_by_keywords(keywords):
    """최상위 창들 중 이름에 keywords 중 하나라도 포함된 첫 창을 반환."""
    root = auto.GetRootControl()
    for child in root.GetChildren():
        name = getattr(child, 'Name', '') or ''
        if any(keyword in name for keyword in keywords):
            return child
    return None


def parse_participant_name(raw_name):
    """Zoom 참가자 항목의 접근성 이름을 파싱.

    예: "Indian Lee,(호스트, 나), 컴퓨터 오디오 음소거됨,비디오 꺼짐, Press tab for more options"
    이름은 첫 콤마 이전 부분 (역할 태그 괄호 안에도 콤마가 있어 콤마 전체 split은 안 됨).
    음소거/비디오-꺼짐 문구가 "포함"돼 있는지로 판단 (켜짐/음소거 아님 상태의 정확한 문구는
    아직 관측하지 못해서, 꺼짐/음소거 키워드가 없으면 켜짐/음소거 아님으로 간주하는 방식).
    """
    name = raw_name.split(',', 1)[0].strip()
    return {
        'name': name,
        # "음소거 해제됨"(음소거 아님)에도 "음소거"가 부분 문자열로 들어있어서
        # 반드시 "음소거됨" 전체 문구로 검사해야 함
        'audioMuted': '음소거됨' in raw_name,
        'videoOff': '비디오 꺼짐' in raw_name,
    }


def parse_total_count(window_name):
    """창 이름("참가자(115)", "Participants (25)" 등)에서 괄호 안 총원 숫자를 추출.
    못 찾으면 None (이 경우 스크롤 수집은 정체 감지로만 종료 시점을 판단)."""
    match = re.search(r'\((\d+)\)', window_name or '')
    return int(match.group(1)) if match else None


def collect_participants(window):
    """창 안의 리스트 컨트롤에서 참가자 정보(이름/음소거/비디오 상태)를 수집.

    참가자 목록은 UI 가상화(virtualization)돼 있어서, 스크롤로 화면에 보인 적 없는
    항목은 UI Automation 트리에 아예 존재하지 않는다. 실측 결과 이 리스트는 ScrollPattern도
    ItemContainerPattern도 지원하지 않는다.

    Page Down 키(WM_KEYDOWN/WM_KEYUP)를 PostMessage로 보내는 방식도 시도해봤는데,
    키보드 메시지는 좌표 개념이 없어서 특정 컨트롤에만 좁혀 보낼 수가 없고 Zoom 창
    전체로 전달됨 — Zoom은 Page Up/Down을 갤러리 뷰 페이지 넘기기용 전역 단축키로도
    쓰기 때문에, 리스트 스크롤과 동시에 실제 회의 화면(갤러리 뷰)까지 넘어가버리는
    부작용이 실측으로 확인돼서 폐기함. 그래서 마우스 휠(WM_MOUSEWHEEL)을 PostMessage로
    보내는 방식을 씀 — 휠 메시지는 좌표 기반으로 라우팅되므로(WindowFromPoint) 지정한
    좌표(리스트 영역)에만 정확히 꽂히고, 창 전체로 새지 않는다. 커서는 전혀 움직이지 않는다.

    스텝(휠 몇 노치를 한 번에 보낼지)은 매번 적응적으로 조절한다: 스크롤 전/후 화면에
    보이는 인원이 하나라도 겹치면 그 사이 구간은 절대 건너뛴 게 아니라는 게 보장되므로
    (겹치는 항목의 앞뒤로 두 화면의 합집합이 이어지기 때문), 겹침이 넉넉하면(화면 70%
    이상) 스텝을 곱절로 키우고, 절반 이상이면 조금씩만 키워서 속도를 높인다. 겹침이 0이면
    건너뛰었을 수 있으니 즉시 가장 작은 단위(1노치)로 되돌린다. 창 이름의 "(총원)" 숫자를
    목표로 삼아 다 모이면 조기 종료하고, 끝나면 스크롤 위치를 다시 맨 위로 복원한다
    (호스트 실제 화면은 계속 움직임 — 커서만 안 건드릴 뿐).
    """
    list_control = window.ListControl(searchDepth=10)
    if not list_control.Exists(0):
        return []

    participants = {}

    def visible_names():
        names = set()
        for item in list_control.GetChildren():
            if item.Name:
                parsed = parse_participant_name(item.Name)
                name = parsed['name']
                names.add(name)
                existing = participants.get(name)
                if existing is None:
                    participants[name] = parsed
                else:
                    # 동명이인 중복 접속 등으로 같은 이름이 또 관측된 경우, setdefault로
                    # 처음 값만 고정해버리면 나중에 카메라 켜진 걸 관측해도 무시돼버림.
                    # 카메라는 "한 번이라도 켜진 적 있으면 켜짐"으로 병합, 음소거는 최신 값 사용.
                    participants[name] = {
                        'name': name,
                        'audioMuted': parsed['audioMuted'],
                        'videoOff': existing['videoOff'] and parsed['videoOff'],
                    }
        return names

    prev_visible = visible_names()

    hwnd = window.NativeWindowHandle
    total = parse_total_count(window.Name)
    applied_notches = 0

    if hwnd:
        try:
            rect = list_control.BoundingRectangle
            if not rect.isempty():
                x, y = rect.xcenter(), rect.ycenter()

                MAX_NOTCHES_PER_STEP = 8
                notches_per_step = 1
                stale_rounds = 0

                for _ in range(600):  # 안전장치: 무한 루프 방지
                    if total is not None and len(participants) >= total:
                        break
                    before = len(participants)

                    for _ in range(notches_per_step):
                        post_wheel(hwnd, x, y, -120)
                        applied_notches += 1
                    time.sleep(0.05 + 0.015 * notches_per_step)  # 스텝이 클수록 렌더링 시간 더 줌

                    curr_visible = visible_names()
                    overlap = len(prev_visible & curr_visible)
                    view_size = max(1, len(curr_visible))

                    if len(participants) == before:
                        stale_rounds += 1
                    else:
                        stale_rounds = 0

                    if overlap == 0:
                        notches_per_step = 1  # 건너뛰었을 수 있음 -> 안전하게 최소 단위로
                    elif overlap >= view_size * 0.7 and notches_per_step < MAX_NOTCHES_PER_STEP:
                        notches_per_step = min(MAX_NOTCHES_PER_STEP, notches_per_step * 2)  # 넉넉히 겹침 -> 곱절로 가속
                    elif overlap >= view_size // 2 and notches_per_step < MAX_NOTCHES_PER_STEP:
                        notches_per_step += 1  # 겹침이 애매하면 조금씩만 키움

                    prev_visible = curr_visible

                    if stale_rounds >= 6:  # 6번 연속 새 인원 없으면 끝까지 본 것으로 간주
                        break

                if applied_notches:
                    for _ in range(applied_notches):
                        post_wheel(hwnd, x, y, 120)
                        time.sleep(0.01)

                if total is not None and len(participants) < total:
                    print(
                        f'[collect_participants] 총원({total})보다 적게 수집됨: {len(participants)}명',
                        file=sys.stderr, flush=True,
                    )
        except Exception:
            # 스크롤 도중 창이 닫히는 등 실패해도 이미 모은 항목은 그대로 반환
            # (실패해서 예외를 그냥 던지면 handle_command가 이미 모은 참가자 목록 없이
            # error 타입만 반환하게 되므로, 여기서 흡수하고 부분 결과라도 돌려줌)
            pass

    return list(participants.values())


def describe_control(control, depth):
    """컨트롤과 하위 컨트롤을 타입/이름/AutomationId까지 재귀적으로 덤프.
    카메라 on/off 같은 상태가 UI Automation 트리 어디에 노출되는지 확인하기 위한 진단용.
    """
    info = {
        'name': getattr(control, 'Name', '') or '',
        'controlType': getattr(control, 'ControlTypeName', '') or '',
        'automationId': getattr(control, 'AutomationId', '') or '',
    }
    if depth > 0:
        info['children'] = [describe_control(child, depth - 1) for child in control.GetChildren()]
    return info


def dump_participant_tree(window):
    """참가자 목록의 각 항목을 하위 컨트롤까지 포함해 덤프."""
    list_control = window.ListControl(searchDepth=10)
    if not list_control.Exists(0):
        return {'error': 'list control not found'}
    return [describe_control(item, depth=3) for item in list_control.GetChildren()]


def find_control(window, automation_id=None, name=None):
    kwargs = {}
    if automation_id:
        kwargs['AutomationId'] = automation_id
    if name:
        kwargs['Name'] = name
    ctrl = window.Control(searchDepth=20, **kwargs)
    return ctrl if ctrl.Exists(0) else None


def handle_command(command, keywords):
    action = command.get('action')
    window = find_window_by_keywords(keywords)
    if window is None:
        if action == 'pollOnce':
            return {'type': 'participants', 'found': False, 'participants': []}
        return {'type': 'error', 'action': action, 'message': 'target window not found'}

    try:
        if action == 'pollOnce':
            return {
                'type': 'participants',
                'found': True,
                'windowName': window.Name,
                'participants': collect_participants(window),
            }

        if action == 'dumpParticipants':
            return {
                'type': 'participantsDump',
                'windowName': window.Name,
                'tree': dump_participant_tree(window),
            }

        ctrl = find_control(window, command.get('automationId'), command.get('name'))
        if ctrl is None:
            return {'type': 'error', 'action': action, 'message': 'control not found'}

        if action == 'click':
            ctrl.GetInvokePattern().Invoke()
        elif action == 'setText':
            ctrl.GetValuePattern().SetValue(command.get('value', ''))
        elif action == 'toggle':
            ctrl.GetTogglePattern().Toggle()
        elif action == 'select':
            ctrl.GetSelectionItemPattern().Select()
        else:
            return {'type': 'error', 'action': action, 'message': f'unknown action: {action}'}

        return {'type': 'result', 'action': action, 'ok': True}
    except Exception as exc:
        return {'type': 'error', 'action': action, 'message': str(exc)}


def stdin_command_loop(keywords):
    """Electron이 stdin으로 보내는 제어 명령(JSON 한 줄)을 읽어 실행."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            emit({'type': 'error', 'message': f'invalid json: {line}'})
            continue
        emit(handle_command(command, keywords))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keywords', type=str, default=','.join(DEFAULT_KEYWORDS))
    args = parser.parse_args()

    keywords = [k for k in args.keywords.split(',') if k]

    # 갱신 주기는 Electron 쪽(화면의 "자동 갱신"/"주기(초)")이 전적으로 결정한다.
    # 여기서 자체적으로 타이머를 돌려 참가자 정보를 내보내면, 화면의 자동 갱신을 꺼놔도
    # 이 프로세스가 켜져있는 한(앱 실행과 동시에 시작됨) 알아서 갱신되는 문제가 생김.
    # 그래서 stdin으로 pollOnce 명령이 올 때만 응답하고, 자체 폴링 루프는 두지 않는다.
    try:
        stdin_command_loop(keywords)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
