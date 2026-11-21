Real animal sounds go in this folder.

Name each file  <creature>_<event>[_number].<mp3|ogg|wav|m4a>  (cow_idle.mp3, cow_hurt_2.ogg, wolf_attack.wav ...)
then run  npm run sounds  once. It rewrites manifest.json, which is how the game finds the files.
Anything that has no file keeps the built-in sound. See the main README, "Real animal sounds".
