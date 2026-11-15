# Epoch

The study RPG, served at `/game` (`game.html`). It is plain JavaScript and
three.js, built as a second Vite page next to the React app, so its styles and
render loop stay out of Soma's.

- **Canvas data:** read from the copy Soma keeps in localStorage
  (`soma_canvas_deep_sync`, see `src/lib/canvasDeepSync.ts`). Fresh snapshots
  from the Soma for Canvas extension are taken only for sites Soma already
  holds for this account. With nothing connected it shows a sample semester.
- **Saves:** localStorage, one per signed-in Soma user (`epoch-save-v1:<user id>`).
  Not synced across devices yet.
- **Rules:** all in `game/src/sim.js`. Run `npm run test:game`.

## Model credits

Files in `public/game/models`:

- `Barbarian.glb`: the hero. KayKit Adventurers pack by Kay Lousberg
  (kaylousberg.com), CC0.
- `Fox.glb`: Khronos glTF Sample Assets. Model by PixelMannen (CC0), rigging
  and animation by tomkranis (CC-BY 4.0).
- `Soldier.glb`, `RobotExpressive.glb`: three.js examples. RobotExpressive is by
  Tomás Laulhé (CC0). Soldier comes from Mixamo.

Check the Soldier terms before this ships to students.
