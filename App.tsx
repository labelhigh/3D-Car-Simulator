
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

// Perlin noise implementation for terrain generation
class PerlinNoise {
    private p: Uint8Array;
    private octaves: number;
    private falloff: number;

    constructor() {
        this.p = new Uint8Array(512);
        this.octaves = 4;
        this.falloff = 0.5;
        this.seed(Math.random());
    }

    public seed(seed: number) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;

        for (let i = 255; i > 0; i--) {
            const j = Math.floor(seed * (i + 1));
            const temp = p[i];
            p[i] = p[j];
            p[j] = temp;
        }

        for (let i = 0; i < 256; i++) {
            this.p[i] = this.p[i + 256] = p[i];
        }
    }

    private fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
    private lerp(t: number, a: number, b: number) { return a + t * (b - a); }
    private grad(hash: number, x: number, y: number, z: number) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    public noise(x: number, y: number, z = 0) {
        let total = 0;
        let frequency = 1;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < this.octaves; i++) {
            total += this.noiseDetail(x * frequency, y * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= this.falloff;
            frequency *= 2;
        }

        return total / maxValue;
    }

    private noiseDetail(x: number, y: number, z: number) {
        const floorX = Math.floor(x) & 255;
        const floorY = Math.floor(y) & 255;
        const floorZ = Math.floor(z) & 255;

        const xMinusFloor = x - Math.floor(x);
        const yMinusFloor = y - Math.floor(y);
        const zMinusFloor = z - Math.floor(z);

        const u = this.fade(xMinusFloor);
        const v = this.fade(yMinusFloor);
        const w = this.fade(zMinusFloor);

        const p = this.p;
        const A = p[floorX] + floorY;
        const AA = p[A] + floorZ;
        const AB = p[A + 1] + floorZ;
        const B = p[floorX + 1] + floorY;
        const BA = p[B] + floorZ;
        const BB = p[B + 1] + floorZ;

        return this.lerp(w, this.lerp(v, this.lerp(u, this.grad(p[AA], xMinusFloor, yMinusFloor, zMinusFloor),
                                                    this.grad(p[BA], xMinusFloor - 1, yMinusFloor, zMinusFloor)),
                                      this.lerp(u, this.grad(p[AB], xMinusFloor, yMinusFloor - 1, zMinusFloor),
                                                    this.grad(p[BB], xMinusFloor - 1, yMinusFloor - 1, zMinusFloor))),
                        this.lerp(v, this.lerp(u, this.grad(p[AA + 1], xMinusFloor, yMinusFloor, zMinusFloor - 1),
                                                    this.grad(p[BA + 1], xMinusFloor - 1, yMinusFloor, zMinusFloor - 1)),
                                      this.lerp(u, this.grad(p[AB + 1], xMinusFloor, yMinusFloor - 1, zMinusFloor - 1),
                                                    this.grad(p[BB + 1], xMinusFloor - 1, yMinusFloor - 1, zMinusFloor - 1))));
    }
}

// Type definitions
interface Pedestrian {
    mesh: THREE.Group;
    state: 'walking' | 'idle' | 'hit';
    speed: number;
    destination: THREE.Vector3;
    idleTimer: number;
    animationPhase: number;
    hitVelocity: THREE.Vector3;
    baseY: number;
}

interface Missile {
    mesh: THREE.Group;
    velocity: THREE.Vector3;
    lifetime: number;
}

interface Explosion {
    mesh: THREE.Mesh;
    lifetime: number;
}

interface AiCar {
    mesh: THREE.Group;
    velocity: THREE.Vector3;
    speed: number;
    targetAngle: number;
    isTurning: boolean;
    state: 'driving' | 'hit';
    hitVelocity: THREE.Vector3;
}


const CarSimulator: React.FC = () => {
    const mountRef = useRef<HTMLDivElement>(null);
    const [score, setScore] = useState(0);
    // FIX: Changed property names from arrowUp/Down/Left/Right to up/down/left/right
    // to match key event handler logic and subsequent property access. This resolves
    // errors when checking for arrow key presses.
    const keysRef = useRef({
        w: false, s: false, a: false, d: false,
        up: false, down: false, left: false, right: false,
    });
    const listenerRef = useRef<THREE.AudioListener | null>(null);
    // FIX: AudioBuffer is a native Web Audio API type, not a member of the THREE namespace.
    const audioBuffersRef = useRef<Record<string, AudioBuffer>>({});
    const playerEngineSoundRef = useRef<THREE.PositionalAudio | null>(null);

    // This effect handles the browser's autoplay policy by resuming the AudioContext on the first user interaction.
    useEffect(() => {
        const resumeAudioContext = () => {
            if (listenerRef.current && listenerRef.current.context.state === 'suspended') {
                listenerRef.current.context.resume();
            }
            window.removeEventListener('click', resumeAudioContext);
            window.removeEventListener('keydown', resumeAudioContext);
        };

        window.addEventListener('click', resumeAudioContext);
        window.addEventListener('keydown', resumeAudioContext);

        return () => {
            window.removeEventListener('click', resumeAudioContext);
            window.removeEventListener('keydown', resumeAudioContext);
        };
    }, []);

    useEffect(() => {
        if (!mountRef.current) return;
        const currentMount = mountRef.current;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87ceeb);
        scene.fog = new THREE.Fog(0x87ceeb, 150, 400);

        // Camera setup
        const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
        
        // Renderer setup
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        currentMount.appendChild(renderer.domElement);

        // --- Audio Setup ---
        const listener = new THREE.AudioListener();
        camera.add(listener);
        listenerRef.current = listener;

        const audioLoader = new THREE.AudioLoader();
        const soundUrls: Record<string, string> = {
            pedestrianHit: 'https://cdn.pixabay.com/audio/2024/10/27/audio_472c20c144.mp3',
            missile: 'https://cdn.pixabay.com/audio/2022/03/25/audio_6c3720f12c.mp3',
            vehicleHit: 'https://cdn.pixabay.com/audio/2023/08/06/audio_296d74df50.mp3',
            playerEngine: 'https://cdn.pixabay.com/audio/2025/06/15/audio_61da1628aa.mp3',
            city: 'https://cdn.pixabay.com/audio/2022/03/09/audio_32ea371bfb.mp3',
            aiEngine: 'https://cdn.pixabay.com/audio/2025/02/01/audio_294e57241b.mp3',
        };
        
        let soundsReady = false;

        // FIX: AudioBuffer is a native Web Audio API type, not a member of the THREE namespace.
        const playPositionalSound = (buffer: AudioBuffer, position: THREE.Vector3, volume = 1) => {
            const sound = new THREE.PositionalAudio(listener);
            sound.setBuffer(buffer);
            sound.setVolume(volume);
            sound.setRefDistance(20);
            
            const tempObject = new THREE.Object3D();
            tempObject.position.copy(position);
            scene.add(tempObject);
            tempObject.add(sound);
            sound.play();

            sound.onEnded = () => {
                tempObject.remove(sound);
                scene.remove(tempObject);
                sound.disconnect();
            };
        };

        // FIX: AudioBuffer is a native Web Audio API type, not a member of the THREE namespace.
        const playNonPositionalSound = (buffer: AudioBuffer, volume = 1) => {
            const sound = new THREE.Audio(listener);
            sound.setBuffer(buffer);
            sound.setVolume(volume);
            sound.play();
        };
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(100, 120, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 4096;
        directionalLight.shadow.mapSize.height = 4096;
        directionalLight.shadow.camera.top = 150;
        directionalLight.shadow.camera.bottom = -150;
        directionalLight.shadow.camera.left = -150;
        directionalLight.shadow.camera.right = 150;
        scene.add(directionalLight);
        scene.add(directionalLight.target);
        
        // Game state
        const missiles: Missile[] = [];
        const explosions: Explosion[] = [];
        let missileCooldown = 0;
        const MISSILE_COOLDOWN_TIME = 0.5; // seconds

        // Constants
        const groundSize = 200;
        const gridSize = 4;
        const blockSize = 40;
        const streetWidth = 8;
        const sidewalkWidth = 3;
        const totalBlockSize = blockSize + streetWidth;

        const collidables: THREE.Object3D[] = [];
        const cityObjects = new THREE.Group();
        scene.add(cityObjects);

        // Ground and City Layout
        const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
        const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 }); // Match terrain grass
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);
        
        const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
        const sidewalkMaterial = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
        const laneLineMaterial = new THREE.MeshLambertMaterial({ color: 0xffff00 });
        const roadNetwork: { x: number[], z: number[] } = { x: [], z: [] };
        
        const lineLength = 4;
        const lineGap = 6;
        const segmentLength = lineLength + lineGap;
        const numSegments = Math.floor(groundSize / segmentLength);
        const laneWidth = 0.2;

        // --- Inner City Grid ---
        for (let i = 1; i < gridSize; i++) {
            const roadCenter = -groundSize / 2 + streetWidth / 2 + i * totalBlockSize;
            
            // Roads
            const roadGeomH = new THREE.PlaneGeometry(groundSize, streetWidth);
            const roadH = new THREE.Mesh(roadGeomH, roadMaterial);
            roadH.rotation.x = -Math.PI/2;
            roadH.position.set(0, 0.01, roadCenter);
            roadH.receiveShadow = true;
            cityObjects.add(roadH);
            roadNetwork.z.push(roadCenter);
            
            // Yellow Dashed Lines for Horizontal Roads
            for (let j = 0; j < numSegments; j++) {
                const xPos = -groundSize / 2 + j * segmentLength;
                const lineGeom = new THREE.PlaneGeometry(lineLength, laneWidth);
                const line = new THREE.Mesh(lineGeom, laneLineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(xPos + lineLength / 2, 0.015, roadCenter);
                line.receiveShadow = true;
                cityObjects.add(line);
            }

            const roadGeomV = new THREE.PlaneGeometry(streetWidth, groundSize);
            const roadV = new THREE.Mesh(roadGeomV, roadMaterial);
            roadV.rotation.x = -Math.PI/2;
            roadV.position.set(roadCenter, 0.01, 0);
            roadV.receiveShadow = true;
            cityObjects.add(roadV);
            roadNetwork.x.push(roadCenter);

            // Yellow Dashed Lines for Vertical Roads
            for (let j = 0; j < numSegments; j++) {
                const zPos = -groundSize / 2 + j * segmentLength;
                const lineGeom = new THREE.PlaneGeometry(laneWidth, lineLength);
                const line = new THREE.Mesh(lineGeom, laneLineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(roadCenter, 0.015, zPos + lineLength / 2);
                line.receiveShadow = true;
                cityObjects.add(line);
            }

            // Sidewalks
            const sidewalkGeomH = new THREE.PlaneGeometry(groundSize, sidewalkWidth);
            const sidewalkH1 = new THREE.Mesh(sidewalkGeomH, sidewalkMaterial);
            sidewalkH1.rotation.x = -Math.PI/2;
            sidewalkH1.position.set(0, 0.02, roadH.position.z - streetWidth/2 - sidewalkWidth/2);
            sidewalkH1.receiveShadow = true;
            cityObjects.add(sidewalkH1);

            const sidewalkH2 = new THREE.Mesh(sidewalkGeomH, sidewalkMaterial);
            sidewalkH2.rotation.x = -Math.PI/2;
            sidewalkH2.position.set(0, 0.02, roadH.position.z + streetWidth/2 + sidewalkWidth/2);
            sidewalkH2.receiveShadow = true;
            cityObjects.add(sidewalkH2);

            const sidewalkGeomV = new THREE.PlaneGeometry(sidewalkWidth, groundSize);
            const sidewalkV1 = new THREE.Mesh(sidewalkGeomV, sidewalkMaterial);
            sidewalkV1.rotation.x = -Math.PI/2;
            sidewalkV1.position.set(roadV.position.x - streetWidth/2 - sidewalkWidth/2, 0.02, 0);
            sidewalkV1.receiveShadow = true;
            cityObjects.add(sidewalkV1);

            const sidewalkV2 = new THREE.Mesh(sidewalkGeomV, sidewalkMaterial);
            sidewalkV2.rotation.x = -Math.PI/2;
            sidewalkV2.position.set(roadV.position.x + streetWidth/2 + sidewalkWidth/2, 0.02, 0);
            sidewalkV2.receiveShadow = true;
            cityObjects.add(sidewalkV2);
        }
        
        // --- Perimeter Road ---
        const perimeterOffset = groundSize / 2 - streetWidth / 2;
        const perimeterPositions = [-perimeterOffset, perimeterOffset];

        // Horizontal Perimeter Roads (Top & Bottom) with Exits
        perimeterPositions.forEach(zPos => {
            const cityExitWidth = streetWidth * 2; // A wider opening for the exit
            const perimeterSegmentLength = (groundSize - cityExitWidth) / 2;
            
            const roadSegmentCenterX1 = -groundSize / 2 + perimeterSegmentLength / 2;
            const roadSegmentCenterX2 = groundSize / 2 - perimeterSegmentLength / 2;

            // Road Segments
            const roadSeg1 = new THREE.Mesh(new THREE.PlaneGeometry(perimeterSegmentLength, streetWidth), roadMaterial);
            roadSeg1.rotation.x = -Math.PI/2;
            roadSeg1.position.set(roadSegmentCenterX1, 0.01, zPos);
            roadSeg1.receiveShadow = true;
            cityObjects.add(roadSeg1);

            const roadSeg2 = new THREE.Mesh(new THREE.PlaneGeometry(perimeterSegmentLength, streetWidth), roadMaterial);
            roadSeg2.rotation.x = -Math.PI/2;
            roadSeg2.position.set(roadSegmentCenterX2, 0.01, zPos);
            roadSeg2.receiveShadow = true;
            cityObjects.add(roadSeg2);

            roadNetwork.z.push(zPos);

            // Lane lines
            for (let j = 0; j < numSegments; j++) {
                const xPos = -groundSize / 2 + j * segmentLength;
                if (Math.abs(xPos + lineLength / 2) < cityExitWidth / 2) continue; // Skip gap
                
                const line = new THREE.Mesh(new THREE.PlaneGeometry(lineLength, laneWidth), laneLineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(xPos + lineLength / 2, 0.015, zPos);
                cityObjects.add(line);
            }

            // Sidewalks
            const sidewalkGeomH = new THREE.PlaneGeometry(perimeterSegmentLength, sidewalkWidth);
            [roadSegmentCenterX1, roadSegmentCenterX2].forEach(xCenter => {
                const sidewalk1 = new THREE.Mesh(sidewalkGeomH, sidewalkMaterial);
                sidewalk1.rotation.x = -Math.PI/2;
                sidewalk1.position.set(xCenter, 0.02, zPos - streetWidth/2 - sidewalkWidth/2);
                cityObjects.add(sidewalk1);

                const sidewalk2 = new THREE.Mesh(sidewalkGeomH, sidewalkMaterial);
                sidewalk2.rotation.x = -Math.PI/2;
                sidewalk2.position.set(xCenter, 0.02, zPos + streetWidth/2 + sidewalkWidth/2);
                cityObjects.add(sidewalk2);
            });
        });


        // Vertical Perimeter Roads (Left & Right)
        perimeterPositions.forEach(xPos => {
            const road = new THREE.Mesh(new THREE.PlaneGeometry(streetWidth, groundSize + streetWidth), roadMaterial); // Extend to fill corners
            road.rotation.x = -Math.PI / 2;
            road.position.set(xPos, 0.01, 0);
            road.receiveShadow = true;
            cityObjects.add(road);
            roadNetwork.x.push(xPos);

            // Lane lines
            for (let j = 0; j < numSegments; j++) {
                const zPos = -groundSize / 2 + j * segmentLength;
                const line = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, lineLength), laneLineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(xPos, 0.015, zPos + lineLength / 2);
                cityObjects.add(line);
            }
            // Sidewalks
            const sidewalkGeomV = new THREE.PlaneGeometry(sidewalkWidth, groundSize + streetWidth); // Match road length
            const sidewalk1 = new THREE.Mesh(sidewalkGeomV, sidewalkMaterial);
            sidewalk1.rotation.x = -Math.PI/2;
            sidewalk1.position.set(xPos - streetWidth/2 - sidewalkWidth/2, 0.02, 0);
            cityObjects.add(sidewalk1);
            const sidewalk2 = new THREE.Mesh(sidewalkGeomV, sidewalkMaterial);
            sidewalk2.rotation.x = -Math.PI/2;
            sidewalk2.position.set(xPos + streetWidth/2 + sidewalkWidth/2, 0.02, 0);
            cityObjects.add(sidewalk2);
        });


        const sidewalkPoints: THREE.Vector3[] = [];
        roadNetwork.x.forEach(x => {
            const x1 = x - streetWidth/2 - sidewalkWidth/2;
            const x2 = x + streetWidth/2 + sidewalkWidth/2;
            for(let i = -groundSize/2; i <= groundSize/2; i += 10) {
                 sidewalkPoints.push(new THREE.Vector3(x1, 0, i));
                 sidewalkPoints.push(new THREE.Vector3(x2, 0, i));
            }
        });
        roadNetwork.z.forEach(z => {
            const z1 = z - streetWidth/2 - sidewalkWidth/2;
            const z2 = z + streetWidth/2 + sidewalkWidth/2;
            for(let i = -groundSize/2; i <= groundSize/2; i += 10) {
                 sidewalkPoints.push(new THREE.Vector3(i, 0, z1));
                 sidewalkPoints.push(new THREE.Vector3(i, 0, z2));
            }
        });


        // --- Helper Functions for City Generation ---
        const generateBuildingTexture = (bWidth: number, bHeight: number, color: string | number, hasDoor: boolean) => {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) return null;

            const scale = 10;
            canvas.width = bWidth * scale;
            canvas.height = bHeight * scale;

            context.fillStyle = new THREE.Color(color).getStyle();
            context.fillRect(0, 0, canvas.width, canvas.height);

            const windowSize = 2 * scale;
            const windowMargin = 1.5 * scale;
            const floorHeight = 4 * scale;

            // Draw windows
            for (let y = canvas.height - floorHeight; y > windowSize; y -= floorHeight) {
                for (let x = windowMargin; x < canvas.width - windowMargin - windowSize; x += windowSize + windowMargin) {
                    context.fillStyle = Math.random() > 0.3 ? '#222244' : '#FFFF88';
                    context.fillRect(x, y, windowSize, windowSize);
                }
            }

            // Draw door
            if (hasDoor) {
                const doorWidth = 3 * scale;
                const doorHeight = 5 * scale;
                context.fillStyle = '#331100';
                context.fillRect((canvas.width - doorWidth) / 2, canvas.height - doorHeight, doorWidth, doorHeight);
            }

            return new THREE.CanvasTexture(canvas);
        };
        
        const createBuilding = (config: { type: 'residential' | 'commercial' | 'landmark', position: THREE.Vector3, block_size: number}) => {
            const { type, position, block_size } = config;
            const building = new THREE.Group();
            let height: number, baseColor: number | string;
            
            const width = THREE.MathUtils.randFloat(block_size * 0.3, block_size * 0.6);
            const depth = THREE.MathUtils.randFloat(block_size * 0.3, block_size * 0.6);

            switch(type) {
                case 'residential':
                    height = THREE.MathUtils.randFloat(5, 15);
                    baseColor = [0xd3d3d3, 0xf5f5dc, 0xadd8e6][Math.floor(Math.random() * 3)];
                    break;
                case 'commercial':
                    height = THREE.MathUtils.randFloat(20, 40);
                    baseColor = 0x4a4a4a;
                    break;
                case 'landmark':
                    height = THREE.MathUtils.randFloat(50, 60);
                    baseColor = [0xffd700, 0xC00000][Math.floor(Math.random() * 2)];
                    break;
            }

            const mainGeom = new THREE.BoxGeometry(width, height, depth);
            
            const topBottomMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
            const frontTexture = generateBuildingTexture(width, height, baseColor, true);
            const sideTexture = generateBuildingTexture(depth, height, baseColor, false);
            const backTexture = generateBuildingTexture(width, height, baseColor, false);

            const materials = [
                new THREE.MeshStandardMaterial({ map: sideTexture }),    // right
                new THREE.MeshStandardMaterial({ map: sideTexture }),    // left
                topBottomMaterial,                                      // top
                topBottomMaterial,                                      // bottom
                new THREE.MeshStandardMaterial({ map: frontTexture }),   // front
                new THREE.MeshStandardMaterial({ map: backTexture }),    // back
            ];

            const mainBody = new THREE.Mesh(mainGeom, materials);
            mainBody.castShadow = true;
            mainBody.receiveShadow = true;
            building.add(mainBody);

            building.position.set(position.x, height / 2, position.z);
            cityObjects.add(building);
            collidables.push(building);
        };

        const createTree = (x: number, z: number) => {
            const tree = new THREE.Group();
            const trunkHeight = THREE.MathUtils.randFloat(2, 4);
            const trunkGeom = new THREE.BoxGeometry(0.5, trunkHeight, 0.5);
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const trunk = new THREE.Mesh(trunkGeom, trunkMat);
            trunk.castShadow = true;
            tree.add(trunk);
            
            const canopyGeom = new THREE.BoxGeometry(2, 2, 2);
            const canopyMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
            const canopy = new THREE.Mesh(canopyGeom, canopyMat);
            canopy.position.y = trunkHeight / 2 + 0.5;
            canopy.castShadow = true;
            tree.add(canopy);
            
            tree.position.set(x, trunkHeight / 2, z);
            cityObjects.add(tree);
            collidables.push(tree);
        };

        const createParkingLot = (cx: number, cz: number) => {
            const lotGeom = new THREE.PlaneGeometry(blockSize, blockSize);
            const lotMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
            const lot = new THREE.Mesh(lotGeom, lotMat);
            lot.rotation.x = -Math.PI / 2;
            lot.position.set(cx, 0.03, cz);
            lot.receiveShadow = true;
            cityObjects.add(lot);
        }
        
        const createTrafficLight = (x: number, z: number) => {
            const light = new THREE.Group();
            const poleGeom = new THREE.CylinderGeometry(0.1, 0.1, 4, 8);
            const poleMat = new THREE.MeshStandardMaterial({color: 0x333333});
            const pole = new THREE.Mesh(poleGeom, poleMat);
            light.add(pole);
            
            const housingGeom = new THREE.BoxGeometry(0.3, 0.8, 0.2);
            const housingMat = new THREE.MeshStandardMaterial({color: 0x222222});
            const housing = new THREE.Mesh(housingGeom, housingMat);
            housing.position.y = 1.6;
            light.add(housing);

            const redLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({color: 0xff0000}));
            redLight.position.set(0, 1.8, 0.11);
            housing.add(redLight);
            const yellowLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({color: 0xffff00}));
            yellowLight.position.set(0, 1.55, 0.11);
            housing.add(yellowLight);
            const greenLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({color: 0x00ff00}));
            greenLight.position.set(0, 1.3, 0.11);
            housing.add(greenLight);
            
            light.position.set(x, 2, z);
            cityObjects.add(light);
            collidables.push(light);
        };

        const createPedestrian = () => {
             const colors = [
                { shirt: 0xff0000, pants: 0x0000ff }, { shirt: 0x00ff00, pants: 0x333333 },
                { shirt: 0xffff00, pants: 0x555555 }, { shirt: 0xff00ff, pants: 0x000088 },
                { shirt: 0x00ffff, pants: 0x8B4513 }, { shirt: 0xffa500, pants: 0x444444 }
            ];
            const color = colors[Math.floor(Math.random() * colors.length)];
            const shirtMat = new THREE.MeshStandardMaterial({ color: color.shirt });
            const pantsMat = new THREE.MeshStandardMaterial({ color: color.pants });
            const headMat = new THREE.MeshStandardMaterial({color: 0xFFE4C4});

            const pedestrian = new THREE.Group();
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
            head.position.y = 1.4;
            pedestrian.add(head);

            const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), shirtMat);
            body.position.y = 0.8;
            pedestrian.add(body);

            const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), shirtMat);
            leftArm.position.set(-0.45, 0.8, 0);
            leftArm.name = "leftArm";
            pedestrian.add(leftArm);

            const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), shirtMat);
            rightArm.position.set(0.45, 0.8, 0);
            rightArm.name = "rightArm";
            pedestrian.add(rightArm);

            const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), pantsMat);
            leftLeg.position.set(-0.2, 0, 0);
            leftLeg.name = "leftLeg";
            pedestrian.add(leftLeg);

            const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), pantsMat);
            rightLeg.position.set(0.2, 0, 0);
            rightLeg.name = "rightLeg";
            pedestrian.add(rightLeg);
            
            pedestrian.traverse(obj => {
                if(obj instanceof THREE.Mesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                }
            })

            pedestrian.position.y = 0.5;
            return pedestrian;
        };

        // Populate City Blocks
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const cx = -groundSize / 2 + streetWidth + blockSize / 2 + i * totalBlockSize;
                const cz = -groundSize / 2 + streetWidth + blockSize / 2 + j * totalBlockSize;

                const blockType = Math.random();
                if (blockType < 0.7) {
                    createBuilding({type: 'residential', position: new THREE.Vector3(cx, 0, cz), block_size: blockSize});
                     for(let k=0; k < 3; k++) {
                        const treeX = cx + THREE.MathUtils.randFloatSpread(blockSize * 0.8);
                        const treeZ = cz + THREE.MathUtils.randFloatSpread(blockSize * 0.8);
                        createTree(treeX, treeZ);
                    }
                } else if (blockType < 0.85) {
                    for(let k=0; k < 8; k++) {
                        const treeX = cx + THREE.MathUtils.randFloatSpread(blockSize * 0.9);
                        const treeZ = cz + THREE.MathUtils.randFloatSpread(blockSize * 0.9);
                        createTree(treeX, treeZ);
                    }
                } else {
                    createParkingLot(cx, cz);
                }
            }
        }
        
        // Add Traffic Lights at intersections
        for (let i = 1; i <= gridSize; i++) {
            for (let j = 1; j <= gridSize; j++) {
                const ix = -groundSize/2 + (i * totalBlockSize) - streetWidth/2;
                const iz = -groundSize/2 + (j * totalBlockSize) - streetWidth/2;
                 createTrafficLight(ix - sidewalkWidth, iz - sidewalkWidth);
            }
        }
        
        // --- Pedestrian System ---
        const pedestrians: Pedestrian[] = [];
        const numPedestrians = THREE.MathUtils.randInt(30, 50);
        
        const getRandomSidewalkPoint = () => sidewalkPoints[Math.floor(Math.random() * sidewalkPoints.length)].clone();

        for (let i = 0; i < numPedestrians; i++) {
            const mesh = createPedestrian();
            const startPos = getRandomSidewalkPoint();
            mesh.position.x = startPos.x;
            mesh.position.z = startPos.z;
            
            const pedestrian: Pedestrian = {
                mesh,
                state: 'idle',
                speed: THREE.MathUtils.randFloat(0.02, 0.04),
                destination: getRandomSidewalkPoint(),
                idleTimer: THREE.MathUtils.randFloat(2, 5),
                animationPhase: Math.random() * Math.PI * 2,
                hitVelocity: new THREE.Vector3(),
                baseY: mesh.position.y
            };
            pedestrians.push(pedestrian);
            scene.add(mesh);
        }

        // --- Mountain Pass Road ---
        const worldSize = 800;
        const mountainRoadGroup = new THREE.Group();
        const roadLength = worldSize / 2 - groundSize / 2;
        
        // This road will be at X=0, extending North and South from the city perimeter.
        const roadCenterOffset = groundSize / 2 + roadLength / 2;

        const roadPositions = [
            { z: roadCenterOffset, length: roadLength }, // North
            { z: -roadCenterOffset, length: roadLength } // South
        ];

        roadPositions.forEach(pos => {
            // Road surface
            const roadGeom = new THREE.PlaneGeometry(streetWidth, pos.length);
            const road = new THREE.Mesh(roadGeom, roadMaterial);
            road.rotation.x = -Math.PI / 2;
            road.position.set(0, 0.01, pos.z);
            road.receiveShadow = true;
            mountainRoadGroup.add(road);

            // Lane lines for the mountain road
            const numMountainLaneSegments = Math.floor(pos.length / segmentLength);
            const startZ = pos.z - pos.length / 2;
            for (let j = 0; j < numMountainLaneSegments; j++) {
                const zPos = startZ + j * segmentLength + lineGap / 2;
                const line = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, lineLength), laneLineMaterial);
                line.rotation.x = -Math.PI / 2;
                line.position.set(0, 0.015, zPos + lineLength / 2);
                mountainRoadGroup.add(line);
            }
        });
        scene.add(mountainRoadGroup);
        // --- End Mountain Pass Road ---


        // --- Terrain Generation ---
        const terrainGroup = new THREE.Group();
        scene.add(terrainGroup);
        const terrainBlockSize = 10;
        const terrainMaxHeight = 60;
        const noiseScale = 200;
        const noise = new PerlinNoise();
        noise.seed(Math.random());
        const terrainMaterials = { water: new THREE.MeshStandardMaterial({ color: 0x4682B4, roughness: 0.1, metalness: 0.2 }), sand: new THREE.MeshStandardMaterial({ color: 0xF0E68C }), grass: new THREE.MeshStandardMaterial({ color: 0x228B22 }), forest: new THREE.MeshStandardMaterial({ color: 0x556B2F }), rock: new THREE.MeshStandardMaterial({ color: 0x808080 }), snow: new THREE.MeshStandardMaterial({ color: 0xFFFAFA }) };
        
        const mountainRoadClearance = streetWidth * 2; // Flatten a wider area than the road itself

        for (let x = -worldSize / 2; x < worldSize / 2; x += terrainBlockSize) {
            for (let z = -worldSize / 2; z < worldSize / 2; z += terrainBlockSize) {
                if (x > -groundSize / 2 && x < groundSize / 2 && z > -groundSize / 2 && z < groundSize / 2) continue;

                // Flatten terrain for the mountain pass road
                if (x >= -mountainRoadClearance / 2 && x < mountainRoadClearance / 2) {
                    const flatHeight = 0.1; // Just above the ground plane
                    const block = new THREE.Mesh( new THREE.BoxGeometry(terrainBlockSize, flatHeight, terrainBlockSize), terrainMaterials.grass );
                    block.position.set(x + terrainBlockSize / 2, flatHeight / 2, z + terrainBlockSize / 2);
                    block.receiveShadow = true;
                    terrainGroup.add(block);
                    // This surface is drivable, so it should not be a collidable object.
                    continue; 
                }

                const nx = x / noiseScale;
                const nz = z / noiseScale;
                const noiseValue = (noise.noise(nx, nz, 0) + 1) / 2;
                const distFromCenter = Math.sqrt(x*x + z*z);
                const worldEdgeFactor = Math.pow(distFromCenter / (worldSize * 0.6), 3);
                let height = Math.pow(noiseValue, 2.2) * terrainMaxHeight + worldEdgeFactor * 100;
                let material;
                if (height < 3) { material = terrainMaterials.water; height = 3;  } 
                else if (height < 6) { material = terrainMaterials.sand; } 
                else if (height < 25) { material = terrainMaterials.grass; }
                else if (height < 50) { material = terrainMaterials.forest; }
                else if (height < 70) { material = terrainMaterials.rock; }
                else { material = terrainMaterials.snow; }
                const block = new THREE.Mesh( new THREE.BoxGeometry(terrainBlockSize, height, terrainBlockSize), material );
                block.position.set(x + terrainBlockSize / 2, height / 2, z + terrainBlockSize / 2);
                block.castShadow = true;
                block.receiveShadow = true;
                terrainGroup.add(block);
                collidables.push(block);
            }
        }

        // --- AI Vehicle Creation ---
        const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
        wheelGeometry.rotateZ(Math.PI / 2);

        const createBus = () => { const bus = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 8), new THREE.MeshStandardMaterial({ color: 0xffd700 })); body.castShadow = true; bus.add(body); const busWheelsPos = [ {x: 1.3, z: 3}, {x: -1.3, z: 3}, {x: 1.3, z: -0.5}, {x: -1.3, z: -0.5}, {x: 1.3, z: -2.5}, {x: -1.3, z: -2.5}, ]; busWheelsPos.forEach(pos => { const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial); wheel.position.set(pos.x, -0.6, pos.z); bus.add(wheel); }); bus.position.y = 1; return bus; };
        const createMotorcycle = () => { const motorcycle = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); motorcycle.add(body); const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x888888 })); handlebar.position.set(0, 0.5, 0.8); motorcycle.add(handlebar); const motorcycleWheelsPos = [{z: 0.8}, {z: -0.8}]; motorcycleWheelsPos.forEach(pos => { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16).rotateZ(Math.PI/2), wheelMaterial); wheel.position.set(0, -0.3, pos.z); motorcycle.add(wheel); }); motorcycle.position.y = 0.6; return motorcycle; };
        const createSportsCar = () => { const sportsCar = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 4.5), new THREE.MeshStandardMaterial({ color: 0xff0000 })); sportsCar.add(body); const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.0), new THREE.MeshStandardMaterial({ color: 0x111111 })); cabin.position.y = 0.65; cabin.position.z = -0.5; sportsCar.add(cabin); const wheelPositions = [ {x: 1.1, z: 1.6}, {x: -1.1, z: 1.6}, {x: 1.1, z: -1.6}, {x: -1.1, z: -1.6}, ]; wheelPositions.forEach(pos => { const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial); wheel.position.set(pos.x, -0.1, pos.z); sportsCar.add(wheel); }); sportsCar.position.y = 0.4; return sportsCar; };
        const createTruck = () => { const truck = new THREE.Group(); const cab = new THREE.Mesh( new THREE.BoxGeometry(2.5, 2, 2.5), new THREE.MeshStandardMaterial({ color: 0xffffff }) ); cab.position.z = 3; truck.add(cab); const container = new THREE.Mesh( new THREE.BoxGeometry(2.5, 2.8, 6), new THREE.MeshStandardMaterial({ color: 0xaaaaaa }) ); container.position.z = -1; container.position.y = 0.4; truck.add(container); const truckWheelsPos = [ {x: 1.3, z: 3.8}, {x: -1.3, z: 3.8}, {x: 1.3, z: -2}, {x: -1.3, z: -2}, {x: 1.3, z: -3.5}, {x: -1.3, z: -3.5}, ]; truckWheelsPos.forEach(pos => { const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial); wheel.position.set(pos.x, -0.6, pos.z); truck.add(wheel); }); truck.position.y = 1; return truck; };
        const createSedan = () => { const sedan = new THREE.Group(); const colors = [0xaaaaaa, 0x333333, 0x0000ff, 0x00aa00]; const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4), new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)] })); sedan.add(body); const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.5), new THREE.MeshStandardMaterial({ color: 0x333333 })); cabin.position.set(0, 0.75, -0.25); sedan.add(cabin); const wheelPositions = [ {x: 1, z: 1.5}, {x: -1, z: 1.5}, {x: 1, z: -1.5}, {x: -1, z: -1.5}, ]; wheelPositions.forEach(pos => { const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial); wheel.position.set(pos.x, -0.1, pos.z); sedan.add(wheel); }); sedan.position.y = 0.4; return sedan; }

        const vehicleCreators = [createBus, createMotorcycle, createSportsCar, createTruck, createSedan];
        const aiCars: AiCar[] = [];
        const numVehicles = THREE.MathUtils.randInt(10, 20);

        for (let i = 0; i < numVehicles; i++) {
            const creator = vehicleCreators[Math.floor(Math.random() * vehicleCreators.length)];
            const mesh = creator();
            mesh.userData.type = 'aiCar'; // Identify this as an AI vehicle
            
            const isVertical = Math.random() > 0.5;
            const roadIndex = Math.floor(Math.random() * gridSize);
            const position = THREE.MathUtils.randFloat(-groundSize/2, groundSize/2);
            const speed = THREE.MathUtils.randFloat(0.1, 0.15);
            
            let velocity = new THREE.Vector3();
            if (isVertical) {
                mesh.position.x = roadNetwork.x[roadIndex] + (Math.random() > 0.5 ? -streetWidth/4 : streetWidth/4);
                mesh.position.z = position;
                velocity.z = Math.random() > 0.5 ? speed : -speed;
            } else {
                mesh.position.x = position;
                mesh.position.z = roadNetwork.z[roadIndex] + (Math.random() > 0.5 ? -streetWidth/4 : streetWidth/4);
                velocity.x = Math.random() > 0.5 ? speed : -speed;
            }
            mesh.rotation.y = Math.atan2(velocity.x, velocity.z);
            
            aiCars.push({ 
                mesh, 
                velocity, 
                speed, 
                targetAngle: mesh.rotation.y, 
                isTurning: false,
                state: 'driving',
                hitVelocity: new THREE.Vector3()
            });
            scene.add(mesh);
            collidables.push(mesh);
        }

        // Car Model
        const car = new THREE.Group();
        scene.add(car);
        car.position.set(0, 0.4, 10);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0077ff, roughness: 0.5, metalness: 0.3 });
        const carBody = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4), bodyMaterial);
        carBody.castShadow = true;
        car.add(carBody);
        const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2, transparent: true, opacity: 0.8 });
        const carCabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.5), cabinMaterial);
        carCabin.position.set(0, 0.75, -0.25);
        carCabin.castShadow = true;
        car.add(carCabin);
        const playerWheels: THREE.Mesh[] = [];
        const wheelPositions = [ new THREE.Vector3(1, -0.1, 1.5), new THREE.Vector3(-1, -0.1, 1.5), new THREE.Vector3(1, -0.1, -1.5), new THREE.Vector3(-1, -0.1, -1.5), ];
        wheelPositions.forEach(pos => { const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial); wheel.position.copy(pos); wheel.castShadow = true; car.add(wheel); playerWheels.push(wheel); });
        let speed = 0, acceleration = 0.02, maxSpeed = 0.5, friction = 0.01, turnSpeed = 0.03;

        // --- Load sounds and initialize audio ---
        const initAudio = async () => {
            for (const key in soundUrls) {
                const buffer = await audioLoader.loadAsync(soundUrls[key]);
                audioBuffersRef.current[key] = buffer;
            }
            soundsReady = true;

            // Start looping ambient sound
            const cityBuffer = audioBuffersRef.current.city;
            if (cityBuffer) {
                const citySound = new THREE.Audio(listener);
                citySound.setBuffer(cityBuffer);
                citySound.setLoop(true);
                citySound.setVolume(0.3);
                citySound.play();
            }

            // Start player engine sound
            const playerEngineBuffer = audioBuffersRef.current.playerEngine;
            if (playerEngineBuffer) {
                const engineSound = new THREE.PositionalAudio(listener);
                engineSound.setBuffer(playerEngineBuffer);
                engineSound.setLoop(true);
                engineSound.setVolume(0);
                engineSound.setRefDistance(5);
                car.add(engineSound);
                engineSound.play();
                playerEngineSoundRef.current = engineSound;
            }
            
            // Start AI engine sounds
            const aiEngineBuffer = audioBuffersRef.current.aiEngine;
            if (aiEngineBuffer) {
                aiCars.forEach(ai => {
                    const sound = new THREE.PositionalAudio(listener);
                    sound.setBuffer(aiEngineBuffer);
                    sound.setLoop(true);
                    sound.setVolume(0.4);
                    sound.setRefDistance(10);
                    sound.setRolloffFactor(2);
                    ai.mesh.add(sound);
                    sound.play();
                });
            }
        };
        initAudio();


        const createExplosion = (position: THREE.Vector3) => {
            const explosionMaterial = new THREE.MeshBasicMaterial({
                color: 0xffa500,
                transparent: true,
                opacity: 0.8
            });
            const explosionGeometry = new THREE.SphereGeometry(0.5, 16, 16);
            const explosionMesh = new THREE.Mesh(explosionGeometry, explosionMaterial);
            explosionMesh.position.copy(position);
            scene.add(explosionMesh);
            explosions.push({ mesh: explosionMesh, lifetime: 0.5 });
        };

        const fireMissile = () => {
            if (missileCooldown > 0) return;
            missileCooldown = MISSILE_COOLDOWN_TIME;
            
            if(soundsReady && audioBuffersRef.current.missile) {
                playNonPositionalSound(audioBuffersRef.current.missile, 0.9);
            }
    
            const missile = new THREE.Group();
            const missileBodyMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8 });
            const missileBodyGeom = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8);
            const missileBody = new THREE.Mesh(missileBodyGeom, missileBodyMat);
            missile.add(missileBody);
    
            const missileConeMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
            const missileConeGeom = new THREE.ConeGeometry(0.15, 0.5, 8);
            const missileCone = new THREE.Mesh(missileConeGeom, missileConeMat);
            missileCone.position.y = 1;
            missile.add(missileCone);
    
            const missileSpeed = 2.0;
            const velocity = new THREE.Vector3(-Math.sin(car.rotation.y), 0, -Math.cos(car.rotation.y)).multiplyScalar(missileSpeed + Math.abs(speed));
            
            const spawnOffset = new THREE.Vector3(0, 0, -3);
            spawnOffset.applyQuaternion(car.quaternion);
            missile.position.copy(car.position).add(spawnOffset);
            missile.position.y = 1; 
    
            missile.rotation.copy(car.rotation);
            missile.rotateX(Math.PI / 2); 
    
            scene.add(missile);
            missiles.push({ mesh: missile, velocity, lifetime: 5 });
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === ' ') {
                fireMissile();
                e.preventDefault();
            } else {
                keysRef.current[e.key.toLowerCase().replace('arrow','')] = true;
            }
        };
        const onKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase().replace('arrow','')] = false; };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        const onResize = () => { if (!currentMount) return; camera.aspect = currentMount.clientWidth / currentMount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(currentMount.clientWidth, currentMount.clientHeight); };
        window.addEventListener('resize', onResize);
        
        const clock = new THREE.Clock();

        const animate = () => {
            requestAnimationFrame(animate);
            const delta = clock.getDelta();

            if (missileCooldown > 0) missileCooldown -= delta;

            const k = keysRef.current;
            const isMovingForward = k.w || k.up;
            const isMovingBackward = k.s || k.down;
            const isTurningLeft = k.a || k.left;
            const isTurningRight = k.d || k.right;
            
            if (isMovingForward) speed = Math.min(speed + acceleration, maxSpeed);
            else if (isMovingBackward) speed = Math.max(speed - acceleration, -maxSpeed / 2);
            else {
                if (speed > 0) speed = Math.max(0, speed - friction);
                if (speed < 0) speed = Math.min(0, speed + friction);
            }
            if (Math.abs(speed) > 0.01) {
                const turnDirection = speed > 0 ? 1 : -1;
                if (isTurningLeft) car.rotation.y += turnSpeed * turnDirection;
                if (isTurningRight) car.rotation.y -= turnSpeed * turnDirection;
            }
            
            const prevPosition = car.position.clone();
            car.position.x -= Math.sin(car.rotation.y) * speed;
            car.position.z -= Math.cos(car.rotation.y) * speed;

            // Update player engine sound
            if (playerEngineSoundRef.current) {
                const speedRatio = Math.abs(speed) / maxSpeed;
                playerEngineSoundRef.current.setPlaybackRate(0.8 + speedRatio * 1.4);
                playerEngineSoundRef.current.setVolume(speedRatio * 0.7);
            }
            
            // AI Car Logic
            const cityLimit = groundSize / 2 + streetWidth;
            aiCars.forEach(ai => {
                if (ai.state === 'hit') {
                    ai.mesh.position.add(ai.hitVelocity);
                    ai.hitVelocity.y -= 0.05; // gravity
                    ai.mesh.rotation.x += ai.hitVelocity.x * 0.2;
                    ai.mesh.rotation.z += ai.hitVelocity.z * 0.2;
                    return;
                }

                const intersectionThreshold = 1.0;
                let atIntersection = false;
                for(const x of roadNetwork.x) {
                    for(const z of roadNetwork.z) {
                        if(ai.mesh.position.distanceTo(new THREE.Vector3(x, ai.mesh.position.y, z)) < intersectionThreshold) {
                            atIntersection = true;
                            break;
                        }
                    }
                    if(atIntersection) break;
                }
                
                if (atIntersection && !ai.isTurning) {
                    ai.isTurning = true;
                    const choice = Math.random();
                    if (choice < 0.25) { // Turn left
                        ai.targetAngle += Math.PI / 2;
                    } else if (choice < 0.5) { // Turn right
                        ai.targetAngle -= Math.PI / 2;
                    } // 50% chance to go straight, do nothing to angle
                } else if (!atIntersection) {
                    ai.isTurning = false;
                }
                
                ai.mesh.rotation.y = THREE.MathUtils.lerp(ai.mesh.rotation.y, ai.targetAngle, 0.1);
                
                if (Math.abs(ai.mesh.rotation.y - ai.targetAngle) < 0.05) {
                    ai.mesh.rotation.y = ai.targetAngle;
                    ai.velocity.set(Math.sin(ai.targetAngle), 0, Math.cos(ai.targetAngle)).multiplyScalar(ai.speed);
                }

                ai.mesh.position.add(ai.velocity);

                 // World Wrap
                if (ai.mesh.position.x > cityLimit) ai.mesh.position.x = -cityLimit;
                if (ai.mesh.position.x < -cityLimit) ai.mesh.position.x = cityLimit;
                if (ai.mesh.position.z > cityLimit) ai.mesh.position.z = -cityLimit;
                if (ai.mesh.position.z < -cityLimit) ai.mesh.position.z = cityLimit;
            });
            
            // Pedestrian Logic
            pedestrians.forEach(p => {
                const carDist = p.mesh.position.distanceTo(car.position);

                switch(p.state) {
                    case 'idle':
                        p.idleTimer -= delta;
                        if(p.idleTimer <= 0) {
                            p.state = 'walking';
                            p.destination = getRandomSidewalkPoint();
                        }
                        // Animate idle
                        p.animationPhase += delta * 0.5;
                        (p.mesh.getObjectByName('leftArm') as THREE.Mesh).rotation.x = Math.sin(p.animationPhase) * 0.1;
                        (p.mesh.getObjectByName('rightArm') as THREE.Mesh).rotation.x = -Math.sin(p.animationPhase) * 0.1;
                        break;
                    
                    case 'walking':
                        if (carDist < 3) { // Avoidance
                            break;
                        }

                        const dir = p.destination.clone().sub(p.mesh.position).normalize();
                        p.mesh.position.x += dir.x * p.speed;
                        p.mesh.position.z += dir.z * p.speed;
                        p.mesh.rotation.y = Math.atan2(dir.x, dir.z);

                        // Animate walking
                        p.animationPhase += p.speed * 20;
                        const swingAngle = Math.sin(p.animationPhase) * 0.8;
                        (p.mesh.getObjectByName('leftArm') as THREE.Mesh).rotation.x = swingAngle;
                        (p.mesh.getObjectByName('rightArm') as THREE.Mesh).rotation.x = -swingAngle;
                        (p.mesh.getObjectByName('leftLeg') as THREE.Mesh).rotation.x = -swingAngle;
                        (p.mesh.getObjectByName('rightLeg') as THREE.Mesh).rotation.x = swingAngle;
                        p.mesh.position.y = p.baseY + Math.abs(Math.sin(p.animationPhase * 0.5)) * 0.05;


                        if(p.mesh.position.distanceTo(p.destination) < 1) {
                            p.state = 'idle';
                            p.idleTimer = THREE.MathUtils.randFloat(2, 5);
                        }
                        break;
                    
                    case 'hit':
                        p.mesh.position.add(p.hitVelocity);
                        p.hitVelocity.y -= 0.02; // gravity
                        p.mesh.rotation.x += 0.1;
                        p.mesh.rotation.z += 0.1;
                        if (p.mesh.position.y < -5 || p.mesh.position.distanceTo(car.position) > 40) {
                            // Reset pedestrian
                            const newPos = getRandomSidewalkPoint();
                            p.mesh.position.set(newPos.x, p.baseY, newPos.z);
                            p.mesh.rotation.set(0, 0, 0);
                            p.state = 'idle';
                            p.idleTimer = THREE.MathUtils.randFloat(2, 5);
                        }
                        break;
                }
            });

            // Missile Logic
            for (let i = missiles.length - 1; i >= 0; i--) {
                const missile = missiles[i];
                missile.mesh.position.add(missile.velocity);
                missile.lifetime -= delta;

                let hit = false;
                const missileBox = new THREE.Box3().setFromObject(missile.mesh);

                for (const obj of collidables) {
                    if (!obj.parent) continue;
                    const objBox = new THREE.Box3().setFromObject(obj);

                    if (missileBox.intersectsBox(objBox)) {
                        createExplosion(missile.mesh.position);
                        hit = true;

                        if (obj.userData.type === 'aiCar') {
                            const targetCar = aiCars.find(c => c.mesh === obj);
                            if (targetCar && targetCar.state === 'driving') {
                               targetCar.state = 'hit';
                               targetCar.hitVelocity.copy(missile.velocity).normalize().multiplyScalar(0.5).add(new THREE.Vector3(0, 1.5, 0));
                               if (soundsReady && audioBuffersRef.current.vehicleHit) {
                                   playPositionalSound(audioBuffersRef.current.vehicleHit, missile.mesh.position);
                               }
                               setScore(prev => prev + 1);
                            }
                        }
                        break;
                    }
                }

                if (hit) {
                    scene.remove(missile.mesh);
                    missiles.splice(i, 1);
                    continue;
                }

                for (const p of pedestrians) {
                    if (p.state === 'hit') continue;
                    const pBox = new THREE.Box3().setFromObject(p.mesh);
                    if (missileBox.intersectsBox(pBox)) {
                        createExplosion(missile.mesh.position);
                        hit = true;
                        p.state = 'hit';
                        const impactDir = p.mesh.position.clone().sub(missile.mesh.position).normalize();
                        p.hitVelocity.copy(impactDir).multiplyScalar(1.0).add(new THREE.Vector3(0, 1.0, 0));
                        if(soundsReady && audioBuffersRef.current.pedestrianHit) {
                            playPositionalSound(audioBuffersRef.current.pedestrianHit, missile.mesh.position);
                        }
                        setScore(prev => prev + 1);
                        break;
                    }
                }
                
                if (hit || missile.lifetime <= 0) {
                    if(!hit) createExplosion(missile.mesh.position);
                    scene.remove(missile.mesh);
                    missiles.splice(i, 1);
                }
            }

            // Explosion Logic
            for (let i = explosions.length - 1; i >= 0; i--) {
                const explosion = explosions[i];
                explosion.mesh.scale.x += 0.5;
                explosion.mesh.scale.y += 0.5;
                explosion.mesh.scale.z += 0.5;
                (explosion.mesh.material as THREE.MeshBasicMaterial).opacity -= delta * 2.0;

                explosion.lifetime -= delta;
                if (explosion.lifetime <= 0) {
                    scene.remove(explosion.mesh);
                    explosions.splice(i, 1);
                }
            }

            const worldBoundary = worldSize / 2 - 10;
            if (Math.abs(car.position.x) > worldBoundary || Math.abs(car.position.z) > worldBoundary) {
                car.position.copy(prevPosition);
                speed = 0;
            }

            // Collision Detection
            const carBox = new THREE.Box3().setFromObject(car);

            // Check against static collidables and AI cars
            for(const obj of collidables) {
                const aiCar = aiCars.find(c => c.mesh === obj);
                if (aiCar && aiCar.state === 'hit') continue; // Don't collide with flying cars
                
                const objBox = new THREE.Box3().setFromObject(obj);
                if(carBox.intersectsBox(objBox)){
                    car.position.copy(prevPosition);
                    speed = 0;
                    break;
                }
            }

            // Check against pedestrians separately for hit reaction
            for (const p of pedestrians) {
                if (p.state === 'hit') continue;
                const pBox = new THREE.Box3().setFromObject(p.mesh);
                if (carBox.intersectsBox(pBox)) {
                    p.state = 'hit';
                    const impactDir = p.mesh.position.clone().sub(car.position).normalize();
                    p.hitVelocity.copy(impactDir).multiplyScalar(Math.abs(speed) * 2 + 0.2).add(new THREE.Vector3(0, 0.4, 0));
                    
                    if(soundsReady && audioBuffersRef.current.pedestrianHit) {
                        playPositionalSound(audioBuffersRef.current.pedestrianHit, p.mesh.position);
                    }
                    
                    setScore(prev => prev + 1);
                    car.position.copy(prevPosition); // Stop car on impact
                    speed *= -0.5; // Bounce back
                    break;
                }
            }


            playerWheels.forEach(w => w.rotation.x -= speed * 0.5);
            
            const cameraOffset = new THREE.Vector3(0, 8, 15);
            const cameraPosition = cameraOffset.applyMatrix4(car.matrixWorld);
            camera.position.lerp(cameraPosition, 0.1);
            directionalLight.target.position.copy(car.position);
            const lightPos = car.position.clone().add(new THREE.Vector3(50, 80, 25));
            directionalLight.position.copy(lightPos);
            camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 2, 0)));

            renderer.render(scene, camera);
        };
        animate();
        
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('resize', onResize);
            if(listenerRef.current) listenerRef.current.context.close();
            currentMount.removeChild(renderer.domElement);
        };
    }, []);

    return (
        <div className="relative w-full h-screen bg-sky-400 overflow-hidden">
            <div ref={mountRef} className="w-full h-full" />
            <div className="absolute top-4 left-4 text-white bg-black bg-opacity-50 p-4 rounded-lg shadow-lg font-mono">
                <h1 className="text-xl font-bold mb-2 text-cyan-300">3D Car Simulator</h1>
                <p className="text-lg font-bold text-green-400 mb-2">Score: {score}</p>
                <p className="text-sm"><span className="font-bold text-yellow-300">W/S or ↑/↓</span>: Accelerate/Brake</p>
                <p className="text-sm"><span className="font-bold text-yellow-300">A/D or ←/→</span>: Steer</p>
                <p className="text-sm"><span className="font-bold text-yellow-300">Spacebar</span>: Fire Missile</p>
                <p className="mt-2 text-sm text-gray-300">Explore the lively city or venture out onto the mountain pass!</p>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    return <CarSimulator />;
}

export default App;
