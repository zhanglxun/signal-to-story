import { Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth } from "@/features/auth/require-auth"
import { AccountPage } from "@/pages/account-page"
import { AssetDetailPage } from "@/pages/asset-detail-page"
import { AssetsPage } from "@/pages/assets-page"
import { CanvasPage } from "@/pages/canvas-page"
import { CharactersPage } from "@/pages/characters-page"
import { ContentOverviewPage } from "@/pages/content-overview-page"
import { ContentProjectsPage } from "@/pages/content-projects-page"
import { ContentProjectDetailPage } from "@/pages/content-project-detail-page"
import { PublishingPage } from "@/pages/publishing-page"
import { ForbiddenPage } from "@/pages/forbidden-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { IntakePage } from "@/pages/intake-page"
import { LoginPage } from "@/pages/login-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { PromptExamplesPage } from "@/pages/prompt-examples-page"
import { OrganizationAccountsPage } from "@/pages/organization-accounts-page"
import { RolesPage } from "@/pages/roles-page"
import { ScenesPage } from "@/pages/scenes-page"
import { ScriptDetailPage } from "@/pages/script-detail-page"
import { ScriptsPage } from "@/pages/scripts-page"
import { SettingsPage } from "@/pages/settings-page"
import { SourceCategoriesPage } from "@/pages/source-categories-page"
import { StoryboardsPage } from "@/pages/storyboards-page"
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
          <Route path="/dashboard" element={<ContentOverviewPage />} />
          <Route path="/content/projects" element={<ContentProjectsPage />} />
          <Route path="/content/projects/:projectId" element={<ContentProjectDetailPage />} />
          <Route path="/content/reviews" element={<ContentOverviewPage mode="reviews" />} />
          <Route path="/production/flow" element={<ContentOverviewPage mode="pipeline" />} />
          <Route path="/publishing/channels" element={<PublishingPage mode="channels" />} />
          <Route path="/publishing/plans" element={<PublishingPage />} />
          <Route path="/analytics" element={<ContentOverviewPage mode="analytics" />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/intake/prompts" element={<PromptExamplesPage />} />
          <Route path="/sources/categories" element={<SourceCategoriesPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/topics/:topicId" element={<TopicDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/video/scripts" element={<ScriptsPage />} />
          <Route path="/video/scripts/:storyId" element={<ScriptDetailPage />} />
          <Route path="/video/storyboards" element={<StoryboardsPage />} />
          <Route path="/video/characters" element={<CharactersPage />} />
          <Route path="/video/scenes" element={<ScenesPage />} />
          <Route path="/video/canvas" element={<CanvasPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
          <Route path="/system/accounts" element={<OrganizationAccountsPage />} />
          <Route path="/system/roles" element={<RolesPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
