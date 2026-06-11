/**
 * @agentos/capabilities — MCP Adapter Tests
 * Tests path mapping and adapter logic.
 */

import { describe, it, expect } from 'vitest';
import { toolToPath, resourceToPath, promptToPath } from '../../src/mcp/mcp-adapter.js';

describe('MCP Adapter — Path Mapping', () => {
  it('should map tool names to compute.mcp paths', () => {
    expect(toolToPath('filesystem-server', 'read_file')).toBe('compute.mcp.filesystem-server.read-file');
    expect(toolToPath('GitHub', 'create_issue')).toBe('compute.mcp.github.create-issue');
  });

  it('should map resource names to remember.mcp paths', () => {
    expect(resourceToPath('docs-server', 'api_reference')).toBe('remember.mcp.docs-server.api-reference');
  });

  it('should map prompt names to reason.mcp paths', () => {
    expect(promptToPath('review-server', 'code_review')).toBe('reason.mcp.review-server.code-review');
  });

  it('should sanitize special characters in names', () => {
    expect(toolToPath('my/server', 'read_file!')).toBe('compute.mcp.my-server.read-file');
    expect(toolToPath('UPPER_CASE', 'Some Tool')).toBe('compute.mcp.upper-case.some-tool');
  });

  it('should collapse multiple hyphens', () => {
    expect(toolToPath('a--b', 'c___d')).toBe('compute.mcp.a-b.c-d');
  });

  it('should trim leading/trailing hyphens', () => {
    expect(toolToPath('-server-', 'tool-')).toBe('compute.mcp.server.tool');
  });
});