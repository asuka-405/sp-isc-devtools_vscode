# GitHub Workflows

## Publish Extension Workflow

The `publish.yaml` workflow automatically builds and publishes the extension to both VS Code Marketplace and Open VSX Marketplace when a version change is detected in `package.json`.

### How it works

1. **Version Detection**: The workflow monitors `package.json` for version changes
2. **Build**: If version changed, builds the extension using `npm run esbuild`
3. **Package**: Creates a VSIX file using `vsce package`
4. **Publish**: Publishes to both marketplaces in parallel:
   - VS Code Marketplace (using `VSCE_PAT` secret)
   - Open VSX Marketplace (using `OVSX_TOKEN` secret)
5. **Release**: Creates a GitHub release with the VSIX artifact

### Triggers

- **Automatic**: Pushes to `main` branch that modify `package.json` with a version change
- **Manual**: Use "Run workflow" button with optional force publish

### Required Secrets

Add these secrets to your GitHub repository settings:

1. **VSCE_PAT**: Personal Access Token for VS Code Marketplace
   - Get from: https://marketplace.visualstudio.com/manage/publishers/ArchMedia
   - Create token: https://dev.azure.com/ (Azure DevOps)

2. **OVSX_TOKEN**: Personal Access Token for Open VSX Marketplace
   - Get from: https://open-vsx.org/user-settings/tokens
   - Create account: https://open-vsx.org/register

### Setting up secrets

1. Go to your repository: `Settings` → `Secrets and variables` → `Actions`
2. Click `New repository secret`
3. Add each secret:
   - Name: `VSCE_PAT`
   - Value: Your VS Code Marketplace token
   - Name: `OVSX_TOKEN`
   - Value: Your Open VSX token

### Environments

The workflow uses GitHub Environments for better secret management:
- `vscode-marketplace`: For VS Code Marketplace publishing
- `openvsx-marketplace`: For Open VSX Marketplace publishing

### Version Detection

The workflow detects version changes by:
1. Comparing `package.json` version between commits
2. Only publishing if version actually changed
3. Supports manual force publish via workflow_dispatch

### Manual Publishing

To manually trigger a publish:

1. Go to `Actions` tab in GitHub
2. Select "Publish Extension" workflow
3. Click "Run workflow"
4. Optionally check "Force publish" to publish even if version unchanged

### Troubleshooting

- **Version not detected**: Ensure `package.json` version is actually changed in the commit
- **Publish fails**: Check that secrets are correctly set and tokens are valid
- **Build fails**: Check that all dependencies are in `package.json` and `package-lock.json` is committed
