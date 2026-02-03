# Custom 3D Models

## Adding Your Own Plane Model

1. Download a free plane/aircraft model in **GLB** or **GLTF** format from:
   - [Sketchfab](https://sketchfab.com) - filter by "Downloadable" and "glTF"
   - [Quaternius](https://quaternius.com) - free game assets
   - [Poly Pizza](https://poly.pizza) - CC0 models

2. Place the `.glb` file in this folder (e.g. `plane.glb`)

3. In `game.js`, set the model URL:
   ```javascript
   const PLANE_MODEL_URL = 'models/plane.glb';
   ```

4. The game will automatically scale the model to fit. Models are typically 1-5 units; the game scales to ~8 units.

## Recommended Models

- **Cessna 172** - Search Sketchfab for "Cessna 172 gltf"
- **Fighter Jet** - Search for "fighter jet low poly glb"
- Ensure the model faces **-Z** (forward) for correct flight direction
