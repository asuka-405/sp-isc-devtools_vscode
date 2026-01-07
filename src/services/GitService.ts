import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { LocalCacheService, CacheableEntityType } from './cache/LocalCacheService';
import { TenantService } from './TenantService';

const execAsync = promisify(exec);

/**
 * Git repository status
 */
export interface GitStatus {
    isGitInstalled: boolean;
    isRepository: boolean;
    branch?: string;
    hasUncommittedChanges: boolean;
    ahead: number;
    behind: number;
}

/**
 * Export options for git
 */
export interface GitExportOptions {
    tenantId: string;
    outputDir: string;
    entityTypes?: CacheableEntityType[];
    createCommit?: boolean;
    commitMessage?: string;
}

/**
 * Git integration service for version controlling ISC configurations
 */
export class GitService {
    private static instance: GitService;
    private gitInstalled: boolean | null = null;

    private constructor(
        private readonly tenantService: TenantService,
        private readonly context: vscode.ExtensionContext
    ) {}

    public static initialize(tenantService: TenantService, context: vscode.ExtensionContext): GitService {
        if (!GitService.instance) {
            GitService.instance = new GitService(tenantService, context);
        }
        return GitService.instance;
    }

    public static getInstance(): GitService {
        if (!GitService.instance) {
            throw new Error('GitService not initialized');
        }
        return GitService.instance;
    }

    /**
     * Check if git is installed on the system
     */
    public async isGitInstalled(): Promise<boolean> {
        if (this.gitInstalled !== null) {
            return this.gitInstalled;
        }

        try {
            await execAsync('git --version');
            this.gitInstalled = true;
        } catch {
            this.gitInstalled = false;
        }

        return this.gitInstalled;
    }

    /**
     * Check if a directory is a git repository
     */
    public async isGitRepository(dirPath: string): Promise<boolean> {
        try {
            await execAsync('git rev-parse --git-dir', { cwd: dirPath });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get git status for a directory
     */
    public async getGitStatus(dirPath: string): Promise<GitStatus> {
        const status: GitStatus = {
            isGitInstalled: await this.isGitInstalled(),
            isRepository: false,
            hasUncommittedChanges: false,
            ahead: 0,
            behind: 0
        };

        if (!status.isGitInstalled) {
            return status;
        }

        status.isRepository = await this.isGitRepository(dirPath);

        if (!status.isRepository) {
            return status;
        }

        try {
            // Get current branch
            const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd: dirPath });
            status.branch = branchOut.trim();

            // Check for uncommitted changes
            const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: dirPath });
            status.hasUncommittedChanges = statusOut.trim().length > 0;

            // Check ahead/behind
            try {
                const { stdout: aheadBehind } = await execAsync(
                    'git rev-list --left-right --count HEAD...@{upstream}',
                    { cwd: dirPath }
                );
                const [ahead, behind] = aheadBehind.trim().split('\t').map(Number);
                status.ahead = ahead || 0;
                status.behind = behind || 0;
            } catch {
                // No upstream set
            }
        } catch (error) {
            console.error('Error getting git status:', error);
        }

        return status;
    }

    /**
     * Initialize a git repository
     */
    public async initRepository(dirPath: string): Promise<boolean> {
        if (!(await this.isGitInstalled())) {
            vscode.window.showErrorMessage('Git is not installed on your system');
            return false;
        }

        try {
            // Create directory if it doesn't exist
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }

            // Initialize git
            await execAsync('git init', { cwd: dirPath });

            // Create .gitignore
            const gitignore = `# ISC DevTools
.cache/
*.log
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
`;
            fs.writeFileSync(path.join(dirPath, '.gitignore'), gitignore);

            // Create README
            const readme = `# SailPoint ISC Configuration

This repository contains exported SailPoint Identity Security Cloud configurations.

## Structure

\`\`\`
├── sources/
│   └── [source-name]/
│       ├── config.json
│       ├── schemas/
│       └── provisioning-policies/
├── transforms/
├── workflows/
├── identity-profiles/
├── access-profiles/
├── roles/
└── rules/
\`\`\`

## Usage

Use the SailPoint ISC Dev Tools VS Code extension to manage these configurations.

Generated by ISC Dev Tools
`;
            fs.writeFileSync(path.join(dirPath, 'README.md'), readme);

            // Initial commit
            await execAsync('git add .', { cwd: dirPath });
            await execAsync('git commit -m "Initial commit: ISC configuration repository"', { cwd: dirPath });

            vscode.window.showInformationMessage('Git repository initialized successfully');
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize git repository: ${error.message}`);
            return false;
        }
    }

    /**
     * Export configurations to a directory for version control
     */
    public async exportForVersionControl(options: GitExportOptions): Promise<boolean> {
        const tenantInfo = this.tenantService.getTenant(options.tenantId);
        if (!tenantInfo) {
            vscode.window.showErrorMessage('Tenant not found');
            return false;
        }

        const cacheService = LocalCacheService.getInstance();
        const entityTypes = options.entityTypes ?? Object.values(CacheableEntityType);

        try {
            // Create base directory structure
            const tenantDir = path.join(options.outputDir, this.sanitizeFilename(tenantInfo.name));
            if (!fs.existsSync(tenantDir)) {
                fs.mkdirSync(tenantDir, { recursive: true });
            }

            let exportedCount = 0;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Exporting configurations...',
                cancellable: false
            }, async (progress) => {
                for (const entityType of entityTypes) {
                    progress.report({ message: `Exporting ${entityType}...` });

                    const entities = cacheService.getAllCachedEntities(options.tenantId, entityType);
                    
                    if (entities.length === 0) continue;

                    const typeDir = path.join(tenantDir, entityType);
                    if (!fs.existsSync(typeDir)) {
                        fs.mkdirSync(typeDir, { recursive: true });
                    }

                    for (const entity of entities) {
                        const filename = `${this.sanitizeFilename(entity.name)}.json`;
                        const filepath = path.join(typeDir, filename);
                        fs.writeFileSync(filepath, JSON.stringify(entity.data, null, 2));
                        exportedCount++;
                    }
                }
            });

            // Create metadata file
            const metadata = {
                tenant: tenantInfo.name,
                tenantId: options.tenantId,
                exportedAt: new Date().toISOString(),
                entityCount: exportedCount
            };
            fs.writeFileSync(
                path.join(tenantDir, 'metadata.json'),
                JSON.stringify(metadata, null, 2)
            );

            // Git commit if requested
            if (options.createCommit && await this.isGitRepository(options.outputDir)) {
                const message = options.commitMessage ?? `Export ${tenantInfo.name} configurations`;
                await execAsync(`git add .`, { cwd: options.outputDir });
                await execAsync(`git commit -m "${message}"`, { cwd: options.outputDir });
                vscode.window.showInformationMessage(`Exported ${exportedCount} configurations and created git commit`);
            } else {
                vscode.window.showInformationMessage(`Exported ${exportedCount} configurations`);
            }

            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Export failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Import configurations from a directory
     */
    public async importFromDirectory(
        tenantId: string,
        dirPath: string
    ): Promise<{ success: number; failed: number }> {
        const cacheService = LocalCacheService.getInstance();
        const result = { success: 0, failed: 0 };

        try {
            const entityTypes = fs.readdirSync(dirPath)
                .filter(f => fs.statSync(path.join(dirPath, f)).isDirectory())
                .filter(f => Object.values(CacheableEntityType).includes(f as CacheableEntityType));

            for (const entityType of entityTypes) {
                const typeDir = path.join(dirPath, entityType);
                const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.json'));

                for (const file of files) {
                    try {
                        const filepath = path.join(typeDir, file);
                        const content = fs.readFileSync(filepath, 'utf-8');
                        const data = JSON.parse(content);

                        await cacheService.cacheEntity(
                            tenantId,
                            entityType as CacheableEntityType,
                            data.id,
                            data.name,
                            data
                        );
                        result.success++;
                    } catch (e) {
                        console.error(`Failed to import ${file}:`, e);
                        result.failed++;
                    }
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Import failed: ${error.message}`);
        }

        return result;
    }

    /**
     * Show prompt to set up version control
     */
    public async promptVersionControlSetup(tenantId: string): Promise<void> {
        if (!(await this.isGitInstalled())) {
            const install = await vscode.window.showWarningMessage(
                'Git is not installed. Would you like to learn how to install it?',
                'Learn More'
            );
            if (install === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
            }
            return;
        }

        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) return;

        const action = await vscode.window.showInformationMessage(
            `Would you like to set up version control for ${tenantInfo.name} configurations?`,
            'Set Up',
            'Later'
        );

        if (action !== 'Set Up') return;

        // Let user choose directory
        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select directory for configuration repository'
        });

        if (!uri || uri.length === 0) return;

        const dirPath = uri[0].fsPath;
        const isRepo = await this.isGitRepository(dirPath);

        if (!isRepo) {
            const init = await vscode.window.showInformationMessage(
                'Selected directory is not a git repository. Initialize one?',
                'Initialize',
                'Cancel'
            );
            if (init !== 'Initialize') return;
            await this.initRepository(dirPath);
        }

        // Export configurations
        await this.exportForVersionControl({
            tenantId,
            outputDir: dirPath,
            createCommit: true,
            commitMessage: `Initial export of ${tenantInfo.name} configurations`
        });
    }

    /**
     * Show diff between local and git versions
     */
    public async showGitDiff(filePath: string): Promise<void> {
        if (!(await this.isGitInstalled())) return;

        const dirPath = path.dirname(filePath);
        if (!(await this.isGitRepository(dirPath))) return;

        try {
            // Get the last committed version
            const repoRoot = await this.getRepoRoot(dirPath);
            const relPath = path.relative(repoRoot, filePath);
            // Normalize path separators to forward slashes for git
            const normalizedPath = relPath.replace(/\\/g, '/');
            const { stdout } = await execAsync(
                `git show HEAD:${normalizedPath}`,
                { cwd: dirPath }
            );

            // Create a virtual document for the committed version
            const committedUri = vscode.Uri.parse(`isc-git:committed/${path.basename(filePath)}`);
            const currentUri = vscode.Uri.file(filePath);

            // Show diff
            await vscode.commands.executeCommand(
                'vscode.diff',
                committedUri,
                currentUri,
                `${path.basename(filePath)} (Committed ↔ Current)`
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to show diff: ${error.message}`);
        }
    }

    /**
     * Get git repository root
     */
    private async getRepoRoot(dirPath: string): Promise<string> {
        const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: dirPath });
        return stdout.trim();
    }

    /**
     * Sanitize filename for filesystem
     */
    private sanitizeFilename(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    /**
     * Create a commit with all current changes
     */
    public async commitChanges(dirPath: string, message: string): Promise<boolean> {
        if (!(await this.isGitInstalled())) {
            vscode.window.showErrorMessage('Git is not installed');
            return false;
        }

        if (!(await this.isGitRepository(dirPath))) {
            vscode.window.showErrorMessage('Not a git repository');
            return false;
        }

        try {
            await execAsync('git add .', { cwd: dirPath });
            await execAsync(`git commit -m "${message}"`, { cwd: dirPath });
            vscode.window.showInformationMessage('Changes committed successfully');
            return true;
        } catch (error: any) {
            if (error.message.includes('nothing to commit')) {
                vscode.window.showInformationMessage('No changes to commit');
                return true;
            }
            vscode.window.showErrorMessage(`Commit failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Get commit history
     */
    public async getCommitHistory(dirPath: string, limit: number = 10): Promise<Array<{
        hash: string;
        message: string;
        author: string;
        date: string;
    }>> {
        if (!(await this.isGitRepository(dirPath))) {
            return [];
        }

        try {
            const { stdout } = await execAsync(
                `git log --pretty=format:"%H|%s|%an|%ar" -n ${limit}`,
                { cwd: dirPath }
            );

            return stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, message, author, date] = line.split('|');
                return { hash, message, author, date };
            });
        } catch {
            return [];
        }
    }
}

