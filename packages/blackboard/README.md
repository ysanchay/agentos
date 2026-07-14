# @agentos/blackboard

Shared coordination layer where agents claim tasks, publish results, and resolve conflicts. Implements the 7-section blackboard pattern: Goals, Tasks, Claims, Results, Context, Consensus, and Errors.

## Overview

The blackboard is the central coordination surface for multi-agent work. Agents publish workstream goals, claim tasks atomically, post results, share context, reach consensus, and record errors — all through structured sections. The package includes a `ClaimProcessor` for atomic task claiming with agent-profile matching, a `LockManager` for section-level mutual exclusion, a `DeadlockDetector` for circular-wait detection, and a `ConflictResolver` for merging competing results.

## API

- **`Blackboard`** — main class managing all 7 sections; create/read/update entries.
- **`ClaimProcessor`** — atomically claims tasks for agents; returns `ClaimEntry` or rejection with `ClaimRejectionReason`.
- **`LockManager`** — pessimistic locking with `LockEntry` / `LockWaiter` queues.
- **`DeadlockDetector`** — detects circular waits; reports `DeadlockInfo` with `AgentPriority`.
- **`ConflictResolver`** — resolves competing results via `ConflictVote` and `ConflictState`; produces `MergeResult`.
- **`AuditChain`** — blackboard-level audit trail with `AuditEntry`.

## Usage

```typescript
import { Blackboard, ClaimProcessor } from '@agentos/blackboard';

const bb = new Blackboard({ eventStore });
bb.addGoal({ id, description: 'Build API', budget });
bb.addTask({ id, goalId, description: 'Implement endpoint', priority: 'high' });

const claimer = new ClaimProcessor(bb);
const claim = claimer.claim(taskId, agentProfile);
if (claim.accepted) {
  // agent now owns the task
}
```

## Configuration

No environment variables. The blackboard is configured programmatically; persistence flows through the injected `EventStore`.

## Tests

```bash
pnpm --filter @agentos/blackboard test
```

## License

Proprietary — Nous Research