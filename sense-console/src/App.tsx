import { Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth } from "@/features/auth/require-auth"
import { AssetDetailPage } from "@/pages/asset-detail-page"
import { AssetsPage } from "@/pages/assets-page"
import { DashboardPage } from "@/pages/dashboard-page"
import { ForbiddenPage } from "@/pages/forbidden-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { LoginPage } from "@/pages/login-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { SettingsPage } from "@/pages/settings-page"
import { TaskDetailPage } from "@/pages/task-detail-page"
import { TasksPage } from "@/pages/tasks-page"
import { TopicDetailPage } from "@/pages/topic-detail-page"
import { TopicsPage } from "@/pages/topics-page"
import { UpdatePasswordPage } from "@/pages/update-password-page"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/topics/:topicId" element={<TopicDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
