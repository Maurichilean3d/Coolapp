/**
 * editor-subcomponents.js (Deploy version)
 *
 * Features:
 * - MERGE por defecto: grupos por posición (quantize).
 * - EXPLODE: selecciona solo el índice tocado.
 * - Selección múltiple toggle (verts/edges/faces) sin cerrar operación.
 * - Gizmo center: promedio de centroides.
 * - Movimiento: aplica delta local a TODOS los índices únicos.
 * - Weld (snap/soldar): al terminar de mover, si cerca de otro grupo -> UI confirm.
 * - Commit: acción undo/redo subEdit (indices + delta).
 */

export function setupSubcomponents(api) {
  const { THREE, CFG, findObjectById, ui } = api;

  const state = {
    flags: { verts: true, edges: false, faces: false, explode: false },
    selection: [], // [{kind:'v'|'e'|'f', key:string, indices:number[], centroidLocal:Vector3}]
    baseline: null, // { id, positions: Float32Array }
    _groupsCache: null, // { objId, map: Map }
    _accumulatedLocalDelta: new THREE.Vector3(0,0,0)
  };

  /* =============================
     FLAGS
  ============================ */
  function getFlags() { return { ...state.flags }; }
  function setFlags(patch) { state.flags = { ...state.flags, ...patch }; }

  /* =============================
     BASELINE (cancel)
  ============================ */
  function setBaselineFromCurrent(obj) {
    if (!obj) return;
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return;
    state.baseline = { id: obj.userData.id, positions: new Float32Array(pos.array) };
  }

  function cancelToBaseline(obj) {
    if (!obj || !state.baseline || state.baseline.id !== obj.userData.id) return;
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return;
    pos.array.set(state.baseline.positions);
    pos.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
    obj.geometry.computeBoundingSphere();
    refreshHelpers(obj);
  }

  /* =============================
     GROUPS (MERGE)
  ============================ */
  const GROUP_EPS = 1e-4;

  function keyForPos(x, y, z) {
    const qx = Math.round(x / GROUP_EPS);
    const qy = Math.round(y / GROUP_EPS);
    const qz = Math.round(z / GROUP_EPS);
    return `${qx}_${qy}_${qz}`;
  }

  function buildVertexGroups(obj) {
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return new Map();

    const map = new Map();
    for (let i = 0; i < pos.count; i++) {
      const k = keyForPos(pos.getX(i), pos.getY(i), pos.getZ(i));
      const arr = map.get(k);
      if (arr) arr.push(i);
      else map.set(k, [i]);
    }
    state._groupsCache = { objId: obj.userData.id, map };
    return map;
  }

  function getGroups(obj) {
    if (!obj) return new Map();
    if (state._groupsCache?.objId === obj.userData.id && state._groupsCache?.map) {
      return state._groupsCache.map;
    }
    return buildVertexGroups(obj);
  }

  function getGroupForVertexIndex(obj, idx) {
    if (state.flags.explode) return { key: `i:${idx}`, indices: [idx] };
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return { key: `i:${idx}`, indices: [idx] };

    const k = keyForPos(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    const groups = getGroups(obj);
    const indices = groups.get(k) ?? [idx];
    return { key: `g:${k}`, indices };
  }

  /* =============================
     VISUAL HELPERS (Points / Edges / Wire)
  ============================ */
  function ensureHelpers(obj) {
    if (!obj || !obj.geometry) return;
    if (!obj.userData.sub) obj.userData.sub = {};

    // Vertex points
    if (!obj.userData.sub.vertexPoints) {
      const geom = obj.geometry;
      const posAttr = geom.attributes.position;

      const ptsGeo = new THREE.BufferGeometry();
      ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posAttr.array), 3));

      const col = new Float32Array(posAttr.count * 3);
      for (let i = 0; i < posAttr.count; i++) { col[i*3]=1; col[i*3+1]=1; col[i*3+2]=1; }
      ptsGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));

      const ptsMat = new THREE.PointsMaterial({
        size: 0.16,
        vertexColors: true,
        depthTest: false,
        transparent: true,
        opacity: 0.95
      });

      const pts = new THREE.Points(ptsGeo, ptsMat);
      pts.renderOrder = 998;
      pts.visible = false;
      pts.name = 'VertexPoints';
      obj.add(pts);
      obj.userData.sub.vertexPoints = pts;
    }

    // Edge helper
    if (!obj.userData.sub.edgeLines) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(obj.geometry),
        new THREE.LineBasicMaterial({
          color: CFG.subAccent,
          transparent: true,
          opacity: 0.55,
          depthTest: false
        })
      );
      edges.visible = false;
      edges.renderOrder = 997;
      edges.name = 'EdgeLines';
      obj.add(edges);
      obj.userData.sub.edgeLines = edges;
    }

    // Face wire
    if (!obj.userData.sub.faceWire) {
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(obj.geometry),
        new THREE.LineBasicMaterial({
          color: CFG.subAccent,
          transparent: true,
          opacity: 0.30,
          depthTest: false
        })
      );
      wire.visible = false;
      wire.renderOrder = 996;
      wire.name = 'FaceWire';
      obj.add(wire);
      obj.userData.sub.faceWire = wire;
    }
  }

  function refreshHelpers(obj) {
    if (!obj?.userData?.sub) return;

    // Update points positions
    const pts = obj.userData.sub.vertexPoints;
    if (pts) {
      const src = obj.geometry.attributes.position.array;
      const dst = pts.geometry.attributes.position;
      dst.array.set(src);
      dst.needsUpdate = true;
    }

    // Rebuild edges/wire to reflect geometry changes
    if (obj.userData.sub.edgeLines) {
      obj.remove(obj.userData.sub.edgeLines);
      obj.userData.sub.edgeLines.geometry.dispose();
      obj.userData.sub.edgeLines.material.dispose();
      obj.userData.sub.edgeLines = null;
    }
    if (obj.userData.sub.faceWire) {
      obj.remove(obj.userData.sub.faceWire);
      obj.userData.sub.faceWire.geometry.dispose();
      obj.userData.sub.faceWire.material.dispose();
      obj.userData.sub.faceWire = null;
    }

    // invalidate groups cache (positions changed)
    if (state._groupsCache?.objId === obj.userData.id) state._groupsCache = null;

    ensureHelpers(obj);
    applySubVisibility(obj);
    recolorSelection(obj);
  }

  function applySubVisibility(obj) {
    ensureHelpers(obj);
    obj.userData.sub.vertexPoints.visible = !!state.flags.verts;
    obj.userData.sub.edgeLines.visible = !!state.flags.edges;
    obj.userData.sub.faceWire.visible = !!state.flags.faces;
    recolorSelection(obj);
  }

  /* =============================
     SELECTION
  ============================ */
  function clearSelection(obj) {
    state.selection = [];
    // baseline = current para no sorprender en cancel
    setBaselineFromCurrent(obj);
  }
  function hasSelection() { return state.selection.length > 0; }

  function makeSelectionKey(kind, key, indices) {
    if (kind === 'v') return `v:${key}`;
    const sig = indices.slice().sort((a,b)=>a-b).join(',');
    return `${kind}:${sig}`;
  }
  function selectionIndexByKey(selKey) {
    return state.selection.findIndex(s => s.key === selKey);
  }

  function centroidLocalFromIndices(obj, indices) {
    const pos = obj.geometry.attributes.position;
    const c = new THREE.Vector3();
    for (const i of indices) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    return c.multiplyScalar(1 / Math.max(1, indices.length));
  }

  function recolorSelection(obj) {
    if (!obj?.userData?.sub?.vertexPoints) return;
    const pts = obj.userData.sub.vertexPoints;
    const col = pts.geometry.attributes.color;

    for (let i = 0; i < col.count; i++) col.setXYZ(i, 1, 1, 1);

    const selectedSet = new Set();
    state.selection.forEach(s => s.indices.forEach(i => selectedSet.add(i)));
    selectedSet.forEach(i => col.setXYZ(i, 0.2, 0.7, 1.0)); // azul

    col.needsUpdate = true;
  }

  function getSelectionWorldCenter(obj) {
    if (!obj || !hasSelection()) return null;
    const c = new THREE.Vector3();
    for (const s of state.selection) c.add(obj.localToWorld(s.centroidLocal.clone()));
    c.multiplyScalar(1 / state.selection.length);
    return c;
  }

  /* =============================
     EDGE PICK (mejor)
  ============================ */
  function approximateEdgeByNearestSegment(obj, worldPoint) {
    const line = obj.userData.sub?.edgeLines;
    if (!line) return null;

    const posAttr = obj.geometry.attributes.position;
    const localP = obj.worldToLocal(worldPoint.clone());

    // Nota: edgesGeometry no te da indices directos a vertices originales de forma estable,
    // así que aproximamos al par de vértices MÁS cercanos al punto tocado (local).
    let best = -1, bestD = Infinity;
    for (let i=0; i<posAttr.count; i++){
      const dx = posAttr.getX(i) - localP.x;
      const dy = posAttr.getY(i) - localP.y;
      const dz = posAttr.getZ(i) - localP.z;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD){ bestD = d; best = i; }
    }
    if (best < 0) return null;

    let best2 = -1, bestD2 = Infinity;
    for (let i=0; i<posAttr.count; i++){
      if (i === best) continue;
      const dx = posAttr.getX(i) - localP.x;
      const dy = posAttr.getY(i) - localP.y;
      const dz = posAttr.getZ(i) - localP.z;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD2){ bestD2 = d; best2 = i; }
    }
    if (best2 < 0) return null;
    return [best, best2];
  }

  /* =============================
     TOGGLE PICK
  ============================ */
  function togglePick(raycaster, obj) {
    ensureHelpers(obj);

    // baseline si empieza a editar
    if (!state.baseline || state.baseline.id !== obj.userData.id) {
      state.baseline = null;
      setBaselineFromCurrent(obj);
    }

    // 1) vertex pick
    if (state.flags.verts && obj.userData.sub.vertexPoints) {
      const hits = raycaster.intersectObject(obj.userData.sub.vertexPoints, true);
      if (hits.length) {
        const idx = hits[0].index;

        const grp = getGroupForVertexIndex(obj, idx);
        const centroidLocal = centroidLocalFromIndices(obj, grp.indices);
        const selKey = makeSelectionKey('v', grp.key, grp.indices);

        const existing = selectionIndexByKey(selKey);
        if (existing >= 0) state.selection.splice(existing, 1);
        else state.selection.push({ kind: 'v', key: selKey, indices: grp.indices.slice(), centroidLocal });

        recolorSelection(obj);
        return true;
      }
    }

    // 2) edge pick
    if (state.flags.edges && obj.userData.sub.edgeLines) {
      const hits = raycaster.intersectObject(obj.userData.sub.edgeLines, true);
      if (hits.length) {
        const p = hits[0].point.clone();
        const pair = approximateEdgeByNearestSegment(obj, p);
        if (!pair) return false;

        const centroidLocal = centroidLocalFromIndices(obj, pair);
        const selKey = makeSelectionKey('e', 'edge', pair);

        const existing = selectionIndexByKey(selKey);
        if (existing >= 0) state.selection.splice(existing, 1);
        else state.selection.push({ kind: 'e', key: selKey, indices: pair.slice(), centroidLocal });

        recolorSelection(obj);
        return true;
      }
    }

    // 3) face pick (raycast mesh)
    if (state.flags.faces) {
      const hits = raycaster.intersectObject(obj, false);
      if (hits.length) {
        const f = hits[0].face;
        if (!f) return false;
        const tri = [f.a, f.b, f.c];

        const centroidLocal = centroidLocalFromIndices(obj, tri);
        const selKey = makeSelectionKey('f', 'face', tri);

        const existing = selectionIndexByKey(selKey);
        if (existing >= 0) state.selection.splice(existing, 1);
        else state.selection.push({ kind: 'f', key: selKey, indices: tri.slice(), centroidLocal });

        recolorSelection(obj);
        return true;
      }
    }

    return false;
  }

  /* =============================
     APPLY MOVEMENT
  ============================ */
  function worldDeltaToLocalDelta(obj, worldDelta) {
    // delta vector: usar matriz inversa SIN traslación
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const m3 = new THREE.Matrix3().setFromMatrix4(inv);
    return worldDelta.clone().applyMatrix3(m3);
  }

  function applySelectionWorldDelta(obj, worldDelta) {
    if (!obj || !hasSelection()) return;

    const dLocal = worldDeltaToLocalDelta(obj, worldDelta);

    const unique = new Set();
    state.selection.forEach(s => s.indices.forEach(i => unique.add(i)));

    const pos = obj.geometry.attributes.position;
    unique.forEach(i => {
      pos.setXYZ(i,
        pos.getX(i) + dLocal.x,
        pos.getY(i) + dLocal.y,
        pos.getZ(i) + dLocal.z
      );
    });

    pos.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
    obj.geometry.computeBoundingSphere();

    // update centroids
    state.selection.forEach(s => s.centroidLocal.add(dLocal));
    state._accumulatedLocalDelta.add(dLocal);

    refreshHelpers(obj);
  }

  /* =============================
     WELD (snap) al terminar drag
  ============================ */
  const DEFAULT_WELD_RADIUS = 0.28;

  function getUniqueSelectedIndices() {
    const set = new Set();
    state.selection.forEach(s => s.indices.forEach(i => set.add(i)));
    return Array.from(set);
  }

  function weldFindCandidate(obj, radius = DEFAULT_WELD_RADIUS) {
    if (!obj || !hasSelection() || state.flags.explode) return null; // weld solo tiene sentido en merge

    const pos = obj.geometry.attributes.position;
    const groups = getGroups(obj); // actual groups

    // Centro actual de selección (local)
    const selCenter = new THREE.Vector3();
    let count = 0;
    for (const s of state.selection) { selCenter.add(s.centroidLocal); count++; }
    if (count === 0) return null;
    selCenter.multiplyScalar(1 / count);

    // Buscar grupo destino más cercano que NO sea parte de la selección
    const selectedSet = new Set(getUniqueSelectedIndices());

    let bestKey = null;
    let bestDist = Infinity;
    let bestTargetPos = null;

    for (const [k, indices] of groups.entries()) {
      // si este grupo contiene algún índice seleccionado, lo saltamos
      let intersects = false;
      for (const i of indices) {
        if (selectedSet.has(i)) { intersects = true; break; }
      }
      if (intersects) continue;

      // posición representativa del grupo
      const i0 = indices[0];
      const p = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
      const d = p.distanceTo(selCenter);
      if (d < bestDist) {
        bestDist = d;
        bestKey = k;
        bestTargetPos = p;
      }
    }

    if (!bestKey || !bestTargetPos) return null;
    if (bestDist > radius) return null;

    return { targetKey: bestKey, targetPosLocal: bestTargetPos, dist: bestDist };
  }

  function weldApplySnap(obj, targetPosLocal) {
    if (!obj || !hasSelection() || !targetPosLocal) return;

    const unique = new Set();
    state.selection.forEach(s => s.indices.forEach(i => unique.add(i)));

    const pos = obj.geometry.attributes.position;

    // mover TODA la selección para que el centro caiga en targetPosLocal
    const selCenter = new THREE.Vector3();
    let count = 0;
    for (const s of state.selection) { selCenter.add(s.centroidLocal); count++; }
    selCenter.multiplyScalar(1 / Math.max(1, count));

    const dLocal = targetPosLocal.clone().sub(selCenter);

    unique.forEach(i => {
      pos.setXYZ(i,
        pos.getX(i) + dLocal.x,
        pos.getY(i) + dLocal.y,
        pos.getZ(i) + dLocal.z
      );
    });

    pos.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
    obj.geometry.computeBoundingSphere();

    state.selection.forEach(s => s.centroidLocal.add(dLocal));
    state._accumulatedLocalDelta.add(dLocal);

    refreshHelpers(obj);
  }

  function maybePromptWeld(obj, radius = DEFAULT_WELD_RADIUS) {
    const cand = weldFindCandidate(obj, radius);
    if (!cand) return false;

    if (!ui?.showWeldPrompt) {
      // Si no hay UI, auto-snap (opcional). Aquí: no hacemos nada.
      return false;
    }

    ui.showWeldPrompt({
      dist: cand.dist,
      onYes: () => weldApplySnap(obj, cand.targetPosLocal),
      onNo: () => {}
    });

    return true;
  }

  /* =============================
     COMMIT / UNDO ACTION
  ============================ */
  function commitSelectionDeltaAsAction(objectId) {
    if (!objectId) return null;
    if (!hasSelection()) return null;
    if (state._accumulatedLocalDelta.lengthSq() < 1e-12) return null;

    const indices = getUniqueSelectedIndices();
    const d = state._accumulatedLocalDelta.clone();
    state._accumulatedLocalDelta.set(0,0,0);

    return { type:'subEdit', id: objectId, indices, delta: { x:d.x, y:d.y, z:d.z } };
  }

  function applyDeltaLocalToIndices(obj, indices, dLocal) {
    const pos = obj.geometry.attributes.position;
    for (const i of indices) {
      pos.setXYZ(i,
        pos.getX(i) + dLocal.x,
        pos.getY(i) + dLocal.y,
        pos.getZ(i) + dLocal.z
      );
    }
    pos.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
    obj.geometry.computeBoundingSphere();
    refreshHelpers(obj);
  }

  function applySubEditForward(action) {
    const obj = findObjectById(action.id);
    if (!obj) return;
    applyDeltaLocalToIndices(obj, action.indices, new THREE.Vector3(action.delta.x, action.delta.y, action.delta.z));
  }
  function applySubEditInverse(action) {
    const obj = findObjectById(action.id);
    if (!obj) return;
    applyDeltaLocalToIndices(obj, action.indices, new THREE.Vector3(-action.delta.x, -action.delta.y, -action.delta.z));
  }

  /* =============================
     PUBLIC API
  ============================ */
  return {
    getFlags,
    setFlags,

    ensureHelpers,
    refreshHelpers,
    applySubVisibility,

    togglePick,
    clearSelection,
    hasSelection,

    getSelectionWorldCenter,

    applySelectionWorldDelta,

    setBaselineFromCurrent,
    cancelToBaseline,
    commitSelectionDeltaAsAction,

    maybePromptWeld,

    applySubEditForward,
    applySubEditInverse
  };
}
