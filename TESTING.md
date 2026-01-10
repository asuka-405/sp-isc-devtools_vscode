# Testing the GitHub Workflow Locally

There are two ways to test the workflow locally:

## Method 1: Manual Test Script (Recommended for Quick Testing)

Use the provided `test-workflow.sh` script to simulate the workflow steps:

```bash
./test-workflow.sh
```

This script:
- ✅ Detects the current version
- ✅ Installs all dependencies
- ✅ Builds the extension
- ✅ Creates the VSIX package
- ✅ Verifies all steps complete successfully

**Output:** Creates `sp-isc-devtools-0.0.3.vsix` ready for testing

## Method 2: Using `act` (Full GitHub Actions Simulation)

`act` runs GitHub Actions workflows locally using Docker.

### Installation

```bash
# On Linux/Mac
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Or using package managers
# macOS
brew install act

# Windows (using Chocolatey)
choco install act-cli
```

### Testing the Workflow

1. **Test version detection:**
```bash
act push -e test-event.json --job detect-version
```

2. **Test build (without publishing):**
```bash
act push -e test-event.json --job build
```

3. **Test full workflow (dry-run):**
```bash
act push -e test-event.json --dryrun
```

### Creating Test Event File

Create `test-event.json`:
```json
{
  "push": {
    "ref": "refs/heads/main",
    "head_commit": {
      "modified": ["package.json"]
    }
  }
}
```

### Testing with Secrets

Create `.secrets` file (don't commit this!):
```
VSCE_PAT=your_vscode_marketplace_token
OVSX_TOKEN=your_open_vsx_token
```

Then run:
```bash
act push -e test-event.json --secret-file .secrets
```

### Limitations of `act`

- Some actions may not work exactly as in GitHub
- Docker must be running
- May require adjustments for complex workflows
- Secrets need to be provided manually

## Method 3: Manual Step-by-Step Testing

Follow the workflow steps manually:

1. **Check version:**
```bash
node -p "require('./package.json').version"
```

2. **Install dependencies:**
```bash
npm ci
npm run postinstall
```

3. **Build:**
```bash
export PATH="$PWD/node_modules/.bin:$PATH"
npm run esbuild
```

4. **Package:**
```bash
export PATH="$PWD/node_modules/.bin:$PATH"
vsce package --allow-package-secrets sendgrid --allow-package-env-file --out sp-isc-devtools-0.0.3.vsix
```

5. **Test VSIX (optional):**
```bash
# Install in VS Code
code --install-extension sp-isc-devtools-0.0.3.vsix
```

## Verifying the VSIX

After creating the VSIX, verify its contents:

```bash
vsce ls sp-isc-devtools-0.0.3.vsix
```

Or extract and inspect:
```bash
unzip -l sp-isc-devtools-0.0.3.vsix
```

## Common Issues

### rimraf not found
- **Solution:** Ensure `npm ci` runs and `node_modules/.bin` is in PATH
- The workflow now handles this automatically

### .env file error
- **Solution:** Added `.env` to `.vscodeignore` and `--allow-package-env-file` flag
- The workflow includes this flag

### OVSX_TOKEN/VSCE_PAT missing
- **Solution:** These are optional - workflow skips publishing if not set
- Add secrets to GitHub repository settings for actual publishing

## Next Steps

After local testing passes:
1. Commit and push to trigger the actual workflow
2. Monitor the Actions tab in GitHub
3. Check that the VSIX is created and published (if secrets are set)
