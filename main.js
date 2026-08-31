import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const canvas = document.getElementById('c');
const vignette = document.getElementById('vignette');
const blackFade = document.getElementById('blackFade');
const redFlash = document.getElementById('redFlash');
const chromatic = document.getElementById('chromatic');
const questLog = document.getElementById('questLog');
const invText = document.getElementById('invText');
const floorIndicator = document.getElementById('floorIndicator');
const interactPrompt = document.getElementById('interactPrompt');
const elevatorText = document.getElementById('elevatorText');
const codeDisplay = document.getElementById('codeDisplay');
const codeDisplayText = document.getElementById('codeDisplayText');

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x040406);
scene.fog = new THREE.Fog(0x050507, 12, 38);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Lighting
const ambient = new THREE.AmbientLight(0x111111, 1.2);
scene.add(ambient);
let flashlight, flashTarget;
function setupFlashlight(){
  flashlight = new THREE.SpotLight(0xfff6d6, 28, 22, Math.PI/5.5, 0.35, 1);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024,1024);
  flashlight.shadow.bias = -0.0005;
  flashlight.position.set(0,0,0);
  flashlight.decay = 1.4;
  scene.add(flashlight);
  flashTarget = new THREE.Object3D();
  scene.add(flashTarget);
  flashlight.target = flashTarget;
  // fill point light
  const fill = new THREE.PointLight(0xffddaa, 1.2, 6);
  fill.name='fill';
  camera.add(fill);
  scene.add(camera);
}
setupFlashlight();

// Mobile detection
const isMobile = (() => {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const uaCheck = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const touchCheck = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 900;
  return (uaCheck && touchCheck) || (touchCheck && smallScreen);
})();
if(isMobile) document.body.classList.add('is-mobile');

// Controls
const controls = new PointerLockControls(camera, document.body);
let moveForward=false, moveBack=false, moveLeft=false, moveRight=false, canJump=false;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let prevTime = performance.now();
const playerHeight = 1.65;
let playerVelocityY = 0;
let onGround = true;
let isPointerLocked = false;

// Mobile look state (yaw/pitch for isMobile)
let yaw = 0;
let pitch = 0;
let joystickVector = {x:0, y:0};
let isMobileLookActive = false;

controls.addEventListener('lock',()=> isPointerLocked=true);
controls.addEventListener('unlock',()=> {
  // on mobile keep pseudo-locked so movement still works
  if(isMobile && gameState.started && !isSafeOpen && gameState.currentFloor!==0) {
    // don't set false on mobile during gameplay - keep controls active via touch
    // but respect menu/overlays
    if(document.getElementById('rotateOverlay')?.classList.contains('hidden') === false) {
      isPointerLocked=false;
    } else {
      // keep true for mobile movement/hover
      isPointerLocked=true;
      // re-sync yaw/pitch from camera
      yaw = camera.rotation.y;
      pitch = camera.rotation.x;
    }
    return;
  }
  isPointerLocked=false;
});

document.addEventListener('click', (e)=>{
  if(document.getElementById('menu').style.display!=='none' || document.getElementById('winScreen').classList.contains('hidden')===false) return;
  // on mobile don't require pointer lock - tap handles interact via buttons/raycast
  if(isMobile){
    if(gameState.started && !gameState.inTransition && !isSafeOpen && !e.target.closest('#mobileControls')){
      handleInteract();
    }
    return;
  }
  if(!isPointerLocked && gameState.started && !gameState.inTransition && !isSafeOpen){
    controls.lock();
  } else if(isPointerLocked){
    handleInteract();
  }
});

document.addEventListener('keydown', e=>{
  if(isSafeOpen) return;
  switch(e.code){
    case 'KeyW': moveForward=true; break;
    case 'KeyS': moveBack=true; break;
    case 'KeyA': moveLeft=true; break;
    case 'KeyD': moveRight=true; break;
    case 'Space': if(onGround){ playerVelocityY=4.5; onGround=false;} break;
    case 'KeyE': handleInteract(); break;
  }
});
document.addEventListener('keyup', e=>{
  switch(e.code){
    case 'KeyW': moveForward=false; break;
    case 'KeyS': moveBack=false; break;
    case 'KeyA': moveLeft=false; break;
    case 'KeyD': moveRight=false; break;
  }
});

// Audio System - procedural
class HorrorAudio{
  constructor(){
    this.ctx=null; this.master=null; this.hissNode=null; this.hissGain=null;
    this.volume=0.6;
  }
  init(){
    if(this.ctx) return;
    this.ctx = new (window.AudioContext||window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value=this.volume;
    this.master.connect(this.ctx.destination);
    this.startHiss();
  }
  setVolume(v){ this.volume=v; if(this.master) this.master.gain.value=v; }
  startHiss(){
    if(!this.ctx) return;
    const bufferSize = this.ctx.sampleRate*2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*0.5;
    const src = this.ctx.createBufferSource(); src.buffer=buffer; src.loop=true;
    const filter = this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=900;
    const gain = this.ctx.createGain(); gain.gain.value=0.07;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start();
    this.hissNode=src; this.hissGain=gain;
    // slow modulation
    const lfo = this.ctx.createOscillator(); lfo.frequency.value=0.12;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value=0.03;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
  }
  playScreech(duration=1.2){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.setValueAtTime(180,t);
    osc.frequency.linearRampToValueAtTime(40,t+duration);
    osc.frequency.linearRampToValueAtTime(320,t+duration*0.6);
    const gain=this.ctx.createGain(); gain.gain.setValueAtTime(0.0,t);
    gain.gain.linearRampToValueAtTime(0.55,t+0.05); gain.gain.exponentialRampToValueAtTime(0.001,t+duration);
    const dist = this.ctx.createWaveShaper();
    dist.curve = this.makeDistortionCurve(400);
    const filter = this.ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=1400; filter.Q.value=1.2;
    osc.connect(filter); filter.connect(dist); dist.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+duration);
    // noise burst
    const bLen = this.ctx.sampleRate*0.25;
    const buf=this.ctx.createBuffer(1,bLen,this.ctx.sampleRate);
    const ch=buf.getChannelData(0);
    for(let i=0;i<bLen;i++) ch[i]=(Math.random()*2-1)*Math.pow(1-i/bLen,2);
    const nSrc=this.ctx.createBufferSource(); nSrc.buffer=buf;
    const nGain=this.ctx.createGain(); nGain.gain.setValueAtTime(0.4,t); nGain.gain.exponentialRampToValueAtTime(0.01,t+0.3);
    const hp=this.ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=2000;
    nSrc.connect(hp); hp.connect(nGain); nGain.connect(this.master); nSrc.start(t);
  }
  playFlickerSound(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    for(let i=0;i<4;i++){
      const osc=this.ctx.createOscillator(); osc.frequency.value=60+Math.random()*40;
      const g=this.ctx.createGain(); g.gain.setValueAtTime(0.18,t+i*0.07); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.07+0.06);
      osc.connect(g); g.connect(this.master); osc.start(t+i*0.07); osc.stop(t+i*0.07+0.07);
    }
  }
  playLaugh(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    // child laugh: high pitched modulated oscillators
    for(let k=0;k<6;k++){
      const osc=this.ctx.createOscillator(); osc.type='sine'; osc.frequency.setValueAtTime(700+Math.random()*800,t+k*0.12);
      osc.frequency.linearRampToValueAtTime(500+Math.random()*300,t+k*0.12+0.08);
      const gain=this.ctx.createGain(); gain.gain.setValueAtTime(0,t+k*0.12); gain.gain.linearRampToValueAtTime(0.28,t+k*0.12+0.02); gain.gain.exponentialRampToValueAtTime(0.01,t+k*0.12+0.15);
      const vib=this.ctx.createOscillator(); vib.frequency.value=22; const vibGain=this.ctx.createGain(); vibGain.gain.value=90;
      vib.connect(vibGain); vibGain.connect(osc.frequency); vib.start(t+k*0.12); vib.stop(t+k*0.12+0.16);
      osc.connect(gain); gain.connect(this.master); osc.start(t+k*0.12); osc.stop(t+k*0.12+0.16);
    }
  }
  playWhisper(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(); osc.type='triangle'; osc.frequency.value=180+Math.random()*120;
    const gain=this.ctx.createGain(); gain.gain.setValueAtTime(0.001,t); gain.gain.linearRampToValueAtTime(0.18,t+0.08); gain.gain.exponentialRampToValueAtTime(0.001,t+1.2);
    const filter=this.ctx.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=600;
    const panner=this.ctx.createStereoPanner(); panner.pan.value=(Math.random()*2-1)*0.8;
    osc.connect(filter); filter.connect(panner); panner.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t+1.2);
  }
  playThud(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(); osc.frequency.setValueAtTime(90,t); osc.frequency.exponentialRampToValueAtTime(25,t+0.4);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.6,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t+0.5);
  }
  playDoorSlam(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(); osc.frequency.setValueAtTime(120,t); osc.frequency.linearRampToValueAtTime(30,t+0.2);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.5,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.3);
    const hp=this.ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=200;
    osc.connect(hp); hp.connect(g); g.connect(this.master); osc.start(t); osc.stop(t+0.3);
  }
  playElevatorScreech(){
    this.playScreech(2.0);
    const t=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(); osc.type='square'; osc.frequency.setValueAtTime(55,t); osc.frequency.linearRampToValueAtTime(110,t+1.5);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.22,t); g.gain.linearRampToValueAtTime(0.001,t+1.8);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t+1.8);
  }
  playWin(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    [261,329,392,523].forEach((f,i)=>{
      const o=this.ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const g=this.ctx.createGain(); g.gain.setValueAtTime(0,t+i*0.18); g.gain.linearRampToValueAtTime(0.22,t+i*0.18+0.05); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.18+0.9);
      o.connect(g); g.connect(this.master); o.start(t+i*0.18); o.stop(t+i*0.18+0.9);
    });
  }
  makeDistortionCurve(amount){ const k=typeof amount==='number'?amount:50; const n=44100; const curve=new Float32Array(n); const deg=Math.PI/180; for(let i=0;i<n;i++){ const x=i*2/n-1; curve[i]=(3+k)*x*20*deg/(Math.PI+k*Math.abs(x)); } return curve; }
  playDistortedGlitch(){
    if(!this.ctx) return;
    const t=this.ctx.currentTime;
    for(let i=0;i<8;i++){
      const o=this.ctx.createOscillator(); o.type='square'; o.frequency.setValueAtTime(100+Math.random()*1200,t+i*0.06);
      const g=this.ctx.createGain(); g.gain.setValueAtTime(0.18,t+i*0.06); g.gain.exponentialRampToValueAtTime(0.001,t+i*0.06+0.05);
      o.connect(g); g.connect(this.master); o.start(t+i*0.06); o.stop(t+i*0.06+0.05);
    }
  }
}
const audio = new HorrorAudio();

// Textures via canvas
function createWallTexture(texts=[]){
  const c=document.createElement('canvas'); c.width=512; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#1a1816'; ctx.fillRect(0,0,512,512);
  ctx.fillStyle='rgba(0,0,0,0.12)';
  for(let i=0;i<400;i++){ const x=Math.random()*512, y=Math.random()*512; ctx.fillRect(x,y,1, Math.random()*22+4); }
  // plaster cracks
  ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1;
  for(let i=0;i<12;i++){ ctx.beginPath(); let x=Math.random()*512, y=Math.random()*512; ctx.moveTo(x,y); for(let s=0;s<5;s++){ x+= (Math.random()-0.5)*80; y+=(Math.random()-0.2)*90; ctx.lineTo(x,y);} ctx.stroke(); }
  // blood texts
  texts.forEach((t,i)=>{
    ctx.save(); ctx.translate(80+Math.random()*340, 80+ Math.random()*360); ctx.rotate((Math.random()-0.5)*0.3);
    ctx.font=`bold ${32+Math.random()*18}px Creepster`; ctx.fillStyle=`rgba(${170+Math.random()*80|0},${5+Math.random()*20|0},${5+Math.random()*10|0},0.82)`;
    ctx.fillText(t,0,0); // drip
    ctx.fillStyle='rgba(120,0,0,0.5)'; for(let d=0;d<3;d++){ const dx=Math.random()* (ctx.measureText(t).width); ctx.fillRect(dx, 6, 2, 8+Math.random()*18); }
    ctx.restore();
  });
  // stains
  for(let i=0;i<6;i++){ const x=Math.random()*512, y=Math.random()*512, r=18+Math.random()*28; const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,'rgba(90,10,10,0.28)'); g.addColorStop(1,'rgba(90,10,10,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
function createFloorTexture(){
  const c=document.createElement('canvas'); c.width=512; c.height=512; const ctx=c.getContext('2d');
  ctx.fillStyle='#c9a84a'; ctx.fillRect(0,0,512,512);
  ctx.fillStyle='rgba(80,60,10,0.18)'; for(let i=0;i<700;i++){ ctx.fillRect(Math.random()*512,Math.random()*512,2,2); }
  ctx.strokeStyle='rgba(60,40,0,0.12)'; for(let i=0;i<14;i++){ ctx.beginPath(); ctx.moveTo(0, i*42); ctx.lineTo(512, i*42); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i*42,0); ctx.lineTo(i*42,512); ctx.stroke(); }
  // dirt
  for(let i=0;i<10;i++){ const x=Math.random()*512, y=Math.random()*512, r=20+Math.random()*40; const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,'rgba(30,20,0,0.22)'); g.addColorStop(1,'rgba(30,20,0,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
  const tex=new THREE.CanvasTexture(c); tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(2,2); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
function createBloodFloorTexture(){
  const c=document.createElement('canvas'); c.width=512; c.height=512; const ctx=c.getContext('2d');
  ctx.fillStyle='#8a0f0f'; ctx.fillRect(0,0,512,512);
  ctx.fillStyle='rgba(40,0,0,0.3)'; for(let i=0;i<500;i++) ctx.fillRect(Math.random()*512,Math.random()*512,3,3);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; return tex;
}
const yellowTex = createFloorTexture();
const bloodTex = createBloodFloorTexture();

// Game State
const gameState = {
  started:false, currentFloor:0, inventory:[], hasToolbox:false, hasKey:false, hasToy:false,
  safeCode:'', safeOpened:false, keySpawned:false,
  inTransition:false, startTime:0, flashlightOn:true, flickerUntil:0,
  monsterPos:-30, monsterActive:false, chaseStarted:false, wardrobeFallen:false, chandelierDropped:false
};

let interactables=[]; let colliders=[];
let wallsGroup, floorMesh, ceilingMesh;
let cabinetGroup, cabinetDoor, toolboxMesh;
let elevatorGroup, elevatorDoors=[], elevatorButton, elevatorLight;
let safeGroup, safeDoor;
let furnitureGroups=[];
let monsterGroup, chandelierMesh, wardrobeBlock, corridorGroup;
let bedBearMesh, sinkBearMesh;
let finalDoorGroup, finalDoorMesh;
let menuAnimGroup;

function clearScene(){
  interactables=[]; colliders=[];
  const toRemove=[]; scene.traverse(o=>{ if(o.isMesh||o.isGroup) { if(o !== camera && o !== flashlight && o !== flashTarget && !o.isLight) toRemove.push(o);} });
  // Keep lights and camera
  toRemove.forEach(o=>{ if(o.parent) o.parent.remove(o); });
  // remove groups
  if(wallsGroup) scene.remove(wallsGroup);
  if(corridorGroup) scene.remove(corridorGroup);
  if(monsterGroup) scene.remove(monsterGroup);
  if(menuAnimGroup) scene.remove(menuAnimGroup);
  scene.fog = new THREE.Fog(0x050507, 12, 38);
}

function addWallsRoom(w,h,d, texture){
  wallsGroup=new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({map:texture, roughness:0.92, metalness:0.02});
  const wallGeo = new THREE.BoxGeometry(w, h, 0.22);
  const wallPos = [[0,h/2, -d/2],[0,h/2, d/2],[ -w/2,h/2,0],[ w/2,h/2,0]];
  wallPos.forEach((p,i)=>{
    const m=new THREE.Mesh(wallGeo, mat); m.position.set(...p); if(i>=2){ m.scale.set(d/w,1,1); m.rotation.y=Math.PI/2; }
    m.receiveShadow=true; m.castShadow=true; wallsGroup.add(m); colliders.push(m);
  });
  // floor with improved material (repeat & roughness)
  const floorMat=new THREE.MeshStandardMaterial({map:yellowTex, roughness:0.88, metalness:0.02});
  floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d), floorMat); floorMesh.rotation.x=-Math.PI/2; floorMesh.receiveShadow=true; wallsGroup.add(floorMesh);
  // baseboards along walls (visual only)
  const baseMat=new THREE.MeshStandardMaterial({color:0x1a1208, roughness:0.85});
  const baseH=0.14, baseT=0.04;
  const baseGeoms=[
    {s:[w,baseH,baseT], p:[0,baseH/2,-d/2+0.12]},
    {s:[w,baseH,baseT], p:[0,baseH/2,d/2-0.12]},
    {s:[d,baseH,baseT], p:[-w/2+0.12,baseH/2,0], r:Math.PI/2},
    {s:[d,baseH,baseT], p:[w/2-0.12,baseH/2,0], r:Math.PI/2},
  ];
  baseGeoms.forEach(b=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(...b.s), baseMat);
    m.position.set(...b.p); if(b.r) m.rotation.y=b.r; m.receiveShadow=true; wallsGroup.add(m);
  });
  // ceiling with displaced vertices + emissive strips for lighting hint
  const ceilGeo=new THREE.PlaneGeometry(w,d,14,14);
  const pos=ceilGeo.attributes.position;
  for(let i=0;i<pos.count;i++){ pos.setZ(i, (Math.random()-0.5)*0.18); }
  pos.needsUpdate=true; ceilGeo.computeVertexNormals();
  const ceilMat=new THREE.MeshStandardMaterial({color:0x1e1e1a, roughness:1});
  ceilingMesh=new THREE.Mesh(ceilGeo, ceilMat); ceilingMesh.rotation.x=Math.PI/2; ceilingMesh.position.y=h; wallsGroup.add(ceilingMesh);
  // subtle ceiling lamp fixture
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.08,0.6), new THREE.MeshStandardMaterial({color:0x222222, emissive:0x332200, emissiveIntensity:0.25}));
  lamp.position.set(0, h-0.04, 0); wallsGroup.add(lamp);
  scene.add(wallsGroup);
}

function updateInventoryUI(){
  if(gameState.inventory.length===0) invText.textContent='empty';
  else invText.textContent=gameState.inventory.join(' + ');
}
function setQuest(t){ questLog.textContent=t; questLog.animate([{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:300}); }
function showCodeDisplay(code){
  if(codeDisplay && codeDisplayText){
    codeDisplayText.textContent = code;
    codeDisplay.classList.remove('hidden');
  }
}
function hideCodeDisplay(){
  if(codeDisplay) codeDisplay.classList.add('hidden');
}

// Floor 1
function buildFloor1(){
  clearScene(); hideCodeDisplay(); gameState.currentFloor=1; floorIndicator.textContent='FLOOR: 1 - MAINTENANCE';
  setQuest('NEED TO FIX THE ELEVATOR. FIND TOOLS.');
  const tex=createWallTexture(['HELP ME','DIE','666','HE IS HERE','DON\'T LOOK']);
  addWallsRoom(10,3.2,8, tex);
  scene.fog = new THREE.Fog(0x0a0a0a, 8, 22);

  // Cabinet - improved with shelves, rust, and interior
  cabinetGroup=new THREE.Group(); cabinetGroup.position.set(-3.2,0, -2.8);
  const cabMat=new THREE.MeshStandardMaterial({color:0x3a2f1e, roughness:0.82, metalness:0.05});
  const cabBox=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.6,0.45), cabMat); cabBox.position.y=0.8; cabBox.castShadow=true; cabBox.receiveShadow=true; cabinetGroup.add(cabBox);
  // interior shelves
  for(let s=0;s<2;s++){
    const shelf=new THREE.Mesh(new THREE.BoxGeometry(1.02,0.02,0.38), new THREE.MeshStandardMaterial({color:0x2e2212, roughness:0.9}));
    shelf.position.set(0,0.55+s*0.45, 0.02); shelf.receiveShadow=true; cabinetGroup.add(shelf);
  }
  // side rivets decoration
  for(let i=0;i<6;i++){
    const riv=new THREE.Mesh(new THREE.SphereGeometry(0.015,6,6), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.8}));
    riv.position.set(-0.52,0.25+i*0.22,0.23); cabinetGroup.add(riv);
    const riv2=riv.clone(); riv2.position.x=0.52; cabinetGroup.add(riv2);
  }
  cabinetDoor=new THREE.Mesh(new THREE.BoxGeometry(1.05,1.55,0.05), new THREE.MeshStandardMaterial({color:0x4a3a22, roughness:0.78, metalness:0.08}));
  cabinetDoor.position.set(0,0.8,0.26); cabinetDoor.castShadow=true; cabinetGroup.add(cabinetDoor);
  // door panels (visual) - attached to door so it moves when opened
  const panel=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.95,0.01), new THREE.MeshStandardMaterial({color:0x5a4a2b, roughness:0.85}));
  panel.position.set(0,0.05,0.03); cabinetDoor.add(panel);
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.18,8), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.7, roughness:0.3}));
  handle.rotation.z=Math.PI/2; handle.position.set(0.35,0.8,0.32); cabinetGroup.add(handle);
  // warning sticker
  const sticker=new THREE.Mesh(new THREE.PlaneGeometry(0.28,0.14), new THREE.MeshStandardMaterial({color:0xffcc00}));
  sticker.position.set(-0.2,0.6,0.291); sticker.rotation.y=0; cabinetGroup.add(sticker);
  cabinetGroup.userData={type:'cabinet', opened:false};
  scene.add(cabinetGroup);
  interactables.push({mesh:cabinetDoor, type:'cabinet', group:cabinetGroup, prompt:'Click to open cabinet'});
  colliders.push(cabBox);

  // Toolbox inside (hidden until opened) - more detailed: metal box with clasps and tools
  toolboxMesh=new THREE.Group(); toolboxMesh.position.set(-3.2,0.45,-2.8); toolboxMesh.visible=false;
  const tbBase=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.2,0.3), new THREE.MeshStandardMaterial({color:0x8a1a1a, roughness:0.5, metalness:0.25}));
  tbBase.castShadow=true; tbBase.receiveShadow=true; toolboxMesh.add(tbBase);
  const tbLid=new THREE.Mesh(new THREE.BoxGeometry(0.51,0.04,0.31), new THREE.MeshStandardMaterial({color:0x9a2222, roughness:0.45, metalness:0.3}));
  tbLid.position.y=0.12; tbLid.castShadow=true; toolboxMesh.add(tbLid);
  // clasps
  for(let c=-1;c<=1;c+=2){
    const clasp=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.06,0.02), new THREE.MeshStandardMaterial({color:0x222222, metalness:0.8}));
    clasp.position.set(c*0.12,0.05,0.16); toolboxMesh.add(clasp);
  }
  const toolHandle=new THREE.Mesh(new THREE.TorusGeometry(0.09,0.02,8,12, Math.PI), new THREE.MeshStandardMaterial({color:0x222222, metalness:0.6}));
  toolHandle.position.set(0,0.14,0); toolboxMesh.add(toolHandle);
  // tiny tools inside silhouette (visible through slight gap)
  const hammer=new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.18,6), new THREE.MeshStandardMaterial({color:0x555555, metalness:0.7}));
  hammer.rotation.z=Math.PI/2; hammer.position.set(0,0.02,0); hammer.visible=false; toolboxMesh.add(hammer);
  toolboxMesh.userData={type:'toolbox', hammer}; scene.add(toolboxMesh);

  // Elevator - improved with frame, panels, button box and indicator
  elevatorGroup=new THREE.Group(); elevatorGroup.position.set(3.2,0,2.5);
  elevatorGroup.rotation.y = Math.PI;
  const elevFrame=new THREE.Mesh(new THREE.BoxGeometry(1.9,2.35,1.5), new THREE.MeshStandardMaterial({color:0x1f1f1f, metalness:0.55, roughness:0.45}));
  elevFrame.position.y=1.15; elevFrame.castShadow=true; elevFrame.receiveShadow=true; elevatorGroup.add(elevFrame);
  // side trim
  const trimMat=new THREE.MeshStandardMaterial({color:0x111111, metalness:0.7});
  const leftTrim=new THREE.Mesh(new THREE.BoxGeometry(0.08,2.35,0.08), trimMat); leftTrim.position.set(-0.95,1.15,0.75); elevatorGroup.add(leftTrim);
  const rightTrim=leftTrim.clone(); rightTrim.position.x=0.95; elevatorGroup.add(rightTrim);
  const topTrim=new THREE.Mesh(new THREE.BoxGeometry(2.0,0.08,0.08), trimMat); topTrim.position.set(0,2.32,0.75); elevatorGroup.add(topTrim);
  const doorMat=new THREE.MeshStandardMaterial({color:0x5a5a5a, metalness:0.72, roughness:0.28});
  // brushed metal lines
  const leftDoor=new THREE.Mesh(new THREE.BoxGeometry(0.88,2.05,0.06), doorMat); leftDoor.position.set(-0.44,1.1,0.78); leftDoor.castShadow=true; elevatorGroup.add(leftDoor);
  const rightDoor=new THREE.Mesh(new THREE.BoxGeometry(0.88,2.05,0.06), doorMat); rightDoor.position.set(0.44,1.1,0.78); elevatorGroup.add(rightDoor);
  // door gap line
  for(let side of [leftDoor,rightDoor]){
    const line=new THREE.Mesh(new THREE.BoxGeometry(0.02,2.0,0.015), new THREE.MeshStandardMaterial({color:0x333333, metalness:0.9}));
    line.position.set(side===leftDoor?0.42:-0.42,0,0.04); side.add(line);
  }
  elevatorDoors=[leftDoor,rightDoor];
  // button panel
  const panelBox=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.35,0.06), new THREE.MeshStandardMaterial({color:0x0a0a0a, roughness:0.7}));
  panelBox.position.set(1.15,1.2,0.55); elevatorGroup.add(panelBox);
  elevatorButton=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.04,16), new THREE.MeshStandardMaterial({color:0x330000, emissive:0x440000, emissiveIntensity:0.8, metalness:0.6}));
  elevatorButton.rotation.x=Math.PI/2; elevatorButton.position.set(1.15,1.2,0.59); elevatorButton.userData={type:'elevatorButton'}; elevatorGroup.add(elevatorButton);
  // indicator above doors
  const indicator=new THREE.Mesh(new THREE.PlaneGeometry(0.36,0.08), new THREE.MeshStandardMaterial({color:0x220000, emissive:0xff0000, emissiveIntensity:0.6}));
  indicator.position.set(0,2.05,0.79); elevatorGroup.add(indicator); elevatorGroup.userData.indicator=indicator;
  elevatorLight=new THREE.PointLight(0xff0000, 2.5, 3.5); elevatorLight.position.set(0,2.3,0.5); elevatorLight.castShadow=false; elevatorGroup.add(elevatorLight);
  scene.add(elevatorGroup);
  interactables.push({mesh:elevatorButton, type:'elevatorButton', prompt: 'Press elevator button'});
  colliders.push(elevFrame);

  camera.position.set(0, playerHeight, 3.5); controls.getObject().position.copy(camera.position);
  if(isMobile) resetMobileView();
  gameState.flashlightOn=true; flashlight.intensity=28;
}

function openCabinet(){
  if(cabinetGroup.userData.opened) return;
  cabinetGroup.userData.opened=true;
  // animate door
  let prog=0; const startRot=cabinetDoor.rotation.y;
  const animate=()=>{
    prog+=0.06; cabinetDoor.position.x= Math.sin(prog*1.2)*0.5; cabinetDoor.rotation.y = -prog*2.2;
    if(prog<1.2) requestAnimationFrame(animate); else { toolboxMesh.visible=true; interactables.push({mesh:toolboxMesh, type:'toolbox', prompt:'Take toolbox'}); }
  }; animate();
  audio.playDoorSlam();
}

function takeToolbox(){
  if(gameState.hasToolbox) return;
  gameState.hasToolbox=true; gameState.inventory.push('Toolbox'); updateInventoryUI();
  toolboxMesh.visible=false; // remove
  interactables = interactables.filter(i=>i.mesh!==toolboxMesh);
  setQuest('Toolbox acquired! Now fix the elevator.');
  audio.playThud();
}

async function pressElevatorF1(){
  if(gameState.inTransition) return;
  if(!gameState.hasToolbox){
    // screech + lights out 3 sec
    audio.playElevatorScreech();
    gameState.flashlightOn=false; flashlight.intensity=0; const fill=camera.children.find(c=>c.isPointLight); if(fill) fill.intensity=0;
    // flicker before death
    let flickers=0; const flickInterval=setInterval(()=>{ flashlight.intensity = Math.random()>0.5? 12:0; flickers++; if(flickers>6){clearInterval(flickInterval); flashlight.intensity=0;}},120);
    setQuest('The elevator screeched! Need tools...');
    await new Promise(r=>setTimeout(r,3000));
    // restore
    flashlight.intensity=28; if(fill) fill.intensity=1.2; gameState.flashlightOn=true;
    // subtle shake
    camera.position.x+= (Math.random()-0.5)*0.07;
    return;
  }
  // has toolbox -> open elevator and transition
  gameState.inTransition=true;
  audio.playElevatorScreech();
  // open doors
  let p=0; const int=setInterval(()=>{ p+=0.07; elevatorDoors[0].position.x = -0.44 - p*0.9; elevatorDoors[1].position.x = 0.44 + p*0.9; if(p>=1){clearInterval(int); doFadeTransition(()=>buildFloor2()); }}, 30);
  elevatorLight.color.set(0x00ff00); elevatorLight.intensity=4;
}

function doFadeTransition(next){
  blackFade.classList.add('active');
  setTimeout(()=>{ next(); blackFade.classList.remove('active'); gameState.inTransition=false; }, 900);
}

// Floor 2 - Nursery
let whisperInterval;
function buildFloor2(){
  clearScene(); hideCodeDisplay(); gameState.currentFloor=2; floorIndicator.textContent='FLOOR: 2 - NURSERY';
  setQuest('FIND THE CODE AND OPEN THE SAFE. Search furniture!');
  // generate code
  const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  gameState.safeCode = Array.from({length:4},()=> letters[Math.floor(Math.random()*26)]).join('');
  gameState.safeOpened=false; gameState.hasKey=false; gameState.keySpawned=false;
  console.log('Safe code:', gameState.safeCode);
  const tex=createWallTexture(['GO AWAY','MOMMY','PLAY WITH ME','']);
  addWallsRoom(14,3.5,14, tex);
  scene.fog = new THREE.Fog(0x0b0a12, 10, 30);
  // floor painted
  floorMesh.material.map = yellowTex; // keep

  furnitureGroups=[];
  // Wardrobe - detailed with double doors, handles, mirror
  (()=>{ const g=new THREE.Group(); g.position.set(-5,0,-4);
    const body=new THREE.Mesh(new THREE.BoxGeometry(1.35,2.05,0.68), new THREE.MeshStandardMaterial({color:0x6b4a2b, roughness:0.78})); body.position.y=1.025; body.castShadow=true; body.receiveShadow=true; g.add(body);
    // doors
    const dMat=new THREE.MeshStandardMaterial({color:0x7a5a33, roughness:0.82});
    const doorL=new THREE.Mesh(new THREE.BoxGeometry(0.64,1.9,0.04), dMat); doorL.position.set(-0.325,1.025,0.36); doorL.castShadow=true; g.add(doorL);
    const doorR=new THREE.Mesh(new THREE.BoxGeometry(0.64,1.9,0.04), dMat); doorR.position.set(0.325,1.025,0.36); doorR.castShadow=true; g.add(doorR);
    // handles
    const hMat=new THREE.MeshStandardMaterial({color:0x111111, metalness:0.7});
    const h1=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.28,8), hMat); h1.position.set(-0.08,1.05,0.39); g.add(h1);
    const h2=h1.clone(); h2.position.x=0.08; g.add(h2);
    // top molding
    const top=new THREE.Mesh(new THREE.BoxGeometry(1.45,0.08,0.75), new THREE.MeshStandardMaterial({color:0x4a3520})); top.position.set(0,2.08,0.02); g.add(top);
    g.userData={type:'furniture', name:'wardrobe', searched:false};
    scene.add(g); furnitureGroups.push(g); interactables.push({mesh:body, type:'furniture', group:g, prompt:'Search wardrobe'});
  })();
  // Bed - frame, mattress, pillows, blood stain
  (()=>{ const g=new THREE.Group(); g.position.set(5,0,-5);
    const frame=new THREE.Mesh(new THREE.BoxGeometry(2.1,0.32,1.12), new THREE.MeshStandardMaterial({color:0x4a2a1a, roughness:0.85})); frame.position.y=0.16; frame.castShadow=true; g.add(frame);
    const mattress=new THREE.Mesh(new THREE.BoxGeometry(2.0,0.18,1.02), new THREE.MeshStandardMaterial({color:0xdddde8, roughness:0.9})); mattress.position.y=0.41; mattress.receiveShadow=true; g.add(mattress);
    // pillows
    const pillow=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.14,0.45), new THREE.MeshStandardMaterial({color:0xffffff, roughness:0.95})); pillow.position.set(0.65,0.52,0); g.add(pillow);
    const pillow2=pillow.clone(); pillow2.position.set(-0.65,0.52,0); g.add(pillow2);
    // blanket fold
    const blanket=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.06,0.85), new THREE.MeshStandardMaterial({color:0x6a1a1a, roughness:0.8})); blanket.position.set(0,0.52,0.05); g.add(blanket);
    // blood pool on mattress
    const blood=new THREE.Mesh(new THREE.CircleGeometry(0.28,12), new THREE.MeshStandardMaterial({color:0x7a0a0a, roughness:0.4})); blood.rotation.x=-Math.PI/2; blood.position.set(0.1,0.51,0.15); g.add(blood);
    // headboard
    const head=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.6,1.12), new THREE.MeshStandardMaterial({color:0x3a1a0f})); head.position.set(1.07,0.45,0); g.add(head);
    g.userData={type:'furniture', name:'bed', searched:false};
    scene.add(g); furnitureGroups.push(g); interactables.push({mesh:frame, type:'furniture', group:g, prompt:'Search bed'});
  })();
  // Desk - with drawers, lamp
  (()=>{ const g=new THREE.Group(); g.position.set(0,0,5);
    const top=new THREE.Mesh(new THREE.BoxGeometry(1.35,0.07,0.68), new THREE.MeshStandardMaterial({color:0x5a3e2b, roughness:0.78})); top.position.y=0.73; top.castShadow=true; g.add(top);
    // legs
    for(let x of [-0.62,0.62]) for(let z of [-0.28,0.28]){ const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.73,6), new THREE.MeshStandardMaterial({color:0x3d2b1a})); leg.position.set(x,0.365,z); g.add(leg); }
    // drawer
    const drawer=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.18,0.02), new THREE.MeshStandardMaterial({color:0x6b4a2b})); drawer.position.set(0,0.58,0.35); g.add(drawer);
    const knob=new THREE.Mesh(new THREE.SphereGeometry(0.035,8,8), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.8})); knob.position.set(0,0.58,0.37); g.add(knob);
    // lamp
    const lampBase=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,0.18,10), new THREE.MeshStandardMaterial({color:0x222222})); lampBase.position.set(0.5,0.82,0); g.add(lampBase);
    const lampShade=new THREE.Mesh(new THREE.ConeGeometry(0.14,0.22,12), new THREE.MeshStandardMaterial({color:0x333333, emissive:0xffaa88, emissiveIntensity:0.15})); lampShade.position.set(0.5,1.02,0); g.add(lampShade);
    g.userData={type:'furniture', name:'desk', searched:false};
    scene.add(g); furnitureGroups.push(g); interactables.push({mesh:top, type:'furniture', group:g, prompt:'Search desk'});
  })();
  // Chair
  (()=>{ const g=new THREE.Group(); g.position.set(2.2,0,4.5);
    const seat=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.08,0.52), new THREE.MeshStandardMaterial({color:0x4a3522})); seat.position.y=0.45; seat.castShadow=true; g.add(seat);
    const back=new THREE.Mesh(new THREE.BoxGeometry(0.52,0.55,0.06), new THREE.MeshStandardMaterial({color:0x4a3522})); back.position.set(0,0.76,-0.23); g.add(back);
    for(let x of [-0.22,0.22]) for(let z of [-0.22,0.22]){ const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.45,6), new THREE.MeshStandardMaterial({color:0x222222})); leg.position.set(x,0.225,z); g.add(leg); }
    g.userData={type:'furniture', name:'chair', searched:false};
    scene.add(g); furnitureGroups.push(g); interactables.push({mesh:seat, type:'furniture', group:g, prompt:'Search chair'});
  })();
  // Shelves - tall unit with books/boxes
  (()=>{ const g=new THREE.Group(); g.position.set(-4.5,0,3);
    const body=new THREE.Mesh(new THREE.BoxGeometry(1.65,1.65,0.42), new THREE.MeshStandardMaterial({color:0x3d2b1a, roughness:0.88})); body.position.y=0.825; body.castShadow=true; g.add(body);
    // horizontal shelves
    for(let i=1;i<4;i++){ const sh=new THREE.Mesh(new THREE.BoxGeometry(1.55,0.02,0.38), new THREE.MeshStandardMaterial({color:0x4a3622})); sh.position.set(0,0.3+i*0.35,0.02); g.add(sh); }
    // books
    const colors=[0x8a1a1a,0x1a4a8a,0x1a6b2e,0x5a3a0a,0x222222];
    for(let i=0;i<9;i++){
      const bookH=0.26+Math.random()*0.12, bookW=0.07, bookD=0.24;
      const book=new THREE.Mesh(new THREE.BoxGeometry(bookW,bookH,bookD), new THREE.MeshStandardMaterial({color:colors[i%colors.length]}));
      book.position.set((Math.random()-0.5)*1.2, 0.45+Math.floor(i/3)*0.35+0.12, 0.06);
      book.castShadow=true; g.add(book);
    }
    // small box
    const box=new THREE.Mesh(new THREE.BoxGeometry(0.32,0.28,0.28), new THREE.MeshStandardMaterial({color:0x5a4a33})); box.position.set(0.5,0.45,0.1); g.add(box);
    g.userData={type:'furniture', name:'shelves', searched:false};
    scene.add(g); furnitureGroups.push(g); interactables.push({mesh:body, type:'furniture', group:g, prompt:'Search shelves'});
  })();

  // Safe embedded - more detailed with bolts and dial
  safeGroup=new THREE.Group(); safeGroup.position.set(0,1.0, -6.85);
  const safeBox=new THREE.Mesh(new THREE.BoxGeometry(1.25,1.25,0.5), new THREE.MeshStandardMaterial({color:0x1a1a1a, metalness:0.82, roughness:0.18}));
  safeBox.castShadow=true; safeBox.receiveShadow=true; safeGroup.add(safeBox);
  safeDoor=new THREE.Mesh(new THREE.BoxGeometry(1.18,1.18,0.09), new THREE.MeshStandardMaterial({color:0x3a3a3a, metalness:0.78, roughness:0.28}));
  safeDoor.position.z=0.29; safeDoor.castShadow=true; safeGroup.add(safeDoor);
  // bolts
  for(let i=0;i<4;i++){ const bolt=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.02,10), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.9})); const ang=i/4*Math.PI*2+Math.PI/4; bolt.rotation.x=Math.PI/2; bolt.position.set(Math.cos(ang)*0.48, Math.sin(ang)*0.48, 0.34); safeGroup.add(bolt); }
  const dial=new THREE.Mesh(new THREE.CylinderGeometry(0.19,0.19,0.05,20), new THREE.MeshStandardMaterial({color:0x0a0a0a, metalness:0.95, roughness:0.15}));
  dial.rotation.x=Math.PI/2; dial.position.set(0,0.08,0.35); dial.castShadow=true; safeGroup.add(dial);
  const dialInner=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.06,16), new THREE.MeshStandardMaterial({color:0x333333, metalness:0.8})); dialInner.rotation.x=Math.PI/2; dialInner.position.set(0,0.08,0.36); safeGroup.add(dialInner);
  const handleSafe=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.07,0.03), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.7})); handleSafe.position.set(0.38,0.08,0.35); safeGroup.add(handleSafe);
  const safeLight=new THREE.PointLight(0xff0000,1.6,2.4); safeLight.position.set(0,0.75,0.55); safeGroup.add(safeLight); safeGroup.userData.light=safeLight;
  scene.add(safeGroup);
  interactables.push({mesh:safeDoor, type:'safe', prompt:'Open safe (needs code)'});

  // Elevator for this floor - improved
  elevatorGroup=new THREE.Group(); elevatorGroup.position.set(6.2,0,0);
  elevatorGroup.rotation.y = Math.PI;
  const elevBox=new THREE.Mesh(new THREE.BoxGeometry(1.7,2.35,1.45), new THREE.MeshStandardMaterial({color:0x1a1a1a, metalness:0.65, roughness:0.4}));
  elevBox.position.y=1.175; elevBox.castShadow=true; elevBox.receiveShadow=true; elevatorGroup.add(elevBox);
  const lD=new THREE.Mesh(new THREE.BoxGeometry(0.82,2.1,0.08), new THREE.MeshStandardMaterial({color:0x4a4a4a, metalness:0.72, roughness:0.28})); lD.position.set(-0.41,1.15,0.75); lD.castShadow=true; elevatorGroup.add(lD);
  const rD=new THREE.Mesh(new THREE.BoxGeometry(0.82,2.1,0.08), new THREE.MeshStandardMaterial({color:0x4a4a4a, metalness:0.72, roughness:0.28})); rD.position.set(0.41,1.15,0.75); rD.castShadow=true; elevatorGroup.add(rD);
  // trim
  const eTrim=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.08,0.08), new THREE.MeshStandardMaterial({color:0x0a0a0a})); eTrim.position.set(0,2.32,0.77); elevatorGroup.add(eTrim);
  elevatorDoors=[lD,rD]; elevatorGroup.userData.light=new THREE.PointLight(0xff0000,2.2,3.2); elevatorGroup.userData.light.position.set(0,2.3,0.5); elevatorGroup.add(elevatorGroup.userData.light);
  // call button
  const callBtn=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.04,14), new THREE.MeshStandardMaterial({color:0x440000, emissive:0xaa0000, emissiveIntensity:0.7})); callBtn.rotation.x=Math.PI/2; callBtn.position.set(1.05,1.2,0.7); elevatorGroup.add(callBtn);
  scene.add(elevatorGroup);
  interactables.push({mesh:elevBox, type:'elevatorF2', prompt:'Enter elevator (needs safe opened)'});

  camera.position.set(0, playerHeight, 4); controls.getObject().position.copy(camera.position);
  if(isMobile) resetMobileView();

  // whisper intervals
  clearInterval(whisperInterval);
  whisperInterval=setInterval(()=>{ if(gameState.currentFloor===2 && Math.random()<0.42) audio.playWhisper(); }, 4200 + Math.random()*3500);

  updateInventoryUI();
}

function searchFurniture(group){
  if(group.userData.searched) return;
  group.userData.searched=true;
  audio.playDoorSlam();
  // 1 in 4 chance
  if(!gameState.keySpawned && Math.random()<0.25){
    spawnKeyAt(group.position);
  } else if(!gameState.keySpawned && furnitureGroups.filter(g=>g.userData.searched).length >=3){
    // guarantee after 3 searches if not spawned
    if(Math.random()<0.6) spawnKeyAt(group.position);
  }
  // random whisper maybe
  if(Math.random()<0.3) audio.playWhisper();
  if(gameState.keySpawned) setQuest('Key found! Check inventory for code.');
}

function spawnKeyAt(pos){
  gameState.keySpawned=true;
  const keyMesh=new THREE.Group(); keyMesh.position.set(pos.x, 0.55, pos.z);
  // key model
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.35,8), new THREE.MeshStandardMaterial({color:0xffd700, metalness:0.8, roughness:0.2}));
  stem.rotation.z=Math.PI/2; keyMesh.add(stem);
  const head=new THREE.Mesh(new THREE.TorusGeometry(0.075,0.02,8,14), new THREE.MeshStandardMaterial({color:0xffd700, metalness:0.9}));
  head.position.x=-0.18; keyMesh.add(head);
  const teeth=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.06,0.02), new THREE.MeshStandardMaterial({color:0xffd700}));
  teeth.position.set(0.16,0.02,0); keyMesh.add(teeth);
  keyMesh.userData={type:'key'}; keyMesh.castShadow=true;
  // floating animation data
  keyMesh.userData.floatBase=pos.y+0.55;
  scene.add(keyMesh);
  interactables.push({mesh:keyMesh, type:'key', prompt:'Take key (reveals code)'});
  // particle glow
  const glow=new THREE.PointLight(0xffd700,1.2,2); glow.position.copy(keyMesh.position); keyMesh.add(glow);
}

function takeKey(meshGroup){
  gameState.hasKey=true; if(!gameState.inventory.includes('Key')) gameState.inventory.push('Key');
  updateInventoryUI();
  // remove from interactables
  interactables = interactables.filter(i=>i.mesh!==meshGroup);
  scene.remove(meshGroup);
  document.getElementById('codeHint').textContent = `CODE IS: ${gameState.safeCode} — Remember it!`;
  showCodeDisplay(gameState.safeCode);
  setQuest(`Code revealed: ${gameState.safeCode} — Open the safe!`);
  audio.playThud();
}

let isSafeOpen=false;
function openSafePrompt(){
  isSafeOpen=true;
  if(isMobile) isPointerLocked=false; else controls.unlock();
  document.getElementById('safeModal').classList.remove('hidden');
  document.getElementById('safeInput').value=''; document.getElementById('safeMsg').textContent=''; document.getElementById('safeInput').focus();
  if(!gameState.hasKey) document.getElementById('codeHint').textContent='You need a Key to know the code. Search furniture.';
  else document.getElementById('codeHint').textContent=`CODE IS: ${gameState.safeCode}`;
}
function closeSafePrompt(){
  isSafeOpen=false; document.getElementById('safeModal').classList.add('hidden');
  if(isMobile){ isPointerLocked=true; syncMobileYawPitch(); } else controls.lock();
}
function submitSafe(){
  const val=document.getElementById('safeInput').value.toUpperCase().trim();
  const msg=document.getElementById('safeMsg');
  if(val===gameState.safeCode){
    msg.style.color='#00ff66'; msg.textContent='UNLOCKED!';
    gameState.safeOpened=true;
    // open safe visually
    let p=0; const int=setInterval(()=>{ p+=0.08; safeDoor.rotation.y = -p*1.8; safeDoor.position.x = -p*0.5; if(p>=1){clearInterval(int); // spawn note
        const note=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.4), new THREE.MeshStandardMaterial({color:0xffffcc})); note.position.set(0,0.1,0.15); note.rotation.y=0; safeGroup.add(note);
      }},20);
    safeGroup.userData.light.color.set(0x00ff00); safeGroup.userData.light.intensity=2.5;
    elevatorGroup.userData.light.color.set(0x00ff00); elevatorGroup.userData.light.intensity=4;
    // also open elevator doors slightly green
    elevatorDoors.forEach(d=> d.material.emissive=new THREE.Color(0x00ff00), d.material.emissiveIntensity=0.25);
    setQuest('Safe opened! The elevator is now green. Enter it.');
    hideCodeDisplay();
    audio.playThud();
    setTimeout(closeSafePrompt, 900);
  } else {
    msg.style.color='#ff3333'; msg.textContent='WRONG CODE! Door slams.';
    audio.playDoorSlam();
    // slam animation
    safeDoor.position.z=0.26; safeDoor.rotation.y=0;
    let slam=0; const int=setInterval(()=>{ slam+=0.2; safeDoor.position.z=0.26+Math.sin(slam*10)*0.02; if(slam>2) clearInterval(int); },16);
  }
}
document.getElementById('safeSubmit').addEventListener('click', submitSafe);
document.getElementById('safeCancel').addEventListener('click', closeSafePrompt);
document.getElementById('safeInput').addEventListener('keydown', e=>{ if(e.key==='Enter') submitSafe(); if(e.key==='Escape') closeSafePrompt(); });

async function tryEnterElevatorF2(){
  if(!gameState.safeOpened){ setQuest('Safe is locked. Find the key and code first.'); audio.playDoorSlam(); return; }
  gameState.inTransition=true;
  // Elevator scene transition
  // Doors open
  let p=0; const int=setInterval(()=>{ p+=0.07; elevatorDoors[0].position.x=-0.39 -p*0.9; elevatorDoors[1].position.x=0.39 +p*0.9; if(p>=1) clearInterval(int); },30);
  audio.playFlickerSound();
  // flicker lights
  let flick=0; const flickInt=setInterval(()=>{ flashlight.intensity= Math.random()>0.45? 20:2; ambient.intensity=Math.random()>0.5?1:0.2; flick++; if(flick>14){clearInterval(flickInt); flashlight.intensity=6; }},90);
  await new Promise(r=>setTimeout(r,1600));
  audio.playDistortedGlitch();
  // black 2 seconds
  blackFade.classList.add('active'); elevatorText.classList.remove('hidden'); elevatorText.textContent='ELEVATOR MALFUNCTION...';
  await new Promise(r=>setTimeout(r,2000));
  audio.playLaugh();
  blackFade.classList.remove('active'); elevatorText.classList.add('hidden');
  // red flash
  redFlash.style.opacity='0.85'; setTimeout(()=> redFlash.style.opacity='0', 380);
  // open to corridor flash
  await new Promise(r=>setTimeout(r,500));
  buildFloor662(); gameState.inTransition=false; blackFade.classList.remove('active');
}

// Floor 662 - Chase - enhanced horror corridor
function buildFloor662(){
  clearInterval(whisperInterval);
  clearScene(); hideCodeDisplay(); gameState.currentFloor=662; floorIndicator.textContent='FLOOR: 662 — RUN!';
  setQuest('RUN!'); scene.fog = new THREE.Fog(0x020202, 4, 28);
  // corridor
  corridorGroup=new THREE.Group();
  const corrLen=110; const corrW=3.2; const corrH=3.0;
  // floor - dark tiles with blood trails
  const floorTex=createFloorTexture(); floorTex.repeat.set(1,14); floorTex.offset.set(0,0);
  const floorMat=new THREE.MeshStandardMaterial({map:floorTex, roughness:0.92, color:0x222222});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(corrW, corrLen), floorMat); floor.rotation.x=-Math.PI/2; floor.position.z=corrLen/2 -12; floor.receiveShadow=true; corridorGroup.add(floor);
  // blood streak down center
  for(let i=0;i<5;i++){ const streak=new THREE.Mesh(new THREE.PlaneGeometry(0.45, 18), new THREE.MeshStandardMaterial({color:0x7a0a0a, transparent:true, opacity:0.55, roughness:0.4})); streak.rotation.x=-Math.PI/2; streak.rotation.z=(Math.random()-0.5)*0.2; streak.position.set((Math.random()-0.5)*0.6, 0.015, 18+i*14); corridorGroup.add(streak); }
  const ceil=new THREE.Mesh(new THREE.PlaneGeometry(corrW, corrLen), new THREE.MeshStandardMaterial({color:0x080808, roughness:0.95})); ceil.rotation.x=Math.PI/2; ceil.position.set(0,corrH,corrLen/2-12); corridorGroup.add(ceil);
  // walls - with plaster texture
  const wallTex=createWallTexture(['RUN','HE IS BEHIND YOU','DON\'T STOP','']);
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex, roughness:0.92, color:0xaaaaaa});
  const leftWall=new THREE.Mesh(new THREE.BoxGeometry(0.26,corrH,corrLen), wallMat); leftWall.position.set(-corrW/2, corrH/2, corrLen/2-12); leftWall.receiveShadow=true; corridorGroup.add(leftWall);
  const rightWall=new THREE.Mesh(new THREE.BoxGeometry(0.26,corrH,corrLen), wallMat); rightWall.position.set(corrW/2, corrH/2, corrLen/2-12); rightWall.receiveShadow=true; corridorGroup.add(rightWall);
  // base pipes along walls
  for(let side of [-1,1]){ const pipe=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,corrLen,8), new THREE.MeshStandardMaterial({color:0x2a2a2a, metalness:0.7, roughness:0.4})); pipe.rotation.x=Math.PI/2; pipe.position.set(side*(corrW/2-0.12), 0.28, corrLen/2-12); corridorGroup.add(pipe); }
  // lights flickering strips - more realistic with housing
  for(let i=0;i<9;i++){
    const z=i*12-4; const light=new THREE.PointLight(0xffaa88, 1.4, 9); light.position.set(0,2.68, z); light.castShadow=true; light.shadow.mapSize.set(512,512); corridorGroup.add(light);
    const housing=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.12,0.65), new THREE.MeshStandardMaterial({color:0x1a1a1a, metalness:0.5})); housing.position.set(0,2.92,z); corridorGroup.add(housing);
    const bulb=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.02,0.55), new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffccaa, emissiveIntensity:0.85})); bulb.position.set(0,2.86,z); corridorGroup.add(bulb);
    // flicker wire
    const wire=new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.16,6), new THREE.MeshStandardMaterial({color:0x111111})); wire.position.set(0,2.98,z); corridorGroup.add(wire);
  }
  // branching doors / dead ends
  for(let i=0;i<6;i++){ const side=i%2===0? -1:1; const z=18 + i*12; const doorFrame=new THREE.Mesh(new THREE.BoxGeometry(0.12,2.1,1.1), new THREE.MeshStandardMaterial({color:0x1a0f05})); doorFrame.position.set(side*1.52,1.05,z); corridorGroup.add(doorFrame);
    const door=new THREE.Mesh(new THREE.BoxGeometry(0.06,2.0,0.95), new THREE.MeshStandardMaterial({color:0x2e1a0a, roughness:0.85})); door.position.set(side*1.48,1.05,z); door.rotation.y= side*0.18; corridorGroup.add(door);
    // door handle
    const dh=new THREE.Mesh(new THREE.SphereGeometry(0.05,8,8), new THREE.MeshStandardMaterial({color:0x444444, metalness:0.8})); dh.position.set(side*1.45,1.05,z+0.22); corridorGroup.add(dh);
  }
  scene.add(corridorGroup);

  // wardrobe blocking path at z=42 - detailed double wardrobe (Group at world y 1.1)
  wardrobeBlock=new THREE.Group(); wardrobeBlock.position.set(0,1.1,42);
  const wBody=new THREE.Mesh(new THREE.BoxGeometry(2.65,2.25,0.95), new THREE.MeshStandardMaterial({color:0x3a2510, roughness:0.78})); wBody.position.y=0; wBody.castShadow=true; wBody.receiveShadow=true; wardrobeBlock.add(wBody);
  const wdL=new THREE.Mesh(new THREE.BoxGeometry(1.28,2.15,0.06), new THREE.MeshStandardMaterial({color:0x4a3218})); wdL.position.set(-0.66,0,0.5); wardrobeBlock.add(wdL);
  const wdR=new THREE.Mesh(new THREE.BoxGeometry(1.28,2.15,0.06), new THREE.MeshStandardMaterial({color:0x4a3218})); wdR.position.set(0.66,0,0.5); wardrobeBlock.add(wdR);
  for(let s of [-0.4,0.4]){ const h=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.35,8), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.7})); h.position.set(s,0.05,0.54); wardrobeBlock.add(h); }
  corridorGroup.add(wardrobeBlock);
  wardrobeBlock.userData.fallen=false;
  wardrobeBlock.userData.baseY=1.1;

  // chandelier above near wardrobe (will fall) - ornate
  chandelierMesh=new THREE.Group(); chandelierMesh.position.set(0,3.75, 39);
  const chain=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,1.15,8), new THREE.MeshStandardMaterial({color:0x1a1a1a, metalness:0.8})); chain.position.y=-0.58; chandelierMesh.add(chain);
  const chain2=chain.clone(); chain2.position.x=0.22; chain2.position.z=0.12; chandelierMesh.add(chain2);
  const chain3=chain.clone(); chain3.position.x=-0.22; chain3.position.z=0.12; chandelierMesh.add(chain3);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.05,10,20), new THREE.MeshStandardMaterial({color:0x8a7a5a, metalness:0.75, roughness:0.35})); ring.rotation.x=Math.PI/2; ring.position.y=-1.22; chandelierMesh.add(ring);
  const chand=new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.78,0.32,10), new THREE.MeshStandardMaterial({color:0x8a7a5a, metalness:0.7, roughness:0.32, emissive:0x221100, emissiveIntensity:0.22})); chand.position.y=-1.28; chand.castShadow=true; chandelierMesh.add(chand);
  for(let i=0;i<6;i++){ const c=new THREE.Mesh(new THREE.SphereGeometry(0.095,10,10), new THREE.MeshStandardMaterial({color:0xffddaa, emissive:0xffaa88, emissiveIntensity:0.95})); const ang=i/6*Math.PI*2; c.position.set(Math.cos(ang)*0.48, -1.23, Math.sin(ang)*0.48); chandelierMesh.add(c);
    const cry=new THREE.Mesh(new THREE.ConeGeometry(0.04,0.18,6), new THREE.MeshStandardMaterial({color:0xffffff, transparent:true, opacity:0.85, roughness:0.05})); cry.position.set(Math.cos(ang)*0.48, -1.42, Math.sin(ang)*0.48); cry.rotation.x=Math.PI; chandelierMesh.add(cry);
  }
  const centerLight=new THREE.PointLight(0xffcc88, 1.2, 6); centerLight.position.set(0,-1.28,0); chandelierMesh.add(centerLight);
  corridorGroup.add(chandelierMesh);
  chandelierMesh.userData.falling=false;

  // Monster - more horror: twisted body with spine, arms, head
  monsterGroup=new THREE.Group(); monsterGroup.position.set(0,1.35, -14);
  const monsterMat=new THREE.MeshStandardMaterial({color:0x8a0a0a, emissive:0xff0a0a, emissiveIntensity:0.85, roughness:0.35, metalness:0.15});
  const fleshMat=new THREE.MeshStandardMaterial({color:0x4a0a0a, roughness:0.8});
  // torso
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(0.42,0.85,6,12), monsterMat); torso.position.y=0.15; torso.castShadow=true; monsterGroup.add(torso);
  // head - elongated
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.32,12,12), monsterMat); head.position.set(0,0.85,0.12); head.scale.set(1,1.3,0.9); head.castShadow=true; monsterGroup.add(head);
  // jaw
  const jaw=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.18,0.22), new THREE.MeshStandardMaterial({color:0x111111, roughness:0.9})); jaw.position.set(0,0.62,0.32); monsterGroup.add(jaw);
  // teeth
  for(let i=0;i<6;i++){ const t=new THREE.Mesh(new THREE.ConeGeometry(0.025,0.09,5), new THREE.MeshStandardMaterial({color:0xffffee})); t.position.set(-0.12+i*0.048,0.66,0.44); t.rotation.x=Math.PI; monsterGroup.add(t); }
  // arms long
  const armL=new THREE.Mesh(new THREE.CapsuleGeometry(0.11,0.7,6,10), fleshMat); armL.position.set(-0.55,0.18,0); armL.rotation.z=0.45; armL.rotation.x=0.2; monsterGroup.add(armL);
  const armR=armL.clone(); armR.position.x=0.55; armR.rotation.z=-0.45; monsterGroup.add(armR);
  // claw hands
  for(let side of [-0.85,0.85]){ for(let f=0;f<3;f++){ const claw=new THREE.Mesh(new THREE.ConeGeometry(0.02,0.16,5), new THREE.MeshStandardMaterial({color:0x111111})); claw.position.set(side, -0.22, 0.12+f*0.04); claw.rotation.x=-0.6; monsterGroup.add(claw); } }
  // distorted spine plates
  for(let i=0;i<7;i++){
    const plate=new THREE.Mesh(new THREE.BoxGeometry(0.18+Math.random()*0.1,0.12,0.08), monsterMat); plate.position.set((Math.random()-0.5)*0.15, -0.35+i*0.14, -0.32); plate.rotation.x=(Math.random()-0.5)*0.4; monsterGroup.add(plate);
  }
  // random flesh chunks
  for(let i=0;i<8;i++){
    const size=0.22+Math.random()*0.28;
    const chunk=new THREE.Mesh(new THREE.DodecahedronGeometry(size*0.55,0), fleshMat); chunk.position.set((Math.random()-0.5)*0.9, (Math.random()-0.5)*0.9+0.1, (Math.random()-0.5)*0.35); chunk.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,0); monsterGroup.add(chunk);
  }
  // eyes that follow camera - more eyes
  for(let e=0;e<8;e++){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.095,12,12), new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffffff, emissiveIntensity:0.95}));
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(0.052,10,10), new THREE.MeshStandardMaterial({color:0xff0000, emissive:0xff0000, emissiveIntensity:0.8}));
    pupil.position.z=0.06; eye.add(pupil);
    // veins
    eye.position.set((Math.random()-0.5)*1.0, 0.35 + Math.random()*0.75, 0.32+Math.random()*0.18);
    eye.userData.isEye=true; monsterGroup.add(eye);
  }
  monsterGroup.userData.eyes= monsterGroup.children.filter(c=>c.userData.isEye);
  scene.add(monsterGroup);

  gameState.monsterPos=-14; gameState.monsterActive=true; gameState.chaseStarted=true; gameState.wardrobeFallen=false; gameState.chandelierDropped=false;
  camera.position.set(0, playerHeight, -6); controls.getObject().position.copy(camera.position);
  if(isMobile) resetMobileView();
  chromatic.style.opacity='0.18';
  // start chase audio loop
  audio.playScreech(0.6);
  setQuest('RUN! — W A S D — Don\'t look back!');
}

function updateChase(dt){
  if(!gameState.chaseStarted || gameState.currentFloor!==662) return;
  // player move speed slightly higher if moving forward
  const playerZ = camera.position.z;
  // monster chases
  const speed = 4.2 + (playerZ - gameState.monsterPos)/30; // faster when far
  gameState.monsterPos += speed * dt;
  monsterGroup.position.z = gameState.monsterPos;
  // monster shake
  monsterGroup.position.x = Math.sin(performance.now()*0.02)*0.18;
  monsterGroup.rotation.z = Math.sin(performance.now()*0.015)*0.18;
  // eyes follow camera
  monsterGroup.userData.eyes?.forEach(eye=>{
    eye.lookAt(camera.position);
  });
  // chromatic intensity based on distance
  const dist = playerZ - gameState.monsterPos;
  const intensity = Math.max(0, 1 - dist/22);
  chromatic.style.opacity = (0.12 + intensity*0.55).toString();
  chromatic.style.filter = `blur(${intensity*1.2}px)`;
  // wardrobe trigger when player near 35
  if(playerZ > 34 && !gameState.wardrobeFallen){
    triggerWardrobeFall();
  }
  // chandelier drop when monster close to wardrobe and player turned
  if(gameState.wardrobeFallen && !gameState.chandelierDropped && gameState.monsterPos > 32){
    triggerChandelier();
  }
  // if monster reaches player (dist <1.1) before chandelier drops, still trigger chandelier as rescue
  if(dist < 1.2 && !gameState.chandelierDropped){
    triggerChandelier();
  }
  // camera shake based on proximity
  if(dist < 12){
    camera.position.x += (Math.random()-0.5)*0.03*intensity;
    camera.position.y += (Math.random()-0.5)*0.02*intensity;
    if(Math.random()<0.08) audio.playScreech(0.25);
  }
}

function triggerWardrobeFall(){
  gameState.wardrobeFallen=true;
  audio.playThud();
  let prog=0; const startY=wardrobeBlock.position.y; const startZ=wardrobeBlock.position.z;
  const fallInt=setInterval(()=>{ prog+=0.07; wardrobeBlock.rotation.x = -prog*1.6; wardrobeBlock.position.y = startY - prog*0.9; wardrobeBlock.position.z = startZ + prog*0.25; if(prog>=1){ clearInterval(fallInt); wardrobeBlock.position.y=0.55; setQuest('PATH BLOCKED! TURN AROUND!'); }
  },16);
  // block colliders
}

function triggerChandelier(){
  if(gameState.chandelierDropped) return;
  gameState.chandelierDropped=true;
  chandelierMesh.userData.falling=true;
  audio.playThud(); audio.playScreech(1.0);
  // shake
  let prog=0; const startY=chandelierMesh.position.y;
  const fall=setInterval(()=>{ prog+=0.085; chandelierMesh.position.y = startY - prog*5.2; chandelierMesh.rotation.z += 0.18; chandelierMesh.rotation.x +=0.12;
    if(chandelierMesh.position.y <= 0.55){ clearInterval(fall); chandelierMesh.position.y=0.55;
      // crush effect
      monsterGroup.visible=false;
      // intense shake + red flash
      redFlash.style.opacity='0.9'; setTimeout(()=> redFlash.style.opacity='0', 250);
      camera.position.y+=0.12;
      // stop chase
      gameState.chaseStarted=false; gameState.monsterActive=false; chromatic.style.opacity='0';
      setTimeout(()=>{ doFadeTransition(()=>{ buildElevatorToFloor3(); }); }, 900);
    }
  },16);
}

function buildElevatorToFloor3(){
  clearScene(); gameState.currentFloor=0; floorIndicator.textContent='FLOOR: ELEVATOR';
  elevatorText.classList.remove('hidden'); elevatorText.textContent='ELEVATOR MOVING TO FLOOR 3...';
  blackFade.classList.remove('active');
  // simple elevator interior
  const group=new THREE.Group();
  const box=new THREE.Mesh(new THREE.BoxGeometry(3,2.6,3), new THREE.MeshStandardMaterial({color:0x1a1a1a, side:THREE.BackSide})); group.add(box);
  const light=new THREE.PointLight(0xffeecc, 3, 6); light.position.set(0,2.4,0); group.add(light);
  scene.add(group);
  camera.position.set(0,playerHeight,0);
  setTimeout(()=>{ elevatorText.classList.add('hidden'); buildFloor3(); }, 1700);
}

// Floor 3 - Toy
let bearStage=0; //0 before bed,1 on bed,2 vanished,3 in sink
function buildFloor3(){
  clearScene(); hideCodeDisplay(); gameState.currentFloor=3; bearStage=0; floorIndicator.textContent='FLOOR: 3 - THE TOY';
  setQuest('FIND THE TOY.');
  const tex=createWallTexture(['LEAVE','SHE IS HERE','WHAT DID YOU DO?','']);
  addWallsRoom(12,3.2,10, tex);
  scene.fog = new THREE.Fog(0x0a0808, 9, 24);
  // Bed - detailed with frame, mattress, pillows
  const bedGroup=new THREE.Group(); bedGroup.position.set(-3.5,0,-2.5);
  const bedFrame=new THREE.Mesh(new THREE.BoxGeometry(2.05,0.32,1.2), new THREE.MeshStandardMaterial({color:0x4a2a2a, roughness:0.85})); bedFrame.position.y=0.16; bedFrame.castShadow=true; bedFrame.receiveShadow=true; bedGroup.add(bedFrame);
  const mattress=new THREE.Mesh(new THREE.BoxGeometry(1.95,0.16,1.08), new THREE.MeshStandardMaterial({color:0xe8e0d0, roughness:0.95})); mattress.position.y=0.40; bedGroup.add(mattress);
  const pillow1=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.12,0.42), new THREE.MeshStandardMaterial({color:0xffffff})); pillow1.position.set(-0.65,0.52,0); bedGroup.add(pillow1);
  const pillow2=pillow1.clone(); pillow2.position.set(0.65,0.52,0); bedGroup.add(pillow2);
  const sheet=new THREE.Mesh(new THREE.PlaneGeometry(1.7,0.95), new THREE.MeshStandardMaterial({color:0x8a1a1a, roughness:0.85})); sheet.rotation.x=-Math.PI/2; sheet.position.set(0,0.49,0.06); bedGroup.add(sheet);
  const headboard=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.75,1.22), new THREE.MeshStandardMaterial({color:0x2e1a0f, roughness:0.8})); headboard.position.set(-1.02,0.52,0); headboard.castShadow=true; bedGroup.add(headboard);
  scene.add(bedGroup); colliders.push(bedFrame);
  // Nightstand
  const nightstand=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.5), new THREE.MeshStandardMaterial({color:0x3d2b1a})); nightstand.position.set(-3.5,0.275, -1.55); nightstand.castShadow=true; scene.add(nightstand);
  const lampN=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.08,0.25,10), new THREE.MeshStandardMaterial({color:0x222222, emissive:0xffaa77, emissiveIntensity:0.18})); lampN.position.set(-3.5,0.68,-1.55); scene.add(lampN);
  // Desk + chair
  const desk=new THREE.Mesh(new THREE.BoxGeometry(1.35,0.06,0.7), new THREE.MeshStandardMaterial({color:0x3d2b1a, roughness:0.8})); desk.position.set(3.2,0.74,2.8); desk.castShadow=true; scene.add(desk);
  for(let x of [-0.6,0.6]) for(let z of [-0.28,0.28]){ const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.74,6), new THREE.MeshStandardMaterial({color:0x1a0f05})); leg.position.set(3.2+x,0.37,2.8+z); leg.castShadow=true; scene.add(leg); }
  const chair=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.08,0.5), new THREE.MeshStandardMaterial({color:0x2a1a0f})); chair.position.set(3.2,0.44,2.1); scene.add(chair);
  const chairBack=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.5,0.05), new THREE.MeshStandardMaterial({color:0x2a1a0f})); chairBack.position.set(3.2,0.7,1.88); scene.add(chairBack);
  colliders.push(desk);
  // bathroom partition with tiles
  const bathWall=new THREE.Mesh(new THREE.BoxGeometry(5,3.2,0.18), new THREE.MeshStandardMaterial({color:0x8a0f0f, roughness:0.7})); bathWall.position.set(0,1.6,4.2); bathWall.receiveShadow=true; scene.add(bathWall);
  // tile pattern overlay
  const tileTex=createBloodFloorTexture(); tileTex.repeat.set(3,2);
  const tileOverlay=new THREE.Mesh(new THREE.PlaneGeometry(4.6,2.8), new THREE.MeshStandardMaterial({map:tileTex, transparent:true, opacity:0.9})); tileOverlay.position.set(0,1.6,4.11); scene.add(tileOverlay);
  const sink=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.45,0.62), new THREE.MeshStandardMaterial({color:0xe8e8e8, roughness:0.15, metalness:0.05})); sink.position.set(1.8,0.72,3.6); sink.castShadow=true; sink.receiveShadow=true; scene.add(sink);
  const faucet=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.18,8), new THREE.MeshStandardMaterial({color:0x888888, metalness:0.85})); faucet.rotation.z=Math.PI/2; faucet.position.set(1.82,1.02,3.42); scene.add(faucet);
  const sinkLiquid=new THREE.Mesh(new THREE.PlaneGeometry(0.78,0.48), new THREE.MeshStandardMaterial({color:0x7a0a0a, emissive:0x330000, emissiveIntensity:0.55, roughness:0.2})); sinkLiquid.rotation.x=-Math.PI/2; sinkLiquid.position.set(1.8,0.95,3.6); scene.add(sinkLiquid);
  // blood drips down sink front
  for(let i=0;i<3;i++){ const drip=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.18+Math.random()*0.12,0.01), new THREE.MeshStandardMaterial({color:0x7a0a0a})); drip.position.set(1.72+i*0.08,0.62,3.91); scene.add(drip); }
  scene.userData.sinkPos=new THREE.Vector3(1.8,0.95,3.6);
  // elevator - improved
  elevatorGroup=new THREE.Group(); elevatorGroup.position.set(5.0,0, -3.8);
  elevatorGroup.rotation.y = Math.PI;
  const eBox=new THREE.Mesh(new THREE.BoxGeometry(1.7,2.35,1.35), new THREE.MeshStandardMaterial({color:0x222222, metalness:0.55, roughness:0.4})); eBox.position.y=1.175; eBox.castShadow=true; elevatorGroup.add(eBox);
  const lD=new THREE.Mesh(new THREE.BoxGeometry(0.82,2.1,0.08), new THREE.MeshStandardMaterial({color:0x444444, metalness:0.65})); lD.position.set(-0.41,1.15,0.70); lD.castShadow=true; elevatorGroup.add(lD);
  const rD=new THREE.Mesh(new THREE.BoxGeometry(0.82,2.1,0.08), new THREE.MeshStandardMaterial({color:0x444444, metalness:0.65})); rD.position.set(0.41,1.15,0.70); rD.castShadow=true; elevatorGroup.add(rD);
  elevatorDoors=[lD,rD]; const eLight=new THREE.PointLight(0xff3333,2.2,3.2); eLight.position.set(0,2.3,0.4); elevatorGroup.add(eLight); elevatorGroup.userData.light=eLight;
  const eTrim=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.08,0.08), new THREE.MeshStandardMaterial({color:0x0a0a0a})); eTrim.position.set(0,2.33,0.72); elevatorGroup.add(eTrim);
  scene.add(elevatorGroup);
  interactables.push({mesh:eBox, type:'elevatorF3', prompt:'Enter elevator to Floor 4'});

  // Bear on bed trigger proximity - normal
  bedBearMesh = createBearMesh(false); bedBearMesh.position.set(-3.5,0.62,-2.5); bedBearMesh.rotation.y=Math.PI/6; bedBearMesh.visible=false; bedBearMesh.userData.type='bearBed'; scene.add(bedBearMesh);
  // Bear in sink (hidden until stage 2) - bloody version
  sinkBearMesh = createBearMesh(true); sinkBearMesh.scale.set(0.9,0.9,0.9); sinkBearMesh.position.set(1.8,1.06,3.6); sinkBearMesh.rotation.y=-0.4; sinkBearMesh.visible=false; sinkBearMesh.userData.type='bearSink'; scene.add(sinkBearMesh);

  camera.position.set(0,playerHeight,2); controls.getObject().position.copy(camera.position);
  if(isMobile) resetMobileView();
  updateInventoryUI();
}

function createBearMesh(isBloody=false){
  const g=new THREE.Group();
  const furColor = isBloody ? 0x5a2e1a : 0x6b4423;
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.26,14,14), new THREE.MeshStandardMaterial({color:furColor, roughness:0.92})); body.scale.set(1,1.12,0.78); body.castShadow=true; g.add(body);
  const belly=new THREE.Mesh(new THREE.SphereGeometry(0.18,12,12), new THREE.MeshStandardMaterial({color:0x8a6a4a, roughness:0.9})); belly.position.set(0, -0.05,0.16); belly.scale.set(1,0.85,0.45); g.add(belly);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.195,14,14), new THREE.MeshStandardMaterial({color:0x7a5a3a, roughness:0.88})); head.position.set(0,0.30,0.12); head.castShadow=true; g.add(head);
  const snout=new THREE.Mesh(new THREE.SphereGeometry(0.075,10,10), new THREE.MeshStandardMaterial({color:0xcbb89a, roughness:0.9})); snout.position.set(0,0.24,0.26); snout.scale.set(1,0.7,0.9); g.add(snout);
  const earGeom=new THREE.SphereGeometry(0.065,10,10);
  const earMat=new THREE.MeshStandardMaterial({color:0x5a3520, roughness:0.9});
  const e1=new THREE.Mesh(earGeom, earMat); e1.position.set(-0.12,0.41,0.08); g.add(e1);
  const e2=new THREE.Mesh(earGeom, earMat); e2.position.set(0.12,0.41,0.08); g.add(e2);
  const innerEar=new THREE.Mesh(new THREE.SphereGeometry(0.035,8,8), new THREE.MeshStandardMaterial({color:0x8a5a4a})); innerEar.position.set(0,0,0.04); e1.add(innerEar); e2.add(innerEar.clone());
  const eyeMat=new THREE.MeshStandardMaterial({color:isBloody?0xff0000:0x000000, emissive:isBloody?0x550000:0x000000, emissiveIntensity:isBloody?0.6:0});
  const eye1=new THREE.Mesh(new THREE.SphereGeometry(0.028,10,10), eyeMat); eye1.position.set(-0.065,0.32,0.27); g.add(eye1);
  const eye2=new THREE.Mesh(new THREE.SphereGeometry(0.028,10,10), eyeMat); eye2.position.set(0.065,0.32,0.27); g.add(eye2);
  const eyeHigh=new THREE.Mesh(new THREE.SphereGeometry(0.008,6,6), new THREE.MeshStandardMaterial({color:0xffffff})); eyeHigh.position.set(0.008,0.008,0.018); eye1.add(eyeHigh); eye2.add(eyeHigh.clone());
  const nose=new THREE.Mesh(new THREE.SphereGeometry(0.022,8,8), new THREE.MeshStandardMaterial({color:0x111111, roughness:0.4})); nose.position.set(0,0.26,0.31); g.add(nose);
  // limbs
  const limbMat=new THREE.MeshStandardMaterial({color:furColor, roughness:0.9});
  const armL=new THREE.Mesh(new THREE.CapsuleGeometry(0.065,0.18,6,12), limbMat); armL.position.set(-0.22,0.05,0); armL.rotation.z=0.55; armL.castShadow=true; g.add(armL);
  const armR=armL.clone(); armR.position.x=0.22; armR.rotation.z=-0.55; g.add(armR);
  const legL=new THREE.Mesh(new THREE.CapsuleGeometry(0.075,0.16,6,12), limbMat); legL.position.set(-0.13,-0.22,0.02); legL.castShadow=true; g.add(legL);
  const legR=legL.clone(); legR.position.x=0.13; g.add(legR);
  // red bow
  const bow=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.05,0.02), new THREE.MeshStandardMaterial({color:0xcc0000, roughness:0.6})); bow.position.set(0,0.20,0.23); g.add(bow);
  const bowC=new THREE.Mesh(new THREE.SphereGeometry(0.025,8,8), new THREE.MeshStandardMaterial({color:0xaa0000})); bowC.position.set(0,0.20,0.24); g.add(bowC);
  if(isBloody){
    // blood stains on body
    const stain=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8), new THREE.MeshStandardMaterial({color:0x7a0a0a, roughness:0.3, transparent:true, opacity:0.85}));
    stain.position.set(0.08,-0.08,0.2); stain.scale.set(1,0.6,0.3); g.add(stain);
  }
  g.castShadow=true;
  return g;
}

function updateFloor3Proximity(){
  if(gameState.currentFloor!==3) return;
  const distBed = camera.position.distanceTo(new THREE.Vector3(-3.5,0.55,-2.5));
  if(bearStage===0 && distBed < 2.8){
    bearStage=1; bedBearMesh.visible=true; interactables.push({mesh:bedBearMesh, type:'bearBed', prompt:'Pick up Teddy Bear'});
    // slight flicker
    flashlight.intensity= 18;
    setTimeout(()=> flashlight.intensity=28, 180);
  }
  const distSink = camera.position.distanceTo(new THREE.Vector3(1.8,1.05,3.6));
  if(bearStage===2 && distSink < 2.2 && !sinkBearMesh.visible){
    sinkBearMesh.visible=true; interactables.push({mesh:sinkBearMesh, type:'bearSink', prompt:'Take Teddy Bear from sink (blood)'});
    // blood drip sound
    if(Math.random()<0.5) audio.playWhisper();
  }
}

function clickBearBed(){
  audio.playScreech(1.1); audio.playLaugh();
  // vanish with red flash
  redFlash.style.opacity='0.55'; setTimeout(()=> redFlash.style.opacity='0', 220);
  bedBearMesh.visible=false; interactables=interactables.filter(i=>i.mesh!==bedBearMesh);
  bearStage=2;
  // shake
  camera.position.x+= (Math.random()-0.5)*0.12;
  setQuest('It vanished! Check the bathroom sink...');
  flashlight.intensity=8; setTimeout(()=> flashlight.intensity=28, 600);
}

function clickBearSink(){
  audio.playThud(); audio.playLaugh();
  sinkBearMesh.visible=false; interactables=interactables.filter(i=>i.mesh!==sinkBearMesh);
  gameState.hasToy=true; if(!gameState.inventory.includes('Teddy')) gameState.inventory.push('Teddy');
  // key spawns in sink if not already hasKey - this is the key for final door
  if(!gameState.hasKey){
    gameState.hasKey=true; if(!gameState.inventory.includes('Key')) gameState.inventory.push('Key');
    setQuest('Found Teddy and a rusty Key in the blood! Go to Floor 4.');
  } else {
    setQuest('Teddy acquired! Elevator now active. Go to Floor 4.');
  }
  updateInventoryUI();
  bearStage=3;
  // turn elevator green
  elevatorGroup.userData.light.color.set(0x00ff00); elevatorGroup.userData.light.intensity=3.5;
  elevatorDoors.forEach(d=>{ d.material.emissive=new THREE.Color(0x00ff00); d.material.emissiveIntensity=0.3; });
}

// Floor 4 - Final Door
function buildFloor4(){
  clearScene(); hideCodeDisplay(); gameState.currentFloor=4; floorIndicator.textContent='FLOOR: 4 - THE FINAL DOOR';
  setQuest('OPEN THE DOOR.');
  const tex=createWallTexture(['NO ESCAPE','TURN BACK','']);
  addWallsRoom(8,3.4,8, tex);
  scene.fog = new THREE.Fog(0x000000, 6, 18);
  ambient.intensity=0.4;

  finalDoorGroup=new THREE.Group(); finalDoorGroup.position.set(0,1.15, -3.6);
  const frame=new THREE.Mesh(new THREE.BoxGeometry(1.78,2.55,0.24), new THREE.MeshStandardMaterial({color:0x0a0a0a, metalness:0.72, roughness:0.38}));
  frame.castShadow=true; frame.receiveShadow=true; finalDoorGroup.add(frame);
  // arch top
  const arch=new THREE.Mesh(new THREE.CylinderGeometry(0.89,0.89,0.24,16,1,false,0,Math.PI), new THREE.MeshStandardMaterial({color:0x0a0a0a, metalness:0.7}));
  arch.rotation.z=Math.PI/2; arch.rotation.x=Math.PI/2; arch.position.set(0,2.35,0); finalDoorGroup.add(arch);
  finalDoorMesh=new THREE.Mesh(new THREE.BoxGeometry(1.44,2.22,0.09), new THREE.MeshStandardMaterial({color:0x1e1e1e, metalness:0.82, roughness:0.28}));
  finalDoorMesh.position.set(0,0,0.16); finalDoorMesh.castShadow=true; finalDoorGroup.add(finalDoorMesh);
  // door panels with carved runes
  const panelV=new THREE.Mesh(new THREE.BoxGeometry(0.02,1.9,0.01), new THREE.MeshStandardMaterial({color:0x2a2a2a})); panelV.position.set(0,0,0.21); finalDoorGroup.add(panelV);
  const panelH=new THREE.Mesh(new THREE.BoxGeometry(1.2,0.02,0.01), new THREE.MeshStandardMaterial({color:0x2a2a2a})); panelH.position.set(0,0.25,0.21); finalDoorGroup.add(panelH);
  // eye carving
  const eyeCarve=new THREE.Mesh(new THREE.SphereGeometry(0.18,12,12), new THREE.MeshStandardMaterial({color:0x3a0a0a, emissive:0x550000, emissiveIntensity:0.35, roughness:0.7})); eyeCarve.position.set(0,0.45,0.22); eyeCarve.scale.set(1,0.7,0.4); finalDoorGroup.add(eyeCarve);
  const pupilCarve=new THREE.Mesh(new THREE.SphereGeometry(0.07,10,10), new THREE.MeshStandardMaterial({color:0x000000})); pupilCarve.position.set(0,0.45,0.25); finalDoorGroup.add(pupilCarve);
  // blood drip on door
  for(let i=0;i<4;i++){ const drip=new THREE.Mesh(new THREE.BoxGeometry(0.025,0.35+Math.random()*0.25,0.01), new THREE.MeshStandardMaterial({color:0x7a0a0a})); drip.position.set(-0.45+i*0.30, -0.2,0.21); finalDoorGroup.add(drip); }
  const handle=new THREE.Mesh(new THREE.SphereGeometry(0.095,14,14), new THREE.MeshStandardMaterial({color:0xffd700, metalness:0.92, roughness:0.18})); handle.position.set(0.52,0,0.24); handle.castShadow=true; finalDoorGroup.add(handle);
  const handleBase=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,0.04,12), new THREE.MeshStandardMaterial({color:0x111111, metalness:0.85})); handleBase.rotation.x=Math.PI/2; handleBase.position.set(0.52,0,0.19); finalDoorGroup.add(handleBase);
  const doorLight=new THREE.PointLight(0xffffff,0,5); doorLight.position.set(0,1.0,0.7); finalDoorGroup.add(doorLight); finalDoorGroup.userData.light=doorLight;
  // floor blood pool before door
  const pool=new THREE.Mesh(new THREE.CircleGeometry(0.9,16), new THREE.MeshStandardMaterial({color:0x5a0a0a, roughness:0.3, transparent:true, opacity:0.7})); pool.rotation.x=-Math.PI/2; pool.position.set(0,-1.14,0.9); finalDoorGroup.add(pool);
  scene.add(finalDoorGroup);
  interactables.push({mesh:finalDoorMesh, type:'finalDoor', prompt: gameState.hasKey ? 'Open door (Key ready)' : 'Open door (Need Key from Floor 3 sink!)'});

  camera.position.set(0,playerHeight,2.5); controls.getObject().position.copy(camera.position);
  if(isMobile) resetMobileView();
  // subtle whisper
  setTimeout(()=> audio.playWhisper(), 1200);
}

function handleFinalDoor(){
  if(gameState.inTransition) return;
  if(!gameState.hasKey){
    // jumpscare
    doJumpscare();
    return;
  }
  // win - open door white light
  gameState.inTransition=true;
  let p=0; const int=setInterval(()=>{ p+=0.06; finalDoorMesh.rotation.y = -p*1.65; finalDoorMesh.position.x = -p*0.7; finalDoorGroup.userData.light.intensity = p*18; finalDoorGroup.userData.light.color.set(0xffffff);
    if(p>=1){ clearInterval(int); flashlight.intensity=40; ambient.intensity=2.2;
      blackFade.style.background='#ffffff'; blackFade.style.transition='opacity 1.2s';
      blackFade.classList.add('active');
      setTimeout(()=>{ showWinScreen(); blackFade.style.background='#000'; }, 1300);
    }
  },16);
  audio.playWin();
}

function doJumpscare(){
  const js=document.getElementById('jumpscare'); js.classList.remove('hidden');
  controls.unlock();
  const cvs=document.getElementById('jumpscareCanvas'); const ctx=cvs.getContext('2d');
  // generate grotesque face
  ctx.fillStyle='#000'; ctx.fillRect(0,0,cvs.width,cvs.height);
  // red face
  const grad=ctx.createRadialGradient(400,300,20,400,300,280);
  grad.addColorStop(0,'#ff2222'); grad.addColorStop(0.4,'#8a0a0a'); grad.addColorStop(1,'#1a0000');
  ctx.fillStyle=grad; ctx.beginPath(); ctx.ellipse(400,300,230,280,0,0,Math.PI*2); ctx.fill();
  // eyes white big
  ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.ellipse(315,225,62,48,0,0,Math.PI*2); ctx.ellipse(485,225,62,48,0,0,Math.PI*2); ctx.fill();
  // pupils small black
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(315,235,18,0,Math.PI*2); ctx.arc(485,235,18,0,Math.PI*2); ctx.fill();
  // veins
  ctx.strokeStyle='rgba(255,0,0,0.9)'; ctx.lineWidth=2;
  for(let i=0;i<12;i++){ ctx.beginPath(); ctx.moveTo(315+Math.cos(i)*18,235+Math.sin(i)*18); ctx.lineTo(315+Math.cos(i)*58,235+Math.sin(i)*42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(485+Math.cos(i)*18,235+Math.sin(i)*18); ctx.lineTo(485+Math.cos(i)*58,235+Math.sin(i)*42); ctx.stroke(); }
  // mouth black large
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.ellipse(400,420,95,70,0,0,Math.PI*2); ctx.fill();
  // teeth
  ctx.fillStyle='#e8e8e8'; for(let i=0;i<7;i++){ ctx.fillRect(333+i*19,385,12,22); ctx.fillRect(333+i*19,435,12,18); }
  // drip blood
  ctx.fillStyle='rgba(120,0,0,0.85)'; for(let i=0;i<6;i++){ const x=340+i*22; ctx.fillRect(x,490,4, 14+Math.random()*24); }
  // title text already
  audio.playScreech(1.6);
  // shake
  let s=0; const shakeInt=setInterval(()=>{ cvs.style.transform=`translate(${(Math.random()-0.5)*14}px,${(Math.random()-0.5)*10}px)`; s++; if(s>22){clearInterval(shakeInt); cvs.style.transform='';}},40);
}

function showWinScreen(){
  gameState.inTransition=false; clearInterval(whisperInterval);
  const elapsed = Math.floor((performance.now() - gameState.startTime)/1000);
  const mins=Math.floor(elapsed/60), secs=elapsed%60;
  document.getElementById('timeDisplay').textContent=`Time: ${mins}m ${secs}s (${elapsed}s)`;
  document.getElementById('winScreen').classList.remove('hidden');
  controls.unlock();
}

// Interaction handling
const raycaster=new THREE.Raycaster(); const center=new THREE.Vector2(0,0);
let hovered=null;
function handleInteract(){
  if(!isPointerLocked && !isMobile) return;
  // on mobile also require game started
  if(isMobile && !gameState.started) return;
  if(gameState.inTransition) return;
  raycaster.setFromCamera(center, camera);
  const meshes = interactables.map(i=>i.mesh);
  const intersects = raycaster.intersectObjects(meshes, true);
  if(intersects.length===0) return;
  // find root interactable
  let targetMesh=intersects[0].object;
  let entry = interactables.find(e=> e.mesh===targetMesh || targetMesh.parent===e.mesh || targetMesh.parent?.parent===e.mesh);
  // fallback: find by traversing up
  if(!entry){
    let cur=targetMesh; while(cur){ entry=interactables.find(e=>e.mesh===cur); if(entry) break; cur=cur.parent; }
  }
  if(!entry) return;
  switch(entry.type){
    case 'cabinet': openCabinet(); break;
    case 'toolbox': takeToolbox(); break;
    case 'elevatorButton': pressElevatorF1(); break;
    case 'furniture': searchFurniture(entry.group); break;
    case 'key': takeKey(entry.mesh); break;
    case 'safe': openSafePrompt(); break;
    case 'elevatorF2': tryEnterElevatorF2(); break;
    case 'bearBed': clickBearBed(); break;
    case 'bearSink': clickBearSink(); break;
    case 'elevatorF3': {
      if(bearStage<3 && !gameState.hasToy){ setQuest('Find the Teddy first! Check bed and sink.'); audio.playDoorSlam(); }
      else { gameState.inTransition=true; // doors open
        let p=0; const int=setInterval(()=>{ p+=0.07; elevatorDoors[0].position.x=-0.39 -p*0.9; elevatorDoors[1].position.x=0.39 +p*0.9; if(p>=1){clearInterval(int); doFadeTransition(()=>buildFloor4()); gameState.inTransition=false; }},30); audio.playElevatorScreech();
      }
      break;
    }
    case 'finalDoor': handleFinalDoor(); break;
  }
}

// Hover prompt
function updateHover(){
  if(!isPointerLocked && !isMobile){ interactPrompt.style.opacity='0'; return;}
  if(isMobile && !gameState.started){ interactPrompt.style.opacity='0'; return;}
  raycaster.setFromCamera(center,camera);
  const meshes=interactables.map(i=>i.mesh);
  const hits=raycaster.intersectObjects(meshes,true);
  if(hits.length>0 && hits[0].distance<3.8){
    let m=hits[0].object; let entry=interactables.find(e=> e.mesh===m || m.parent===e.mesh);
    if(!entry){ let cur=m; while(cur){ entry=interactables.find(e=>e.mesh===cur); if(entry) break; cur=cur.parent; } }
    if(entry){ interactPrompt.textContent='● ' + entry.prompt; interactPrompt.style.opacity='1'; return; }
  }
  interactPrompt.style.opacity='0';
}

// Movement with simple collision (bounds)
function updateMovement(dt){
  if((!isPointerLocked && !isMobile) || gameState.inTransition || isSafeOpen) return;
  const speed=  gameState.currentFloor===662? 4.6 : 2.9;
  const ctrlObj = controls.getObject();
  const forward = new THREE.Vector3(); ctrlObj.getWorldDirection(forward); forward.y=0; forward.normalize();
  if(forward.lengthSq() < 0.001){
    camera.getWorldDirection(forward); forward.y=0; forward.normalize();
  }
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0));
  // compose input vector (strafe, forward) - forward positive = ahead
  let fwdInput = (moveForward ? 1 : 0) + (moveBack ? -1 : 0);
  let strafeInput = (moveRight ? 1 : 0) + (moveLeft ? -1 : 0);
  if(isMobile){
    // joystickVector.y negative when pushing up (forward)
    fwdInput += -joystickVector.y;
    strafeInput += joystickVector.x;
  }
  const inputVec = new THREE.Vector3(strafeInput, 0, fwdInput);
  const mag = inputVec.length();
  const hasInput = mag > 0.01;
  if(hasInput){
    // analog support: keep joystick magnitude, clamp only if >1 (keyboard + joystick combine)
    if(mag > 1) inputVec.normalize().multiplyScalar(speed*dt);
    else inputVec.multiplyScalar(speed*dt);
  }
  const delta = new THREE.Vector3();
  if(hasInput){
    delta.addScaledVector(forward, inputVec.z);
    delta.addScaledVector(right, inputVec.x);
  }
  // gravity
  if(!onGround) playerVelocityY -= 9.8*dt;
  else playerVelocityY = Math.max(0, playerVelocityY);
  delta.y = playerVelocityY*dt;
  const newPos = camera.position.clone().add(delta);
  // clamp height
  if(newPos.y < playerHeight){ newPos.y = playerHeight; playerVelocityY=0; onGround=true; }
  else if(newPos.y > playerHeight+0.6) onGround=false;
  // bounds per floor
  if(gameState.currentFloor===1){
    newPos.x = Math.max(-4.6, Math.min(4.6, newPos.x));
    newPos.z = Math.max(-3.6, Math.min(3.6, newPos.z));
    // block elevator interior until opened? allow
  } else if(gameState.currentFloor===2){
    newPos.x = Math.max(-6.6, Math.min(6.6, newPos.x));
    newPos.z = Math.max(-6.6, Math.min(6.6, newPos.z));
  } else if(gameState.currentFloor===662){
    newPos.x = Math.max(-1.35, Math.min(1.35, newPos.x));
    newPos.z = Math.max(-7, Math.min(60, newPos.z));
    if(gameState.wardrobeFallen && newPos.z > 41.2 && Math.abs(newPos.x) < 1.2) newPos.z = 41.2; // block
  } else if(gameState.currentFloor===3){
    newPos.x = Math.max(-5.6, Math.min(5.6, newPos.x));
    newPos.z = Math.max(-4.6, Math.min(4.6, newPos.z));
  } else if(gameState.currentFloor===4){
    newPos.x = Math.max(-3.6, Math.min(3.6, newPos.x));
    newPos.z = Math.max(-3.6, Math.min(3.6, newPos.z));
  }
  camera.position.copy(newPos); ctrlObj.position.copy(newPos);
}

// Breathing + flicker + flashlight update
let flickerTimer=0;
function updateEffects(dt, elapsed){
  if(!gameState.started) return;
  // breathing bob even standing
  const breath = Math.sin(elapsed*0.0017)*0.025 + Math.sin(elapsed*0.0011)*0.015;
  const isMoving = moveForward||moveBack||moveLeft||moveRight || (isMobile && Math.hypot(joystickVector.x, joystickVector.y) > 0.12);
  camera.position.y = playerHeight + breath + (isMoving ? Math.sin(elapsed*0.008)*0.04 : 0);
  controls.getObject().position.y = camera.position.y;

  // flashlight attached to camera
  const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  flashlight.position.copy(camera.position);
  flashTarget.position.copy(camera.position.clone().addScaledVector(dir, 6));
  // random flicker battery
  if(gameState.flashlightOn && gameState.currentFloor!==662){
    flickerTimer -= dt;
    if(flickerTimer<=0){
      if(Math.random()<0.025){
        const old=flashlight.intensity;
        flashlight.intensity = Math.random()>0.5? 4: 28;
        setTimeout(()=>{ if(gameState.flashlightOn) flashlight.intensity= old; }, 70+Math.random()*90);
        if(Math.random()<0.12) audio.playFlickerSound();
        flickerTimer=0.18;
      } else flickerTimer=0.2;
    }
  }
  // ensure flashlight off during blackout
  if(!gameState.flashlightOn) flashlight.intensity=0;
  // vignette pulse
  vignette.style.opacity = (0.82 + Math.sin(elapsed*0.0012)*0.08).toString();
  // update floor3 proximity
  updateFloor3Proximity();
  if(gameState.currentFloor===662) updateChase(dt);
}

// Menu background 3D scene (elevator shaft) - enhanced with lights and depth
function buildMenuBackground(){
  clearScene(); hideCodeDisplay();
  menuAnimGroup=new THREE.Group();
  // shaft walls with emissive strips
  for(let i=0;i<6;i++){
    const ring=new THREE.Mesh(new THREE.BoxGeometry(3.8,0.16,3.8), new THREE.MeshStandardMaterial({color:0x151515, roughness:0.9}));
    ring.position.y = -i*4.2 -1; ring.rotation.y = i*0.22; menuAnimGroup.add(ring);
    const lightRing=new THREE.Mesh(new THREE.TorusGeometry(1.6,0.04,8,20), new THREE.MeshStandardMaterial({color:0x331111, emissive:0xff1a1a, emissiveIntensity:0.35}));
    lightRing.rotation.x=Math.PI/2; lightRing.position.y=-i*4.2 -1+0.22; menuAnimGroup.add(lightRing);
  }
  const elev=new THREE.Group();
  const elevBody=new THREE.Mesh(new THREE.BoxGeometry(1.9,2.35,1.9), new THREE.MeshStandardMaterial({color:0x252525, metalness:0.62, roughness:0.42}));
  elevBody.position.y=1.15; elevBody.castShadow=true; elev.add(elevBody);
  const eDoorL=new THREE.Mesh(new THREE.BoxGeometry(0.92,2.1,0.06), new THREE.MeshStandardMaterial({color:0x4a4a4a, metalness:0.7})); eDoorL.position.set(-0.46,1.15,0.98); elev.add(eDoorL);
  const eDoorR=eDoorL.clone(); eDoorR.position.x=0.46; elev.add(eDoorR);
  const elevLight=new THREE.PointLight(0xffaa88, 2.2, 6); elevLight.position.set(0,2.3,0.3); elev.add(elevLight);
  elev.rotation.y = Math.PI;
  menuAnimGroup.add(elev);
  // floating dust particles (small spheres)
  for(let i=0;i<22;i++){
    const p=new THREE.Mesh(new THREE.SphereGeometry(0.025+Math.random()*0.04,6,6), new THREE.MeshStandardMaterial({color:0x444444, transparent:true, opacity:0.6}));
    p.position.set((Math.random()-0.5)*5, (Math.random()-0.5)*12, (Math.random()-0.5)*5); p.userData.floatSpeed=0.12+Math.random()*0.3; menuAnimGroup.add(p);
  }
  scene.add(menuAnimGroup);
  // ambient lift shaft light
  const shaftLight=new THREE.PointLight(0xff2200, 3, 12); shaftLight.position.set(0,-6,0); scene.add(shaftLight);
  camera.position.set(2.9,1.7,5.4); camera.lookAt(0,0.6,0);
  scene.fog = new THREE.Fog(0x060208, 7, 22);
  floorIndicator.textContent='FLOOR: MENU';
}

buildMenuBackground();

// Main loop
function animate(){
  requestAnimationFrame(animate);
  const now=performance.now();
  const dt = Math.min((now - prevTime)/1000, 0.05); prevTime=now;
  const elapsed=now;
  if(gameState.started){
    updateMovement(dt);
    updateHover();
  } else {
    // menu animation: slowly rotate shaft
    if(menuAnimGroup){
      menuAnimGroup.rotation.y += dt*0.12;
      // float dust particles upward
      for(let ch of menuAnimGroup.children){
        if(ch.userData && ch.userData.floatSpeed){
          ch.position.y += ch.userData.floatSpeed * dt * 0.5;
          if(ch.position.y > 6) ch.position.y = -7;
        }
      }
    }
    // float camera
    camera.position.y = 1.6 + Math.sin(elapsed*0.0007)*0.18;
    camera.position.x = 2.5 + Math.sin(elapsed*0.0004)*0.4;
    camera.lookAt(0,0.6,0);
  }
  updateEffects(dt, elapsed);
  renderer.render(scene, camera);
}
animate();

// Orientation handling - allow both portrait and landscape on mobile
function isPortrait(){
  return window.innerHeight > window.innerWidth;
}
function checkOrientation(){
  const overlay = document.getElementById('rotateOverlay');
  const mControls = document.getElementById('mobileControls');
  if(!isMobile){
    if(overlay) overlay.classList.add('hidden');
    return;
  }
  // Never block gameplay with overlay - show controls in any orientation
  // Keep overlay hidden; it is now an optional hint only, not blocking input
  if(overlay) overlay.classList.add('hidden');
  if(mControls && gameState.started){
    mControls.classList.remove('hidden');
  }
}
// kept for optional hint - not used to block controls
function showRotateHintIfPortrait(){
  // optional non-blocking hint - currently disabled to not annoy user
}
async function tryLockLandscape(){
  if(!isMobile) return;
  try{
    if(screen.orientation && screen.orientation.lock){
      await screen.orientation.lock('landscape');
    }
  }catch(e){ /* ignore - not supported or not in fullscreen */ }
  // also try fullscreen for better lock support
  try{
    if(document.documentElement.requestFullscreen && !document.fullscreenElement){
      // don't auto fullscreen without user gesture - caller ensures gesture
    }
  }catch(e){}
}

function syncMobileYawPitch(){
  // initialize yaw/pitch from current camera
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  yaw = euler.y;
  pitch = euler.x;
}

function resetMobileView(){
  yaw = 0; pitch = 0;
  camera.rotation.order='YXZ';
  camera.rotation.set(0,0,0);
  syncMobileYawPitch();
}

function applyMobileLook(deltaX, deltaY){
  const sensitivity = 0.0042;
  yaw -= deltaX * sensitivity;
  pitch -= deltaY * sensitivity;
  const maxPitch = Math.PI/2 - 0.08;
  pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  camera.rotation.order = 'YXZ';
  camera.rotation.set(pitch, yaw, 0);
  // Note: controls.getObject() === camera in three r160, so do NOT overwrite with yaw-only rotation (would erase pitch)
}

function initMobileControls(){
  if(!isMobile) return;
  checkOrientation();
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', ()=> setTimeout(checkOrientation, 200));

  const joystickZone = document.getElementById('joystickZone');
  const joystickStick = document.getElementById('joystickStick');
  const lookZone = document.getElementById('lookZone');
  const btnInteract = document.getElementById('btnInteractMobile');
  const btnJump = document.getElementById('btnJumpMobile');

  if(!joystickZone || !lookZone) return;

  // Joystick handling with multitouch identifiers
  let joyTouchId = null;
  const maxRadius = 52;

  function getCenter(){
    const rect = joystickZone.getBoundingClientRect();
    return {x: rect.left + rect.width/2, y: rect.top + rect.height/2, rect};
  }

  function handleJoyMove(clientX, clientY){
    const center = getCenter();
    let dx = clientX - center.x;
    let dy = clientY - center.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);
    const cx = Math.cos(angle)*clampedDist;
    const cy = Math.sin(angle)*clampedDist;
    joystickStick.style.transform = `translate(${cx}px, ${cy}px)`;
    joystickVector.x = cx / maxRadius;
    joystickVector.y = cy / maxRadius;
    // deadzone
    if(Math.hypot(joystickVector.x, joystickVector.y) < 0.14){
      joystickVector.x=0; joystickVector.y=0;
    }
    // update discrete flags for compatibility (optional)
    moveForward = joystickVector.y < -0.25;
    moveBack = joystickVector.y > 0.25;
    moveLeft = joystickVector.x < -0.25;
    moveRight = joystickVector.x > 0.25;
  }
  function resetJoy(){
    joyTouchId=null;
    joystickVector.x=0; joystickVector.y=0;
    moveForward=moveBack=moveLeft=moveRight=false;
    joystickStick.style.transform='translate(0,0)';
  }

  function findTouchById(list, id){
    for(let i=0;i<list.length;i++) if(list[i].identifier===id) return list[i];
    return null;
  }

  joystickZone.addEventListener('touchstart', e=>{
    if(joyTouchId!==null) return;
    e.preventDefault();
    const t=e.changedTouches[0];
    joyTouchId=t.identifier;
    handleJoyMove(t.clientX, t.clientY);
  }, {passive:false});
  joystickZone.addEventListener('touchmove', e=>{
    if(joyTouchId===null) return;
    e.preventDefault();
    const t=findTouchById(e.touches, joyTouchId) || findTouchById(e.changedTouches, joyTouchId);
    if(!t) return;
    handleJoyMove(t.clientX, t.clientY);
  }, {passive:false});
  const endJoy = e=>{
    if(joyTouchId===null) return;
    const t=findTouchById(e.changedTouches, joyTouchId);
    if(!t) return;
    e.preventDefault();
    resetJoy();
  };
  joystickZone.addEventListener('touchend', endJoy, {passive:false});
  joystickZone.addEventListener('touchcancel', endJoy, {passive:false});

  // Mouse fallback for testing on desktop with isMobile forced
  let mouseJoy=false;
  joystickZone.addEventListener('mousedown', e=>{ mouseJoy=true; handleJoyMove(e.clientX,e.clientY); });
  window.addEventListener('mousemove', e=>{ if(mouseJoy) handleJoyMove(e.clientX,e.clientY); });
  window.addEventListener('mouseup', ()=>{ if(mouseJoy){ mouseJoy=false; resetJoy(); }});

  // Look handling (right side swipe) with identifier tracking
  let lastLookX=0, lastLookY=0;
  let lookTouchId=null;

  function onLookStart(x,y){
    lastLookX=x; lastLookY=y;
    // sync yaw/pitch on first touch of this gesture
    syncMobileYawPitch();
  }
  function onLookMove(x,y){
    const dx = x - lastLookX;
    const dy = y - lastLookY;
    lastLookX=x; lastLookY=y;
    applyMobileLook(dx, dy);
  }

  lookZone.addEventListener('touchstart', e=>{
    if(lookTouchId!==null) return;
    if(e.target.closest('#mobileActions') || e.target.closest('#joystickZone')) return;
    e.preventDefault();
    const t=e.changedTouches[0];
    lookTouchId=t.identifier;
    isMobileLookActive=true;
    onLookStart(t.clientX, t.clientY);
  }, {passive:false});
  lookZone.addEventListener('touchmove', e=>{
    if(lookTouchId===null) return;
    e.preventDefault();
    const t=findTouchById(e.touches, lookTouchId) || findTouchById(e.changedTouches, lookTouchId);
    if(!t) return;
    onLookMove(t.clientX, t.clientY);
  }, {passive:false});
  function endLook(e){
    if(lookTouchId===null) return;
    const t=findTouchById(e.changedTouches, lookTouchId);
    if(!t) return;
    e.preventDefault();
    lookTouchId=null;
    isMobileLookActive=false;
  }
  lookZone.addEventListener('touchend', endLook, {passive:false});
  lookZone.addEventListener('touchcancel', endLook, {passive:false});

  // Mouse fallback for look (testing on desktop with isMobile forced or for hybrid devices)
  let mouseLook=false;
  lookZone.addEventListener('mousedown', e=>{
    if(e.target.closest('#mobileActions') || e.target.closest('#joystickZone')) return;
    mouseLook=true; isMobileLookActive=true; onLookStart(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', e=>{ if(mouseLook) onLookMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', ()=>{ if(mouseLook){ mouseLook=false; isMobileLookActive=false; }});

  // buttons
  if(btnInteract){
    btnInteract.addEventListener('touchstart', e=>{ e.preventDefault(); handleInteract(); }, {passive:false});
    btnInteract.addEventListener('touchend', e=> e.preventDefault(), {passive:false});
    btnInteract.addEventListener('click', e=>{ e.preventDefault(); handleInteract(); });
  }
  if(btnJump){
    const doJump= (e)=>{ e.preventDefault(); if(onGround){ playerVelocityY=4.5; onGround=false; } };
    btnJump.addEventListener('touchstart', doJump, {passive:false});
    btnJump.addEventListener('touchend', e=> e.preventDefault(), {passive:false});
    btnJump.addEventListener('click', doJump);
  }

  // Prevent scrolling/zoom on mobile controls (but allow joystick/look to handle their own preventDefault)
  // Use passive:false globally on mobileControls for safety
  document.getElementById('mobileControls')?.addEventListener('touchmove', e=>{
    // only prevent if not already handled - this is fallback
    // do not prevent if target is inside joystick or look (they already prevented)
  }, {passive:false});

  // Initialize hidden until game start
  document.getElementById('mobileControls').classList.add('hidden');
}

// init mobile controls immediately
initMobileControls();
checkOrientation();

// UI handlers
function startGame(){
  audio.init(); if(audio.ctx.state==='suspended') audio.ctx.resume();
  document.getElementById('menu').style.display='none';
  document.getElementById('menu').classList.add('hidden');
  gameState.started=true; gameState.startTime=performance.now();
  gameState.inventory=[]; gameState.hasToolbox=false; gameState.hasKey=false; gameState.hasToy=false;
  updateInventoryUI();
  buildFloor1();
  if(isMobile){
    // optional landscape lock - don't block portrait play
    tryLockLandscape();
    // try fullscreen for immersive experience (ignore if fails)
    try{
      if(document.documentElement.requestFullscreen && !document.fullscreenElement){
        document.documentElement.requestFullscreen().catch(()=>{});
      }
    }catch(e){}
    // reset mobile look to forward
    yaw = 0; pitch = 0;
    camera.rotation.order='YXZ';
    camera.rotation.set(0,0,0);
    controls.getObject().rotation.set(0,0,0);
    syncMobileYawPitch();
    isPointerLocked = true;
    // always show controls regardless of orientation
    document.getElementById('mobileControls')?.classList.remove('hidden');
    checkOrientation();
    document.getElementById('fpsHintMobile').style.display='block';
  } else {
    controls.lock();
  }
}
document.getElementById('btnStart').addEventListener('click', startGame);
document.getElementById('btnOptions').addEventListener('click', ()=>{ document.getElementById('optionsPanel').classList.remove('hidden'); document.getElementById('creditsPanel').classList.add('hidden'); });
document.getElementById('btnCredits').addEventListener('click', ()=>{ document.getElementById('creditsPanel').classList.remove('hidden'); document.getElementById('optionsPanel').classList.add('hidden'); });
document.getElementById('btnCloseOptions').addEventListener('click', ()=> document.getElementById('optionsPanel').classList.add('hidden'));
document.getElementById('btnCloseCredits').addEventListener('click', ()=> document.getElementById('creditsPanel').classList.add('hidden'));
document.getElementById('brightness').addEventListener('input', e=>{ renderer.toneMappingExposure = parseFloat(e.target.value); });
document.getElementById('volume').addEventListener('input', e=>{ audio.setVolume(parseFloat(e.target.value)); });
document.getElementById('btnRestart').addEventListener('click', ()=>{
  document.getElementById('jumpscare').classList.add('hidden');
  gameState.hasKey=false; gameState.hasToy=false; gameState.inventory=[]; updateInventoryUI(); bearStage=0;
  buildFloor4(); // restart from floor 4? spec says restart, but go to floor4 to try again or menu? We'll go to floor4
  if(isMobile){ isPointerLocked=true; syncMobileYawPitch(); checkOrientation(); } else controls.lock();
});
document.getElementById('btnMainMenu').addEventListener('click', ()=>{
  document.getElementById('winScreen').classList.add('hidden');
  document.getElementById('menu').style.display=''; document.getElementById('menu').classList.remove('hidden');
  gameState.started=false;
  document.getElementById('mobileControls')?.classList.add('hidden');
  // exit fullscreen if mobile locked
  try{ if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); }catch(e){}
  try{ if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
  buildMenuBackground();
});

window.addEventListener('resize', ()=>{
  camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  checkOrientation();
});

document.getElementById('btnContinuePortrait')?.addEventListener('click', ()=>{
  document.getElementById('rotateOverlay')?.classList.add('hidden');
  document.getElementById('mobileControls')?.classList.remove('hidden');
});

// Prevent context menu on right click
document.addEventListener('contextmenu', e=> e.preventDefault());

// Ensure audio hiss on menu after first interaction
document.body.addEventListener('click', ()=>{ if(!audio.ctx) { audio.init(); } if(audio.ctx && audio.ctx.state==='suspended') audio.ctx.resume(); }, {once:true});

