import 'babylonjs';
import 'babylonjs-loaders';
import * as child_process from 'child_process';

const fs = require('fs');
const ffmpegPath = require('ffmpeg-binaries');
const { ipcRenderer } = require('electron');
const { remote } = require('electron');
const con = remote.getGlobal('console');
const { dialog } = remote;
const w = remote.getCurrentWindow();

interface ICamera {
    translation: BABYLON.Vector3
};

interface IGLTFAsset {
    filepath: string,
    camera: ICamera;
    sampleImageName: string;
    sampleThumbnailName: string;
}

export default class Renderer {
    private _canvas: HTMLCanvasElement;
    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;

    createSceneAsync(canvas: HTMLCanvasElement, engine: BABYLON.Engine, filepath?: string, camPos?: BABYLON.Vector3): Promise<any> {
        const self = this;

        return new Promise((resolve, reject) => {
            if (self._scene) {
                self._scene.dispose();
            }
            self._canvas = canvas;
            self._engine = engine;

            // This creates a basic Babylon Scene object (non-mesh).
            const scene = new BABYLON.Scene(engine);
            scene.createDefaultCameraOrLight(true, true, true);
            const arcRotateCamera = scene.activeCamera as BABYLON.ArcRotateCamera;
            arcRotateCamera.setPosition(camPos);
            self._camera = arcRotateCamera;
            self._scene = scene;

            // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
            new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), scene);

            if (filepath) {
                const fileURL = filepath.replace(/\\/g, '/');
                const rootDirectory = BABYLON.Tools.GetFolderPath(fileURL);
                const sceneFileName = BABYLON.Tools.GetFilename(fileURL);
                const self = this;

                self._scene.useConstantAnimationDeltaTime = true;
                BABYLON.SceneLoader.OnPluginActivatedObservable.addOnce((plugin) => {
                    if (plugin instanceof BABYLON.GLTFFileLoader) {
                        plugin.animationStartMode = BABYLON.GLTFLoaderAnimationStartMode.NONE;
                    }
                });

                if (fs.existsSync(filepath)) {
                    BABYLON.SceneLoader.ImportMeshAsync("", rootDirectory, sceneFileName, self._scene).then((result) => {
                        if (result.animationGroups[0]) {
                            result.animationGroups[0].start(false);
                        } 
                        else {
                            // Only use the textured skybox if the model isn't animated.
                            const hdrTexture = BABYLON.CubeTexture.CreateFromPrefilteredData("assets/environment.dds", self._scene);
                            hdrTexture.gammaSpace = false;
                            self._scene.createDefaultSkybox(hdrTexture, true, 100, 0.0);
                        }
                        resolve("createSceneAsync: Loaded model: " + fileURL);
                    })
                    .catch(error => {
                        con.log(error.message.toString());
                        reject("createSceneAsync: Failed to load model");
                    });
                }
                else {
                    reject("createSceneAsync: File not found: " + filepath);
                }
            }
            else {
                reject("createSceneAsync: No filepath provided!");
            }
        });
    }

    createSnapshotAsync(sampleImageName: string, outputFolder: string,): Promise<any> {
        const self = this;

        if ((self._scene.animationGroups[0] && (sampleImageName.endsWith('.gif') == false)) ||
        (!self._scene.animationGroups[0] && (sampleImageName.endsWith('.png') == false))) {
            throw Error(`File extension for "${sampleImageName}" does not match state of animation group "${self._scene.animationGroups[0]}". All animations must use .gif while unanimated models use .png`);
        }

        return new Promise((resolve, reject) => {
            const name = BABYLON.Tools.GetFilename(sampleImageName).replace('Figures/SampleImages/', '');
            con.log("making snapshot for: " + name);

            self._scene.executeWhenReady(() => {
                if (self._scene.animationGroups[0]) {
                    // Create an animated gif if the model has an animation.

                    const sampleImageFolderName = outputFolder + '/' + name.replace('.gif', '');
                    fs.mkdirSync(sampleImageFolderName, { recursive: true } );

                    self._scene.animationGroups[0].onAnimationGroupEndObservable.addOnce(() => {
                        self._scene.getEngine().stopRenderLoop();

                        const gifFullName = outputFolder + '/' + name;
                        const palette = `palette.png`;
                        
                        const makePallet = `${ffmpegPath} -hide_banner -loglevel error -y -i ${sampleImageFolderName}/%d.png -vf scale=0:-1:flags=lanczos,palettegen=stats_mode=diff ${palette}`;

                        const gifFromFrames = (`${ffmpegPath} -hide_banner -loglevel error -y -i ${sampleImageFolderName}/%d.png -i ${palette} \
                        -filter_complex "[0:v]setpts=N/(60*TB),split=2[in1][in2];[in1]scale=0:-1:flags=lanczos[x];[x][1:v]paletteuse[out1];[in2]scale=72:72:flags=lanczos[x];[x][1:v]paletteuse[out2]" \
                        -map [out1] ${gifFullName} -map [out2] ${gifFullName.replace('SampleImages', 'Thumbnails')}`);

                        runProgram(makePallet, __dirname)
                        .then(() => {
                            return runProgram(gifFromFrames, __dirname);
                        })
                        .then(() => {
                            resolve("Animated gif generated");
                        }).catch(error => { 
                            con.log(error);
                            con.log(error.message);
                            reject("Error encountered while creating gif.");
                        });
                    });

                    let loopCount = 0;
                    self._scene.getEngine().runRenderLoop(() => {
                        const imageName = sampleImageFolderName + '/' + loopCount + '.png';
                        self._scene.render();
                         self.createScreenshot({ width: self._canvas.width, height: self._canvas.height }, (base64Image: string) => {
                            base64Image = base64Image.replace(/^data:image\/png;base64,/, "");
                            
                            fs.writeFileSync(imageName, base64Image, 'base64', (error: string) => {
                                if (error) throw error;
                            });
                        });

                        loopCount++;
                    });
                }
                else {
                    // No animation on the model, so take an image.

                    self._scene.render();

                    self.createScreenshot({ width: self._canvas.width, height: self._canvas.height }, (base64Image: string) => {
                        if (base64Image) {
                            base64Image = base64Image.replace(/^data:image\/png;base64,/, "");
                            const sampleImageName = outputFolder + '/' + name;
                            fs.writeFile(sampleImageName, base64Image, 'base64', (err: string) => {
                                if (err) {
                                    reject("error happened: " + err);
                                }
                                else {
                                        resolve("snapshot generated");
                                }
                            });
                        }
                        else {
                            reject("No image data available");
                        }
                    });

                }
            });
        });
    }

    async createSnapshotsAsync(glTFAssets: IGLTFAsset[], canvas: HTMLCanvasElement, engine: BABYLON.Engine, outputDirectory: string) {
        for (const glTFAsset of glTFAssets) {
            if (glTFAsset.sampleImageName) {
                try {
                    await this.createSceneAsync(canvas, engine, glTFAsset.filepath, glTFAsset.camera.translation);
                    await this.createSnapshotAsync(glTFAsset.sampleImageName, outputDirectory);
                }
                catch (err) {
                    con.log("Failed to create snapshot: " + err);
                }
            }
        }
        con.log("Complete!");
        w.close();
    }

    initialize(canvas: HTMLCanvasElement) {
        const runHeadless = ipcRenderer.sendSync('synchronous-message', 'headless') || false;
        const manifest = ipcRenderer.sendSync('synchronous-message', 'manifest');
        const outputDirectory = ipcRenderer.sendSync('synchronous-message', 'outputDirectory');
        const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true });

        const glTFAssets: IGLTFAsset[] = this.loadManifestFile(manifest);

        if (runHeadless) {
            if (!fs.existsSync(outputDirectory)) {
                fs.mkdirSync(outputDirectory);
            }
            this.createSnapshotsAsync(glTFAssets, canvas, engine, outputDirectory);
        }
        else {
            this.createSceneAsync(canvas, engine, null, new BABYLON.Vector3(0, 0, 1.3));
            canvas.addEventListener("keyup", this.onKeyUp.bind(this));
            engine.runRenderLoop(() => {
                this._scene.render();
            });

            window.addEventListener('resize', () => {
                engine.resize();
            });
        }
    }

    convertToURL(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    createGLTFAsset(model: any, rootDirectory: string): IGLTFAsset {
        const camera: ICamera = {
            translation: BABYLON.Vector3.FromArray(model.camera.translation),
        }

        const asset: IGLTFAsset = {
            camera: camera,
            filepath: rootDirectory + model.fileName,
            sampleImageName: model.sampleImageName,
            sampleThumbnailName: model.sampleThumbnailName
        };

        return asset;
    }

    /**
     * Get all the gltf assets of a manifest file.
     * @param manifesFile 
     */
    loadManifestFile(manifestJSON: string): IGLTFAsset[] {
        const rootDirectory = BABYLON.Tools.GetFolderPath(this.convertToURL(manifestJSON));
        const result: IGLTFAsset[] = [];

        const content = fs.readFileSync(manifestJSON);
        // Open the manifest file.
        const jsonData = JSON.parse(content);

        if ('models' in jsonData) {
            BABYLON.Tools.Log("Models present");
            con.log("models present");
            for (const model of jsonData['models']) {
                result.push(this.createGLTFAsset(model, rootDirectory));
            }
        }
        else {
            for (const jsonObj of jsonData) {
                const folder = jsonObj.folder;

                for (const model of jsonObj.models) {
                    result.push(this.createGLTFAsset(model, rootDirectory + folder + "/"));
                }
            }
        }

        return result;
    }

    addMeshToScene(filepath: string) {
        if (fs.existsSync(filepath)) {
            const fileURL = filepath.replace(/\\/g, '/');
            const rootDirectory = BABYLON.Tools.GetFolderPath(fileURL);
            const sceneFileName = BABYLON.Tools.GetFilename(fileURL);
            const self = this;


            const addMeshPromise = new Promise((resolve, reject) => {
                BABYLON.SceneLoader.ImportMesh("", rootDirectory, sceneFileName, self._scene, (meshes) => {
                    BABYLON.Tools.Log("Loaded Model");
                    resolve("loaded model: " + fileURL);
                }, null, (scene, message, exception) => {
                    reject("Failed to load model: " + message);
                });
            });
            addMeshPromise.then((result) => {
                con.log(result);
            });
            addMeshPromise.catch((error) => {
                con.error("Failed: " + error);
                throw Error("Failed = " + error);
            });
        }
        else {
            con.log("file not found");
            BABYLON.Tools.Error("File not found: " + filepath);
        }
    }

    onKeyUp(event: KeyboardEvent) {
        const self = this;
        if (event.key == 's' || event.key == 'S') {
            BABYLON.Tools.Log(this._canvas.width.toString());
            this.createScreenshot({ width: this._canvas.width, height: this._canvas.height });
        }
        if (event.key == 'l' || event.key == 'L') {
            BABYLON.Tools.Log('Loading file');
            dialog.showOpenDialog({ properties: ['openFile'] }, (filePaths) => {
                if (filePaths && filePaths.length) {
                    self._scene.dispose();
                    self.createSceneAsync(self._canvas, self._engine, filePaths[0], new BABYLON.Vector3(0, 0, 1.3));
                }
            });
        }
    }

    /**
     * Create an image from the WebGL canvas.
     * @param size - dimensions to use for the image.
     */
    createScreenshot(size: number | { width: number, height: number } | { precision: number }, callback?: (data: string) => void): void {
        BABYLON.Tools.CreateScreenshot(this._engine, this._camera, size, callback);
    }
}

/**
 * Launches an specified external program.
 * @param cmd Program to run, including command line parameters.
 * @param directory Filepath to execute the program from.
 * @param exitFunc Code to be run on completion. (Exit message, next function, etc...)
 */
function runProgram(cmd: string, directory: string) {
    return new Promise((resolve, reject) => {
        const child = child_process.exec(cmd, {cwd: directory});
        child.stdout.on('data', (data: string) => {
            console.log(data.toString());
        });
        child.stderr.on('data', (data: string) => {
            console.log(data.toString());
            reject(data);
        });
        child.on('close', () => {
            resolve('Program Closed');
        });
    });
}

const renderer = new Renderer();
const canvas: HTMLCanvasElement = document.getElementById('render-canvas') as HTMLCanvasElement;
renderer.initialize(canvas);
