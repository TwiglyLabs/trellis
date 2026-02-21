# MCP Reference

Trellis exposes six tools via the [Model Context Protocol](https://modelcontextprotocol.io/) for AI agent integration. The server runs on stdio transport.

## Starting the Server

```bash
trellis mcp
```

All communication uses JSON-RPC over stdin/stdout.

## Tools

### trellis_create

Scaffold a new plan directory with `README.md` containing frontmatter and section headings.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Plan ID (becomes directory name under plans/) |
| `title` | string | Yes | Plan title for frontmatter |
| `description` | string | No | One-line description |
| `depends_on` | string[] | No | Plan IDs this depends on |
| `tags` | string[] | No | Freeform tags |

**Example Request:**

```json
{
  "id": "auth-system",
  "title": "Authentication System",
  "description": "Add user login and session management",
  "depends_on": ["core-types", "database-schema"],
  "tags": ["foundation", "epic:v1"]
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "filePath": "plans/auth-system/README.md"
}
```

---

### trellis_write_section

Write prose content into a specific section of a plan file. Replaces everything between `##` headings.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `file` | enum | Yes | `readme`, `implementation`, `inputs`, or `outputs` |
| `section` | string | Yes | Section name (e.g., `"Problem"`, `"Approach"`, `"Steps"`) |
| `content` | string | Yes | Markdown content to write into the section |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "file": "readme",
  "section": "Problem",
  "content": "\nUsers currently have no way to log in. The app serves all content anonymously,\nwhich prevents personalization and access control.\n"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "file": "readme",
  "section": "Problem"
}
```

If the section doesn't exist in the file, it is appended at the end. If the file doesn't exist, it is created.

---

### trellis_write_sections

Write multiple sections to a plan in one atomic operation. Groups writes by file — each file gets a single read-modify-write cycle. Preferred over multiple `trellis_write_section` calls when writing several sections at once.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `writes` | array | Yes | Array of section writes (min 1) |
| `writes[].file` | enum | Yes | `readme`, `implementation`, `inputs`, or `outputs` |
| `writes[].section` | string | Yes | Section name (e.g., `"Problem"`, `"Steps"`) |
| `writes[].content` | string | Yes | Markdown content for the section |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "writes": [
    { "file": "readme", "section": "Problem", "content": "Users cannot log in.\n" },
    { "file": "readme", "section": "Approach", "content": "Add OAuth2 with session tokens.\n" },
    { "file": "implementation", "section": "Steps", "content": "1. Add login endpoint\n2. Add session middleware\n" }
  ]
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "writes": [
    { "file": "readme", "section": "Problem" },
    { "file": "readme", "section": "Approach" },
    { "file": "implementation", "section": "Steps" }
  ]
}
```

This tool eliminates race conditions when writing multiple sections — all writes to the same file are applied to a single in-memory copy before writing back to disk.

---

### trellis_read_section

Read plan content at various granularities. Supports reading the whole plan, a specific file, or a specific section.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `file` | enum | No | `readme`, `implementation`, `inputs`, or `outputs`. Omit for whole plan. |
| `section` | string | No | Section name. Requires `file`. |

**Example: Read whole plan**

```json
{
  "plan_id": "auth-system"
}
```

Returns concatenated content of all plan files.

**Example: Read specific file**

```json
{
  "plan_id": "auth-system",
  "file": "implementation"
}
```

Returns full content of `implementation.md`.

**Example: Read specific section**

```json
{
  "plan_id": "auth-system",
  "file": "readme",
  "section": "Problem"
}
```

Returns only the content under `## Problem`.

---

### trellis_set

Update a frontmatter field on a plan. Cannot set `status` — use `trellis_update` for status transitions.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `field` | string | Yes | Frontmatter field name (not `"status"`) |
| `value` | string or string[] | Yes | New value |
| `mode` | enum | No | `replace` (default), `add`, or `remove`. `add`/`remove` only for list fields. |

**Editable fields:** `title`, `description`, `depends_on`, `tags`, `repo`, `assignee`.

**List fields** (support `add`/`remove` mode): `depends_on`, `tags`.

**Example: Replace a field**

```json
{
  "plan_id": "auth-system",
  "field": "description",
  "value": "OAuth2 login with session tokens"
}
```

**Example: Add a tag**

```json
{
  "plan_id": "auth-system",
  "field": "tags",
  "value": ["security"],
  "mode": "add"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "field": "tags",
  "value": ["foundation", "epic:v1", "security"],
  "previous_value": ["foundation", "epic:v1"]
}
```

---

### trellis_update

Transition a plan to a new status. Enforces [status gates](plan-schema.md#status-gates) unless `force` is true.

**Input Schema:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | Yes | Plan ID |
| `status` | enum | Yes | `draft`, `not_started`, `in_progress`, `done`, `archived` |
| `force` | boolean | No | Bypass status gate validation |

**Example Request:**

```json
{
  "plan_id": "auth-system",
  "status": "in_progress"
}
```

**Example Response:**

```json
{
  "id": "auth-system",
  "previous_status": "not_started",
  "status": "in_progress",
  "backward": false,
  "newly_ready": ["api-endpoints"]
}
```

The `newly_ready` array lists plans that became ready as a result of this status change.

## Error Handling

All tools return errors in this format:

```json
{
  "content": [{ "type": "text", "text": "Plan not found: nonexistent-plan" }],
  "isError": true
}
```

Common errors:
- Plan not found
- Status gate validation failed (lists missing requirements)
- `trellis_set` rejects `status` field (use `trellis_update`)
- `trellis_set` rejects unknown field names
- `trellis_read_section` rejects `section` without `file`
