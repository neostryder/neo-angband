; Neo Angband - NSIS installer customisation.
;
; The installer's only extra job is to identify its own work. Neo Angband keeps
; everything it writes - config, savefiles, scores, character dumps and mods - in
; a `neo-angband-data` folder beside the executable, so that unzipping the game
; into C:\Games\Neo Angband gives you one self-contained folder you can move,
; back up, or carry on a stick.
;
; An INSTALLED copy must not do that, for one blunt reason: the uninstaller
; deletes its install directory, and a player's characters must not be inside it.
; So an installed copy keeps its data under the user's application data instead.
;
; On disk the two copies are otherwise identical - an executable with resources
; beside it - so the game cannot tell them apart by looking. This file is how it
; is told: the installer leaves a marker, and the game treats every UNMARKED
; folder as portable (see src/data-dir.ts, INSTALLED_MARKER).
;
; The marker is also a note to whoever finds it, because it is the only file in
; the folder that explains where the savefiles went.

!macro customInstall
  FileOpen $0 "$INSTDIR\installed.txt" w
  FileWrite $0 "This copy of Neo Angband was put here by its installer.$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "Because this folder is deleted when you uninstall, the game keeps$\r$\n"
  FileWrite $0 "your savefiles, settings and mods somewhere safer:$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "    %APPDATA%\Neo Angband$\r$\n"
  FileWrite $0 "$\r$\n"
  FileWrite $0 "To make this copy self-contained instead, create a folder named$\r$\n"
  FileWrite $0 "neo-angband-data next to the executable and the game will use it.$\r$\n"
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\installed.txt"
!macroend
