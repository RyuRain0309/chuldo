export default function HomePage({ onNavigate }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50">
      <h1 className="text-3xl font-bold text-gray-800">출석 관리</h1>
      <div className="flex gap-3">
        <button
          onClick={() => onNavigate('roster')}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-sm hover:bg-blue-700"
        >
          명단관리
        </button>
        <button
          onClick={() => onNavigate('scraper')}
          className="rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-700 shadow-sm hover:bg-gray-300"
        >
          참가자 확인
        </button>
      </div>
    </div>
  );
}
