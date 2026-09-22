import fs from 'fs';
import path from 'path';
import type { AuditReport } from '../types.ts';

/**
 * Writes full machine-readable audit report to JSON.
 */
export function writeJsonReport(report: AuditReport, targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify(report, null, 2);
  fs.writeFileSync(targetPath, content, 'utf-8');
}
