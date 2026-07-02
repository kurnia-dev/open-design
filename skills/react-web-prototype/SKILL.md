---
name: react-web-prototype
description: |
  High-fidelity web prototype built as a React + Vite + TypeScript application. Uses modular React components and Tailwind CSS v4 in the src/ directory. Default for high-fidelity web prototypes.
triggers:
  - "react"
  - "react web"
  - "react prototype"
  - "react component"
  - "vite prototype"
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
  craft:
    requires: [typography, color, anti-ai-slop]
  example_prompt: "Build a high-fidelity React landing page for a developer tool — polished typography, component breakdown in src/, Tailwind CSS v4, and responsive layout."
  fidelity: high-fidelity
  default_for:
    - prototype
---

# React Web Prototype Skill

Build a high-fidelity web prototype using React, Vite, and TypeScript. Write modular React components within the `src/` directory.

## Workflow

### Step 0 — Pre-flight

1. Check `package.json` for design system dependencies.
2. Read the active `DESIGN.md` (already injected into your system prompt) for component and styling guidelines.

### Step 1 — Scaffold Components

1. Build small, modular components in `src/components/`.
2. Use Tailwind CSS v4 utility classes for styling.
3. Import provided components from the active design system instead of building your own.

### Step 2 — Assemble the Page

Assemble components in `src/App.tsx`. Keep it a valid React component using modern hooks and functional components.

### Step 3 — Responsive Layout

Ensure the layout reflows gracefully across mobile, tablet, and desktop breakpoints. Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`).

### Step 4 — Self-check

- Strict TypeScript throughout
- Tailwind classes reflect the active design system
- Application builds cleanly with `npm run build` or `vite build`
- No placeholder text, no invented metrics, no filler content
