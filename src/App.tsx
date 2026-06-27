import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import MainApp from './MainApp';

// ProtectedRoute is removed — MainApp handles both guest and logged-in modes.
// /login and /signup remain for explicit auth flows.

export default function App() {
  return (
    <Routes>
      <Route path="/login"  element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/*"      element={<MainApp />} />
      <Route path="*"       element={<Navigate to="/" replace />} />
    </Routes>
  );
}
