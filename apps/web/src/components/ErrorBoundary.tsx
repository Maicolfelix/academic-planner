import { CompanionSprite } from '../companion/PixelCompanion';
import { buttonStyles } from './ui/buttonStyles';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence for a bug in rendering: instead of a blank page, a calm message and a way out.
 * It logs the error (nothing is swallowed) and never shows technical details to the student.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        {/* A worried companion keeps you company (decoration: the heading says it all). */}
        <CompanionSprite state="CALM" pose="worried" className="size-24" />
        <h1 className="text-display">Algo salió mal</h1>
        <p>
          Ocurrió un error inesperado. Tus datos guardados están a salvo. Recarga la página para
          continuar.
        </p>
        <div>
          <button
            type="button"
            onClick={() => window.location.assign('/dashboard')}
            className={buttonStyles({ variant: 'primary' })}
          >
            Volver al inicio
          </button>
        </div>
      </main>
    );
  }
}
