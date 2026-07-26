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
import time
import threading
import argparse

# Windows에서 파이프로 리다이렉트되면 파이썬이 OS 로케일 인코딩(cp949 등)을 쓰는데,
# Electron 쪽은 UTF-8로 디코딩하므로 여기서 무조건 UTF-8로 고정한다.
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import uiautomation as auto

DEFAULT_KEYWORDS = ['참가자', 'Participants']
DEFAULT_POLL_INTERVAL = 300  # seconds


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


def collect_participants(window):
    """창 안의 리스트 컨트롤에서 참가자 정보(이름/음소거/비디오 상태)를 수집.

    참가자 목록은 UI 가상화(virtualization)돼 있어서, 스크롤로 화면에 보인 적 없는
    항목은 UI Automation 트리에 아예 존재하지 않는다. 리스트를 맨 위로 되돌린 뒤
    끝까지 스크롤하며 매 단계에서 보이는 항목을 이름 기준으로 누적 수집하고,
    끝나면 스크롤 위치를 다시 맨 위로 복원한다(호스트 실제 화면이 움직이므로).
    """
    list_control = window.ListControl(searchDepth=10)
    if not list_control.Exists(0):
        return []

    participants = {}

    def collect_visible():
        for item in list_control.GetChildren():
            if item.Name:
                parsed = parse_participant_name(item.Name)
                participants.setdefault(parsed['name'], parsed)

    collect_visible()

    try:
        scroll = list_control.GetScrollPattern()
        if scroll is not None and scroll.VerticallyScrollable:
            scroll.SetScrollPercent(auto.ScrollPattern.NoScrollValue, 0, waitTime=0.15)
            collect_visible()
            last_percent = scroll.VerticalScrollPercent
            for _ in range(200):  # 안전장치: 무한 루프 방지
                if not scroll.Scroll(auto.ScrollAmount.NoAmount, auto.ScrollAmount.LargeIncrement, waitTime=0.15):
                    break
                collect_visible()
                percent = scroll.VerticalScrollPercent
                if percent <= last_percent or percent >= 100:
                    break
                last_percent = percent
            scroll.SetScrollPercent(auto.ScrollPattern.NoScrollValue, 0, waitTime=0.15)
    except Exception:
        # 스크롤 도중 창이 닫히는 등 실패해도 이미 모은 항목은 그대로 반환
        # (poll_loop는 이 함수를 try/except 없이 호출하므로 여기서 반드시 흡수해야 함)
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


def poll_loop(keywords, interval):
    while True:
        window = find_window_by_keywords(keywords)
        if window is None:
            emit({'type': 'participants', 'found': False, 'participants': []})
        else:
            emit({
                'type': 'participants',
                'found': True,
                'windowName': window.Name,
                'participants': collect_participants(window),
            })
        time.sleep(interval)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--interval', type=int, default=DEFAULT_POLL_INTERVAL)
    parser.add_argument('--keywords', type=str, default=','.join(DEFAULT_KEYWORDS))
    args = parser.parse_args()

    keywords = [k for k in args.keywords.split(',') if k]

    threading.Thread(target=stdin_command_loop, args=(keywords,), daemon=True).start()

    try:
        poll_loop(keywords, args.interval)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
