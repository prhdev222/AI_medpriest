# Software Requirements Specification (SRS)

## MedPriest Analytics AI

### Enterprise Privacy-First Architecture

Version 3.0 (Full Specification)

------------------------------------------------------------------------

# 1. Executive Summary

MedPriest Analytics AI is a secure, read-only hospital analytics
platform built on Cloudflare infrastructure. It analyzes operational
data (IPD, discharge, delay discharge, LOS, OPD, procedures) stored in
Cloudflare D1 and provides AI-assisted insights using OpenRouter.

The system strictly enforces:

-   No access to HN (Hospital Number)
-   No exposure of row-level patient data
-   Aggregated analytics only
-   Privacy-by-design architecture
-   PDPA-aligned data governance

------------------------------------------------------------------------

# 2. Regulatory & Compliance Framework

## 2.1 Legal Alignment (Thailand PDPA)

This system follows:

-   Data Minimization
-   Purpose Limitation
-   Access Control
-   Logging & Accountability
-   Secure Processing

No personal health identifiers are processed in AI workflows.

------------------------------------------------------------------------

# 3. System Objectives

1.  Provide real-time ward-level operational analytics
2.  Enable AI-assisted interpretation of KPIs
3.  Maintain strict separation between PHI and analytics
4.  Provide executive-level dashboard insights
5.  Ensure read-only enforcement
6.  Support scalable deployment

------------------------------------------------------------------------

# 4. System Architecture

## 4.1 Logical Architecture

User Browser ↓ Cloudflare Pages (Frontend) ↓ Pages Functions (Policy
Layer) ↓ Cloudflare D1 (Analytics Tables Only) ↓ OpenRouter API (AI
Explanation)

Raw Tables (Restricted): - ipd_stays (contains hn) - discharge_plans
(contains hn)

Analytics Tables (Accessible): - ipd_daily_summary -
discharge_delay_daily - opd_daily_summary - procedure_daily_summary

------------------------------------------------------------------------

# 5. Data Flow Diagram (DFD)

Level 0:

\[User\] → \[Analytics API\] → \[D1 Summary Tables\] → \[OpenRouter AI\]

Level 1:

1.  User submits question
2.  API validates JWT
3.  API fetches aggregated metrics
4.  Aggregated JSON sent to AI
5.  AI response streamed to user

No PHI flows to AI.

------------------------------------------------------------------------

# 6. Entity Relationship Model (ERD)

Raw Layer (Restricted)

ipd_stays - id (PK) - hn - ward - admit_date - discharge_date - los

discharge_plans - ipd_stay (FK) - hn - ward - delay_days

Analytics Layer (Accessible)

ipd_daily_summary - date (PK) - ward (PK) - admissions - discharges -
avg_los

discharge_delay_daily - date (PK) - ward (PK) - delayed_cases -
mean_delay_days

------------------------------------------------------------------------

# 7. Functional Requirements

## FR-1 Read-Only Enforcement

-   No data mutation allowed
-   No dynamic SQL
-   Only predefined prepared statements

## FR-2 Metrics Endpoints

GET /api/metrics/ipd-daily GET /api/metrics/discharge-delay GET
/api/metrics/opd-daily GET /api/metrics/procedure

All endpoints return aggregated JSON only.

## FR-3 Small Cell Suppression

If count \< 5: - Replace with "\<5" - Or aggregate into broader category

## FR-4 AI Q&A Endpoint

POST /api/chat

Flow: 1. Intent classification 2. Fetch metrics 3. Provide JSON context
4. AI generates explanation

AI Restrictions: - Cannot request HN - Cannot access raw tables - Must
refuse identifiable queries

## FR-5 Authentication & RBAC

-   JWT-based authentication
-   Ward-based access control
-   Audit logging

------------------------------------------------------------------------

# 8. Security Architecture

## 8.1 Controls

-   D1 binding restricted to Pages Functions
-   No direct frontend DB access
-   Secrets stored securely
-   Rate limiting enabled
-   Logging enabled

## 8.2 Threat Model

  Threat                Mitigation
  --------------------- ---------------------
  SQL Injection         Prepared statements
  PHI Leakage           No raw access
  Re-identification     Suppression rule
  AI Hallucination      Restricted prompt
  Unauthorized Access   JWT + RBAC

------------------------------------------------------------------------

# 9. Non-Functional Requirements

## Performance

-   \< 500ms metric query typical
-   AI streaming supported

## Availability

-   System works in metrics-only mode if AI fails

## Scalability

-   100+ concurrent users supported

## Reliability

-   Daily summary refresh job monitored

------------------------------------------------------------------------

# 10. Deployment Architecture

## 10.1 Cloudflare Pages (Recommended)

Steps:

1.  Create Git repository
2.  Connect to Cloudflare Pages
3.  Implement Pages Functions:
    -   /api/metrics/\*
    -   /api/chat
4.  Bind D1 database
5.  Configure Secrets:
    -   OPENROUTER_API_KEY
    -   JWT_SECRET
6.  Deploy to production

------------------------------------------------------------------------

# 11. DevOps & Monitoring

-   Git-based CI/CD
-   Deployment via Cloudflare Pages
-   Log monitoring
-   API usage monitoring
-   AI usage tracking

------------------------------------------------------------------------

# 12. Disaster Recovery

-   Daily D1 backup
-   Version-controlled schema
-   Rollback support via Git

------------------------------------------------------------------------

# 13. Future Roadmap

-   KPI scorecard automation
-   CMI computation module
-   Executive PDF export
-   Predictive analytics model
-   RAG integration for policy documents
-   Role-based dashboard customization

------------------------------------------------------------------------

# 14. Conclusion

MedPriest Analytics AI provides a secure, privacy-preserving analytics
platform for hospital operational intelligence while maintaining strict
regulatory alignment and AI governance controls.

------------------------------------------------------------------------

# End of Document
