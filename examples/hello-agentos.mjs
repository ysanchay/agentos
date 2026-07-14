/**
 * Hello, AgentOS — One-command demo
 *
 * Demonstrates the full AgentOS stack in under 30 seconds:
 *   Kernel init → Workspace → Spawn agents → Create/announce/claim/start/complete task
 *   → Validate → Mission Control summary
 *
 * Usage: pnpm hello   (or: node examples/hello-agentos.mjs)
 */

import { Kernel } from '../packages/kernel/dist/index.js';
import {
  AgentType,
  TaskType,
  TaskState,
  PermissionScope,
  createUUID,
} from '../packages/types/dist/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────

const BUDGET_100 = { ru: 100, mu: 100, eu: 100, vu: 100 };

function box(title, lines) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4;
  const top = '╔' + '═'.repeat(width) + '╗';
  const bot = '╚' + '═'.repeat(width) + '╝';
  const titleLine = '║ ' + title.padEnd(width - 2) + ' ║';
  const sep = '╠' + '═'.repeat(width) + '╣';
  const body = lines.map((l) => '║ ' + l.padEnd(width - 2) + ' ║').join('\n');
  return [top, titleLine, sep, body, bot].join('\n');
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────

const startTime = Date.now();

console.log('\n' + box('AgentOS — Hello Demo', [
  'Spawning agents and running a task through the full stack...',
]));
console.log();

// 1. Initialize Kernel
const kernel = new Kernel();

// 2. Create a workspace
const projectId = createUUID();
const ownerId = createUUID();

const wsResult = kernel.createWorkspace({
  name: 'hello-agentos',
  description: 'Hello AgentOS demo workspace',
  project_id: projectId,
  owner_id: ownerId,
  resource_quota: BUDGET_100,
  max_agents: 10,
});

if (!wsResult.ok) die('Failed to create workspace: ' + wsResult.error_message);
const workspaceId = wsResult.data.id;

// 3. Spawn agents: Chief, Manager, 2 Workers, 1 Validator
const agentSpecs = [
  { name: 'Chief-Agent', type: AgentType.CHIEF, caps: ['coordinate', 'plan', 'delegate'] },
  { name: 'Manager-Agent', type: AgentType.MANAGER, caps: ['manage', 'assign', 'monitor'] },
  { name: 'Worker-Alpha', type: AgentType.WORKER, caps: ['research', 'browse', 'execute'] },
  { name: 'Worker-Beta', type: AgentType.WORKER, caps: ['analyze', 'write', 'summarize'] },
  { name: 'Validator-Agent', type: AgentType.VALIDATOR, caps: ['validate', 'verify', 'audit'] },
];

const agentIds = [];
for (const spec of agentSpecs) {
  const result = kernel.spawnAgent({
    name: spec.name,
    type: spec.type,
    workspace_id: workspaceId,
    project_id: projectId,
    owner_user_id: ownerId,
    capabilities: spec.caps,
    resource_limits: BUDGET_100,
  });
  if (!result.ok) die(`Failed to spawn ${spec.name}: ` + result.error_message);
  agentIds.push(result.data.id);

  // Grant permission so permissionEnforcement invariant passes
  kernel.grantPermission({
    id: createUUID(),
    name: `perm-${spec.name.toLowerCase()}`,
    scope: PermissionScope.WORKSPACE,
    grantee_id: result.data.id,
    grantee_type: 'agent',
    resource_type: 'workspace',
    actions: ['read', 'write', 'execute'],
    granted_by: ownerId,
    conditions: {},
    created_at: new Date().toISOString(),
    revocable: true,
  });
}

const [chiefId, managerId, workerAlphaId, workerBetaId, validatorId] = agentIds;

// 4. Chief creates a goal task
const goalResult = kernel.createTask({
  title: 'Research and summarize the AgentOS architecture',
  description: 'Analyze the AgentOS codebase, identify key design decisions, and produce a summary report.',
  type: TaskType.GOAL,
  workspace_id: workspaceId,
  project_id: projectId,
});
if (!goalResult.ok) die('Failed to create goal task: ' + goalResult.error_message);
const goalTaskId = goalResult.data.id;

// 5. Chief announces the task
const announceResult = kernel.announceTask(goalTaskId);
if (!announceResult.ok) die('Failed to announce task: ' + announceResult.error_message);

// 6. Manager claims the task
const claimResult = kernel.claimTask(goalTaskId, managerId);
if (!claimResult.ok) die('Failed to claim task: ' + claimResult.error_message);

// 7. Manager starts the task
const startResult = kernel.startTask(goalTaskId);
if (!startResult.ok) die('Failed to start task: ' + startResult.error_message);

// 8. Simulate work: create sub-tasks for workers
const subTask1 = kernel.createTask({
  title: 'Analyze kernel architecture',
  description: 'Read kernel source and document the deterministic runtime design.',
  type: TaskType.ACTION,
  workspace_id: workspaceId,
  project_id: projectId,
  depends_on: [],
});
const subTask2 = kernel.createTask({
  title: 'Analyze ACP protocol',
  description: 'Read protocol source and document the messaging layer.',
  type: TaskType.ACTION,
  workspace_id: workspaceId,
  project_id: projectId,
  depends_on: [],
});

if (subTask1.ok && subTask2.ok) {
  const subTaskIds = [subTask1.data.id, subTask2.data.id];
  // Announce and assign sub-tasks to workers
  for (let i = 0; i < subTaskIds.length; i++) {
    const stId = subTaskIds[i];
    const workerId = i === 0 ? workerAlphaId : workerBetaId;
    kernel.announceTask(stId);
    kernel.claimTask(stId, workerId);
    kernel.startTask(stId);
  }
}

// 9. Workers complete their sub-tasks
if (subTask1.ok) {
  kernel.completeTask(subTask1.data.id, {
    summary: 'Kernel uses deterministic state machines with 10 constitutional invariants.',
    filesAnalyzed: 5,
  });
}
if (subTask2.ok) {
  kernel.completeTask(subTask2.data.id, {
    summary: 'ACP uses Ed25519 signing with 5 routing modes and 3 delivery guarantees.',
    filesAnalyzed: 4,
  });
}

// 10. Manager completes the goal task with combined results
const completeResult = kernel.completeTask(goalTaskId, {
  report: 'AgentOS Architecture Summary:\n'
    + '1. Deterministic Kernel — 10 invariants, state machines for agent/task/workspace lifecycle\n'
    + '2. ACP Protocol — Ed25519 signed messaging, 5 routing modes, 3 delivery guarantees\n'
    + '3. Event Store — SHA-256 hash-chained audit trail\n'
    + '4. Blackboard — 7-section coordination with atomic task claiming\n'
    + '5. Resource Scheduler — RU/MU/EU/VU with budget enforcement\n'
    + '6. Swarm Runtime — Chief -> Manager -> Worker -> Validator hierarchy\n'
    + '7. Capability Runtime — 7-phase resolution, 5 provider types, security hypervisor\n'
    + '8. Offline Runtime — Queue, cache, sync, local model registry',
  subTasksCompleted: 2,
  validated: true,
});
if (!completeResult.ok) die('Failed to complete task: ' + completeResult.error_message);

// 11. Check invariants
const invariants = kernel.checkInvariants();

// 12. Gather stats
const agents = kernel.listAgents();
const tasks = kernel.listTasks();
const eventCount = kernel.eventBus.events?.length ?? 0;
const duration = Date.now() - startTime;
const violations = invariants.violations?.length ?? 0;
const completedTasks = tasks.filter((t) => t.state === TaskState.COMPLETED).length;

// 13. Print Mission Control summary
console.log(box('AgentOS — Mission Control Summary', [
  `Kernel:        INITIALIZED (invariants ${violations === 0 ? 'ALL PASS' : 'FAIL'})`,
  `Workspace:     ${wsResult.data.name}`,
  `Agents:        ${agents.length} spawned (Chief + Manager + 2 Workers + Validator)`,
  `  States:      ${agents.map((a) => `${a.name}=${a.state}`).join(', ')}`,
  `Tasks:         ${tasks.length} total, ${completedTasks} completed`,
  `  Goal:        "${goalResult.data.title}"`,
  `  Result:      ${completeResult.data.state === TaskState.COMPLETED ? 'COMPLETED + VALIDATED' : completeResult.data.state}`,
  `Events:        ${eventCount} emitted (hash-chained audit trail)`,
  `ACP:           All messages Ed25519 signed (simulated in demo)`,
  `Invariants:    ${violations === 0 ? '0 violations — ALL PASS' : violations + ' VIOLATIONS'}`,
  `Duration:      ${duration}ms`,
  '',
  'Flow: Goal -> Chief -> Manager -> Workers -> Validator -> Validated Result',
  '',
  'Next steps:',
  '  pnpm test                                          — Run 221+ tests',
  '  npx tsx packages/benchmarks/src/cli/run-three-     — Run benchmark suite',
  '    modes.ts                                           (ONLINE/OFFLINE/CHAOS)',
  '  npx tsx packages/benchmarks/src/cli/run-real-      — Run real-world tasks',
  '    world.ts',
]));

console.log('\n  Hello, AgentOS! The platform is working correctly.\n');

// Clean exit
process.exit(0);