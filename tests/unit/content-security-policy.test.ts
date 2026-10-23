import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, contentSecurityPolicyMeta } from '../../vite.config';

type Handler = (html: string) => string;
const transform = (html: string) => {
  const hook = contentSecurityPolicyMeta().transformIndexHtml as { order: string; handler: Handler };
  expect(hook.order).toBe('post');
  return hook.handler(html);
};

describe('production Content-Security-Policy', () => {
  it('is added to built pages only, so the dev server keeps hot reloading', () => {
    expect(contentSecurityPolicyMeta().apply).toBe('build');
  });

  it('allows only same-origin code and local blob media', () => {
    const directives = Object.fromEntries(contentSecurityPolicy.split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }));
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['worker-src']).toEqual(["'self'"]);
    expect(directives['connect-src']).toEqual(["'self'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['img-src']).toEqual(["'self'", 'blob:']);
    expect(directives['media-src']).toEqual(["'self'", 'blob:']);
    expect(contentSecurityPolicy).not.toMatch(/unsafe-eval|unsafe-inline|https?:|\*/);
  });

  it('places the policy directly after the charset of index.html', () => {
    const html = transform(readFileSync(new URL('../../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`;
    expect(html).toContain('<meta charset="UTF-8" />\n    ' + meta);
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<script'));
    expect(() => transform('<html><head></head></html>')).toThrow('Content-Security-Policy');
  });
});
