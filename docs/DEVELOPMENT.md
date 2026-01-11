# Development Guide

This guide provides detailed instructions for setting up and working with the SailPoint ISC Dev Tools extension codebase.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Development Workflow](#development-workflow)
4. [Building and Testing](#building-and-testing)
5. [Debugging](#debugging)
6. [Project Configuration](#project-configuration)
7. [Dependencies](#dependencies)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js**: Version 18.x or higher
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify: `node --version`

- **npm**: Comes with Node.js
  - Verify: `npm --version`

- **Visual Studio Code**: Version 1.74 or higher
  - Download from [code.visualstudio.com](https://code.visualstudio.com/)

- **Git**: For version control
  - Download from [git-scm.com](https://git-scm.com/)

### Recommended VS Code Extensions

- **ESLint**: Code linting
- **Prettier**: Code formatting (optional)
- **TypeScript and JavaScript Language Features**: Built-in
- **Debugger for Chrome**: For webview debugging

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/asuka-405/sp-isc-devtools_vscode.git
cd sp-isc-devtools_vscode
```

### 2. Install Dependencies

```bash
npm install
```

This will:
- Install all npm dependencies
- Install dependencies for the campaign webview app (`src/campaign-webview/app/`)
- Set up the project structure

### 3. Verify Installation

```bash
# Check TypeScript compilation
npm run test-compile

# Check linting
npm run lint
```

## Development Workflow

### Daily Development

1. **Start Development Build**
   ```bash
   npm run esbuild-watch
   ```
   This watches for file changes and rebuilds automatically.

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Launch Extension Development Host**
   - Press `F5` or
   - Go to Run > Start Debugging
   - Select "Extension Development Host" configuration

4. **Make Changes**
   - Edit files in `src/`
   - Changes are automatically rebuilt (if watch mode is running)
   - Reload the Extension Development Host window to see changes

### File Structure Overview

```
.
├── src/                    # Source code
│   ├── extension.ts        # Entry point
│   ├── commands/          # Command handlers
│   ├── services/          # Core services
│   ├── webviews/         # Webview panels
│   ├── models/           # Data models
│   └── utils/           # Utilities
├── out/                  # Compiled output (generated)
├── schemas/             # JSON schemas
├── resources/           # Icons and assets
├── package.json         # Extension manifest
└── tsconfig.json        # TypeScript config
```

## Building and Testing

### Build Commands

```bash
# Development build (with source maps)
npm run esbuild

# Production build (minified)
npm run vscode:prepublish

# Watch mode (auto-rebuild)
npm run esbuild-watch

# TypeScript compilation check
npm run test-compile
```

### Testing

```bash
# Run unit tests
npm run test:unit

# Run all tests
npm run test

# Lint code
npm run lint
```

### Packaging

```bash
# Install VS Code Extension Manager
npm install -g @vscode/vsce

# Package extension
vsce package

# This creates a .vsix file you can install
```

## Debugging

### Debugging Extension Code

1. **Set Breakpoints**
   - Click in the gutter next to line numbers
   - Red dots indicate breakpoints

2. **Start Debugging**
   - Press `F5`
   - Select "Extension Development Host" launch configuration

3. **Debug Console**
   - View output in Debug Console
   - Evaluate expressions
   - Inspect variables

4. **Extension Development Host**
   - New VS Code window opens
   - Extension is loaded in this window
   - Use this window to test your extension

### Debugging Webviews

1. **Open Webview**
   - Launch extension in debug mode
   - Open a webview panel (e.g., Home Panel)

2. **Open Developer Tools**
   - In Extension Development Host: Help > Toggle Developer Tools
   - Or use command: `Developer: Toggle Developer Tools`

3. **Inspect Webview**
   - Find webview in Elements tab
   - Use Console tab for webview JavaScript
   - Use Network tab for API calls

### Debug Configuration

The `.vscode/launch.json` file contains debug configurations:

```json
{
    "type": "extensionHost",
    "request": "launch",
    "name": "Extension Development Host",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"]
}
```

### Common Debug Scenarios

**Debug Command Execution:**
```typescript
// Set breakpoint in command execute method
export class MyCommand {
    public async execute(item: any): Promise<void> {
        debugger; // Or set breakpoint here
        // Your code
    }
}
```

**Debug Service Methods:**
```typescript
// Set breakpoint in service
public async getObjects<T>(tenantId: string): Promise<T[]> {
    debugger; // Or set breakpoint
    // Your code
}
```

**Debug Webview Messages:**
```typescript
// In webview panel
this._panel.webview.onDidReceiveMessage(async (message) => {
    debugger; // Set breakpoint here
    // Handle message
});
```

## Project Configuration

### TypeScript Configuration (`tsconfig.json`)

```json
{
    "compilerOptions": {
        "module": "commonjs",
        "target": "ES2021",
        "outDir": "out",
        "sourceMap": true,
        "rootDir": "src"
    }
}
```

### Package.json Scripts

- `esbuild`: Build with source maps
- `esbuild-watch`: Watch mode build
- `vscode:prepublish`: Production build
- `test-compile`: Type check
- `lint`: Run ESLint
- `test`: Run tests
- `clean`: Remove build output

### ESLint Configuration (`.eslintrc.json`)

Follows TypeScript ESLint rules. Check for:
- Unused variables
- Type errors
- Code style issues

## Dependencies

### Main Dependencies

- **vscode**: VS Code Extension API
- **sailpoint-api-client**: SailPoint ISC API client
- **axios**: HTTP client
- **lodash**: Utility functions
- **fast-json-patch**: JSON patching

### Development Dependencies

- **@types/vscode**: VS Code type definitions
- **@typescript-eslint/***: TypeScript ESLint
- **esbuild**: Fast bundler
- **mocha**: Testing framework

### Campaign Webview Dependencies

The campaign webview (`src/campaign-webview/app/`) has its own dependencies:
- Svelte framework
- Additional npm packages

Install separately:
```bash
cd src/campaign-webview/app
npm install
```

## Troubleshooting

### Extension Not Loading

**Symptoms:**
- Extension doesn't appear in Extension Development Host
- Commands not available

**Solutions:**
1. Check `package.json` for syntax errors
2. Verify all dependencies installed: `npm install`
3. Check VS Code Developer Console (Help > Toggle Developer Tools)
4. Look for errors in Output panel (View > Output > Log (Extension Host))

### Build Errors

**TypeScript Errors:**
```bash
# Check TypeScript compilation
npm run test-compile

# Fix type errors
# Check tsconfig.json settings
```

**ESLint Errors:**
```bash
# Check linting
npm run lint

# Auto-fix where possible
npm run lint -- --fix
```

### Module Not Found

**Error:** `Cannot find module '...'`

**Solutions:**
1. Reinstall dependencies: `npm install`
2. Check `package.json` has the dependency
3. Verify import path is correct
4. Check if module needs to be in `devDependencies` vs `dependencies`

### Webview Not Displaying

**Symptoms:**
- Webview panel is blank
- Errors in webview console

**Solutions:**
1. Check webview HTML generation
2. Verify message passing between extension and webview
3. Check browser console in webview (Help > Toggle Developer Tools)
4. Verify webview content security policy

### API Calls Failing

**Symptoms:**
- API requests return errors
- Authentication issues

**Solutions:**
1. Check tenant credentials are valid
2. Verify OAuth2 token is not expired
3. Check API endpoint URLs
4. Review network requests in Developer Tools
5. Check `ISCClient.ts` for API call implementation

### Cache Issues

**Symptoms:**
- Stale data displayed
- Changes not reflected

**Solutions:**
1. Clear cache: Command `sp-isc-devtools.clear-cache`
2. Force refresh: Right-click tenant > Refresh
3. Check sync state: Verify tenant is `ACTIVE_SYNC`
4. Manually trigger sync if needed

### Performance Issues

**Symptoms:**
- Slow loading
- UI freezing

**Solutions:**
1. Check for blocking operations (use async/await)
2. Verify pagination is used (max 250 items)
3. Check for memory leaks (dispose of listeners)
4. Profile with VS Code performance tools

## Best Practices

### Code Organization

- Keep files focused (one class per file)
- Use meaningful file names
- Group related functionality
- Follow existing patterns

### Performance

- Use async/await for I/O operations
- Implement pagination for large datasets
- Cache frequently accessed data
- Debounce user input

### Error Handling

- Always use try-catch for async operations
- Show user-friendly error messages
- Log detailed errors to console
- Handle edge cases

### Testing

- Test happy paths
- Test error cases
- Test edge cases
- Test with real data when possible

## Getting Help

- Check [ARCHITECTURE.md](./ARCHITECTURE.md) for architecture details
- Check [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines
- Review existing code for patterns
- Check GitHub issues for known problems
- Ask questions in discussions

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system
- Review [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines
- Explore the codebase starting with `extension.ts`
- Try making a small change and testing it
