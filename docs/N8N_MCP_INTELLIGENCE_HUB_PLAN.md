# CodeMe n8n MCP Intelligence Hub Plan

## Goal

Treat n8n as CodeMe's general external intelligence and integration hub, not only as a research helper.

CodeMe remains the owner of the local coding run: workspace files, terminal/processes, browser, Git, diagnostics, tests, permissions, verification, and final completion. n8n can expose specialist tools and workflows through MCP, including research, image/vision, OCR, documents, APIs, databases, GitHub, communication, automation, and other integrations.

## Target architecture

```text
User
  |
  v
CodeMe Orchestrator
  |
  +-- Selected coding model -------------------------------+
  |                                                       |
  +-- Local/remote vision role                             |
  |                                                       |
  +-- n8n MCP tool registry                               |
  |     +-- research / web / docs                         |
  |     +-- image / vision / OCR                          |
  |     +-- document / PDF                                |
  |     +-- GitHub / APIs / databases                     |
  |     +-- communication / automation                    |
  |     +-- future specialist tools                       |
  |                                                       |
  +-- CodeMe Agent Harness                                |
        +-- file / repo                                   |
        +-- terminal / process                            |
        +-- browser                                       |
        +-- diagnostics / tests                           |
        +-- git                                           |
        +-- verification ---------------------------------+
```

n8n observations are external/untrusted evidence. An n8n result is never permission to mutate the local workspace. Local changes must still go through CodeMe's registered local tools and verification loop.

## Phase 1 — MCP discovery and classification

Status: implemented on `codeme/reference-pipeline-port`.

CodeMe calls n8n MCP `tools/list` and now keeps metadata for each published tool:

- external tool name
- CodeMe wire name
- category
- whether the schema accepts image input
- whether the tool appears capable of an external side effect

Current categories are:

- image
- document
- research
- code
- github
- data
- communication
- deploy
- general

The Composer receives this registry and exposes a live n8n tool inspector.

### Acceptance

- The IDE shows the number of discovered n8n MCP tools.
- Each tool shows its category.
- Image-capable tools are visibly tagged.
- External-action tools are visibly tagged.
- The registry refreshes with the existing hub polling cycle.

## Phase 2 — Explicit permission boundaries

Status: implemented foundation.

Two CodeMe settings control external n8n data/actions:

- `codeme.n8n.allowImageUpload` — default `false`
- `codeme.n8n.allowActions` — default `false`

Rules:

1. Local vision may inspect an attached image without enabling n8n image upload.
2. n8n may receive the structured local vision summary without raw-image permission.
3. Raw image bytes may only be sent to n8n when image upload permission is enabled.
4. n8n tools classified as potential external actions are blocked when action permission is disabled.
5. Enabling n8n actions does not grant n8n local filesystem or terminal access.

### Acceptance

- Raw image bytes never reach n8n when image permission is off.
- A blocked external action never reaches n8n `tools/call`.
- Action permission and image permission are independent.
- Secrets and image Base64 are not copied into model-visible tool logs.

## Phase 3 — n8n image bridge

Status: implemented foundation.

When image upload permission is enabled:

1. CodeMe discovers image-capable MCP tools from their name, description, and input schema.
2. CodeMe chooses a read/evidence image tool, preferring analyze/vision/OCR/read semantics.
3. Attached images are read through the CodeMe attachment boundary.
4. Image data is injected only into an explicitly declared image field in the MCP schema.
5. The n8n tool receives Base64, data URI, or a bounded image object depending on the schema.
6. The result is stored as untrusted external evidence.
7. Returned binary MCP content is summarized as metadata instead of injecting Base64 into the coding model context.

The current n8n image-assist payload is bounded to 6 MB total per automatic assist call.

### Combined image flow

```text
Attached screenshot
      |
      +--> Vision model --> structured visual spec --------+
      |                                                    |
      +--> n8n image/OCR tool (permission required) -------+
                                                           |
                                                           v
                                                Combined model context
                                                           |
                                                           v
                                                  Selected coding model
                                                           |
                                                           v
                                              CodeMe tools + verification
```

Either vision source may fail independently. CodeMe must not pretend an unavailable source succeeded.

## Phase 4 — Capability-aware routing

Status: next.

Replace ad-hoc name-based routing with a central CodeMe role router.

Each model/tool should advertise capabilities such as:

```text
text
tools
vision
embedding
network
external_action
document
structured_output
```

Routing should answer:

- Which selected model owns the main coding loop?
- Which model/provider handles vision?
- Which n8n tools are relevant to this task?
- Does the task require fresh external evidence?
- Does an external call require permission?
- What fallback is allowed when a provider is offline?

The user's selected coding model remains the default coder. Specialist roles must not silently replace that choice.

## Phase 5 — n8n tool selection policy

Status: next.

Do not send every n8n tool to every model turn.

Add a router that selects a bounded relevant subset from the live registry based on:

- task intent
- tool category
- required input schema
- attachments
- current run failures
- freshness requirement
- permissions

Examples:

```text
Screenshot UI task
  -> image/OCR + optional web/docs

Terminal error
  -> debug/docs/search

GitHub issue task
  -> GitHub + research

Database question
  -> data tools

Normal CSS edit
  -> no external tool unless required
```

This keeps small local models from being overwhelmed by a large MCP tool list.

## Phase 6 — Terminal-to-n8n diagnosis

Status: planned.

Use the CodeMe-owned process/terminal observer to create a safe diagnostic packet:

- command label, not secrets
- exit code
- bounded stdout/stderr excerpt
- detected framework/runtime
- relevant error signature
- files already inspected
- user goal

Then route that packet to appropriate n8n debug/docs tools. n8n never receives unrestricted terminal control. CodeMe applies the repair locally and re-runs verification.

## Phase 7 — Documents and richer MCP media

Status: planned.

Add first-class handling for MCP content types rather than flattening them into strings:

- text
- image
- resource
- document/PDF references
- structured JSON

Binary content stays out of normal LLM transcripts unless an explicit multimodal route requires it.

## Phase 8 — External action approval UX

Status: planned.

External actions need per-run/user-visible approval rather than only a global setting.

Examples:

- send an email
- post a Slack message
- create/update a ticket
- deploy
- write to an external database
- trigger a business workflow

The approval surface should show:

- n8n tool name
- destination/service
- concise arguments with secrets redacted
- expected side effect
- Allow once / Cancel

Local CodeMe file edits remain governed by CodeMe's existing Code mode and workspace policies.

## Phase 9 — Tool registry UI

Status: foundation implemented; richer UI planned.

Current inspector should grow into a small registry view with:

- connected/offline state
- tool count
- category filters
- image capability
- read/action badge
- permission state
- last health/discovery time
- schema/details on expand
- manual refresh
- test-tool action for safe/read tools

## Regression and live acceptance gate

The feature is not complete until all of the following pass.

1. Discover multiple n8n MCP tools dynamically.
2. Classify an image-analysis tool as image-capable.
3. Classify an external send/update tool as an action.
4. Keep external actions blocked by default.
5. Keep raw image upload blocked by default.
6. Enable image permission and verify actual image bytes reach the declared n8n image field.
7. Verify Base64 is absent from CodeMe model-visible logs/results.
8. Run local vision and n8n vision on the same screenshot.
9. Confirm both results enter the coding context with trust labels.
10. Make a screenshot-driven code change with a non-default coding model.
11. Start the app and verify it in the CodeMe browser.
12. Turn n8n offline and prove the local coding/vision path still works.
13. Turn the local vision model offline and prove an allowed n8n image tool can provide the visual evidence.
14. Attempt a blocked n8n external action and prove n8n never receives the call.
15. Confirm normal coding without image/external evidence does not unnecessarily call n8n.

## Non-negotiable boundaries

- n8n is not the low-level coding runtime.
- n8n does not get unrestricted shell access.
- n8n does not get a raw repository dump.
- n8n output is untrusted evidence.
- Model/provider selection is role/capability based, not Qwen-specific.
- Raw image upload is explicit.
- External side effects require explicit permission.
- Verification remains local to CodeMe.
