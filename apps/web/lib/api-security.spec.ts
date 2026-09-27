import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('server-side API requests', () => {
  it('never follows an API redirect to an external image host', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/products/example');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });
});
