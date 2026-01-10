# SailPoint ISC Dev Tools for Visual Studio Code

> This extension is not developed, maintained or supported by SailPoint.
> It is a community effort to help manage Identity Security Cloud from Visual Studio Code.

## Credits & Attribution

This extension is built on top of the work done by **Yannick Beot** and the original [SailPoint Identity Security Cloud extension](https://github.com/yannick-beot-sp/vscode-sailpoint-identitynow). I thank him for creating the foundation that made this enhanced version possible.

This fork adds additional features including:
- Enhanced search functionality (entity list search and global search page)
- Background tenant synchronization with state management
- Improved architecture with Sync Manager, State Engine, and Adapter Layer
- Contextual help and tooltips throughout the extension
- And many more improvements based on community feedback

The SailPoint ISC Dev Tools extension makes it easy to:

- **Multi-tenant Management**: Connect to and manage several tenants with background synchronization
- **Search & Discovery**: 
  - Search box in entity lists (identities, roles, access profiles, etc.) for quick filtering
  - Dedicated global search page with SailPoint search queries, recent searches, and quick filters
- **Configuration Management**: Import and export config of a tenant
- **Source Management**: View, edit, aggregate, test, peek, ping, clone, or reset sources
- **Transform Management**: View, create, edit, delete, clone, and test transforms
- **Provisioning**: View, create, edit, delete provisioning policies of a source
- **Schema Management**: View, create, edit, delete schemas of a source
- **Workflow Management**: View, edit, enable, disable, export, import workflows and view execution history
- **Rule Management**: View, create, edit, delete connector rules and export/import the script of a rule
- **Service Desk**: View, edit, delete service desk integrations
- **Identity Management**: View, edit, delete identity profiles and lifecycle states, refresh identities, search identities
- **Data Import/Export**: Import/Export Accounts (import for delimited files only), uncorrelated accounts, entitlement details
- **Access Management**: View, edit, create, delete, export, import access profiles
- **Role Management**: View, edit, create, delete, export, import roles, and dimensions
- **Form Management**: View, edit, create, delete, export, import forms
- **Attribute Management**: View, edit, create, delete search attribute config and identity attributes
- **Application Management**: View, edit, create, delete applications
- **Certification Campaigns**: View, report, escalate, send reminders, reassign to access item owners or reassign based on a file, approve in bulk

## Installation

Go to the extension menu or press `Ctrl`+`Shift`+`X` and look for the extension "SailPoint ISC Dev Tools". Click on the button `Install`.

The VSIX can be installed from the extension menu. Press `Ctrl`+`Shift`+`X` and in the menu, click `Install from VSIX...`.

### Building from Source

To build the extension from source:

1. Clone the repository:
   ```bash
   git clone https://github.com/asuka-405/sp-isc-devtools_vscode.git
   cd sp-isc-devtools_vscode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run esbuild
   ```

4. Package as VSIX (optional):
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

## Add new tenant

The extension supports several tenants.

Open the **Command Palette** with `Ctrl+Shift+P` (Windows or Linux) or `Cmd+Shift+P` (macOS) to find the command "ISC: Add tenant...".

Alternatively, you can click on the `+` in the SailPoint view.

You can add a tenant by using a Personal Access Token (PAT) or by using a short-lived access token (like one you can get from https://yourtenant.identitynow.com/ui/session).

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Command Palette                                │
├─────────────────────────────────────────────────────────┤
│  > ISC: Add tenant...                                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Add Tenant Configuration                        │  │
│  ├──────────────────────────────────────────────────┤  │
│  │  Tenant Name: [company-dev____________]                │  │
│  │  Authentication Method: [PAT ▼]                 │  │
│  │  Client ID: [________________]                   │  │
│  │  Client Secret: [****************]               │  │
│  │                                                   │  │
│  │  [ Cancel ]  [  Add Tenant  ]                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

It is also possible to add a tenant by using the following URIs:
`vscode://ArchMedia.sp-isc-devtools/addtenant?tenantName=company&accessToken=eyJh...&authenticationMethod=AccessToken` or
`vscode://ArchMedia.sp-isc-devtools/addtenant?tenantName=company&clientId=806c451e057b442ba67b5d459716e97a&clientSecret=***&authenticationMethod=PersonalAccessToken`.

## Search Functionality

### Entity List Search

All entity list views (identities, roles, access profiles, etc.) now include a search box at the top of the page. Simply type in the search box to filter entities by name in real-time. This works with pagination - the search filters the currently loaded page.

**Example**: When viewing identities, type "John" in the search box to quickly find all identities with "John" in their name.

```
┌─ Identities ───────────────────────────────────────────┐
│                                                        │
│  Identities                                            │
│  Showing 1-25 of 150 items (paginated)                │
│                                                        │
│  ┌──────────────────────────────────────────────┐    │
│  │ 🔍 [John________________] [Clear]            │    │
│  └──────────────────────────────────────────────┘    │
│                                                        │
│  ┌──────────────────────────────────────────────┐    │
│  │ Name              │ Type    │                 │    │
│  ├──────────────────────────────────────────────┤    │
│  │ John Doe          │ Identity│ →              │    │
│  │ John Smith        │ Identity│ →              │    │
│  │ Johnny Johnson    │ Identity│ →              │    │
│  └──────────────────────────────────────────────┘    │
│                                                        │
│  [ Previous ]  Page 1 of 6  [ Next ]                │
└────────────────────────────────────────────────────────┘
```

### Global Search

The extension includes a powerful global search feature that allows you to search across multiple SailPoint ISC resources using SailPoint's native search syntax.

**Accessing Global Search**:
- Click the "Global Search" button in the tenant view
- Use Command Palette: `ISC: Global Search...`
- Right-click on a tenant in the tree view and select "Global Search"

**Features**:
- **Search Query Input**: Enter SailPoint search queries (e.g., `name:John OR email:*@example.com`)
- **Recent Searches**: Quick access to your last 5 search queries
- **Quick Filters**: Pre-built filters for common searches:
  - Modified Today / This Week
  - Active / Inactive Identities
  - Privileged Access
  - Requestable Roles
  - Orphan Accounts
- **Search Results**: View results in a table with clickable items that open the resource directly

**Search Query Examples**:
- `name:John` - Find resources with "John" in the name
- `email:*@example.com` - Find identities with email domain
- `lifecycleState.name:active` - Find active identities
- `modified:[now-7d TO now]` - Find items modified in the last 7 days

```
┌─ Global Search ────────────────────────────────────────┐
│                                                        │
│  Search                                                │
│  Search across SailPoint ISC resources                 │
│                                                        │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🔍 [name:John OR email:*@example.com___]      │  │
│  │                                    [ Search ]   │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  Recent Searches:                                       │
│  [ name:John ]  [ email:*@example.com ]               │
│                                                        │
│  Quick Filters:                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ 📅 Modified  │  │ ✅ Active    │  │ 🔐 Privileged││
│  │   Today      │  │   Identities │  │   Access     ││
│  └──────────────┘  └──────────────┘  └──────────────┘│
│                                                        │
│  Search Results (12):                                  │
│  ┌────────────────────────────────────────────────┐  │
│  │ Name          │ Type      │ ID        │        │  │
│  ├────────────────────────────────────────────────┤  │
│  │ John Doe      │ identity  │ 12345     │ →      │  │
│  │ John Smith    │ identity  │ 12346     │ →      │  │
│  │ Admin Role    │ role      │ 78901     │ →      │  │
│  └────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## Import and export the config of a tenant

In the **SailPoint view**, right-click on a tenant to import or export config.

```
┌─ SailPoint ISC Dev Tools ─────────────────────────────┐
│                                                        │
│  📁 company-dev                                        │
│     ├─ 📁 Sources                                     │
│     ├─ 📁 Transforms                                  │
│     ├─ 📁 Workflows                                   │
│     └─ 📁 Identity Profiles                           │
│                                                        │
│  Right-click on tenant →                              │
│  ┌──────────────────────────────────────────────┐    │
│  │  Export sp-config...                          │    │
│  │  Import sp-config...                         │    │
│  │  ────────────────────────────────────────────│    │
│  │  Manage Tenant Sync                          │    │
│  │  Global Search                               │    │
│  └──────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

You can also export a single source, rule, identity profile or transform by right-clicking it and choosing "Export sp-config...".

```
┌─ SailPoint ISC Dev Tools ─────────────────────────────┐
│                                                        │
│  📁 company-dev                                        │
│     📁 Sources                                         │
│        🔌 Active Directory                            │
│           Right-click →                                │
│           ┌──────────────────────────────────────┐   │
│           │  Export sp-config...                 │   │
│           │  View Source                          │   │
│           │  Edit Source                          │   │
│           │  ────────────────────────────────────│   │
│           │  Aggregate                            │   │
│           │  Test Connection                      │   │
│           └──────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

Or, from the **Command Palette**, find the command "ISC: Import config..." or "ISC: Export config...".

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Command Palette (Ctrl+Shift+P)                │
├─────────────────────────────────────────────────────────┤
│  > ISC: Export config...                               │
│    ISC: Import config...                                │
│    ISC: Add tenant...                                  │
│    ISC: Global Search...                               │
│    ────────────────────────────────────────────────────│
│                                                          │
│  Export Process:                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Exporting sp-config...                          │  │
│  │  [████████████████████████████] 100%             │  │
│  │                                                   │  │
│  │  ✓ Sources (15)                                  │  │
│  │  ✓ Transforms (42)                               │  │
│  │  ✓ Workflows (8)                                  │  │
│  │  ✓ Identity Profiles (3)                        │  │
│  │                                                   │  │
│  │  Saved to: exportedObjects/config.json           │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Finally, you can right-click a JSON file in the explorer to import it.

```
┌─ Explorer ────────────────────────────────────────────┐
│                                                        │
│  📁 project                                            │
│     📁 exportedObjects                                 │
│        📄 config.json  ← Right-click                  │
│        📄 source-ad.json                              │
│        📄 transform-email.json                        │
│                                                        │
│  Context Menu:                                         │
│  ┌──────────────────────────────────────────────┐    │
│  │  Import sp-config...                         │    │
│  │  ────────────────────────────────────────────│    │
│  │  Open                                         │    │
│  │  Open With...                                 │    │
│  └──────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

## Rule management

The extension allows you to manage rules and upload the script to a new or existing rule:

```
┌─ Rule Editor ─────────────────────────────────────────┐
│                                                        │
│  Rule: Account Aggregation                        │
│  Tenant: company-dev                                 │
│                                                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  Script Editor                                 │  │
│  │  ┌──────────────────────────────────────────┐ │  │
│  │  │  // Connector Rule Script                │ │  │
│  │  │  import sailpoint.api.*                  │ │  │
│  │  │                                          │ │  │
│  │  │  def result = new HashMap()             │ │  │
│  │  │  result.put("displayName", ...)           │ │  │
│  │  │  return result                            │ │  │
│  │  └──────────────────────────────────────────┘ │  │
│  │                                                 │  │
│  │  [ Test Rule ]  [ Save ]  [ Cancel ]          │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  Test Results:                                         │
│  ┌────────────────────────────────────────────────┐  │
│  │  ✓ Rule executed successfully                 │  │
│  │  Output: { displayName: "John Doe" }          │  │
│  └────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## Workflow management

Export and Import workflows automatically:

- Remove the properties `created`, `creator`, `modified`, `modifiedBy`, and `owner`
- Nullify any value that starts with `$.secrets.`

The extension allows you to test the workflow:

```
┌─ Workflow Editor ─────────────────────────────────────┐
│                                                        │
│  Workflow: Onboarding Process                        │
│  Tenant: company-dev                                 │
│                                                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  Workflow Steps                                │  │
│  │                                                │  │
│  │  [Start] → [Create Account] → [Send Email]    │  │
│  │              ↓                                  │  │
│  │         [End Success]                          │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  Test Workflow:                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  Input JSON:                                   │  │
│  │  {                                             │  │
│  │    "identityId": "12345",                      │  │
│  │    "sourceId": "67890"                         │  │
│  │  }                                             │  │
│  │                                                 │  │
│  │  [ Run Test ]                                  │  │
│  │                                                 │  │
│  │  Execution Result:                             │  │
│  │  ✓ Step 1: Create Account - Success           │  │
│  │  ✓ Step 2: Send Email - Success               │  │
│  │  Status: COMPLETED                             │  │
│  └────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

## Snippets

The extension provides code snippets for quick development:

```
┌─ Transform Editor ───────────────────────────────────┐
│                                                        │
│  Type: tr-concat                                      │
│                                                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  {                                              │  │
│  │    "type": "concat",                            │  │
│  │    "attributes": {                              │  │
│  │      "values": [                                │  │
│  │        {                                        │  │
│  │          "type": "identityAttribute",           │  │
│  │          "attributes": {                        │  │
│  │            "name": "firstName"                  │  │
│  │          }                                      │  │
│  │        },                                       │  │
│  │        {                                        │  │
│  │          "type": "static",                     │  │
│  │          "attributes": {                        │  │
│  │            "value": " "                        │  │
│  │          }                                      │  │
│  │        },                                       │  │
│  │        {                                        │  │
│  │          "type": "identityAttribute",           │  │
│  │          "attributes": {                        │  │
│  │            "name": "lastName"                   │  │
│  │          }                                      │  │
│  │        }                                        │  │
│  │      ]                                          │  │
│  │    }                                            │  │
│  │  }                                              │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  Available Snippets:                                  │
│  • tr-acc      - Account Attribute                    │
│  • tr-concat   - Concatenation                        │
│  • tr-date-*   - Date operations                     │
│  • tr-lookup   - Lookup                              │
│  • tr-rule     - Rule reference                      │
│  • ... and many more                                 │
└────────────────────────────────────────────────────────┘
```

### Transforms

This extension includes the following snippets for transforms:

| Trigger            | Content                          |
| ------------------ | -------------------------------- |
| `tr-acc`           | Account Attribute                |
| `tr-b64-dec`       | Base64 Decode                    |
| `tr-b64-enc`       | Base64 Encode                    |
| `tr-concat`        | Concatenation                    |
| `tr-cond`          | Conditional                      |
| `tr-date-comp`     | Date Compare                     |
| `tr-date-format`   | Date Format                      |
| `tr-date-math`     | Date Math                        |
| `tr-diacritic`     | Decompose Diacritial Marks       |
| `tr-phone`         | E164 Phone                       |
| `tr-first`         | First Valid                      |
| `tr-rand-string`   | Generate Random String           |
| `tr-end`           | Get End of String                |
| `tr-refattr`       | Get Reference Identity Attribute |
| `tr-id`            | Identity Attribute               |
| `tr-indexof`       | Index Of                         |
| `tr-iso3166`       | ISO3166                          |
| `tr-last-index`    | Last Index Of                    |
| `tr-leftpad`       | Left Pad                         |
| `tr-lookup`        | Lookup                           |
| `tr-lower`         | Lower                            |
| `tr-norm`          | Name Normalizer                  |
| `tr-rand-alphanum` | Random Alphanumeric              |
| `tr-rand-num`      | Random Numeric                   |
| `tr-ref`           | Reference                        |
| `tr-replace`       | Replace                          |
| `tr-replace-all`   | Replace All                      |
| `tr-rightpad`      | Right Pad                        |
| `tr-rule`          | Rule                             |
| `tr-split`         | Split                            |
| `tr-static`        | Static                           |
| `tr-sub`           | Substring                        |
| `tr-trim`          | Trim                             |
| `tr-upper`         | Upper                            |
| `tr-uuid`          | UUID Generator                   |

### Schema

This extension includes the following snippets for schemas:

| Trigger         | Content             |
| --------------- | ------------------- |
| `New schema`    | Create a new schema |
| `New attribute` | Add new attribute   |

### Provisioning Policies

This extension includes the following snippets for schemas:

| Trigger                   | Content                          |
| ------------------------- | -------------------------------- |
| `New provisioning policy` | Create a new provisioning policy |
| `New field`               | Create a new field               |

### Forms

This extension includes the following snippets for forms:

| Trigger          | Content                 |
| ---------------- | ----------------------- |
| `New Form Input` | Create a new form input |

### Public Identities Configuration

This extension includes the following snippets for the Public Identities Configuration:

| Trigger                  | Content                                 |
| ------------------------ | --------------------------------------- |
| `New identity attribute` | Create a new identity attribute mapping |

## Import format

### Access Profiles

The following table provides the expected column for the CSV to import Access Profiles:

| Header                   | M[*] | Description                                                                                                                 | Default Value      |
| ------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `name`                   | Yes  | Name of the access profile                                                                                                  |                    |
| `owner`                  | Yes  | Owner of the access profile                                                                                                 |                    |
| `source`                 | Yes  | Source associated with the access profile                                                                                   |                    |
| `description`            | No   | Description of the access profile                                                                                           | `null`             |
| `enabled`                | No   | Is the access profile enabled?                                                                                              | `false`            |
| `requestable`            | No   | Is the access profile requestable?                                                                                          | `false`            |
| `commentsRequired`       | No   | Require comments when the user requests access                                                                              | `false`            |
| `denialCommentsRequired` | No   | Require comments when a reviewer denies the request                                                                         | `false`            |
| `approvalSchemes`        | No   | List of reviewers among `APP_OWNER`, `OWNER`, `SOURCE_OWNER`, `MANAGER`, or the name of the governance group separated by ; | `[]` (No approval) |
| `revokeApprovalSchemes`  | No   | List of reviewers among `APP_OWNER`, `OWNER`, `SOURCE_OWNER`, `MANAGER`, or the name of the governance group separated by ; | `[]` (No approval) |
| `entitlements`           | No   | Entitlements of the access profile                                                                                          | `[]`               |
| `metadata`               | No   | Metadata of the access profile (cf. below for format)                                                                       | `[]`               |

[*]: ## "Mandatory"

### Roles

The following table provides the expected column for the CSV to import Roles:

| Header                         | M[*] | Description                                                                                    | Default Value      |
| ------------------------------ | ---- | ---------------------------------------------------------------------------------------------- | ------------------ |
| `name`                         | Yes  | Name of the role                                                                               |                    |
| `owner`                        | Yes  | Owner of the role                                                                              |                    |
| `description`                  | No   | Description of the role                                                                        | `null`             |
| `enabled`                      | No   | Is the role enabled?                                                                           | `false`            |
| `requestable`                  | No   | Is the role requestable?                                                                       | `false`            |
| `commentsRequired`             | No   | Require comments when the user requests access                                                 | `false`            |
| `denialCommentsRequired`       | No   | Require comments when a reviewer denies the request                                            | `false`            |
| `approvalSchemes`              | No   | List of reviewers among `OWNER`, `MANAGER`, or the name of the governance group separated by ; | `[]` (No approval) |
| `revokeCommentsRequired`       | No   | Require comments when the user requests revocation                                             | `false`            |
| `revokeDenialCommentsRequired` | No   | Require comments when a reviewer denies the revocation request                                 | `false`            |
| `revokeApprovalSchemes`        | No   | List of reviewers among `OWNER`, `MANAGER`, or the name of the governance group separated by ; | `[]` (No approval) |
| `entitlements`                 | No   | List of entitlements                                                                           | `[]`               |
| `entitlements`                 | No   | List of entitlements                                                                           | `[]`               |
| `accessProfiles`               | No   | List of access profiles                                                                        | `[]`               |
| `membershipCriteria`           | No   | Membership criteria for automatic assignment (cf. below for format)                            |                    |
| `dimensional`                  | No   | Is the role dynamic? Does it support dimensions?                                               | `false`            |
| `dimensionAttributes`          | No   | List of attributes used for dimension, separated by ;                                          | `[]`               |
| `metadata`                     | No   | Metadata of the role (cf. below for format)                                                    | `[]`               |

### Dimensions

The following table provides the expected column for the CSV to import Roles:

| Header                | M[*] | Description                                                         | Default Value |
| --------------------- | ---- | ------------------------------------------------------------------- | ------------- |
| `name`                | Yes  | Name of the dimension                                               |               |
| `roleName`            | Yes  | Name of the role                                                    |               |
| `description`         | No   | Description of the role                                             | `null`        |
| `entitlements`        | No   | List of entitlements                                                | `[]`          |
| `accessProfiles`      | No   | List of access profiles                                             | `[]`          |
| `membershipCriteria`  | No   | Membership criteria for automatic assignment (cf. below for format) |               |

#### Membership criteria

`membershipCriteria` follows _kind of_ SCIM filters

##### Attributes

There are 3 kind of attributes:

- **Identity Attribute**: the format is `identity.{attribute name}`. Ex: `identity.cloudLifecycleState`, `identity.type`, etc.
- **Account Attribute**: the format is `{source name}.attribute.{attribute name}`. If the source name contains space, the source name must be put between quotes or double-quotes
- **Entitlements**: the format is `{source name}.entitlement.{attribute name}`. If the source name contains space, the source name must be put between quotes or double-quotes

##### Attribute operators

| Operator | Description |
| -------- | ----------- |
| eq       | equals      |
| ne       | not equals  |
| co       | contains    |
| sw       | starts with |
| ew       | ends with   |

##### Logical operators

| Operator | Description   |
| -------- | ------------- |
| and      | Logical "and" |
| or       | Logical "or"  |

##### Values

Values must be within `"` or `'`.

##### Grouping

Expressions can be grouped by using parenthesis.
Parenthesis are mandatory for 3-level expression but are optional otherwise.

##### Examples

Here are a few examples extracted from the unit tests:

```
identity.department eq 'Customer Service' and identity.cloudLifecycleState eq 'active'
'Active Directory'.entitlement.memberOf eq 'CN=Accounting,OU=Groups,OU=Demo,DC=seri,DC=sailpointdemo,DC=com' and 'Active Directory'.attribute.departmentNumber eq '1234'
(identity.department eq 'Customer Service' and identity.cloudLifecycleState eq 'active') or (identity.cloudLifecycleState eq 'active' and identity.jobTitle co 'Accounts Payable Analyst')
```

### Metadata

The metadata column will be exported as or will be imported as:

```
<technicalName1>:<value1>,<value2>;<technicalName2>:<value3>
```

> NOTE: Only technical names and values are used.
>
> For custom metadata attribute and values, it's just the Camel Case of the display name. e.g. Domain->`domain`, Back Office->`backOffice`
>
> Default metadata starts with isc. For instance, "Access Type"'s technical name is `iscAccessType`

### Certification Campaign Custom Reviewers

The following table provides the expected column for the CSV to import Custom Reviewer logic:

| Header              | M[*]                                             | Description                                                                                           | Supported Values                                   |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `reviewerAttribute` | Yes                                              | Identity attribute used to identify the defined reviewer                                              | `id\|name\|email`                                  |
| `reviewerValue`     | Yes                                              | The value of identity attribute for the defined reviewer (e.g. the email address of the reviewer)     |                                                    |
| `itemType`          | Yes                                              | The type of object to scope the reviewer's review items                                               | `IDENTITY\|ENTITLEMENT\|ACCESS_PROFILE\|ROLE\|ALL` |
| `itemSelectorType`  | Yes, unless itemType=ALL                         | The type of selector used to define the reviewer's scope                                              | `id\|name\|query\|all`[**]                         |
| `itemSelectorValue` | Yes, unless itemType=ALL or itemSelectorType=all | The value of the selector used to define the reviewer's scope (e.g. a valid entitlement Search Query) |                                                    |

[**]: ## "`itemSelectorType=name` is not supported with `itemType=ENTITLEMENT`"

#### Examples

Here are a few valid examples:

```
reviewerAttribute,reviewerValue,itemType,itemSelectorType,itemSelectorValue
id,8e5c35894e124e81859f59030f3c4d56,IDENTITY,id,8e5c358d7a124e81859f59030f3c67ae
name,Adam.Kennedy,IDENTITY,query,"attributes.department:""Asset Management"""
email,Alan.Bandero@sailpointdemo.com,ENTITLEMENT,query,"source.name:""Active Directory"" AND privileged:true"
name,Aaron.Nichols,ACCESS_PROFILE,name,"Accounts Payable Access"
email,Anne.Arnold@sailpointdemo.com,ROLE,query,*
email,Anne.Arnold@sailpointdemo.com,ENTITLEMENT,all,
email,Anne.Arnold@sailpointdemo.com,ALL,,
```

### Certification Campaign Report

The report provides a detailed overview of user access rights, including roles, access profiles, and entitlements. Auditors gain a comprehensive understanding of who has access to critical systems and data, enabling them to assess compliance with regulatory requirements and internal policies.

below are the campaign report headers:

```
"Campaign Name","Reviewer Name","Reviewer Email","Identity Name","Review Completed","Review Item ID","Item Review Completed","New Access","Reviewer Decision","Reviewer Comments","Access Type","Role Name","Role Description","Access Profile Name","Access Profile Description","Access Profile Privileged","Entitlement Name","Entitlement Description","Entitlement Privileged","Entitlement Attribute Value","Entitlement Source Schema Object Type","Entitlement Source Name","Entitlement Account Native ID","Entitlement Account Name"
```

You need to configure the path where the report will be exported

### Send Reminder Notification To Reviewers

Copy this below Workflow JSON to a file and save it as `.json` file like: `SendReminderNotificationToReviewersWorkflow.json`

```
{
	"name": "Sends Reminder Notification To Reviewers",
	"description": "Sends Reminder Notification To Reviewers With Pending Items",
	"modified": "2024-11-20T13:05:27.631277905Z",
	"definition": {
		"start": "Send Email",
		"steps": {
			"End Step - Success": {
				"displayName": "End",
				"type": "success"
			},
			"Send Email": {
				"actionId": "sp:send-email",
				"attributes": {
					"body": "<p>Dear {{$.trigger.input.reviewerName}},</p>\n<p>This is a reminder that you have pending certification items requiring your action in the <strong>{{$.trigger.input.campaignName}}</strong> certification campaign.</p>\n<p>Here are your current review progress details:</p>\n<ul>\n<li><strong>Pending Items: </strong>{{$.trigger.input.pendingItems<br>}}</li>\n<li><strong>Pending Identities</strong>: {{$.trigger.input.pendingIdentities}}</li>\n<li><strong>Completed Decisions</strong>: {{$.trigger.input.completedDecisions}}&nbsp;</li>\n<li><strong>Completed Identities</strong>: {{$.trigger.input.completedIdentities}}</li>\n</ul>\n<p>Please note that the due date for completing your reviews is <strong>{{$.trigger.input.dueDate}}</strong>.</p>\n<p>To avoid delays and escalations, Please&nbsp;complete your remaining reviews.</p>\n<p>If you have any questions or need assistance, feel free to contact us.</p>\n<p>Thank you,<br>The Certification Review Team</p>",
					"context": null,
					"from": "",
					"fromEmail": "reviews@company.com",
					"recipientEmailList.$": "$.trigger.input.reviewerEmail",
					"recipientEmails": "$.trigger.reviewerEmail",
					"subject": "Action Required: Pending Items in {{$.trigger.input.campaignName}} Certification"
				},
				"displayName": "Send Reminder Notification",
				"nextStep": "End Step - Success",
				"type": "action",
				"versionNumber": 2
			}
		}
	},
	"trigger": {
		"type": "EXTERNAL",
		"attributes": {
			"clientId": "948fca73-4169-45c5-bbe1-06fc1f2b0a43",
			"url": "/beta/workflows/execute/external/d2062dca-14ac-461d-94bc-daaf25af799c"
		}
	}
}
```

- Login to your ISC tenant as an Admin
- Navigate to Admin -> Workflows -> New Workflow -> Upload File
- Upload the workflow JSON file, then click on "Continue to Build"
- In the builder click on External Trigger node -> + New Access Token
- Save the client ID, client secret as you will need them to later in the SailPoint ISC extension
- Click on the "Send Reminder Notification" node to update the notification template.
- Save the workflow and enable it

The external JSON trigger is:

```
{
  input:
    {
      reviewerName: reviewerName,
      reviewerId: reviewerId,
      reviewerEmail: reviewerEmail,
      campaignName: campaignName,
      completedDecisions: completedDecisions,
      totalDecisions: totalDecisions,
      pendingItems: pendingItems,
      completedIdentities: completedIdentities,
      totalIdentities: totalIdentities,
      pendingIdentities: pendingIdentities,
      dueDate: certificationDueDate
    }
}
```

## Extension Settings

The extension supports the following settings:

- `sp-isc-devtools.report.accessProfiles.filename`: Define the pattern for the folder to export access profiles.
  - Default value: `%x/reports/%T-AccessProfiles-%y%M%d-%h%m%s.csv`
- `sp-isc-devtools.report.accounts.filename`: Define the pattern for the folder to export accounts.
  - Default value: `%x/reports/%T-%S-Accounts-%y%M%d-%h%m%s.csv`
- `sp-isc-devtools.report.uncorrelatedAccounts.filename`: Define the pattern for the folder to export uncorrelated accounts.
  - Default value: `%x/reports/%T-%S-Uncorrelated-Accounts-%y%M%d-%h%m%s.csv`
- `sp-isc-devtools.report.entitlements.filename`: Define the pattern for the folder to export entitlement details.
  - Default value: `%x/reports/%T-%S-Entitlements-%y%M%d-%h%m%s.csv`
- `sp-isc-devtools.report.roles.filename`: Define the pattern for the folder to export roles.
  - Default value: `%x/reports/%T-Roles-%y%M%d-%h%m%s.csv`
- `sp-isc-devtools.sP-Config.singleResource.filename`: Define the pattern for the SP-Config file of a single resource (Source, Identity Profile, Connector Rule, or Transform).
  - Default value: `%x/exportedObjects/identitynowconfig-%t-%S-%y%M%d-%h%m%s.json`
- `sp-isc-devtools.sP-Config.singleFile.filename`: Define the pattern for the SP-Config file as a single file for multiple resources
  - Default value: `%x/exportedObjects/identitynowconfig-%t-%y%M%d-%h%m%s.json`
- `sp-isc-devtools.sP-Config.multipleFiles.folder`: Define the pattern for the SP-Config folder as multiple files for multiple resources. This folder is proposed.
  - Default value: `%x/exportedObjects`
- `sp-isc-devtools.sP-Config.multipleFiles.filename`: Define the pattern for the SP-Config filename as multiple files for multiple resources. It will be concatenated to the export folder. These filenames are not confirmed.
  - Default value: `%o/%S.json`
- `sp-isc-devtools.export.forms.filename`: Define the pattern to export forms from a tenant
  - Default value: `%x/Forms/Forms-%t-%y%M%d-%h%m%s.json`
- `sp-isc-devtools.export.form.filename`: Define the pattern to export a single form from a tenant
  - Default value: `%x/Forms/Form-%t-%S-%y%M%d-%h%m%s.json`
- `sp-isc-devtools.export.workflow.filename`: Define the pattern to export a single workflow from a tenant
  - Default value: `%x/Workflows/Workflow-%t-%S-%y%M%d-%h%m%s.json`
- `sp-isc-devtools.treeView.pagination`: Define the number of roles and access profiles that are displayed in the tree view
  - Default value: 100
- `sp-isc-devtools.report.campaigns.filename`: Define the pattern for the folder to export access profiles.

  - Default value: `%x/reports/%T-Campaign-%S-%y%M%d-%h%m%s.csv`
    The patterns defined above use the following tokens:

- `%u`: User Home Dir
- `%w`: Workspace folder
- `%x`: Either workspace folder if defined, or home dir
- `%d`: Day
- `%M`: Month
- `%y`: Year
- `%h`: Hour
- `%m`: Minute
- `%s`: Second
- `%t`: Tenant name
- `%T`: Tenant display name
- `%o`: Object type
- `%S`: Source name for source-based report or object name

## Release Notes

### Version 0.0.3

Initial release of SailPoint ISC Dev Tools with comprehensive features:

#### Search & Discovery
- **Entity List Search**: Real-time search box in all entity list views (identities, roles, access profiles, etc.) for quick filtering
- **Global Search Page**: Dedicated search interface with SailPoint search query support
- **Recent Searches**: Quick access to last 5 search queries
- **Quick Filters**: Pre-built filters for common searches (Modified Today, Active Identities, Privileged Access, etc.)
- **Clickable Results**: Search results open resources directly

#### Multi-Tenant Management
- **Background Synchronization**: Automatic data refresh for up to 4 active tenants simultaneously
- **Sync Manager**: Centralized sync state management with health monitoring
- **State Engine**: In-memory caching of tenant data for fast access
- **Sync Management UI**: Visual interface to activate/pause tenant synchronization
- **Sync Status Indicators**: Real-time sync status in tree view with health indicators

#### Architecture & Performance
- **Adapter Layer**: API-agnostic data access layer with intelligent caching
- **Command Bus**: Centralized command handling with validation
- **Pagination Support**: Enforced 250-item limit per page for optimal performance
- **Non-blocking UI**: Asynchronous operations for responsive user experience

#### Contextual Help & User Experience
- **Help Service**: Comprehensive contextual help system throughout the extension
- **Tooltips**: Helpful tooltips on buttons, inputs, and UI elements
- **Help Icons**: Clickable help icons with detailed information
- **Enhanced Tree Tooltips**: Rich tooltips with sync status and contextual guidance
- **Documentation Links**: Direct links to SailPoint documentation where applicable

#### Navigation & Organization
- **Categorized Navigation**: Organized resource hierarchy with categories (Identity Management, Access Model, etc.)
- **Improved Tree View**: Enhanced tree structure with sync status indicators
- **Breadcrumb Navigation**: Clear navigation path throughout the extension

#### Data Management
- **SP-Config Import/Export**: Full support for SailPoint configuration import/export
- **CSV Import/Export**: Bulk operations for access profiles, roles, and identities
- **Account Management**: Import/export accounts, uncorrelated accounts, entitlement details

#### Source & Transform Management
- **Source Configuration**: View, edit, aggregate, test, peek, ping, clone, or reset sources
- **Transform Editor**: Create, edit, delete, clone, and test transforms
- **Transform Snippets**: Quick-create common transform patterns
- **Schema Management**: View, create, edit, delete source schemas

#### Access Management
- **Access Profiles**: View, edit, create, delete, export, import access profiles
- **Roles**: View, edit, create, delete, export, import roles and dimensions
- **Identity Profiles**: View, edit, delete identity profiles and lifecycle states

#### Workflow & Automation
- **Workflow Management**: View, edit, enable, disable, export, import workflows
- **Workflow Execution History**: Track workflow executions
- **Rule Management**: View, create, edit, delete connector rules

#### Additional Features
- **Forms Management**: View, edit, create, delete, export, import forms
- **Applications**: View, edit, create, delete applications
- **Service Desk**: View, edit, delete service desk integrations
- **Certification Campaigns**: View, report, escalate, send reminders, reassign, approve in bulk
- **Identity Attributes**: View, edit, create, delete identity and search attributes
- **Governance Groups**: Manage governance groups

#### Credits
Built on top of the excellent work by Yannick Beot's [SailPoint Identity Security Cloud extension](https://github.com/yannick-beot-sp/vscode-sailpoint-identitynow), enhanced with additional features and improvements.

### Unreleased
