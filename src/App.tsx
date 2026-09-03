import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ConsentPage from './pages/ConsentPage';
import AiLogPage from './pages/AiLogPage';
import MainApp from './MainApp';
import ScrollToTop from './components/ScrollToTop';
import { ROUTES } from './routes';
import {
  DashboardView, TransactionsView, NewTransactionView, AnalysisView,
  RecurringView, BudgetsView, SavingsView, SettingsView,
} from './pages/routeViews';

// MainApp ist die Layout-Route: sie lädt die Daten und rendert die Navigation,
// die Unterseiten hängen als Kindrouten darunter. Gastmodus und angemeldeter
// Modus laufen beide hier durch — es gibt bewusst keinen Auth-Guard.
// /login, /signup und /oauth/consent stehen ausserhalb des Layouts.

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/oauth/consent" element={<ConsentPage />} />

        <Route element={<MainApp />}>
          <Route path={ROUTES.dashboard}    element={<DashboardView />} />
          <Route path={ROUTES.transactions} element={<TransactionsView />} />
          <Route path={ROUTES.new}          element={<NewTransactionView />} />
          <Route path={ROUTES.analysis}     element={<AnalysisView />} />
          <Route path={ROUTES.recurring}    element={<RecurringView />} />
          <Route path={ROUTES.savings}      element={<SavingsView />} />
          <Route path={ROUTES.budgets}      element={<BudgetsView />} />
          <Route path={ROUTES.settings}     element={<SettingsView />} />
          <Route path={ROUTES.aiLog}        element={<AiLogPage />} />
        </Route>

        <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
      </Routes>
    </>
  );
}
