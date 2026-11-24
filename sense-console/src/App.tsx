import { Navigate, Route, Routes } from "react-router"

import { AppShell } from "@/components/layout/app-shell"
import { RequireAuth } from "@/features/auth/require-auth"
import { AccountPage } from "@/pages/account-page"
import { AssetDetailPage } from "@/pages/asset-detail-page"
import { AssetsPage } from "@/pages/assets-page"
import { CanvasPage } from "@/pages/canvas-page"
import { CapturePage } from "@/pages/capture-page"
import { CharactersPage } from "@/pages/characters-page"
import { ChatAssistantPage } from "@/pages/chat-assistant-page"
import { ChatPage } from "@/modules/chat/chat-page"
import { CliAgentsPage } from "@/pages/cli-agents-page"
import { ContentOverviewPage } from "@/pages/content-overview-page"
import { KnowledgeBasePage } from "@/pages/knowledge-base-page"
import { ForbiddenPage } from "@/pages/forbidden-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { IntegrationsPage } from "@/pages/integrations-page"
import { IntakePage } from "@/pages/intake-page"
import { LoginPage } from "@/pages/login-page"
import { ModelsIntegrationPage } from "@/pages/models-integration-page"
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
import { UpdatePasswordPage } from "@/pages/update-password-page"
import { WorkItemDetailPage } from "@/pages/work-item-detail-page"
import { WorkItemsPage } from "@/pages/work-items-page"

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route path="/h5/chat" element={<ChatAssistantPage standaloneH5 />} />
      <Route path="/chat-next" element={<ChatPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/capture" element={<CapturePage />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<ContentOverviewPage />} />
          <Route path="/chat" element={<ChatAssistantPage />} />
          <Route path="/work-items" element={<WorkItemsPage />} />
          <Route path="/work-items/:workItemId" element={<WorkItemDetailPage />} />
          {/* V1 routes: topics and content projects became work items. */}
          <Route path="/content/projects" element={<Navigate to="/work-items" replace />} />
          <Route path="/content/projects/:projectId" element={<Navigate to="/work-items" replace />} />
          <Route path="/topics" element={<Navigate to="/work-items" replace />} />
          <Route path="/topics/:topicId" element={<Navigate to="/work-items" replace />} />
          <Route path="/content/reviews" element={<ContentOverviewPage mode="reviews" />} />
          <Route path="/production/flow" element={<ContentOverviewPage mode="pipeline" />} />
          <Route path="/analytics" element={<ContentOverviewPage mode="analytics" />} />
          <Route path="/intake" element={<IntakePage />} />
          <Route path="/intake/prompts" element={<PromptExamplesPage />} />
          <Route path="/sources/categories" element={<SourceCategoriesPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/video/scripts" element={<ScriptsPage />} />
          <Route path="/video/scripts/:storyId" element={<ScriptDetailPage />} />
          <Route path="/video/storyboards" element={<StoryboardsPage />} />
          <Route path="/video/characters" element={<CharactersPage />} />
          <Route path="/video/scenes" element={<ScenesPage />} />
          <Route path="/video/canvas" element={<CanvasPage />} />
          <Route path="/content/knowledge" element={<KnowledgeBasePage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/:assetId" element={<AssetDetailPage />} />
          <Route path="/system/accounts" element={<OrganizationAccountsPage />} />
          <Route path="/system/roles" element={<RolesPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/system/models" element={<ModelsIntegrationPage />} />
          <Route path="/system/cli-agents" element={<CliAgentsPage />} />
          <Route path="/system/integrations" element={<IntegrationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
