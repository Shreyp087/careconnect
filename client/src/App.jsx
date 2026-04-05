import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import ErrorBoundary from './components/ErrorBoundary.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import PatientChat from './pages/PatientChat.jsx';

const navLinkClassName = ({ isActive }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-ink text-white shadow-sm' : 'text-slate-600 hover:bg-white/75 hover:text-ink'
  }`;

export default function App() {
  return (
    <div className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl">
        <header className="glass-card-strong sticky top-4 z-20 mb-6 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="section-label">CareConnect</p>
              <h1 className="mt-2 text-2xl text-ink">Patient Scheduling Platform</h1>
            </div>

            <nav className="flex flex-wrap gap-2 rounded-full bg-white/70 p-1">
              <NavLink to="/patient" className={navLinkClassName}>
                Patient Concierge
              </NavLink>
              <NavLink to="/admin" className={navLinkClassName}>
                Admin Dashboard
              </NavLink>
            </nav>
          </div>
        </header>

        <main>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Navigate to="/patient" replace />} />
              <Route path="/patient" element={<PatientChat />} />
              <Route path="/admin" element={<AdminDashboard />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
