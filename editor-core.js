import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { setupSubcomponents } from './editor-subcomponents.js';

/* =============================
   CONFIG
============================= */
const CFG = {
  subAccent: 0x007aff,
  gridSize: 20,
  gridDiv: 20
};

/* =============================
   DOM
============================= */
const overlay = document.getElementById('overlay');
const btnStart = document.getElementById('btn-start');
const themeLight = document.getElementById('theme-light');
const themeDark = document.getElementById('theme-dark');

const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');

const renderButtons = Array.from(document.querySelectorAll('.render-opt'));
const camButtons = Array.from(document.querySelectorAll('.cam-opt'));

const toolbarButtons = Array.from(document.querySelectorAll('.tool-btn'));
const btnMove = document.getElementById('btn-move');
const btnRot = document.getElementById('btn-rot');
const btnScale = document.getElementById('btn-scale');
const btnSelect = document.getElementById('btn-select');
const btnDelete = document.getElementById('btn-delete');
const btnColor = document.getElementById('btn-color');

const subtoolbar = document.getElementById('subtoolbar');
const subVerts = document.getElementById('sub-verts');
const subEdges = document.getElementById('sub-edges');
const subFaces = document.getElementById('sub-faces');
const subExplode = document.getElementById('sub-explode');
const subClear = document.getElementById('sub-clear');

const weldPanel = document.getElementById('weld-panel');
const weldYes = document.getElementById('btn-weld-yes');
const weldNo = document.getElementById('btn-weld-no');

/* =============================
   THREE: escena
============================= */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2f7);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 400);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const grid = new THREE.GridHelper(CFG.gridSize, CFG.gridDiv, 0xcccccc, 0xe6e6ea);
scene.add(grid);

const light = new THREE.DirectionalLight(0xffffff, 1.15);
light.position.set(6, 10, 7);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

/* =============================
   CONTROLS
============================= */
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;

const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(0.5);               // solicitado: escala 0.5
transform.setSpace('local');
scene.add(transform);

/* =============================
   STATE
============================= */
let nextId = 1;
const objects = []; // meshes
let selected = null;

let currentMode = 'translate'; // translate | rotate | scale | select

// gizmoAnchor: para subcomponentes (center de selección)
const gizmoAnchor = new THREE.Object3D();
scene.add(gizmoAnchor);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// undo/redo
const undoStack = [];
const redoStack = [];
let dragStartSnapshot = null;

// weld pending
let weldPending = null;

/* =============================
   MATERIAL PRESETS (render modes)
============================= */
const MATERIALS = {
  flat: () => new THREE.MeshStandardMaterial({ color: 0xb0b0b8, roughness: 0.9, metalness: 0.0 }),
  clay: () => new THREE.MeshStandardMaterial({ color: 0xd0d0d6, roughness: 0.55, metalness: 0.05 }),
  tech: () => new THREE.MeshStandardMaterial({ color: 0x8aa6ff, roughness: 0.25, metalness: 0.55 })
};
let currentRender = 'flat';

function applyTheme(isDark){
  document.body.classList.toggle('dark-mode', isDark);
  if (isDark) {
    scene.background = new THREE.Color(0x1c1c1e);
    grid.material.color.set(0x2f2f33);
    grid.material.vertexColors = false;
  } else {
    scene.background = new THREE.Color(0xf2f2f7);
    grid.material.color.set(0xcccccc);
  }
}

function setActive(el, group){
  group.forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function updateUndoRedoButtons(){
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
}

/* =============================
   API for subcomponents
============================= */
function findObjectById(id){ return objects.find(o => o.userData.id === id) || null; }

const ui = {
  showWeldPrompt({ onYes, onNo }) {
    weldPending = { onYes, onNo };
    weldPanel.classList.add('visible');
  },
  hideWeldPrompt() {
    weldPending = null;
    weldPanel.classList.remove('visible');
  }
};

const sub = setupSubcomponents({ THREE, CFG, findObjectById, ui });

/* =============================
   SPAWN
============================= */
function spawn(kind){
  let geom;
  switch(kind){
    case 'box': geom = new THREE.BoxGeometry(1.5, 1.5, 1.5); break;
    case 'sphere': geom = new THREE.SphereGeometry(0.9, 28, 18); break;
    case 'cylinder': geom = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 28); break;
    case 'cone': geom = new THREE.ConeGeometry(0.85, 1.7, 28); break;
    case 'torus': geom = new THREE.TorusGeometry(0.9, 0.28, 18, 40); break;
    case 'plane': geom = new THREE.PlaneGeometry(2.2, 2.2, 1, 1); break;
    default: geom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  }

  const mesh = new THREE.Mesh(geom, MATERIALS[currentRender]());
  mesh.position.set((Math.random()-0.5)*2.0, 0.85, (Math.random()-0.5)*2.0);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.id = nextId++;
  mesh.userData.kind = kind;

  scene.add(mesh);
  objects.push(mesh);

  selectObject(mesh);
  fitAll();
}

/* =============================
   SELECTION (object + sub)
============================= */
function selectObject(obj){
  selected = obj;

  // reset helpers selection
  sub.clearSelection(selected);

  // make sure helpers exist
  sub.ensureHelpers(selected);
  sub.applySubVisibility(selected);

  // attach transform to object by default (unless sub selection exists)
  attachTransformToObject();
  showSubtoolbar(currentMode === 'select' && !!selected);
}

function deselect(){
  transform.detach();
  selected = null;
  showSubtoolbar(false);
}

function showSubtoolbar(visible){
  subtoolbar.classList.toggle('visible', !!visible);
}

function attachTransformToObject(){
  if (!selected) { transform.detach(); return; }
  transform.attach(selected);
}

function attachTransformToSubSelection(){
  if (!selected) return;
  const c = sub.getSelectionWorldCenter(selected);
  if (!c) return;

  gizmoAnchor.position.copy(c);
  gizmoAnchor.quaternion.copy(selected.quaternion); // para sentir "local"
  transform.attach(gizmoAnchor);
}

/* =============================
   CAMERA PRESETS
============================= */
function fitAll(){
  if (objects.length === 0) return;
  const box = new THREE.Box3();
  objects.forEach(o => box.expandByObject(o));
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());

  const dist = Math.max(3.5, size * 0.7);
  camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.7, dist)));
  camera.lookAt(center);
  orbit.target.copy(center);
  orbit.update();
}

function iso(){
  orbit.target.set(0, 0.6, 0);
  camera.position.set(6, 4.5, 6);
  camera.lookAt(orbit.target);
  orbit.update();
}
function top(){
  orbit.target.set(0, 0, 0);
  camera.position.set(0, 10, 0.001);
  camera.lookAt(orbit.target);
  orbit.update();
}
function front(){
  orbit.target.set(0, 0.6, 0);
  camera.position.set(0, 2.5, 10);
  camera.lookAt(orbit.target);
  orbit.update();
}
function right(){
  orbit.target.set(0, 0.6, 0);
  camera.position.set(10, 2.5, 0);
  camera.lookAt(orbit.target);
  orbit.update();
}

/* =============================
   RENDER MODE
============================= */
function setRenderMode(mode){
  currentRender = mode;
  objects.forEach(o => {
    o.material?.dispose?.();
    o.material = MATERIALS[mode]();
  });
}

/* =============================
   UNDO/REDO ACTIONS
============================= */
function pushAction(action){
  undoStack.push(action);
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function applyActionForward(action){
  if (!action) return;
  if (action.type === 'subEdit') sub.applySubEditForward(action);
  if (action.type === 'objXform') {
    const obj = findObjectById(action.id);
    if (!obj) return;
    obj.matrix.fromArray(action.to);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  }
}

function applyActionInverse(action){
  if (!action) return;
  if (action.type === 'subEdit') sub.applySubEditInverse(action);
  if (action.type === 'objXform') {
    const obj = findObjectById(action.id);
    if (!obj) return;
    obj.matrix.fromArray(action.from);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  }
}

function undo(){
  const a = undoStack.pop();
  if (!a) return;
  applyActionInverse(a);
  redoStack.push(a);
  updateUndoRedoButtons();
}

function redo(){
  const a = redoStack.pop();
  if (!a) return;
  applyActionForward(a);
  undoStack.push(a);
  updateUndoRedoButtons();
}

/* =============================
   DELETE / COLOR
============================= */
function deleteSelected(){
  if (!selected) return;
  transform.detach();

  const idx = objects.indexOf(selected);
  if (idx >= 0) objects.splice(idx, 1);
  scene.remove(selected);
  selected.geometry?.dispose?.();
  selected.material?.dispose?.();

  selected = null;
  showSubtoolbar(false);
  fitAll();
}

function randomizeColor(){
  if (!selected || !selected.material) return;
  selected.material.color.setHex(Math.random() * 0xffffff);
}

/* =============================
   MODE
============================= */
function setMode(mode){
  currentMode = mode;

  // UI active
  [btnMove, btnRot, btnScale, btnSelect].forEach(b => b.classList.remove('active'));
  if (mode === 'translate') btnMove.classList.add('active');
  if (mode === 'rotate') btnRot.classList.add('active');
  if (mode === 'scale') btnScale.classList.add('active');
  if (mode === 'select') btnSelect.classList.add('active');

  // Transform mode
  if (mode === 'translate') transform.setMode('translate');
  if (mode === 'rotate') transform.setMode('rotate');
  if (mode === 'scale') transform.setMode('scale');

  // Subtoolbar visible solo en select
  showSubtoolbar(mode === 'select' && !!selected);

  // attach transform:
  if (!selected) { transform.detach(); return; }
  if (mode === 'select') {
    // en select, si hay selección sub => gizmo a anchor, si no => detach (para tocar sin mover)
    if (sub.hasSelection()) attachTransformToSubSelection();
    else transform.detach();
  } else {
    // modo transform objeto
    sub.clearSelection(selected);
    attachTransformToObject();
  }
}

/* =============================
   POINTER PICKING
============================= */
function setRayFromPointer(e){
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left)/r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top)/r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
}

function pickObject(e){
  setRayFromPointer(e);
  const hits = raycaster.intersectObjects(objects, false);
  if (hits.length) return hits[0].object;
  return null;
}

function onPointerDown(e){
  // ignorar clicks en UI
  if (e.target.closest('button')) return;
  if (weldPanel.classList.contains('visible')) return;

  // en modo select: toggle sub / select obj
  if (currentMode === 'select') {
    const obj = selected ?? pickObject(e);

    if (!obj) { deselect(); return; }

    // si no estaba seleccionado, selecciona objeto
    if (obj !== selected) selectObject(obj);

    // intentar togglePick subcomponentes
    setRayFromPointer(e);
    const changed = sub.togglePick(raycaster, selected);

    if (changed) {
      // si ahora hay selección -> mostrar gizmo en centro
      if (sub.hasSelection()) attachTransformToSubSelection();
      else transform.detach();
    } else {
      // si no tocó subcomponentes, pero tocó objeto => mantener seleccionado
      // si tocó vacío => nada
    }
    return;
  }

  // en modos de transform: pick objeto y attach
  const hit = pickObject(e);
  if (hit) {
    if (hit !== selected) selectObject(hit);
    attachTransformToObject();
  } else {
    // tap en vacío -> mantener o detach (a tu gusto). aquí: detach
    transform.detach();
  }
}

window.addEventListener('pointerdown', onPointerDown, { passive: true });

/* =============================
   TRANSFORM EVENTS (sub + object)
============================= */
transform.addEventListener('dragging-changed', (ev) => {
  orbit.enabled = !ev.value;

  if (ev.value) {
    // start drag snapshot
    if (selected) {
      selected.updateMatrix();
      dragStartSnapshot = {
        mode: currentMode,
        objId: selected.userData.id,
        from: selected.matrix.toArray()
      };

      // baseline para cancel/commit sub
      sub.setBaselineFromCurrent(selected);

      // track gizmo start
      gizmoAnchor.userData._lastWorldPos = gizmoAnchor.getWorldPosition(new THREE.Vector3());
    }
  } else {
    // end drag -> commit action
    if (!selected || !dragStartSnapshot) return;

    if (transform.object === gizmoAnchor && sub.hasSelection()) {
      // intentar weld (prompt) antes de commit
      // si prompt aparece, el usuario decide y luego igual puede seguir moviendo,
      // pero aquí simplemente dejamos el panel: commit se hará al cerrar el panel o después del snap.
      sub.maybePromptWeld(selected);

      const action = sub.commitSelectionDeltaAsAction(selected.userData.id);
      if (action) pushAction(action);

      // al terminar, mantener gizmo en selección
      attachTransformToSubSelection();
    } else {
      // commit objeto
      selected.updateMatrix();
      const to = selected.matrix.toArray();
      const from = dragStartSnapshot.from;

      // evita acciones vacías
      let changed = false;
      for (let i=0;i<16;i++) if (Math.abs(to[i]-from[i]) > 1e-10) { changed = true; break; }
      if (changed) pushAction({ type:'objXform', id:selected.userData.id, from, to });

      attachTransformToObject();
    }

    dragStartSnapshot = null;
  }
});

transform.addEventListener('objectChange', () => {
  // subedit: mover por delta world del gizmoAnchor
  if (!selected) return;
  if (transform.object !== gizmoAnchor) return;
  if (!sub.hasSelection()) return;

  const prev = gizmoAnchor.userData._lastWorldPos || gizmoAnchor.getWorldPosition(new THREE.Vector3());
  const now = gizmoAnchor.getWorldPosition(new THREE.Vector3());
  const worldDelta = now.clone().sub(prev);
  gizmoAnchor.userData._lastWorldPos = now.clone();

  if (worldDelta.lengthSq() > 1e-14) {
    sub.applySelectionWorldDelta(selected, worldDelta);
  }
});

/* =============================
   WELD PANEL buttons
============================= */
weldYes.addEventListener('click', () => {
  if (weldPending?.onYes) weldPending.onYes();
  ui.hideWeldPrompt();
  // refrescar gizmo center si sigue selección
  if (selected && sub.hasSelection()) attachTransformToSubSelection();
});
weldNo.addEventListener('click', () => {
  if (weldPending?.onNo) weldPending.onNo();
  ui.hideWeldPrompt();
});

/* =============================
   UI HOOKS
============================= */
btnStart.addEventListener('click', () => {
  overlay.style.opacity = '0';
  setTimeout(() => overlay.style.display = 'none', 280);
});

themeLight.addEventListener('click', () => {
  setActive(themeLight, [themeLight, themeDark]);
  applyTheme(false);
});
themeDark.addEventListener('click', () => {
  setActive(themeDark, [themeLight, themeDark]);
  applyTheme(true);
});

renderButtons.forEach(b => b.addEventListener('click', () => {
  setActive(b, renderButtons);
  setRenderMode(b.dataset.render);
}));

camButtons.forEach(b => b.addEventListener('click', () => {
  setActive(b, camButtons);
  const k = b.dataset.cam;
  if (k === 'fitall') fitAll();
  if (k === 'iso') iso();
  if (k === 'top') top();
  if (k === 'front') front();
  if (k === 'right') right();
}));

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

toolbarButtons.forEach(b => {
  const spawnKind = b.dataset.spawn;
  if (!spawnKind) return;
  b.addEventListener('click', () => spawn(spawnKind));
});

btnMove.addEventListener('click', () => setMode('translate'));
btnRot.addEventListener('click', () => setMode('rotate'));
btnScale.addEventListener('click', () => setMode('scale'));
btnSelect.addEventListener('click', () => setMode('select'));

btnDelete.addEventListener('click', deleteSelected);
btnColor.addEventListener('click', randomizeColor);

/* Subtoolbar flags */
function syncSubButtons(){
  const f = sub.getFlags();
  subVerts.classList.toggle('active', !!f.verts);
  subEdges.classList.toggle('active', !!f.edges);
  subFaces.classList.toggle('active', !!f.faces);
  subExplode.classList.toggle('active', !!f.explode);
  if (selected) sub.applySubVisibility(selected);
  if (selected) {
    if (sub.hasSelection()) attachTransformToSubSelection();
    else transform.detach();
  }
}

subVerts.addEventListener('click', () => {
  const f = sub.getFlags();
  sub.setFlags({ verts: !f.verts });
  syncSubButtons();
});
subEdges.addEventListener('click', () => {
  const f = sub.getFlags();
  sub.setFlags({ edges: !f.edges });
  syncSubButtons();
});
subFaces.addEventListener('click', () => {
  const f = sub.getFlags();
  sub.setFlags({ faces: !f.faces });
  syncSubButtons();
});
subExplode.addEventListener('click', () => {
  const f = sub.getFlags();
  sub.setFlags({ explode: !f.explode });
  // al cambiar explode, conviene limpiar selección para evitar llaves viejas
  if (selected) sub.clearSelection(selected);
  syncSubButtons();
});
subClear.addEventListener('click', () => {
  if (selected) sub.clearSelection(selected);
  transform.detach();
  syncSubButtons();
});

/* =============================
   RESIZE + LOOP
============================= */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(){
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();

/* =============================
   Boot defaults
============================= */
applyTheme(false);
updateUndoRedoButtons();
syncSubButtons();
spawn('box');
setMode('translate');
fitAll();
