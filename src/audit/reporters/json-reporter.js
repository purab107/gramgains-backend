const fs = require('fs');
const path = require('path');

/**
 * Writes full machine-readable audit report to JSON.
 * @param {import('../types').AuditReport} report - The audit report to write
 * @param {string} targetPath - The target file path for the JSON report
 */
function writeJsonReport(report, targetPath) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(report, null, 2);
  fs.writeFileSync(targetPath, content, 'utf-8');
}

module.exports = { writeJsonReport };