/**
 * editor-subcomponents.js
 * Sistema avanzado de edición de subcomponentes con Merge/Explode y Welding
 */

export function setupSubcomponents(api) {
  const { THREE, CFG, scene, findObjectById } = api;

  const state = {
    flags: { verts: true, edges: false, faces: false, explode: false },
    selection: [],
    baseline: null,
    weldPending: null
  };

  const GROUP_EPS = 1e-4;

  /* ===== UTILITIES ===== */
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
    return map;
  }

  function getGroupForVertexIndex(obj, idx) {
    if (state.flags.explode) return { key: `i:${idx}`, indices: [idx] };

    const pos = obj.geometry?.attributes?.position;
    if (!pos) return { key: `i:${idx}`, indices: [idx] };

    const k = keyForPos(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    const groups = buildVertexGroups(obj);
    const indices = groups.get(k) ?? [idx];
    return { key: `g:${k}`, indices };
  }

  /* ===== FLAGS ===== */
  function getFlags() { return { ...state.flags }; }
  function setFlags(patch) {
    state.flags = { ...state.flags, ...patch };
  }

  /* ===== BASELINE ===== */
  function setBaselineFromCurrent() {
    const obj = getSelectedObject();
    if (!obj) return;
    const pos = obj.geometry?.attributes?.position;
    if (!pos) return;
    state.baseline = {
      id: obj.userData.id,
      positions: new Float32Array(pos.array)
    };
  }

  function cancelToBaseline() {
    const obj = getSelectedObject();
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

  function getSelectedObject() {
    if (state.baseline?.id != null) return findObjectById(state.baseline.id);
    return null;
  }

  /* ===== VISUAL HELPERS ===== */
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
      for (let i = 0; i < posAttr.count; i++) {
        col[i*3+0] = 0.91; col[i*3+1] = 0.3; col[i*3+2] = 0.24; // #e74c3c
      }
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
          color: 0xf1c40f, 
          transparent: true, 
          opacity: 0.7, 
          depthTest: false,
          linewidth: 2
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
          color: 0x3498db, 
          transparent: true, 
          opacity: 0.45, 
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

    const pts = obj.userData.sub.vertexPoints;
    if (pts) {
      const src = obj.geometry.attributes.position.array;
      const dst = pts.geometry.attributes.position;
      dst.array.set(src);
      dst.needsUpdate = true;
    }

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

  /* ===== SELECTION ===== */
  function clearSelection() {
    state.selection = [];
    setBaselineFromCurrent();
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

    // Reset all to vertex color
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(i, 0.91, 0.3, 0.24); // #e74c3c
    }

    // Mark selected (cyan)
    const selectedSet = new Set();
    state.selection.forEach(s => s.indices.forEach(i => selectedSet.add(i)));
    selectedSet.forEach(i => col.setXYZ(i, 0.2, 0.7, 1.0));

    col.needsUpdate = true;
  }

  function getSelectionWorldCenter() {
    const obj = getSelectedObject();
    if (!obj || !hasSelection()) return null;

    const c = new THREE.Vector3();
    for (const s of state.selection) {
      const w = obj.localToWorld(s.centroidLocal.clone());
      c.add(w);
    }
    c.multiplyScalar(1 / state.selection.length);
    return c;
  }

  function getSelectionWorldCenterForObject(obj) {
    if (!obj || !hasSelection()) return null;
    const c = new THREE.Vector3();
    for (const s of state.selection) {
      const w = obj.localToWorld(s.centroidLocal.clone());
      c.add(w);
    }
    c.multiplyScalar(1 / state.selection.length);
    return c;
  }

  /* ===== PICKING ===== */
  function approximateEdgeByNearest(obj, worldPoint) {
    const geom = obj.geometry;
    const pos = geom.attributes.position;
    const local = obj.worldToLocal(worldPoint.clone());

    let best = -1, bestD = Infinity;
    for (let i=0; i<pos.count; i++){
      const dx = pos.getX(i) - local.x;
      const dy = pos.getY(i) - local.y;
      const dz = pos.getZ(i) - local.z;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD){ bestD = d; best = i; }
    }
    if (best < 0) return null;

    let best2 = -1, bestD2 = Infinity;
    for (let i=0; i<pos.count; i++){
      if (i === best) continue;
      const dx = pos.getX(i) - local.x;
      const dy = pos.getY(i) - local.y;
      const dz = pos.getZ(i) - local.z;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD2){ bestD2 = d; best2 = i; }
    }
    if (best2 < 0) return null;
    return [best, best2];
  }

  function togglePick(raycaster, obj) {
    ensureHelpers(obj);

    if (!state.baseline || state.baseline.id !== obj.userData.id) {
      state.baseline = null;
      setBaselineFromCurrent();
    }

    // Vertex pick
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

    // Edge pick
    if (state.flags.edges && obj.userData.sub.edgeLines) {
      const hits = raycaster.intersectObject(obj.userData.sub.edgeLines, true);
      if (hits.length) {
        const p = hits[0].point.clone();
        const pair = approximateEdgeByNearest(obj, p);
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

    // Face pick
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

  /* ===== MOVEMENT ===== */
  let accumulatedLocalDelta = new THREE.Vector3(0,0,0);

  function applySelectionWorldDelta(obj, worldDelta) {
    if (!hasSelection()) return 0;

    const p0 = obj.worldToLocal(obj.position.clone());
    const p1 = obj.worldToLocal(obj.position.clone().add(worldDelta));
    const dLocal = p1.sub(p0);

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

    state.selection.forEach(s => { s.centroidLocal.add(dLocal); });
    accumulatedLocalDelta.add(dLocal);

    refreshHelpers(obj);

    const beforeCenterW = getSelectionWorldCenterForObject(obj);
    const afterCenterW = getSelectionWorldCenterForObject(obj);
    if (!beforeCenterW || !afterCenterW) return dLocal.length();
    return afterCenterW.distanceTo(beforeCenterW);
  }

  /* ===== WELDING ===== */
  function checkWeld(obj) {
    if (!state.flags.verts || state.flags.explode) return null;
    if (!hasSelection()) return null;

    // Check if selection has any vertex groups
    const vertexSelections = state.selection.filter(s => s.kind === 'v');
    if (vertexSelections.length === 0) return null;

    // Get all unique vertex indices from selection
    const selectedIndices = new Set();
    vertexSelections.forEach(s => s.indices.forEach(i => selectedIndices.add(i)));

    // Build all vertex groups
    const groups = buildVertexGroups(obj);
    const pos = obj.geometry.attributes.position;

    // For each selected vertex, check if there's a nearby non-selected vertex
    for (const idx of selectedIndices) {
      const p1 = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      
      for (let i = 0; i < pos.count; i++) {
        if (selectedIndices.has(i)) continue; // skip other selected vertices
        
        const p2 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const dist = p1.distanceTo(p2);
        
        if (dist > 0.01 && dist < 0.4) {
          // Found a nearby vertex - return weld info
          const targetKey = keyForPos(pos.getX(i), pos.getY(i), pos.getZ(i));
          const targetIndices = groups.get(targetKey) ?? [i];
          
          return {
            sourceIndices: Array.from(selectedIndices),
            targetPosition: p2.clone(),
            targetIndices: targetIndices
          };
        }
      }
    }

    return null;
  }

  function applyWeld(obj, weldInfo) {
    if (!weldInfo) return;

    const pos = obj.geometry.attributes.position;
    const targetPos = weldInfo.targetPosition;

    // Move all source indices to target position
    weldInfo.sourceIndices.forEach(i => {
      pos.setXYZ(i, targetPos.x, targetPos.y, targetPos.z);
    });

    pos.needsUpdate = true;
    obj.geometry.computeVertexNormals();
    obj.geometry.computeBoundingBox();
    obj.geometry.computeBoundingSphere();

    // Update selection centroids
    state.selection.forEach(s => {
      if (s.kind === 'v') {
        s.centroidLocal.copy(targetPos);
      }
    });

    refreshHelpers(obj);
  }

  function setWeldPending(info) {
    state.weldPending = info;
  }

  function getWeldPending() {
    return state.weldPending;
  }

  function clearWeldPending() {
    state.weldPending = null;
  }

  /* ===== UNDO/REDO ===== */
  function commitSelectionDeltaAsAction(objectId) {
    if (!objectId) return null;
    if (!hasSelection()) return null;
    if (accumulatedLocalDelta.lengthSq() < 1e-12) return null;

    const unique = new Set();
    state.selection.forEach(s => s.indices.forEach(i => unique.add(i)));
    const indices = Array.from(unique);

    const d = accumulatedLocalDelta.clone();
    accumulatedLocalDelta.set(0,0,0);

    return {
      type: 'subEdit',
      id: objectId,
      indices,
      delta: { x: d.x, y: d.y, z: d.z }
    };
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

  /* ===== PUBLIC API ===== */
  return {
    getFlags,
    setFlags,

    applySubVisibility,

    togglePick,
    clearSelection,
    hasSelection,

    getSelectionWorldCenter,

    applySelectionWorldDelta,

    setBaselineFromCurrent,
    cancelToBaseline,
    commitSelectionDeltaAsAction,

    applySubEditForward,
    applySubEditInverse,

    checkWeld,
    applyWeld,
    setWeldPending,
    getWeldPending,
    clearWeldPending
  };
}
