# SailPoint ISC VS Code Extension — Execution Specification (API-Agnostic)

## 0. Document Contract
- This document defines what must be built, not why
- No assumptions about concrete APIs, versions, SDKs, or vendors
- All external interactions are abstracted
- Any deviation requires explicit justification

## 1. System Objective
Build a VS Code extension (compatible with VS Code forks) that:
- Manages multiple IAM tenants concurrently
- Mirrors ISC admin UI hierarchy and capabilities
- Maintains continuously refreshed tenant state
- Enables native code editing for rule-like objects
- Adds automation and analysis tools
- Operates safely under large datasets

## 2. Supported Scale (Hard Bounds)
| Dimension | Requirement |
|---------|-------------|
| Concurrent tenants (registered) | 1–16 |
| Concurrent tenants (active sync) | **Max 4** |
| Objects per tenant | 100k+ |
| Entitlements | 10k+ |
| Accounts | 1M+ |
| Background refresh | Every 60s |
| Max UI block | 0 ms |
| Max loader display | 45 s |
| Page size | ≤250 rows |

## 3. Non-Functional Requirements

### 3.1 Performance
- UI must never block
- All I/O must be async
- Background sync must be throttled
- Only **active sync tenants** may consume background cycles
- Tree expansion must be O(1) on cached state
- Pagination mandatory for large datasets

### 3.2 Reliability
- Tenant failures must be isolated
- Sync failure of one tenant must not affect others
- Retry-safe mutations
- Partial state allowed but clearly labeled

### 3.3 Security
- Secrets stored only in secure storage
- No secrets logged
- No plaintext persistence
- Admin access assumed
- Insufficient access must trigger warning banner

### 3.4 UX
- Flat UI, matte colors
- Coral accent color only
- Breadcrumbs on every page
- Refresh button on every page
- Explicit sync status indicators
- Clear distinction between synced vs non-synced tenants

### 3.5 Maintainability
- No hardcoded object types
- All data access behind adapters
- UI decoupled from transport
- Sync logic isolated from UI logic

### 3.6 Extensibility
- Sync policy must be configurable
- Adding new sync modes must not change core engine
- No core rewrites for feature expansion

---

## 4. Architecture

Extension Host
- Activation Controller
- Tenant Registry
- **Sync Manager**
- State Engine
- Adapter Layer
- Command Bus
- UI Layer
- Output & Telemetry

---

## 5. Tenant Registry

### Responsibilities
- Register up to 16 tenants
- Persist tenant metadata
- Store credentials securely
- Track tenant sync eligibility
- Expose tenant list and status to UI

---

## 6. Sync Manager (Mandatory)

### Purpose
Control which tenants participate in background state synchronization.

### Rules
- Maximum **4 tenants** may be in active sync state at any time
- Remaining tenants are in **paused (cold)** state
- Cold tenants:
  - Are visible in UI
  - Do not run background refresh
  - Load data only on explicit user action

### Responsibilities
- Enforce sync limits
- Start / stop background sync loops
- Emit sync state changes
- Coordinate with State Engine

### Sync States
- `ACTIVE_SYNC`
- `PAUSED`
- `ERROR`
- `DISABLED`

---

## 7. State Engine

### Responsibilities
- Maintain full object graph per tenant
- Operate **only** for ACTIVE_SYNC tenants
- Keep in-memory normalized cache
- Track relationships
- Refresh on schedule or manual trigger

### Constraints
- State Engine must not decide sync eligibility
- State Engine must tolerate sync suspension

---

## 8. Sync Management Page (New UI)

### Location
- Home Page → “Manage Tenant Sync”

### Capabilities
- Display all registered tenants
- Show current sync state per tenant
- Allow selecting up to **4 tenants** for active sync
- Prevent selecting more than 4 (hard stop)
- Allow manual pause / resume
- Show last sync timestamp
- Show sync health (OK / DEGRADED / FAILED)

### UX Rules
- Checkbox or toggle-based selection
- Disabled state when limit reached
- Immediate feedback on state change
- No background restart without user confirmation

---

## 9. Navigation Hierarchy

Tenant
- Identity Management
- Access Model
- Connections
- Workflows
- Certifications
- Reports & Tools

(Sync Management is **global**, not per-tenant)

---

## 10. UI Layer Rules

### Tree View
- Render only ACTIVE_SYNC tenants by default
- PAUSED tenants shown as collapsed / disabled
- No direct I/O

### Webviews
- Stateless renderers
- Data injected via messages
- No direct data fetching

### Editors
- Native VS Code editors only
- Save triggers validation + deploy
- Failure must not close editor

---

## 11. Pagination Contract
- Mandatory for any list >250 items
- Page navigation must not re-fetch full dataset
- Sorting/filtering must use indexed cache or remote filtering

---

## 12. Automation Tools
- Stateless
- Explicit inputs
- Deterministic output
- Confirmation before mutation
- Operate only on ACTIVE_SYNC tenants

---

## 13. Command Bus

```ts
interface Command {
  type: string
  payload: any
  tenantId?: string
}
```

- Commands affecting sync must be global
- Commands affecting data must target ACTIVE_SYNC tenants

---

## 14. Error Handling
- No silent failures
- Sync errors surfaced in Sync Management Page
- Background errors logged only
- Recoverable errors allow retry

---

## 15. Logging & Diagnostics
- Dedicated Output Channel
- Structured logs
- Per-tenant grouping
- Sync lifecycle logs mandatory

---

## 16. Prohibited Practices
- No direct API calls from UI
- No shared mutable global state
- No blocking operations
- No bypassing Sync Manager

---

## 17. Completion Criteria
- Sync limit enforced at all times
- No background activity for paused tenants
- UI remains responsive at max load
- Rule editing works end-to-end
- No API specifics in core logic

---

## 18. Final Statement

Tenant sync is a **controlled resource**, not an entitlement.

The system must prefer:
Determinism > Parallelism  
Control > Convenience  
Stability > Throughput
