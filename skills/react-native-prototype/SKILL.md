---
name: react-native-prototype
description: |
  Cross-platform mobile prototype built as a React Native (Expo) application. Uses modular React Native components with platform-aware styling for iOS and Android. Default for mobile high-fidelity prototypes.
triggers:
  - "react native"
  - "mobile app"
  - "ios app"
  - "android app"
  - "expo"
  - "mobile prototype"
  - "app prototype"
od:
  mode: prototype
  platform: mobile
  scenario: design
  preview:
    type: react-native
    entry: src/App.tsx
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [typography, color, anti-ai-slop]
  example_prompt: "Build a polished React Native onboarding flow for a fintech app — multiple screens with navigation, form inputs, biometric prompts, and platform-adaptive UI."
  fidelity: high-fidelity
  default_for:
    - prototype
---

# React Native Prototype Skill

Build a cross-platform mobile prototype using React Native (Expo). Write modular components with platform-aware styling for iOS and Android.

## Workflow

### Step 0 — Pre-flight

1. Check `package.json` for design system and navigation dependencies.
2. Read the active `DESIGN.md` (already injected into your system prompt) for component and styling guidelines.

### Step 1 — Scaffold Components

1. Build small, modular components in `src/components/`.
2. Use React Native's `StyleSheet` API or a styling solution compatible with the active design system.
3. Import provided components from the active design system when available.

### Step 2 — Screen Structure

1. Create screens in `src/screens/` — one file per screen.
2. Use `@react-navigation/native` for navigation between screens.
3. Keep navigation config in a separate `src/navigation/` file.

### Step 3 — Platform Adaptation

1. Use `Platform.select()` or `.ios.tsx` / `.android.tsx` extensions for platform-specific code.
2. Respect safe area insets using `react-native-safe-area-context`.
3. Follow iOS Human Interface Guidelines and Material Design for platform-appropriate interactions.

### Step 4 — Mobile-First Constraints

- Touch targets minimum 44pt
- No horizontal scroll on main screens
- Keyboard-aware inputs with `KeyboardAvoidingView`
- Proper `StatusBar` configuration per platform
- `ScrollView` for content that exceeds viewport

### Step 5 — Self-check

- Strict TypeScript throughout
- No web-only APIs (`document`, `window`, DOM queries)
- Navigates correctly between screens
- Runs without errors on both iOS and Android simulators
- No placeholder text, no invented metrics
