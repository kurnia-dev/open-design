---
name: web-prototype-high-fidelity
description: |
  High-fidelity desktop web prototype built as a React + Vite + TypeScript application.
  Uses modular React components and Tailwind CSS v4 in the src/ directory. Default for high-fidelity prototypes.
triggers:
  - "prototype"
  - "mockup"
  - "landing"
  - "single page"
  - "marketing page"
  - "homepage"
od:
  mode: prototype
  platform: desktop
  scenario: design
  preview:
    type: react
    entry: src/main.tsx
  design_system:
    requires: true
    sections: [color, typography, layout, components]
---

# Web Prototype High Fidelity (React) Skill

Build a high-fidelity web prototype using React, Vite, and TypeScript. You must write modular React components within the `src/` directory. Do not produce a single-file HTML mockup.

## Workflow

### Step 0 — Pre-flight (do this once before writing anything)

1. **Check package.json** to see the design system dependencies.
2. **Read the active DESIGN.md** (already injected into your system prompt) to understand the component and styling guidelines.

### Step 1 — Scaffold the Components

1. Build small, modular components in `src/components/`.
2. Use Tailwind CSS v4 utility classes.
3. Import required components from the active design system instead of building your own if they are provided.

### Step 2 — Assemble the Page

Assemble the components in `src/App.tsx`. Make sure the file remains a valid React component. Use modern hooks and functional components.

### Step 3 — Self-check

Ensure that your code is strictly typed using TypeScript, your UI uses Tailwind classes that reflect the active design system, and the application builds cleanly.
