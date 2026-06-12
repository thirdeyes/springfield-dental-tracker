# Metrics and +Case Button Alignment

_Saved 2026-06-12T22:23:38.629Z by Mike_

## Summary
Metrics and +New Case currently float between button groups in the header and can overlap other controls when the desktop window is resized. They should be repositioned to a fixed left group next to the date nav and collapse gracefully on resize.

## Requested changes
- Move **Metrics** and **+New Case** to a fixed left group, positioned immediately left of the `<` back arrow.
- Resulting order: `[Metrics] [+New Case] [<] [date] [>] …`
- On desktop resize, collapse Metrics & +New Case to icon-only when space is constrained, preventing overlap with adjacent button groups.
- Date navigation arrows (`<` / `>`) must always remain visible, never collapse.
- Add tooltips (`title`) and `aria-label`s to the collapsed icon buttons for clarity/accessibility.

## Open questions
- Collapse trigger: fixed breakpoint vs. dynamic overflow detection?
- Preferred icons for collapsed state (📊 Metrics, ＋ New Case)?
