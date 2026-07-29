import { useEffect, useRef, useState } from 'react';

// 연번+성함이 모두 참가자 이름 문자열에 포함되면 출석 확정, 성함만 포함되면 확인 필요.
// 동명이인 등으로 성함만으로 여러 명이 매칭될 수 있어 전부 찾아서(matches) 판정에 씀 —
// 특히 같은 사람이 기기 2대로 중복 접속한 경우 카메라 상태를 합치는 데 필요함.
function findMatch(row, participants) {
  if (!row.name) return { status: 'none', participant: null };

  const matches = participants.filter((p) => p.name.includes(row.name));
  if (matches.length === 0) return { status: 'none', participant: null };

  const hasNumber = row.trainingNumber != null && String(row.trainingNumber) !== '';
  const status = hasNumber && matches.some((p) => p.name.includes(String(row.trainingNumber)))
    ? 'confirmed'
    : 'needsCheck';

  // 중복 접속으로 여러 명이 매칭된 경우, 그중 하나라도 카메라가 켜져 있으면 켜진 것으로 처리
  const cameraOn = matches.some((p) => !p.videoOff);
  const participant = { ...matches[0], videoOff: !cameraOn };

  return { status, participant };
}

function ConnectionBadge({ status }) {
  if (status === 'confirmed') {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">출석</span>;
  }
  if (status === 'needsCheck') {
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">확인 필요</span>
    );
  }
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400">미접속</span>;
}

// 카메라 on/off는 색(초록/빨강) 배경 + 텍스트로 구분되게 함 (이모지 없이)
function CameraBadge({ participant }) {
  if (!participant) {
    return <span className="text-xs text-gray-300">-</span>;
  }
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold text-white ${
          participant.videoOff ? 'bg-red-500' : 'bg-green-500'
        }`}
      >
        {participant.videoOff ? '카메라 꺼짐' : '카메라 켜짐'}
      </span>
      {participant.audioMuted && (
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">음소거</span>
      )}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// 짧은 비프음 1개는 놓치기 쉬워서, 좀 더 눈에 띄게 3번 반복
function playAlarmSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextClass();
  const beepDuration = 0.15;
  const gap = 0.12;
  for (let i = 0; i < 3; i++) {
    const startTime = ctx.currentTime + i * (beepDuration + gap);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 1000;
    gain.gain.value = 0.3;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + beepDuration);
  }
}

export default function AttendancePage({ onBack }) {
  const [roster, setRoster] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [windowFound, setWindowFound] = useState(true);
  const [intervalSec, setIntervalSec] = useState(10);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmOnCameraOff, setAlarmOnCameraOff] = useState(true);
  const [cameraOffStack, setCameraOffStack] = useState(1);
  const [alarmExcluded, setAlarmExcluded] = useState(new Set());
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const timerRef = useRef(null);
  const tickRef = useRef(null);
  const autoRefreshRef = useRef(autoRefresh);
  const intervalSecRef = useRef(intervalSec);
  const cameraOffStreakRef = useRef({}); // 인덱스별 카메라 꺼짐 연속 감지 횟수

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
  }, [autoRefresh]);

  useEffect(() => {
    intervalSecRef.current = intervalSec;
  }, [intervalSec]);

  useEffect(() => {
    window.api.loadRoster().then(setRoster);
  }, []);

  // 참가자 스크롤 수집에 십수 초씩 걸릴 수 있어서, 다음 자동 갱신은 "요청을 보낸 시점"이
  // 아니라 "응답(참가자 데이터)을 받은 시점"부터 주기를 다시 세야 함. 그래서 고정
  // setInterval 대신, 응답이 도착할 때마다 여기서 다음 pollOnce를 setTimeout으로 예약함.
  useEffect(() => {
    const unsubscribe = window.api.onData((data) => {
      if (data.type === 'participants') {
        setWindowFound(Boolean(data.found));
        setParticipants(Array.isArray(data.participants) ? data.participants : []);

        if (autoRefreshRef.current) {
          const seconds = Math.max(1, intervalSecRef.current);
          setNextRefreshIn(seconds);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            window.api.sendCommand({ action: 'pollOnce' });
          }, seconds * 1000);
        }
      }
    });
    return unsubscribe;
  }, []);

  // 참가자 데이터가 새로 도착할 때마다(주기 갱신 or 직접 로딩) 명단 전체 중
  // (제외 목록 제외) 미접속인 사람이 있으면 소리로 알림 (미접속 감지는 항상 기본 동작)
  // 카메라 꺼짐 감지는 alarmOnCameraOff로 켜고 끌 수 있고, 바로 알리지 않고 cameraOffStack에
  // 지정한 횟수만큼 연속으로 꺼진 상태가 감지돼야 알림. 중간에 카메라가 켜지면 그 사람의
  // 연속 횟수는 0으로 초기화됨. 모든 사람을 다 순회해야 각자의 연속 횟수가 정확히 갱신되므로
  // (일부만 보고 멈추는 some 대신) forEach로 전부 훑는다.
  useEffect(() => {
    if (!alarmEnabled) return;
    const streaks = cameraOffStreakRef.current;
    const threshold = Math.max(1, cameraOffStack);
    let triggered = false;

    roster.forEach((row, index) => {
      if (alarmExcluded.has(index)) return;
      const { status, participant } = findMatch(row, participants);

      if (status === 'none') {
        triggered = true; // 미접속 감지는 항상 기본 동작(스택 없이 즉시)
        return;
      }

      if (!alarmOnCameraOff) return;

      if (participant?.videoOff) {
        streaks[index] = (streaks[index] || 0) + 1;
        if (streaks[index] >= threshold) triggered = true;
      } else {
        streaks[index] = 0; // 카메라 켜짐 감지 -> 초기화
      }
    });

    if (triggered) playAlarmSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  useEffect(() => {
    if (!autoRefresh) {
      setNextRefreshIn(null);
      clearTimeout(timerRef.current);
      return undefined;
    }
    window.api.start();
    setNextRefreshIn(null); // 첫 응답 오기 전엔 몇 초 남았는지 알 수 없음 (수집 중)
    window.api.sendCommand({ action: 'pollOnce' }); // 응답이 오면 위 onData 핸들러가 다음 것을 예약함

    tickRef.current = setInterval(() => {
      setNextRefreshIn((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
    }, 1000);

    return () => {
      clearTimeout(timerRef.current);
      clearInterval(tickRef.current);
    };
  }, [autoRefresh]);

  function loadOnce() {
    window.api.start();
    window.api.sendCommand({ action: 'pollOnce' });
  }

  const rowsWithMatch = roster.map((row, index) => ({ index, row, ...findMatch(row, participants) }));
  const filteredRows = rowsWithMatch.filter(({ status, participant }) => {
    if (filter === 'notConnected') return status === 'none';
    if (filter === 'cameraOff') return status !== 'none' && participant?.videoOff;
    if (filter === 'attention') return status === 'none' || participant?.videoOff;
    return true;
  });
  const FILTERS = [
    { key: 'all', label: '전체' },
    { key: 'notConnected', label: '미접속자만' },
    { key: 'cameraOff', label: '카메라 꺼짐만' },
    { key: 'attention', label: '미접속+카메라 꺼짐' },
  ];
  function toggleAlarmExcluded(index) {
    setAlarmExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="mb-4 text-2xl font-bold text-gray-800">출석 관리</h1>

      <div className="mb-4">
        <button onClick={onBack} className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300">
          ← 메인으로
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-600"
        >
          <span>설정</span>
          <span className="text-gray-400">{settingsOpen ? '숨기기 ▲' : '펼치기 ▼'}</span>
        </button>

        {settingsOpen && (
          <div className="space-y-4 border-t border-gray-100 px-4 py-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">주기(초)</label>
                <input
                  type="number"
                  min="1"
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(Number(e.target.value))}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <ToggleSwitch checked={autoRefresh} onChange={() => setAutoRefresh((v) => !v)} />
                자동 갱신
                {autoRefresh && (
                  <span className="text-xs text-gray-400">
                    {nextRefreshIn !== null ? `(다음 갱신까지 ${nextRefreshIn}초)` : '(참가자 수집 중…)'}
                  </span>
                )}
              </label>

              <button
                onClick={loadOnce}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                직접 로딩
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-gray-500">알람 설정</p>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <ToggleSwitch checked={alarmEnabled} onChange={() => setAlarmEnabled((v) => !v)} />
                미접속 감지 알림 활성화
              </label>
              {alarmEnabled && (
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <ToggleSwitch checked={alarmOnCameraOff} onChange={() => setAlarmOnCameraOff((v) => !v)} />
                    카메라 꺼짐 알림 활성화
                  </label>
                  {alarmOnCameraOff && (
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      <span>연속</span>
                      <input
                        type="number"
                        min="1"
                        value={cameraOffStack}
                        onChange={(e) => setCameraOffStack(Math.max(1, Number(e.target.value)))}
                        className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                      <span>번 감지되면 알림 (중간에 켜지면 초기화)</span>
                    </label>
                  )}
                  <p className="text-xs text-gray-500">
                    기본적으로 명단 전체가 감시 대상입니다. 특정 인원을 알람에서 빼려면 아래 표의 "개별 알람" 칸에서 꺼주세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!windowFound && (
        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          ⚠️ Zoom 참가자 목록 창을 찾을 수 없어요. Zoom 회의에서 참가자 목록을 열어주세요.
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        {FILTERS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              filter === opt.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-xs text-gray-400">
          {filteredRows.length} / {roster.length}명
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-16" />
            <col className="w-56" />
            <col className="w-40" />
            <col />
            <col />
            {alarmEnabled && <col />}
          </colgroup>
          <thead>
            <tr className="bg-gray-100">
              <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">연번</th>
              <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">소속</th>
              <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">성함</th>
              <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">접속 상태</th>
              <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">카메라</th>
              {alarmEnabled && (
                <th className="border-b border-gray-200 px-3 py-2 text-center font-semibold text-gray-600">개별 알람</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ index, row, status, participant }) => (
              <tr key={index} className="hover:bg-gray-50">
                <td className="border-b border-gray-100 px-3 py-2 text-center">{row.trainingNumber}</td>
                <td className="border-b border-gray-100 px-3 py-2 text-center">{row.affiliation}</td>
                <td className="border-b border-gray-100 px-3 py-2 text-center">{row.name}</td>
                <td className="border-b border-gray-100 px-3 py-2 text-center">
                  <ConnectionBadge status={status} />
                </td>
                <td className="border-b border-gray-100 px-3 py-2 text-center">
                  <CameraBadge participant={participant} />
                </td>
                {alarmEnabled && (
                  <td className="border-b border-gray-100 px-3 py-2 text-center">
                    <ToggleSwitch checked={!alarmExcluded.has(index)} onChange={() => toggleAlarmExcluded(index)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
