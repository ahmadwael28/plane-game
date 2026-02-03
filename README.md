# Sky Fury - 3D Plane Combat Game

A 3D web-based flight game built with Three.js. Fly your plane over procedurally generated terrain, fire at will, and try not to crash!

## How to Play

- **W/S** - Pitch up/down
- **A/D** - Roll left/right  
- **Q/E** - Yaw left/right
- **Shift** - Accelerate
- **Ctrl** - Decelerate
- **Space** - Fire
- **Mouse** - Look around

## Running the Game

The game uses ES modules and must be served over HTTP. Options:

### Option 1: Python (if installed)
```bash
cd plane-game
python -m http.server 8000
```
Then open http://localhost:8000

### Option 2: Node.js (npx)
```bash
cd plane-game
npx serve .
```
Then open the URL shown in terminal

### Option 3: VS Code Live Server
Right-click `index.html` → "Open with Live Server"

## Features

- **Realistic procedural plane** - Fighter jet style with fuselage, wings, tail fin, cockpit, engines
- **Custom GLB support** - Add your own plane model (see `models/README.md`)
- **Procedural trees** - Pine, oak, and spruce trees scattered across terrain
- **Procedurally generated terrain** with hills and valleys
- **Collision detection** - Crash on terrain or trees
- **Explosive crash sequence** with fire particles
- **GTA-style controls** - WASD, numpad, mouse orbit camera
