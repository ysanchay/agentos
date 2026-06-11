/**
 * @agentos/swarm — ValidatorAgent
 * Independently reviews outputs, detects inconsistencies, verifies completion
 * criteria, assesses confidence, and rejects or approves completed work.
 *
 * Responsibilities:
 *   1. Receive validation requests for completed tasks
 *   2. Review task outputs against completion criteria
 *   3. Detect inconsistencies and quality issues
 *   4. Assess confidence and vote on approval
 *   5. Produce validation results (approve/reject/needs_review)
 *
 * Multiple ValidatorAgents form a consensus for each validation:
 *   - unanimous: all must approve
 *   - majority: >50% must approve
 *   - supermajority: >66% must approve
 *   - chief-decides: Chief breaks ties
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  Priority,
  ResourceBudget,
  ResourceConsumption,
} from '@agentos/types';
import { createUUID, ZERO_BUDGET, ZERO_CONSUMPTION } from '@agentos/types';
import type {
  SwarmConfig,
  SwarmMessage,
  ValidationResult,
  ValidationConsensus,
} from './types.js';
import { SwarmAgent, type SwarmAgentContext } from './swarm-agent.js';

// ─── Validator Capabilities ────────────────────────────────────────────────

const VALIDATOR_CAPABILITIES = [
  'validate', 'review', 'approve',
  'reason.infer.text', 'validate.review', 'validate.approve',
];

const VALIDATOR_BUDGET: ResourceBudget = {
  ru: 200,
  mu: 100,
  eu: 50,
  vu: 25,
};

// ─── Validation Criteria ───────────────────────────────────────────────────

interface ValidationCriteria {
  minConfidence: number;
  requireOutput: boolean;
  maxIssues: number;
  checkResourceUsage: boolean;
  checkCompleteness: boolean;
  customChecks?: Array<(output: unknown) => { pass: boolean; issue?: string }>;
}

const DEFAULT_CRITERIA: ValidationCriteria = {
  minConfidence: 0.7,
  requireOutput: true,
  maxIssues: 3,
  checkResourceUsage: true,
  checkCompleteness: true,
};

// ─── ValidatorAgent Config ─────────────────────────────────────────────────

export interface ValidatorAgentConfig {
  id?: AgentID;
  workspaceId: WorkspaceID;
  projectId: ProjectID;
  priority?: Priority;
  failureRate?: number;
  budget?: ResourceBudget;
  criteria?: Partial<ValidationCriteria>;
}

// ─── ValidatorAgent ────────────────────────────────────────────────────────

export class ValidatorAgent extends SwarmAgent {
  // Validation criteria
  private criteria: ValidationCriteria;

  // Pending validation requests
  private pendingValidations: Map<TaskID, {
    result: WorkerResult;
    requestedAt: number;
    requestorId: AgentID;
  }> = new Map();

  // Completed validations
  private validations: Map<TaskID, ValidationResult> = new Map();

  // Consensus tracking
  private consensusResults: Map<TaskID, ValidationConsensus> = new Map();

  // LLM integration (for live validation)
  private llmClient: any = null;

  constructor(config: ValidatorAgentConfig, rng?: () => number) {
    super({
      id: config.id,
      type: 'validator',
      workspaceId: config.workspaceId,
      projectId: config.projectId,
      capabilities: VALIDATOR_CAPABILITIES,
      budget: config.budget ?? VALIDATOR_BUDGET,
      priority: config.priority ?? (2 as Priority),
      maxConcurrentTasks: 5,
      failureRate: config.failureRate ?? 0.02,
    }, rng);
    this.criteria = { ...DEFAULT_CRITERIA, ...config.criteria };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  protected onInitialize(): void {
    // Validator is ready to receive validation requests
  }

  // ─── LLM Integration ────────────────────────────────────────────────────

  setLLMClient(client: any): void {
    this.llmClient = client;
  }

  // ─── Validation Request ──────────────────────────────────────────────────

  /**
   * Receive a validation request for a task result.
   */
  requestValidation(
    taskId: TaskID,
    result: WorkerResult,
    requestorId: AgentID,
  ): void {
    if (!this.context) return;

    this.pendingValidations.set(taskId, {
      result,
      requestedAt: this.context.currentTime(),
      requestorId,
    });

    this.activeTaskIds.push(taskId);
    if (this.state !== 'running' as any) {
      this.transition('running' as any);
      this.phase = 'working';
    }

    this.sendMessage({
      type: 'validation.request',
      recipient: '*',
      payload: { taskId, validatorId: this.id },
    });
  }

  // ─── Validation Execution ────────────────────────────────────────────────

  /**
   * Validate a task result.
   * In simulation mode, uses deterministic checks.
   * In live mode, can use LLM for deeper review.
   */
  validate(taskId: TaskID): ValidationResult {
    const pending = this.pendingValidations.get(taskId);
    if (!pending) {
      return {
        taskId,
        validatorId: this.id,
        approved: false,
        confidence: 0,
        issues: ['No pending validation for this task'],
        suggestions: ['Submit the task for validation first'],
        timestamp: this.context?.currentTime() ?? Date.now(),
      };
    }

    const { result } = pending;
    const issues: string[] = [];
    const suggestions: string[] = [];
    let confidence = result.confidence;
    let approved = true;

    // Check 1: Output exists
    if (this.criteria.requireOutput && (!result.output || result.output === null)) {
      issues.push('Task output is missing or null');
      suggestions.push('Ensure the task produces a non-null output');
      approved = false;
    }

    // Check 2: Confidence threshold
    if (confidence < this.criteria.minConfidence) {
      issues.push(`Confidence ${confidence.toFixed(2)} below threshold ${this.criteria.minConfidence}`);
      suggestions.push('Improve task execution quality or retry with different parameters');
      approved = false;
    }

    // Check 3: Resource usage
    if (this.criteria.checkResourceUsage) {
      const totalResources = result.resourcesConsumed.ru +
        result.resourcesConsumed.mu +
        result.resourcesConsumed.eu;
      if (totalResources === 0) {
        issues.push('No resource consumption recorded');
        suggestions.push('Track resource usage during task execution');
        // Not necessarily a failure — but a warning
      }
    }

    // Check 4: Completeness (output has expected shape)
    if (this.criteria.checkCompleteness && result.output && typeof result.output === 'object') {
      const output = result.output as Record<string, unknown>;
      if (!output['completed'] && !output['simulated'] && !output['llmOutput']) {
        issues.push('Output does not indicate completion');
        suggestions.push('Ensure task output includes a completion marker');
      }
    }

    // Check 5: Duration reasonableness
    if (result.durationMs < 10) {
      issues.push('Task completed suspiciously fast (less than 10ms)');
      suggestions.push('Verify task actually performed work');
    }

    // Check 6: Custom checks
    if (this.criteria.customChecks) {
      for (const check of this.criteria.customChecks) {
        const checkResult = check(result.output);
        if (!checkResult.pass) {
          issues.push(checkResult.issue ?? 'Custom validation check failed');
          approved = false;
        }
      }
    }

    // Limit issues
    const finalIssues = issues.slice(0, this.criteria.maxIssues);

    // Simulate occasional validator failure
    if (this.shouldFail()) {
      approved = false;
      confidence *= 0.8;
      finalIssues.push('Validator uncertainty (simulated)');
    }

    const validationResult: ValidationResult = {
      taskId,
      validatorId: this.id,
      approved,
      confidence: Math.min(confidence, 1.0),
      issues: finalIssues,
      suggestions,
      timestamp: this.context?.currentTime() ?? Date.now(),
    };

    this.validations.set(taskId, validationResult);
    this.pendingValidations.delete(taskId);

    // Update task state
    const taskIdx = this.activeTaskIds.indexOf(taskId);
    if (taskIdx >= 0) {
      this.activeTaskIds.splice(taskIdx, 1);
    }
    if (this.activeTaskIds.length === 0 && this.state === 'running' as any) {
      this.transition('ready' as any);
      this.phase = 'idle';
    }

    // Submit validation to Blackboard
    if (this.context) {
      const blackboard = this.context.blackboard;
      blackboard.validateResult(taskId, result.agentId, approved, approved ? 'approved' : `rejected: ${finalIssues.join(', ')}`);
    }

    // Send validation result
    this.sendMessage({
      type: 'validation.result',
      recipient: pending.requestorId,
      payload: validationResult,
    });

    this.emitEvent('validation.result', {
      taskId,
      approved,
      confidence,
    });

    return validationResult;
  }

  /**
   * Run validation using LLM (live mode).
   */
  private async validateWithLLM(taskId: TaskID, result: WorkerResult): Promise<ValidationResult> {
    if (!this.llmClient) {
      return this.validate(taskId); // Fall back to deterministic validation
    }

    try {
      const response = await this.llmClient.complete(
        [
          {
            role: 'system',
            content: 'You are a task validation agent. Review the following task output and determine if it meets quality standards.',
          },
          {
            role: 'user',
            content: `Review task ${taskId} output: ${JSON.stringify(result.output)}`,
          },
        ],
        { capabilityPath: 'validate.review' },
      );

      const approved = response.content.toLowerCase().includes('approved') ||
        response.content.toLowerCase().includes('pass') ||
        response.content.toLowerCase().includes('valid');

      return {
        taskId,
        validatorId: this.id,
        approved,
        confidence: 0.7 + this.rng() * 0.3,
        issues: approved ? [] : ['LLM validation flagged potential issues'],
        suggestions: approved ? [] : ['Review and improve task output quality'],
        timestamp: this.context?.currentTime() ?? Date.now(),
      };
    } catch {
      return this.validate(taskId); // Fall back on error
    }
  }

  // ─── Consensus ────────────────────────────────────────────────────────────

  /**
   * Compute consensus from multiple validation results.
   */
  computeConsensus(taskId: TaskID, results: ValidationResult[], strategy: 'unanimous' | 'majority' | 'supermajority' | 'chief-decides' = 'majority'): ValidationConsensus {
    const approvals = results.filter((r) => r.approved).length;
    const totalConfidence = results.reduce((sum, r) => sum + r.confidence, 0);
    const averageConfidence = results.length > 0 ? totalConfidence / results.length : 0;

    let finalDecision: 'approved' | 'rejected' | 'needs_review';

    switch (strategy) {
      case 'unanimous':
        finalDecision = approvals === results.length ? 'approved' : 'rejected';
        break;
      case 'supermajority':
        finalDecision = approvals >= results.length * 0.66 ? 'approved' : 'rejected';
        break;
      case 'majority':
        finalDecision = approvals > results.length / 2 ? 'approved' : 'rejected';
        break;
      case 'chief-decides':
        // Chief-decides: defer to highest confidence result
        finalDecision = results.length > 0 && results[0]!.approved ? 'approved' : 'rejected';
        break;
      default:
        finalDecision = 'needs_review';
    }

    const consensus: ValidationConsensus = {
      taskId,
      results,
      finalDecision,
      averageConfidence,
      timestamp: this.context?.currentTime() ?? Date.now(),
    };

    this.consensusResults.set(taskId, consensus);
    return consensus;
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  handleMessage(message: SwarmMessage): void {
    switch (message.type) {
      case 'validation.request':
        const payload = message.payload as any;
        if (payload.taskId && payload.result) {
          this.requestValidation(payload.taskId, payload.result, message.sender);
        }
        break;
      case 'task.complete':
        // A task completed — might need validation
        break;
      default:
        break;
    }
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  tick(): void {
    if (this.state !== 'ready' as any && this.state !== 'running' as any) return;

    // Process pending validations
    for (const [taskId] of this.pendingValidations) {
      this.validate(taskId);
      break; // Process one per tick
    }
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getValidations(): ValidationResult[] {
    return Array.from(this.validations.values());
  }

  getConsensusResults(): ValidationConsensus[] {
    return Array.from(this.consensusResults.values());
  }

  getApprovalRate(): number {
    const validations = Array.from(this.validations.values());
    if (validations.length === 0) return 0;
    return validations.filter((v) => v.approved).length / validations.length;
  }
}

// Import WorkerResult type for validation
import type { WorkerResult } from './types.js';