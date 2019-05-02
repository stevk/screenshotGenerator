This tools is used with the [glTF-Asset-Generator](https://github.com/KhronosGroup/glTF-Asset-Generator) to generate sample images and gifs of 3D models.

**How to build**
Run these commands:

```
npm install
npm run build
```

**Interactive Mode**
```
npm start
```

Drag or use the arrow keys to reposition the camera

L key - loads a new glTF/glb model
S - takes a screenshot and saves to disk

**Headless Mode**
```
npm start -- -- headless=true manifest=../path/to/manifest/file outputDirectory=../path/to/save/screenshots
```

