### L16_sounds-001  SDL mixer backend is replaced by HTMLAudio
sev: P2
concession: y
ref: reference/src/snd-sdl.c:65-80,177-198
port: packages/web/src/sound.ts:64-126
expected: Initialize SDL_mixer at 22050 Hz, S16, stereo, buffer 4096; load MP3 as music and OGG as chunks; play through SDL mixer.
actual: Use one HTMLAudioElement per sample with browser-controlled rate, channels, buffering, and playback behavior.
why: Native SDL mixer behavior cannot be reproduced exactly in a browser runtime.
confidence: high

### L16_sounds-002  First-format load prevents C-style fallback
sev: P2
concession: n
ref: reference/src/sound-core.c:127-167
port: packages/core/src/sound/engine.ts:120-130; packages/web/src/sound.ts:74-94
expected: Build the full sound path, check each extension with file_exists, call the platform hook only for existing files, and continue to the next extension after failure.
actual: Call the hook for every format without existence checks. The web hook returns true optimistically for the first format and only marks ERROR asynchronously after an audio error.
why: A missing or undecodable MP3 prevents fallback to an available OGG file.
confidence: high

### L16_sounds-003  Initialization succeeds without the C-required open hook
sev: P3
concession: y
ref: reference/src/sound-core.c:356-386
port: packages/core/src/sound/engine.ts:230-236; packages/web/src/sound.ts:138-150
expected: Select a sound module, require open_audio_hook, fail initialization if opening the platform audio system fails.
actual: SoundEngine.init succeeds when no openAudio hook exists; the web installer supplies no open hook.
why: Browser audio elements do not require a process-wide SDL-style mixer initialization.
confidence: high

### L16_sounds-004  C tokenizer preserves empty tokens but port filters them
sev: P3
concession: n
ref: reference/src/sound-core.c:195-210,250-266
port: packages/core/src/sound/engine.ts:146-150
expected: Split only at literal spaces; leading, repeated, or trailing spaces can produce empty sample names.
actual: Split on spaces and discard empty tokens.
why: Malformed or custom sound preference strings do not preserve the C mapping and sound-pool behavior.
confidence: high

## MAP L16_sounds
reference/src/snd-sdl.c -> packages/web/src/sound.ts; packages/core/src/sound/engine.ts
reference/src/snd-sdl.h -> packages/web/src/sound.ts; packages/core/src/sound/types.ts
reference/src/snd-win.h -> packages/web/src/sound.ts
reference/src/sound.h -> packages/core/src/sound/types.ts; packages/core/src/sound/engine.ts
reference/src/sound-core.c -> packages/core/src/sound/engine.ts; packages/web/src/sound.ts
reference/lib/sounds/Makefile -> packages/web/package.json; packages/web/public/sounds/
reference/lib/sounds/amb_bell_metal1.mp3 -> packages/web/public/sounds/amb_bell_metal1.mp3
reference/lib/sounds/amb_bell_metal2.mp3 -> packages/web/public/sounds/amb_bell_metal2.mp3
reference/lib/sounds/amb_bell_tibet1.mp3 -> packages/web/public/sounds/amb_bell_tibet1.mp3
reference/lib/sounds/amb_bell_tibet2.mp3 -> packages/web/public/sounds/amb_bell_tibet2.mp3
reference/lib/sounds/amb_bell_tibet3.mp3 -> packages/web/public/sounds/amb_bell_tibet3.mp3
reference/lib/sounds/amb_door_doom.mp3 -> packages/web/public/sounds/amb_door_doom.mp3
reference/lib/sounds/amb_door_iron.mp3 -> packages/web/public/sounds/amb_door_iron.mp3
reference/lib/sounds/amb_dungeon_echo.mp3 -> packages/web/public/sounds/amb_dungeon_echo.mp3
reference/lib/sounds/amb_dungeon_echowet.mp3 -> packages/web/public/sounds/amb_dungeon_echowet.mp3
reference/lib/sounds/amb_gong_chinese.mp3 -> packages/web/public/sounds/amb_gong_chinese.mp3
reference/lib/sounds/amb_gong_low.mp3 -> packages/web/public/sounds/amb_gong_low.mp3
reference/lib/sounds/amb_gong_strike.mp3 -> packages/web/public/sounds/amb_gong_strike.mp3
reference/lib/sounds/amb_gong_undertone.mp3 -> packages/web/public/sounds/amb_gong_undertone.mp3
reference/lib/sounds/amb_guitar_chord.mp3 -> packages/web/public/sounds/amb_guitar_chord.mp3
reference/lib/sounds/amb_pulse_low.mp3 -> packages/web/public/sounds/amb_pulse_low.mp3
reference/lib/sounds/amb_thunder_rain.mp3 -> packages/web/public/sounds/amb_thunder_rain.mp3
reference/lib/sounds/amb_thunder_roll.mp3 -> packages/web/public/sounds/amb_thunder_roll.mp3
reference/lib/sounds/id_bad_aww.mp3 -> packages/web/public/sounds/id_bad_aww.mp3
reference/lib/sounds/id_bad_dang.mp3 -> packages/web/public/sounds/id_bad_dang.mp3
reference/lib/sounds/id_bad_hmm.mp3 -> packages/web/public/sounds/id_bad_hmm.mp3
reference/lib/sounds/id_bad_hmph.mp3 -> packages/web/public/sounds/id_bad_hmph.mp3
reference/lib/sounds/id_bad_ohh.mp3 -> packages/web/public/sounds/id_bad_ohh.mp3
reference/lib/sounds/id_ego_whoa.mp3 -> packages/web/public/sounds/id_ego_whoa.mp3
reference/lib/sounds/id_ego_woohoo.mp3 -> packages/web/public/sounds/id_ego_woohoo.mp3
reference/lib/sounds/id_ego_yeah.mp3 -> packages/web/public/sounds/id_ego_yeah.mp3
reference/lib/sounds/id_ego_yeah2.mp3 -> packages/web/public/sounds/id_ego_yeah2.mp3
reference/lib/sounds/id_ego_yes.mp3 -> packages/web/public/sounds/id_ego_yes.mp3
reference/lib/sounds/id_good_hey.mp3 -> packages/web/public/sounds/id_good_hey.mp3
reference/lib/sounds/id_good_hey2.mp3 -> packages/web/public/sounds/id_good_hey2.mp3
reference/lib/sounds/id_good_hmm.mp3 -> packages/web/public/sounds/id_good_hmm.mp3
reference/lib/sounds/id_good_huh.mp3 -> packages/web/public/sounds/id_good_huh.mp3
reference/lib/sounds/id_good_ooh.mp3 -> packages/web/public/sounds/id_good_ooh.mp3
reference/lib/sounds/id_good_ooo.mp3 -> packages/web/public/sounds/id_good_ooo.mp3
reference/lib/sounds/id_good_wow.mp3 -> packages/web/public/sounds/id_good_wow.mp3
reference/lib/sounds/mco_attack_breath.mp3 -> packages/web/public/sounds/mco_attack_breath.mp3
reference/lib/sounds/mco_attack_spray.mp3 -> packages/web/public/sounds/mco_attack_spray.mp3
reference/lib/sounds/mco_bite_chew.mp3 -> packages/web/public/sounds/mco_bite_chew.mp3
reference/lib/sounds/mco_bite_chomp.mp3 -> packages/web/public/sounds/mco_bite_chomp.mp3
reference/lib/sounds/mco_bite_dainty.mp3 -> packages/web/public/sounds/mco_bite_dainty.mp3
reference/lib/sounds/mco_bite_gnash.mp3 -> packages/web/public/sounds/mco_bite_gnash.mp3
reference/lib/sounds/mco_bite_hard.mp3 -> packages/web/public/sounds/mco_bite_hard.mp3
reference/lib/sounds/mco_bite_long.mp3 -> packages/web/public/sounds/mco_bite_long.mp3
reference/lib/sounds/mco_bite_munch.mp3 -> packages/web/public/sounds/mco_bite_munch.mp3
reference/lib/sounds/mco_bite_regular.mp3 -> packages/web/public/sounds/mco_bite_regular.mp3
reference/lib/sounds/mco_bite_short.mp3 -> packages/web/public/sounds/mco_bite_short.mp3
reference/lib/sounds/mco_bite_small.mp3 -> packages/web/public/sounds/mco_bite_small.mp3
reference/lib/sounds/mco_bite_soft.mp3 -> packages/web/public/sounds/mco_bite_soft.mp3
reference/lib/sounds/mco_card_shuffle.mp3 -> packages/web/public/sounds/mco_card_shuffle.mp3
reference/lib/sounds/mco_castanet_trill.mp3 -> packages/web/public/sounds/mco_castanet_trill.mp3
reference/lib/sounds/mco_ceramic_trill.mp3 -> packages/web/public/sounds/mco_ceramic_trill.mp3
reference/lib/sounds/mco_click_vibra.mp3 -> packages/web/public/sounds/mco_click_vibra.mp3
reference/lib/sounds/mco_creature_choking.mp3 -> packages/web/public/sounds/mco_creature_choking.mp3
reference/lib/sounds/mco_creature_groan.mp3 -> packages/web/public/sounds/mco_creature_groan.mp3
reference/lib/sounds/mco_creature_yelp.mp3 -> packages/web/public/sounds/mco_creature_yelp.mp3
reference/lib/sounds/mco_cuica_rubbing.mp3 -> packages/web/public/sounds/mco_cuica_rubbing.mp3
reference/lib/sounds/mco_dino_low.mp3 -> packages/web/public/sounds/mco_dino_low.mp3
reference/lib/sounds/mco_dino_slur.mp3 -> packages/web/public/sounds/mco_dino_slur.mp3
reference/lib/sounds/mco_dino_talk.mp3 -> packages/web/public/sounds/mco_dino_talk.mp3
reference/lib/sounds/mco_dino_yawn.mp3 -> packages/web/public/sounds/mco_dino_yawn.mp3
reference/lib/sounds/mco_dub_wobble.mp3 -> packages/web/public/sounds/mco_dub_wobble.mp3
reference/lib/sounds/mco_frog_trill.mp3 -> packages/web/public/sounds/mco_frog_trill.mp3
reference/lib/sounds/mco_hit_whip.mp3 -> packages/web/public/sounds/mco_hit_whip.mp3
reference/lib/sounds/mco_howl_croak.mp3 -> packages/web/public/sounds/mco_howl_croak.mp3
reference/lib/sounds/mco_howl_deep.mp3 -> packages/web/public/sounds/mco_howl_deep.mp3
reference/lib/sounds/mco_howl_distressed.mp3 -> packages/web/public/sounds/mco_howl_distressed.mp3
reference/lib/sounds/mco_howl_high.mp3 -> packages/web/public/sounds/mco_howl_high.mp3
reference/lib/sounds/mco_howl_long.mp3 -> packages/web/public/sounds/mco_howl_long.mp3
reference/lib/sounds/mco_liquid_squirt.mp3 -> packages/web/public/sounds/mco_liquid_squirt.mp3
reference/lib/sounds/mco_man_mumble.mp3 -> packages/web/public/sounds/mco_man_mumble.mp3
reference/lib/sounds/mco_mouse_squeaks.mp3 -> packages/web/public/sounds/mco_mouse_squeaks.mp3
reference/lib/sounds/mco_rubber_thud.mp3 -> packages/web/public/sounds/mco_rubber_thud.mp3
reference/lib/sounds/mco_scurry_dry.mp3 -> packages/web/public/sounds/mco_scurry_dry.mp3
reference/lib/sounds/mco_shake_roll.mp3 -> packages/web/public/sounds/mco_shake_roll.mp3
reference/lib/sounds/mco_snarl_short.mp3 -> packages/web/public/sounds/mco_snarl_short.mp3
reference/lib/sounds/mco_spray_long.mp3 -> packages/web/public/sounds/mco_spray_long.mp3
reference/lib/sounds/mco_squish_hit.mp3 -> packages/web/public/sounds/mco_squish_hit.mp3
reference/lib/sounds/mco_squish_snap.mp3 -> packages/web/public/sounds/mco_squish_snap.mp3
reference/lib/sounds/mco_strange_music.mp3 -> packages/web/public/sounds/mco_strange_music.mp3
reference/lib/sounds/mco_strange_thwoink.mp3 -> packages/web/public/sounds/mco_strange_thwoink.mp3
reference/lib/sounds/mco_thoing_backwards.mp3 -> packages/web/public/sounds/mco_thoing_backwards.mp3
reference/lib/sounds/mco_thoing_deep.mp3 -> packages/web/public/sounds/mco_thoing_deep.mp3
reference/lib/sounds/mco_thud_crash.mp3 -> packages/web/public/sounds/mco_thud_crash.mp3
reference/lib/sounds/mco_tube_hit.mp3 -> packages/web/public/sounds/mco_tube_hit.mp3
reference/lib/sounds/plc_bell_warn.mp3 -> packages/web/public/sounds/plc_bell_warn.mp3
reference/lib/sounds/plc_die_laugh.mp3 -> packages/web/public/sounds/plc_die_laugh.mp3
reference/lib/sounds/plc_hit_anvil.mp3 -> packages/web/public/sounds/plc_hit_anvil.mp3
reference/lib/sounds/plc_hit_anvil2.mp3 -> packages/web/public/sounds/plc_hit_anvil2.mp3
reference/lib/sounds/plc_hit_arrow.mp3 -> packages/web/public/sounds/plc_hit_arrow.mp3
reference/lib/sounds/plc_hit_body.mp3 -> packages/web/public/sounds/plc_hit_body.mp3
reference/lib/sounds/plc_hit_groan.mp3 -> packages/web/public/sounds/plc_hit_groan.mp3
reference/lib/sounds/plc_hit_grunt.mp3 -> packages/web/public/sounds/plc_hit_grunt.mp3
reference/lib/sounds/plc_hit_grunt2.mp3 -> packages/web/public/sounds/plc_hit_grunt2.mp3
reference/lib/sounds/plc_hit_hay.mp3 -> packages/web/public/sounds/plc_hit_hay.mp3
reference/lib/sounds/plc_miss_arrow.mp3 -> packages/web/public/sounds/plc_miss_arrow.mp3
reference/lib/sounds/plc_miss_arrow2.mp3 -> packages/web/public/sounds/plc_miss_arrow2.mp3
reference/lib/sounds/plc_miss_swish.mp3 -> packages/web/public/sounds/plc_miss_swish.mp3
reference/lib/sounds/plm_aim_wand.mp3 -> packages/web/public/sounds/plm_aim_wand.mp3
reference/lib/sounds/plm_bang_ceramic.mp3 -> packages/web/public/sounds/plm_bang_ceramic.mp3
reference/lib/sounds/plm_bang_dumpster.mp3 -> packages/web/public/sounds/plm_bang_dumpster.mp3
reference/lib/sounds/plm_bang_metal.mp3 -> packages/web/public/sounds/plm_bang_metal.mp3
reference/lib/sounds/plm_book_pageturn.mp3 -> packages/web/public/sounds/plm_book_pageturn.mp3
reference/lib/sounds/plm_bottle_clinks.mp3 -> packages/web/public/sounds/plm_bottle_clinks.mp3
reference/lib/sounds/plm_break_canister.mp3 -> packages/web/public/sounds/plm_break_canister.mp3
reference/lib/sounds/plm_break_glass.mp3 -> packages/web/public/sounds/plm_break_glass.mp3
reference/lib/sounds/plm_break_glass2.mp3 -> packages/web/public/sounds/plm_break_glass2.mp3
reference/lib/sounds/plm_break_plates.mp3 -> packages/web/public/sounds/plm_break_plates.mp3
reference/lib/sounds/plm_break_shatter.mp3 -> packages/web/public/sounds/plm_break_shatter.mp3
reference/lib/sounds/plm_break_smash.mp3 -> packages/web/public/sounds/plm_break_smash.mp3
reference/lib/sounds/plm_break_wood.mp3 -> packages/web/public/sounds/plm_break_wood.mp3
reference/lib/sounds/plm_cabinet_open.mp3 -> packages/web/public/sounds/plm_cabinet_open.mp3
reference/lib/sounds/plm_cabinet_shut.mp3 -> packages/web/public/sounds/plm_cabinet_shut.mp3
reference/lib/sounds/plm_chain_light.mp3 -> packages/web/public/sounds/plm_chain_light.mp3
reference/lib/sounds/plm_chest_latch.mp3 -> packages/web/public/sounds/plm_chest_latch.mp3
reference/lib/sounds/plm_chest_unlatch.mp3 -> packages/web/public/sounds/plm_chest_unlatch.mp3
reference/lib/sounds/plm_chimes_jangle.mp3 -> packages/web/public/sounds/plm_chimes_jangle.mp3
reference/lib/sounds/plm_click_dry.mp3 -> packages/web/public/sounds/plm_click_dry.mp3
reference/lib/sounds/plm_click_switch.mp3 -> packages/web/public/sounds/plm_click_switch.mp3
reference/lib/sounds/plm_click_switch2.mp3 -> packages/web/public/sounds/plm_click_switch2.mp3
reference/lib/sounds/plm_click_switch3.mp3 -> packages/web/public/sounds/plm_click_switch3.mp3
reference/lib/sounds/plm_click_wood.mp3 -> packages/web/public/sounds/plm_click_wood.mp3
reference/lib/sounds/plm_close_hatch.mp3 -> packages/web/public/sounds/plm_close_hatch.mp3
reference/lib/sounds/plm_coins_dump.mp3 -> packages/web/public/sounds/plm_coins_dump.mp3
reference/lib/sounds/plm_coins_light.mp3 -> packages/web/public/sounds/plm_coins_light.mp3
reference/lib/sounds/plm_coins_pour.mp3 -> packages/web/public/sounds/plm_coins_pour.mp3
reference/lib/sounds/plm_coins_shake.mp3 -> packages/web/public/sounds/plm_coins_shake.mp3
reference/lib/sounds/plm_cork_pop.mp3 -> packages/web/public/sounds/plm_cork_pop.mp3
reference/lib/sounds/plm_cork_squeak.mp3 -> packages/web/public/sounds/plm_cork_squeak.mp3
reference/lib/sounds/plm_door_bolt.mp3 -> packages/web/public/sounds/plm_door_bolt.mp3
reference/lib/sounds/plm_door_creak.mp3 -> packages/web/public/sounds/plm_door_creak.mp3
reference/lib/sounds/plm_door_creakshut.mp3 -> packages/web/public/sounds/plm_door_creakshut.mp3
reference/lib/sounds/plm_door_dungeon.mp3 -> packages/web/public/sounds/plm_door_dungeon.mp3
reference/lib/sounds/plm_door_echolock.mp3 -> packages/web/public/sounds/plm_door_echolock.mp3
reference/lib/sounds/plm_door_entrance.mp3 -> packages/web/public/sounds/plm_door_entrance.mp3
reference/lib/sounds/plm_door_knob.mp3 -> packages/web/public/sounds/plm_door_knob.mp3
reference/lib/sounds/plm_door_latch.mp3 -> packages/web/public/sounds/plm_door_latch.mp3
reference/lib/sounds/plm_door_open.mp3 -> packages/web/public/sounds/plm_door_open.mp3
reference/lib/sounds/plm_door_opening.mp3 -> packages/web/public/sounds/plm_door_opening.mp3
reference/lib/sounds/plm_door_rusty.mp3 -> packages/web/public/sounds/plm_door_rusty.mp3
reference/lib/sounds/plm_door_shut.mp3 -> packages/web/public/sounds/plm_door_shut.mp3
reference/lib/sounds/plm_door_slam.mp3 -> packages/web/public/sounds/plm_door_slam.mp3
reference/lib/sounds/plm_door_squeaky.mp3 -> packages/web/public/sounds/plm_door_squeaky.mp3
reference/lib/sounds/plm_door_wooden.mp3 -> packages/web/public/sounds/plm_door_wooden.mp3
reference/lib/sounds/plm_drop_boot.mp3 -> packages/web/public/sounds/plm_drop_boot.mp3
reference/lib/sounds/plm_eat_bite.mp3 -> packages/web/public/sounds/plm_eat_bite.mp3
reference/lib/sounds/plm_floor_creak.mp3 -> packages/web/public/sounds/plm_floor_creak.mp3
reference/lib/sounds/plm_floor_creak2.mp3 -> packages/web/public/sounds/plm_floor_creak2.mp3
reference/lib/sounds/plm_glass_break.mp3 -> packages/web/public/sounds/plm_glass_break.mp3
reference/lib/sounds/plm_glass_breaking.mp3 -> packages/web/public/sounds/plm_glass_breaking.mp3
reference/lib/sounds/plm_glass_smashing.mp3 -> packages/web/public/sounds/plm_glass_smashing.mp3
reference/lib/sounds/plm_jar_ding.mp3 -> packages/web/public/sounds/plm_jar_ding.mp3
reference/lib/sounds/plm_levelup.mp3 -> packages/web/public/sounds/plm_levelup.mp3
reference/lib/sounds/plm_lock_case.mp3 -> packages/web/public/sounds/plm_lock_case.mp3
reference/lib/sounds/plm_lock_distant.mp3 -> packages/web/public/sounds/plm_lock_distant.mp3
reference/lib/sounds/plm_metal_clank.mp3 -> packages/web/public/sounds/plm_metal_clank.mp3
reference/lib/sounds/plm_metal_sharpen.mp3 -> packages/web/public/sounds/plm_metal_sharpen.mp3
reference/lib/sounds/plm_open_case.mp3 -> packages/web/public/sounds/plm_open_case.mp3
reference/lib/sounds/plm_spell1.mp3 -> packages/web/public/sounds/plm_spell1.mp3
reference/lib/sounds/plm_spell2.mp3 -> packages/web/public/sounds/plm_spell2.mp3
reference/lib/sounds/plm_spell3.mp3 -> packages/web/public/sounds/plm_spell3.mp3
reference/lib/sounds/plm_use_staff.mp3 -> packages/web/public/sounds/plm_use_staff.mp3
reference/lib/sounds/plm_wood_thud.mp3 -> packages/web/public/sounds/plm_wood_thud.mp3
reference/lib/sounds/plm_zap_rod.mp3 -> packages/web/public/sounds/plm_zap_rod.mp3
reference/lib/sounds/pls_bell_bowl.mp3 -> packages/web/public/sounds/pls_bell_bowl.mp3
reference/lib/sounds/pls_bell_chime_new.mp3 -> packages/web/public/sounds/pls_bell_chime_new.mp3
reference/lib/sounds/pls_bell_glass.mp3 -> packages/web/public/sounds/pls_bell_glass.mp3
reference/lib/sounds/pls_bell_hibell_soft.mp3 -> packages/web/public/sounds/pls_bell_hibell_soft.mp3
reference/lib/sounds/pls_bell_mute.mp3 -> packages/web/public/sounds/pls_bell_mute.mp3
reference/lib/sounds/pls_bell_sustain.mp3 -> packages/web/public/sounds/pls_bell_sustain.mp3
reference/lib/sounds/pls_breathe_in.mp3 -> packages/web/public/sounds/pls_breathe_in.mp3
reference/lib/sounds/pls_man_argoh.mp3 -> packages/web/public/sounds/pls_man_argoh.mp3
reference/lib/sounds/pls_man_gulp_new.mp3 -> packages/web/public/sounds/pls_man_gulp_new.mp3
reference/lib/sounds/pls_man_oooh.mp3 -> packages/web/public/sounds/pls_man_oooh.mp3
reference/lib/sounds/pls_man_scream2.mp3 -> packages/web/public/sounds/pls_man_scream2.mp3
reference/lib/sounds/pls_man_sigh.mp3 -> packages/web/public/sounds/pls_man_sigh.mp3
reference/lib/sounds/pls_man_sniff.mp3 -> packages/web/public/sounds/pls_man_sniff.mp3
reference/lib/sounds/pls_man_sob.mp3 -> packages/web/public/sounds/pls_man_sob.mp3
reference/lib/sounds/pls_man_spit.mp3 -> packages/web/public/sounds/pls_man_spit.mp3
reference/lib/sounds/pls_man_ugh.mp3 -> packages/web/public/sounds/pls_man_ugh.mp3
reference/lib/sounds/pls_man_yell.mp3 -> packages/web/public/sounds/pls_man_yell.mp3
reference/lib/sounds/pls_tone_blurk.mp3 -> packages/web/public/sounds/pls_tone_blurk.mp3
reference/lib/sounds/pls_tone_clave6.mp3 -> packages/web/public/sounds/pls_tone_clave6.mp3
reference/lib/sounds/pls_tone_clavelo8.mp3 -> packages/web/public/sounds/pls_tone_clavelo8.mp3
reference/lib/sounds/pls_tone_conk.mp3 -> packages/web/public/sounds/pls_tone_conk.mp3
reference/lib/sounds/pls_tone_elec.mp3 -> packages/web/public/sounds/pls_tone_elec.mp3
reference/lib/sounds/pls_tone_goblet.mp3 -> packages/web/public/sounds/pls_tone_goblet.mp3
reference/lib/sounds/pls_tone_guiro.mp3 -> packages/web/public/sounds/pls_tone_guiro.mp3
reference/lib/sounds/pls_tone_headstock.mp3 -> packages/web/public/sounds/pls_tone_headstock.mp3
reference/lib/sounds/pls_tone_scrape.mp3 -> packages/web/public/sounds/pls_tone_scrape.mp3
reference/lib/sounds/pls_tone_stick.mp3 -> packages/web/public/sounds/pls_tone_stick.mp3
reference/lib/sounds/sto_bell_desk.mp3 -> packages/web/public/sounds/sto_bell_desk.mp3
reference/lib/sounds/sto_bell_ding.mp3 -> packages/web/public/sounds/sto_bell_ding.mp3
reference/lib/sounds/sto_bell_dingaling.mp3 -> packages/web/public/sounds/sto_bell_dingaling.mp3
reference/lib/sounds/sto_bell_jingles.mp3 -> packages/web/public/sounds/sto_bell_jingles.mp3
reference/lib/sounds/sto_bell_register1.mp3 -> packages/web/public/sounds/sto_bell_register1.mp3
reference/lib/sounds/sto_bell_register2.mp3 -> packages/web/public/sounds/sto_bell_register2.mp3
reference/lib/sounds/sto_bell_ringing.mp3 -> packages/web/public/sounds/sto_bell_ringing.mp3
reference/lib/sounds/sto_bell_shop.mp3 -> packages/web/public/sounds/sto_bell_shop.mp3
reference/lib/sounds/sto_coins_countertop.mp3 -> packages/web/public/sounds/sto_coins_countertop.mp3
reference/lib/sounds/sto_man_haha.mp3 -> packages/web/public/sounds/sto_man_haha.mp3
reference/lib/sounds/sto_man_hey.mp3 -> packages/web/public/sounds/sto_man_hey.mp3
reference/lib/sounds/sto_man_whoohaha.mp3 -> packages/web/public/sounds/sto_man_whoohaha.mp3
reference/lib/sounds/sum_ainu_song.mp3 -> packages/web/public/sounds/sum_ainu_song.mp3
reference/lib/sounds/sum_bell_crystal.mp3 -> packages/web/public/sounds/sum_bell_crystal.mp3
reference/lib/sounds/sum_bell_hand.mp3 -> packages/web/public/sounds/sum_bell_hand.mp3
reference/lib/sounds/sum_bell_tone.mp3 -> packages/web/public/sounds/sum_bell_tone.mp3
reference/lib/sounds/sum_chime_jangle.mp3 -> packages/web/public/sounds/sum_chime_jangle.mp3
reference/lib/sounds/sum_ghost_moan.mp3 -> packages/web/public/sounds/sum_ghost_moan.mp3
reference/lib/sounds/sum_ghost_oooo.mp3 -> packages/web/public/sounds/sum_ghost_oooo.mp3
reference/lib/sounds/sum_ghost_wail.mp3 -> packages/web/public/sounds/sum_ghost_wail.mp3
reference/lib/sounds/sum_gong_temple.mp3 -> packages/web/public/sounds/sum_gong_temple.mp3
reference/lib/sounds/sum_laugh_evil2.mp3 -> packages/web/public/sounds/sum_laugh_evil2.mp3
reference/lib/sounds/sum_lion_growl.mp3 -> packages/web/public/sounds/sum_lion_growl.mp3
reference/lib/sounds/sum_piano_scrape.mp3 -> packages/web/public/sounds/sum_piano_scrape.mp3
