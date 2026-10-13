import * as THREE from 'three';
import './style.css';

type VehicleType = 'sport' | 'muscle' | 'sedan';

type MissionState = {
  title: string;
  description: string;
  reward: number;
};

type SaveData = {
  money: number;
  missionIndex: number;
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#8eb8d9');
scene.fog = new THREE.Fog('#8eb8d9', 35, 175);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 6, 14);

const clock = new THREE.Clock();
const keys: Record<string, boolean> = {};
const world = { width: 180, height: 180 };
const buildings: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
const cars: Vehicle[] = [];
const policeCars: PoliceCar[] = [];
const pedestrians: Pedestrian[] = [];
const missionMarkers: THREE.Group[] = [];
const saveKey = 'maniac-city-save-v1';

const menuEl = document.getElementById('menu') as HTMLDivElement;
const settingsPanelEl = document.getElementById('settingsPanel') as HTMLDivElement;
const pauseMenuEl = document.getElementById('pauseMenu') as HTMLDivElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const healthBarEl = document.getElementById('healthBar') as HTMLDivElement;
const healthTextEl = document.getElementById('healthText') as HTMLSpanElement;
const cashTextEl = document.getElementById('cashText') as HTMLDivElement;
const wantedTextEl = document.getElementById('wantedText') as HTMLDivElement;
const missionTitleEl = document.getElementById('missionTitle') as HTMLSpanElement;
const missionTextEl = document.getElementById('missionText') as HTMLDivElement;
const vehiclePromptEl = document.getElementById('vehiclePrompt') as HTMLDivElement;
const missionBannerEl = document.getElementById('missionBanner') as HTMLDivElement;
const miniCanvas = document.getElementById('miniCanvas') as HTMLCanvasElement;
const audioInputEl = document.getElementById('audioVolume') as HTMLInputElement;
const sensitivityInputEl = document.getElementById('mouseSensitivity') as HTMLInputElement;

const game = {
  started: false,
  paused: false,
  missionIndex: 0,
  objectiveText: 'Drive to the waypoint in the city.',
  cash: 1500,
  wanted: 0,
  mouseSensitivity: 1,
  soundVolume: 0.7,
  missionRewardAwarded: false,
};

const player = {
  position: new THREE.Vector3(0, 1.4, 30),
  velocity: new THREE.Vector3(),
  yaw: 0,
  pitch: 0.6,
  health: 100,
  ammo: 12,
  reserveAmmo: 72,
  reloadTimer: 0,
  fireCooldown: 0,
  inVehicle: false,
  vehicle: null as Vehicle | null,
  sprinting: false,
  jumpVelocity: 0,
};

const missions: MissionState[] = [
  { title: 'First Ride', description: 'Enter a vehicle and drive to the marked destination.', reward: 300 },
  { title: 'The Pickup', description: 'Collect the package and escape the rival gang.', reward: 600 },
  { title: 'Heat on the Streets', description: 'Survive the police chase and reach the safehouse.', reward: 900 },
];

const sunlight = new THREE.DirectionalLight('#ffe7b3', 1.5);
sunlight.position.set(30, 42, 18);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
scene.add(sunlight);

scene.add(new THREE.HemisphereLight('#d9f0ff', '#10202a', 1.1));

const playerMesh = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.52, 1.2, 4, 10),
  new THREE.MeshStandardMaterial({ color: '#5fb2ff' })
);
body.position.y = 1.1;
body.castShadow = true;
playerMesh.add(body);

const head = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 16, 16),
  new THREE.MeshStandardMaterial({ color: '#e8c49c' })
);
head.position.y = 2.12;
head.castShadow = true;
playerMesh.add(head);

const gun = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 0.18, 0.18),
  new THREE.MeshStandardMaterial({ color: '#1c2430', metalness: 0.8, roughness: 0.3 })
);
gun.position.set(0.72, 1.2, 0.45);
playerMesh.add(gun);
scene.add(playerMesh);

function hideMenu() {
  menuEl.classList.add('hidden');
  settingsPanelEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
}

function showMenu() {
  menuEl.classList.remove('hidden');
  hudEl.classList.add('hidden');
}

function setBanner(text: string) {
  missionBannerEl.textContent = text;
  missionBannerEl.classList.remove('hidden');
  clearTimeout((setBanner as any)._timer);
  (setBanner as any)._timer = setTimeout(() => missionBannerEl.classList.add('hidden'), 2000);
}

function updateHud() {
  const healthRatio = THREE.MathUtils.clamp(player.health / 100, 0, 1);
  healthBarEl.style.width = `${healthRatio * 100}%`;
  healthTextEl.textContent = `${Math.max(0, Math.ceil(player.health))} / 100`;
  cashTextEl.textContent = `$${game.cash}`;
  wantedTextEl.textContent = Array.from({ length: 5 }, (_, i) => (i < game.wanted ? '★' : '☆')).join('');
  missionTitleEl.textContent = missions[game.missionIndex]?.title ?? 'Free Roam';
  missionTextEl.textContent = game.objectiveText || missions[game.missionIndex]?.description || 'Explore the city.';
}

function saveGame() {
  const data: SaveData = {
    money: game.cash,
    missionIndex: game.missionIndex,
  };
  localStorage.setItem(saveKey, JSON.stringify(data));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return;
    const data = JSON.parse(raw) as SaveData;
    game.cash = data.money ?? game.cash;
    game.missionIndex = data.missionIndex ?? game.missionIndex;
  } catch {
    // ignore invalid save
  }
}

function addBuilding(x: number, z: number, w: number, d: number, h: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08, 0.18, 0.48 + Math.random() * 0.16),
    })
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  buildings.push({ x, z, w, d, h });
  scene.add(mesh);
}

function createGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(world.width, world.height),
    new THREE.MeshStandardMaterial({ color: '#416c46', roughness: 0.92 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMaterial = new THREE.MeshStandardMaterial({ color: '#2a2d32', roughness: 0.85 });
  const sideMaterial = new THREE.MeshStandardMaterial({ color: '#49515d', roughness: 0.9 });

  const roads = [
    { x: 0, z: 0, w: 180, d: 18 },
    { x: 0, z: 24, w: 18, d: 180 },
    { x: -34, z: -34, w: 18, d: 180 },
    { x: 34, z: 0, w: 18, d: 180 },
    { x: 0, z: -34, w: 180, d: 18 },
  ];

  roads.forEach((r) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.16, r.d), roadMaterial);
    road.position.set(r.x, 0.08, r.z);
    road.receiveShadow = true;
    scene.add(road);

    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(r.w + 4, 0.12, r.d + 4), sideMaterial);
    sidewalk.position.set(r.x, 0.02, r.z);
    scene.add(sidewalk);
  });

  const blockDefs: Array<[number, number, number, number]> = [
    [-60, -56, 16, 16], [-60, 0, 18, 18], [-60, 58, 16, 15],
    [-20, -60, 20, 20], [-20, 10, 20, 20], [-20, 64, 18, 18],
    [18, -56, 16, 18], [18, 14, 18, 18], [18, 62, 18, 18],
    [58, -50, 14, 18], [58, 18, 14, 18], [58, 62, 15, 15],
  ];

  blockDefs.forEach(([x, z, w, d]) => {
    const h = 10 + Math.random() * 16;
    addBuilding(x, z, w, d, h);
  });

  const lampPoints = [
    [-38, 0], [-18, 24], [0, 18], [22, 18], [50, -6], [0, -38],
  ] as const;

  lampPoints.forEach(([lx, lz]) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 5, 12),
      new THREE.MeshStandardMaterial({ color: '#a0b7d3', metalness: 0.75, roughness: 0.3 })
    );
    pole.position.set(lx, 2.6, lz);
    pole.castShadow = true;
    scene.add(pole);

    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.5),
      new THREE.MeshStandardMaterial({ color: '#ffe3a2', emissive: '#ffd476', emissiveIntensity: 0.8 })
    );
    lamp.position.set(lx, 5.15, lz);
    scene.add(lamp);
  });
}

class Vehicle {
  mesh: THREE.Group;
  type: VehicleType;
  speed: number;
  steering: number;
  heading: number;
  occupied: boolean;
  health: number;
  maxSpeed: number;
  acceleration: number;
  turnRate: number;

  constructor(x: number, z: number, type: VehicleType, color: string) {
    this.type = type;
    this.speed = 0;
    this.steering = 0;
    this.heading = 0;
    this.occupied = false;
    this.health = 100;
    this.maxSpeed = 24;
    this.acceleration = 18;
    this.turnRate = 1.2;
    this.mesh = new THREE.Group();

    if (type === 'sport') {
      this.maxSpeed = 28;
      this.acceleration = 20;
      this.turnRate = 1.5;
    } else if (type === 'muscle') {
      this.maxSpeed = 22;
      this.acceleration = 16;
      this.turnRate = 1.18;
    }

    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 4.3), bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    this.mesh.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.8, 2.2),
      new THREE.MeshStandardMaterial({ color: '#dfe7ff', transparent: true, opacity: 0.7 })
    );
    cabin.position.set(0, 1.35, -0.2);
    cabin.castShadow = true;
    this.mesh.add(cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#111' });
    for (const [xoff, zoff] of [[-1.2, 1.4], [1.2, 1.4], [-1.2, -1.4], [1.2, -1.4]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(xoff, 0.45, zoff);
      wheel.castShadow = true;
      this.mesh.add(wheel);
    }

    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = this.heading;
    scene.add(this.mesh);
  }

  update(dt: number) {
    if (this.occupied) {
      const drive = Number(keys['KeyW']) - Number(keys['KeyS']);
      const steer = Number(keys['KeyD']) - Number(keys['KeyA']);
      const boost = keys['ShiftLeft'] || keys['ShiftRight'];
      const targetSpeed = drive * (boost ? this.maxSpeed * 1.2 : this.maxSpeed);
      this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, dt * 2.6);
      if (Math.abs(this.speed) > 0.4) {
        this.heading += steer * this.turnRate * dt * (0.8 + Math.abs(this.speed) / this.maxSpeed);
      }
      if (keys['Space']) {
        this.speed *= 0.92;
      }
      this.mesh.position.x += Math.sin(this.heading) * this.speed * dt;
      this.mesh.position.z += Math.cos(this.heading) * this.speed * dt;
      this.mesh.rotation.y = this.heading;
    } else {
      this.speed *= 0.97;
      this.mesh.position.x += Math.sin(this.heading) * this.speed * dt;
      this.mesh.position.z += Math.cos(this.heading) * this.speed * dt;
      this.mesh.rotation.y = this.heading;
    }

    this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -80, 80);
    this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -80, 80);

    // building collision
    for (const b of buildings) {
      const dx = this.mesh.position.x - b.x;
      const dz = this.mesh.position.z - b.z;
      const halfW = b.w / 2 + 2.4;
      const halfD = b.d / 2 + 2.4;
      if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
        this.mesh.position.x -= Math.sign(dx || 1) * 0.6;
        this.mesh.position.z -= Math.sign(dz || 1) * 0.6;
        this.speed *= -0.22;
      }
    }
  }
}

class Pedestrian {
  mesh: THREE.Group;
  heading: number;
  speed: number;
  timer: number;

  constructor(x: number, z: number, color: string) {
    this.mesh = new THREE.Group();
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 1.5 + Math.random() * 1.2;
    this.timer = 1 + Math.random() * 3;

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.5, 0.4), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 1.15;
    body.castShadow = true;
    this.mesh.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshStandardMaterial({ color: '#f0d0a8' }));
    head.position.y = 2.25;
    head.castShadow = true;
    this.mesh.add(head);

    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.heading += (Math.random() - 0.5) * 2.4;
      this.timer = 2 + Math.random() * 3;
    }

    this.mesh.position.x += Math.sin(this.heading) * this.speed * dt;
    this.mesh.position.z += Math.cos(this.heading) * this.speed * dt;
    this.mesh.rotation.y = this.heading;

    if (Math.abs(this.mesh.position.x) > 82 || Math.abs(this.mesh.position.z) > 82) {
      this.heading += Math.PI / 2;
    }
  }
}

class PoliceCar extends Vehicle {
  constructor(x: number, z: number) {
    super(x, z, 'sedan', '#38a4ff');
    this.maxSpeed = 21;
    this.acceleration = 15;
    this.turnRate = 1.35;
  }

  chasePlayer(dt: number) {
    const target = player.vehicle ? player.vehicle.mesh.position.clone() : player.position.clone();
    const dir = new THREE.Vector3(target.x - this.mesh.position.x, 0, target.z - this.mesh.position.z);
    if (dir.lengthSq() > 0.01) {
      const desired = Math.atan2(dir.x, dir.z);
      this.heading = THREE.MathUtils.lerp(this.heading, desired, dt * 2.2);
    }
    this.speed = THREE.MathUtils.lerp(this.speed, 20, dt * 2.2);
    this.mesh.position.x += Math.sin(this.heading) * this.speed * dt;
    this.mesh.position.z += Math.cos(this.heading) * this.speed * dt;
    this.mesh.rotation.y = this.heading;
  }
}

function addVehicle(x: number, z: number, type: VehicleType, color: string) {
  const v = new Vehicle(x, z, type, color);
  cars.push(v);
  return v;
}

function addPedestrian(x: number, z: number, color: string) {
  const p = new Pedestrian(x, z, color);
  pedestrians.push(p);
  return p;
}

function addPoliceVehicle(x: number, z: number) {
  const p = new PoliceCar(x, z);
  policeCars.push(p);
  return p;
}

function spawnCity() {
  createGround();
  addVehicle(-12, 0, 'sport', '#f95738');
  addVehicle(18, 18, 'muscle', '#5ec8ff');
  addVehicle(-24, -18, 'sedan', '#7ef0a8');
  addVehicle(28, -30, 'sport', '#f4d35e');
  addVehicle(-42, 28, 'sedan', '#e899ff');

  addPoliceVehicle(-55, -28);
  addPoliceVehicle(52, -40);

  for (let i = 0; i < 16; i++) {
    const x = -70 + Math.random() * 140;
    const z = -70 + Math.random() * 140;
    if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
    addPedestrian(x, z, i % 2 === 0 ? '#e7bf8b' : '#88a4ff');
  }
}

const missionWaypoints = [
  new THREE.Vector3(40, 0, -35),
  new THREE.Vector3(-58, 0, 40),
  new THREE.Vector3(50, 0, 45),
];

let packageCrate: THREE.Mesh | null = null;
let safehouse: THREE.Mesh | null = null;

function makeMarker(position: THREE.Vector3, color: string) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.12, 12, 36),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 2, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })
  );
  pole.position.y = 1;
  group.add(pole);

  group.position.copy(position);
  group.visible = false;
  scene.add(group);
  missionMarkers.push(group);
}

function createMissionMarkers() {
  makeMarker(missionWaypoints[0], '#ffd166');
  makeMarker(missionWaypoints[1], '#ff8c42');
  makeMarker(missionWaypoints[2], '#65d98d');
}

function setupMission(index: number) {
  game.missionIndex = index;
  game.objectiveText = missions[index]?.description ?? 'Explore the city.';
  if (packageCrate) packageCrate.visible = false;
  if (safehouse) safehouse.visible = false;

  missionMarkers.forEach((marker) => marker.visible = false);

  if (index === 0) {
    setBanner('Mission: First Ride');
    missionMarkers[0].visible = true;
    game.wanted = 0;
  }

  if (index === 1) {
    setBanner('Mission: The Pickup');
    if (!packageCrate) {
      packageCrate = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.6, 1.6),
        new THREE.MeshStandardMaterial({ color: '#ff8f5b', emissive: '#ff8f5b', emissiveIntensity: 0.46 })
      );
      packageCrate.position.copy(missionWaypoints[1]);
      packageCrate.castShadow = true;
      scene.add(packageCrate);
    }
    packageCrate.visible = true;
    missionMarkers[1].visible = true;
    game.wanted = 2;
  }

  if (index === 2) {
    setBanner('Mission: Heat on the Streets');
    if (!safehouse) {
      safehouse = new THREE.Mesh(
        new THREE.BoxGeometry(5, 3, 5),
        new THREE.MeshStandardMaterial({ color: '#6fe4aa', emissive: '#6fe4aa', emissiveIntensity: 0.4 })
      );
      safehouse.position.copy(missionWaypoints[2]);
      safehouse.position.y = 1.5;
      safehouse.castShadow = true;
      scene.add(safehouse);
    }
    safehouse.visible = true;
    missionMarkers[2].visible = true;
    game.wanted = 3;
  }

  updateHud();
}

function completeMission() {
  const reward = missions[game.missionIndex]?.reward ?? 0;
  game.cash += reward;
  setBanner(`Mission complete! +$${reward}`);
  game.missionIndex += 1;
  if (game.missionIndex >= missions.length) {
    game.missionIndex = missions.length - 1;
    game.objectiveText = 'All story missions complete. Free roam remains open.';
    setBanner('City cleared. Free roam unlocked.');
  } else {
    setupMission(game.missionIndex);
  }
  saveGame();
  updateHud();
}

function findNearestVehicle() {
  let target: Vehicle | null = null;
  let minDist = Number.POSITIVE_INFINITY;
  cars.forEach((car) => {
    if (car.occupied) return;
    const dist = car.mesh.position.distanceTo(player.position);
    if (dist < minDist) {
      minDist = dist;
      target = car;
    }
  });
  return target;
}

function enterVehicle() {
  if (player.inVehicle && player.vehicle) {
    const car = player.vehicle;
    player.inVehicle = false;
    car.occupied = false;
    player.vehicle = null;
    player.position.copy(car.mesh.position).add(new THREE.Vector3(Math.sin(car.heading + Math.PI / 2) * 2.6, 1.2, Math.cos(car.heading + Math.PI / 2) * 2.6));
    playerMesh.position.copy(player.position);
    playerMesh.visible = true;
    return;
  }

  const nearest = findNearestVehicle();
  if (!nearest || nearest.mesh.position.distanceTo(player.position) > 5.5) return;

  nearest.occupied = true;
  player.vehicle = nearest;
  player.inVehicle = true;
  playerMesh.visible = false;
  player.position.copy(nearest.mesh.position);
  setBanner('Vehicle acquired');
}

function handleInteraction() {
  if (player.inVehicle) {
    enterVehicle();
    return;
  }
  if (findNearestVehicle() && findNearestVehicle()!.mesh.position.distanceTo(player.position) < 5.5) {
    enterVehicle();
  }
}

function updatePlayer(dt: number) {
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();

  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);
  if (keys['KeyA']) move.sub(right);
  if (keys['KeyD']) move.add(right);

  player.sprinting = !!(keys['ShiftLeft'] || keys['ShiftRight']);

  if (!player.inVehicle) {
    if (move.lengthSq() > 0) {
      move.normalize();
      const speed = player.sprinting ? 9.5 : 6.2;
      player.position.addScaledVector(move, speed * dt);
      player.yaw = Math.atan2(move.x, move.z);
    }

    if (keys['Space'] && player.position.y <= 1.4) {
      player.jumpVelocity = 6.8;
    }
    player.jumpVelocity -= 18 * dt;
    player.position.y += player.jumpVelocity * dt;
    if (player.position.y < 1.4) {
      player.position.y = 1.4;
      player.jumpVelocity = 0;
    }

    for (const b of buildings) {
      const dx = player.position.x - b.x;
      const dz = player.position.z - b.z;
      const halfW = b.w / 2 + 1.1;
      const halfD = b.d / 2 + 1.1;
      if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
        player.position.x -= Math.sign(dx || 1) * 0.25;
        player.position.z -= Math.sign(dz || 1) * 0.25;
      }
    }

    player.position.x = THREE.MathUtils.clamp(player.position.x, -82, 82);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -82, 82);
    playerMesh.position.copy(player.position);
    playerMesh.rotation.y = player.yaw;
  } else if (player.vehicle) {
    player.vehicle.update(dt);
    player.position.copy(player.vehicle.mesh.position);
    player.position.y = 1.2;
  }
}

function fireWeapon() {
  if (player.fireCooldown > 0 || player.reloadTimer > 0) return;
  if (player.ammo <= 0) {
    if (player.reserveAmmo > 0) {
      player.reloadTimer = 1.1;
    }
    return;
  }

  player.ammo -= 1;
  player.fireCooldown = 0.18;

  const source = player.inVehicle ? player.vehicle!.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : player.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const direction = new THREE.Vector3(Math.sin(player.yaw), 0.12, Math.cos(player.yaw));

  for (const p of pedestrians) {
    const d = p.mesh.position.distanceTo(source);
    const toP = p.mesh.position.clone().sub(source);
    if (d < 18 && toP.dot(direction) > 0) {
      p.mesh.position.addScaledVector(direction, -1.2);
      game.wanted = Math.min(5, game.wanted + 1);
      game.cash += 25;
      return;
    }
  }
}

function updateCombat(dt: number) {
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0 && player.reserveAmmo > 0) {
      const needed = 12 - player.ammo;
      const take = Math.min(needed, player.reserveAmmo);
      player.ammo += take;
      player.reserveAmmo -= take;
    }
  }

  if (keys['KeyR'] && player.reloadTimer <= 0 && player.ammo < 12 && player.reserveAmmo > 0) {
    player.reloadTimer = 1.1;
  }

  if (keys['KeyQ'] && !game.paused) {
    fireWeapon();
  }
}

function updatePolice(dt: number) {
  policeCars.forEach((car) => {
    if (game.wanted > 0) {
      car.chasePlayer(dt);
      if (car.mesh.position.distanceTo(player.position) < 2.5) {
        player.health -= dt * 14;
      }
    }
  });
}

function updatePedestrians(dt: number) {
  pedestrians.forEach((ped) => ped.update(dt));
}

function updateMission(dt: number) {
  if (game.missionIndex === 0) {
    const dst = player.position.distanceTo(missionWaypoints[0]);
    const inVehicleGoal = player.inVehicle && player.vehicle && player.vehicle.mesh.position.distanceTo(missionWaypoints[0]) < 7;
    if (inVehicleGoal || dst < 8) {
      completeMission();
    }
  }

  if (game.missionIndex === 1) {
    if (packageCrate && player.position.distanceTo(packageCrate.position) < 4) {
      packageCrate.visible = false;
      game.objectiveText = 'Escape the rival gang and keep moving.';
      game.wanted = 2;
      setBanner('Package secured');
      missionMarkers[1].visible = true;
    }

    if (player.position.distanceTo(new THREE.Vector3(-58, 1.4, 40)) < 12) {
      completeMission();
    }
  }

  if (game.missionIndex === 2) {
    if (player.position.distanceTo(missionWaypoints[2]) < 9) {
      completeMission();
    }
  }

  if (game.wanted > 0) {
    game.wanted = Math.max(0, game.wanted - dt * 0.015);
  }

  updateHud();
}

function updateCamera() {
  const cameraTarget = player.inVehicle && player.vehicle
    ? player.vehicle.mesh.position.clone().add(new THREE.Vector3(0, 3, 0))
    : player.position.clone().add(new THREE.Vector3(0, 1.8, 0));

  if (player.inVehicle && player.vehicle) {
    const behind = new THREE.Vector3(
      Math.sin(player.vehicle.heading + Math.PI) * 7,
      4.8,
      Math.cos(player.vehicle.heading + Math.PI) * 7
    );
    camera.position.lerp(cameraTarget.clone().add(behind), 0.08);
    camera.lookAt(cameraTarget.clone().add(new THREE.Vector3(Math.sin(player.vehicle.heading) * 10, 2, Math.cos(player.vehicle.heading) * 10))));
    return;
  }

  const offset = new THREE.Vector3(
    Math.sin(player.yaw + Math.PI) * 7,
    4.2 + (player.pitch * 1.2),
    Math.cos(player.yaw + Math.PI) * 7
  );
  const desired = cameraTarget.clone().add(offset);
  camera.position.lerp(desired, 0.08);
  camera.lookAt(cameraTarget);
}

function updateVehiclePrompt() {
  const nearest = findNearestVehicle();
  if (nearest && nearest.mesh.position.distanceTo(player.position) < 5.5 && !player.inVehicle) {
    vehiclePromptEl.classList.remove('hidden');
  } else {
    vehiclePromptEl.classList.add('hidden');
  }
}

function drawMinimap() {
  const ctx = miniCanvas.getContext('2d');
  if (!ctx) return;
  const w = miniCanvas.width;
  const h = miniCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1720';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#2d3749';
  ctx.fillRect(w * 0.06, h * 0.08, w * 0.88, h * 0.15);
  ctx.fillRect(w * 0.06, h * 0.2, w * 0.15, h * 0.62);
  ctx.fillRect(w * 0.38, h * 0.08, w * 0.18, h * 0.78);
  ctx.fillRect(w * 0.62, h * 0.08, w * 0.18, h * 0.78);
  ctx.fillRect(w * 0.06, h * 0.72, w * 0.88, h * 0.15);

  const playerMapX = ((player.position.x + 80) / 160) * w;
  const playerMapY = ((player.position.z + 80) / 160) * h;
  ctx.fillStyle = '#ffcc66';
  ctx.fillRect(playerMapX - 4, playerMapY - 4, 8, 8);

  const marker = missionMarkers[game.missionIndex];
  if (marker) {
    const mx = ((marker.position.x + 80) / 160) * w;
    const my = ((marker.position.z + 80) / 160) * h;
    ctx.fillStyle = '#2ee8a7';
    ctx.fillRect(mx - 4, my - 4, 8, 8);
  }
}

function setButtonHandlers() {
  document.getElementById('playBtn')?.addEventListener('click', () => {
    game.started = true;
    loadGame();
    hideMenu();
    setupMission(game.missionIndex);
    updateHud();
  });

  document.getElementById('settingsBtn')?.addEventListener('click', () => {
    menuEl.classList.add('hidden');
    settingsPanelEl.classList.remove('hidden');
  });

  document.getElementById('backFromSettings')?.addEventListener('click', () => {
    settingsPanelEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
  });

  document.getElementById('quitBtn')?.addEventListener('click', () => window.close());

  document.getElementById('resumeBtn')?.addEventListener('click', () => {
    pauseMenuEl.classList.add('hidden');
    game.paused = false;
  });

  document.getElementById('restartBtn')?.addEventListener('click', () => {
    game.paused = false;
    pauseMenuEl.classList.add('hidden');
    setupMission(game.missionIndex);
  });

  document.getElementById('mainMenuBtn')?.addEventListener('click', () => {
    game.started = false;
    game.paused = false;
    pauseMenuEl.classList.add('hidden');
    showMenu();
  });

  audioInputEl.addEventListener('input', (event) => {
    game.soundVolume = Number((event.target as HTMLInputElement).value) / 100;
  });

  sensitivityInputEl.addEventListener('input', (event) => {
    game.mouseSensitivity = Number((event.target as HTMLInputElement).value);
  });
}

function handleInputs() {
  window.addEventListener('keydown', (event) => {
    keys[event.code] = true;
    if (event.code === 'Escape' && game.started) {
      game.paused = !game.paused;
      pauseMenuEl.classList.toggle('hidden', !game.paused);
    }
    if (event.code === 'KeyE') {
      handleInteraction();
    }
  });

  window.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });

  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && game.started && !game.paused) {
      fireWeapon();
    }
  });

  window.addEventListener('mousemove', (event) => {
    if (!game.started || game.paused || player.inVehicle) return;
    player.yaw -= event.movementX * 0.003 * game.mouseSensitivity;
    player.pitch = THREE.MathUtils.clamp(player.pitch - event.movementY * 0.0018 * game.mouseSensitivity, 0.2, 1.3);
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  window.addEventListener('contextmenu', (event) => event.preventDefault());
}

spawnCity();
createMissionMarkers();
setButtonHandlers();
handleInputs();
showMenu();
loadGame();
setupMission(game.missionIndex);
updateHud();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);

  if (game.started && !game.paused) {
    updatePlayer(dt);
    updateCombat(dt);
    updatePedestrians(dt);
    updatePolice(dt);
    updateMission(dt);
    updateVehiclePrompt();
    if (player.health <= 0) {
      player.health = 100;
      player.position.set(0, 1.4, 30);
      playerMesh.position.copy(player.position);
      setBanner('Kairo respawned at the safe zone.');
    }
  }

  updateCamera();
  updateHud();
  drawMinimap();
  renderer.render(scene, camera);
}

animate();

export {};
