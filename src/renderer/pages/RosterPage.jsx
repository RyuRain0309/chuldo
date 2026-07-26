import { useEffect, useState } from 'react';

const FIELDS = ['trainingNumber', 'affiliation', 'name'];
const COLUMN_LABELS = ['연수번호', '소속', '성함'];

function emptyRow() {
  return { id: crypto.randomUUID(), trainingNumber: '', affiliation: '', name: '' };
}

// 구글 시트/엑셀에서 복사한 표는 탭으로 열, 개행으로 행이 구분된 텍스트로 붙여넣기 됨
function parseTSV(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((line, i, arr) => !(i === arr.length - 1 && line === ''))
    .map((line) => line.split('\t'));
}

export default function RosterPage({ onBack }) {
  const [rows, setRows] = useState([emptyRow()]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.api.loadRoster().then((data) => {
      setRows(data.length > 0 ? data.map((row) => ({ id: crypto.randomUUID(), ...row })) : [emptyRow()]);
    });
  }, []);

  function updateCell(id, field, value) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function handlePaste(e, rowIndex, field) {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const grid = parseTSV(text);
    const startCol = FIELDS.indexOf(field);

    setRows((prev) => {
      const next = [...prev];
      grid.forEach((line, r) => {
        const targetRow = rowIndex + r;
        while (targetRow >= next.length) next.push(emptyRow());
        const updated = { ...next[targetRow] };
        line.forEach((cellText, c) => {
          const targetCol = startCol + c;
          if (targetCol < FIELDS.length) updated[FIELDS[targetCol]] = cellText.trim();
        });
        next[targetRow] = updated;
      });
      return next;
    });
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(id) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  }

  function clearAll() {
    if (!confirm('명단을 전체 삭제할까요?')) return;
    setRows([emptyRow()]);
  }

  async function save() {
    const payload = rows
      .map(({ trainingNumber, affiliation, name }) => ({ trainingNumber, affiliation, name }))
      .filter((row) => row.trainingNumber || row.affiliation || row.name);
    await window.api.saveRoster(payload);
    setStatus('저장됨');
    setTimeout(() => setStatus(''), 1500);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="mb-4 text-2xl font-bold text-gray-800">명단관리</h1>

      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300"
        >
          ← 메인으로
        </button>
        <button
          onClick={addRow}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          행 추가
        </button>
        <button
          onClick={save}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
        >
          저장
        </button>
        <button
          onClick={clearAll}
          className="rounded-md bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200"
        >
          전체 삭제
        </button>
        {status && <span className="text-sm font-medium text-green-600">{status}</span>}
      </div>

      <p className="mb-3 text-sm text-gray-500">
        구글 스프레드시트에서 복사한 표를 아무 칸에 붙여넣으면 자동으로 채워집니다.
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100">
              {COLUMN_LABELS.map((label) => (
                <th
                  key={label}
                  className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600"
                >
                  {label}
                </th>
              ))}
              <th className="border-b border-gray-200 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id} className="hover:bg-gray-50">
                {FIELDS.map((field) => (
                  <td key={field} className="border-b border-gray-100 p-0">
                    <input
                      value={row[field]}
                      onChange={(e) => updateCell(row.id, field, e.target.value)}
                      onPaste={(e) => handlePaste(e, rowIndex, field)}
                      className="w-full border-none bg-transparent px-3 py-2 outline-none focus:bg-blue-50 focus:ring-2 focus:ring-inset focus:ring-blue-400"
                    />
                  </td>
                ))}
                <td className="border-b border-gray-100 px-2">
                  <button
                    onClick={() => removeRow(row.id)}
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
