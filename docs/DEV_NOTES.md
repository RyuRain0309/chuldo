# 개발 노트

다음 개발 세션(사람이든 AI든)이 바로 이어서 작업할 수 있도록, 코드만 봐서는 알기 어려운
결정 이유와 겪었던 문제/해결책을 정리한 문서. 사용법은 `README.md` 참고, 여긴 "왜 이렇게 했는지" 기록.

## 아키텍처 결정

- **Electron + Python 하이브리드**: Windows UI Automation은 COM 기반이라 Node.js엔 마땅한
  바인딩이 없고, Python(`uiautomation`)이 가장 성숙한 지원을 함. Electron이 자식 프로세스로
  실행하고 stdin/stdout NDJSON으로 통신.
- **React + Vite 도입**: 처음엔 vanilla JS 렌더러였다가, 명단관리/출석관리처럼 화면이 여러 개
  필요해지면서 React로 전환. 페이지 2~4개 수준이라 라우터 없이 `App.jsx`에서 `useState`로
  페이지 전환만 처리 (`page === 'roster' ? <RosterPage/> : ...`).
- **Tailwind CSS v4**: `@tailwindcss/vite` 플러그인 방식이라 별도 config 파일 없이
  `index.css`에 `@import "tailwindcss";` 한 줄로 끝남.
- **명단 저장**: `app.getPath('userData')/roster.json`에 JSON으로 저장. `id` 필드는 저장
  안 하고 화면에서 React key용으로만 씀 (불러올 때 새로 부여).

## 겪은 문제와 해결

트러블슈팅에 시간이 많이 든 것들. 비슷한 증상 다시 나오면 여기부터 확인.

- **Windows에서 `python` 실행 시 종료 코드 9009로 즉시 죽음**
  → Windows Store 앱 실행 별칭(App Execution Alias)이 진짜 인터프리터 대신 실행돼서 생김.
  `python` 대신 `py` 런처 사용으로 회피 (`src/main/main.js`의 `getScraperCommand()`).

- **`pip`, `pyinstaller` 등이 "명령을 찾을 수 없음"으로 실패 (하지만 `py`는 잘 됨)**
  → `py.exe`(런처)는 python.org 설치 시 시스템 경로에 특별 등록돼서 PATH가 꼬여도 잘 잡히는
  반면, `pip.exe`/`pyinstaller.exe` 같은 콘솔 스크립트는 파이썬 `Scripts` 폴더에 설치되는데
  이 폴더가 PATH에 없으면 못 찾음. PATH를 고치는 대신 `py -m pip`, `py -m PyInstaller`처럼
  **`-m`으로 모듈 실행**하면 Scripts/PATH를 거치지 않아서 안정적으로 동작함.
  `package.json`의 `build:py`도 이 방식으로 되어 있음.

- **한글이 깨져서 옴 (Python → Electron)**
  → Windows에서 파이썬이 파이프로 리다이렉트되면 OS 로케일 인코딩(cp949 등)을 쓰는데
  Electron은 UTF-8로 디코딩해서 불일치. `scraper.py` 최상단에서
  `sys.stdin/stdout/stderr.reconfigure(encoding='utf-8')`로 고정.

- **참가자 목록에서 스크롤 밖(화면에 안 보이는) 인원이 안 잡힘**
  → Zoom 참가자 리스트가 UI 가상화(virtualization)돼 있어서, 스크롤로 렌더링된 적 없는
  항목은 UI Automation 트리에 아예 존재하지 않음 (`GetChildren()`으로도 안 잡힘).
  실측으로 확인된 것: 이 리스트는 `ScrollPattern`도(컨트롤 자신·부모 체인 6단계까지 전부
  없음), 가상화 리스트 전용인 `ItemContainerPattern`도 지원 안 함. 시도 순서(각각 실측
  기반 판단):
  1. 실제 마우스 휠을 굴리는(`WheelDown`/`MoveTo`) 방식 — 동작은 했지만 사용자의 실제
     마우스 커서를 가로챔
  2. 창에 `WM_MOUSEWHEEL` 메시지를 직접 전달(`PostMessage`, win32 API) — 커서는 안
     건드리지만, 휠 1노치가 몇 항목인지 몰라서 안전하려면 스텝을 잘게 쪼개야 했고
     느렸음(참가자 많으면 15초 안팎)
  3. Page Down 키(`WM_KEYDOWN`/`WM_KEYUP`, `VK_NEXT`)를 `PostMessage`로 전달 — `SetFocus`를
     안 부르므로 창이 활성화(포커스 뺏김)는 안 되는 것까지 확인했고 속도도 훨씬 빨랐지만,
     **실측 결과 리스트만 스크롤되는 게 아니라 실제 Zoom 회의 화면(갤러리 뷰)까지 같이
     넘어가는 부작용이 있어서 폐기함.** 원인: 마우스 메시지와 달리 키보드 메시지(`WM_KEYDOWN`)는
     좌표 개념이 없어 특정 컨트롤에 좁혀 보낼 수 없고 Zoom 창 전체로 전달되는데, Zoom이
     Page Up/Down을 갤러리 뷰 페이지 넘기기용 전역 단축키로도 쓰기 때문에 동시에 먹힘.
     **교훈: `PostMessage`로 특정 컨트롤만 조준하려면 좌표 기반 메시지(마우스 계열)만
     안전하고, 키보드 메시지는 창 전체에 영향을 줄 수 있다고 가정해야 함.**
  4. **최종: 2번(`WM_MOUSEWHEEL` + `PostMessage`)으로 복귀**, 대신 속도 문제를 해결하려고
     스텝 크기를 적응형으로 바꿈(`automation/scraper.py`의 `post_wheel`/`collect_participants`):
     스크롤 전/후 겹치는 인원이 있으면(수학적으로 그 사이 구간을 안 건너뛴 게 보장됨) 겹침이
     70% 이상이면 스텝을 곱절로, 50~70%면 1씩 키우고, 겹침이 0이면(건너뛰었을 수 있음) 즉시
     1노치로 되돌림 (`MAX_NOTCHES_PER_STEP = 8`로 상한).
  창 이름의 "참가자(115)" 같은 총원 숫자를 목표로 삼아 다 모이면 조기 종료. 스크롤이
  호스트의 실제 Zoom 창 화면 자체는 계속 움직이므로(포커스/커서만 안 건드릴 뿐), 자동
  주기 갱신 간격을 아주 짧게 잡으면 참가자 패널이 자주 움직이는 게 보일 수 있음 (사용자
  확인 후 "항상 적용" 방식으로 결정함). `handle_command`가 예외를 잡아 error 타입으로
  바꿔버리면 이미 모은 참가자 목록이 통째로 날아가므로, 부분 결과라도 보존하려고 함수
  내부에서도 흡수함.
  진단에 쓴 임시 스크립트(`automation/debug_scroll.py`, `debug_itemcontainer.py`,
  `debug_postmessage.py`, `debug_pagedown.py`)는 커밋 대상 아님 — 비슷한 문제 다시
  생기면 참고용으로만.

- **"자동 갱신"을 꺼놔도 화면이 저절로 갱신됨**
  → `scraper.py`가 원래 자체적으로 `DEFAULT_POLL_INTERVAL`(5분)마다 참가자 정보를 emit하는
  `poll_loop`를 앱 실행과 동시에 돌리고 있었음. 화면의 "자동 갱신" 토글/주기(초)와는 완전히
  무관하게 백그라운드에서 따로 도는 타이머라, 꺼놔도 5분마다 갱신되는 것처럼 보였음.
  갱신 주기는 Electron(화면) 쪽이 전적으로 결정하게 하는 게 맞아서, `poll_loop`와
  `--interval` 인자를 통째로 제거하고 stdin `pollOnce` 명령이 올 때만 응답하도록 바꿈
  (`automation/scraper.py`의 `main`). 이제 스레드(`threading`)도 필요 없어져서 같이 제거함.

- **"음소거 해제됨"을 음소거로 잘못 인식**
  → `'음소거' in raw_name`처럼 부분 문자열로 검사하면 "음소거 해제됨"에도 걸림.
  `'음소거됨'` 전체 문구로 검사해야 함 (`automation/scraper.py`의 `parse_participant_name`).

- **macOS에서 Electron.app이 자꾸 휴지통으로 사라짐 / Gatekeeper가 "악성코드" 경고**
  → 원인 두 가지가 섞여 있었음: (1) 이 개발 도구(Claude Code의 Bash 샌드박스) 안에서
  압축을 풀면 코드 서명/리소스가 깨진 상태로 만들어짐 (`spctl`로 "code has no resources but
  signature indicates they must be present" 확인됨). (2) Electron 버전 자체 문제(아래 항목).
  **결론: Electron 실행 검증은 반드시 사용자의 실제 터미널에서 해야 함.** 이 저장소에서
  자동화 도구로 Electron을 직접 launch하려는 시도는 하지 말 것 (Playwright `_electron` 등).

- **Electron 42.4.0~43.x가 Windows에서 설치 자체 실패**
  ("Downloading Electron binary... prebuild for this platform is not bundled")
  → 이 구간 버전은 바이너리 압축 해제에 `@electron-internal/extract-zip`을 쓰는데, 이 패키지의
  win32-x64 네이티브 바인딩이 npm에 아예 게시가 안 돼있음 (npm 404, 패키지 자체가 없음).
  `42.3.3`까지는 예전 방식(순수 JS `extract-zip@^2.0.1`)이라 안전함.
  **`package.json`의 `electron` 버전은 캐럿(^) 없이 정확히 고정돼 있어야 함** — 나중에
  Electron 업그레이드할 일 있으면 새 버전이 `extract-zip`으로 돌아왔는지
  (`npm view electron@<버전> dependencies`) 꼭 먼저 확인.
  덤으로 최신 Electron 패키지는 `postinstall` 스크립트가 없어서 `npm install`만으로 바이너리가
  안 받아짐 → 우리 `package.json`에 `"postinstall": "node node_modules/electron/install.js"`
  직접 추가해둠.

- **`npm install`을 Windows에서 하면 electron/esbuild 네이티브 바이너리를 못 찾음**
  → `package-lock.json`을 맥에서 생성해서 커밋했더니, 플랫폼별 `optionalDependencies` 잠금이
  맥 기준으로 고정돼 Windows에서 깨짐 (알려진 npm 버그, npm/cli#4828).
  **`package-lock.json`은 git에 안 올림** (`.gitignore`에 포함). 맥/윈도우 오가며 개발하는 한
  이 방침 유지할 것.

- **PyInstaller / uiautomation은 Windows에서만 빌드/실행 가능**
  → 크로스 컴파일 불가. `npm run dist`(exe 빌드)는 반드시 Windows에서 실행.

## 기능 설계 히스토리 (알람)

출석 관리 알람 기능은 한 번에 완성된 게 아니라 피드백 받으며 여러 번 뒤집힘. 다음에 비슷한
"감시 대상 선택" UI 만들 때 참고:

1. 처음엔 "현재 접속 중인 사람만 알람 대상으로 선택(opt-in)" 방식으로 만듦
2. → 문제: 미출석자는 애초에 "접속 중"이었던 적이 없어서 opt-in 목록에 추가가 안 됨.
   정작 감지하고 싶은 대상(미출석자)을 감시할 수 없는 모순 발생
3. → **opt-out 방식으로 뒤집음**: 기본은 명단 전체가 감시 대상, 표에 "개별 알람" 토글 컬럼을
   둬서 특정 인원만 알람에서 뺄 수 있게 함 (알고 있는 결석자 등)
4. 미접속 감지는 항상 기본 동작(끌 수 없음), 카메라 꺼짐 감지만 별도 토글로 켜고 끌 수 있게 분리
5. 토글 라벨은 동작을 그대로 설명하도록 지음 ("미접속 감지 알림 활성화", "카메라 꺼짐 알림 활성화")

## 알려진 제한사항 / 일부러 안 만든 것

- 출석 관리 화면의 설정(주기, 매칭 순서/구분자, 알람 on/off, 알람 대상 제외 목록)은
  **저장 안 됨** — 페이지 나가거나 앱 재시작하면 초기화. 명단(`roster.json`)과 같은 방식으로
  영속화할 수 있지만, 요구사항이 안정된 뒤 나중에 추가하기로 함.
- 카메라 "켜짐"/음소거 "해제됨" 문구는 실제 Zoom 세션에서 관측한 값 기준으로 파싱함
  (`automation/scraper.py`의 `parse_participant_name` 주석 참고). Zoom 버전/언어가 다르면
  문구가 달라져 파싱이 깨질 수 있음 — 그럴 땐 참가자 확인 페이지의 "구조 덤프" 버튼으로 실제
  트리를 덤프해서 다시 맞춰야 함.
- 명단 저장 경로(`app.getPath('userData')`)가 개발 모드(`chuldo`)와 배포 모드(`Chuldo`)에서
  대소문자가 달라 서로 다른 폴더를 씀 (`package.json`에 `productName` 없어서 발생). 신경 쓰이면
  `productName`을 `name`과 통일하거나 실행 경로 옆에 저장하는 방식(포터블)으로 바꿀 것.

## 다음에 고려할 것

- GitHub Actions로 Windows 러너 빌드 자동화 (태그 push 시 자동으로 `npm run dist` → 릴리스
  업로드까지) — 제안했지만 아직 안 만듦, 필요해지면 진행
- 위 "저장 안 되는 설정" 영속화
- 참가자별로 알람 조건을 다르게(예: 이 사람은 카메라만, 저 사람은 접속만) 세분화할지 여부 —
  지금은 전역 조건 + 개별 on/off만 있음
