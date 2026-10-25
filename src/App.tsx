import { lazy, Suspense } from 'react'
import { missingEnv } from './config'
import { Alert, Layout } from './components/Layout'
import { PublicForm } from './pages/PublicForm'

// Admin (termasuk SheetJS) dimuat terpisah agar form publik tetap ringan.
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))

// Routing minimal: "<base>/admin" → halaman admin, selain itu → form publik.
// GitHub Pages melayani 404.html (salinan index.html) untuk path /admin.
const isAdminPath = () => window.location.pathname.replace(/\/+$/, '').endsWith('/admin')

export default function App() {
  if (missingEnv.length > 0) {
    return (
      <Layout title="Logbook Limbah B3">
        <Alert>Konfigurasi belum lengkap: {missingEnv.join(', ')}. Lihat README.</Alert>
      </Layout>
    )
  }
  if (!isAdminPath()) return <PublicForm />
  return (
    <Suspense fallback={<Layout title="Admin Logbook Limbah B3">Memuat…</Layout>}>
      <AdminPage />
    </Suspense>
  )
}
