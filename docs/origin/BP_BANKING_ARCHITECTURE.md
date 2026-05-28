# Solution Architecture — BP Internet Banking

**C4 Design · Internet Banking System**

> Document following the C4 model (Context → Container → Component) with architectural justifications per exercise requirements.

---

## 1. Executive Summary

BP requires an internet banking system for account viewing, own and interbank transfers, and real-time notifications. The proposed solution is a **microservices architecture on AWS** with two front-end channels (SPA + Mobile App), OAuth 2.0 + PKCE authentication, biometric onboarding, a centralized integration layer, append-only audit logging, and multi-region high availability.

---

## 2. Context Diagram (C4 — Level 1)

> For non-technical audiences. Shows BP Internet Banking and its relationships with users and external systems.

```mermaid
%%{init: {"layout": "elk"}}%%
C4Context
  title Context — BP Internet Banking

  Person(customer, "Banking Customer", "Views accounts, transfers and payments")
  Person(admin, "Administrator", "Monitors and manages the system")

  System(bp, "BP Internet Banking", "SPA + Mobile App: accounts, transfers and notifications")

  System_Ext(core, "Core Banking", "Customer data, accounts and transactions")
  System_Ext(idp, "Identity Provider", "OAuth 2.0 — authentication")
  System_Ext(aws_svc, "AWS Services", "Email (SES) · SMS (SNS) · Biometrics (Rekognition)")
  System_Ext(payments, "Payment Network", "ACH / SWIFT — interbank transfers")

  Rel(customer, bp, "Uses", "HTTPS")
  Rel(admin, bp, "Manages", "HTTPS")
  Rel(bp, core, "Account data")
  Rel(bp, idp, "Authentication")
  Rel(bp, aws_svc, "Notifications & biometrics")
  Rel(bp, payments, "Transfers")
```

### Actors and External Systems

| Actor / System | Type | Role |
|---|---|---|
| Banking Customer | Person | Retail user — accounts, history, transfers |
| Operations Administrator | Person | Internal staff — monitoring and alerts |
| Core Banking Platform | External system | Primary source: customers, transactions, products, profile |
| Identity Provider (OAuth 2.0) | External system | Issues and validates tokens |
| AWS Services (SES · SNS · Rekognition) | External system | Email alerts, SMS/OTP, facial verification |
| ACH/SWIFT Payment Network | External system | Interbank transfer execution |

---

## 3. Container Diagram (C4 — Level 2)

> For technical audiences. Shows applications, services, databases and messaging with technologies and protocols.

```mermaid
%%{init: {"layout": "elk"}}%%
C4Container
  title Containers — BP Internet Banking

  Person(customer, "Customer")

  System_Ext(core, "Core Banking")
  System_Ext(idp, "Identity Provider")
  System_Ext(payments, "Payment Network")

  System_Boundary(bp, "BP Internet Banking") {
    Container(spa, "Web SPA", "React + TypeScript", "Browser banking interface")
    Container(mobile, "Mobile App", "Flutter", "iOS/Android — biometrics and operations")
    Container(api_gw, "API Gateway", "AWS API Gateway", "Auth, rate limiting, routing")
    Container(auth, "Auth Service", "Keycloak", "OAuth 2.0 + PKCE — tokens and sessions")
    Container(account, "Account Service", "Spring Boot", "Accounts and transactions — Cache-Aside")
    Container(transfer, "Transfer Service", "Spring Boot", "Transfers — Circuit Breaker")
    Container(events, "Event Bus", "AWS EventBridge", "Async events and audit")
    Container(cache, "Cache", "Redis ElastiCache", "Cache-Aside — TTL per data type")
    ContainerDb(db, "Operational DB", "Aurora PostgreSQL", "ACID, Multi-AZ")
    ContainerDb(audit_db, "Audit DB", "DynamoDB", "Append-only — immutable via IAM")
  }

  Rel(customer, spa, "Uses", "HTTPS")
  Rel(customer, mobile, "Uses", "HTTPS")
  Rel(spa, api_gw, "API calls", "HTTPS")
  Rel(mobile, api_gw, "API calls", "HTTPS")
  Rel(api_gw, auth, "Validates token")
  Rel(api_gw, account, "Routes")
  Rel(api_gw, transfer, "Routes")
  Rel(auth, idp, "OAuth 2.0 / OIDC")
  Rel(account, cache, "Cache-Aside")
  Rel(account, db, "SQL")
  Rel(account, core, "Account data")
  Rel(transfer, db, "Persists")
  Rel(transfer, payments, "ACH / SWIFT")
  Rel(transfer, events, "Publishes event")
  Rel(events, audit_db, "Append-only audit")
```

---

## 4. Component Diagrams (C4 — Level 3)

### 4.1 Transfer Service — Components

> Critical service: handles own and interbank transfers with Circuit Breaker fault tolerance.

```mermaid
C4Component
  title Components — Transfer Service

  Container_Boundary(transfer_svc, "Transfer Service (Spring Boot)") {
    Component(ctrl, "TransferController", "REST", "Exposes /transfers/own and /interbank")
    Component(validator, "TransferValidator", "Business Logic", "Limits, balance and anti-fraud")
    Component(handler, "TransferHandler", "Service", "Transfers with retries")
    Component(circuit_breaker, "CircuitBreaker", "Resilience4j", "CLOSED / OPEN / HALF-OPEN")
    Component(transfer_repo, "TransferRepository", "JPA", "Persists transfers")
    Component(event_publisher, "EventPublisher", "Messaging", "TransferCompleted / TransferFailed")
  }

  ContainerDb(ops_db, "Aurora PostgreSQL")
  Container(event_bus, "AWS EventBridge")
  System_Ext(core, "Core Banking")
  System_Ext(payments, "Payment Network")

  Rel(ctrl, validator, "Validates")
  Rel(validator, core, "Checks balance")
  Rel(validator, handler, "Executes")
  Rel(handler, circuit_breaker, "Protected call")
  Rel(circuit_breaker, payments, "ACH / SWIFT")
  Rel(handler, transfer_repo, "Persists")
  Rel(transfer_repo, ops_db, "SQL")
  Rel(handler, event_publisher, "Emits")
  Rel(event_publisher, event_bus, "Publishes")
```

### 4.2 Auth Service — Components (Keycloak + PKCE)

```mermaid
C4Component
  title Components — Auth Service (OAuth 2.0 + PKCE)

  Container_Boundary(auth_svc, "Auth Service (Keycloak)") {
    Component(auth_endpoint, "Authorization Endpoint", "OAuth 2.0", "Initiates PKCE flow")
    Component(token_endpoint, "Token Endpoint", "OAuth 2.0", "Issues JWT tokens")
    Component(mfa_provider, "MFA Provider", "Keycloak Plugin", "OTP / fingerprint / facial")
    Component(session_manager, "Session Manager", "Keycloak", "Sessions and refresh tokens")
    ComponentDb(user_store, "User Store", "PostgreSQL", "Credentials, roles and attributes")
  }

  Container(spa, "Web SPA")
  Container(mobile, "Mobile App")
  System_Ext(idp_ext, "Corporate Identity Provider")

  Rel(spa, auth_endpoint, "Login PKCE", "HTTPS")
  Rel(mobile, auth_endpoint, "Login PKCE", "HTTPS")
  Rel(auth_endpoint, mfa_provider, "2nd factor")
  Rel(auth_endpoint, token_endpoint, "Authorizes code")
  Rel(token_endpoint, session_manager, "Creates session")
  Rel(session_manager, user_store, "Reads / writes")
  Rel(auth_endpoint, idp_ext, "SAML/OIDC Federation")
```

### 4.3 Account Service — Components (Cache-Aside)

```mermaid
C4Component
  title Components — Account Service (Cache-Aside)

  Container_Boundary(account_svc, "Account Service (Spring Boot)") {
    Component(account_ctrl, "AccountController", "REST", "GET /accounts and /movements")
    Component(account_service, "AccountService", "Business Logic", "Orchestrates data and cache")
    Component(cache_manager, "CacheManager", "Cache-Aside", "Redis first — miss queries source")
    Component(account_repo, "AccountRepository", "JPA", "Operational data")
    Component(integration_client, "IntegrationClient", "Feign HTTP", "Core Banking adapter")
  }

  ContainerDb(ops_db, "Aurora PostgreSQL")
  Container(cache, "Redis ElastiCache")
  System_Ext(core, "Core Banking")

  Rel(account_ctrl, account_service, "Delegates")
  Rel(account_service, cache_manager, "Requests")
  Rel(cache_manager, cache, "Reads / writes")
  Rel(cache_manager, integration_client, "Cache miss")
  Rel(integration_client, core, "Account data")
  Rel(account_service, account_repo, "CRUD")
  Rel(account_repo, ops_db, "SQL")
```

---

## 5. Authentication Architecture — OAuth 2.0 + PKCE

### Recommended Flow: Authorization Code Flow + PKCE

**Why Authorization Code + PKCE and not Implicit Flow?**

| Criterion | Implicit Flow | Authorization Code + PKCE |
|---|---|---|
| Token exposure | Access token in URL (insecure) | Only temporary code in URL |
| Mobile security | Not recommended (RFC 8252) | Recommended standard |
| Refresh token | Not supported | Yes, with rotation |
| Standard status | **Deprecated (OAuth 2.1)** | **Actively recommended** |

**Justification 1:** RFC 9700 / OAuth 2.1 removes Implicit Flow due to token leakage risk in URLs and logs. Authorization Code + PKCE mitigates this without requiring a `client_secret` in public apps.

**Justification 2:** RFC 8252 requires PKCE for mobile apps because they cannot securely store secrets. PKCE uses a device-generated `code_verifier`, making an intercepted authorization code useless.

```mermaid
flowchart LR
    A[App: verifier\n+ challenge] --> B[GET /authorize\nlogin + MFA]
    B --> C[POST /token\n+ verifier]
    C --> D{SHA-256\nmatch?}
    D -- Yes --> E[access_token\nrefresh_token]
    D -- No --> F[403]
```

### Post-Onboarding Authentication Methods

| Method | Platform | Implementation |
|---|---|---|
| Username + password | Web + Mobile | Native Keycloak |
| Fingerprint | Mobile | Flutter LocalAuth + FIDO2 / WebAuthn |
| OTP via email/SMS | Web + Mobile | Keycloak OTP plugin |
| Facial recognition | Mobile | AWS Rekognition + Keycloak plugin |

---

## 6. Onboarding Architecture — Facial Recognition

```mermaid
flowchart TD
    A[Customer registers data] --> B[Captures selfie\nAWS Rekognition]
    B --> C{Verification OK?}
    C -- No --> D[Reject / retry]
    C -- Yes --> E[Create Keycloak user\nSend credentials via SES]
```

**Recommended tool:** AWS Rekognition — managed service, 99.9% SLA, no internal ML team required. Evaluated alternative: Azure Face API (similar capability, but BP already operates on AWS).

**Justification 1:** Using a managed service reduces time-to-market and eliminates model training complexity. Rekognition has >99.5% accuracy for 1:1 verification.

**Justification 2:** Separating Onboarding as an independent microservice allows scaling registration without affecting transactional service availability.

---

## 7. Cache Pattern — Cache-Aside

**Chosen pattern:** Cache-Aside (Lazy Loading)

**Justification 1:** Cache-Aside gives explicit control over what is cached. For sensitive banking data (balances, movements), selective invalidation is critical. Write-Through caches all writes including data that may never be read.

**Justification 2:** Core Banking is an external system we do not control. Cache-Aside is the only applicable pattern when the data source is a legacy external system with no native write-through support.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart LR
    A[Request] --> B{In Redis?}
    B -- Hit --> C[Return from cache\n< 1ms]
    B -- Miss --> D[Query Core Banking]
    D --> E[Write to Redis\nwith TTL]
    E --> F[Return data]
```

| Cached data | TTL | Reason |
|---|---|---|
| Customer profile | 15 min | Changes infrequently |
| Products / accounts | 5 min | May change due to new contracts |
| Recent movements | 2 min | High change frequency |
| Session token | Token duration | Fast validation without DB hit |

---

## 8. Integration Layer — API Gateway + Adapters

```mermaid
C4Component
  title Integration Layer — API Gateway and Adapters

  Component(api_gw, "API Gateway", "AWS API Gateway", "Auth, rate limiting, routing")

  Container_Boundary(services, "Microservices") {
    Component(account, "Account Service", "Spring Boot", "Accounts and transactions")
    Component(transfer, "Transfer Service", "Spring Boot", "Transfers")
  }

  Container_Boundary(integration, "Integration Layer") {
    Component(core_adapter, "Core Banking Adapter", "Feign HTTP", "Data and transactions")
    Component(detail_adapter, "Client Detail Adapter", "Feign HTTP", "Enriched profile")
  }

  System_Ext(core, "Core Banking Platform")
  System_Ext(detail, "Detail System")

  Rel(api_gw, account, "Routes")
  Rel(api_gw, transfer, "Routes")
  Rel(account, core_adapter, "Queries data")
  Rel(account, detail_adapter, "Detailed profile")
  Rel(transfer, core_adapter, "Checks balance")
  Rel(core_adapter, core, "REST")
  Rel(detail_adapter, detail, "REST")
```

**Justification 1:** The API Gateway centralizes authentication, rate limiting and logging. Without it, each microservice would need to implement these cross-cutting concerns, violating DRY.

**Justification 2:** The Integration Layer with adapters per external system (Adapter Pattern) isolates legacy contracts. If Core Banking changes its API, only the adapter is updated, not the business services.

### Defined Services

| Service | Endpoint | Source |
|---|---|---|
| Basic data | `GET /accounts/{id}` | Core Banking |
| Movements | `GET /accounts/{id}/movements` | Core Banking |
| Own transfer | `POST /transfers/own` | Internal + Core |
| Interbank transfer | `POST /transfers/interbank` | Core + Payment Network |
| Customer detail | `GET /clients/{id}/profile` | Detail System |
| Notifications | `POST /notifications` (async) | EventBridge |

---

## 9. Notification Architecture

**Channel 1 — Email (AWS SES):** Transaction alerts, transfer confirmations, password recovery.

**Channel 2 — SMS (AWS SNS):** OTP for MFA, security alerts, critical confirmations.

**Pattern:** Event-Driven. Services publish events to EventBridge. The Notification Service subscribes and dispatches to the appropriate channel based on customer preferences.

**Justification:** Decoupling via EventBridge avoids direct dependency between Transfer Service and Notification Service. Using AWS SES + SNS as managed services guarantees 99.9% SLA and complies with financial communication regulations.

---

## 10. Audit Architecture

**Database:** AWS DynamoDB (append-only, no UPDATE or DELETE)

**Justification 1:** DynamoDB with IAM policy denying UpdateItem and DeleteItem guarantees audit record immutability, complying with SOX and banking regulations.

**Justification 2:** DynamoDB scales limitlessly, supports native TTL for automatic archival, and encrypts at rest by default — essential for long-term regulatory logs.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart LR
    T[Customer action] --> EB[AWS EventBridge]
    EB --> AS[Audit Service]
    AS --> DDB[(DynamoDB\nAudit Table)]
    DDB --> S3[(S3 Archive\nTTL)]
```

**Audit record schema:**

| Field | Type | Description |
|---|---|---|
| `auditId` | String (PK) | UUID v4 |
| `clientId` | String (SK) | Customer ID |
| `timestamp` | ISO 8601 | UTC date and time |
| `action` | String | LOGIN, TRANSFER, QUERY… |
| `sourceIP` | String | Source IP |
| `channel` | String | WEB / MOBILE |
| `result` | String | SUCCESS / FAILURE |

---

## 11. Cloud Infrastructure — AWS

```mermaid
%%{init: {"layout": "elk"}}%%
C4Container
  title AWS Infrastructure — BP Internet Banking

  Person(user, "Customer / Admin")

  System_Boundary(aws, "AWS — us-east-1") {
    Container(cdn, "CloudFront", "AWS CloudFront", "Global CDN — SPA and static assets")
    Container(alb, "Load Balancer", "AWS ALB Multi-AZ", "Traffic distribution")
    Container(eks, "EKS Cluster", "Kubernetes", "Microservices across 2 availability zones")
    Container(events, "Event Bus", "AWS EventBridge + SQS", "Async events with DLQ")
    ContainerDb(aurora, "Operational DB", "Aurora PostgreSQL", "Multi-AZ, failover < 30s")
    ContainerDb(redis, "Cache", "ElastiCache Redis", "Cache-Aside, Multi-AZ")
    ContainerDb(dynamo, "Audit DB", "DynamoDB", "Append-only, Global Tables")
  }

  Rel(user, cdn, "HTTPS")
  Rel(cdn, alb, "HTTPS")
  Rel(alb, eks, "Distributes traffic")
  Rel(eks, aurora, "SQL")
  Rel(eks, redis, "Cache")
  Rel(eks, dynamo, "Audit")
  Rel(eks, events, "Publishes events")
```

### AWS Services Used

| Service | Use | Justification |
|---|---|---|
| EKS (Kubernetes) | Microservice orchestration | Portability, auto-healing, HPA |
| Aurora PostgreSQL | Operational database | ACID, Multi-AZ, automatic failover < 30s |
| DynamoDB | Append-only audit | Unlimited scale, immutability via IAM, native TTL |
| ElastiCache Redis | Cache-Aside | Sub-millisecond latency, Multi-AZ |
| API Gateway | Entry gateway | Rate limiting, JWT validation, WAF |
| EventBridge + SQS | Event bus + DLQ | Decoupling, retries, fault tolerance |
| CloudFront | CDN for SPA | Low global latency, asset caching |
| Rekognition / SES / SNS | Biometrics + notifications | Managed services, 99.9% SLA |
| WAF + Shield | Perimeter security | DDoS protection, OWASP Top 10 |
| CloudWatch + X-Ray | Observability | Metrics, logs, distributed tracing |
| Secrets Manager | Secret management | Automatic rotation, no hardcoding |

---

## 12. High Availability, Fault Tolerance and Disaster Recovery

### High Availability

- **Multi-AZ:** All services deployed across minimum 2 availability zones
- **Auto Scaling:** Kubernetes HPA adjusts replicas based on CPU/RPS
- **Circuit Breaker:** Resilience4j prevents failure cascade to external systems
- **Aurora Multi-AZ:** Automatic failover in < 30 seconds

### Fault Tolerance

- **SQS Dead Letter Queue:** Failed events after 3 retries go to DLQ
- **Idempotency Keys:** Transfers include `idempotencyKey` to prevent duplicates
- **Graceful Degradation:** If Detail System fails, Account Service returns Core data
- **Timeout + Retry:** Exponential backoff on all HTTP clients

### Disaster Recovery

| RTO | RPO | Strategy |
|---|---|---|
| < 1 hour | < 5 min | Aurora Global Database — replica in secondary region |
| < 4 hours | < 1 hour | DynamoDB Global Tables replicated in us-west-2 |
| < 15 min | 0 (events) | EventBridge replay of archived events |

---

## 13. Security

| Layer | Control | Technology |
|---|---|---|
| Perimeter | DDoS, OWASP Top 10 | AWS WAF + Shield Advanced |
| Transport | Encryption in transit | TLS 1.3 on all channels |
| Authentication | JWT + PKCE + MFA | Keycloak |
| Authorization | RBAC by role and channel | Spring Security |
| Data at rest | AES-256 | AWS KMS on Aurora, DynamoDB, S3 |
| Secrets | No hardcoding | AWS Secrets Manager with rotation |
| Containers | Image scanning | Amazon ECR Image Scanning |

### Regulatory Compliance

| Regulation | Application |
|---|---|
| PCI DSS v4 | Card data — encryption, logging, network segmentation |
| SOX | Immutable audit trail, financial access controls |
| PSD2 / Open Banking | Strong Customer Authentication (SCA) — mandatory 2FA |
| Data Protection Law | Consent, right to erasure, data minimization |
| ISO 27001 | ISMS — security policies, risk management |

---

## 14. Monitoring and Operational Excellence

| Pillar | Tool | What it measures |
|---|---|---|
| Metrics | CloudWatch + Prometheus | CPU, memory, RPS, p95/p99 latency |
| Logs | CloudWatch Logs | Request traces, errors, audit |
| Traces | AWS X-Ray | Distributed tracing across microservices |
| Alerts | CloudWatch Alarms | Anomalies, errors, SLA breach |
| Dashboards | Grafana | Unified system health view |

### Production KPIs

| Metric | Target |
|---|---|
| Availability | 99.95% monthly |
| p95 latency (queries) | < 300ms |
| p95 latency (transfers) | < 2 seconds |
| Error rate | < 0.1% |
| Aurora failover | < 30 seconds |

---

## 15. Architectural Decisions (ADR)

| # | Decision | Chosen | Alternative | Justification |
|---|---|---|---|---|
| 1 | Architecture | Microservices | Monolith | Independent scalability per service |
| 2 | Orchestration | EKS (Kubernetes) | ECS Fargate | Portability, HPA, native self-healing |
| 3 | Operational DB | Aurora PostgreSQL | RDS MySQL | ACID, failover < 30s, read replicas |
| 4 | Audit DB | DynamoDB | PostgreSQL | Unlimited scale, immutability via IAM |
| 5 | Cache | Redis (ElastiCache) | Memcached | Persistence, pub/sub for invalidation |
| 6 | Messaging | EventBridge | Kafka | Less overhead, native AWS, declarative routing |
| 7 | Auth flow | Authorization Code + PKCE | Implicit Flow | RFC 8252 / OAuth 2.1 — standard for public apps |
| 8 | IdP | Keycloak | Custom | Existing corporate product, OAuth 2.0 / OIDC |
| 9 | Biometrics | AWS Rekognition | Azure Face API | BP on AWS — lower latency, no cross-cloud egress |
| 10 | Mobile | Flutter | React Native | Single codebase, native biometric API |
| 11 | SPA | React + TypeScript | Angular | Flexibility, TypeScript type safety |
| 12 | Cache pattern | Cache-Aside | Write-Through | External Core Banking; explicit invalidation control |
| 13 | Notifications | EventBridge + SES + SNS | Twilio | Native AWS, 99.9% SLA, lower cost |
| 14 | Gateway | AWS API Gateway | Kong | Less overhead, WAF integration, Lambda authorizer |

---

*Architecture designed under the C4 model — Context · Container · Component*
