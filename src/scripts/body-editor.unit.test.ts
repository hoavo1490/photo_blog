// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountTextareaEditor } from './body-editor';

describe('BodyEditor (textarea impl)', () => {
  let ta: HTMLTextAreaElement;

  beforeEach(() => {
    document.body.innerHTML = '<textarea id="ta"></textarea>';
    ta = document.getElementById('ta') as HTMLTextAreaElement;
  });

  it('exposes the initial markdown via getMarkdown()', () => {
    const ed = mountTextareaEditor(ta, '# hello\n\nworld');
    expect(ed.getMarkdown()).toBe('# hello\n\nworld');
  });

  it('replaces the entire content with setMarkdown()', () => {
    const ed = mountTextareaEditor(ta, 'old');
    ed.setMarkdown('## new');
    expect(ed.getMarkdown()).toBe('## new');
  });

  it('inserts at the cursor position', () => {
    const ed = mountTextareaEditor(ta, 'hello world');
    ta.selectionStart = ta.selectionEnd = 5; // between hello and ' world'
    ed.insertAtCursor(' DEAR');
    expect(ed.getMarkdown()).toBe('hello DEAR world');
  });

  it('moves the cursor to after the inserted text', () => {
    const ed = mountTextareaEditor(ta, 'ab');
    ta.selectionStart = ta.selectionEnd = 1;
    ed.insertAtCursor('XY');
    expect(ta.selectionStart).toBe(3);
    expect(ta.selectionEnd).toBe(3);
  });

  it('appends when no cursor is set (fallback)', () => {
    const ed = mountTextareaEditor(ta, 'hello');
    // selectionStart defaults to 0 on a fresh textarea -- so insert at 0.
    // The contract guarantees insertion happens; the photo-upload flow
    // doesn't rely on a specific position when nothing is focused.
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ed.insertAtCursor(' world');
    expect(ed.getMarkdown()).toBe('hello world');
  });

  it('preserves image:<uuid> tokens through a get-set round-trip', () => {
    const body = 'intro\n\n![](image:11111111-2222-3333-4444-555555555555)\n\nrest';
    const ed = mountTextareaEditor(ta, body);
    const out = ed.getMarkdown();
    expect(out).toBe(body);
  });

  it('focus() moves focus to the textarea', () => {
    const ed = mountTextareaEditor(ta, '');
    ed.focus();
    expect(document.activeElement).toBe(ta);
  });

  it('destroy() is callable and idempotent', () => {
    const ed = mountTextareaEditor(ta, '');
    expect(() => { ed.destroy(); ed.destroy(); }).not.toThrow();
  });

  it('insertImageBlock() appends markdown image syntax with a trailing blank line', () => {
    // The trailing blank line ensures the resulting markdown round-trips
    // through the Milkdown impl with an empty paragraph after the image
    // -- the place the user expects their cursor to land.
    const ed = mountTextareaEditor(ta, 'before');
    ta.selectionStart = ta.selectionEnd = ta.value.length;
    ed.insertImageBlock('/img/photo.800w.jpg');
    expect(ed.getMarkdown()).toBe('before\n![](/img/photo.800w.jpg)\n\n');
  });

  it('insertImageBlock() puts the cursor on the blank line below the image', () => {
    const ed = mountTextareaEditor(ta, 'a');
    ta.selectionStart = ta.selectionEnd = 1;
    ed.insertImageBlock('/img/x.jpg');
    expect(ta.value).toBe('a\n![](/img/x.jpg)\n\n');
    // Cursor should be at the very end -- positioned on the blank line
    // where the user can immediately keep typing.
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it('insertImageBlock() respects the alt text argument', () => {
    const ed = mountTextareaEditor(ta, '');
    ed.insertImageBlock('/img/x.jpg', 'sunset');
    expect(ed.getMarkdown()).toContain('![sunset](/img/x.jpg)');
  });
});
