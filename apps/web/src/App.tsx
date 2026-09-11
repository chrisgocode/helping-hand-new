import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import './App.css'
import { AppShell } from './app/AppShell'
import { AuthPage } from './auth/AuthPage'
import { RequireGuest, RequireSession } from './auth/RequireSession'
import { RecipientDetailPage } from './recipients/RecipientDetailPage'
import { RecipientsPage } from './recipients/RecipientsPage'
import { TaskEditorPage } from './tasks/TaskEditorPage'
import { TaskLibraryPage } from './tasks/TaskLibraryPage'

const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [
      { path: '/sign-in', element: <AuthPage mode="sign-in" /> },
      { path: '/sign-up', element: <AuthPage mode="sign-up" /> },
    ],
  },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/tasks', element: <TaskLibraryPage /> },
          { path: '/tasks/new', element: <TaskEditorPage /> },
          { path: '/tasks/:rootId/edit', element: <TaskEditorPage saved /> },
          { path: '/recipients', element: <RecipientsPage /> },
          { path: '/recipients/:recipientId', element: <RecipientDetailPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/tasks" replace /> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
