# Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Directory Structure](#directory-structure)
6. [Key Design Patterns](#key-design-patterns)
7. [Extension Lifecycle](#extension-lifecycle)

## Overview

SailPoint ISC Dev Tools is a Visual Studio Code extension that provides comprehensive tooling for managing SailPoint Identity Security Cloud (ISC) tenants. The extension enables developers and administrators to manage configurations, sources, transforms, workflows, access profiles, roles, and more directly from VS Code.

### Key Features

- **Multi-tenant Management**: Connect to and manage multiple ISC tenants
- **Background Synchronization**: Automatic data refresh for active tenants
- **Visual Editors**: Rich webview-based editors for transforms, roles, access profiles, workflows
- **Search & Discovery**: Global search across all tenant resources
- **Configuration Management**: Import/export SP-Config files
- **CSV Import/Export**: Bulk operations for access profiles, roles, identities
- **Certification Campaign Management**: Manage and automate certification campaigns

## System Architecture

The extension follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension API                      │
└─────────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Extension Entry Point                       │
│                    (extension.ts)                             │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌──────▼──────┐  ┌────────▼────────┐
│  Command Layer │  │  Webview    │  │   Tree View      │
│  (commands/)   │  │  Panels     │  │   Provider      │
└───────┬────────┘  └──────┬──────┘  └────────┬────────┘
        │                  │                   │
        └──────────────────┼──────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│                    Service Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ SyncManager  │  │ StateEngine  │  │ AdapterLayer │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ CommandBus   │  │ ISCClient    │  │ TenantService│   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────┐
│                    SailPoint ISC API                       │
└───────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Extension Entry Point (`extension.ts`)

The main entry point that:
- Initializes all services in the correct order
- Registers VS Code commands
- Sets up event listeners
- Manages extension lifecycle

**Key Responsibilities:**
- Service initialization and dependency injection
- Command registration
- Event handling
- Cleanup on deactivation

### 2. SyncManager (`services/SyncManager.ts`)

Manages background synchronization state for tenants.

**Key Features:**
- Maximum 4 tenants can be in `ACTIVE_SYNC` state simultaneously
- Remaining tenants are in `PAUSED` state (cold)
- 60-second refresh interval for active tenants
- Health monitoring and error tracking

**Sync States:**
- `ACTIVE_SYNC`: Tenant is actively syncing in background
- `PAUSED`: Tenant sync is paused (cold state)
- `ERROR`: Sync encountered an error
- `DISABLED`: Sync is disabled

**Key Methods:**
```typescript
registerTenant(tenantId: string): void
unregisterTenant(tenantId: string): void
setSyncState(tenantId: string, state: SyncState): boolean
pauseSync(tenantId: string): boolean
resumeSync(tenantId: string): boolean
getSyncState(tenantId: string): SyncState
getAllSyncInfo(): TenantSyncInfo[]
```

### 3. StateEngine (`services/StateEngine.ts`)

Maintains in-memory normalized cache of tenant data.

**Key Features:**
- Operates only for `ACTIVE_SYNC` tenants
- Normalized object graph with relationships
- Automatic refresh on schedule or manual trigger
- Event-driven updates

**Data Structure:**
```typescript
interface TenantState {
    tenantId: string;
    objects: Map<string, ObjectCacheEntry>; // key: `${type}:${id}`
    lastFullSync?: Date;
    syncInProgress: boolean;
    error?: string;
}

interface ObjectCacheEntry<T = any> {
    id: string;
    type: ObjectType;
    data: T;
    lastUpdated: Date;
    relationships?: Map<string, string[]>; // relationship type -> array of related IDs
}
```

**Supported Object Types:**
- `sources`, `transforms`, `workflows`, `identity-profiles`
- `rules`, `access-profiles`, `roles`, `forms`
- `service-desk`, `governance-groups`, `identities`
- `applications`, `campaigns`

**Key Methods:**
```typescript
getObject<T>(tenantId: string, type: ObjectType, id: string): T | undefined
getObjectsByType<T>(tenantId: string, type: ObjectType): ObjectCacheEntry<T>[]
setObject<T>(tenantId: string, type: ObjectType, id: string, data: T): void
refreshTenantState(tenantId: string, force?: boolean): Promise<void>
```

### 4. AdapterLayer (`services/AdapterLayer.ts`)

Provides API-agnostic data access layer.

**Key Features:**
- Unified interface for data access
- Automatic cache usage for `ACTIVE_SYNC` tenants
- Fallback to direct API calls for `PAUSED` tenants or cache misses
- Automatic pagination handling (250 items per page)

**Key Methods:**
```typescript
getObjects<T>(tenantId: string, type: ObjectType, options?): Promise<T[]>
getObject<T>(tenantId: string, type: ObjectType, id: string): Promise<T | undefined>
createObject<T>(tenantId: string, type: ObjectType, data: T): Promise<T>
updateObject<T>(tenantId: string, type: ObjectType, id: string, data: T): Promise<T>
deleteObject(tenantId: string, type: ObjectType, id: string): Promise<void>
```

**Cache Strategy:**
1. Check if tenant is `ACTIVE_SYNC`
2. If yes, try StateEngine cache first
3. If cache miss or tenant is `PAUSED`, fetch from API
4. Update cache if tenant is `ACTIVE_SYNC`

### 5. CommandBus (`services/CommandBus.ts`)

Centralized command handling with validation.

**Key Features:**
- Routes commands to appropriate handlers
- Validates commands affecting sync (must be global)
- Validates commands affecting data (must target `ACTIVE_SYNC` tenants)
- Event-driven architecture

**Command Interface:**
```typescript
interface Command {
    type: string;
    payload: any;
    tenantId?: string;
}
```

**Key Methods:**
```typescript
registerHandler(commandType: string, handler: CommandHandler): void
execute(command: Command): Promise<any>
executeSync(command: Command): any
```

### 6. ISCClient (`services/ISCClient.ts`)

Low-level API client for SailPoint ISC REST API.

**Key Features:**
- Wraps `sailpoint-api-client` library
- Handles authentication via OAuth2
- Automatic retry logic
- Request/response interceptors
- Pagination support

**Key Methods:**
```typescript
getResource(path: string): Promise<any>
getSources(): Promise<Source[]>
getTransforms(): Promise<TransformRead[]>
getAccessProfiles(): Promise<AccessProfile[]>
getRoles(): Promise<Role[]>
// ... many more API methods
```

### 7. TenantService (`services/TenantService.ts`)

Manages tenant configuration and lifecycle.

**Key Features:**
- Stores tenant credentials securely (VS Code Secrets API)
- Manages tenant hierarchy (folders)
- Observer pattern for tenant changes
- Read-only/writable tenant modes

**Key Methods:**
```typescript
getTenants(): TenantInfo[]
getTenant(tenantId: string): TenantInfo | undefined
addTenant(tenantInfo: TenantInfo): Promise<void>
removeTenant(tenantId: string): void
registerObserver(eventType: TenantServiceEventType, observer: Observer): void
```

## Data Flow

### Reading Data

```
User Action (e.g., View Sources)
    │
    ▼
Command Handler
    │
    ▼
AdapterLayer.getObjects()
    │
    ├─► Check SyncManager: Is tenant ACTIVE_SYNC?
    │   │
    │   ├─► YES: Try StateEngine cache
    │   │   │
    │   │   ├─► Cache Hit: Return cached data
    │   │   │
    │   │   └─► Cache Miss: Fetch from API → Update cache → Return
    │   │
    │   └─► NO: Fetch directly from API → Return
    │
    ▼
Return Data to UI
```

### Writing Data

```
User Action (e.g., Save Transform)
    │
    ▼
Command Handler
    │
    ▼
AdapterLayer.updateObject()
    │
    ▼
ISCClient.updateResource()
    │
    ▼
SailPoint ISC API
    │
    ▼
On Success:
    ├─► Update StateEngine cache (if ACTIVE_SYNC)
    ├─► Emit update event
    └─► Refresh UI
```

### Background Sync

```
SyncManager Timer (60s interval)
    │
    ▼
For each ACTIVE_SYNC tenant:
    │
    ▼
StateEngine.refreshTenantState()
    │
    ▼
Fetch all object types in parallel:
    ├─► Sources
    ├─► Transforms
    ├─► Workflows
    ├─► Identity Profiles
    ├─► Rules
    ├─► Access Profiles
    ├─► Roles
    └─► ... (all object types)
    │
    ▼
Update StateEngine cache
    │
    ▼
Emit syncCompleted event
    │
    ▼
UI updates automatically (via event listeners)
```

## Directory Structure

```
src/
├── extension.ts                 # Extension entry point
├── commands/                    # Command handlers
│   ├── access-profile/         # Access profile commands
│   ├── applications/           # Application commands
│   ├── identity/               # Identity commands
│   ├── role/                   # Role commands
│   ├── rule/                   # Rule commands
│   ├── source/                 # Source commands
│   ├── spconfig-export/        # SP-Config export
│   ├── spconfig-import/        # SP-Config import
│   ├── tenant/                 # Tenant management
│   └── workflow/               # Workflow commands
├── services/                    # Core services
│   ├── AdapterLayer.ts         # Data access layer
│   ├── AuthenticationProvider.ts # OAuth2 authentication
│   ├── CommandBus.ts           # Command routing
│   ├── ISCClient.ts            # API client
│   ├── StateEngine.ts          # State cache
│   ├── SyncManager.ts          # Sync management
│   ├── TenantService.ts        # Tenant management
│   ├── cache/                  # Cache services
│   │   ├── LocalCacheService.ts
│   │   └── ... (various cache services)
│   └── beanshell/              # BeanShell execution
├── webviews/                    # Webview panels
│   ├── home/                   # Home panel
│   ├── source-config/          # Source config editor
│   ├── transform-editor/       # Transform editor
│   ├── access-profile-editor/  # Access profile editor
│   ├── role-editor/            # Role editor
│   ├── rule-editor/            # Rule editor
│   └── workflow-editor/        # Workflow editor
├── models/                      # Data models
│   ├── TenantInfo.ts
│   ├── ISCTreeItem.ts
│   ├── AccessProfiles.ts
│   ├── Roles.ts
│   └── ... (other models)
├── views/                       # Tree view providers
│   └── ISCTreeDataProvider.ts
├── utils/                       # Utility functions
│   ├── metadataUtils.ts
│   ├── EndpointUtils.ts
│   └── ... (other utilities)
├── files/                       # File system providers
│   ├── FileHandler.ts
│   └── ISCResourceProvider.ts
├── parser/                      # Parsers (for transforms, etc.)
└── validator/                   # Validators
```

## Key Design Patterns

### 1. Singleton Pattern

Core services use singleton pattern:
- `SyncManager.getInstance()`
- `StateEngine.getInstance()`
- `AdapterLayer.getInstance()`
- `CommandBus.getInstance()`

### 2. Observer Pattern

Used for event-driven updates:
- `TenantService` notifies observers of tenant changes
- `SyncManager` emits sync state changes
- `StateEngine` emits object updates

### 3. Adapter Pattern

`AdapterLayer` abstracts data access:
- Hides complexity of cache vs. API calls
- Provides unified interface regardless of sync state
- Enables easy testing and mocking

### 4. Command Pattern

`CommandBus` implements command pattern:
- Commands are first-class objects
- Handlers are registered per command type
- Supports async and sync execution

### 5. Factory Pattern

Used for creating tree items, webview panels, etc.

## Extension Lifecycle

### Activation

1. `activate()` function called by VS Code
2. Initialize `TenantService`
3. Initialize `AuthenticationProvider`
4. Initialize core services in order:
   - `SyncManager`
   - `StateEngine`
   - `AdapterLayer`
   - `CommandBus`
5. Initialize supporting services:
   - `LocalCacheService`
   - `CommitService`
   - `SearchService`
   - `GitService`
   - `BeanShellService`
6. Register all VS Code commands
7. Register file system providers
8. Register URI handlers
9. Set up event listeners

### Deactivation

1. `deactivate()` function called by VS Code
2. Dispose of all services:
   - `SyncManager.dispose()`
   - `StateEngine.dispose()`
   - `CommandBus.dispose()`
3. Clean up subscriptions
4. Save any pending state

### Background Sync Lifecycle

1. On activation, `SyncManager` registers all existing tenants
2. First 4 tenants (or fewer) are set to `ACTIVE_SYNC`
3. Remaining tenants are set to `PAUSED`
4. `ACTIVE_SYNC` tenants start 60-second sync loop
5. On each sync:
   - `StateEngine.refreshTenantState()` is called
   - All object types are fetched in parallel
   - Cache is updated
   - Events are emitted
6. UI components listen to events and update automatically

## Best Practices

### Adding a New Command

1. Create command file in appropriate `commands/` subdirectory
2. Implement command class with `execute()` method
3. Register command in `extension.ts`
4. Add command to `package.json` `contributes.commands`
5. Add menu items in `package.json` `contributes.menus` if needed

### Adding a New Webview Panel

1. Create panel class extending base panel pattern
2. Implement `createOrShow()` static method
3. Implement `getHtmlForWebview()` method
4. Handle messages from webview
5. Register command to open panel in `extension.ts`

### Adding a New Object Type

1. Add type to `ObjectType` enum in `StateEngine.ts`
2. Add sync logic in `StateEngine.syncObjectType()`
3. Add API methods in `ISCClient.ts` if needed
4. Add adapter methods in `AdapterLayer.ts`
5. Update tree view provider if needed

### Working with Cache

- Always use `AdapterLayer` for data access (don't call `StateEngine` directly)
- Cache is automatically used for `ACTIVE_SYNC` tenants
- Use `forceLoad: true` in options to bypass cache
- Cache is updated automatically on writes

### Error Handling

- Use try-catch blocks for async operations
- Show user-friendly error messages via `vscode.window.showErrorMessage()`
- Log errors to console with context
- Update sync state to `ERROR` on persistent failures

## Performance Considerations

1. **Pagination**: Always use pagination (max 250 items per page)
2. **Parallel Fetching**: Use `Promise.all()` for independent operations
3. **Cache Usage**: Prefer cache over API calls when possible
4. **Lazy Loading**: Load data only when needed
5. **Debouncing**: Debounce user input for search/filter operations

## Security Considerations

1. **Credentials**: Store in VS Code Secrets API (never in plain text)
2. **Tokens**: OAuth2 tokens are managed by `AuthenticationProvider`
3. **Read-only Mode**: Respect tenant read-only settings
4. **Validation**: Validate all user input before API calls
5. **Error Messages**: Don't expose sensitive information in errors
