'use strict';

// Convert rich-text HTML (from the editor) into clean plain text.
// Used for list/preview responses so clients don't receive raw "<p>...&nbsp;...</p>".
const stripHtml = (html) => {
  if (!html || typeof html !== 'string') return html;
  return html
    .replace(/<[^>]*>/g, ' ')     // remove tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim();
};

module.exports = { stripHtml };
