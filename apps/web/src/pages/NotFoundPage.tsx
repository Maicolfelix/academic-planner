import { Link } from 'react-router';
import { CompanionSprite } from '../companion/PixelCompanion';
import { buttonStyles } from '../components/ui/buttonStyles';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Any address the app does not have. If the student is not signed in, the link takes them to the login. */
export function NotFoundPage() {
  useDocumentTitle('Página no encontrada');
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-start justify-center gap-4 p-6">
      {/* It looks around, a little lost, and keeps you company (decoration: the heading says it all). */}
      <CompanionSprite state="CALM" pose="worried" className="size-28" />
      <h1 className="text-display">No encontramos esa página</h1>
      <p>La dirección no existe o ya no está disponible.</p>
      <div>
        <Link to="/dashboard" className={buttonStyles({ variant: 'primary' })}>
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
