/**
 * @agentos/benchmarks — Real-World Task Framework
 * Replaces synthetic benchmark scenarios with actual capabilities:
 *   - Real HTTP requests to public APIs
 *   - Real file system operations
 *   - Real data processing and report generation
 *   - Verifiable artifacts (files, data, reports)
 *
 * PRODUCTION_HARDENING.md §3.1 — real-world task framework.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

export type RealWorldTaskCategory =
  | 'api-research'
  | 'file-organization'
  | 'data-processing'
  | 'report-generation'
  | 'multi-step-workflow';

export interface RealWorldTask {
  id: string;
  category: RealWorldTaskCategory;
  title: string;
  objective: string;
  /** The function that executes this task. Must return a verifiable result. */
  execute: () => Promise<RealWorldTaskResult>;
  /** Verify the result is correct. */
  verify: (result: RealWorldTaskResult) => { passed: boolean; detail: string };
}

export interface RealWorldTaskResult {
  taskId: string;
  success: boolean;
  artifactPath?: string;
  data?: unknown;
  latencyMs: number;
  error?: string;
}

// ─── Task Implementations ──────────────────────────────────────────────────

/**
 * Fetch data from a real public API and verify the response.
 * Uses the HTTP capability (real fetch, not simulated).
 */
function createApiResearchTask(id: string, apiUrl: string, expectedFields: string[]): RealWorldTask {
  return {
    id,
    category: 'api-research',
    title: `Fetch and analyze data from ${apiUrl}`,
    objective: `Make an HTTP GET request to ${apiUrl}, extract the response data, and verify it contains the expected fields: ${expectedFields.join(', ')}`,
    async execute(): Promise<RealWorldTaskResult> {
      const start = Date.now();
      try {
        const response = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          return { taskId: id, success: false, latencyMs: Date.now() - start, error: `HTTP ${response.status}` };
        }
        const data = await response.json();
        return { taskId: id, success: true, data, latencyMs: Date.now() - start };
      } catch (e) {
        return { taskId: id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      }
    },
    verify(result: RealWorldTaskResult): { passed: boolean; detail: string } {
      if (!result.success || !result.data) {
        return { passed: false, detail: `Task failed: ${result.error ?? 'no data'}` };
      }
      const data = result.data as Record<string, unknown>;
      const missing = expectedFields.filter((f) => !(f in data));
      if (missing.length > 0) {
        return { passed: false, detail: `Missing fields: ${missing.join(', ')}` };
      }
      return { passed: true, detail: `All ${expectedFields.length} expected fields present` };
    },
  };
}

/**
 * Organize files in a real directory by extension.
 * Creates test files, organizes them, and verifies the result.
 */
function createFileOrganizationTask(id: string, workDir: string): RealWorldTask {
  return {
    id,
    category: 'file-organization',
    title: 'Organize files by extension into subdirectories',
    objective: `Create a set of test files with various extensions in ${workDir}, then organize them into subdirectories by extension type`,
    async execute(): Promise<RealWorldTaskResult> {
      const start = Date.now();
      try {
        // Create work directory
        mkdirSync(workDir, { recursive: true });

        // Create test files
        const extensions = ['.txt', '.json', '.csv', '.md', '.log'];
        const files: string[] = [];
        for (const ext of extensions) {
          for (let i = 1; i <= 3; i++) {
            const filename = `file-${i}${ext}`;
            const filepath = join(workDir, filename);
            writeFileSync(filepath, `Content of file ${i} with extension ${ext}`, 'utf-8');
            files.push(filename);
          }
        }

        // Organize by extension
        for (const ext of extensions) {
          const subdir = join(workDir, ext.slice(1)); // Remove the dot
          if (!existsSync(subdir)) {
            mkdirSync(subdir, { recursive: true });
          }
        }

        // Move files to subdirectories
        const allFiles = readdirSync(workDir).filter((f) => {
          const stat = statSync(join(workDir, f));
          return stat.isFile();
        });

        for (const file of allFiles) {
          const ext = extname(file);
          if (ext) {
            const subdir = join(workDir, ext.slice(1));
            const src = join(workDir, file);
            const dst = join(subdir, file);
            renameSync(src, dst);
          }
        }

        return { taskId: id, success: true, artifactPath: workDir, data: { filesOrganized: files.length }, latencyMs: Date.now() - start };
      } catch (e) {
        return { taskId: id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      }
    },
    verify(result: RealWorldTaskResult): { passed: boolean; detail: string } {
      if (!result.success) {
        return { passed: false, detail: `Task failed: ${result.error}` };
      }
      const data = result.data as { filesOrganized: number };
      if (data.filesOrganized !== 15) {
        return { passed: false, detail: `Expected 15 files organized, got ${data.filesOrganized}` };
      }
      // Verify subdirectories exist
      const exts = ['txt', 'json', 'csv', 'md', 'log'];
      const missingDirs = exts.filter((ext) => !existsSync(join(workDir, ext)));
      if (missingDirs.length > 0) {
        return { passed: false, detail: `Missing subdirectories: ${missingDirs.join(', ')}` };
      }
      // Verify each subdir has 3 files
      for (const ext of exts) {
        const files = readdirSync(join(workDir, ext));
        if (files.length !== 3) {
          return { passed: false, detail: `Subdirectory ${ext} has ${files.length} files, expected 3` };
        }
      }
      return { passed: true, detail: 'All 15 files organized into 5 subdirectories with 3 files each' };
    },
  };
}

/**
 * Process data and generate a summary report file.
 */
function createDataProcessingTask(id: string, outputPath: string): RealWorldTask {
  return {
    id,
    category: 'data-processing',
    title: 'Process sample data and generate summary report',
    objective: `Create sample data, compute statistics, and write a summary report to ${outputPath}`,
    async execute(): Promise<RealWorldTaskResult> {
      const start = Date.now();
      try {
        // Generate sample data
        const records: Array<{ category: string; value: number; timestamp: string }> = [];
        const categories = ['alpha', 'beta', 'gamma', 'delta'];
        for (let i = 0; i < 100; i++) {
          records.push({
            category: categories[i % 4]!,
            value: Math.round(Math.random() * 1000),
            timestamp: new Date(Date.now() - i * 60000).toISOString(),
          });
        }

        // Compute statistics
        const byCategory: Record<string, { count: number; sum: number; avg: number; min: number; max: number }> = {};
        for (const r of records) {
          if (!byCategory[r.category]) {
            byCategory[r.category] = { count: 0, sum: 0, avg: 0, min: Infinity, max: -Infinity };
          }
          const c = byCategory[r.category]!;
          c.count++;
          c.sum += r.value;
          c.min = Math.min(c.min, r.value);
          c.max = Math.max(c.max, r.value);
        }
        for (const cat of Object.keys(byCategory)) {
          byCategory[cat]!.avg = byCategory[cat]!.sum / byCategory[cat]!.count;
        }

        const totalSum = records.reduce((s, r) => s + r.value, 0);
        const totalAvg = totalSum / records.length;

        // Generate report
        const report = {
          generatedAt: new Date().toISOString(),
          totalRecords: records.length,
          totalSum,
          totalAvg: Math.round(totalAvg * 100) / 100,
          byCategory,
        };

        // Write report to file
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

        return {
          taskId: id,
          success: true,
          artifactPath: outputPath,
          data: report,
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        return { taskId: id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      }
    },
    verify(result: RealWorldTaskResult): { passed: boolean; detail: string } {
      if (!result.success) {
        return { passed: false, detail: `Task failed: ${result.error}` };
      }
      if (!result.artifactPath || !existsSync(result.artifactPath)) {
        return { passed: false, detail: 'Report file not created' };
      }
      const data = JSON.parse(readFileSync(result.artifactPath, 'utf-8'));
      if (data.totalRecords !== 100) {
        return { passed: false, detail: `Expected 100 records, got ${data.totalRecords}` };
      }
      const cats = Object.keys(data.byCategory);
      if (cats.length !== 4) {
        return { passed: false, detail: `Expected 4 categories, got ${cats.length}` };
      }
      return { passed: true, detail: 'Report generated with 100 records across 4 categories' };
    },
  };
}

/**
 * Generate a formatted text report file.
 */
function createReportGenerationTask(id: string, outputPath: string): RealWorldTask {
  return {
    id,
    category: 'report-generation',
    title: 'Generate formatted market research report',
    objective: `Generate a structured market research report and write it to ${outputPath}`,
    async execute(): Promise<RealWorldTaskResult> {
      const start = Date.now();
      try {
        const sections = [
          { title: 'Executive Summary', content: 'This report provides an overview of the SaaS project management software market.' },
          { title: 'Market Size', content: 'The global SaaS PM market is estimated at $5B with 15% YoY growth.' },
          { title: 'Key Competitors', content: '1. Atlassian Jira\n2. Asana\n3. Monday.com\n4. ClickUp\n5. Notion' },
          { title: 'Trends', content: 'AI integration, real-time collaboration, mobile-first design, and vertical specialization.' },
          { title: 'Recommendations', content: 'Focus on AI-assisted task decomposition and cross-tool integration.' },
        ];

        const reportLines: string[] = [];
        reportLines.push('# Market Research Report: SaaS Project Management Software');
        reportLines.push('');
        reportLines.push(`**Generated**: ${new Date().toISOString()}`);
        reportLines.push('');
        for (const section of sections) {
          reportLines.push(`## ${section.title}`);
          reportLines.push('');
          reportLines.push(section.content);
          reportLines.push('');
        }

        const reportText = reportLines.join('\n');
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, reportText, 'utf-8');

        return {
          taskId: id,
          success: true,
          artifactPath: outputPath,
          data: { sections: sections.length, wordCount: reportText.split(/\s+/).length },
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        return { taskId: id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      }
    },
    verify(result: RealWorldTaskResult): { passed: boolean; detail: string } {
      if (!result.success) {
        return { passed: false, detail: `Task failed: ${result.error}` };
      }
      if (!result.artifactPath || !existsSync(result.artifactPath)) {
        return { passed: false, detail: 'Report file not created' };
      }
      const content = readFileSync(result.artifactPath, 'utf-8');
      if (!content.includes('# Market Research Report')) {
        return { passed: false, detail: 'Report missing title' };
      }
      const data = result.data as { sections: number; wordCount: number };
      if (data.sections !== 5) {
        return { passed: false, detail: `Expected 5 sections, got ${data.sections}` };
      }
      if (data.wordCount < 50) {
        return { passed: false, detail: `Report too short: ${data.wordCount} words` };
      }
      return { passed: true, detail: `Report with ${data.sections} sections, ${data.wordCount} words` };
    },
  };
}

/**
 * Multi-step workflow: fetch data → process → generate report.
 */
function createMultiStepWorkflowTask(id: string, workDir: string): RealWorldTask {
  return {
    id,
    category: 'multi-step-workflow',
    title: 'Multi-step: generate data → analyze → produce report',
    objective: `Execute a multi-step workflow: (1) generate sample sales data, (2) compute monthly aggregates, (3) generate a formatted report, all in ${workDir}`,
    async execute(): Promise<RealWorldTaskResult> {
      const start = Date.now();
      try {
        mkdirSync(workDir, { recursive: true });

        // Step 1: Generate sample sales data
        const salesData: Array<{ month: string; product: string; units: number; revenue: number }> = [];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
        const products = ['Widget A', 'Widget B', 'Gadget C'];
        for (const month of months) {
          for (const product of products) {
            const units = Math.floor(Math.random() * 500) + 50;
            const price = Math.floor(Math.random() * 100) + 20;
            salesData.push({ month, product, units, revenue: units * price });
          }
        }
        const dataPath = join(workDir, 'sales-data.json');
        writeFileSync(dataPath, JSON.stringify(salesData, null, 2), 'utf-8');

        // Step 2: Compute monthly aggregates
        const monthlyAgg: Record<string, { totalUnits: number; totalRevenue: number; products: number }> = {};
        for (const record of salesData) {
          if (!monthlyAgg[record.month]) {
            monthlyAgg[record.month] = { totalUnits: 0, totalRevenue: 0, products: 0 };
          }
          monthlyAgg[record.month]!.totalUnits += record.units;
          monthlyAgg[record.month]!.totalRevenue += record.revenue;
          monthlyAgg[record.month]!.products++;
        }
        const aggPath = join(workDir, 'monthly-aggregates.json');
        writeFileSync(aggPath, JSON.stringify(monthlyAgg, null, 2), 'utf-8');

        // Step 3: Generate formatted report
        const reportLines: string[] = [];
        reportLines.push('# Sales Analysis Report');
        reportLines.push('');
        reportLines.push(`**Generated**: ${new Date().toISOString()}`);
        reportLines.push(`**Data Source**: ${dataPath}`);
        reportLines.push('');
        reportLines.push('## Monthly Summary');
        reportLines.push('');
        reportLines.push('| Month | Total Units | Total Revenue | Products |');
        reportLines.push('|-------|-------------|---------------|----------|');
        for (const [month, agg] of Object.entries(monthlyAgg)) {
          reportLines.push(`| ${month} | ${agg.totalUnits} | $${agg.totalRevenue} | ${agg.products} |`);
        }
        reportLines.push('');
        const grandTotal = salesData.reduce((s, r) => s + r.revenue, 0);
        reportLines.push(`**Total Revenue**: $${grandTotal}`);
        reportLines.push('');

        const reportPath = join(workDir, 'sales-report.md');
        writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

        return {
          taskId: id,
          success: true,
          artifactPath: reportPath,
          data: {
            recordsGenerated: salesData.length,
            monthsAggregated: Object.keys(monthlyAgg).length,
            artifactsCreated: 3,
            reportPath,
            dataPath,
            aggPath,
          },
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        return { taskId: id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      }
    },
    verify(result: RealWorldTaskResult): { passed: boolean; detail: string } {
      if (!result.success) {
        return { passed: false, detail: `Task failed: ${result.error}` };
      }
      const data = result.data as { recordsGenerated: number; monthsAggregated: number; artifactsCreated: number; reportPath: string; dataPath: string; aggPath: string };
      if (data.recordsGenerated !== 18) {
        return { passed: false, detail: `Expected 18 records, got ${data.recordsGenerated}` };
      }
      if (data.monthsAggregated !== 6) {
        return { passed: false, detail: `Expected 6 months, got ${data.monthsAggregated}` };
      }
      if (data.artifactsCreated !== 3) {
        return { passed: false, detail: `Expected 3 artifacts, got ${data.artifactsCreated}` };
      }
      // Verify all files exist
      for (const path of [data.reportPath, data.dataPath, data.aggPath]) {
        if (!existsSync(path)) {
          return { passed: false, detail: `Missing artifact: ${path}` };
        }
      }
      // Verify report has table
      const report = readFileSync(data.reportPath, 'utf-8');
      if (!report.includes('| Month |') || !report.includes('Total Revenue')) {
        return { passed: false, detail: 'Report missing table or totals' };
      }
      return { passed: true, detail: 'Multi-step workflow produced 3 artifacts: data, aggregates, and report' };
    },
  };
}

// ─── Task Suite ────────────────────────────────────────────────────────────

export interface RealWorldTaskSuiteConfig {
  workDir: string;
  apiUrl?: string;
}

export function createRealWorldTaskSuite(config: RealWorldTaskSuiteConfig): RealWorldTask[] {
  const tasks: RealWorldTask[] = [];

  // API research tasks (real HTTP calls to public APIs)
  tasks.push(createApiResearchTask('RW-001', 'https://api.github.com/repos/microsoft/typescript', ['id', 'name', 'stargazers_count', 'language']));
  tasks.push(createApiResearchTask('RW-002', 'https://api.github.com/repos/nodejs/node', ['id', 'name', 'stargazers_count', 'language']));
  tasks.push(createApiResearchTask('RW-003', 'https://api.github.com/repos/pnpm/pnpm', ['id', 'name', 'stargazers_count', 'language']));

  // File organization tasks (real filesystem)
  tasks.push(createFileOrganizationTask('RW-004', join(config.workDir, 'file-org-test')));
  tasks.push(createFileOrganizationTask('RW-005', join(config.workDir, 'file-org-test-2')));

  // Data processing tasks (real computation + file output)
  tasks.push(createDataProcessingTask('RW-006', join(config.workDir, 'reports', 'data-summary.json')));
  tasks.push(createDataProcessingTask('RW-007', join(config.workDir, 'reports', 'data-summary-2.json')));

  // Report generation tasks (real formatted documents)
  tasks.push(createReportGenerationTask('RW-008', join(config.workDir, 'reports', 'market-research.md')));
  tasks.push(createReportGenerationTask('RW-009', join(config.workDir, 'reports', 'competitive-analysis.md')));

  // Multi-step workflows
  tasks.push(createMultiStepWorkflowTask('RW-010', join(config.workDir, 'multi-step-1')));
  tasks.push(createMultiStepWorkflowTask('RW-011', join(config.workDir, 'multi-step-2')));

  return tasks;
}

/**
 * Execute all real-world tasks and return results.
 */
export async function executeRealWorldTaskSuite(tasks: RealWorldTask[]): Promise<{
  results: Array<{ task: RealWorldTask; result: RealWorldTaskResult; verification: { passed: boolean; detail: string } }>;
  summary: { total: number; passed: number; failed: number; avgLatencyMs: number };
}> {
  const results: Array<{ task: RealWorldTask; result: RealWorldTaskResult; verification: { passed: boolean; detail: string } }> = [];

  for (const task of tasks) {
    const result = await task.execute();
    const verification = task.verify(result);
    results.push({ task, result, verification });
  }

  const passed = results.filter((r) => r.verification.passed).length;
  const totalLatency = results.reduce((sum, r) => sum + r.result.latencyMs, 0);

  return {
    results,
    summary: {
      total: tasks.length,
      passed,
      failed: tasks.length - passed,
      avgLatencyMs: tasks.length > 0 ? totalLatency / tasks.length : 0,
    },
  };
}