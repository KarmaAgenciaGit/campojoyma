export const MAIL_PENDING_LIST_ITEM_CLASS =
  'border-amber-300 bg-amber-50/90 text-amber-950 hover:bg-amber-100/80 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-50 dark:hover:bg-amber-950/40';

export const MAIL_PENDING_SELECTED_LIST_ITEM_CLASS =
  'border-amber-300 bg-amber-50/90 text-amber-950 ring-1 ring-amber-300/40 dark:border-amber-500/45 dark:bg-amber-950/40 dark:text-amber-50 dark:ring-amber-500/20';

export const MAIL_PENDING_ATTACHMENT_CLASS =
  'border-amber-300 bg-amber-50/90 text-amber-950 dark:border-amber-500/45 dark:bg-amber-950/40 dark:text-amber-50';

export const MAIL_PENDING_BADGE_CLASS =
  'border-amber-300 bg-amber-100/85 text-amber-900 hover:bg-amber-100/85 dark:border-amber-400/50 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/10';

export const MAIL_PENDING_META_CLASS = 'text-amber-700 dark:text-amber-200/80';

export const MAIL_IGNORED_ATTACHMENT_CLASS =
  'border-slate-300 bg-slate-50/90 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export const MAIL_IGNORED_BADGE_CLASS =
  'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-800';

export const MAIL_IGNORED_META_CLASS = 'text-slate-600 dark:text-slate-400';

const MAIL_HTML_BASE_HEAD = `
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<style>
  :root {
    color-scheme: light only;
  }

  html,
  body {
    background: #ffffff !important;
  }

  body {
    margin: 0;
  }

  img,
  table {
    max-width: 100%;
  }

  img {
    height: auto;
  }

  pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
`.trim();

export const buildMailHtmlSrcDoc = (html: string | null | undefined) => {
  const normalizedHtml = html?.trim();
  if (!normalizedHtml) return '';

  if (/<head[\s>]/i.test(normalizedHtml)) {
    return normalizedHtml.replace(/<head([^>]*)>/i, `<head$1>${MAIL_HTML_BASE_HEAD}`);
  }

  if (/<html[\s>]/i.test(normalizedHtml)) {
    return normalizedHtml.replace(/<html([^>]*)>/i, `<html$1><head>${MAIL_HTML_BASE_HEAD}</head>`);
  }

  if (/<body[\s>]/i.test(normalizedHtml)) {
    return `<!doctype html><html><head>${MAIL_HTML_BASE_HEAD}</head>${normalizedHtml}</html>`;
  }

  return `<!doctype html><html><head>${MAIL_HTML_BASE_HEAD}</head><body>${normalizedHtml}</body></html>`;
};
