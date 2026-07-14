# AgentOS External Alpha Program

**Effective Date**: 2026-06-23 (program design; execution begins after internal dogfooding)
**Authority**: Chief Architect directive — product-first execution strategy
**Status**: Design complete — execution gated on internal dogfooding success
**Duration**: 4-6 weeks external usage

---

## 1. Program Objective

A controlled external alpha with 5-10 trusted technical users who replace portions of their normal workflow with AgentOS. Every execution is monitored through the benchmark and telemetry systems. The goal is to prove that real users — not engineers — can delegate meaningful objectives to AgentOS and consistently receive valuable outcomes with minimal supervision.

**The single evaluation question:**
> After using AgentOS for a month, would you voluntarily continue using it for your daily work?

## 2. User Selection

### 2.1 Target Profiles (5-10 users)

| Slot | Profession | Why This Profile | Expected Task Types |
|------|-----------|------------------|---------------------|
| 1 | Software Engineer | Tests code tasks, debugging, code review | Code review, bug investigation, test generation, refactoring |
| 2 | Research Scientist | Tests information retrieval, analysis, synthesis | Literature review, data analysis, report generation |
| 3 | Operations Manager | Tests automation, file management, reporting | Workflow automation, file organization, status reports |
| 4 | Financial Analyst | Tests data processing, spreadsheet automation, reporting | Data aggregation, financial summaries, trend analysis |
| 5 | Content Creator | Tests document generation, research, browser automation | Research, draft generation, competitive analysis |
| 6 | Business Analyst | Tests multi-step workflows, data collection, reporting | Market research, process documentation, reporting |
| 7 | DevOps Engineer | Tests automation, monitoring, configuration | Script generation, log analysis, deployment planning |
| 8 | Project Manager | Tests planning, reporting, file management | Sprint planning, risk assessment, status reports |

### 2.2 Selection Criteria
- Technical enough to install and configure AgentOS
- Willing to use AgentOS for at least 5 hours per week
- Willing to provide detailed feedback per task
- Has real work that maps to AgentOS capabilities
- Not on the AgentOS development team (external perspective)
- Signs NDA if required

### 2.3 Exclusion Criteria
- Users who only want to "try it once"
- Users unwilling to provide feedback
- Users whose work requires capabilities AgentOS doesn't have
- Users on unsupported platforms (AgentOS Alpha supports Linux/macOS)

## 3. Onboarding Process

### 3.1 Pre-Onboarding (Week 0)
- Send installation guide and system requirements
- Schedule 60-minute onboarding call
- Create user account in telemetry system
- Provide test objective: "Organize these 10 files by category and generate a summary report"

### 3.2 Onboarding Session (60 minutes)
- 10 min: What AgentOS is and what it can do
- 10 min: Installation and configuration walkthrough
- 15 min: Live demo — delegate a simple task, observe Mission Control
- 15 min: User attempts their first real task with guidance
- 10 min: Feedback collection — what was confusing, what was clear

### 3.3 First Week (Guided Usage)
- User attempts 1-2 tasks per day
- Engineering team available on Slack for questions
- Daily check-in: "What did you try? What worked? What didn't?"
- No new features — only fixes for blocking issues

### 3.4 Weeks 2-6 (Autonomous Usage)
- User works independently
- Weekly check-in: 30 minutes to review telemetry and feedback
- Bug reports via structured form
- Feature requests logged but not implemented during Alpha

## 4. Task Categories for External Alpha

### 4.1 Market Research
- "Research the top 5 competitors in [industry] and produce a comparison report"
- "Find pricing information for [product category] across 3 vendors"
- Verifiable output: structured report file with sources

### 4.2 Document Generation
- "Generate a project proposal for [project] based on these requirements"
- "Create API documentation for [codebase section]"
- Verifiable output: formatted document file

### 4.3 File Organization
- "Organize my downloads folder by file type and date"
- "Find and remove duplicate files in [directory]"
- Verifiable output: organized directory structure + summary report

### 4.4 Browser Automation
- "Check these 5 websites for [specific information] and compile results"
- "Monitor [service status page] and alert me if there are incidents"
- Verifiable output: structured data file with extracted content

### 4.5 Reporting
- "Generate a weekly summary report from my task list"
- "Create a financial overview from this transaction data"
- Verifiable output: formatted report with computed metrics

### 4.6 Multi-Step Workflows
- "Research [topic] → analyze findings → generate recommendation report"
- "Collect data from [source] → process → create formatted output"
- Verifiable output: multi-artifact workflow with intermediate and final outputs

## 5. Telemetry Collection

### 5.1 Automatic (via TelemetryCollector)
- Every task generates full telemetry (see PRODUCTION_HARDENING.md §7)
- Telemetry persists to user's local disk and is shared with engineering team
- No personal data or task content is collected — only metadata

### 5.2 Manual (via Feedback Forms)
- Per-task feedback: 30-second form after each task
- Weekly survey: 5-minute survey at end of each week
- Exit interview: 30-minute structured interview at program end

### 5.3 Per-Task Feedback Form
```
TASK FEEDBACK
=============
Task: <what you asked AgentOS to do>
Time spent setting up: ___ minutes
Time AgentOS spent working: ___ minutes
Time you would have spent manually: ___ minutes

Result quality: [1-poor] [2-below avg] [3-acceptable] [4-good] [5-excellent]
Would use again for this task: [yes] [no] [maybe]
Intervention needed: [none] [minor] [moderate] [significant] [had to redo manually]

What worked well:
  ...

What was frustrating:
  ...

What was missing:
  ...
```

### 5.4 Weekly Survey
```
WEEKLY SURVEY
=============
Week of: <date range>

Tasks attempted: ___
Tasks completed: ___
Tasks partially completed: ___
Tasks failed: ___

Overall satisfaction: [1] [2] [3] [4] [5]
Would recommend: [yes] [no] [maybe]

Most valuable task this week:
  ...

Most frustrating experience:
  ...

Biggest barrier to adoption:
  ...

Feature you wish existed:
  ...

Time saved this week (estimated): ___ hours
```

### 5.5 Exit Interview
```
EXIT INTERVIEW
==============
1. What tasks did AgentOS excel at?
2. What tasks did AgentOS struggle with?
3. What was the biggest barrier to regular usage?
4. What would make you a daily user?
5. How does AgentOS compare to your current tools?
6. What capabilities are most important to add next?
7. Would you pay for AgentOS in its current form? At what price?
8. Would you recommend AgentOS to a colleague? Why or why not?
9. What was your single best experience?
10. What was your single worst experience?
```

## 6. Success Metrics

### 6.1 Quantitative (from telemetry)
| Metric | Target | Minimum Acceptable |
|--------|--------|-------------------|
| Task completion rate | ≥80% | ≥60% |
| User retention (week 2) | ≥90% | ≥70% |
| User retention (week 4) | ≥80% | ≥50% |
| Avg tasks per user per week | ≥10 | ≥5 |
| Task success without intervention | ≥70% | ≥50% |
| Estimated time saved per task | ≥30 min | ≥10 min |
| User satisfaction (avg stars) | ≥3.5/5 | ≥2.5/5 |
| Would recommend rate | ≥70% | ≥40% |
| Bug reports per user per week | ≤3 | ≤8 |
| P0/P1 bugs per week | ≤1 | ≤3 |

### 6.2 Qualitative (from feedback)
- Users voluntarily choose AgentOS for at least one task type
- Users report AgentOS saved meaningful time on at least one task
- Users identify clear value proposition in their own words
- Users provide actionable feature requests (not just "make it better")
- No user reports data loss, security concern, or trust violation

## 7. Engineering Focus During External Alpha

### 7.1 Allowed Work
- Bug fixes (P0/P1 prioritized)
- Error message improvements
- Documentation updates based on user confusion
- Configuration simplification
- Onboarding material refinement
- Performance optimization for observed hot paths
- Recovery mechanism improvements for observed failure modes

### 7.2 Prohibited Work
- New platform capabilities (architecture freeze)
- Reputation Engine implementation
- Agent Economy implementation
- New constitutional invariants
- API surface changes on frozen packages
- Any change that could destabilize the Alpha build

### 7.3 Feature Request Triage
Every feature request is evaluated against:
1. Does it address a friction point reported by multiple users?
2. Does it unblock a task category that multiple users attempted?
3. Can it be implemented without changing frozen package APIs?
4. Can it be shipped within the Alpha timeframe?

If all four are yes → implement. Otherwise → log for Beta consideration.

## 8. Communication Plan

### 8.1 With Alpha Users
- Slack channel: #agentos-alpha-users
- Weekly office hours: 30 minutes, engineering team available
- Status page: AgentOS Alpha status, known issues, planned fixes
- Response time: P0 bugs within 4 hours, P1 within 24 hours, P2 within 72 hours

### 8.2 Internal
- Daily standup includes Alpha user status
- Weekly review of telemetry trends
- Bi-weekly Alpha status report to stakeholders

## 9. Graduation Criteria

The External Alpha is ready to graduate to Beta when ALL of the following are true:

1. All 5-10 users have completed at least 4 weeks of usage
2. Task completion rate ≥70% for 2 consecutive weeks
3. User retention ≥70% at week 4
4. User satisfaction ≥3.0/5 average for 2 consecutive weeks
5. Zero unresolved P0 bugs
6. Zero unresolved P1 bugs that affect >50% of users
7. At least 500 real tasks have been executed with full telemetry
8. Telemetry demonstrates measurable time savings (avg ≥15 min per task)
9. At least 3 users voluntarily report they would continue using AgentOS
10. Engineering team confidence vote: ≥80% agree platform is Beta-ready

## 10. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial external alpha program design |