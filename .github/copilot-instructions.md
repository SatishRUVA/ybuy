# YBuy Copilot Instructions

Read and follow `AGENTS.md` before making changes.

YBuy is a Vite + React + TypeScript application.

Do not migrate to Next.js.

Preserve the existing Bolt.ai-generated UI, routing, components and design system.

Inspect existing code before creating anything.

Reuse existing code before adding new code.

Follow the Ponytail principle:
- Do not build unnecessary things.
- Do not duplicate existing functionality.
- Avoid unnecessary dependencies.
- Prefer the smallest correct implementation.
- Fix root causes rather than symptoms.

Do not implement Part 2 functionality.

Never compromise:
- security
- authentication
- authorization
- RLS
- payment verification
- input validation
- data integrity
- accessibility

Never claim an MCP server or skill is available unless it is actually connected.