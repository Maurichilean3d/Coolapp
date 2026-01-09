import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { setupSubcomponents } from './editor-subcomponents.js';

// --- CONFIGURACIÓN E INICIALIZACIÓN ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.add(new THREE.GridHelper(20, 20, 0x333333, 0x222222));

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(5, 5, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(5, 10, 7);
scene.add(light, new THREE.AmbientLight(0xffffff, 0.5));

document.getElementById('loader').style.display = 'none';

// --- CONTROLES ---
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value;
});
scene.add(transformControl);

// --- ESTADO GLOBAL ---
let objects = [];
let selectedObject = null;
let isEditMode = false;

// API para Subcomponentes
const api = {
    THREE, scene, camera, renderer, transformControl, orbit,
    getObject: () => selectedObject
};
const subEditor = setupSubcomponents(api);

// --- SELECCIÓN (RAYCASTER) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button') || event.target.closest('#weld-panel')) return;

    // Calcular coordenadas mouse
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (isEditMode) {
        // En modo edición, la selección la maneja el subEditor (Handles)
        subEditor.onPointerDown(raycaster);
    } else {
        // En modo global, seleccionamos objetos enteros
        const intersects = raycaster.intersectObjects(objects);
        if (intersects.length > 0) {
            selectObject(intersects[0].object);
        } else {
            selectObject(null);
        }
    }
});

function selectObject(obj) {
    selectedObject = obj;
    if (obj) {
        transformControl.attach(obj);
        // Highlight visual
        objects.forEach(o => o.material.emissive.setHex(0x000000));
        obj.material.emissive.setHex(0x222222);
    } else {
        transformControl.detach();
        objects.forEach(o => o.material.emissive.setHex(0x000000));
    }
}

// --- UI LOGIC ---

// 1. Spawn Objects
document.querySelectorAll('[data-spawn]').forEach(btn => {
    btn.onclick = () => {
        const type = btn.dataset.spawn;
        let geo;
        if (type === 'box') geo = new THREE.BoxGeometry(2, 2, 2);
        if (type === 'sphere') geo = new THREE.SphereGeometry(1.2, 16, 16);
        if (type === 'cone') geo = new THREE.ConeGeometry(1, 2, 16);

        // Importante: Convertir a NonIndexed para edición libre de vértices
        if (geo.index) geo = geo.toNonIndexed();

        const mat = new THREE.MeshStandardMaterial({ 
            color: Math.random() * 0xffffff, 
            roughness: 0.4, metalness: 0.1,
            polygonOffset: true, polygonOffsetFactor: 1 
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.id = Date.now();
        scene.add(mesh);
        objects.push(mesh);
        selectObject(mesh);
    };
});

// 2. Toggle Modos (Global vs Editar)
const btnGlobal = document.getElementById('mode-global');
const btnEdit = document.getElementById('mode-edit');
const topBar = document.getElementById('top-bar');

function setGlobalMode() {
    isEditMode = false;
    btnGlobal.classList.add('active');
    btnEdit.classList.remove('active');
    topBar.classList.add('hidden');
    
    subEditor.deactivate();
    if (selectedObject) transformControl.attach(selectedObject);
}

function setEditMode() {
    if (!selectedObject) {
        alert("Selecciona un objeto primero");
        return;
    }
    isEditMode = true;
    btnEdit.classList.add('active');
    btnGlobal.classList.remove('active');
    topBar.classList.remove('hidden');

    transformControl.detach(); // Quitamos control global
    subEditor.activate(selectedObject); // Activamos subcomponentes
}

btnGlobal.onclick = setGlobalMode;
btnEdit.onclick = setEditMode;
document.getElementById('btn-exit-sub').onclick = setGlobalMode;

// 3. Submodos (Verts, Edges, Faces)
document.querySelectorAll('[data-sub]').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('[data-sub]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        subEditor.setMode(btn.dataset.sub);
    };
});

// 4. Explode / Merge Toggle
const btnExplode = document.getElementById('btn-explode');
btnExplode.onclick = () => {
    const isExplode = btnExplode.innerText === 'EXPLODE';
    if (isExplode) {
        btnExplode.innerText = 'MERGE';
        btnExplode.classList.remove('active');
        subEditor.setExplode(false);
    } else {
        btnExplode.innerText = 'EXPLODE';
        btnExplode.classList.add('active');
        subEditor.setExplode(true);
    }
};

// 5. Delete
document.getElementById('btn-delete').onclick = () => {
    if (selectedObject) {
        scene.remove(selectedObject);
        objects = objects.filter(o => o !== selectedObject);
        if (isEditMode) setGlobalMode();
        selectObject(null);
    }
};

// --- LOOP ---
function animate() {
    requestAnimationFrame(animate);
    orbit.update();
    renderer.render(scene, camera);
}
animate();

window.onresize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
};
