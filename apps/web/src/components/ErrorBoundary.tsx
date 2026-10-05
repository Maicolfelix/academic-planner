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
        <h1 className="text-2xl font-semibold">Algo salió mal</h1>
        <p>
          Ocurrió un error inesperado. Tus datos guardados están a salvo. Recarga la página para
          continuar.
        </p>
        <div>
          <button
            type="button"
            onClick={() => window.location.assign('/dashboard')}
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Volver al inicio
          </button>
        </div>
      </main>
    );
  }
}
