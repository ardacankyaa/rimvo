import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

type State = { readonly error: Error | null };

/** Replaces a blank page with a recovery screen when rendering fails unexpectedly. */
export class ErrorBoundary extends Component<{ readonly children: ReactNode; readonly onError?: () => void }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(cause: unknown): State {
    return { error: cause instanceof Error ? cause : new Error(String(cause)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.();
    console.error('RIMVO stopped after an interface error.', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <main className="app-crash" role="alert" aria-labelledby="app-crash-title">
      <h1 id="app-crash-title">{t('Something went wrong')}</h1>
      <p>{t('RIMVO hit an unexpected problem and stopped the audio. Reload to continue. A session you saved is still on this device; changes after that save are lost.')}</p>
      <button type="button" onClick={() => window.location.reload()}>{t('Reload app')}</button>
      <details><summary>{t('Technical details')}</summary><pre>{error.message}</pre></details>
    </main>;
  }
}
