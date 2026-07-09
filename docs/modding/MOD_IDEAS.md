# Mod Ideas (documented, NOT scheduled to build)

> STATUS: a capture-only backlog. Everything here is a DESIGN NOTE, not a
> work item. Per Aaron's standing instruction, mod ideas are DOCUMENTED when
> raised and built ONLY when he explicitly schedules them. Do not start any
> of these without his go-ahead. Building them early would also violate the
> scope discipline (PORT_PLAN.md decision 17): the direct port and the mod
> architecture come first; everything here rides the finished seams later.

These are ideas for MODS (PORT_PLAN.md decision 18: everything new is a mod).
None is part of core. They are recorded so the mod architecture can be
designed with enough headroom to support them (system overhauls included),
not so they can be implemented now.

## Ideas

### AI agent player
An agent that actually plays Angband, in the spirit of the Borg but
nondeterministic. It drives the public command queue and reads the event bus
- the same seams any input source uses - and declares itself
`nondeterministic`, so core flips the save's determinism mode (decision 22).
Likely lands as part of AIngband. Validates that the command-queue/event-bus
API is strong enough to fully drive and observe the game. (The in-core Borg,
PORT_PLAN.md P8, is the deterministic cousin.)

### Intelligent controller / mobile input
A smart controller and touch input scheme so the game is playable on mobile
and with a gamepad. Rides the abstract input layer (keymap + command queue).
A mod, not a core feature (decision 21 keeps input abstract for exactly this).

### Soft caps instead of hard caps
Replace most hard limits with soft ones. For example: no fixed inventory
QUANTITY limit (carry as much as you like), but keep the WEIGHT limit as the
real constraint; no fixed-size artifact set (allow unlimited artifacts).
General principle: prefer a soft, resource-based limit (weight, encumbrance,
cost) over an arbitrary hard cap wherever it does not break balance the
player cares about. A mod, since it changes base rules (decision 18 permits
this freely).

### AI-generated content (AIngband)
AI-generated items, creatures, NPCs, shops, shop inventory, artifacts, and
more. This is expected to be the heart of AIngband, which becomes a
plugin/mod of this port. It fills the engine's content-generator seam
(docs/MODS.md "The AI seam"): generated output is validated DATA, never
trusted code, which is what makes it safe. Almost certainly nondeterministic,
so it triggers the decision-22 save mode flip. No AI provider ships in the
port; the mod supplies it.

## Not ideas - already committed deliverables

For clarity, these are NOT on this backlog because they are decided work,
not ideas: the two bundled mods **neo-linoleum** (tiles) and the **QoL** mod
(PORT_PLAN.md decision 18), which ship with the port, default to active, and
must be complete at release (decision 23).
