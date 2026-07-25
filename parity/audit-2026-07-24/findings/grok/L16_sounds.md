# L16_sounds audit (sounds: lib/sounds + sound engine)
Auditor: grok. Method: re-derivation against reference C and assets (not prior ledgers).
Lane: reference/src/sound*.{c,h}, snd-sdl*, snd-win.h, reference/lib/sounds/** (mp3 pack + Makefile).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary:
- Core engine (message->sound map, djb2 dedup, MAX_SOUNDS_PER_MESSAGE-1 cap, randint0 pick,
  lazy/preload load status) is packages/core/src/sound/engine.ts + types.ts.
- MSG name table is packages/core/src/generated/message.ts (from list-message.h).
- sound.prf mapping is codegen'd to packages/core/src/sound/sound-prefs-data.ts
  (packages/core/scripts/gen-sound-prefs.mjs from reference/lib/customize/sound.prf).
- Web platform hooks (HTMLAudioElement load/play/unload) are packages/web/src/sound.ts.
- Live wiring: packages/web/src/main.ts installWebSound + state.sound gated on use_sound;
  core emits via state.sound(MSG_*) from combat/ambient/msgt-equivalent paths.
- Default pack: packages/web/public/sounds/*.mp3 (213 files, SHA256 match to reference).

Verified equalities (no finding):
- All 213 reference/lib/sounds/*.mp3 are present under packages/web/public/sounds/ with
  identical SHA256 (full-set compare: match=213 mism=0).
- All 149 sound: directives in sound.prf match SOUND_PREF_ENTRIES type+sounds strings exactly.
- Every prf sample basename resolves to an on-disk mp3; every mp3 is referenced by the prf.
- play selection uses state.rng.randint0 (game RNG), matching C play_sound randint0.
- use_sound option normal:false; state.sound returns early when off (message.c sound()).
- MAX_SOUNDS_PER_MESSAGE=16 with cap at MAX-1 (15) preserved; prf max is 12 (MON_BITE).
- Ambient depth/day mapping in playAmbientSound matches game-world.c play_ambient_sound.

### L16_sounds-001  Web load marks LOADED without file_exists; blocks multi-extension fallback
sev: P2
concession: n
ref: reference/src/sound-core.c:145-164 (for each supported ext: only if file_exists set ERROR then load_sound_hook; continue until load_success); reference/src/snd-sdl.c:54-56 (try .mp3 then .ogg)
port: packages/core/src/sound/engine.ts:120-127 (calls loadSound(name, type) until true); packages/web/src/sound.ts:74-98 (always new Audio()+src, status=LOADED, return true; error only async)
expected: Missing .mp3 is skipped; existing .ogg is loaded on the next supported_files entry. A failed Mix_Load* on an existing file leaves room to try the next extension in the same load_sound call.
actual: The web hook returns true and sets LOADED for the first format (.mp3) without existence/decode proof. The core loop never tries .ogg. A 404 .mp3 may briefly be LOADED until the error event flips ERROR; .ogg is never attempted.
why: Ogg-only (or mp3-broken/ogg-present) user packs via ?sounds= stay silent; C would fall through. Default Dubtrain pack is all .mp3 so the stock path works.
confidence: high

### L16_sounds-002  Default .mp3 pack is exclusive under SDL Mix_PlayMusic; web overlaps samples
sev: P3
concession: ?
ref: reference/src/snd-sdl.c:54-56,188-190 (.mp3 => SDL_MUSIC; Mix_PlayMusic single stream, loops=1); reference/src/main-win.c:1281-1287 (per-sample MCI device can overlap for WIN_MP3)
port: packages/web/src/sound.ts:101-114 (each sample owns an HTMLAudioElement; play does not halt peers)
expected: Under the SDL backend every shipped sample is music: starting a new sound stops the previous. Under the Win MP3 path samples may overlap. Upstream backends already disagree.
actual: Web allows concurrent playback of distinct samples (hit+kill, ambient+action). Same sample restarts via currentTime=0 (closer to restart-music than multi-channel chunk).
why: Audible mix differs from SDL builds of the same pack. Serialization is achievable in-browser but Win MCI also overlaps; treated as platform-module variance, not a core map bug.
confidence: high

### L16_sounds-003  messageLookupByName is case-sensitive and ignores numeric MSG indices
sev: P3
concession: n
ref: reference/src/message.c:295-316 (strtoul numeric form when pe!=name; else my_stricmp against message_names)
port: packages/core/src/sound/engine.ts:37-41 (strict === against MESSAGE_ENTRIES[i].name only)
expected: "hit", "HIT", and "2" all resolve to MSG_HIT when loading sound prefs.
actual: Only exact-case names match. Lowercase or numeric type tokens are skipped (loadPrefs continues on idx<0).
why: Stock sound.prf uses exact uppercase names so the bundled map loads. Custom/hand-edited prefs that rely on case-insensitivity or numeric ids silently drop lines.
confidence: high

### L16_sounds-004  Pref tokenizer drops empty tokens; C keeps them as empty sample names
sev: P3
concession: n
ref: reference/src/sound-core.c:195-266 (strchr space walk; consecutive spaces yield a zero-length cur_token that still enters the pool/map)
port: packages/core/src/sound/engine.ts:149 (split(" ").filter(t => t.length > 0)); engine.test.ts:91-95 (asserts collapse to ["a","b"])
expected: "a  b" defines three entries: "a", "", "b" (empty name still gets a sound id if under the per-message cap).
actual: Port drops empties; double spaces never create a blank sample. Unit test documents the divergence as if it matched C.
why: Stock sound.prf has no double spaces (max impact none). Custom prefs with odd spacing would map different id lists / counts and change randint0 range.
confidence: high

### L16_sounds-005  Browser autoplay policy can swallow play() until a user gesture
sev: P2
concession: y
ref: reference/src/snd-sdl.c:177-198 (Mix_Play* plays immediately when the mixer is open); reference/src/message.c:368-374 (sound() only gated by use_sound)
port: packages/web/src/sound.ts:108-110 (void plat.audio.play().catch(() => {}))
expected: With use_sound on and a loaded sample, play_sound produces audible output without an extra unlock step.
actual: Browsers may reject HTMLMediaElement.play() before a user gesture; the rejection is swallowed and the game stays silent. Toggling use_sound or any prior key/click usually unlocks later plays.
why: Unavoidable browser security model; no native mixer equivalent. Logged so silent-on-first-enable is not blamed on the core map.
confidence: high

### L16_sounds-006  No open_audio equivalent of Mix_OpenAudio(22050, S16, stereo, 4096)
sev: P3
concession: y
ref: reference/src/snd-sdl.c:65-83 (open_audio_sdl: SDL_Init audio + Mix_OpenAudio 22050/AUDIO_S16/2/4096); reference/src/sound-core.c:376-380 (init_sound fails without successful open_audio_hook)
port: packages/web/src/sound.ts:71-126 (no openAudio/closeAudio hooks); packages/core/src/sound/engine.ts:230-236 (openAudio optional; missing hook still inits)
expected: Platform opens a 22050 Hz S16 stereo mixer before EVENT_SOUND is hooked; failure aborts sound init.
actual: Browser uses the UA default audio pipeline (typically 44.1/48 kHz). No open failure path; hooks always "succeed". Subtle resampling/latency differences only.
why: No raw mixer API in the browser; unavoidable host difference. Not a mapping or sample-selection defect.
confidence: high

### L16_sounds-007  print_sound_help / sound module registry not ported
sev: P3
concession: y
ref: reference/src/sound-core.c:60-72,356-370,431-437 (sound_modules[] sdl/win/cocoa; init_sound name select; print_sound_help)
port: NONE (web always uses createWebSoundHooks; no -s module CLI)
expected: CLI lists and selects platform sound modules by name.
actual: Single browser backend, installed from main.ts. No help text or module switch.
why: Host packaging / CLI surface only; browser has one audio API. No play-path sample map impact.
confidence: high

### L16_sounds-008  lib/sounds Makefile install rules have no make consumer
sev: P3
concession: y
ref: reference/lib/sounds/Makefile (DATA list of all 213 mp3; PACKAGE=sounds buildsys install)
port: NONE (assets shipped as packages/web/public/sounds/* via Vite static public/)
expected: Native install copies the sound pack into the game lib tree.
actual: Browser static hosting + optional ?sounds= base URL. No Makefile path.
why: Host packaging only (same class as tiles Makefiles). Assets themselves are present and byte-identical.
confidence: high

### L16_sounds-009  Runtime user sound.prf overrides not loadable (compile-time map only)
sev: P3
concession: n
ref: reference/src/sound-core.c:273-304 (register_sound_pref_parser + parse_prefs_sound during pref load; user customize can replace sound: lines); reference/lib/customize/sound.prf
port: packages/core/src/sound/sound-prefs-data.ts (generated SOUND_PREF_ENTRIES); packages/web/src/sound.ts:149 (engine.loadPrefs(SOUND_PREF_ENTRIES) only)
expected: A user/custom sound.prf can redefine message->sample lists at pref-load time without rebuilding the game.
actual: Only the baked 149-entry table is loaded. Sample *files* can be swapped via ?sounds=/baseUrl, but message mapping cannot be overridden at runtime.
why: Faithful equivalent (fetch+parse sound.prf) is achievable in-browser; stock map matches upstream so default play is correct.
confidence: high

### L16_sounds-010  snd-win.h Windows MCI module has no native port (web substitute only)
sev: P3
concession: y
ref: reference/src/snd-win.h:31 (init_sound_win); reference/src/main-win.c play_sound_win / load paths
port: NONE as Win MCI; substitute packages/web/src/sound.ts (HTMLAudio SoundHooks)
expected: Windows builds can use the win sound module when SDL is off.
actual: Browser port never loads MCI/PlaySound. HTMLAudio covers the platform half.
why: Unavoidable platform swap for a web target; core sound-core behavior is what must match.
confidence: high

## MAP L16_sounds
reference/src/sound.h -> packages/core/src/sound/types.ts (SoundStatus, SoundData, SoundFileType, SoundHooks, MAX_SOUNDS_PER_MESSAGE); packages/core/src/sound/engine.ts (API surface)
reference/src/sound-core.c -> packages/core/src/sound/engine.ts (SoundEngine: message_sound_define, load_sound, play_sound, init/close, loadPrefs); packages/core/src/sound/sound-prefs-data.ts (SOUND_PREF_ENTRIES from sound.prf); packages/core/src/sound/index.ts; packages/core/scripts/gen-sound-prefs.mjs; live emit packages/web/src/main.ts state.sound + packages/core/src/game/* state.sound calls; ambient packages/core/src/game/world.ts playAmbientSound
reference/src/snd-sdl.c -> packages/web/src/sound.ts (createWebSoundHooks / installWebSound: open/load/play/unload analogue via HTMLAudioElement; format order .mp3 then .ogg)
reference/src/snd-sdl.h -> packages/web/src/sound.ts (init_sound_sdl analogue: installWebSound wires hooks)
reference/src/snd-win.h -> NONE (Windows MCI module; web substitute packages/web/src/sound.ts)
reference/lib/sounds/Makefile -> NONE (install packaging; web uses public/sounds static ship)
(support) reference/lib/customize/sound.prf -> packages/core/src/sound/sound-prefs-data.ts (149 sound: lines; not in lane file list but is the msgt map oracle)
(support) packages/core/src/generated/message.ts -> MSG_* indices for lookup/play
(support) packages/core/src/msg.ts -> Messages.sound use_sound gate (facade; live path uses state.sound in main.ts)
(support) packages/web/src/main.ts -> installWebSound, use_sound gate, default baseUrl "sounds/"
reference/lib/sounds/amb_bell_metal1.mp3 -> packages/web/public/sounds/amb_bell_metal1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_metal2.mp3 -> packages/web/public/sounds/amb_bell_metal2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet1.mp3 -> packages/web/public/sounds/amb_bell_tibet1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet2.mp3 -> packages/web/public/sounds/amb_bell_tibet2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_bell_tibet3.mp3 -> packages/web/public/sounds/amb_bell_tibet3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_door_doom.mp3 -> packages/web/public/sounds/amb_door_doom.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_door_iron.mp3 -> packages/web/public/sounds/amb_door_iron.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_dungeon_echo.mp3 -> packages/web/public/sounds/amb_dungeon_echo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_dungeon_echowet.mp3 -> packages/web/public/sounds/amb_dungeon_echowet.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_chinese.mp3 -> packages/web/public/sounds/amb_gong_chinese.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_low.mp3 -> packages/web/public/sounds/amb_gong_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_strike.mp3 -> packages/web/public/sounds/amb_gong_strike.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_gong_undertone.mp3 -> packages/web/public/sounds/amb_gong_undertone.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_guitar_chord.mp3 -> packages/web/public/sounds/amb_guitar_chord.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_pulse_low.mp3 -> packages/web/public/sounds/amb_pulse_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_thunder_rain.mp3 -> packages/web/public/sounds/amb_thunder_rain.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/amb_thunder_roll.mp3 -> packages/web/public/sounds/amb_thunder_roll.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_aww.mp3 -> packages/web/public/sounds/id_bad_aww.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_dang.mp3 -> packages/web/public/sounds/id_bad_dang.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_hmm.mp3 -> packages/web/public/sounds/id_bad_hmm.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_hmph.mp3 -> packages/web/public/sounds/id_bad_hmph.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_bad_ohh.mp3 -> packages/web/public/sounds/id_bad_ohh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_whoa.mp3 -> packages/web/public/sounds/id_ego_whoa.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_woohoo.mp3 -> packages/web/public/sounds/id_ego_woohoo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yeah.mp3 -> packages/web/public/sounds/id_ego_yeah.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yeah2.mp3 -> packages/web/public/sounds/id_ego_yeah2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_ego_yes.mp3 -> packages/web/public/sounds/id_ego_yes.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hey.mp3 -> packages/web/public/sounds/id_good_hey.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hey2.mp3 -> packages/web/public/sounds/id_good_hey2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_hmm.mp3 -> packages/web/public/sounds/id_good_hmm.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_huh.mp3 -> packages/web/public/sounds/id_good_huh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_ooh.mp3 -> packages/web/public/sounds/id_good_ooh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_ooo.mp3 -> packages/web/public/sounds/id_good_ooo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/id_good_wow.mp3 -> packages/web/public/sounds/id_good_wow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_attack_breath.mp3 -> packages/web/public/sounds/mco_attack_breath.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_attack_spray.mp3 -> packages/web/public/sounds/mco_attack_spray.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_chew.mp3 -> packages/web/public/sounds/mco_bite_chew.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_chomp.mp3 -> packages/web/public/sounds/mco_bite_chomp.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_dainty.mp3 -> packages/web/public/sounds/mco_bite_dainty.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_gnash.mp3 -> packages/web/public/sounds/mco_bite_gnash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_hard.mp3 -> packages/web/public/sounds/mco_bite_hard.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_long.mp3 -> packages/web/public/sounds/mco_bite_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_munch.mp3 -> packages/web/public/sounds/mco_bite_munch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_regular.mp3 -> packages/web/public/sounds/mco_bite_regular.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_short.mp3 -> packages/web/public/sounds/mco_bite_short.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_small.mp3 -> packages/web/public/sounds/mco_bite_small.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_bite_soft.mp3 -> packages/web/public/sounds/mco_bite_soft.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_card_shuffle.mp3 -> packages/web/public/sounds/mco_card_shuffle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_castanet_trill.mp3 -> packages/web/public/sounds/mco_castanet_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_ceramic_trill.mp3 -> packages/web/public/sounds/mco_ceramic_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_click_vibra.mp3 -> packages/web/public/sounds/mco_click_vibra.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_choking.mp3 -> packages/web/public/sounds/mco_creature_choking.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_groan.mp3 -> packages/web/public/sounds/mco_creature_groan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_creature_yelp.mp3 -> packages/web/public/sounds/mco_creature_yelp.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_cuica_rubbing.mp3 -> packages/web/public/sounds/mco_cuica_rubbing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_low.mp3 -> packages/web/public/sounds/mco_dino_low.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_slur.mp3 -> packages/web/public/sounds/mco_dino_slur.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_talk.mp3 -> packages/web/public/sounds/mco_dino_talk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dino_yawn.mp3 -> packages/web/public/sounds/mco_dino_yawn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_dub_wobble.mp3 -> packages/web/public/sounds/mco_dub_wobble.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_frog_trill.mp3 -> packages/web/public/sounds/mco_frog_trill.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_hit_whip.mp3 -> packages/web/public/sounds/mco_hit_whip.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_croak.mp3 -> packages/web/public/sounds/mco_howl_croak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_deep.mp3 -> packages/web/public/sounds/mco_howl_deep.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_distressed.mp3 -> packages/web/public/sounds/mco_howl_distressed.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_high.mp3 -> packages/web/public/sounds/mco_howl_high.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_howl_long.mp3 -> packages/web/public/sounds/mco_howl_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_liquid_squirt.mp3 -> packages/web/public/sounds/mco_liquid_squirt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_man_mumble.mp3 -> packages/web/public/sounds/mco_man_mumble.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_mouse_squeaks.mp3 -> packages/web/public/sounds/mco_mouse_squeaks.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_rubber_thud.mp3 -> packages/web/public/sounds/mco_rubber_thud.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_scurry_dry.mp3 -> packages/web/public/sounds/mco_scurry_dry.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_shake_roll.mp3 -> packages/web/public/sounds/mco_shake_roll.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_snarl_short.mp3 -> packages/web/public/sounds/mco_snarl_short.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_spray_long.mp3 -> packages/web/public/sounds/mco_spray_long.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_squish_hit.mp3 -> packages/web/public/sounds/mco_squish_hit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_squish_snap.mp3 -> packages/web/public/sounds/mco_squish_snap.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_strange_music.mp3 -> packages/web/public/sounds/mco_strange_music.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_strange_thwoink.mp3 -> packages/web/public/sounds/mco_strange_thwoink.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thoing_backwards.mp3 -> packages/web/public/sounds/mco_thoing_backwards.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thoing_deep.mp3 -> packages/web/public/sounds/mco_thoing_deep.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_thud_crash.mp3 -> packages/web/public/sounds/mco_thud_crash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/mco_tube_hit.mp3 -> packages/web/public/sounds/mco_tube_hit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_bell_warn.mp3 -> packages/web/public/sounds/plc_bell_warn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_die_laugh.mp3 -> packages/web/public/sounds/plc_die_laugh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_anvil.mp3 -> packages/web/public/sounds/plc_hit_anvil.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_anvil2.mp3 -> packages/web/public/sounds/plc_hit_anvil2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_arrow.mp3 -> packages/web/public/sounds/plc_hit_arrow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_body.mp3 -> packages/web/public/sounds/plc_hit_body.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_groan.mp3 -> packages/web/public/sounds/plc_hit_groan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_grunt.mp3 -> packages/web/public/sounds/plc_hit_grunt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_grunt2.mp3 -> packages/web/public/sounds/plc_hit_grunt2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_hit_hay.mp3 -> packages/web/public/sounds/plc_hit_hay.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_arrow.mp3 -> packages/web/public/sounds/plc_miss_arrow.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_arrow2.mp3 -> packages/web/public/sounds/plc_miss_arrow2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plc_miss_swish.mp3 -> packages/web/public/sounds/plc_miss_swish.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_aim_wand.mp3 -> packages/web/public/sounds/plm_aim_wand.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_ceramic.mp3 -> packages/web/public/sounds/plm_bang_ceramic.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_dumpster.mp3 -> packages/web/public/sounds/plm_bang_dumpster.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bang_metal.mp3 -> packages/web/public/sounds/plm_bang_metal.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_book_pageturn.mp3 -> packages/web/public/sounds/plm_book_pageturn.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_bottle_clinks.mp3 -> packages/web/public/sounds/plm_bottle_clinks.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_canister.mp3 -> packages/web/public/sounds/plm_break_canister.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_glass.mp3 -> packages/web/public/sounds/plm_break_glass.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_glass2.mp3 -> packages/web/public/sounds/plm_break_glass2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_plates.mp3 -> packages/web/public/sounds/plm_break_plates.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_shatter.mp3 -> packages/web/public/sounds/plm_break_shatter.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_smash.mp3 -> packages/web/public/sounds/plm_break_smash.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_break_wood.mp3 -> packages/web/public/sounds/plm_break_wood.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cabinet_open.mp3 -> packages/web/public/sounds/plm_cabinet_open.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cabinet_shut.mp3 -> packages/web/public/sounds/plm_cabinet_shut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chain_light.mp3 -> packages/web/public/sounds/plm_chain_light.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chest_latch.mp3 -> packages/web/public/sounds/plm_chest_latch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chest_unlatch.mp3 -> packages/web/public/sounds/plm_chest_unlatch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_chimes_jangle.mp3 -> packages/web/public/sounds/plm_chimes_jangle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_dry.mp3 -> packages/web/public/sounds/plm_click_dry.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch.mp3 -> packages/web/public/sounds/plm_click_switch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch2.mp3 -> packages/web/public/sounds/plm_click_switch2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_switch3.mp3 -> packages/web/public/sounds/plm_click_switch3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_click_wood.mp3 -> packages/web/public/sounds/plm_click_wood.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_close_hatch.mp3 -> packages/web/public/sounds/plm_close_hatch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_dump.mp3 -> packages/web/public/sounds/plm_coins_dump.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_light.mp3 -> packages/web/public/sounds/plm_coins_light.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_pour.mp3 -> packages/web/public/sounds/plm_coins_pour.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_coins_shake.mp3 -> packages/web/public/sounds/plm_coins_shake.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cork_pop.mp3 -> packages/web/public/sounds/plm_cork_pop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_cork_squeak.mp3 -> packages/web/public/sounds/plm_cork_squeak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_bolt.mp3 -> packages/web/public/sounds/plm_door_bolt.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_creak.mp3 -> packages/web/public/sounds/plm_door_creak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_creakshut.mp3 -> packages/web/public/sounds/plm_door_creakshut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_dungeon.mp3 -> packages/web/public/sounds/plm_door_dungeon.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_echolock.mp3 -> packages/web/public/sounds/plm_door_echolock.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_entrance.mp3 -> packages/web/public/sounds/plm_door_entrance.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_knob.mp3 -> packages/web/public/sounds/plm_door_knob.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_latch.mp3 -> packages/web/public/sounds/plm_door_latch.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_open.mp3 -> packages/web/public/sounds/plm_door_open.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_opening.mp3 -> packages/web/public/sounds/plm_door_opening.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_rusty.mp3 -> packages/web/public/sounds/plm_door_rusty.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_shut.mp3 -> packages/web/public/sounds/plm_door_shut.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_slam.mp3 -> packages/web/public/sounds/plm_door_slam.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_squeaky.mp3 -> packages/web/public/sounds/plm_door_squeaky.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_door_wooden.mp3 -> packages/web/public/sounds/plm_door_wooden.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_drop_boot.mp3 -> packages/web/public/sounds/plm_drop_boot.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_eat_bite.mp3 -> packages/web/public/sounds/plm_eat_bite.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_floor_creak.mp3 -> packages/web/public/sounds/plm_floor_creak.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_floor_creak2.mp3 -> packages/web/public/sounds/plm_floor_creak2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_break.mp3 -> packages/web/public/sounds/plm_glass_break.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_breaking.mp3 -> packages/web/public/sounds/plm_glass_breaking.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_glass_smashing.mp3 -> packages/web/public/sounds/plm_glass_smashing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_jar_ding.mp3 -> packages/web/public/sounds/plm_jar_ding.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_levelup.mp3 -> packages/web/public/sounds/plm_levelup.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_lock_case.mp3 -> packages/web/public/sounds/plm_lock_case.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_lock_distant.mp3 -> packages/web/public/sounds/plm_lock_distant.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_metal_clank.mp3 -> packages/web/public/sounds/plm_metal_clank.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_metal_sharpen.mp3 -> packages/web/public/sounds/plm_metal_sharpen.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_open_case.mp3 -> packages/web/public/sounds/plm_open_case.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell1.mp3 -> packages/web/public/sounds/plm_spell1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell2.mp3 -> packages/web/public/sounds/plm_spell2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_spell3.mp3 -> packages/web/public/sounds/plm_spell3.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_use_staff.mp3 -> packages/web/public/sounds/plm_use_staff.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_wood_thud.mp3 -> packages/web/public/sounds/plm_wood_thud.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/plm_zap_rod.mp3 -> packages/web/public/sounds/plm_zap_rod.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_bowl.mp3 -> packages/web/public/sounds/pls_bell_bowl.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_chime_new.mp3 -> packages/web/public/sounds/pls_bell_chime_new.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_glass.mp3 -> packages/web/public/sounds/pls_bell_glass.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_hibell_soft.mp3 -> packages/web/public/sounds/pls_bell_hibell_soft.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_mute.mp3 -> packages/web/public/sounds/pls_bell_mute.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_bell_sustain.mp3 -> packages/web/public/sounds/pls_bell_sustain.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_breathe_in.mp3 -> packages/web/public/sounds/pls_breathe_in.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_argoh.mp3 -> packages/web/public/sounds/pls_man_argoh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_gulp_new.mp3 -> packages/web/public/sounds/pls_man_gulp_new.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_oooh.mp3 -> packages/web/public/sounds/pls_man_oooh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_scream2.mp3 -> packages/web/public/sounds/pls_man_scream2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sigh.mp3 -> packages/web/public/sounds/pls_man_sigh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sniff.mp3 -> packages/web/public/sounds/pls_man_sniff.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_sob.mp3 -> packages/web/public/sounds/pls_man_sob.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_spit.mp3 -> packages/web/public/sounds/pls_man_spit.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_ugh.mp3 -> packages/web/public/sounds/pls_man_ugh.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_man_yell.mp3 -> packages/web/public/sounds/pls_man_yell.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_blurk.mp3 -> packages/web/public/sounds/pls_tone_blurk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_clave6.mp3 -> packages/web/public/sounds/pls_tone_clave6.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_clavelo8.mp3 -> packages/web/public/sounds/pls_tone_clavelo8.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_conk.mp3 -> packages/web/public/sounds/pls_tone_conk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_elec.mp3 -> packages/web/public/sounds/pls_tone_elec.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_goblet.mp3 -> packages/web/public/sounds/pls_tone_goblet.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_guiro.mp3 -> packages/web/public/sounds/pls_tone_guiro.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_headstock.mp3 -> packages/web/public/sounds/pls_tone_headstock.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_scrape.mp3 -> packages/web/public/sounds/pls_tone_scrape.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/pls_tone_stick.mp3 -> packages/web/public/sounds/pls_tone_stick.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_desk.mp3 -> packages/web/public/sounds/sto_bell_desk.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_ding.mp3 -> packages/web/public/sounds/sto_bell_ding.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_dingaling.mp3 -> packages/web/public/sounds/sto_bell_dingaling.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_jingles.mp3 -> packages/web/public/sounds/sto_bell_jingles.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_register1.mp3 -> packages/web/public/sounds/sto_bell_register1.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_register2.mp3 -> packages/web/public/sounds/sto_bell_register2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_ringing.mp3 -> packages/web/public/sounds/sto_bell_ringing.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_bell_shop.mp3 -> packages/web/public/sounds/sto_bell_shop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_coins_countertop.mp3 -> packages/web/public/sounds/sto_coins_countertop.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_haha.mp3 -> packages/web/public/sounds/sto_man_haha.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_hey.mp3 -> packages/web/public/sounds/sto_man_hey.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sto_man_whoohaha.mp3 -> packages/web/public/sounds/sto_man_whoohaha.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ainu_song.mp3 -> packages/web/public/sounds/sum_ainu_song.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_crystal.mp3 -> packages/web/public/sounds/sum_bell_crystal.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_hand.mp3 -> packages/web/public/sounds/sum_bell_hand.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_bell_tone.mp3 -> packages/web/public/sounds/sum_bell_tone.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_chime_jangle.mp3 -> packages/web/public/sounds/sum_chime_jangle.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_moan.mp3 -> packages/web/public/sounds/sum_ghost_moan.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_oooo.mp3 -> packages/web/public/sounds/sum_ghost_oooo.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_ghost_wail.mp3 -> packages/web/public/sounds/sum_ghost_wail.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_gong_temple.mp3 -> packages/web/public/sounds/sum_gong_temple.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_laugh_evil2.mp3 -> packages/web/public/sounds/sum_laugh_evil2.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_lion_growl.mp3 -> packages/web/public/sounds/sum_lion_growl.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
reference/lib/sounds/sum_piano_scrape.mp3 -> packages/web/public/sounds/sum_piano_scrape.mp3 (byte-identical SHA256); packages/web/src/sound.ts (HTMLAudio load/play); packages/core/src/sound/engine.ts (pool/select)
