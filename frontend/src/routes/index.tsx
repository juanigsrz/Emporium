import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import App from '../App'
import RequireAuth from '../components/RequireAuth'
import { NotFoundPage, RouteErrorBoundary } from '../features/errors/ErrorPage'

// Route-level code splitting: each page ships in its own chunk so a first-time
// visitor to the homepage doesn't download the heavy builder/wants/matching
// screens. Suspense fallback lives in App around <Outlet />.
const HomePage = lazy(() => import('../features/home/HomePage'))
const EventsPage = lazy(() => import('../features/events/EventsPage'))
const EventDetailPage = lazy(() => import('../features/events/EventDetailPage'))
const LoginPage = lazy(() => import('../features/login/LoginPage'))
const RegisterPage = lazy(() => import('../features/auth/RegisterPage'))
const ProfilePage = lazy(() => import('../features/profile/ProfilePage'))
const PublicProfilePage = lazy(() => import('../features/profile/PublicProfilePage'))
const MyCopiesPage = lazy(() => import('../features/copies/MyCopiesPage'))
const WantListBuilderPage = lazy(() => import('../features/trades/WantListBuilderPage'))
const MyWantsPage = lazy(() => import('../features/trades/MyWantsPage'))
const MatchRunPage = lazy(() => import('../features/matching/MatchRunPage'))
const ManageEventPage = lazy(() => import('../features/events/ManageEventPage'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <RouteErrorBoundary />,
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
