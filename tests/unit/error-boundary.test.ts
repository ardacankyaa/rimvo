import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { setLanguage } from '../../src/i18n';

afterEach(() => { setLanguage('en'); vi.restoreAllMocks(); });

function failedBoundary(cause: unknown, onError?: () => void) {
  const boundary = new ErrorBoundary({ children: createElement('p', null, 'console'), onError });
  boundary.state = ErrorBoundary.getDerivedStateFromError(cause);
  return boundary;
}

describe('interface error screen', () => {
  it('renders its children while nothing has failed', () => {
    const boundary = new ErrorBoundary({ children: createElement('p', null, 'console') });
    expect(renderToStaticMarkup(boundary.render() as never)).toBe('<p>console</p>');
  });

  it('replaces a crashed console with a reload screen and the error detail', () => {
    const markup = renderToStaticMarkup(failedBoundary(new Error('boom <b>')).render() as never);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Something went wrong');
    expect(markup).toContain('Reload app');
    expect(markup).toContain('boom &lt;b&gt;');
    expect(markup).not.toContain('console');
  });

  it('accepts non-Error throws and is translated', () => {
    setLanguage('tr');
    const markup = renderToStaticMarkup(failedBoundary('plain failure').render() as never);
    expect(markup).toContain('Bir sorun oluştu');
    expect(markup).toContain('plain failure');
  });

  it('silences audio when it catches an error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    failedBoundary(new Error('boom'), onError).componentDidCatch(new Error('boom'), { componentStack: '' });
    expect(onError).toHaveBeenCalledOnce();
  });
});
