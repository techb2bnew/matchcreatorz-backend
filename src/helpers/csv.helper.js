'use strict';

// Minimal, dependency-free CSV serializer for report exports.
// Escapes quotes/commas/newlines, and neutralises formula-injection risk
// (Excel/Sheets execute a leading =, +, -, @ as a formula) by prefixing
// such values with a single quote before quoting them.
const escapeCell = (value) => {
  let str = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  if (/[",\n]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
};

/**
 * @param {{key:string, label:string}[]} columns
 * @param {object[]} rows
 * @returns {string} CSV text (header row + data rows)
 */
const toCsv = (columns, rows) => {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCell(row[c.key])).join(','))
    .join('\n');
  return body ? `${header}\n${body}` : header;
};

module.exports = { toCsv };
