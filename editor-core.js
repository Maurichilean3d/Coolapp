/**
 * editor-core.js
 * Core completo con todas las funcionalidades originales + mejoras de subcomponentes
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

// Gizmo para subcomponentes (más pequeño)
const subTransform = new TransformControls(camera, renderer.domElement);
subTransform.setSize(0.5);
subTransform.setSpace('world');
scene.add(subTransform);

transform.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});

subTransform.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});

/* ===== STATE ===== */
let nextId = 1;
const objects = [];
let selectedObject = null;
let currentMode = 'translate';
let isEditMode = false; // Modo Edición vs Modo Objeto

const history = { past: [], future: [] };

/* ===== MEASUREMENT STATE ===== */
let measurementState = {
  active: false,
  startPos: null,
  currentPos: null,
  distance: 0
};

/* ===== CAMERA HELPER STATE ===== */
let cameraHelper = {
  originalDistance: 0,
  isDragging: false,
  dragStartCamDist: 0
};

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

/* ===== MEASUREMENT FUNCTIONS ===== */
function startMeasurement(worldPos) {
  measurementState.active = true;
  measurementState.startPos = worldPos.clone();
  measurementState.currentPos = worldPos.clone();
  measurementState.distance = 0;
  
  document.getElementById('measurement-line').classList.add('visible');
  document.getElementById('distance-label').classList.add('visible');
}

function updateMeasurement(worldPos) {
  if (!measurementState.active) return;
  
  measurementState.currentPos = worldPos.clone();
  measurementState.distance = measurementState.startPos.distanceTo(worldPos);
  
  // Actualizar línea
  const start = measurementState.startPos.clone();
  const end = worldPos.clone();
  
  const startScreen = start.project(camera);
  const endScreen = end.project(camera);
  
  const x1 = (startScreen.x * 0.5 + 0.5) * window.innerWidth;
  const y1 = (-startScreen.y * 0.5 + 0.5) * window.innerHeight;
  const x2 = (endScreen.x * 0.5 + 0.5) * window.innerWidth;
  const y2 = (-endScreen.y * 0.5 + 0.5) * window.innerHeight;
  
  document.getElementById('origin-dot').setAttribute('cx', x1);
  document.getElementById('origin-dot').setAttribute('cy', y1);
  document.getElementById('measure-line').setAttribute('x1', x1);
  document.getElementById('measure-line').setAttribute('y1', y1);
  document.getElementById('measure-line').setAttribute('x2', x2);
  document.getElementById('measure-line').setAttribute('y2', y2);
  
  // Actualizar label
  const label = document.getElementById('distance-label');
  label.textContent = measurementState.distance.toFixed(2) + ' m';
  label.style.left = ((x1 + x2) / 2) + 'px';
  label.style.top = ((y1 + y2) / 2 - 30) + 'px';
}

function endMeasurement() {
  measurementState.active = false;
  document.getElementById('measurement-line').classList.remove('visible');
  document.getElementById('distance-label').classList.remove('visible');
}

/* ===== CAMERA HELPER (Zoom dinámico al arrastrar) ===== */
function startCameraHelper() {
  if (!selectedObject) return;
  
  const box = new THREE.Box3().setFromObject(selectedObject);
  const center = box.getCenter(new THREE.Vector3());
  const distance = camera.position.distanceTo(center);
  
  cameraHelper.originalDistance = distance;
  cameraHelper.dragStartCamDist = distance;
  cameraHelper.isDragging = true;
}

function updateCameraHelper(dragDistance) {
  if (!cameraHelper.isDragging || !selectedObject) return;
  
  // A mayor distancia de arrastre, más zoom out
  const zoomFactor = 1 + (dragDistance * 0.15);
  const targetDistance = cameraHelper.dragStartCamDist * zoomFactor;
  
  const box = new THREE.Box3().setFromObject(selectedObject);
  const center = box.getCenter(new THREE.Vector3());
  
  const direction = camera.position.clone().sub(center).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(targetDistance));
  
  orbit.target.copy(center);
  orbit.update();
}

function endCameraHelper() {
  cameraHelper.isDragging = false;
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
    
    if (isEditMode) {
      // MODO EDICIÓN: mostrar subcomponentes, sin gizmo de objeto
      SUB.applySubVisibility(obj);
      transform.detach();
      subTransform.detach();
      document.getElementById('subtoolbar').classList.add('visible');
      document.getElementById('exit-manipulation').classList.add('visible');
    } else {
      // MODO OBJETO: gizmo normal, sin subcomponentes
      transform.attach(obj);
      transform.setMode(currentMode);
      subTransform.detach();
      document.getElementById('subtoolbar').classList.remove('visible');
      document.getElementById('exit-manipulation').classList.remove('visible');
    }
  } else {
    transform.detach();
    subTransform.detach();
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

  // MODO EDICIÓN: pick de subcomponentes
  if (isEditMode && selectedObject) {
    const changed = SUB.togglePick(raycaster, selectedObject);
    if (changed && SUB.hasSelection()) {
      // Attach gizmo to selection center
      const center = SUB.getSelectionWorldCenter();
      if (center) {
        subTransform.position.copy(center);
        subTransform.attach(selectedObject);
        subTransform.setMode(currentMode);
      }
      checkAndShowWeldPanel();
    }
    return;
  }

  // MODO OBJETO: selección normal
  const hits = raycaster.intersectObjects(objects, false);
  if (hits.length > 0) {
    selectObject(hits[0].object);
  } else {
    selectObject(null);
  }
}

/* ===== TRANSFORM EVENTS ===== */
let isDragging = false;
let dragStarted = false;
let dragStartPosition = null;
let dragDistance = 0;

// OBJETO
transform.addEventListener('mouseDown', () => {
  isDragging = false;
  dragStarted = true;
  dragStartPosition = selectedObject ? selectedObject.position.clone() : null;
  dragDistance = 0;
  startCameraHelper();
  if (selectedObject) startMeasurement(selectedObject.position);
});

transform.addEventListener('objectChange', () => {
  if (dragStarted) {
    isDragging = true;
  }
  
  if (selectedObject && dragStartPosition) {
    dragDistance = selectedObject.position.distanceTo(dragStartPosition);
    updateCameraHelper(dragDistance);
    updateMeasurement(selectedObject.position);
  }
});

transform.addEventListener('mouseUp', () => {
  if (isDragging && selectedObject) {
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
  dragStartPosition = null;
  endCameraHelper();
  endMeasurement();
});

// SUBCOMPONENTES
let subDragStarted = false;
let subDragDistance = 0;

subTransform.addEventListener('mouseDown', () => {
  subDragStarted = true;
  subDragDistance = 0;
  const center = SUB.getSelectionWorldCenter();
  if (center) startMeasurement(center);
});

subTransform.addEventListener('objectChange', () => {
  if (!subDragStarted || !selectedObject) return;
  
  // Calcular delta de movimiento
  const currentCenter = SUB.getSelectionWorldCenter();
  if (!currentCenter) return;
  
  // Aplicar movimiento a los subcomponentes seleccionados
  const worldDelta = new THREE.Vector3().subVectors(
    subTransform.position,
    currentCenter
  );
  
  subDragDistance = SUB.applySelectionWorldDelta(selectedObject, worldDelta);
  
  // Actualizar posición del gizmo al nuevo centro
  const newCenter = SUB.getSelectionWorldCenter();
  if (newCenter) {
    subTransform.position.copy(newCenter);
    updateMeasurement(newCenter);
  }
  
  updateCameraHelper(subDragDistance);
});

subTransform.addEventListener('mouseUp', () => {
  if (subDragStarted && selectedObject) {
    const action = SUB.commitSelectionDeltaAsAction(selectedObject.userData.id);
    if (action) addToHistory(action);
    
    SUB.setBaselineFromCurrent();
    checkAndShowWeldPanel();
  }
  subDragStarted = false;
  endMeasurement();
  endCameraHelper();
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
      // ENTRAR A MODO EDICIÓN
      isEditMode = true;
      currentMode = 'translate'; // Default en modo edición
      
      transform.detach();
      subTransform.setMode('translate');
      
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('subtoolbar').classList.add('visible');
      document.getElementById('exit-manipulation').classList.add('visible');
      
      if (selectedObject) {
        SUB.applySubVisibility(selectedObject);
      }
    } else {
      // CAMBIAR MODO DE TRANSFORMACIÓN (funciona en ambos modos)
      currentMode = mode;
      
      if (isEditMode) {
        subTransform.setMode(mode);
      } else {
        transform.setMode(mode);
      }
      
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  };
});

// Exit manipulation (SALIR DE MODO EDICIÓN)
document.getElementById('exit-manipulation').onclick = () => {
  isEditMode = false;
  
  document.getElementById('subtoolbar').classList.remove('visible');
  document.getElementById('exit-manipulation').classList.remove('visible');
  
  if (selectedObject) {
    if (selectedObject.userData.sub) {
      selectedObject.userData.sub.vertexPoints.visible = false;
      selectedObject.userData.sub.edgeLines.visible = false;
      selectedObject.userData.sub.faceWire.visible = false;
    }
    subTransform.detach();
    transform.attach(selectedObject);
    transform.setMode(currentMode);
  }
  
  SUB.clearSelection();
  
  // Volver a modo Move
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
  subTransform.detach();
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
  
  if (action.type === 'subEdit') {
    SUB.applySubEditInverse(action);
  }
  
  updateUndoRedoButtons();
};

document.getElementById('btn-redo').onclick = () => {
  if (history.future.length === 0) return;
  const action = history.future.pop();
  history.past.push(action);
  
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

console.log('✅ MR Studio Pro cargado correctamente');
