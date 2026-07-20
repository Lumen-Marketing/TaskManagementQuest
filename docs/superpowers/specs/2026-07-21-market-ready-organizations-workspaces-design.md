# Market-Ready Organizations and Configurable Workspaces

**Date:** 2026-07-21

**Status:** Ready for user review

**Project:** Quest HQ / Job Center

## Purpose

Convert the current internal multi-company task manager into a tenant-safe market product where a person creates a company account, the company creates blank workspaces, and each workspace installs and configures its own apps, plugins, pipelines, permissions, and connectors.

The product must not hardcode roofing, cold calling, sales, underwriting, production, or management. Those are possible customer configurations, not product structure.

## Current state

The current application uses `public.companies` as both a business label and a workspace boundary:

- `profiles.company_ids` grants access to one or more companies.
- `tasks.company_id`, `projects.company_id`, and taxonomy `company_id` columns scope records.
- the interface sometimes calls the company switcher a workspace switcher.
- `profiles.role` is global, even when a person belongs to several companies.
- `App.COMPANIES` hardcodes Roofing, Drafting, Lumen, and Overall in the client.
- RLS policies derive access from `profiles.company_ids`.

This works for the current internal organization but does not model independent customer accounts with configurable workspaces. Supabase Auth itself is not the problem and remains the identity provider.

## Product vocabulary

### User account

One authenticated person. Supabase Auth owns credentials, sessions, email verification, password recovery, and identity. A user may join multiple organizations.

### Organization

A customer company account and the top-level tenant boundary. It owns workspaces, memberships, shared customer identities, billing state, and organization settings.

### Workspace

A configurable operating area inside one organization. A workspace has a name, icon, color, ordering, membership, apps, permissions, fields, views, pipelines, plugins, and connectors. It starts blank.

### App

A supported product capability such as Tasks, Contacts, Pipeline, Projects, Files, Calendar, or Reports. App engines are implemented and versioned by Job Center; app installations and configuration are stored per workspace.

### Plugin

An optional extension installed into one workspace. It declares capabilities and permissions and has workspace-specific settings. The first market release supports only reviewed first-party plugins; arbitrary uploaded customer code is outside the first release because it would require a sandbox, review process, signing, quotas, and a stronger incident boundary.

### Connector

A configured data handoff between apps, workspaces, or an approved external service. A connector has a trigger, action, field mapping, identity/deduplication rule, permissions, run history, retry policy, and disable state.

## Approaches considered

### Rename companies to workspaces

Fastest, but it still lacks a customer-company tenant boundary and preserves the global-role and hardcoded-company problems. Rejected for a public market launch.

### Full rewrite

Would produce the cleanest isolated codebase, but discards proven task, UI, persistence, and Supabase work while creating excessive launch risk. Rejected.

### Additive staged conversion

Introduce organizations and workspaces beside the legacy company model, backfill current data, move reads and writes behind compatibility seams, verify tenant isolation, then retire legacy columns. Selected because it protects current data and keeps the application usable throughout the migration.

## Target ownership model

```text
auth.users
  -> profiles
  -> organization_memberships -> organizations
  -> workspace_memberships    -> workspaces -> organizations

organizations
  -> workspaces
  -> shared contacts/customers
  -> audit events

workspaces
  -> workspace apps
  -> pipelines and custom fields
  -> workspace plugin installations
  -> connector definitions and runs
  -> tasks and projects
```

Every tenant-owned row carries `organization_id`. Rows that belong to one operating area also carry `workspace_id`. Access never depends only on a client-side filter.

## Foundation schema

### `organizations`

- `id uuid primary key`
- `name text`
- `slug text unique`
- `owner_user_id uuid references auth.users`
- `status text` with controlled values such as `active`, `suspended`, `pending_deletion`
- `settings jsonb`
- timestamps

### `organization_memberships`

- `organization_id`
- `user_id`
- `role`: `owner`, `admin`, or `member`
- invitation and membership status
- unique `(organization_id, user_id)`

There must always be at least one active owner. Ownership changes use a transaction or restricted RPC so an organization cannot be orphaned.

### `workspaces`

- `id uuid primary key`
- `organization_id`
- `name`, `slug`, `icon`, `color`, `sort_order`
- `settings jsonb`
- `archived_at`
- timestamps

Workspaces start blank. No role-specific template or default pipeline is inserted automatically. The creator chooses apps and configuration.

### `workspace_memberships`

- `workspace_id`
- `user_id`
- `role`: initially `workspace_admin`, `supervisor`, or `member`
- unique `(workspace_id, user_id)`

An organization owner/admin can manage workspace access. A user may have a different role in each workspace.

### `app_catalog`

Code-backed app definitions with stable keys, display metadata, current version, capabilities, and availability. Customers cannot upload executable app code in the first release.

### `workspace_apps`

- `workspace_id`
- `app_key`
- `enabled`
- `display_name`, `icon`, `sort_order`
- `configuration jsonb`
- unique `(workspace_id, app_key)`

This makes the workspace navigation and behavior database-driven while keeping each app engine testable and upgradeable.

### `plugin_catalog` and `workspace_plugin_installations`

The catalog declares supported plugins, versions, permissions, configuration schema, event subscriptions, and compatible apps. An installation belongs to one workspace, records granted scopes, stores non-secret configuration, and references secrets stored only in a server-side secret facility.

No service-role key or plugin credential may be delivered to the browser. Plugin execution that needs privileged access runs in an authenticated Edge Function or another controlled server-side worker.

### Pipelines and custom configuration

Pipeline definitions, stages, views, fields, and field options are workspace/app rows rather than constants. Definitions use stable IDs so customers can rename or reorder labels without breaking records or connectors.

### Connectors

Connector definitions and runs are a later implementation slice built on the workspace foundation. The schema reserves organization/workspace ownership and permission semantics now, but the first foundation migration does not execute connector automation.

## Migration of existing data

The migration is additive and does not delete current records.

1. Create a single legacy organization for the existing Quest/Lumen installation.
2. Create workspaces corresponding to Roofing, Drafting, and Lumen.
3. Do not convert `overall` into a normal workspace. Overall becomes a cross-workspace view inside the organization.
4. Convert each `profiles.company_ids` entry into an organization membership and a workspace membership.
5. Preserve the person's existing global role as the initial workspace role mapping. Role customization can then diverge per workspace.
6. Add nullable `organization_id` and `workspace_id` columns to tenant-owned tables and backfill them from the company-to-workspace mapping.
7. Add indexes and validated foreign keys after the backfill.
8. Move application reads and writes to organization/workspace IDs through the Directory, taxonomy, controller, and datastore seams.
9. During compatibility, writes populate both the new workspace IDs and the legacy company ID where the legacy path still requires it.
10. Make the new IDs non-null only after production verification shows no unmapped rows.
11. Remove legacy `company_ids`, `company_id`, `public.companies`, `App.COMPANIES`, and Overall-company triggers only in a later cleanup migration after rollback is no longer needed.

No destructive cleanup belongs in the first implementation slice.

## Authorization and RLS

Organization and workspace memberships become the authorization source of truth. Authorization data is stored in database tables, not user-editable `user_metadata` and not an ever-growing JWT membership array.

Policies must:

- use `TO authenticated` plus organization/workspace membership predicates;
- include both `USING` and `WITH CHECK` for updates;
- prevent moving a row into an organization or workspace the user cannot access;
- index all `organization_id`, `workspace_id`, and membership lookup columns;
- filter client queries by organization/workspace as well as relying on RLS;
- place any required security-definer membership helper in a non-exposed schema, lock its `search_path`, check `auth.uid()`, revoke `PUBLIC` execution, and grant only the minimum caller access;
- enable RLS on every exposed table;
- explicitly grant only necessary Data API privileges in the same migration as policies.

The explicit grants are required for forward compatibility with Supabase's 2026 Data API exposure changes.

## Signup and provisioning

Public signup must not assemble tenant state through independent browser writes. A controlled transaction or authenticated server-side function creates:

1. the organization;
2. the owner membership;
3. the first blank workspace only if the owner names one during onboarding;
4. the workspace owner/admin membership;
5. audit events.

If any step fails, the transaction rolls back. Retrying uses an idempotency key to avoid duplicate organizations.

## Interface changes

### Account and organization level

- retain the existing login and session flow;
- add organization selection only when a person belongs to more than one organization;
- add organization settings, member invitations, ownership, and workspace management;
- separate platform/developer access from customer organization roles.

### Workspace level

- replace the current company switcher with a real workspace switcher;
- add Create workspace and Manage workspaces;
- start new workspaces blank;
- add an app catalog where a workspace admin installs supported apps;
- generate workspace navigation from `workspace_apps`;
- scope current task, project, directory, report, and taxonomy behavior to the active workspace;
- provide an organization-wide view only to authorized organization roles.

### Existing configuration

The present Roofing, Drafting, and Lumen experience remains visible as the migrated legacy organization's workspaces. The owner-facing concept image is an example configuration, not a fixed application layout.

## Plugin safety boundary

The first launch supports reviewed plugins registered by the Job Center team. A plugin manifest declares:

- compatible apps and version;
- requested scopes such as `contacts:read`, `tasks:write`, or `files:read`;
- events consumed and actions produced;
- configuration schema;
- server-side handler identity;
- rate and retry limits.

Workspace admins grant scopes at install time and can disable or uninstall an installation. Every privileged execution is attributed to an installation, organization, workspace, and initiating user or system event.

Allowing customers or third parties to upload arbitrary code is a separate marketplace/sandbox project and is not required for the first public launch.

## Failure handling

- Provisioning is transactional and idempotent.
- Workspace/app configuration changes create audit events.
- Archived workspaces remain recoverable and do not cascade-delete business records.
- Plugin and connector failures never partially move ownership of a record; runs record status, error class, attempt count, and next retry.
- Disabling a plugin immediately blocks new execution while preserving history.
- Unknown or removed app/plugin definitions render a safe unavailable state instead of exposing or deleting data.

## Testing and verification

### Database

- migration tests for empty and populated databases;
- backfill count checks and unmapped-row queries;
- foreign-key and not-null validation after backfill;
- pgTAP or equivalent RLS tests with Organization A and Organization B users;
- tests for owner/admin/member and workspace role boundaries;
- direct attempts to read, insert, update, move, and delete cross-tenant rows;
- explicit Data API grant verification;
- Supabase security and performance advisor review.

### Application

- unit tests for organization/workspace context and authorization decisions;
- datastore mapping tests for new IDs and compatibility writes;
- signup/provisioning retry tests;
- workspace switcher and app navigation tests;
- multi-workspace role and visibility tests;
- regression tests for tasks, projects, taxonomy, time tracking, comments, reports, and mobile navigation.

### Production readiness

- separate test/staging data from production customer data;
- backup and restoration rehearsal;
- monitoring for auth, database, Edge Function, and connector failures;
- privacy, terms, export, deletion, support, and incident flows;
- invite-only beta before unrestricted self-service signup;
- a public-launch gate requiring all tenant-isolation tests and a rollback rehearsal to pass.

## Delivery sequence

1. Organization/workspace tables, membership model, RLS helpers, and tests.
2. Existing-data backfill plus compatibility columns and verification.
3. Runtime organization/workspace context and workspace switcher.
4. Blank workspace creation and workspace membership administration.
5. App catalog and per-workspace app installation/configuration.
6. First-party plugin catalog and scoped installations.
7. Pipeline/custom-field configuration.
8. Connector definition, execution, audit, retry, and handoff UI.
9. Invite-only beta hardening and public market launch gates.

Each slice is separately releasable and reversible. The first implementation plan covers only items 1 and 2 so tenant isolation and migration correctness are proven before the user interface is reworked.

## Immediate changes versus deferred removal

### Change first

- add organizations, organization memberships, workspaces, and workspace memberships;
- add new ownership columns and backfill mapping;
- add membership-based RLS and isolation tests;
- add explicit Data API grants;
- preserve Supabase Auth and current profiles;
- preserve every existing task, project, taxonomy row, comment, timer, and user.

### Remove later, after verification

- `profiles.company_ids`;
- legacy `company_id` columns;
- `public.companies` as an access boundary;
- hardcoded `App.COMPANIES` as the source of truth;
- `current_company_ids()` and company-array RLS policies;
- the `overall` pseudo-company row and auto-grant trigger;
- global-role assumptions where workspace roles now apply.

Nothing in the removal list is deleted during the foundation migration.

## Acceptance criteria for the foundation slice

- existing production users retain access to the same migrated records;
- all current company-scoped records map to exactly one organization and workspace, except the intentional Overall compatibility case;
- an authenticated user from Organization A cannot access Organization B through direct Data API requests;
- a workspace member cannot access another workspace unless organization-level permissions explicitly allow it;
- login, logout, session restoration, password recovery, and email verification continue unchanged;
- migrations can be rolled back without deleting legacy data;
- no workspace, app, pipeline, plugin, or connector configuration is hardcoded to a particular industry or role.
