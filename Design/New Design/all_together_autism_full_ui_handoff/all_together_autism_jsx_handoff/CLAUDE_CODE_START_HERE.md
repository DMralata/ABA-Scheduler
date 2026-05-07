# All Together Autism JSX Handoff Package

This package contains reference `.jsx` and `.css` files to help Claude Code implement the All Together Autism UI redesign.

Use these files with the main implementation spec:

```txt
all_together_autism_ui_redesign_implementation_spec.md
```

## Important

These are **reference implementation components**, not guaranteed drop-in files for the existing codebase.

Claude Code should:

1. Inspect the existing project structure first.
2. Reuse current routes, business logic, data fetching, and mutation handlers.
3. Map these components into the actual app structure.
4. Preserve existing schedule calculations, message sending logic, and CRUD flows.
5. Replace old styling with these shared components/tokens.
6. Use **All Together Autism** branding only.

## Logo

Use the provided All Together Autism logo asset from the project.

Recommended paths to adapt:

```txt
/public/assets/all-together-autism-logo.svg
/public/assets/all-together-autism-mark.svg
/src/assets/all-together-autism-logo.svg
/src/assets/all-together-autism-mark.svg
```

The sample sidebar expects:

```jsx
logoSrc="/assets/all-together-autism-logo.svg"
markSrc="/assets/all-together-autism-mark.svg"
```

Update those paths to match the actual project.

## Package Contents

```txt
src/styles/ata-tokens.css

src/components/app/AppShell.jsx
src/components/app/SidebarNav.jsx

src/components/ui/Button.jsx
src/components/ui/Card.jsx
src/components/ui/Badge.jsx
src/components/ui/Chip.jsx
src/components/ui/ProgressBar.jsx
src/components/ui/DataTable.jsx
src/components/ui/Modal.jsx
src/components/ui/SearchInput.jsx
src/components/ui/FilterBar.jsx
src/components/ui/FloatingActionDock.jsx

src/components/schedule/SessionBlock.jsx
src/pages/schedule/ScheduleDayView.jsx
src/pages/schedule/ScheduleWeekView.jsx
src/pages/schedule/NewSessionModal.jsx
src/pages/schedule/CancelSessionModal.jsx

src/pages/communications/CommunicationsPage.jsx

src/pages/clients/ClientsListPage.jsx
src/pages/clients/ClientDetailPage.jsx

src/pages/providers/ProvidersListPage.jsx
src/pages/providers/ProviderDetailPage.jsx

src/data/sampleData.js
```

## Suggested Integration Order

```txt
1. Add tokens CSS.
2. Add AppShell and SidebarNav.
3. Add shared UI components.
4. Wire Clients list/detail.
5. Wire Providers list/detail.
6. Wire Schedule day/week and modals.
7. Wire Communications.
8. QA against the Markdown checklist.
```

## Dependency Note

The JSX uses `lucide-react` icons. If the app does not use lucide, either install it or map icons to the existing icon library.

```bash
npm install lucide-react
```
