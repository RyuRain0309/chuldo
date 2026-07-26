import { useEffect, useRef, useState } from 'react';

const FIELD_LABELS = { trainingNumber: '연번', affiliation: '소속', name: '성함' };

function buildExpectedName(row, order, separator) {
  return order.map((field) => row[field] ?? '').join(separator);
}

function findMatch(row, order, separator, participants) {
  const expected = buildExpectedName(row, order, separator);
  if (expected) {
    const exact = participants.find((p) => p.name === expected);
    if (exact) return { status: 'exact', participant: exact };
  }
  if (row.name) {
    const partial = participants.find((p) => p.name.includes(row.name));
    if (partial) return { status: 'nameOnly', participant: partial };
  }
  return { status: 'none', participant: null };
}

function ConnectionBadge({ status }) {
  if (status === 'exact') {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✓ 접속</span>;
  }
  if (status === 'nameOnly') {
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">이름만 일치</span>
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
  const [order, setOrder] = useState(['trainingNumber', 'affiliation', 'name']);
  const [separator, setSeparator] = useState('-');
  const [intervalSec, setIntervalSec] = useState(10);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmOnCameraOff, setAlarmOnCameraOff] = useState(true);
  const [alarmExcluded, setAlarmExcluded] = useState(new Set());
  const timerRef = useRef(null);

  useEffect(() => {
    window.api.loadRoster().then(setRoster);
  }, []);

  useEffect(() => {
    const unsubscribe = window.api.onData((data) => {
      if (data.type === 'participants') {
        setWindowFound(Boolean(data.found));
        setParticipants(Array.isArray(data.participants) ? data.participants : []);
      }
    });
    return unsubscribe;
  }, []);

  // 참가자 데이터가 새로 도착할 때마다(주기 갱신 or 직접 로딩) 명단 전체 중
  // (제외 목록 제외) 미접속인 사람이 있으면 소리로 알림 (미접속 감지는 항상 기본 동작)
  // 카메라 꺼짐 감지는 alarmOnCameraOff로 켜고 끌 수 있음
  useEffect(() => {
    if (!alarmEnabled) return;
    const triggered = roster.some((row, index) => {
      if (alarmExcluded.has(index)) return false;
      const { status, participant } = findMatch(row, order, separator, participants);
      if (status === 'none') return true;
      if (alarmOnCameraOff && participant?.videoOff) return true;
      return false;
    });
    if (triggered) playAlarmSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    window.api.start();
    timerRef.current = setInterval(() => {
      window.api.sendCommand({ action: 'pollOnce' });
    }, Math.max(1, intervalSec) * 1000);
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, intervalSec]);

  function loadOnce() {
    window.api.start();
    window.api.sendCommand({ action: 'pollOnce' });
  }

  function moveField(index, direction) {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const preview =
    roster.length > 0
      ? buildExpectedName(roster[0], order, separator)
      : order.map((f) => FIELD_LABELS[f]).join(separator);

  const rowsWithMatch = roster.map((row, index) => ({ index, row, ...findMatch(row, order, separator, participants) }));
  const filteredRows = rowsWithMatch.filter(({ status, participant }) => {
    if (filter === 'notConnected') return status === 'none';
    if (filter === 'cameraOff') return status !== 'none' && participant?.videoOff;
    return true;
  });
  const FILTERS = [
    { key: 'all', label: '전체' },
    { key: 'notConnected', label: '미접속자만' },
    { key: 'cameraOff', label: '카메라 꺼짐만' },
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
              </label>

              <button
                onClick={loadOnce}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                직접 로딩
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold text-gray-500">이름 매칭 설정</p>
              <div className="mb-2 flex flex-wrap items-center gap-4">
                <div>
                  <p className="mb-1 text-xs text-gray-500">순서</p>
                  <div className="flex gap-2">
                    {order.map((field, i) => (
                      <div
                        key={field}
                        className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      >
                        <span>{FIELD_LABELS[field]}</span>
                        <button
                          onClick={() => moveField(i, -1)}
                          disabled={i === 0}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveField(i, 1)}
                          disabled={i === order.length - 1}
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">구분자</p>
                  <input
                    value={separator}
                    onChange={(e) => setSeparator(e.target.value)}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                정확 일치 판정에 쓰일 예시: <span className="font-mono text-gray-700">{preview}</span>
              </p>
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
