# AgentOS Internal Dogfooding Program

**Effective Date**: 2026-06-23
**Authority**: Chief Architect directive — transition to product-first execution
**Status**: Active — highest priority engineering initiative
**Duration**: 2-4 weeks internal usage before External Alpha

---

## 1. Program Objective

Every member of the development team uses AgentOS as their primary assistant for daily work. The goal is to discover friction points, reliability gaps, and usability issues before external users encounter them. Every interaction generates telemetry, user feedback, bug reports, and workflow analytics.

**The single evaluation question:**
> Would I choose to use AgentOS for this task again, or would I prefer to do it manually?

## 2. Participation Requirements

### 2.1 Who
- All engineering team members
- All architecture/design team members
- Optional: product, QA, and operations team members

### 2.2 Time Commitment
- Minimum 1 hour per day of active AgentOS usage
- At least 3 distinct task types per week
- Weekly retrospective: 30 minutes to review telemetry and share findings

### 2.3 What Counts as Dogfooding
- Delegating a real task to AgentOS that you would otherwise do manually
- Reviewing the output and providing feedback
- Reporting bugs, friction points, and missing capabilities
- NOT: running synthetic benchmarks, executing test suites, or simulating workloads

## 3. Daily Usage Scenarios

### 3.1 Engineering Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| Code review | Delegate PR review to AgentOS — analyze diff, identify issues, suggest fixes | Review report with inline comments |
| Bug investigation | Describe a bug, let AgentOS reproduce, analyze, and propose root cause | Root cause analysis with evidence |
| Dependency audit | Scan package.json, identify outdated/vulnerable deps, recommend upgrades | Audit report with risk ratings |
| Refactoring plan | Analyze a file/module, propose refactoring with step-by-step plan | Refactoring plan document |
| Test generation | Given a source file, generate comprehensive test cases | Test file with coverage analysis |

### 3.2 Research Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| Technology evaluation | Research a library/framework, compare alternatives, recommend | Comparison matrix + recommendation |
| API documentation review | Fetch API docs, extract endpoints, validate against implementation | API compliance report |
| Security advisory scan | Search for CVEs affecting project dependencies | Security advisory report |
| Performance benchmarking | Research performance characteristics of a technology | Performance analysis document |

### 3.3 Planning Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| Sprint planning | Given a backlog, decompose into tasks with effort estimates | Sprint plan with task breakdown |
| Risk assessment | Identify project risks, rate probability/impact, propose mitigations | Risk register document |
| Architecture review | Analyze current architecture, identify gaps, propose improvements | Architecture review document |
| Roadmap generation | Given objectives, generate a phased roadmap with milestones | Roadmap document |

### 3.4 Documentation Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| README generation | Analyze a package, generate comprehensive README | README.md file |
| API reference | Extract public API from source, generate reference docs | API reference document |
| Changelog draft | Analyze git log, generate structured changelog | CHANGELOG.md update |
| Architecture decision record | Draft an ADR from a technical decision | ADR document |

### 3.5 Browser Automation Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| Competitor research | Visit competitor websites, extract features/pricing | Competitor analysis report |
| Documentation scraping | Fetch docs from a website, extract structured content | Structured documentation file |
| Status page monitoring | Check service status pages, report incidents | Status report |
| Release note extraction | Visit GitHub releases, extract changelogs | Release notes document |

### 3.6 File Management Tasks
| Task | Description | Expected Output |
|------|-------------|-----------------|
| Project cleanup | Scan directory, identify stale/unused files, propose cleanup | Cleanup report with recommendations |
| File inventory | Generate inventory of project files with metadata | Inventory spreadsheet/report |
| Log analysis | Parse application logs, identify errors, summarize patterns | Log analysis report |

### 3.7 Multi-Step Workflows
| Task | Description | Expected Output |
|------|-------------|-----------------|
| PR lifecycle | Research issue → propose fix → generate code → write tests → draft PR description | Complete PR package |
| Incident response | Detect issue → analyze logs → identify root cause → draft postmortem | Incident report |
| Onboarding guide | Analyze codebase → generate setup guide → create examples → write FAQ | Onboarding document |

## 4. Telemetry Requirements

Every dogfooding session must produce:

### 4.1 Per-Task Telemetry (automatic via TelemetryCollector)
- Task category and objective
- Capabilities used (which providers, which paths)
- Latency (submission to completion)
- Resource consumption (RU/MU/EU/VU)
- Validation result and confidence
- Failure count and recovery success
- Security checks run and passed
- Mode transitions (if any)
- Constitutional compliance
- User interventions (count and type)

### 4.2 Per-Task User Feedback (manual, via feedback form)
- Overall satisfaction: 1-5 stars
- Would use again: yes/no/maybe
- Quality of output: 1-5 stars
- Speed of completion: 1-5 stars
- What worked well: free text
- What was frustrating: free text
- What was missing: free text
- Time saved vs manual: estimate in minutes

### 4.3 Session-End Survey (manual, at end of each day)
- Tasks attempted today: count
- Tasks completed successfully: count
- Tasks that required significant intervention: count
- Most useful task: free text
- Most frustrating experience: free text
- Bugs encountered: count + descriptions
- Feature requests: free text
- Overall experience: 1-5 stars
- Would recommend to colleague: yes/no/maybe

## 5. Bug Report Format

```
BUG REPORT
==========
Date: <ISO date>
Reporter: <name>
Task: <what were you trying to do>
Expected: <what you expected to happen>
Actual: <what actually happened>
Severity: [P0-crash | P1-blocking | P2-degraded | P3-minor]
Reproducibility: [always | sometimes | once]
Telemetry session ID: <from Mission Control>
Steps to reproduce:
  1. ...
  2. ...
  3. ...
Output/截图: <attach if relevant>
```

## 6. Feedback Channels

### 6.1 Daily
- Per-task feedback form (inline after each task)
- Bug reports → #agentos-bugs channel
- Quick observations → #agentos-dogfooding channel

### 6.2 Weekly
- Friday retrospective: 30-minute team meeting
- Review aggregated telemetry from TelemetryCollector
- Share top 3 friction points
- Share top 3 wins
- Prioritize fixes for next week

### 6.3 Program-End
- Comprehensive dogfooding report compiled from all telemetry and feedback
- Comparison: productivity with AgentOS vs without (estimated)
- Top 10 bugs found and fixed
- Top 10 friction points remaining
- Recommendation: ready for External Alpha? yes/no/conditional

## 7. Success Criteria for Internal Dogfooding

The internal dogfooding program is successful when:

1. **Usage volume**: At least 100 real tasks attempted across the team
2. **Task diversity**: At least 5 of the 7 scenario categories exercised
3. **Completion rate**: ≥70% of attempted tasks completed without blocking failures
4. **User retention**: ≥80% of participants continue using AgentOS voluntarily after week 1
5. **Bug discovery**: At least 20 bugs found and triaged
6. **Telemetry completeness**: 100% of tasks have full telemetry + user feedback
7. **Friction reduction**: Measurable improvement in task success rate from week 1 to week 2-4
8. **Mission Control**: Operational console used daily by at least 50% of participants

## 8. Escalation Criteria

Pause external alpha plans and focus on fixes if:

- Any P0 crash that causes data loss
- Constitutional invariant violations in production usage
- Security check bypass discovered
- Task success rate below 50% after week 1
- User retention below 50% after week 1

## 9. Anti-Temptation Rules

During dogfooding, the team must NOT:

1. Add new platform capabilities (architecture freeze in effect)
2. Implement the Reputation Engine or Agent Economy
3. Refactor subsystem architecture
4. Add new constitutional invariants
5. Change the public API surface of any frozen package
6. Skip telemetry collection for any task
7. Count synthetic benchmarks as dogfooding tasks
8. Suppress or ignore negative feedback

## 10. Weekly Telemetry Review Template

```
WEEK N TELEMETRY REVIEW
========================
Week of: <date range>
Participants: <count>

Task Summary:
  Total tasks attempted:    ___
  Completed successfully:   ___ (___%)
  Required intervention:    ___ (___%)
  Failed:                   ___ (___%)
  Timed out:                ___ (___%)

Category Breakdown:
  Engineering:    ___/___ (___%)
  Research:       ___/___ (___%)
  Planning:       ___/___ (___%)
  Documentation:  ___/___ (___%)
  Browser:        ___/___ (___%)
  File mgmt:      ___/___ (___%)
  Multi-step:     ___/___ (___%)

Resource Consumption:
  Total RU: ___  MU: ___  EU: ___  VU: ___

Top Capabilities Used:
  1. ___ (___ uses, ___% success)
  2. ___ (___ uses, ___% success)
  3. ___ (___ uses, ___% success)

Top Friction Points:
  1. ___
  2. ___
  3. ___

Top Wins:
  1. ___
  2. ___
  3. ___

Bugs Found This Week: ___
Bugs Fixed This Week: ___

User Satisfaction: ___/5 stars (average)
Would Recommend: ___% yes

Decision: [Continue | Adjust | Pause | Ready for External Alpha]
```

## 11. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial internal dogfooding program |