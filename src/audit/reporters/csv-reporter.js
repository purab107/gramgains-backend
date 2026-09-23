const fs = require('fs');
const path = require('path');

/**
 * Escapes a value for CSV format.
 * @param {any} val - The value to escape
 * @returns {string} The escaped CSV value
 */
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Writes tabular issues report to CSV for filtering and analysis.
 * @param {import('../types').AuditIssue[]} issues - Array of audit issues to write
 * @param {string} targetPath - The target file path for the CSV report
 */
function writeCsvReport(issues, targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const headers = [
    'IssueCode',
    'Severity',
    'IssueCategory',
    'FoodId',
    'FoodName',
    'Source',
    'Layer',
    'Category',
    'Brand',
    'Barcode',
    'Field',
    'StoredValue',
    'ExpectedValue',
    'Discrepancy',
    'Explanation',
  ];

  const lines = [headers.join(',')];

  for (const iss of issues) {
    const row = [
      escapeCsv(iss.issueCode),
      escapeCsv(iss.severity),
      escapeCsv(iss.issueCategory),
      escapeCsv(iss.foodId),
      escapeCsv(iss.foodName),
      escapeCsv(iss.source),
      escapeCsv(iss.layer),
      escapeCsv(iss.category),
      escapeCsv(iss.brand || ''),
      escapeCsv(iss.barcode || ''),
      escapeCsv(iss.field || ''),
      escapeCsv(iss.storedValue ?? ''),
      escapeCsv(iss.expectedValue ?? ''),
      escapeCsv(iss.discrepancy ?? ''),
      escapeCsv(iss.explanation),
    ];
    lines.push(row.join(','));
  }

  fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
}

module.exports = { writeCsvReport };