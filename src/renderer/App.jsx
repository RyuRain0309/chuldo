import { useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import RosterPage from './pages/RosterPage.jsx';
import ScraperPage from './pages/ScraperPage.jsx';
import AttendancePage from './pages/AttendancePage.jsx';

export default function App() {
  const [page, setPage] = useState('home');

  if (page === 'roster') return <RosterPage onBack={() => setPage('home')} />;
  if (page === 'scraper') return <ScraperPage onBack={() => setPage('home')} />;
  if (page === 'attendance') return <AttendancePage onBack={() => setPage('home')} />;
  return <HomePage onNavigate={setPage} />;
}
