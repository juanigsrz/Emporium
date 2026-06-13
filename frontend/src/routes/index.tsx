import { createBrowserRouter } from 'react-router-dom'
import App from '../App'
import HomePage from '../features/home/HomePage'
import EventsPage from '../features/events/EventsPage'
import EventDetailPage from '../features/events/EventDetailPage'
import LoginPage from '../features/login/LoginPage'
import RegisterPage from '../features/auth/RegisterPage'
import ProfilePage from '../features/profile/ProfilePage'
import PublicProfilePage from '../features/profile/PublicProfilePage'
import MyCopiesPage from '../features/copies/MyCopiesPage'
import RequireAuth from '../components/RequireAuth'
import WantListBuilderPage from '../features/trades/WantListBuilderPage'
import MyWantsPage from '../features/trades/MyWantsPage'
import MatchRunPage from '../features/matching/MatchRunPage'
import ManageEventPage from '../features/events/ManageEventPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:slug', element: <EventDetailPage /> },
      {
        path: 'events/:slug/wants',
        element: (
          <RequireAuth>
            <MyWantsPage />
          </RequireAuth>
        ),
      },
      {
        path: 'events/:slug/builder',
        element: (
          <RequireAuth>
            <WantListBuilderPage />
          </RequireAuth>
        ),
      },
      { path: 'events/:slug/matches', element: <MatchRunPage /> },
      {
        path: 'events/:slug/manage',
        element: (
          <RequireAuth>
            <ManageEventPage />
          </RequireAuth>
        ),
      },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        path: 'profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        path: 'my-copies',
        element: (
          <RequireAuth>
            <MyCopiesPage />
          </RequireAuth>
        ),
      },
      { path: 'u/:username', element: <PublicProfilePage /> },
    ],
  },
])
