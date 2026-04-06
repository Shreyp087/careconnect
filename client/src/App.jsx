import { Route, Routes } from 'react-router-dom';

import ErrorBoundary from './components/ErrorBoundary.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Landing from './pages/Landing.jsx';
import PatientChat from './pages/PatientChat.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/patient" element={<PatientChat />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </ErrorBoundary>
  );
}
