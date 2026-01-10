import { Uri } from "vscode";
export class EndpointUtils {

    public static getBaseUrl(tenantName: string): string {
        // Remove spaces and convert to lowercase for URL construction
        // Tenant names with spaces should be sanitized (e.g., "TMF Sandbox" -> "tmf-sandbox")
        let sanitized = tenantName.trim().toLowerCase().replace(/\s+/g, '-');
        
        let baseApiUrl = `https://${sanitized}.api.identitynow.com`;

        if (tenantName.indexOf('.') > 0) {
            if (tenantName.includes('.identitysoon.com')) {
                baseApiUrl = tenantName.replace(/([a-z0-9][a-z0-9-]+)\.(.*)/, "https://$1.api.cloud.sailpoint.com");
            } else {
                baseApiUrl = tenantName.replace(/([a-z0-9][a-z0-9-]+)\.(.*)/, "https://$1.api.$2");
            }
        }
        return baseApiUrl;
    }

    public static getAccessTokenUrl(tenantName: string): string {
        const baseApiUrl = this.getBaseUrl(tenantName);
        return baseApiUrl + '/oauth/token';
    }

    public static getV3Url(tenantName: string): string {
        const baseApiUrl = this.getBaseUrl(tenantName);
        return baseApiUrl + '/v3';
    }
}