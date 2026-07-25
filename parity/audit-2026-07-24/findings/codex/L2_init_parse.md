### L2_init_parse-001  Negative random values are parsed with the wrong base
sev: P1
concession: n
ref: reference/src/parser.c:126
port: packages/content/src/parser.ts:208
expected: parse_random() treats a leading minus as whole-expression negation and adjusts base by subtracting m_bonus and dice * (sides + 1); for -3d5 it produces base -6, dice 1, sides 5.
actual: isValidRandom() only validates and preserves the raw string, then packages/core/src/obj/bind.ts:107 parses that raw -3d5 with Dice as base -3, dice 1, sides 5; shipped object.txt:2308 reaches this path through bindKinds at obj/bind.ts:676.
why: Negative random object values roll as -2..2 instead of the C range -5..-1, changing live object statistics and damage.
confidence: high

### L2_init_parse-002  Terrain look prefixes and prepositions miss C's terminating spaces
sev: P2
concession: n
ref: reference/src/init.c:2293
port: packages/core/src/world/feature.ts:132
expected: finish_parse_feat() appends one trailing space to every nonempty look_prefix and look_in_preposition that does not already end in a space.
actual: FeatureRegistry stores joined terrain strings verbatim and never applies the finish step; known.ts:212 returns the raw value, so terrain.txt:175 "the entrance to the" lacks C's added space before the feature name.
why: Store and similar terrain descriptions render with visible word-spacing drift in normal look/target text.
confidence: high

### L2_init_parse-003  File loader semantics are replaced by precompiled input
sev: P3
concession: y
ref: reference/src/datafile.c:87
port: packages/content/src/compile.ts:25
expected: parse_file() first tries the user filename, falls back to standard gamedata, parses every line, reports errors up to the configured limit, and returns the first error; the browser path has no raw user filesystem.
actual: compile.ts reads only reference/lib/gamedata at build time, records.ts:155 aborts on the first ParseError, and runtime loading consumes compiled pack JSON with no user-file override or equivalent parse-error stream.
why: Raw filesystem customization and native file diagnostics cannot be exposed in the browser runtime; this is an unavoidable browser concession.
confidence: high

## MAP L2_init_parse
reference/src/datafile.c -> packages/content/src/compile.ts; packages/content/src/records.ts; packages/content/src/parser.ts; packages/core/src/obj/bind.ts; packages/core/src/player/bind.ts; packages/core/src/world/trap.ts
reference/src/datafile.h -> packages/content/src/parser.ts; packages/content/src/records.ts; packages/core/src/obj/bind.ts
reference/src/init.c -> packages/content/src/specs/init.ts; packages/core/src/constants.ts; packages/core/src/player/bind.ts; packages/core/src/obj/bind.ts; packages/core/src/world/feature.ts; packages/core/src/world/trap.ts
reference/src/init.h -> packages/core/src/constants.ts; packages/core/src/player/types.ts; packages/core/src/session/game.ts
reference/src/parser.c -> packages/content/src/parser.ts
reference/src/parser.h -> packages/content/src/parser.ts; packages/content/src/records.ts
