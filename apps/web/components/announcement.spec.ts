import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnnouncementDto } from '@webcatt/shared';
import { AnnouncementCard } from './announcement-card';

const activeAnnouncement: AnnouncementDto = {
  active: true,
  title: 'Thong bao',
  body: '<p>Noi dung</p>',
};

describe('AnnouncementCard', () => {
  it('keeps the announcement inside the storefront container', () => {
    const html = renderToStaticMarkup(createElement(AnnouncementCard, {
      announcement: activeAnnouncement,
      label: 'Thong bao cua hang',
    }));

    expect(html).toContain('width:calc(100% - 2rem)');
    expect(html).toContain('max-width:var(--store-container)');
    expect(html).toContain('[overflow-wrap:anywhere]');
  });

  it('does not render an inactive announcement', () => {
    expect(renderToStaticMarkup(createElement(AnnouncementCard, {
      announcement: { ...activeAnnouncement, active: false },
      label: 'Thong bao cua hang',
    }))).toBe('');
  });

  it('does not leave an empty frame for markup without text', () => {
    expect(renderToStaticMarkup(createElement(AnnouncementCard, {
      announcement: { active: true, title: ' ', body: '<p><br></p>' },
      label: 'Thong bao cua hang',
    }))).toBe('');
  });
});
