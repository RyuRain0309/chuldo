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


def collect_participants(window):
    """창 안의 리스트 컨트롤에서 참가자 이름들을 수집."""
    list_control = window.ListControl(searchDepth=10)
    if not list_control.Exists(0):
        return []
    return [item.Name for item in list_control.GetChildren() if item.Name]


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
        return {'type': 'error', 'action': action, 'message': 'target window not found'}

    try:
        if action == 'pollOnce':
            return {
                'type': 'participants',
                'found': True,
                'windowName': window.Name,
                'participants': collect_participants(window),
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
