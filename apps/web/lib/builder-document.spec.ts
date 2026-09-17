import { describe, expect, it } from 'vitest';
import { createDefaultStorefrontDocument, parseStorefrontDocument, type StorefrontBlock } from '@webcatt/shared';
import { builderTextFields, setBuilderLocalized } from './builder-document';

describe('builder heading inspector contract', () => {
  it('edits text in the chosen language and round-trips through the strict document parser', () => {
    const document = createDefaultStorefrontDocument();
    const heading: StorefrontBlock = { id: 'edited-heading', type: 'heading', props: { level: 2, text: { vi: 'Gốc', en: 'Original', zh: '原文' } } };
    document.pages.home.blocks.unshift(heading);
    expect(builderTextFields(heading.type)).toEqual(['text']);
    setBuilderLocalized(heading, builderTextFields(heading.type)[0], 'en', 'Edited heading');
    const persisted = parseStorefrontDocument(JSON.parse(JSON.stringify(document)));
    expect(persisted.pages.home.blocks[0].props).toEqual({ level: 2, text: { vi: 'Gốc', en: 'Edited heading', zh: '原文' } });
  });

  it('does not offer title/body fields on business blocks or headings', () => {
    expect(builderTextFields('productDetail')).toEqual([]);
    expect(builderTextFields('banner')).toEqual(['title', 'body']);
    expect(builderTextFields('richText')).toEqual(['html']);
    expect(builderTextFields('image')).toEqual(['alt']);
  });
});
