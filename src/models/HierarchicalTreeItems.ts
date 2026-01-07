import * as vscode from 'vscode';
import { ISCClient } from '../services/ISCClient';
import { LocalCacheService, CacheableEntityType } from '../services/cache/LocalCacheService';
import { BaseTreeItem, ISCResourceTreeItem } from './ISCTreeItem';
import { getResourceUri, getUIUrl } from '../utils/UriUtils';
import { compareByName, compareByLabel } from '../utils';
import * as commands from '../commands/constants';

/**
 * Enhanced Source Tree Item with nested children
 * Shows: Configuration, Schemas, Provisioning Policies, Connector Rules, Related Access Profiles
 */
export class EnhancedSourceTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        public readonly type: string,
        public readonly delimiter: string,
        public readonly connectorRuleNames: string[] = [],
        private readonly allConnectorRules: Map<string, { id: string; name: string }> = new Map()
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'sources',
            id,
            collapsible: vscode.TreeItemCollapsibleState.Collapsed
        });
        this.contextValue = `${type.replaceAll(' ', '')}source`;
    }

    async getChildren(): Promise<BaseTreeItem[]> {
        const results: BaseTreeItem[] = [];
        
        // Configuration node (the source config itself)
        results.push(new SourceConfigurationTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.id,
            this.label as string
        ));
        
        // Schemas
        results.push(new SourceSchemasTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.uri
        ));
        
        // Provisioning Policies
        results.push(new SourceProvisioningPoliciesTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.uri
        ));
        
        // Connector Rules (rules that reference this source)
        if (this.connectorRuleNames.length > 0) {
            results.push(new SourceConnectorRulesTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                this.id,
                this.connectorRuleNames,
                this.allConnectorRules
            ));
        }
        
        // Related Access Profiles
        results.push(new SourceAccessProfilesTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.id,
            this.label as string
        ));
        
        // Related Roles (that provision to this source)
        results.push(new SourceRolesTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.id,
            this.label as string
        ));
        
        return results;
    }

    updateIcon(context: vscode.ExtensionContext): void {
        this.iconPath = {
            light: context.asAbsolutePath('resources/light/source.svg'),
            dark: context.asAbsolutePath('resources/dark/source.svg'),
        };
    }

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/a/admin/connections/sources', this.id);
    }
}

/**
 * Source Configuration node - opens the source JSON config
 */
export class SourceConfigurationTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        sourceId: string,
        sourceName: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label: '⚙️ Configuration',
            resourceType: 'sources',
            id: sourceId,
        });
    }

    contextValue = 'source-configuration';
    iconPath = new vscode.ThemeIcon('settings-gear');
}

/**
 * Schemas folder under a source
 */
export class SourceSchemasTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly parentUri: vscode.Uri
    ) {
        super('📊 Schemas', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('symbol-class');
    contextValue = 'source-schemas';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const sourceId = this.parentUri.path.split('/')[2]; // Extract source ID from URI
        const schemas = await client.getSchemas(sourceId);
        
        return schemas
            .sort(compareByName)
            .map(schema => new SourceSchemaTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                schema.name!,
                sourceId,
                schema.id!
            ));
    }
}

/**
 * Individual schema under a source
 */
export class SourceSchemaTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        sourceId: string,
        schemaId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'sources',
            id: schemaId,
            parentId: sourceId,
            subResourceType: 'schemas',
            subId: schemaId
        });
    }

    iconPath = new vscode.ThemeIcon('symbol-class');
    contextValue = 'source-schema';
}

/**
 * Provisioning Policies folder under a source
 */
export class SourceProvisioningPoliciesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly parentUri: vscode.Uri
    ) {
        super('🔧 Provisioning Policies', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('tools');
    contextValue = 'source-provisioning-policies';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const sourceId = this.parentUri.path.split('/')[2];
        const policies = await client.getProvisioningPolicies(sourceId);
        
        return policies
            .sort(compareByLabel)
            .map(policy => new SourceProvisioningPolicyTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                policy.name || policy.usageType!,
                sourceId,
                policy.usageType!
            ));
    }
}

/**
 * Individual provisioning policy
 */
export class SourceProvisioningPolicyTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        sourceId: string,
        usageType: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'sources',
            id: `${sourceId}-${usageType}`,
            parentId: sourceId,
            subResourceType: 'provisioning-policies',
            subId: usageType
        });
    }

    iconPath = new vscode.ThemeIcon('circuit-board');
    contextValue = 'source-provisioning-policy';
}

/**
 * Connector Rules folder under a source
 */
export class SourceConnectorRulesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly sourceId: string,
        private readonly connectorRuleNames: string[],
        private readonly allConnectorRules: Map<string, { id: string; name: string }>
    ) {
        super('📜 Connector Rules', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('file-code');
    contextValue = 'source-connector-rules';

    async getChildren(): Promise<BaseTreeItem[]> {
        const results: BaseTreeItem[] = [];
        
        for (const ruleName of this.connectorRuleNames) {
            const rule = this.allConnectorRules.get(ruleName);
            if (rule) {
                results.push(new SourceConnectorRuleTreeItem(
                    this.tenantId,
                    this.tenantName,
                    this.tenantDisplayName,
                    rule.name,
                    rule.id
                ));
            }
        }
        
        return results.sort(compareByLabel);
    }
}

/**
 * Individual connector rule under a source
 */
export class SourceConnectorRuleTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        ruleId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'connector-rules',
            id: ruleId
        });
    }

    iconPath = new vscode.ThemeIcon('file-code');
    contextValue = 'source-connector-rule';
}

/**
 * Access Profiles folder under a source
 */
export class SourceAccessProfilesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly sourceId: string,
        private readonly sourceName: string
    ) {
        super('🎫 Access Profiles', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('archive');
    contextValue = 'source-access-profiles';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        
        // Get access profiles for this source
        const response = await client.getAccessProfiles({
            filters: `source.id eq "${this.sourceId}"`,
            limit: 250,
            count: false
        });
        
        const accessProfiles = response.data || [];
        
        return accessProfiles
            .sort(compareByName)
            .map(ap => new SourceAccessProfileTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                ap.name!,
                ap.id!
            ));
    }
}

/**
 * Individual access profile under a source
 */
export class SourceAccessProfileTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        accessProfileId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'access-profiles',
            id: accessProfileId
        });
    }

    iconPath = new vscode.ThemeIcon('archive');
    contextValue = 'source-access-profile';

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/a/admin/access/access-profiles/manage', this.id);
    }
}

/**
 * Roles folder under a source (roles that provision to this source)
 */
export class SourceRolesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly sourceId: string,
        private readonly sourceName: string
    ) {
        super('👔 Roles', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('account');
    contextValue = 'source-roles';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        
        // Search for roles that have access profiles from this source
        // This requires searching through the access profiles in each role
        // For now, we'll search roles and filter client-side
        const response = await client.getRoles({
            limit: 250,
            count: false
        });
        
        const roles = (response.data || []).filter(role => {
            // Check if any access profile in this role is from our source
            const accessProfiles = role.accessProfiles || [];
            return accessProfiles.some((ap: any) => ap.source?.id === this.sourceId);
        });
        
        return roles
            .sort(compareByName)
            .map(role => new SourceRoleTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                role.name!,
                role.id!
            ));
    }
}

/**
 * Individual role under a source
 */
export class SourceRoleTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        roleId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'roles',
            id: roleId
        });
    }

    iconPath = new vscode.ThemeIcon('account');
    contextValue = 'source-role';

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/a/admin/access/roles/manage', this.id);
    }
}

/**
 * Category folder for grouping entities
 */
export class CategoryTreeItem extends BaseTreeItem {
    constructor(
        label: string,
        public readonly contextValue: string,
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly childrenProvider: () => Promise<BaseTreeItem[]>,
        private iconId: string = 'folder'
    ) {
        super(label, tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon(this.iconId);

    async getChildren(): Promise<BaseTreeItem[]> {
        return await this.childrenProvider();
    }
}

/**
 * Enhanced Sources folder that builds hierarchical view
 */
export class EnhancedSourcesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📦 Sources', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('server');
    contextValue = 'sources';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        
        // Get all sources and connector rules
        const [sources, connectorRules] = await Promise.all([
            client.getSources(),
            client.getConnectorRules()
        ]);
        
        // Build a map of connector rules by name
        const rulesMap = new Map<string, { id: string; name: string }>();
        for (const rule of connectorRules) {
            rulesMap.set(rule.name!, { id: rule.id!, name: rule.name! });
        }
        
        // For each source, extract the connector rule names from connectorAttributes
        const results: BaseTreeItem[] = [];
        
        for (const source of sources) {
            if (!source.name || !source.id || !source.type) continue;
            
            // Extract connector rule names from source config
            const connectorRuleNames: string[] = [];
            const connAttrs = source.connectorAttributes as any;
            
            if (connAttrs) {
                // Check various rule references in connector attributes
                const ruleFields = [
                    'beforeProvisioningRule', 'afterProvisioningRule',
                    'accountCorrelationRule', 'managerCorrelationRule',
                    'beforeRule', 'afterRule'
                ];
                
                for (const field of ruleFields) {
                    if (connAttrs[field]) {
                        connectorRuleNames.push(connAttrs[field]);
                    }
                }
                
                // Check connection parameters for rules
                if (connAttrs.connectionParameters && Array.isArray(connAttrs.connectionParameters)) {
                    for (const param of connAttrs.connectionParameters) {
                        if (param.beforeRule) connectorRuleNames.push(param.beforeRule);
                        if (param.afterRule) connectorRuleNames.push(param.afterRule);
                    }
                }
            }
            
            // Also check source-level rule references
            if (source.beforeProvisioningRule?.name) {
                connectorRuleNames.push(source.beforeProvisioningRule.name);
            }
            if (source.accountCorrelationRule?.name) {
                connectorRuleNames.push(source.accountCorrelationRule.name);
            }
            if (source.managerCorrelationRule?.name) {
                connectorRuleNames.push(source.managerCorrelationRule.name);
            }
            
            // Deduplicate rule names
            const uniqueRuleNames = [...new Set(connectorRuleNames)];
            
            results.push(new EnhancedSourceTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                source.name,
                source.id,
                source.type,
                connAttrs?.delimiter ?? '',
                uniqueRuleNames,
                rulesMap
            ));
        }
        
        return results;
    }
}

/**
 * Identity Management category
 */
export class IdentityManagementTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('👤 Identity Management', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('person');
    contextValue = 'identity-management';

    async getChildren(): Promise<BaseTreeItem[]> {
        return [
            new IdentityProfilesFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new IdentityAttributesFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new CloudRulesFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
        ];
    }
}

/**
 * Identity Profiles folder with enhanced children
 */
export class IdentityProfilesFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📋 Identity Profiles', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('person-add');
    contextValue = 'identity-profiles-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const profiles = await client.getIdentityProfiles();
        
        return profiles
            .sort(compareByName)
            .map(profile => new EnhancedIdentityProfileTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                `${profile.name} (${profile.authoritativeSource?.name?.replace(/ \[source.*\]/, '') ?? ''})`,
                profile.id!,
                profile.authoritativeSource?.id
            ));
    }
}

/**
 * Enhanced Identity Profile with more details
 */
export class EnhancedIdentityProfileTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        private readonly authSourceId?: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'identity-profiles',
            id,
            collapsible: vscode.TreeItemCollapsibleState.Collapsed
        });
    }

    iconPath = new vscode.ThemeIcon('person-add');
    contextValue = 'identity-profile';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const results: BaseTreeItem[] = [];
        
        // Configuration
        results.push(new IdentityProfileConfigTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.id
        ));
        
        // Lifecycle States
        const lifecycleStates = await client.getLifecycleStates(this.id);
        if (lifecycleStates.length > 0) {
            results.push(new IdentityProfileLifecycleStatesTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                this.id,
                lifecycleStates
            ));
        }
        
        // Attribute Mappings (virtual - opens a UI panel)
        results.push(new IdentityProfileMappingsTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            this.id
        ));
        
        return results;
    }

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/ip/admin/identity-profiles', this.id);
    }
}

/**
 * Identity Profile Configuration node
 */
export class IdentityProfileConfigTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        profileId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label: '⚙️ Configuration',
            resourceType: 'identity-profiles',
            id: profileId
        });
    }

    iconPath = new vscode.ThemeIcon('settings-gear');
    contextValue = 'identity-profile-config';
}

/**
 * Lifecycle States folder under Identity Profile
 */
export class IdentityProfileLifecycleStatesTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly profileId: string,
        private readonly states: any[]
    ) {
        super('🔄 Lifecycle States', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('activate-breakpoints');
    contextValue = 'lifecycle-states-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        return this.states.map(state => new LifecycleStateTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            state.name,
            this.profileId,
            state.id
        ));
    }
}

/**
 * Lifecycle State tree item
 */
export class LifecycleStateTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        parentId: string,
        stateId: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'identity-profiles',
            id: stateId,
            parentId,
            subResourceType: 'lifecycle-states',
            subId: stateId
        });
    }

    iconPath = new vscode.ThemeIcon('activate-breakpoints');
    contextValue = 'lifecycle-state';
}

/**
 * Attribute Mappings node (opens UI panel)
 */
export class IdentityProfileMappingsTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly profileId: string
    ) {
        super('🗺️ Attribute Mappings', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.None);
    }

    iconPath = new vscode.ThemeIcon('symbol-property');
    contextValue = 'identity-profile-mappings';
    
    command = {
        title: 'Open Attribute Mappings',
        command: 'sp-isc-devtools.open-identity-mappings-panel',
        arguments: [this.tenantId, this.tenantName, this.profileId]
    };

    async getChildren(): Promise<BaseTreeItem[]> {
        return [];
    }
}

/**
 * Identity Attributes folder
 */
export class IdentityAttributesFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📊 Identity Attributes', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('list-selection');
    contextValue = 'identity-attributes-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const attributes = await client.getIdentityAttributes();
        
        return attributes
            .sort(compareByName)
            .map(attr => new IdentityAttributeTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                `${attr.displayName} (${attr.name})`,
                attr.name!
            ));
    }
}

/**
 * Identity Attribute tree item
 */
export class IdentityAttributeTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        name: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'identity-attributes',
            id: `${tenantId}/${name}`,
            resourceId: name
        });
    }

    iconPath = new vscode.ThemeIcon('list-selection');
    contextValue = 'identity-attribute';
}

/**
 * Cloud Rules folder (non-connector rules)
 */
export class CloudRulesFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📜 Cloud Rules', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('file-code');
    contextValue = 'cloud-rules-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        // Cloud rules are identity attribute rules, not connector rules
        // These are referenced in identity profiles by rule type
        // For now, return empty - can be expanded later
        return [];
    }
}

/**
 * Automation category
 */
export class AutomationTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('⚡ Automation', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('zap');
    contextValue = 'automation';

    async getChildren(): Promise<BaseTreeItem[]> {
        return [
            new WorkflowsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new FormsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new TriggerSubscriptionsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
        ];
    }
}

/**
 * Workflows folder
 */
export class WorkflowsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🔄 Workflows', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('git-merge');
    contextValue = 'workflows-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const workflows = await client.getWorflows();
        
        return workflows
            .sort(compareByName)
            .map(wf => new WorkflowTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                wf.name!,
                wf.id!,
                wf.enabled!
            ));
    }
}

/**
 * Workflow tree item
 */
export class WorkflowTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        public enabled: boolean
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'workflows',
            resourceId: id,
            id: `${tenantId}-${id}`
        });
    }

    contextValue = 'workflow';

    get computedContextValue() {
        return this.enabled ? 'enabledWorkflow' : 'disabledWorkflow';
    }

    updateIcon(context: vscode.ExtensionContext): void {
        if (this.enabled) {
            this.iconPath = {
                light: context.asAbsolutePath('resources/light/workflow-enabled.svg'),
                dark: context.asAbsolutePath('resources/dark/workflow-enabled.svg'),
            };
        } else {
            this.iconPath = {
                light: context.asAbsolutePath('resources/light/workflow-disabled.svg'),
                dark: context.asAbsolutePath('resources/dark/workflow-disabled.svg'),
            };
        }
    }

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/wf/edit', this.resourceId);
    }
}

/**
 * Forms folder
 */
export class FormsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📝 Forms', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('preview');
    contextValue = 'forms-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const forms: BaseTreeItem[] = [];
        
        for await (const form of client.getForms()) {
            forms.push(new FormTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                form.name!,
                form.id!
            ));
        }
        
        return forms.sort(compareByLabel);
    }
}

/**
 * Form tree item
 */
export class FormTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'form-definitions',
            id: `${tenantId}-${id}`,
            resourceId: id
        });
    }

    iconPath = new vscode.ThemeIcon('preview');
    contextValue = 'form-definition';

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/a/admin/globals/forms/edit', this.resourceId);
    }
}

/**
 * Trigger Subscriptions folder
 */
export class TriggerSubscriptionsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🎯 Trigger Subscriptions', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('broadcast');
    contextValue = 'trigger-subscriptions-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        // TODO: Implement trigger subscriptions listing
        return [];
    }
}

/**
 * Configuration category
 */
export class ConfigurationTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🔧 Configuration', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('settings');
    contextValue = 'configuration';

    async getChildren(): Promise<BaseTreeItem[]> {
        return [
            new TransformsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new ServiceDesksFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new SegmentsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
            new TagsFolderTreeItem(this.tenantId, this.tenantName, this.tenantDisplayName),
        ];
    }
}

/**
 * Transforms folder with reference discovery
 */
export class TransformsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🔄 Transforms', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('symbol-function');
    contextValue = 'transforms-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const transforms = await client.getTransforms();
        
        return transforms
            .sort(compareByName)
            .map(t => new TransformTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                t.name!,
                t.id!,
                t.type!
            ));
    }
}

/**
 * Transform tree item with reference discovery
 */
export class TransformTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        public readonly transformType: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'transforms',
            id
        });
        this.tooltip = `Type: ${transformType}`;
    }

    contextValue = 'transform';

    updateIcon(context: vscode.ExtensionContext): void {
        this.iconPath = {
            light: context.asAbsolutePath('resources/light/transform.svg'),
            dark: context.asAbsolutePath('resources/dark/transform.svg'),
        };
    }
}

/**
 * Service Desks folder
 */
export class ServiceDesksFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🎫 Service Desk Integrations', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('gear');
    contextValue = 'service-desks-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const serviceDesks = await client.getServiceDesks();
        
        return serviceDesks
            .sort(compareByName)
            .map(sd => new ServiceDeskTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                sd.name!,
                sd.id!,
                sd.type!
            ));
    }
}

/**
 * Service Desk tree item
 */
export class ServiceDeskTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        public readonly sdType: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'service-desk-integrations',
            id
        });
    }

    iconPath = new vscode.ThemeIcon('gear');
    contextValue = 'service-desk-integration';

    getUrl(): vscode.Uri | undefined {
        return getUIUrl(this.tenantName, 'ui/h/admin/connections/servicedesk', this.id, 'edit');
    }
}

/**
 * Segments folder
 */
export class SegmentsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('📊 Segments', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('pie-chart');
    contextValue = 'segments-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        const client = new ISCClient(this.tenantId, this.tenantName);
        const segments = await client.getSegments();
        
        return segments
            .sort(compareByName)
            .map(s => new SegmentTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                s.name!,
                s.id!
            ));
    }
}

/**
 * Segment tree item
 */
export class SegmentTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: 'segments',
            id
        });
    }

    iconPath = new vscode.ThemeIcon('pie-chart');
    contextValue = 'segment';
}

/**
 * Tags folder
 */
export class TagsFolderTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string
    ) {
        super('🏷️ Tags', tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('tag');
    contextValue = 'tags-folder';

    async getChildren(): Promise<BaseTreeItem[]> {
        // TODO: Implement tags listing
        return [];
    }
}

/**
 * Search Results category for global search
 */
export class SearchResultsTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private searchResults: any[]
    ) {
        super(`🔍 Search Results (${searchResults.length})`, tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Expanded);
    }

    iconPath = new vscode.ThemeIcon('search');
    contextValue = 'search-results';

    async getChildren(): Promise<BaseTreeItem[]> {
        // Group results by type
        const grouped = new Map<string, any[]>();
        
        for (const result of this.searchResults) {
            const type = result._type || 'unknown';
            if (!grouped.has(type)) {
                grouped.set(type, []);
            }
            grouped.get(type)!.push(result);
        }
        
        const results: BaseTreeItem[] = [];
        
        for (const [type, items] of grouped) {
            results.push(new SearchResultTypeTreeItem(
                this.tenantId,
                this.tenantName,
                this.tenantDisplayName,
                type,
                items
            ));
        }
        
        return results;
    }
}

/**
 * Search result type group
 */
export class SearchResultTypeTreeItem extends BaseTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        private readonly resultType: string,
        private readonly items: any[]
    ) {
        super(`${resultType} (${items.length})`, tenantId, tenantName, tenantDisplayName, vscode.TreeItemCollapsibleState.Collapsed);
    }

    iconPath = new vscode.ThemeIcon('folder');
    contextValue = 'search-result-type';

    async getChildren(): Promise<BaseTreeItem[]> {
        return this.items.map(item => new SearchResultItemTreeItem(
            this.tenantId,
            this.tenantName,
            this.tenantDisplayName,
            item.name || item.id,
            item.id,
            this.resultType,
            item
        ));
    }
}

/**
 * Individual search result item
 */
export class SearchResultItemTreeItem extends ISCResourceTreeItem {
    constructor(
        tenantId: string,
        tenantName: string,
        tenantDisplayName: string,
        label: string,
        id: string,
        private readonly resultType: string,
        private readonly data: any
    ) {
        super({
            tenantId,
            tenantName,
            tenantDisplayName,
            label,
            resourceType: resultType as any,
            id
        });
        this.description = this.data.description?.substring(0, 50);
    }

    contextValue = 'search-result-item';
    iconPath = new vscode.ThemeIcon('file');
}

