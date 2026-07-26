import { useEffect, useState } from 'react';

export default function ScraperPage({ onBack }) {
  const [participants, setParticipants] = useState([]);
  const [log, setLog] = useState('');

  useEffect(() => {
    const unsubscribe = window.api.onData((data) => {
      setLog((prev) => prev + JSON.stringify(data) + '\n');
      if (data.type === 'participants' && Array.isArray(data.participants)) {
        setParticipants(data.participants);
      }
    });
    return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="mb-4 text-2xl font-bold text-gray-800">참가자 확인</h1>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
        >
          ← 메인으로
        </button>
        <button
          onClick={() => window.api.start()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          스크래퍼 시작
        </button>
        <button
          onClick={() => window.api.stop()}
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
        >
          스크래퍼 중지
        </button>
        <button
          onClick={() => window.api.sendCommand({ action: 'pollOnce' })}
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
        >
          즉시 조회
        </button>
        <button
          onClick={() => window.api.sendCommand({ action: 'dumpParticipants' })}
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
        >
          구조 덤프 (진단용)
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">참가자 목록</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
          {participants.map((p, i) => (
            <li key={i}>
              {p.name} {p.audioMuted && '🔇'} {p.videoOff ? '📷꺼짐' : '📷켜짐'}
            </li>
          ))}
        </ul>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-gray-600">로그</h2>
      <pre className="h-60 overflow-y-auto rounded-lg bg-gray-900 p-3 text-xs text-green-400">{log}</pre>
    </div>
  );
}
