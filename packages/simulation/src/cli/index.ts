#!/usr/bin/env node
/**
 * @agentos/simulation — CLI Entry Point
 * Run deterministic simulations to verify the constitutional architecture.
 *
 * Usage:
 *   node --import tsx src/cli/index.ts [options]
 *   pnpm --filter @agentos/simulation start -- [options]
 *
 * Options:
 *   --agents N        Number of agents (default: 100)
 *   --tasks N         Number of tasks (default: 500)
 *   --duration N      Duration in ms (default: 60000)
 *   --seed N          Random seed (default: 42)
 *   --workspaces N    Number of workspaces (default: 5)
 *   --speed N         Clock speed multiplier (default: 10)
 *   --failure-rate N  Agent failure rate 0-1 (default: 0.05)
 *   --output FORMAT   Output format: text|json (default: text)
 *   --verbose         Print step-by-step progress
 *   --help            Show this help message
 */

import { Simulation } from '../simulation.js';
import type { SimulationConfig } from '../simulation-config.js';

interface ParsedArgs {
  help?: boolean;
  verbose?: boolean;
  agents?: number;
  tasks?: number;
  duration?: number;
  seed?: number;
  workspaces?: number;
  speed?: number;
  failureRate?: number;
  output?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      return result;
    }
    if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c) as keyof ParsedArgs;
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        const num = Number(value);
        if (key === 'output') {
          result[key] = value;
        } else {
          (result as Record<string, string | number | boolean>)[key] = isNaN(num) ? value : num;
        }
        i++; // skip the value
      } else {
        (result as Record<string, boolean>)[key] = true;
      }
    }
  }
  return result;
}

function printHelp(): void {
  console.log(`
AgentOS Simulation CLI

Run deterministic simulations to verify the constitutional architecture.

Usage:
  node --import tsx src/cli/index.ts [options]

Options:
  --agents N        Number of agents (default: 100)
  --tasks N         Number of tasks (default: 500)
  --duration N      Duration in ms (default: 60000)
  --seed N          Random seed (default: 42)
  --workspaces N    Number of workspaces (default: 5)
  --speed N         Clock speed multiplier (default: 10)
  --failure-rate N  Agent failure rate 0-1 (default: 0.05)
  --output FORMAT   Output format: text|json (default: text)
  --verbose         Print step-by-step progress
  --help            Show this help message

Examples:
  # Run default 100-agent simulation
  pnpm --filter @agentos/simulation start

  # Quick test with 10 agents
  node --import tsx src/cli/index.ts --agents 10 --tasks 20 --duration 5000

  # JSON output for scripting
  node --import tsx src/cli/index.ts --agents 50 --output json

  # Verbose mode with custom seed
  node --import tsx src/cli/index.ts --agents 20 --seed 999 --verbose
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const config: Partial<SimulationConfig> = {
    agentCount: args.agents,
    taskCount: args.tasks,
    durationMs: args.duration,
    randomSeed: args.seed,
    workspaceCount: args.workspaces,
    clockSpeed: args.speed,
    failureRate: args.failureRate,
  };

  if (args.verbose) {
    const fullConfig = { agentCount: 100, taskCount: 500, durationMs: 60000, randomSeed: 42, workspaceCount: 5, clockSpeed: 10, failureRate: 0.05, ...config };
    console.log('AgentOS Simulation');
    console.log('─────────────────');
    console.log(`  Agents:     ${fullConfig.agentCount}`);
    console.log(`  Tasks:      ${fullConfig.taskCount}`);
    console.log(`  Duration:   ${fullConfig.durationMs}ms`);
    console.log(`  Seed:       ${fullConfig.randomSeed}`);
    console.log(`  Workspaces: ${fullConfig.workspaceCount}`);
    console.log(`  Speed:      ${fullConfig.clockSpeed}x`);
    console.log(`  Failure:    ${fullConfig.failureRate}`);
    console.log('');
  }

  const sim = new Simulation(config);
  const result = await sim.run();

  if (args.output === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.report);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});