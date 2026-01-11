/**
 * Help Service - Provides contextual help content throughout the extension
 */
export class HelpService {
    private static instance: HelpService;
    private helpContent: Map<string, HelpContent> = new Map();

    private constructor() {
        this.initializeHelpContent();
    }

    public static getInstance(): HelpService {
        if (!HelpService.instance) {
            HelpService.instance = new HelpService();
        }
        return HelpService.instance;
    }

    private initializeHelpContent(): void {
        // Tenant Management
        this.helpContent.set('tenant.sync', {
            title: 'Tenant Synchronization',
            content: 'Background synchronization keeps tenant data up-to-date. Active sync tenants refresh at configured intervals (default: 5 minutes). Maximum 4 tenants can sync simultaneously.',
            link: 'https://developer.sailpoint.com/docs/'
        });

        this.helpContent.set('tenant.add', {
            title: 'Add Tenant',
            content: 'Add a new SailPoint ISC tenant using Personal Access Token (PAT) or short-lived access token. PAT is recommended for long-term use.',
            link: 'https://developer.sailpoint.com/docs/'
        });

        // Search
        this.helpContent.set('search.entity', {
            title: 'Entity List Search',
            content: 'Search filters the currently loaded page. Use this to quickly find entities by name. For advanced searches, use Global Search.',
            link: undefined
        });

        this.helpContent.set('search.global', {
            title: 'Global Search',
            content: 'Search across all SailPoint ISC resources using SailPoint search syntax. Examples: name:John, email:*@example.com, lifecycleState.name:active',
            link: 'https://developer.sailpoint.com/docs/api/search/'
        });

        this.helpContent.set('search.query', {
            title: 'Search Query Syntax',
            content: 'Use SailPoint search syntax: field:value, field:*pattern*, field:[range], AND/OR operators. Example: name:John OR email:*@example.com',
            link: 'https://developer.sailpoint.com/docs/api/search/'
        });

        // Pagination
        this.helpContent.set('pagination', {
            title: 'Pagination',
            content: 'Results are paginated with a maximum of 250 items per page. Use Previous/Next to navigate. Total count may be approximate for large datasets.',
            link: undefined
        });

        // Sync Management
        this.helpContent.set('sync.activate', {
            title: 'Activate Sync',
            content: 'Activates background synchronization for this tenant. Data refreshes at configured intervals (default: 5 minutes). Maximum 4 tenants can sync simultaneously.',
            link: undefined
        });

        this.helpContent.set('sync.pause', {
            title: 'Pause Sync',
            content: 'Pauses background synchronization. Cached data remains available but won\'t update automatically. You can manually refresh when needed.',
            link: undefined
        });

        // Entity Operations
        this.helpContent.set('entity.export', {
            title: 'Export Configuration',
            content: 'Export entity configuration as SP-Config JSON. Can be imported into other tenants or used for version control.',
            link: 'https://developer.sailpoint.com/docs/api/sp-config/'
        });

        this.helpContent.set('entity.import', {
            title: 'Import Configuration',
            content: 'Import SP-Config JSON to create or update entities. Dependencies are automatically resolved when possible.',
            link: 'https://developer.sailpoint.com/docs/api/sp-config/'
        });

        // Transform Help
        this.helpContent.set('transform.test', {
            title: 'Test Transform',
            content: 'Test transform with sample data to verify output before saving. Use identity or account attributes as input.',
            link: 'https://developer.sailpoint.com/docs/extensibility/transforms/'
        });

        this.helpContent.set('transform.create', {
            title: 'Create Transform',
            content: 'Create a new transform using JSON. Use snippets (tr-*) for common transform patterns. Validate before saving.',
            link: 'https://developer.sailpoint.com/docs/extensibility/transforms/'
        });

        // Source Help
        this.helpContent.set('source.aggregate', {
            title: 'Aggregate Source',
            content: 'Run aggregation to collect accounts and entitlements from the source. This may take several minutes for large sources.',
            link: 'https://developer.sailpoint.com/docs/connectors/'
        });

        this.helpContent.set('source.schema', {
            title: 'Source Schema',
            content: 'Define account attributes for this source. Use Discover Schema to automatically import attributes from the source system.',
            link: 'https://developer.sailpoint.com/docs/connectors/'
        });

        // Access Profile Help
        this.helpContent.set('access-profile.entitlements', {
            title: 'Access Profile Entitlements',
            content: 'Select entitlements to include in this access profile. Use filters to find specific entitlements. Maximum 250 shown per page.',
            link: 'https://developer.sailpoint.com/docs/access-management/'
        });

        // Role Help
        this.helpContent.set('role.membership', {
            title: 'Role Membership Criteria',
            content: 'Define criteria for automatic role assignment. Uses SCIM filter syntax. Example: identity.department eq "IT"',
            link: 'https://developer.sailpoint.com/docs/access-management/roles/'
        });

        // Workflow Help
        this.helpContent.set('workflow.test', {
            title: 'Test Workflow',
            content: 'Test workflow execution with sample input data. Check execution history for results and any errors.',
            link: 'https://developer.sailpoint.com/docs/workflows/'
        });

        // Identity Profile Help
        this.helpContent.set('identity-profile.mapping', {
            title: 'Identity Profile Mapping',
            content: 'Map source attributes to identity attributes. Transforms can be applied during mapping. Changes require identity refresh.',
            link: 'https://developer.sailpoint.com/docs/identities/identity-profiles/'
        });

        // General
        this.helpContent.set('general.refresh', {
            title: 'Refresh',
            content: 'Refresh data from the SailPoint ISC API. For synced tenants, this updates the cache immediately.',
            link: undefined
        });

        this.helpContent.set('general.cache', {
            title: 'Clear Cache',
            content: 'Clear all cached data. Next access will fetch fresh data from the API. Useful if data seems stale.',
            link: undefined
        });
    }

    public getHelp(key: string): HelpContent | undefined {
        return this.helpContent.get(key);
    }

    public getTooltip(key: string): string {
        const help = this.helpContent.get(key);
        if (!help) {
            return '';
        }
        return help.content;
    }

    public getAllHelpKeys(): string[] {
        return Array.from(this.helpContent.keys());
    }
}

export interface HelpContent {
    title: string;
    content: string;
    link?: string;
}
