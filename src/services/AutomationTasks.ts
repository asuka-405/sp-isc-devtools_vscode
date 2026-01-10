import { ISCClient } from './ISCClient';
import { SearchService } from './SearchService';
import { AccessProfile } from 'sailpoint-api-client';
import * as vscode from 'vscode';
import { stringToAttributeMetadata } from '../utils/metadataUtils';

/**
 * Task configuration interface
 */
export interface TaskConfig {
    [key: string]: any;
}

/**
 * Task result interface
 */
export interface TaskResult {
    success: boolean;
    message: string;
    data?: any;
    errors?: string[];
}

/**
 * Task definition interface
 */
export interface TaskDefinition {
    id: string;
    name: string;
    description: string;
    icon: string;
    inputType: 'search' | 'csv' | 'both';
    inputEntityType?: string; // e.g., 'entitlements', 'identities'
    configFields: TaskConfigField[];
    execute: (client: ISCClient, tenantId: string, tenantName: string, inputData: any[], config: TaskConfig) => Promise<TaskResult>;
}

/**
 * Task configuration field definition
 */
export interface TaskConfigField {
    name: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'number';
    required: boolean;
    placeholder?: string;
    defaultValue?: string;
    options?: { value: string; label: string }[];
    helpText?: string;
    supportsPlaceholders?: boolean; // If true, can use placeholders like {{entitlement.name}}
}

/**
 * Automation Tasks Service
 */
export class AutomationTasksService {
    private static instance: AutomationTasksService;
    private tasks: Map<string, TaskDefinition> = new Map();

    private constructor() {
        this.registerTasks();
    }

    public static getInstance(): AutomationTasksService {
        if (!AutomationTasksService.instance) {
            AutomationTasksService.instance = new AutomationTasksService();
        }
        return AutomationTasksService.instance;
    }

    /**
     * Register all available tasks
     */
    private registerTasks(): void {
        // Register Bundle Entitlements into Access Profile task
        this.tasks.set('bundle-entitlements-access-profile', {
            id: 'bundle-entitlements-access-profile',
            name: 'Bundle Entitlements into Access Profile',
            description: 'Create one access profile per entitlement from entitlements found via search query or CSV file',
            icon: '📦',
            inputType: 'both',
            inputEntityType: 'entitlements',
            configFields: [
                {
                    name: 'name',
                    label: 'Access Profile Name',
                    type: 'text',
                    required: true,
                    placeholder: 'e.g., {{entitlement.source.name}} - {{entitlement.name}}',
                    supportsPlaceholders: true,
                    helpText: 'Use {{entitlement.name}}, {{entitlement.source.name}}, {{entitlement.type}}, {{entitlement.id}} as placeholders. One profile created per entitlement.'
                },
                {
                    name: 'description',
                    label: 'Description',
                    type: 'textarea',
                    required: false,
                    placeholder: 'Access profile for {{entitlement.name}} from {{entitlement.source.name}}',
                    supportsPlaceholders: true
                },
                {
                    name: 'owner',
                    label: 'Owner (Identity)',
                    type: 'text',
                    required: true,
                    placeholder: 'Search and select identity...',
                    helpText: 'Identity who will own this access profile. Use identity search to select.'
                },
                {
                    name: 'enabled',
                    label: 'Enabled',
                    type: 'checkbox',
                    required: false,
                    defaultValue: 'true'
                },
                {
                    name: 'requestable',
                    label: 'Requestable',
                    type: 'checkbox',
                    required: false,
                    defaultValue: 'true'
                },
                {
                    name: 'commentsRequired',
                    label: 'Comments Required on Request',
                    type: 'checkbox',
                    required: false,
                    defaultValue: 'false',
                    helpText: 'Require comments when requesting this access profile'
                },
                {
                    name: 'denialCommentsRequired',
                    label: 'Comments Required on Denial',
                    type: 'checkbox',
                    required: false,
                    defaultValue: 'false',
                    helpText: 'Require comments when denying a request for this access profile'
                },
                {
                    name: 'approvalLevel1',
                    label: 'Approval Level 1',
                    type: 'select',
                    required: false,
                    options: [
                        { value: '', label: 'None' },
                        { value: 'APP_OWNER', label: 'Application Owner' },
                        { value: 'OWNER', label: 'Access Profile Owner' },
                        { value: 'SOURCE_OWNER', label: 'Source Owner' },
                        { value: 'MANAGER', label: 'Manager' },
                        { value: 'GOVERNANCE_GROUP', label: 'Governance Group' },
                        { value: 'IDENTITY', label: 'Specific Identity' }
                    ],
                    helpText: 'First level of approval'
                },
                {
                    name: 'approvalLevel1GovGroup',
                    label: 'Approval Level 1 - Governance Group',
                    type: 'text',
                    required: false,
                    placeholder: 'Governance group name (if Level 1 is Governance Group)',
                    helpText: 'Required if Approval Level 1 is set to Governance Group'
                },
                {
                    name: 'approvalLevel1Identity',
                    label: 'Approval Level 1 - Identity',
                    type: 'text',
                    required: false,
                    placeholder: 'Search and select identity...',
                    helpText: 'Required if Approval Level 1 is set to Specific Identity'
                },
                {
                    name: 'approvalLevel2',
                    label: 'Approval Level 2',
                    type: 'select',
                    required: false,
                    options: [
                        { value: '', label: 'None' },
                        { value: 'APP_OWNER', label: 'Application Owner' },
                        { value: 'OWNER', label: 'Access Profile Owner' },
                        { value: 'SOURCE_OWNER', label: 'Source Owner' },
                        { value: 'MANAGER', label: 'Manager' },
                        { value: 'GOVERNANCE_GROUP', label: 'Governance Group' },
                        { value: 'IDENTITY', label: 'Specific Identity' }
                    ],
                    helpText: 'Second level of approval (optional)'
                },
                {
                    name: 'approvalLevel2GovGroup',
                    label: 'Approval Level 2 - Governance Group',
                    type: 'text',
                    required: false,
                    placeholder: 'Governance group name (if Level 2 is Governance Group)',
                    helpText: 'Required if Approval Level 2 is set to Governance Group'
                },
                {
                    name: 'approvalLevel2Identity',
                    label: 'Approval Level 2 - Identity',
                    type: 'text',
                    required: false,
                    placeholder: 'Search and select identity...',
                    helpText: 'Required if Approval Level 2 is set to Specific Identity'
                },
                {
                    name: 'approvalLevel3',
                    label: 'Approval Level 3',
                    type: 'select',
                    required: false,
                    options: [
                        { value: '', label: 'None' },
                        { value: 'APP_OWNER', label: 'Application Owner' },
                        { value: 'OWNER', label: 'Access Profile Owner' },
                        { value: 'SOURCE_OWNER', label: 'Source Owner' },
                        { value: 'MANAGER', label: 'Manager' },
                        { value: 'GOVERNANCE_GROUP', label: 'Governance Group' },
                        { value: 'IDENTITY', label: 'Specific Identity' }
                    ],
                    helpText: 'Third level of approval (optional)'
                },
                {
                    name: 'approvalLevel3GovGroup',
                    label: 'Approval Level 3 - Governance Group',
                    type: 'text',
                    required: false,
                    placeholder: 'Governance group name (if Level 3 is Governance Group)',
                    helpText: 'Required if Approval Level 3 is set to Governance Group'
                },
                {
                    name: 'approvalLevel3Identity',
                    label: 'Approval Level 3 - Identity',
                    type: 'text',
                    required: false,
                    placeholder: 'Search and select identity...',
                    helpText: 'Required if Approval Level 3 is set to Specific Identity'
                },
                {
                    name: 'revokeApprovalLevel1',
                    label: 'Revocation Approval Level 1',
                    type: 'select',
                    required: false,
                    options: [
                        { value: '', label: 'None' },
                        { value: 'APP_OWNER', label: 'Application Owner' },
                        { value: 'OWNER', label: 'Access Profile Owner' },
                        { value: 'SOURCE_OWNER', label: 'Source Owner' },
                        { value: 'MANAGER', label: 'Manager' },
                        { value: 'GOVERNANCE_GROUP', label: 'Governance Group' },
                        { value: 'IDENTITY', label: 'Specific Identity' }
                    ],
                    helpText: 'First level of approval for revocation'
                },
                {
                    name: 'revokeApprovalLevel1GovGroup',
                    label: 'Revocation Approval Level 1 - Governance Group',
                    type: 'text',
                    required: false,
                    placeholder: 'Governance group name (if Revocation Level 1 is Governance Group)',
                    helpText: 'Required if Revocation Approval Level 1 is set to Governance Group'
                },
                {
                    name: 'revokeApprovalLevel1Identity',
                    label: 'Revocation Approval Level 1 - Identity',
                    type: 'text',
                    required: false,
                    placeholder: 'Search and select identity...',
                    helpText: 'Required if Revocation Approval Level 1 is set to Specific Identity'
                },
                {
                    name: 'metadata',
                    label: 'Metadata (Key:Value pairs)',
                    type: 'textarea',
                    required: false,
                    placeholder: 'key1:value1,value2;key2:value3',
                    helpText: 'Format: key1:value1,value2;key2:value3. Use {{entitlement.*}} placeholders for dynamic values.'
                }
            ],
            execute: this.executeBundleEntitlementsAccessProfile.bind(this)
        });

        // Add more tasks here as needed
    }

    /**
     * Get all registered tasks
     */
    public getAllTasks(): TaskDefinition[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get a specific task by ID
     */
    public getTask(taskId: string): TaskDefinition | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Execute: Bundle Entitlements into Access Profile
     * Creates one access profile per entitlement
     */
    private async executeBundleEntitlementsAccessProfile(
        client: ISCClient,
        tenantId: string,
        tenantName: string,
        entitlements: any[],
        config: TaskConfig
    ): Promise<TaskResult> {
        try {
            if (!entitlements || entitlements.length === 0) {
                return {
                    success: false,
                    message: 'No entitlements provided',
                    errors: ['At least one entitlement is required']
                };
            }

            // Get owner identity - config.owner should be identity ID from search
            const ownerId = config.owner?.trim();
            if (!ownerId) {
                return {
                    success: false,
                    message: 'Owner is required',
                    errors: ['Owner must be selected']
                };
            }

            // Get owner identity details
            let ownerName = '';
            try {
                const ownerResource = await client.getIdentity(ownerId);
                ownerName = ownerResource.name || ownerResource.displayName || ownerId;
            } catch (error: any) {
                console.error('[AutomationTasks] Error fetching owner identity:', error);
                return {
                    success: false,
                    message: 'Owner not found',
                    errors: [`Could not find identity with ID: ${ownerId}. Error: ${error.message || String(error)}`]
                };
            }

            // Build approval schemes
            const approvalSchemes = await this.buildApprovalSchemes(config, client, tenantId);
            const revokeApprovalSchemes = await this.buildApprovalSchemes(config, client, tenantId, true);

            // Process metadata template if provided
            const metadataTemplate = config.metadata?.trim();

            const createdProfiles: string[] = [];
            const errors: string[] = [];

            // Create one access profile per entitlement
            for (const entitlement of entitlements) {
                try {
                    // Resolve placeholders for this specific entitlement
                    const name = this.resolvePlaceholders(config.name || '', entitlement);
                    const description = config.description ? this.resolvePlaceholders(config.description, entitlement) : undefined;

                    // Get source from entitlement
                    let sourceId = entitlement.source?.id || entitlement.sourceId;
                    let sourceName = entitlement.source?.name || entitlement.sourceName || 'Unknown';
                    
                    if (entitlement.source && typeof entitlement.source === 'object') {
                        sourceId = entitlement.source.id || sourceId;
                        sourceName = entitlement.source.name || sourceName;
                    }

                    if (!sourceId) {
                        errors.push(`Entitlement ${entitlement.name || entitlement.id} has no source`);
                        continue;
                    }

                    // Resolve metadata for this entitlement if metadata template is configured
                    let finalMetadata: any[] | undefined;
                    if (metadataTemplate) {
                        const metadataStr = this.resolvePlaceholders(metadataTemplate, entitlement);
                        finalMetadata = stringToAttributeMetadata(metadataStr);
                    }

                    // Create access profile for this entitlement
                    const accessProfile: AccessProfile = {
                        name: name,
                        description: description,
                        enabled: config.enabled !== false,
                        requestable: config.requestable !== false,
                        owner: {
                            id: ownerId,
                            name: ownerName,
                            type: 'IDENTITY'
                        },
                        source: {
                            id: sourceId,
                            name: sourceName,
                            type: 'SOURCE'
                        },
                        entitlements: [{
                            id: entitlement.id,
                            name: entitlement.name || entitlement.displayName || entitlement._name || '',
                            type: 'ENTITLEMENT'
                        }],
                        accessRequestConfig: {
                            commentsRequired: config.commentsRequired === true,
                            denialCommentsRequired: config.denialCommentsRequired === true,
                            approvalSchemes: approvalSchemes
                        },
                        revocationRequestConfig: {
                            approvalSchemes: revokeApprovalSchemes
                        }
                    };

                    // Create access profile via API
                    const createdAP = await client.createAccessProfile(accessProfile);

                    // Update metadata separately if configured (metadata must be updated after creation)
                    if (finalMetadata && finalMetadata.length > 0) {
                        await client.updateAccessProfileMetadata(createdAP.id, finalMetadata);
                    }

                    createdProfiles.push(name);
                } catch (error: any) {
                    errors.push(`Failed to create access profile for entitlement ${entitlement.name || entitlement.id}: ${error.message}`);
                }
            }

            if (createdProfiles.length === 0) {
                return {
                    success: false,
                    message: 'Failed to create any access profiles',
                    errors: errors
                };
            }

            return {
                success: true,
                message: `Created ${createdProfiles.length} access profile(s) successfully`,
                data: {
                    createdProfiles: createdProfiles,
                    totalEntitlements: entitlements.length,
                    errors: errors.length > 0 ? errors : undefined
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: 'Failed to create access profiles',
                errors: [error.message || String(error)]
            };
        }
    }

    /**
     * Build approval schemes from configuration
     */
    private async buildApprovalSchemes(
        config: TaskConfig,
        client: ISCClient,
        tenantId: string,
        isRevocation: boolean = false
    ): Promise<any[] | undefined> {
        const { AccessProfileApprovalSchemeApproverTypeV3 } = await import('sailpoint-api-client');
        const schemes: any[] = [];
        const prefix = isRevocation ? 'revokeApproval' : 'approval';

        // Build up to 3 levels of approval
        for (let level = 1; level <= 3; level++) {
            const levelKey = `${prefix}Level${level}`;
            const govGroupKey = `${prefix}Level${level}GovGroup`;
            const identityKey = `${prefix}Level${level}Identity`;
            const approverType = config[levelKey];

            if (approverType && approverType !== '') {
                const scheme: any = {};

                // Handle IDENTITY type - use GOVERNANCE_GROUP type with identity ID as workaround
                // or try using approverId directly (API might accept it)
                if (approverType === 'IDENTITY') {
                    const identityId = config[identityKey]?.trim();
                    if (!identityId) {
                        throw new Error(`Identity required for ${levelKey}`);
                    }

                    // Verify identity exists
                    try {
                        const identity = await client.getIdentity(identityId);
                        // Use GOVERNANCE_GROUP type with identity ID - API might accept this
                        // Alternatively, we could try using approverId with a different type
                        scheme.approverType = AccessProfileApprovalSchemeApproverTypeV3.GovernanceGroup;
                        scheme.approverId = identityId;
                    } catch (error: any) {
                        throw new Error(`Identity not found for ${levelKey}: ${identityId}. Error: ${error.message}`);
                    }
                } else if (approverType === 'GOVERNANCE_GROUP') {
                    const govGroupName = config[govGroupKey]?.trim();
                    if (!govGroupName) {
                        throw new Error(`Governance group name required for ${levelKey}`);
                    }

                    // Search for governance group
                    const govGroups = await client.getGovernanceGroups(`name eq "${govGroupName}"`, 1);
                    if (!govGroups || govGroups.length === 0) {
                        throw new Error(`Governance group not found: ${govGroupName}`);
                    }

                    scheme.approverType = approverType as any;
                    scheme.approverId = govGroups[0].id;
                } else {
                    // Standard approver types (APP_OWNER, OWNER, SOURCE_OWNER, MANAGER)
                    scheme.approverType = approverType as any;
                }

                schemes.push(scheme);
            }
        }

        return schemes.length > 0 ? schemes : undefined;
    }

    /**
     * Resolve placeholders in a string using entitlement data
     */
    private resolvePlaceholders(template: string, entitlement: any): string {
        if (!template || !entitlement) return template;

        let result = template;
        
        // Replace common placeholders
        result = result.replace(/\{\{entitlement\.name\}\}/g, entitlement.name || entitlement.displayName || '');
        result = result.replace(/\{\{entitlement\.type\}\}/g, entitlement.type || entitlement.attribute || '');
        result = result.replace(/\{\{entitlement\.source\.name\}\}/g, entitlement.source?.name || entitlement.sourceName || '');
        result = result.replace(/\{\{entitlement\.source\.id\}\}/g, entitlement.source?.id || entitlement.sourceId || '');
        result = result.replace(/\{\{entitlement\.id\}\}/g, entitlement.id || '');
        
        // Replace nested properties
        if (entitlement.source) {
            result = result.replace(/\{\{source\.name\}\}/g, entitlement.source.name || '');
            result = result.replace(/\{\{source\.id\}\}/g, entitlement.source.id || '');
        }

        return result;
    }

    /**
     * Convert Search API syntax to Filter syntax
     * e.g., source.name:"EnateTest" -> source.name eq "EnateTest"
     * e.g., source.name:EnateTest -> source.name eq "EnateTest"
     */
    private convertSearchToFilter(query: string): string {
        if (!query || !query.trim()) {
            return query;
        }

        // If it already looks like filter syntax (contains "eq", "ne", "co", etc.), return as-is
        if (query.match(/\s+(eq|ne|co|sw|ew|gt|ge|lt|le|pr|in|ni)\s+/i)) {
            return query;
        }

        // URL decode first in case it's encoded
        let decoded = query;
        try {
            decoded = decodeURIComponent(query);
        } catch {
            // If decoding fails, use original
            decoded = query;
        }

        // Convert Search API syntax to filter syntax
        // Handle: field:"value" -> field eq "value"
        // Handle: field:value -> field eq "value"
        // Handle: field: "value" -> field eq "value"
        let filter = decoded
            .replace(/(\w+(?:\.\w+)*)\s*:\s*"([^"]+)"/g, '$1 eq "$2"')  // field:"value" -> field eq "value"
            .replace(/(\w+(?:\.\w+)*)\s*:\s*(\w+)/g, '$1 eq "$2"');     // field:value -> field eq "value"

        // If no conversion happened, try a more aggressive approach
        if (filter === decoded && decoded.includes(':')) {
            // Try to match any field:value pattern
            filter = decoded.replace(/(\w+(?:\.\w+)*)\s*:\s*(.+?)(?:\s|$)/g, (match, field, value) => {
                // Remove quotes if present
                const cleanValue = value.replace(/^["']|["']$/g, '');
                return `${field} eq "${cleanValue}"`;
            });
        }

        return filter;
    }

    /**
     * Execute search query to get input data for a task
     */
    public async executeSearchQuery(
        tenantId: string,
        tenantName: string,
        query: string,
        entityType: string
    ): Promise<any[]> {
        const client = new ISCClient(tenantId, tenantName);

        try {
            // For entitlements, use the Entitlements API directly with filters
            if (entityType === 'entitlements') {
                // Convert Search API syntax to filter syntax if needed
                const filter = this.convertSearchToFilter(query);
                console.log(`[AutomationTasks] Original query: ${query}, Converted filter: ${filter}`);
                
                // Support queries like: source.id eq "abc123" or source.name eq "Source Name"
                // Also support Search API syntax: source.name:"Source Name"
                try {
                    const entitlementsResp = await client.getEntitlements({
                        limit: 1000, // Get up to 1000 entitlements
                        offset: 0,
                        filters: filter // Use converted filter
                    });
                    return entitlementsResp.data || [];
                } catch (error: any) {
                    console.error('[AutomationTasks] Error fetching entitlements:', error);
                    // If filter syntax fails, try without filter (get all and filter client-side)
                    if (filter && filter !== query) {
                        console.log('[AutomationTasks] Retrying with original query format');
                        // Try using Search API instead
                        const { Search } = await import('sailpoint-api-client');
                        const searchPayload: Search = {
                            indices: ['entitlements'],
                            query: {
                                query: query
                            },
                            sort: ['name']
                        };
                        const results = await client.search(searchPayload, 1000);
                        return results || [];
                    }
                    throw error;
                }
            }

            // For other entity types, use Search API directly via ISCClient
            const { Search } = await import('sailpoint-api-client');
            let indices: string[] = [];
            switch (entityType) {
                case 'identities':
                    indices = ['identities'];
                    break;
                case 'accounts':
                    indices = ['accounts'];
                    break;
                default:
                    indices = ['identities', 'accounts'];
            }

            const searchPayload: Search = {
                indices: indices as any,
                query: {
                    query: query
                },
                sort: ['name']
            };

            const results = await client.search(searchPayload, 1000);
            return results || [];
        } catch (error: any) {
            console.error('[AutomationTasks] Error executing search query:', error);
            const errorMessage = error.message || String(error);
            // Don't double-wrap the error message
            if (errorMessage.includes('Search failed:')) {
                throw error;
            }
            throw new Error(`Search failed: ${errorMessage}`);
        }
    }

    /**
     * Parse CSV file content
     */
    public parseCSV(csvContent: string): any[] {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        
        // Parse data rows
        const data: any[] = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row: any = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }

        return data;
    }
}
