#!/bin/bash
# Local workflow testing script
# This simulates the GitHub Actions workflow steps locally

set -e

echo "🧪 Testing GitHub Workflow Locally"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Run this script from the project root.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Detecting version...${NC}"
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"
echo ""

echo -e "${YELLOW}Step 2: Installing dependencies...${NC}"
npm ci
echo "✓ Dependencies installed"
echo ""

echo -e "${YELLOW}Step 3: Running postinstall...${NC}"
npm run postinstall || echo "⚠ Postinstall completed with warnings"
echo ""

echo -e "${YELLOW}Step 4: Verifying rimraf is available...${NC}"
if [ -f "node_modules/.bin/rimraf" ]; then
    echo "✓ rimraf found in node_modules/.bin"
    ./node_modules/.bin/rimraf --version || npx rimraf --version
else
    echo "⚠ rimraf not found, will use npx"
    npx rimraf --version || echo "⚠ rimraf check failed"
fi
echo ""

echo -e "${YELLOW}Step 5: Installing vsce...${NC}"
npm install -g @vscode/vsce 2>/dev/null || echo "⚠ vsce may already be installed"
vsce --version
echo ""

echo -e "${YELLOW}Step 6: Installing ovsx...${NC}"
npm install -g ovsx 2>/dev/null || echo "⚠ ovsx may already be installed"
ovsx --version
echo ""

echo -e "${YELLOW}Step 7: Building extension...${NC}"
export PATH="$PWD/node_modules/.bin:$PATH"
npm run esbuild
echo "✓ Build completed"
echo ""

echo -e "${YELLOW}Step 8: Packaging extension...${NC}"
export PATH="$PWD/node_modules/.bin:$PATH"
VSIX_FILE="sp-isc-devtools-${CURRENT_VERSION}.vsix"
vsce package --allow-package-secrets sendgrid --allow-package-env-file --out "$VSIX_FILE" || {
    echo -e "${YELLOW}⚠ Trying without env file flag...${NC}"
    vsce package --allow-package-secrets sendgrid --out "$VSIX_FILE"
}
echo "✓ VSIX created: $VSIX_FILE"
ls -lh "$VSIX_FILE"
echo ""

echo -e "${GREEN}✅ Workflow test completed successfully!${NC}"
echo ""
echo "Next steps:"
echo "  - VSIX file created: $VSIX_FILE"
echo "  - To test publishing, you would need VSCE_PAT and OVSX_TOKEN secrets"
echo "  - For now, the VSIX is ready for manual installation/testing"
echo ""
