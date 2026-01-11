# Contributing Guide

Thank you for your interest in contributing to SailPoint ISC Dev Tools! This guide will help you get started.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [Coding Standards](#coding-standards)
6. [Making Changes](#making-changes)
7. [Testing](#testing)
8. [Submitting Changes](#submitting-changes)
9. [Common Tasks](#common-tasks)

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Visual Studio Code 1.74+
- Git
- TypeScript knowledge
- Understanding of VS Code Extension API

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sp-isc-devtools_vscode.git
   cd sp-isc-devtools_vscode
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/asuka-405/sp-isc-devtools_vscode.git
   ```

## Development Setup

### 1. Install Dependencies

```bash
npm install
```

This will also install dependencies for the campaign webview app.

### 2. Build the Extension

```bash
# Development build with source maps
npm run esbuild

# Watch mode (rebuilds on file changes)
npm run esbuild-watch
```

### 3. Run in Extension Development Host

1. Open the project in VS Code
2. Press `F5` or go to Run > Start Debugging
3. A new VS Code window will open (Extension Development Host)
4. The extension will be loaded in this window

### 4. Package Extension (Optional)

```bash
npm install -g @vscode/vsce
vsce package
```

This creates a `.vsix` file you can install manually.

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

Key directories:
- `src/` - Source code
- `src/commands/` - Command handlers
- `src/services/` - Core services
- `src/webviews/` - Webview panels
- `src/models/` - Data models
- `schemas/` - JSON schemas for validation
- `resources/` - Icons and assets

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use `async/await` over promises
- Use optional chaining (`?.`) and nullish coalescing (`??`)

### Code Style

- **Indentation**: 8 spaces (as per user rules)
- **Line Length**: Keep lines under 120 characters when possible
- **Naming**:
  - Classes: `PascalCase`
  - Functions/Methods: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`
  - Files: `PascalCase.ts` for classes, `camelCase.ts` for utilities

### Function Guidelines

- Keep functions short (≤60 lines)
- Single responsibility per function
- Single exit point (one return statement)
- Avoid deep nesting (max 3-4 levels)
- Use early returns for error cases

### Example

```typescript
export class MyCommand {
    private tenantService: TenantService;

    constructor(tenantService: TenantService) {
        this.tenantService = tenantService;
    }

    public async execute(item: any): Promise<void> {
        if (!item?.tenantId) {
            vscode.window.showErrorMessage('Tenant ID is required');
            return;
        }

        try {
            const result = await this.performOperation(item.tenantId);
            vscode.window.showInformationMessage(`Operation completed: ${result}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
        }
    }

    private async performOperation(tenantId: string): Promise<string> {
        // Implementation here
        return 'success';
    }
}
```

### Error Handling

- Always use try-catch for async operations
- Show user-friendly error messages
- Log detailed errors to console
- Don't expose sensitive information

```typescript
try {
    await someAsyncOperation();
} catch (error: any) {
    console.error('[MyCommand] Error:', error);
    vscode.window.showErrorMessage(
        `Failed to perform operation: ${error.message || 'Unknown error'}`
    );
}
```

### Comments and Documentation

- Use JSDoc for public methods
- Explain "why" not "what"
- Keep comments up to date

```typescript
/**
 * Fetches access profiles for a tenant.
 * Uses cache if available, otherwise fetches from API.
 * 
 * @param tenantId - The tenant ID
 * @param useCache - Whether to use cache (default: true)
 * @returns Promise resolving to array of access profiles
 */
public async getAccessProfiles(
    tenantId: string,
    useCache = true
): Promise<AccessProfile[]> {
    // Implementation
}
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/my-bugfix
```

### 2. Make Your Changes

- Write clear, focused commits
- One logical change per commit
- Test your changes thoroughly

### 3. Commit Messages

Follow conventional commits format:

```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Build/tooling changes

Examples:
```
feat(commands): add bulk export for access profiles

fix(adapter): handle pagination correctly for large datasets

docs(architecture): update sync manager documentation
```

### 4. Keep Your Branch Updated

```bash
git fetch upstream
git rebase upstream/main
```

## Testing

### Manual Testing

1. Build the extension: `npm run esbuild`
2. Press `F5` to launch Extension Development Host
3. Test your changes in the development host
4. Test edge cases and error scenarios

### Unit Tests

```bash
npm run test:unit
```

### Linting

```bash
npm run lint
```

### Type Checking

```bash
npm run test-compile
```

## Submitting Changes

### 1. Push Your Branch

```bash
git push origin feature/my-feature
```

### 2. Create Pull Request

1. Go to the repository on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill out the PR template:
   - Description of changes
   - Related issues
   - Testing performed
   - Screenshots (if UI changes)

### 3. PR Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] Linting passes
- [ ] Documentation updated (if needed)
- [ ] Changes tested manually
- [ ] Commit messages follow convention
- [ ] No console.log statements left in code

### 4. Review Process

- Address review comments promptly
- Keep PR focused (one feature/fix per PR)
- Respond to feedback constructively

## Common Tasks

### Adding a New Command

1. Create command file in `src/commands/`:
   ```typescript
   import * as vscode from 'vscode';
   import { TenantService } from '../services/TenantService';

   export class MyNewCommand {
       constructor(private tenantService: TenantService) {}

       public async execute(item: any): Promise<void> {
           // Implementation
       }
   }
   ```

2. Register in `src/extension.ts`:
   ```typescript
   const myCommand = new MyNewCommand(tenantService);
   context.subscriptions.push(
       vscode.commands.registerCommand('sp-isc-devtools.my-command', 
           myCommand.execute, myCommand)
   );
   ```

3. Add to `package.json`:
   ```json
   {
       "command": "sp-isc-devtools.my-command",
       "title": "My New Command"
   }
   ```

### Adding a New Webview Panel

1. Create panel class in `src/webviews/my-panel/`:
   ```typescript
   import * as vscode from 'vscode';
   import { TenantService } from '../services/TenantService';

   export class MyPanel {
       public static currentPanel: MyPanel | undefined;
       private readonly _panel: vscode.WebviewPanel;
       // ... implementation
   }
   ```

2. Register command to open panel in `extension.ts`

3. See existing panels for reference (e.g., `HomePanel.ts`)

### Adding a New Service

1. Create service file in `src/services/`:
   ```typescript
   export class MyService {
       private static instance: MyService;

       public static initialize(): MyService {
           if (!MyService.instance) {
               MyService.instance = new MyService();
           }
           return MyService.instance;
       }

       public static getInstance(): MyService {
           if (!MyService.instance) {
               throw new Error('Service not initialized');
           }
           return MyService.instance;
       }
   }
   ```

2. Initialize in `extension.ts`:
   ```typescript
   MyService.initialize();
   ```

### Adding a New Object Type

1. Add to `ObjectType` enum in `StateEngine.ts`
2. Add sync logic in `StateEngine.syncObjectType()`
3. Add API methods in `ISCClient.ts`
4. Add adapter methods in `AdapterLayer.ts`
5. Update tree view if needed

### Working with Cache

Always use `AdapterLayer` for data access:

```typescript
const adapter = AdapterLayer.getInstance();
const sources = await adapter.getObjects(tenantId, 'sources');
```

### Debugging

1. Set breakpoints in VS Code
2. Press `F5` to start debugging
3. Use VS Code debug console
4. Check Extension Development Host output

### Common Issues

**Extension not loading:**
- Check `package.json` for syntax errors
- Verify all dependencies installed
- Check VS Code Developer Console (Help > Toggle Developer Tools)

**Commands not appearing:**
- Verify command registered in `extension.ts`
- Check `package.json` contributes section
- Reload window (Ctrl+R or Cmd+R)

**Webview not displaying:**
- Check webview HTML generation
- Verify message passing
- Check browser console in webview (Help > Toggle Developer Tools)

## Getting Help

- Check existing issues on GitHub
- Review [ARCHITECTURE.md](./ARCHITECTURE.md)
- Ask questions in discussions
- Review existing code for patterns

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
