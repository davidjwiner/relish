import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthBoundary } from '../auth/AuthBoundary';
import { LoginPage } from '../auth/LoginPage';
import { ChatPage } from '../pages/ChatPage';
import { FeaturePage } from '../pages/FeaturePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { TasteProfilePage } from '../pages/TasteProfilePage';
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthBoundary />}>
          <Route path="/chat/:threadId?" element={<ChatPage />} />
          <Route path="/taste-profile" element={<TasteProfilePage />} />
          <Route path="/radar" element={<FeaturePage feature="radar" />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
