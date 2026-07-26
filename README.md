# Chuldo — 출석 도우미

Electron + Python 하이브리드 데스크톱 앱. Windows UI Automation으로 Zoom 참가자 목록을 읽어와서, 미리 등록해둔 명단과 자동으로 대조해 출석을 확인합니다.

## 왜 만들었나

Zoom 화상 연수/강의에서 참가자 명단과 실제 접속자를 수작업으로 대조하는 게 번거로워서, 참가자 목록을 자동으로 긁어와 명단과 매칭하고 접속/카메라 상태를 감시하는 도구를 만들었습니다.

## 아키텍처

- **Electron (React + Vite)** — 화면 UI. 명단 입력, 출석 매칭 표시, 스크래퍼 제어를 담당
- **Python (`uiautomation`)** — Windows COM 기반 UI Automation으로 Zoom 참가자 창을 읽고 제어. Electron이 자식 프로세스로 실행하고 stdin/stdout(NDJSON)으로 통신
- 개발 중엔 시스템 Python 스크립트를 그대로 실행하고, 배포판은 PyInstaller로 `scraper.exe`를 만들어 Electron 리소스에 포함

```
src/
  main/       Electron 메인 프로세스 (스크래퍼 프로세스 관리, IPC, 명단 저장)
  renderer/   React 화면 (홈 / 명단관리 / 출석 관리 / 참가자 확인)
automation/
  scraper.py  uiautomation 기반 Zoom 참가자 목록 읽기/제어 스크립트
```

## 주요 화면

- **명단관리** — 연번/소속/성함을 스프레드시트처럼 입력. 구글 시트/엑셀에서 복사한 표를 그대로 붙여넣기 지원
- **출석 관리**
  - 주기적(초 단위) 자동 갱신 또는 즉시 로딩
  - 명단과 Zoom 참가자 이름을 정확 일치 / 이름만 일치 / 미접속으로 매칭 (필드 순서·구분자 조정 가능)
  - 접속 상태·카메라 켜짐/꺼짐 배지, 필터(전체 / 미접속자만 / 카메라 꺼짐만)
  - 알람: 미접속(기본) 또는 카메라 꺼짐 감지 시 소리로 알림, 표에서 인원별로 알람 개별 제외 가능
- **참가자 확인** — 스크래퍼 시작/중지, 즉시 조회, 원본 로그 확인 (디버깅용)

## 요구 사항

- **개발**: Node.js 20+, Python 3.11 (Windows, `py` 런처로 실행)
  - `uiautomation`은 Windows 전용이라 macOS/Linux에서는 Zoom 연동 기능이 동작하지 않음 (화면 UI 자체는 개발 가능)
- **배포판 실행**: Windows만 지원 (Zoom 연동용 exe에 Python이 포함돼 있어 별도 설치 불필요)

## 개발 환경 실행

```
git clone https://github.com/RyuRain0309/chuldo.git
cd chuldo
npm install
py -m pip install -r automation/requirements.txt
npm run dev
```

## 배포용 빌드 (Windows에서만 가능)

PyInstaller는 크로스 컴파일이 안 되고 `uiautomation`도 Windows 전용이라, 아래 빌드는 반드시 Windows에서 실행해야 합니다.

```
pip install pyinstaller
npm run dist
```

결과물은 `release/` 폴더에 생성됩니다 (설치 프로그램 + 압축 풀린 실행 파일).

## 알려진 이슈 / 참고

- Electron은 `42.3.3`으로 버전을 고정해뒀습니다. `42.4.0`부터 최신 버전까지는 Windows용 압축 해제 네이티브 바인딩(`@electron-internal/extract-zip-win32-x64-msvc`)이 npm에 게시돼 있지 않아 설치 자체가 실패합니다.
- `package-lock.json`은 git에 포함하지 않습니다. 맥/윈도우를 오가며 개발해서, 플랫폼별 `optionalDependencies` 잠금이 서로 충돌하는 걸 방지하기 위함입니다.
- Windows에서 파이썬을 `python`으로 실행하면 Windows Store 앱 실행 별칭과 충돌해 죽을 수 있어 `py` 런처를 사용합니다.
- Zoom 참가자 이름 파싱은 실제 관측된 문구("이름,(역할), 오디오 상태,비디오 상태, Press tab for more options") 기준입니다. Zoom 버전/언어에 따라 문구가 달라지면 `automation/scraper.py`의 `parse_participant_name`을 조정해야 할 수 있습니다.
