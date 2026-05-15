# Antigravity Agent Configuration

This directory contains the "Agent Personas" used for Spec-Driven Development on the iOS + Vercel stack.

## How to use these agents

When you want to start a new phase of development, simply tell the primary Antigravity agent:

> "Switch to the **[Agent Name]** persona and [Task Description]"

The agent will then load the instructions from the corresponding file in `.antigravity/agents/` and follow its specific principles and toolsets.

## The Agent Lineup

| Agent | Focus | Key Deliverable |
| :--- | :--- | :--- |
| **[Architect](agents/architect.md)** | System Design & Specs | `specs/` files |
| **[iOS Developer](agents/ios_developer.md)** | Native SwiftUI | `ios-app/` code |
| **[Backend Engineer](agents/backend_engineer.md)** | Vercel & Node.js | `backend/` code |
| **[Validator](agents/validator.md)** | QA & Verification | `walkthrough.md` |

## Project Structure
- `specs/`: The source of truth (managed by Architect).
- `ios-app/`: Xcode project and Swift code.
- `backend/`: Next.js / Vercel API routes.
- `artifacts/`: Automatically generated Plans and Walkthroughs.
