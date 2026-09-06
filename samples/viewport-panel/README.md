# Viewport Panel: a mobile panel sample

This small plugin opens a modal form and reports `visualViewport` dimensions in
the panel. It is the runnable reference for `ui:panel.mount` on a phone.

Copy the folder to `data/mods/` beside the desktop build, enable **Viewport
Panel**, approve `ui:panel.mount`, and reload. Tap the notes field. The panel
and canvas follow the visible viewport when the keyboard opens; the notes field
also calls `scrollIntoView({ block: "center" })` so browser input chrome cannot
cover the focused field.

The sample intentionally does not set a fixed width, height, or position for
the panel host. Those belong to the host, which owns the escape control and the
same visible rectangle as the game canvas.
