# Header GitHub And Feedback Entry Design

## Goal

Add two new header actions to the app shell:

- A GitHub icon button that opens the existing repository in a new tab
- A feedback button that opens a modal showing the maintainer QQ number and QQ email

This change should fit the current top navigation style in `src/ui/App.vue` and reuse existing modal patterns.

## User Experience

The new actions live in the top-right navigation action row with the existing page links, patch notes button, theme toggle, and language switcher.

- `GitHub` is a compact icon-first external link button
- `Feedback / 反馈` is a muted button that opens a modal
- The feedback modal displays:
  - `QQ: 596846069`
  - `Email: 596846069@qq.com`

The email is clickable through a `mailto:` link. QQ and email both provide copy actions so users can quickly contact the maintainer.

## Component Design

### Header Actions

Update `src/ui/App.vue` to add:

- A GitHub repository URL constant sourced from the existing repository metadata already present in the project
- A feedback modal open state
- A compact inline SVG GitHub icon rendered inside a button-styled external link
- A feedback trigger button placed next to the GitHub entry

These actions should reuse the existing `action-button-muted` visual language so they look native to the current shell.

### Feedback Modal

Reuse the existing `BaseModal` component in `src/ui/App.vue`.

Modal content includes:

- Short helper copy explaining that users can use the following channels for feedback or issue reports
- Two structured rows for QQ and email
- Clickable mail link for the email row
- Copy buttons for each contact field
- Shared copy status text that confirms success or failure

## Data Flow

No backend or store changes are required.

- Header button click sets modal state to open
- Copy buttons use `navigator.clipboard.writeText`
- Email link uses a static `mailto:` URL
- GitHub button opens the repository with `target="_blank"` and `rel="noopener noreferrer"`

## Error Handling

If clipboard access fails, the modal shows a lightweight failure message using the same inline status pattern already used elsewhere in `App.vue`.

No blocking behavior is needed because the contact details remain visible even when copy fails.

## Testing

Add or update a lightweight UI test covering the shell template so we verify:

- The GitHub header entry is rendered
- The feedback trigger is rendered
- The feedback modal contains the QQ number and email when opened

Implementation should follow existing test patterns in `src/ui/__tests__`.
