import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Balance } from "./pages/Balance";
import { Cashflow } from "./pages/Cashflow";
import { Positions } from "./pages/Positions";
import { Trades } from "./pages/Trades";
import { Auth } from "./pages/Auth";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="positions" element={<Positions />} />
          <Route path="trades" element={<Trades />} />
          <Route path="balance" element={<Balance />} />
          <Route path="cashflow" element={<Cashflow />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
