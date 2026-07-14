# AgentOS Beta Transition Criteria

**Effective Date**: 2026-06-23 (criteria definition; execution gated on Alpha completion)
**Authority**: Chief Architect directive
**Status**: Design complete — graduation assessed after External Alpha

---

## 1. Alpha to Beta Transition

AgentOS transitions from Alpha to Beta only when the platform has demonstrated stable production behavior with real users performing real work. The transition is not triggered by a date or a feature list — it is triggered by evidence.

## 2. Graduation Criteria

ALL of the following must be true for at least 2 consecutive weeks before Beta transition:

### 2.1 User Metrics
- [ ] External Alpha has run for at least 4 weeks with 5+ active users
- [ ] User retention ≥70% at week 4
- [ ] Task completion rate ≥75% (averaged over 2 weeks)
- [ ] User satisfaction ≥3.5/5 stars (averaged over 2 weeks)
- [ ] Would-recommend rate ≥60%
- [ ] At least 3 users voluntarily report wanting to continue

### 2.2 Reliability Metrics
- [ ] Zero unresolved P0 bugs
- [ ] Zero unresolved P1 bugs affecting >50% of users
- [ ] Task success without intervention ≥65%
- [ ] Constitutional invariant violations: 0
- [ ] Recovery success rate for injected failures ≥90%
- [ ] No data loss incidents

### 2.3 Telemetry Volume
- [ ] At least 500 real tasks executed with full telemetry
- [ ] At least 5 task categories exercised with ≥20 tasks each
- [ ] Telemetry covers ONLINE, OFFLINE, and HYBRID mode usage
- [ ] At least 10 distinct capabilities used across all tasks

### 2.4 Engineering Readiness
- [ ] All P0 items from ALPHA_RELEASE_CANDIDATE.md completed
- [ ] All P1 items completed or documented as known limitations
- [ ] Test suite: 100% pass, no flaky tests
- [ ] 100-benchmark suite: all 4 Alpha criteria pass
- [ ] Real-world task suite: all tasks pass
- [ ] Per-package READMEs: all 15 complete
- [ ] Installation guide: validated by at least 2 external users
- [ ] CI/CD pipeline: automated builds and releases working
- [ ] Engineering team confidence vote: ≥80% agree Beta-ready

## 3. Beta Phase Objectives

Once Alpha graduates to Beta, the focus shifts from proving the technology to scaling adoption:

### 3.1 Scale
- Expand from 5-10 alpha users to 50-100 beta users
- Support concurrent multi-user sessions
- Add cloud sync and multi-device support
- Performance optimization for larger workloads

### 3.2 Ecosystem
- Plugin/marketplace architecture (if telemetry supports it)
- Third-party capability providers
- Community-contributed task templates
- Integration with popular tools (Slack, GitHub, Jira, etc.)

### 3.3 Enterprise
- Multi-tenant workspace management
- Role-based access control
- Audit log export for compliance
- SSO integration
- On-premise deployment option

### 3.4 Commercial
- Pricing model based on observed resource consumption patterns
- Free tier + paid tiers
- Usage-based billing (RU/MU/EU/VU as currency)
- Enterprise licensing

### 3.5 Intelligence (Post-Alpha)
- Reputation Engine implementation (calibrated from Alpha telemetry)
- Agent Economy (pricing, compensation, budget allocation)
- Adaptive scheduling policies
- Model routing optimization based on observed performance
- Learning from user feedback to improve task outcomes

## 4. Anti-Graduation Conditions

Beta transition is BLOCKED if any of the following are true:

- Any P0 bug is unresolved
- User retention drops below 50% at any point
- Task completion rate drops below 50% for 2 consecutive weeks
- Any security incident (data leak, permission bypass, injection)
- Any constitutional invariant violation in production
- Engineering team confidence vote <60%
- Insufficient telemetry (fewer than 300 real tasks)
- No voluntary user retention (all users are paid or incentivized to stay)

## 5. Decision Process

1. Engineering lead compiles Alpha metrics report
2. Stakeholder review meeting (engineering, product, business)
3. Criteria checklist verified against telemetry data
4. Confidence vote (engineering team, simple majority)
5. If ALL criteria met and vote passes → declare Beta
6. If ANY criteria not met → extend Alpha, identify gaps, fix
7. Beta declaration includes: public announcement, updated docs, new onboarding

## 6. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial Beta transition criteria |