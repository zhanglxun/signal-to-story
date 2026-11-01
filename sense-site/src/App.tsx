import { Route, Routes } from "react-router"

import { AppShell } from "@/components/site/app-shell"
import { RequireAuth } from "@/features/auth/require-auth"
import { ContentPage } from "@/pages/content-page"
import { ExplorePage } from "@/pages/explore-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { HomePage } from "@/pages/home-page"
import { LoginPage } from "@/pages/login-page"
import { MePage } from "@/pages/me-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { RegisterPage } from "@/pages/register-page"
import { ResourcesPage } from "@/pages/resources-page"
import { TopicPage } from "@/pages/topic-page"
import { TopicsPage } from "@/pages/topics-page"

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="content/:slug" element={<ContentPage />} />
        <Route path="topics" element={<TopicsPage />} />
        <Route path="topics/:slug" element={<TopicPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route
          path="me"
          element={
            <RequireAuth>
              <MePage />
            </RequireAuth>
          }
        />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
