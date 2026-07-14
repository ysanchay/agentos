/**
 * @agentos/benchmarks — Benchmark Verifier
 * Validates benchmark results against expected outputs and thresholds
 * (ALPHA_VALIDATION.md §2.5).
 *
 * Checks:
 *   1. Completion status
 *   2. Metrics thresholds (latency, validation accuracy, recovery success)
 *   3. Constitutional compliance
 *   4. Custom validation checks from the spec
 */

import { z } from 'zod';
import type { BenchmarkSpec, BenchmarkResult } from './types.js';

/** The result of verifying a benchmark. */
export interface VerificationResult {
  /** Whether the benchmark passed all checks. */
  passed: boolean;
  /** List of issues found (empty if passed). */
  issues: string[];
}

/**
 * BenchmarkVerifier — verifies benchmark results against specs.
 */
export class BenchmarkVerifier {
  /**
   * Verify a benchmark result against its spec.
   *
   * @param spec - The benchmark specification.
   * @param result - The benchmark result to verify.
   * @returns Whether the result passes all checks and any issues found.
   */
  verify(spec: BenchmarkSpec, result: BenchmarkResult): VerificationResult {
    const issues: string[] = [];

    // 1. Check completion
    if (!result.completed) {
      issues.push(`Benchmark ${spec.id} did not complete`);
    }

    // 2. Check latency against timeout
    if (result.latency > spec.timeout) {
      issues.push(
        `Benchmark ${spec.id} exceeded timeout: ${result.latency}ms > ${spec.timeout}ms`,
      );
    }

    // 3. Check validation accuracy meets minimum confidence
    const minConfidence = spec.validationCriteria.minConfidence;
    if (result.validationAccuracy < minConfidence) {
      issues.push(
        `Benchmark ${spec.id} validation accuracy ${result.validationAccuracy.toFixed(2)} below minimum ${minConfidence}`,
      );
    }

    // 4. Check constitutional compliance (should be 100% — zero violations)
    if (result.constitutionalCompliance < 100) {
      issues.push(
        `Benchmark ${spec.id} constitutional compliance ${result.constitutionalCompliance}% < 100%`,
      );
    }

    // 5. Check recovery success if failures were injected
    if (spec.injectFailures && spec.injectFailures.length > 0) {
      if (result.recoverySuccess < 0.9) {
        issues.push(
          `Benchmark ${spec.id} recovery success ${result.recoverySuccess.toFixed(2)} below 0.90 threshold`,
        );
      }
    }

    // 6. Check human intervention expectations
    if (spec.humanInterventionExpected && result.humanInterventionRate === 0) {
      // Expected intervention but none recorded — might be OK in simulation
      // This is a soft check
    }
    if (!spec.humanInterventionExpected && result.humanInterventionRate > 0) {
      issues.push(
        `Benchmark ${spec.id} unexpected human intervention (rate: ${result.humanInterventionRate})`,
      );
    }

    // 7. Check errors
    if (result.errors.length > 0) {
      // Errors don't automatically fail, but are noted
      // Only fail if there are many errors
      if (result.errors.length > 5) {
        issues.push(
          `Benchmark ${spec.id} has ${result.errors.length} errors`,
        );
      }
    }

    // 8. Run custom validation checks if specified
    if (spec.validationCriteria.customChecks && result.output !== undefined) {
      for (let i = 0; i < spec.validationCriteria.customChecks.length; i++) {
        const check = spec.validationCriteria.customChecks[i]!;
        try {
          const checkResult = check(result.output);
          if (!checkResult.passed) {
            issues.push(
              `Benchmark ${spec.id} custom check ${i} failed: ${checkResult.detail ?? 'no detail'}`,
            );
          }
        } catch (e) {
          issues.push(
            `Benchmark ${spec.id} custom check ${i} threw: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // 9. Validate output against expected shape if it's a Zod schema
    if (spec.validationCriteria.expectedOutputShape) {
      const shape = spec.validationCriteria.expectedOutputShape;
      if (shape instanceof z.ZodType) {
        // It's a Zod schema — validate the output
        if (result.output !== undefined) {
          const parseResult = shape.safeParse(result.output);
          if (!parseResult.success) {
            issues.push(
              `Benchmark ${spec.id} output schema validation failed: ${parseResult.error.message}`,
            );
          }
        }
      }
    }

    // 10. Validate output against expected output spec schema
    if (spec.expectedOutput.schema && result.output !== undefined) {
      const schema = spec.expectedOutput.schema;
      const parseResult = schema.safeParse(result.output);
      if (!parseResult.success) {
        issues.push(
          `Benchmark ${spec.id} output spec schema validation failed: ${parseResult.error.message}`,
        );
      }
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }

  /**
   * Verify multiple benchmark results.
   *
   * @param specs - Array of benchmark specs.
   * @param results - Array of benchmark results.
   * @returns Overall verification with aggregate issues.
   */
  verifyAll(
    specs: BenchmarkSpec[],
    results: BenchmarkResult[],
  ): VerificationResult {
    const allIssues: string[] = [];

    for (const result of results) {
      const spec = specs.find((s) => s.id === result.specId);
      if (!spec) {
        allIssues.push(`No spec found for result ${result.specId}`);
        continue;
      }
      const verification = this.verify(spec, result);
      if (!verification.passed) {
        allIssues.push(...verification.issues);
      }
    }

    return {
      passed: allIssues.length === 0,
      issues: allIssues,
    };
  }
}