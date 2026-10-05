import { Link } from 'react-router';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Any address the app does not have. If the student is not signed in, the link takes them to the login. */
export function NotFoundPage() {
  useDocumentTitle('Página no encontrada');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">No encontramos esa página</h1>
      <p>La dirección no existe o ya no está disponible.</p>
      <div>
        <Link
          to="/dashboard"
          className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
