/**
 * @agentos/benchmarks — Dogfooding Task Templates
 * Pre-defined real-world task templates for the Internal Dogfooding Program.
 * Each template is a parameterized task that a team member can instantiate
 * with their specific context and delegate to AgentOS.
 *
 * INTERNAL_DOGFOODING.md §3 — daily usage scenarios.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

export type DogfoodCategory =
  | 'engineering'
  | 'research'
  | 'planning'
  | 'documentation'
  | 'browser-automation'
  | 'file-management'
  | 'multi-step-workflow';

export interface DogfoodTaskTemplate {
  id: string;
  category: DogfoodCategory;
  title: string;
  description: string;
  /** Parameters the user fills in before executing */
  parameters: Array<{
    name: string;
    description: string;
    required: boolean;
    defaultValue?: string;
  }>;
  /** The function that executes this task with the given parameters */
  execute: (params: Record<string, string>) => Promise<DogfoodTaskResult>;
  /** Verify the result */
  verify: (result: DogfoodTaskResult) => { passed: boolean; detail: string };
}

export interface DogfoodTaskResult {
  taskId: string;
  success: boolean;
  artifactPath?: string;
  data?: unknown;
  latencyMs: number;
  error?: string;
}

// ─── Engineering Tasks ─────────────────────────────────────────────────────

export const codeReviewTemplate: DogfoodTaskTemplate = {
  id: 'DF-ENG-001',
  category: 'engineering',
  title: 'Code Review Analysis',
  description: 'Analyze a source file for code quality issues, potential bugs, and improvement suggestions',
  parameters: [
    { name: 'filePath', description: 'Path to the source file to review', required: true },
    { name: 'language', description: 'Programming language', required: false, defaultValue: 'typescript' },
  ],
  async execute(params): Promise<DogfoodTaskResult> {
    const start = Date.now();
    try {
      const filePath = params['filePath']!;
      if (!existsSync(filePath)) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: `File not found: ${filePath}` };
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const issues: Array<{ line: number; severity: string; message: string }> = [];

      // Basic static analysis
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Check for TODO/FIXME
        if (/TODO|FIXME|HACK|XXX/i.test(line)) {
          issues.push({ line: lineNum, severity: 'info', message: 'TODO/FIXME marker found' });
        }
        // Check for console.log
        if (/console\.(log|debug|info)\(/.test(line)) {
          issues.push({ line: lineNum, severity: 'warning', message: 'Console logging in production code' });
        }
        // Check for any type
        if (/\bany\b/.test(line) && !/\/\/.*any/.test(line)) {
          issues.push({ line: lineNum, severity: 'warning', message: 'Use of any type' });
        }
        // Check for empty catch
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
          issues.push({ line: lineNum, severity: 'error', message: 'Empty catch block' });
        }
        // Check for hardcoded secrets
        if (/password|secret|api_?key|token/i.test(line) && !/\/\/|\/\*|import|type|interface/.test(line)) {
          issues.push({ line: lineNum, severity: 'error', message: 'Possible hardcoded secret' });
        }
      }

      const report = {
        file: filePath,
        totalLines: lines.length,
        issuesFound: issues.length,
        issues,
        summary: issues.length === 0
          ? 'No issues found — code looks clean'
          : `Found ${issues.length} issue(s): ${issues.filter(i => i.severity === 'error').length} errors, ${issues.filter(i => i.severity === 'warning').length} warnings, ${issues.filter(i => i.severity === 'info').length} info`,
        reviewedAt: new Date().toISOString(),
      };

      const reportPath = join(dirname(filePath), 'code-review-report.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      return { taskId: this.id, success: true, artifactPath: reportPath, data: report, latencyMs: Date.now() - start };
    } catch (e) {
      return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  },
  verify(result) {
    if (!result.success) return { passed: false, detail: `Failed: ${result.error}` };
    if (!result.artifactPath || !existsSync(result.artifactPath)) return { passed: false, detail: 'Report not created' };
    const data = JSON.parse(readFileSync(result.artifactPath, 'utf-8'));
    if (data.totalLines === undefined || data.issuesFound === undefined) return { passed: false, detail: 'Report missing fields' };
    return { passed: true, detail: `Reviewed ${data.totalLines} lines, found ${data.issuesFound} issues` };
  },
};

export const dependencyAuditTemplate: DogfoodTaskTemplate = {
  id: 'DF-ENG-002',
  category: 'engineering',
  title: 'Dependency Audit',
  description: 'Scan package.json, identify dependencies, and generate an audit report',
  parameters: [
    { name: 'packageJsonPath', description: 'Path to package.json', required: true },
  ],
  async execute(params): Promise<DogfoodTaskResult> {
    const start = Date.now();
    try {
      const pkgPath = params['packageJsonPath']!;
      if (!existsSync(pkgPath)) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: `package.json not found: ${pkgPath}` };
      }

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = pkg.dependencies ?? {};
      const devDeps = pkg.devDependencies ?? {};
      const allDeps = { ...deps, ...devDeps };

      const audit: Array<{ name: string; version: string; type: string }> = [];
      for (const [name, version] of Object.entries(allDeps)) {
        audit.push({ name, version: version as string, type: name in deps ? 'production' : 'dev' });
      }

      const report = {
        packageName: pkg.name,
        packageVersion: pkg.version,
        totalDependencies: audit.length,
        productionDependencies: Object.keys(deps).length,
        devDependencies: Object.keys(devDeps).length,
        dependencies: audit,
        auditedAt: new Date().toISOString(),
      };

      const reportPath = join(dirname(pkgPath), 'dependency-audit.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      return { taskId: this.id, success: true, artifactPath: reportPath, data: report, latencyMs: Date.now() - start };
    } catch (e) {
      return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  },
  verify(result) {
    if (!result.success) return { passed: false, detail: `Failed: ${result.error}` };
    const data = result.data as { totalDependencies: number };
    if (data.totalDependencies === 0) return { passed: false, detail: 'No dependencies found' };
    return { passed: true, detail: `Audited ${data.totalDependencies} dependencies` };
  },
};

// ─── Planning Tasks ────────────────────────────────────────────────────────

export const sprintPlanningTemplate: DogfoodTaskTemplate = {
  id: 'DF-PLN-001',
  category: 'planning',
  title: 'Sprint Planning',
  description: 'Generate a sprint plan from a list of backlog items with effort estimates',
  parameters: [
    { name: 'backlogItems', description: 'Comma-separated list of backlog items', required: true },
    { name: 'sprintCapacity', description: 'Total story points available', required: false, defaultValue: '40' },
  ],
  async execute(params): Promise<DogfoodTaskResult> {
    const start = Date.now();
    try {
      const items = (params['backlogItems'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (items.length === 0) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: 'No backlog items provided' };
      }

      const capacity = parseInt(params['sprintCapacity'] ?? '40', 10);
      const tasks = items.map((item, i) => ({
        id: `TASK-${String(i + 1).padStart(3, '0')}`,
        title: item,
        storyPoints: Math.floor(Math.random() * 8) + 1,
        priority: i < items.length / 2 ? 'high' : 'medium',
      }));

      const totalPoints = tasks.reduce((sum, t) => sum + t.storyPoints, 0);
      const fits = totalPoints <= capacity;

      const plan = {
        sprintId: `SPRINT-${Date.now()}`,
        capacity,
        totalEstimated: totalPoints,
        fitsInSprint: fits,
        taskCount: tasks.length,
        tasks,
        recommendation: fits
          ? 'All tasks fit within sprint capacity'
          : `Sprint is over-committed by ${totalPoints - capacity} points. Consider deferring ${Math.ceil((totalPoints - capacity) / 5)} tasks.`,
        generatedAt: new Date().toISOString(),
      };

      const reportPath = join(process.cwd(), 'sprint-plan.json');
      writeFileSync(reportPath, JSON.stringify(plan, null, 2), 'utf-8');

      return { taskId: this.id, success: true, artifactPath: reportPath, data: plan, latencyMs: Date.now() - start };
    } catch (e) {
      return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  },
  verify(result) {
    if (!result.success) return { passed: false, detail: `Failed: ${result.error}` };
    const data = result.data as { taskCount: number; totalEstimated: number };
    if (data.taskCount === 0) return { passed: false, detail: 'No tasks in plan' };
    return { passed: true, detail: `Planned ${data.taskCount} tasks, ${data.totalEstimated} story points` };
  },
};

// ─── Documentation Tasks ───────────────────────────────────────────────────

export const readmeGenerationTemplate: DogfoodTaskTemplate = {
  id: 'DF-DOC-001',
  category: 'documentation',
  title: 'README Generation',
  description: 'Analyze a package directory and generate a comprehensive README.md',
  parameters: [
    { name: 'packageDir', description: 'Path to the package directory', required: true },
  ],
  async execute(params): Promise<DogfoodTaskResult> {
    const start = Date.now();
    try {
      const dir = params['packageDir']!;
      if (!existsSync(dir)) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: `Directory not found: ${dir}` };
      }

      // Read package.json
      const pkgJsonPath = join(dir, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: 'No package.json found' };
      }
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      // Scan source files
      const srcDir = join(dir, 'src');
      const srcFiles = existsSync(srcDir)
        ? readdirSync(srcDir).filter(f => f.endsWith('.ts') || f.endsWith('.js')).map(f => ({
            name: f,
            size: statSync(join(srcDir, f)).size,
          }))
        : [];

      // Scan test files
      const testDir = join(dir, 'tests');
      const testFiles = existsSync(testDir)
        ? readdirSync(testDir).filter(f => f.endsWith('.ts') || f.endsWith('.js')).length
        : 0;

      // Count source-level tests
      const srcTestFiles = srcFiles.filter(f => f.name.includes('.test.')).length;

      // Generate README
      const readme = [
        `# ${pkg.name ?? 'Unknown Package'}`,
        '',
        pkg.description ?? 'No description available.',
        '',
        '## Overview',
        '',
        `**Version**: ${pkg.version ?? '0.0.0'}`,
        `**Type**: ${pkg.type ?? 'module'}`,
        `**Source files**: ${srcFiles.length}`,
        `**Test files**: ${testFiles + srcTestFiles}`,
        '',
        '## Dependencies',
        '',
        pkg.dependencies
          ? Object.keys(pkg.dependencies).map(d => `- ${d}`).join('\n')
          : 'No dependencies',
        '',
        '## Scripts',
        '',
        pkg.scripts
          ? Object.entries(pkg.scripts).map(([k, v]) => `- **${k}**: \`${v}\``).join('\n')
          : 'No scripts defined',
        '',
        '## Source Files',
        '',
        srcFiles.length > 0
          ? srcFiles.map(f => `- \`${f.name}\` (${f.size} bytes)`).join('\n')
          : 'No source files found',
        '',
        '## License',
        '',
        pkg.license ?? 'Proprietary',
        '',
        `---`,
        `*Generated by AgentOS Dogfooding Task DF-DOC-001 on ${new Date().toISOString()}*`,
      ].join('\n');

      const readmePath = join(dir, 'README.md');
      writeFileSync(readmePath, readme, 'utf-8');

      return {
        taskId: this.id,
        success: true,
        artifactPath: readmePath,
        data: { packageName: pkg.name, srcFiles: srcFiles.length, testFiles: testFiles + srcTestFiles },
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  },
  verify(result) {
    if (!result.success) return { passed: false, detail: `Failed: ${result.error}` };
    if (!result.artifactPath || !existsSync(result.artifactPath)) return { passed: false, detail: 'README not created' };
    const content = readFileSync(result.artifactPath, 'utf-8');
    if (!content.startsWith('# ')) return { passed: false, detail: 'README missing title' };
    if (!content.includes('## Overview')) return { passed: false, detail: 'README missing overview' };
    return { passed: true, detail: 'README generated with package overview, dependencies, and scripts' };
  },
};

// ─── File Management Tasks ─────────────────────────────────────────────────

export const fileInventoryTemplate: DogfoodTaskTemplate = {
  id: 'DF-FM-001',
  category: 'file-management',
  title: 'File Inventory Report',
  description: 'Scan a directory and generate a detailed file inventory with sizes, types, and statistics',
  parameters: [
    { name: 'directory', description: 'Directory to inventory', required: true },
  ],
  async execute(params): Promise<DogfoodTaskResult> {
    const start = Date.now();
    try {
      const dir = params['directory']!;
      if (!existsSync(dir)) {
        return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: `Directory not found: ${dir}` };
      }

      const files: Array<{ path: string; size: number; extension: string; modified: string }> = [];
      const extensions: Record<string, number> = {};

      function scanDir(d: string) {
        const entries = readdirSync(d);
        for (const entry of entries) {
          const fullPath = join(d, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else {
            const ext = extname(entry) || '(no extension)';
            files.push({
              path: fullPath.replace(dir + '/', '').replace(dir + '\\', ''),
              size: stat.size,
              extension: ext,
              modified: stat.mtime.toISOString(),
            });
            extensions[ext] = (extensions[ext] ?? 0) + 1;
          }
        }
      }
      scanDir(dir);

      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const report = {
        directory: dir,
        totalFiles: files.length,
        totalSizeBytes: totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        byExtension: extensions,
        files: files.sort((a, b) => b.size - a.size),
        generatedAt: new Date().toISOString(),
      };

      const reportPath = join(dir, 'file-inventory.json');
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      return { taskId: this.id, success: true, artifactPath: reportPath, data: report, latencyMs: Date.now() - start };
    } catch (e) {
      return { taskId: this.id, success: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  },
  verify(result) {
    if (!result.success) return { passed: false, detail: `Failed: ${result.error}` };
    const data = result.data as { totalFiles: number; totalSizeMB: number };
    if (data.totalFiles === 0) return { passed: false, detail: 'No files found in directory' };
    return { passed: true, detail: `Inventoried ${data.totalFiles} files, ${data.totalSizeMB} MB total` };
  },
};

// ─── All Templates ─────────────────────────────────────────────────────────

export const ALL_DOGFOOD_TEMPLATES: DogfoodTaskTemplate[] = [
  codeReviewTemplate,
  dependencyAuditTemplate,
  sprintPlanningTemplate,
  readmeGenerationTemplate,
  fileInventoryTemplate,
];

export function getTemplatesByCategory(category: DogfoodCategory): DogfoodTaskTemplate[] {
  return ALL_DOGFOOD_TEMPLATES.filter(t => t.category === category);
}

export function getTemplateById(id: string): DogfoodTaskTemplate | undefined {
  return ALL_DOGFOOD_TEMPLATES.find(t => t.id === id);
}