# Arquitectura de Solución — BP Internet Banking

**Diseño C4 · Sistema de Banca por Internet**

> Documento elaborado siguiendo el modelo C4 (Context → Container → Component) con justificación teórica por cada decisión arquitectónica, conforme a los requisitos del ejercicio.

---

## 1. Resumen Ejecutivo

BP requiere un sistema de banca por internet que permita a sus clientes consultar movimientos, realizar transferencias propias e interbancarias, y recibir notificaciones en tiempo real. La solución propuesta es una **arquitectura de microservicios sobre AWS**, con dos canales de front-end (SPA + App Móvil), autenticación OAuth 2.0 con PKCE, onboarding biométrico, capa de integración centralizada, auditoría append-only y alta disponibilidad multi-región.

---

## 2. Diagrama de Contexto (C4 — Nivel 1)

> Para audiencias no técnicas. Muestra el sistema BP Internet Banking y sus relaciones con usuarios y sistemas externos.

```mermaid
C4Context
  title Contexto — BP Internet Banking

  Person(customer, "Cliente Bancario", "Consulta cuentas, transfiere y paga desde web o móvil")
  Person(admin, "Administrador", "Monitorea transacciones y gestiona el sistema")

  System(bp, "BP Internet Banking", "SPA + App Móvil: cuentas, transferencias y notificaciones")

  System_Ext(core, "Core Banking", "Datos de cliente y movimientos")
  System_Ext(detail, "Detalle de Cliente", "Información complementaria")
  System_Ext(idp, "Identity Provider", "OAuth 2.0 — autenticación")
  System_Ext(rekognition, "AWS Rekognition", "Reconocimiento facial")
  System_Ext(ses, "AWS SES", "Notificaciones por email")
  System_Ext(sns, "AWS SNS", "Notificaciones por SMS")
  System_Ext(payments, "Red de Pagos", "ACH / SWIFT")

  Rel(customer, bp, "Usa", "HTTPS")
  Rel(admin, bp, "Administra", "HTTPS")
  Rel(bp, core, "Datos y movimientos")
  Rel(bp, detail, "Perfil detallado")
  Rel(bp, idp, "Autenticación")
  Rel(bp, rekognition, "Biometría")
  Rel(bp, ses, "Email")
  Rel(bp, sns, "SMS")
  Rel(bp, payments, "Transferencias")
```

### Actores y Sistemas Externos

| Actor / Sistema | Tipo | Rol |
|---|---|---|
| Cliente Bancario | Persona | Usuario retail — accede a cuentas, historial, transferencias |
| Administrador de Operaciones | Persona | Staff interno — monitoreo, configuración, alertas |
| Core Banking Platform | Sistema externo | Fuente principal de datos: cliente, movimientos, productos |
| Sistema de Detalle de Cliente | Sistema externo | Información complementaria para vistas enriquecidas |
| Identity Provider (OAuth 2.0) | Sistema externo | Producto corporativo existente — emite y valida tokens |
| AWS Rekognition | Sistema externo | Verificación facial en onboarding móvil |
| AWS SES (Email) | Sistema externo | Canal de notificación 1 — alertas transaccionales por email |
| AWS SNS (SMS) | Sistema externo | Canal de notificación 2 — alertas transaccionales por SMS |
| Red de Pagos ACH/SWIFT | Sistema externo | Ejecución de transferencias interbancarias |

---

## 3. Diagrama de Contenedores (C4 — Nivel 2)

> Para audiencias técnicas. Muestra aplicaciones, servicios, bases de datos y mensajería. Incluye tecnologías y protocolos de comunicación.

```mermaid
C4Container
  title Contenedores — BP Internet Banking

  Person(customer, "Cliente")
  Person(admin, "Administrador")

  System_Boundary(bp, "BP Internet Banking") {
    Container(spa, "SPA Web", "React + TypeScript", "Interfaz bancaria para navegador")
    Container(mobile, "App Móvil", "Flutter", "iOS/Android — biometría y operaciones")
    Container(api_gw, "API Gateway", "AWS API Gateway", "Auth, rate limit, enrutamiento")
    Container(auth, "Auth Service", "Keycloak", "OAuth 2.0 + PKCE — tokens y sesiones")
    Container(account, "Account Service", "Spring Boot", "Cuentas y movimientos — Cache-Aside")
    Container(transfer, "Transfer Service", "Spring Boot", "Transferencias — Circuit Breaker")
    Container(events, "Event Bus", "AWS EventBridge", "Eventos asincrónicos")
    Container(cache, "Cache", "Redis ElastiCache", "Cache-Aside — TTL por tipo de dato")
    ContainerDb(db, "BD Operacional", "Aurora PostgreSQL", "ACID, Multi-AZ")
    ContainerDb(audit_db, "BD Auditoría", "DynamoDB", "Append-only — inmutable por IAM")
  }

  System_Ext(core, "Core Banking")
  System_Ext(idp, "Identity Provider")
  System_Ext(payments, "Red de Pagos")

  Rel(customer, spa, "Usa", "HTTPS")
  Rel(customer, mobile, "Usa", "HTTPS")
  Rel(spa, api_gw, "API calls", "HTTPS")
  Rel(mobile, api_gw, "API calls", "HTTPS")
  Rel(api_gw, auth, "Valida token")
  Rel(api_gw, account, "Enruta")
  Rel(api_gw, transfer, "Enruta")
  Rel(auth, idp, "OAuth 2.0 / OIDC")
  Rel(account, cache, "Cache-Aside")
  Rel(account, db, "SQL")
  Rel(account, core, "Datos de cuenta")
  Rel(transfer, db, "Persiste")
  Rel(transfer, payments, "ACH / SWIFT")
  Rel(transfer, events, "Publica evento")
  Rel(events, audit_db, "Auditoría append-only")
```

---

## 4. Diagrama de Componentes (C4 — Nivel 3)

### 4.1 Transfer Service — Componentes

> El servicio más crítico. Maneja transferencias propias e interbancarias con tolerancia a fallos y patrón Cache-Aside.

```mermaid
C4Component
  title Componentes — Transfer Service

  Container_Boundary(transfer_svc, "Transfer Service (Spring Boot)") {
    Component(ctrl, "TransferController", "REST", "Expone /transfers/own y /interbank")
    Component(validator, "TransferValidator", "Business Logic", "Límites, saldo y antifraude")
    Component(handler, "TransferHandler", "Service", "Propias e interbancarias con reintentos")
    Component(circuit_breaker, "CircuitBreaker", "Resilience4j", "CLOSED / OPEN / HALF-OPEN")
    Component(transfer_repo, "TransferRepository", "JPA", "Persiste transferencias")
    Component(event_publisher, "EventPublisher", "Messaging", "TransferCompleted / TransferFailed")
  }

  ContainerDb(ops_db, "Aurora PostgreSQL")
  Container(event_bus, "AWS EventBridge")
  System_Ext(core, "Core Banking")
  System_Ext(payments, "Red de Pagos")

  Rel(ctrl, validator, "Valida")
  Rel(validator, core, "Consulta saldo")
  Rel(validator, handler, "Ejecuta")
  Rel(handler, circuit_breaker, "Llamada protegida")
  Rel(circuit_breaker, payments, "ACH / SWIFT")
  Rel(handler, transfer_repo, "Persiste")
  Rel(transfer_repo, ops_db, "SQL")
  Rel(handler, event_publisher, "Emite")
  Rel(event_publisher, event_bus, "Publica")
```

### 4.2 Auth Service — Componentes (Keycloak + PKCE)

```mermaid
C4Component
  title Componentes — Auth Service (OAuth 2.0 + PKCE)

  Container_Boundary(auth_svc, "Auth Service (Keycloak)") {
    Component(auth_endpoint, "Authorization Endpoint", "OAuth 2.0", "Inicia flujo PKCE")
    Component(token_endpoint, "Token Endpoint", "OAuth 2.0", "Emite tokens JWT")
    Component(mfa_provider, "MFA Provider", "Plugin Keycloak", "OTP / huella / facial")
    Component(session_manager, "Session Manager", "Keycloak", "Sesiones y refresh tokens")
    ComponentDb(user_store, "User Store", "PostgreSQL", "Credenciales, roles y atributos")
  }

  Container(spa, "SPA Web")
  Container(mobile, "App Móvil")
  System_Ext(idp_ext, "Identity Provider Corporativo")

  Rel(spa, auth_endpoint, "Login PKCE", "HTTPS")
  Rel(mobile, auth_endpoint, "Login PKCE", "HTTPS")
  Rel(auth_endpoint, mfa_provider, "2do factor")
  Rel(auth_endpoint, token_endpoint, "Autoriza código")
  Rel(token_endpoint, session_manager, "Crea sesión")
  Rel(session_manager, user_store, "Lee / escribe")
  Rel(auth_endpoint, idp_ext, "Federación SAML/OIDC")
```

### 4.3 Account Service — Componentes (Cache-Aside)

```mermaid
C4Component
  title Componentes — Account Service (Cache-Aside)

  Container_Boundary(account_svc, "Account Service (Spring Boot)") {
    Component(account_ctrl, "AccountController", "REST", "GET /accounts y /accounts/{id}/products")
    Component(account_service, "AccountService", "Business Logic", "Orquesta datos y caché")
    Component(cache_manager, "CacheManager", "Cache-Aside", "Redis primero — miss consulta fuente")
    Component(account_repo, "AccountRepository", "JPA", "Datos operacionales")
    Component(integration_client, "IntegrationClient", "Feign HTTP", "Core Banking y Sistema Detalle")
  }

  ContainerDb(ops_db, "Aurora PostgreSQL")
  Container(cache, "Redis ElastiCache")
  System_Ext(core, "Core Banking")
  System_Ext(detail, "Sistema de Detalle")

  Rel(account_ctrl, account_service, "Delega")
  Rel(account_service, cache_manager, "Solicita")
  Rel(cache_manager, cache, "Lee / escribe")
  Rel(cache_manager, integration_client, "Cache miss")
  Rel(integration_client, core, "Datos core")
  Rel(integration_client, detail, "Datos detalle")
  Rel(account_service, account_repo, "CRUD")
  Rel(account_repo, ops_db, "SQL")
```

---

## 5. Arquitectura de Autenticación — OAuth 2.0 + PKCE

### Flujo Recomendado: Authorization Code Flow + PKCE

**¿Por qué Authorization Code + PKCE y no Implicit Flow?**

| Criterio | Implicit Flow | Authorization Code + PKCE |
|---|---|---|
| Exposición del token | Access token en URL (inseguro) | Solo código temporal en URL |
| Seguridad en mobile | No recomendado (RFC 8252) | Estándar recomendado |
| Refresh token | No soportado | Sí, con rotación |
| Estado del estándar | **Deprecado (OAuth 2.1)** | **Recomendado activo** |

**Justificación 1:** RFC 9700 / OAuth 2.1 elimina el Implicit Flow por riesgo de token leakage en la URL y logs. Authorization Code + PKCE mitiga este riesgo sin requerir client_secret en apps públicas.

**Justificación 2:** RFC 8252 ("OAuth 2.0 for Native Apps") exige PKCE para aplicaciones móviles porque no pueden guardar secretos de forma segura. PKCE usa un `code_verifier` generado en el dispositivo, lo que hace el código de autorización inútil si es interceptado.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart TD
    A[Cliente genera\ncode_verifier + code_challenge] --> B[GET /authorize\ncode_challenge incluido]
    B --> C[Keycloak: login + MFA]
    C --> D[POST /token\ncode + code_verifier]
    D --> E{challenge == hash verifier?}
    E -- Sí --> F[access_token + refresh_token\nAPI Gateway valida JWT]
    E -- No --> G[Error: acceso denegado]
```

### Métodos de Autenticación Post-Onboarding

| Método | Plataforma | Implementación |
|---|---|---|
| Usuario + contraseña | Web + Móvil | Keycloak nativo |
| Huella dactilar | Móvil | Flutter LocalAuth + FIDO2 / WebAuthn |
| OTP por email/SMS | Web + Móvil | Keycloak OTP plugin |
| Reconocimiento facial | Móvil (futuro) | AWS Rekognition + Keycloak plugin |

---

## 6. Arquitectura de Onboarding — Reconocimiento Facial

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart TD
    A[Nuevo cliente descarga App] --> B[Ingresa datos básicos]
    B --> C[Captura selfie en tiempo real]
    C --> D[App envía selfie al Onboarding Service]
    D --> E[Onboarding Service llama AWS Rekognition]
    E --> F{¿Verificación exitosa?}
    F -- No --> G[Solicita nuevo intento o rechaza]
    F -- Sí --> H[Crea usuario en Keycloak\nvía Admin API]
    H --> I[Asigna roles y atributos]
    I --> J[Envía credenciales por email\nvía AWS SES]
    J --> K[Cliente puede ingresar\ncon usuario/clave o huella]
```

**Herramienta recomendada:** AWS Rekognition — servicio gestionado, SLA 99.9%, sin necesidad de equipo de ML interno. Alternativa evaluada: Azure Face API (similar capacidad, pero BP ya opera en AWS).

**Justificación 1:** Usar un servicio gestionado (Rekognition) reduce el time-to-market y elimina la complejidad de entrenar y mantener modelos propios. Rekognition tiene precisión >99.5% para verificación 1:1.

**Justificación 2:** Separar el Onboarding Service como microservicio independiente permite escalar el flujo de alta de clientes sin afectar la disponibilidad de los servicios transaccionales.

---

## 7. Patrón de Caché para Clientes Frecuentes — Cache-Aside

**Patrón elegido:** Cache-Aside (Lazy Loading)

**¿Por qué Cache-Aside y no Write-Through o Read-Through?**

**Justificación 1:** Cache-Aside da control explícito sobre qué se cachea. Para datos bancarios sensibles (saldos, movimientos), es crítico poder invalidar selectivamente. Write-Through cachea todos los writes, incluyendo datos que quizás nunca se lean.

**Justificación 2:** El Core Banking Platform es un sistema externo que no controlamos. Cache-Aside es el único patrón aplicable cuando la fuente de datos es un sistema legado externo sin soporte para write-through nativo.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart LR
    A[Request de cliente] --> B{¿Dato en Redis?}
    B -- Hit --> C[Retorna desde caché\nlatencia < 1ms]
    B -- Miss --> D[Consulta Core Banking\no Sistema de Detalle]
    D --> E[Escribe en Redis\ncon TTL configurado]
    E --> F[Retorna dato al cliente]
```

| Dato cacheado | TTL | Razón |
|---|---|---|
| Perfil básico del cliente | 15 min | Cambia poco frecuente |
| Productos / cuentas | 5 min | Puede cambiar por nuevas contrataciones |
| Últimos movimientos | 2 min | Alta frecuencia de cambio |
| Token de sesión | Duración del token | Validación rápida sin hit a BD |

---

## 8. Capa de Integración — API Gateway + Adaptadores

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart TD
    GW[AWS API Gateway] --> AS[Account Service]
    GW --> MS[Movement Service]
    GW --> TS[Transfer Service]
    GW --> OS[Onboarding Service]

    AS --> IL[Integration Layer]
    MS --> IL

    IL --> CB[Core Banking Adapter\nDatos básicos y movimientos]
    IL --> CD[Client Detail Adapter\nInformación enriquecida]

    CB --> CORE[Core Banking Platform]
    CD --> DETAIL[Sistema de Detalle]
```

**Justificación 1:** El API Gateway centraliza autenticación, rate limiting y logging. Sin él, cada microservicio necesitaría implementar estas preocupaciones transversales, violando DRY y generando inconsistencias.

**Justificación 2:** La Integration Layer con adaptadores por sistema externo (Adapter Pattern) aísla los contratos de los sistemas legados. Si el Core Banking Platform cambia su API, solo se actualiza el adaptador, no los microservicios de negocio.

### Servicios definidos

| Servicio | Endpoint | Fuente |
|---|---|---|
| Consulta datos básicos | `GET /accounts/{id}` | Core Banking |
| Consulta movimientos | `GET /accounts/{id}/movements` | Core Banking |
| Transferencia propia | `POST /transfers/own` | Interno + Core |
| Transferencia interbancaria | `POST /transfers/interbank` | Core + Red de Pagos |
| Detalle de cliente | `GET /clients/{id}/profile` | Sistema de Detalle |
| Notificaciones | `POST /notifications` (async) | EventBridge |

---

## 9. Arquitectura de Notificaciones

**Canal 1 — Email (AWS SES):** Alertas de movimientos, confirmaciones de transferencia, recuperación de contraseña.

**Canal 2 — SMS (AWS SNS):** OTP para MFA, alertas de seguridad, confirmaciones críticas.

**Patrón:** Event-Driven. Los servicios publican eventos a EventBridge. El Notification Service suscribe y despacha al canal adecuado según preferencias del cliente.

**Justificación 1:** El desacoplamiento vía EventBridge evita dependencia directa entre Transfer Service y Notification Service. Si el servicio de notificaciones cae, las transferencias no se bloquean.

**Justificación 2:** Usar AWS SES + SNS como servicios gestionados garantiza SLA del 99.9% y cumple con regulaciones de comunicación financiera sin infraestructura adicional.

---

## 10. Arquitectura de Auditoría

**Base de datos:** AWS DynamoDB (append-only, sin UPDATE ni DELETE)

**Justificación 1:** DynamoDB con política IAM que deniega UpdateItem y DeleteItem garantiza inmutabilidad del registro de auditoría, cumpliendo con SOX y normativas bancarias que exigen trails no modificables.

**Justificación 2:** DynamoDB escala de forma ilimitada, soporta TTL nativo para archivado automático, y cifra en reposo por defecto — características esenciales para logs regulatorios de largo plazo.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart LR
    T[Cualquier acción del cliente] --> EB[AWS EventBridge]
    EB --> AS[Audit Service]
    AS --> DDB[(DynamoDB\nAudit Table)]
    DDB --> S3[(S3 Archive\nPor expiración TTL)]
```

**Esquema de registro de auditoría:**

| Campo | Tipo | Descripción |
|---|---|---|
| `auditId` | String (PK) | UUID v4 único |
| `clientId` | String (SK) | ID del cliente |
| `timestamp` | ISO 8601 | Fecha y hora UTC |
| `action` | String | LOGIN, TRANSFER, QUERY, etc. |
| `sourceIP` | String | IP origen |
| `channel` | String | WEB / MOBILE |
| `payload` | JSON | Detalle de la acción (sin datos sensibles) |
| `result` | String | SUCCESS / FAILURE |

---

## 11. Infraestructura en Nube — AWS

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'primaryColor': '#1168bd', 'primaryTextColor': '#ffffff', 'primaryBorderColor': '#0b4e99', 'lineColor': '#444444', 'secondaryColor': '#e8f0fa', 'tertiaryColor': '#f0f0f0'}}}%%
flowchart TD
    CF[CloudFront CDN] --> ALB[Application Load Balancer\nMulti-AZ]

    ALB --> EKS1[EKS — us-east-1a]
    ALB --> EKS2[EKS — us-east-1b]

    EKS1 --> AURORA[(Aurora PostgreSQL\nPrimary)]
    EKS2 --> AURORA_R[(Aurora\nRead Replica)]

    EKS1 --> REDIS[(ElastiCache Redis\nMulti-AZ)]
    EKS2 --> REDIS

    EKS1 --> DDB[(DynamoDB\nGlobal Tables)]
    EKS2 --> DDB

    EKS1 --> EB[EventBridge]
    EB --> SQS[SQS Dead Letter Queue]
```

### Servicios AWS utilizados

| Servicio | Uso | Justificación |
|---|---|---|
| EKS (Kubernetes) | Orquestación de microservicios | Portabilidad, auto-healing, HPA |
| Aurora PostgreSQL | Base de datos operacional | ACID, Multi-AZ, failover automático < 30s |
| DynamoDB | Auditoría append-only | Escala ilimitada, inmutabilidad vía IAM |
| ElastiCache Redis | Cache-Aside | Sub-milisecond latency, Multi-AZ |
| API Gateway | Gateway de entrada | Rate limiting, JWT validation, WAF |
| EventBridge | Bus de eventos | Desacoplamiento, routing por reglas |
| SQS | Dead Letter Queue | Reintentos y tolerancia a fallos |
| CloudFront | CDN para SPA | Baja latencia global, caché de assets |
| Rekognition | Reconocimiento facial | ML gestionado, sin infraestructura |
| SES | Email transaccional | SLA 99.9%, cumplimiento regulatorio |
| SNS | SMS / Push | Multi-canal, entrega garantizada |
| WAF + Shield | Seguridad perimetral | Protección DDoS y OWASP Top 10 |
| CloudWatch | Monitoreo y alertas | Métricas, logs, dashboards, alarmas |
| Secrets Manager | Gestión de secretos | Rotación automática, sin hardcoding |

---

## 12. Alta Disponibilidad, Tolerancia a Fallos y Recuperación ante Desastres

### Alta Disponibilidad (HA)

- **Multi-AZ:** Todos los servicios desplegados en mínimo 2 zonas de disponibilidad
- **Auto Scaling:** HPA en Kubernetes ajusta réplicas según CPU/RPS
- **Load Balancing:** ALB distribuye tráfico entre zonas automáticamente
- **Circuit Breaker:** Resilience4j previene cascada de fallos hacia sistemas externos
- **Aurora Multi-AZ:** Failover automático en < 30 segundos sin intervención manual

### Tolerancia a Fallos

- **SQS Dead Letter Queue:** Eventos que fallan después de 3 reintentos van a DLQ para revisión
- **Idempotency Keys:** Las transferencias incluyen `idempotencyKey` para evitar duplicados en reintentos
- **Graceful Degradation:** Si el Sistema de Detalle falla, Account Service retorna datos básicos del Core
- **Timeout + Retry:** Configurados en todos los clientes HTTP con backoff exponencial

### Recuperación ante Desastres (DR)

| RTO | RPO | Estrategia |
|---|---|---|
| < 1 hora | < 5 minutos | Aurora Global Database — réplica en región secundaria |
| < 4 horas | < 1 hora | DynamoDB Global Tables replicado en us-west-2 |
| < 15 minutos | 0 (eventos) | EventBridge replay de eventos archivados |

---

## 13. Seguridad

### Capas de Seguridad

| Capa | Control | Tecnología |
|---|---|---|
| Perímetro | DDoS, OWASP Top 10 | AWS WAF + Shield Advanced |
| Transporte | Cifrado en tránsito | TLS 1.3 en todos los canales |
| Autenticación | JWT + PKCE + MFA | Keycloak + AWS Cognito (fallback) |
| Autorización | RBAC por rol y canal | Keycloak + Spring Security |
| Datos en reposo | Cifrado AES-256 | AWS KMS en Aurora, DynamoDB, S3 |
| Secretos | Sin hardcoding | AWS Secrets Manager con rotación |
| Código | SAST / DAST | SonarQube + OWASP ZAP en CI/CD |
| Contenedores | Escaneo de imágenes | Amazon ECR Image Scanning |

### Consideraciones Normativas

| Normativa | Aplicación |
|---|---|
| **PCI DSS v4** | Datos de tarjetas — cifrado, logging, segmentación de red |
| **Ley de Protección de Datos** | Consentimiento, derecho al olvido, minimización de datos |
| **SOX** | Registro de auditoría inmutable, controles de acceso financiero |
| **PSD2 / Open Banking** | Strong Customer Authentication (SCA) con 2FA obligatorio |
| **ISO 27001** | SGSI — políticas de seguridad, gestión de riesgos |
| **SWIFT Security Framework** | Controles para transferencias interbancarias |
| **Circular SFC / Superfinanciera** | Continuidad de negocio, gestión de incidentes, reporte regulatorio |
| **GDPR / ISO 29134** | Privacy by Design, evaluación de impacto (DPIA) |

---

## 14. Monitoreo y Excelencia Operativa

### Stack de Observabilidad

| Pilar | Herramienta | Qué mide |
|---|---|---|
| Métricas | CloudWatch + Prometheus | CPU, memoria, RPS, latencia p95/p99 |
| Logs | CloudWatch Logs + Elasticsearch | Trazas de request, errores, auditoría |
| Trazas | AWS X-Ray | Distributed tracing entre microservicios |
| Alertas | CloudWatch Alarms + PagerDuty | Anomalías, errores críticos, SLA breach |
| Dashboards | Grafana | Vista unificada de salud del sistema |

### KPIs de Producción

| Métrica | Objetivo |
|---|---|
| Disponibilidad | 99.95% mensual |
| Latencia p95 (consultas) | < 300ms |
| Latencia p95 (transferencias) | < 2 segundos |
| Tasa de error | < 0.1% |
| Tiempo de failover Aurora | < 30 segundos |

### Auto-Healing

- **Kubernetes Liveness/Readiness Probes:** Reinicia pods no saludables automáticamente
- **EKS Node Auto Repair:** Reemplaza nodos con fallo sin intervención manual
- **Aurora Auto Failover:** Promueve réplica a primaria en fallo de la primaria
- **Lambda Retry:** Reintentos automáticos en procesamiento de eventos

---

## 15. Decisiones Arquitectónicas (ADR)

| # | Decisión | Opción elegida | Alternativa evaluada | Justificación |
|---|---|---|---|---|
| 1 | Arquitectura base | Microservicios | Monolito | Escalabilidad independiente por servicio; despliegue sin coordinación global |
| 2 | Orquestación | EKS (Kubernetes) | ECS Fargate | Portabilidad, comunidad, HPA y self-healing nativo |
| 3 | BD Operacional | Aurora PostgreSQL | RDS MySQL | ACID, failover < 30s, réplicas de lectura, compatibilidad PostgreSQL |
| 4 | BD Auditoría | DynamoDB | PostgreSQL | Escala ilimitada, inmutabilidad vía IAM, TTL nativo |
| 5 | Caché | Redis (ElastiCache) | Memcached | Estructuras de datos avanzadas, persistencia, pub/sub para invalidación |
| 6 | Mensajería | EventBridge | Kafka | Menor operación, integración nativa AWS, routing por reglas declarativas |
| 7 | Auth flow | Authorization Code + PKCE | Implicit Flow | RFC 8252 / OAuth 2.1 — PKCE es el estándar para apps públicas |
| 8 | IdP | Keycloak | Implementación propia | Producto corporativo existente, reduce TCO, OAuth 2.0 / OIDC compliant |
| 9 | Biometría | AWS Rekognition | Azure Face API | BP ya opera en AWS — menor latencia, sin egress cross-cloud |
| 10 | App Móvil | Flutter | React Native | Un solo código para iOS/Android, acceso a APIs biométricas nativas |
| 11 | SPA | React + TypeScript | Angular | Ecosistema más amplio, flexibilidad, TypeScript para type safety |
| 12 | Patrón Caché | Cache-Aside | Write-Through | Core Banking externo no soporta write-through; control explícito de invalidación |
| 13 | Notificaciones | EventBridge + SES + SNS | Twilio | Integración nativa AWS, menor latencia, SLA 99.9%, menor costo |
| 14 | Gateway | AWS API Gateway | Kong | Menor operación, integración con WAF, Lambda authorizer nativo |

---

*Arquitectura diseñada bajo modelo C4 — Context · Container · Component*
