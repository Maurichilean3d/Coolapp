/**
 * editor-core.js
 * Core principal mejorado con sistema de subcomponentes avanzado
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { setupSubcomponents } from './editor-subcomponents.js';

/* ===== CONFIG ===== */
const CFG = {
  subAccent: 0xFFFFFF,
  selectionColor: 0xFF9500,
  gridColor: 0x333333
};

/* ===== SCENE SETUP ===== */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const gridHelper = new THREE.GridHelper(20, 20, CFG.gridColor, 0x222222);
scene.add(gridHelper);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const light1 = new THREE.DirectionalLight(0xffffff, 1.2);
light1.position.set(5, 10, 7);
scene.add(light1);

const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
light2.position.set(-5, 5, -5);
scene.add(light2);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));

/* ===== CONTROLS ===== */
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.05;

const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(0.8);
transform.setSpace('world');
scene.add(transform);

transform.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});

/* ===== STATE ===== */
let nextId = 1;
const objects = [];
let selectedObject = null;
let currentMode = 'translate';
let isSelectMode = false;

const history = { past: [], future: [] };

/* ===== SUBCOMPONENTS SYSTEM ===== */
const subApi = {
  THREE,
  CFG,
  scene,
  findObjectById: (id) => objects.find(o => o.userData.id === id)
};

const SUB = setupSubcomponents(subApi);

/* ===== UTILITIES ===== */
function findObjectById(id) {
  return objects.find(o => o.userData.id === id);
}

function addToHistory(action) {
  history.past.push(action);
  history.future = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById('btn-undo').disabled = history.past.length === 0;
  document.getElementById('btn-redo').disabled = history.future.length === 0;
}

/* ===== OBJECT MANAGEMENT ===== */
function spawnPrimitive(type) {
  let geometry;
  switch(type) {
    case 'box': geometry = new THREE.BoxGeometry(2, 2, 2).toNonIndexed(); break;
    case 'sphere': geometry = new THREE.SphereGeometry(1, 32, 32).toNonIndexed(); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(1, 1, 2, 32).toNonIndexed(); break;
    case 'cone': geometry = new THREE.ConeGeometry(1, 2, 32).toNonIndexed(); break;
    case 'torus': geometry = new THREE.TorusGeometry(1, 0.4, 16, 32).toNonIndexed(); break;
    case 'plane': geometry = new THREE.PlaneGeometry(3, 3, 4, 4).toNonIndexed(); break;
    default: return;
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.5,
    metalness: 0.1
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 1, 0);
  mesh.userData.id = nextId++;
  mesh.userData.type = type;

  scene.add(mesh);
  objects.push(mesh);

  addToHistory({
    type: 'create',
    id: mesh.userData.id,
    objectType: type,
    position: mesh.position.clone()
  });

  selectObject(mesh);
}

function selectObject(obj) {
  if (selectedObject === obj) return;

  // Deselect previous
  if (selectedObject) {
    selectedObject.material.color.setHex(0x555555);
    if (selectedObject.userData.sub) {
      selectedObject.userData.sub.vertexPoints.visible = false;
      selectedObject.userData.sub.edgeLines.visible = false;
      selectedObject.userData.sub.faceWire.visible = false;
    }
  }

  selectedObject = obj;
  SUB.clearSelection();

  if (obj) {
    obj.material.color.setHex(CFG.selectionColor);
    SUB.setBaselineFromCurrent();
    
    if (isSelectMode) {
      SUB.applySubVisibility(obj);
      transform.detach();
      document.getElementById('subtoolbar').classList.add('visible');
      document.getElementById('exit-manipulation').classList.add('visible');
    } else {
      transform.attach(obj);
      document.getElementById('subtoolbar').classList.remove('visible');
      document.getElementById('exit-manipulation').classList.remove('visible');
    }
  } else {
    transform.detach();
    document.getElementById('subtoolbar').classList.remove('visible');
    document.getElementById('exit-manipulation').classList.remove('visible');
  }
}

function deleteSelected() {
  if (!selectedObject) return;

  const id = selectedObject.userData.id;
  scene.remove(selectedObject);
  selectedObject.geometry.dispose();
  selectedObject.material.dispose();
  
  const idx = objects.findIndex(o => o.userData.id === id);
  if (idx >= 0) objects.splice(idx, 1);

  addToHistory({ type: 'delete', id });

  selectObject(null);
}

/* ===== RAYCASTER ===== */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
  if (event.target.closest('button') || 
      event.target.closest('#weld-panel') ||
      event.target.closest('#axis-input-dialog') ||
      event.target.closest('#confirm-dialog')) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // Subcomponent mode
  if (isSelectMode && selectedObject) {
    const changed = SUB.togglePick(raycaster, selectedObject);
    if (changed) {
      checkAndShowWeldPanel();
    }
    return;
  }

  // Normal object selection
  const hits = raycaster.intersectObjects(objects, false);
  if (hits.length > 0) {
    selectObject(hits[0].object);
  } else {
    selectObject(null);
  }
}

let isDragging = false;
let dragStarted = false;

transform.addEventListener('mouseDown', () => {
  isDragging = false;
  dragStarted = true;
});

transform.addEventListener('objectChange', () => {
  if (dragStarted) {
    isDragging = true;
  }
});

transform.addEventListener('mouseUp', () => {
  if (isDragging && selectedObject) {
    // Commit transform
    addToHistory({
      type: 'transform',
      id: selectedObject.userData.id,
      position: selectedObject.position.clone(),
      rotation: selectedObject.rotation.clone(),
      scale: selectedObject.scale.clone()
    });
  }
  isDragging = false;
  dragStarted = false;
});

/* ===== WELD PANEL ===== */
function checkAndShowWeldPanel() {
  if (!selectedObject) return;
  
  const weldInfo = SUB.checkWeld(selectedObject);
  
  if (weldInfo) {
    SUB.setWeldPending(weldInfo);
    document.getElementById('weld-panel').classList.add('visible');
  } else {
    SUB.clearWeldPending();
    document.getElementById('weld-panel').classList.remove('visible');
  }
}

document.getElementById('btn-weld-yes').onclick = () => {
  const weldInfo = SUB.getWeldPending();
  if (weldInfo && selectedObject) {
    SUB.applyWeld(selectedObject, weldInfo);
    addToHistory({
      type: 'weld',
      id: selectedObject.userData.id,
      weldInfo: weldInfo
    });
  }
  document.getElementById('weld-panel').classList.remove('visible');
  SUB.clearWeldPending();
};

document.getElementById('btn-weld-no').onclick = () => {
  document.getElementById('weld-panel').classList.remove('visible');
  SUB.clearWeldPending();
};

/* ===== UI EVENTS ===== */
// Theme
document.getElementById('theme-light').onclick = () => {
  document.body.classList.add('light-mode');
  document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
  document.getElementById('theme-light').classList.add('active');
  scene.background.setHex(0xf2f2f7);
  gridHelper.material.color.setHex(0xd1d1d6);
};

document.getElementById('theme-dark').onclick = () => {
  document.body.classList.remove('light-mode');
  document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('active'));
  document.getElementById('theme-dark').classList.add('active');
  scene.background.setHex(0x1a1a1a);
  gridHelper.material.color.setHex(CFG.gridColor);
};

// Start button
document.getElementById('btn-start').onclick = () => {
  document.getElementById('overlay').style.display = 'none';
  spawnPrimitive('box');
};

// Spawn buttons
document.querySelectorAll('[data-spawn]').forEach(btn => {
  btn.onclick = () => spawnPrimitive(btn.dataset.spawn);
});

// Mode buttons
document.querySelectorAll('[data-mode]').forEach(btn => {
  btn.onclick = () => {
    const mode = btn.dataset.mode;
    
    if (mode === 'select') {
      isSelectMode = true;
      transform.detach();
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('subtoolbar').classList.add('visible');
      document.getElementById('exit-manipulation').classList.add('visible');
      
      if (selectedObject) {
        SUB.applySubVisibility(selectedObject);
      }
    } else {
      isSelectMode = false;
      currentMode = mode;
      transform.setMode(mode);
      
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('subtoolbar').classList.remove('visible');
      document.getElementById('exit-manipulation').classList.remove('visible');
      
      if (selectedObject) {
        transform.attach(selectedObject);
        if (selectedObject.userData.sub) {
          selectedObject.userData.sub.vertexPoints.visible = false;
          selectedObject.userData.sub.edgeLines.visible = false;
          selectedObject.userData.sub.faceWire.visible = false;
        }
      }
    }
  };
});

// Exit manipulation
document.getElementById('exit-manipulation').onclick = () => {
  isSelectMode = false;
  document.getElementById('subtoolbar').classList.remove('visible');
  document.getElementById('exit-manipulation').classList.remove('visible');
  
  if (selectedObject) {
    if (selectedObject.userData.sub) {
      selectedObject.userData.sub.vertexPoints.visible = false;
      selectedObject.userData.sub.edgeLines.visible = false;
      selectedObject.userData.sub.faceWire.visible = false;
    }
    transform.attach(selectedObject);
    transform.setMode(currentMode);
  }
  
  SUB.clearSelection();
  
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-move').classList.add('active');
};

// Subtoolbar buttons
document.getElementById('sub-verts').onclick = () => {
  const flags = SUB.getFlags();
  SUB.setFlags({ verts: !flags.verts });
  document.getElementById('sub-verts').classList.toggle('active');
  if (selectedObject) SUB.applySubVisibility(selectedObject);
};

document.getElementById('sub-edges').onclick = () => {
  const flags = SUB.getFlags();
  SUB.setFlags({ edges: !flags.edges });
  document.getElementById('sub-edges').classList.toggle('active');
  if (selectedObject) SUB.applySubVisibility(selectedObject);
};

document.getElementById('sub-faces').onclick = () => {
  const flags = SUB.getFlags();
  SUB.setFlags({ faces: !flags.faces });
  document.getElementById('sub-faces').classList.toggle('active');
  if (selectedObject) SUB.applySubVisibility(selectedObject);
};

document.getElementById('sub-explode').onclick = () => {
  const flags = SUB.getFlags();
  SUB.setFlags({ explode: !flags.explode });
  document.getElementById('sub-explode').classList.toggle('active');
  SUB.clearSelection();
  if (selectedObject) SUB.applySubVisibility(selectedObject);
};

document.getElementById('sub-clear').onclick = () => {
  SUB.clearSelection();
  if (selectedObject) SUB.applySubVisibility(selectedObject);
};

// Delete
document.getElementById('btn-delete').onclick = deleteSelected;

// Color
document.getElementById('btn-color').onclick = () => {
  if (!selectedObject) return;
  const randomColor = Math.random() * 0xffffff;
  selectedObject.material.color.setHex(randomColor);
  addToHistory({
    type: 'color',
    id: selectedObject.userData.id,
    color: randomColor
  });
};

// Undo/Redo
document.getElementById('btn-undo').onclick = () => {
  if (history.past.length === 0) return;
  const action = history.past.pop();
  history.future.push(action);
  
  // Apply undo logic here (simplified)
  if (action.type === 'subEdit') {
    SUB.applySubEditInverse(action);
  }
  
  updateUndoRedoButtons();
};

document.getElementById('btn-redo').onclick = () => {
  if (history.future.length === 0) return;
  const action = history.future.pop();
  history.past.push(action);
  
  // Apply redo logic here (simplified)
  if (action.type === 'subEdit') {
    SUB.applySubEditForward(action);
  }
  
  updateUndoRedoButtons();
};

// Camera presets
document.querySelectorAll('[data-cam]').forEach(btn => {
  btn.onclick = () => {
    const cam = btn.dataset.cam;
    
    switch(cam) {
      case 'fitall':
        camera.position.set(5, 4, 7);
        orbit.target.set(0, 0, 0);
        break;
      case 'focus':
        if (selectedObject) {
          const box = new THREE.Box3().setFromObject(selectedObject);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = camera.fov * (Math.PI / 180);
          let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
          cameraZ *= 2;
          camera.position.set(center.x, center.y, center.z + cameraZ);
          orbit.target.copy(center);
        }
        break;
      case 'iso':
        camera.position.set(5, 4, 5);
        orbit.target.set(0, 0, 0);
        break;
      case 'top':
        camera.position.set(0, 10, 0);
        orbit.target.set(0, 0, 0);
        break;
      case 'front':
        camera.position.set(0, 0, 10);
        orbit.target.set(0, 0, 0);
        break;
      case 'right':
        camera.position.set(10, 0, 0);
        orbit.target.set(0, 0, 0);
        break;
    }
    
    orbit.update();
  };
});

// Render modes
document.querySelectorAll('[data-render]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.render-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const mode = btn.dataset.render;
    objects.forEach(obj => {
      switch(mode) {
        case 'flat':
          obj.material.roughness = 0.5;
          obj.material.metalness = 0.1;
          break;
        case 'clay':
          obj.material.roughness = 1.0;
          obj.material.metalness = 0.0;
          break;
        case 'tech':
          obj.material.roughness = 0.2;
          obj.material.metalness = 0.8;
          break;
      }
    });
  };
});

/* ===== EVENT LISTENERS ===== */
renderer.domElement.addEventListener('pointerdown', onPointerDown);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ===== ANIMATION LOOP ===== */
function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

animate();
