/* Surface triangulation is for shading only. The wireframe follows each original OBJ face. */
(() => {
  const assetRoot = 'static/3d_assets/';
  const template = document.querySelector('#viewer-template');
  const format = new Intl.NumberFormat('en-US');

  function parseObj(text) {
    const positions = [];
    const faces = [];
    for (const line of text.split('\n')) {
      const tokens = line.split('#')[0].trim().split(/\s+/);
      if (tokens[0] === 'v') {
        const point = tokens.slice(1, 4).map(Number);
        if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Invalid vertex');
        positions.push(new THREE.Vector3(...point));
      }
      if (tokens[0] === 'f') {
        const indices = tokens.slice(1).map((token) => {
          const index = Number(token.split('/')[0]);
          return index < 0 ? positions.length + index : index - 1;
        });
        if (indices.length < 3 || indices.some((index) => !Number.isInteger(index) || index < 0)) {
          throw new Error('Invalid face');
        }
        faces.push(indices);
      }
    }
    if (!faces.length || faces.some((face) => face.some((index) => index >= positions.length))) {
      throw new Error('Missing or invalid faces');
    }
    return { positions, faces };
  }

  function triangulate(face, points) {
    if (face.length === 3) return [[0, 1, 2]];
    const normal = new THREE.Vector3();
    const edge = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
      normal.add(edge.crossVectors(points[i], points[(i + 1) % points.length]));
    }
    const [x, y, z] = normal.toArray().map(Math.abs);
    const axis = x >= y && x >= z ? 'x' : y >= z ? 'y' : 'z';
    const contour = points.map((p) => {
      if (axis === 'x') return new THREE.Vector2(p.y, p.z);
      if (axis === 'y') return new THREE.Vector2(p.z, p.x);
      return new THREE.Vector2(p.x, p.y);
    });
    const direction = new THREE.Vector3();
    const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const triangle of triangles) {
      const [a, b, c] = triangle.map((index) => points[index]);
      edge.subVectors(b, a).cross(direction.subVectors(c, a));
      if (edge.dot(normal) < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
    }
    return triangles;
  }

  function buildMeshes(data) {
    const box = new THREE.Box3().setFromPoints(data.positions);
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (!Number.isFinite(scale)) throw new Error('Empty mesh bounds');
    const vertices = data.positions.map((p) => p.sub(center).multiplyScalar(scale));
    const triangles = [];
    const segments = [];
    const seenEdges = new Set();
    for (const face of data.faces) {
      const points = face.map((i) => vertices[i]);
      for (const triangle of triangulate(face, points)) {
        for (const index of triangle) triangles.push(...points[index].toArray());
      }
      for (let i = 0; i < face.length; i++) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        const edge = a < b ? a + '/' + b : b + '/' + a;
        if (a === b || seenEdges.has(edge)) continue;
        seenEdges.add(edge);
        segments.push(...vertices[a].toArray(), ...vertices[b].toArray());
      }
    }
    const geometry = (points) => new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const surface = geometry(triangles);
    surface.computeVertexNormals();
    surface.computeBoundingSphere();
    return { surface, wire: geometry(segments) };
  }

  function setupViewport(canvas) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.className = 'quad-viewer-surface';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    canvas.prepend(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.autoRotateSpeed = 1;
    const surfaceMaterial = new THREE.MeshStandardMaterial({
      color: 0xc6d3ca, roughness: .69, metalness: .08, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const wireMaterial = new THREE.LineBasicMaterial({ color: 0x24634f, transparent: true, opacity: .8 });
    const group = new THREE.Group();
    scene.add(group, new THREE.HemisphereLight(0xe8fff5, 0x36423c, .8));
    const key = new THREE.DirectionalLight(0xfff6e9, .85);
    const rim = new THREE.DirectionalLight(0xa5e9d4, .45);
    key.position.set(5, 6, 5);
    rim.position.set(-3, 1, -5);
    scene.add(key, rim);

    let surface;
    let wire;
    let radius = 1.4;
    let frame = 0;
    let visible = false;
    let cameraPosition;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);

    function tick() {
      frame = 0;
      if (!visible || !controls.autoRotate || document.hidden) return;
      controls.update();
      frame = requestAnimationFrame(tick);
    }

    function syncAnimation() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (visible && controls.autoRotate && !document.hidden) frame = requestAnimationFrame(tick);
    }

    function resetView() {
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.09;
      controls.minDistance = Math.max(radius * .5, .05);
      controls.maxDistance = distance * 4;
      camera.position.copy(new THREE.Vector3(...(cameraPosition || [.54, .36, 1])).normalize().multiplyScalar(distance));
      controls.target.set(0, 0, 0);
      controls.update();
      render();
    }

    function resize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      if (surface) resetView();
    }

    function clear() {
      for (const mesh of group.children) mesh.geometry.dispose();
      group.clear();
      surface = wire = null;
      render();
    }

    function setMode(mode) {
      if (!surface) return;
      surface.material.colorWrite = mode !== 'wireframe';
      wire.visible = mode !== 'shaded';
      wireMaterial.color.set(mode === 'wireframe' ? 0x9eeacf : 0x286653);
      wireMaterial.opacity = mode === 'wireframe' ? .94 : .82;
      render();
    }

    function show(data, item) {
      const meshes = buildMeshes(data);
      clear();
      surface = new THREE.Mesh(meshes.surface, surfaceMaterial);
      wire = new THREE.LineSegments(meshes.wire, wireMaterial);
      wire.renderOrder = 1;
      radius = meshes.surface.boundingSphere.radius || 1;
      group.rotation.set(...(item.rotation || [0, 0, 0]));
      cameraPosition = item.camera;
      group.add(surface, wire);
      resetView();
    }

    canvas.addEventListener('keydown', (event) => {
      if (event.target !== canvas || !surface) return;
      const moves = {
        ArrowLeft: [-.12, 0, 1], ArrowRight: [.12, 0, 1],
        ArrowUp: [0, -.12, 1], ArrowDown: [0, .12, 1],
        '+': [0, 0, .88], '=': [0, 0, .88], '-': [0, 0, 1.14]
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      orbit.theta += move[0];
      orbit.phi += move[1];
      orbit.radius = THREE.MathUtils.clamp(orbit.radius * move[2], controls.minDistance, controls.maxDistance);
      camera.position.setFromSpherical(orbit.makeSafe()).add(controls.target);
      controls.update();
    });

    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncAnimation();
    }).observe(canvas);
    document.addEventListener('visibilitychange', syncAnimation);
    resize();
    resetView();
    return {
      show, clear, setMode, resetView,
      setRotation(enabled) { controls.autoRotate = enabled; syncAnimation(); }
    };
  }

  function mountGallery(section, groups) {
    section.append(template.content.cloneNode(true));
    const select = (selector) => section.querySelector(selector);
    const canvas = select('.viewer-canvas');
    const poster = select('.viewer-poster');
    const status = select('.viewer-status');
    const title = select('[data-model-title]');
    const loadButton = select('.load-viewer');
    const filters = select('.case-filters');
    const cases = select('.case-list');
    const stats = select('.mesh-stats');
    const rotate = select('[data-rotate]');
    const modes = section.querySelectorAll('.view-modes input');
    let viewport;
    let selection;
    let mode = 'both';
    let pending;
    let ready = false;

    function announce(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function updateStats(data) {
      let quads = 0, triangles = 0, ngons = 0;
      for (const face of data.faces) {
        if (face.length === 4) quads++;
        else if (face.length === 3) triangles++;
        else ngons++;
      }
      const rows = [['Vertices', data.positions.length], ['Faces', data.faces.length], ['Quads', quads], ['Triangles', triangles]];
      if (ngons) rows.push(['N-gons', ngons]);
      rows.push(['Quad ratio', (quads / data.faces.length * 100).toFixed(1) + '%']);
      stats.replaceChildren(...rows.map(([label, value]) => {
        const row = document.createElement('div');
        const name = document.createElement('dt');
        const count = document.createElement('dd');
        name.textContent = label;
        count.textContent = typeof value === 'number' ? format.format(value) : value;
        row.append(name, count);
        return row;
      }));
    }

    async function loadModel() {
      pending?.abort();
      if (!ready) return;
      if (!viewport) {
        try { viewport = setupViewport(canvas); }
        catch {
          announce('Interactive 3D requires WebGL. The preview is still available.');
          return;
        }
      }
      const controller = new AbortController();
      const item = selection;
      pending = controller;
      announce('Loading mesh…');
      try {
        const response = await fetch(assetRoot + item.file, { signal: controller.signal });
        if (!response.ok) throw new Error('Mesh request failed');
        const text = await response.text();
        if (controller.signal.aborted) return;
        const data = parseObj(text);
        viewport.show(data, item);
        viewport.setMode(mode);
        updateStats(data);
        poster.hidden = true;
        announce('');
      } catch (error) {
        if (error.name === 'AbortError') return;
        announce('This mesh could not be loaded.');
        loadButton.textContent = 'Retry';
        loadButton.hidden = false;
      }
    }

    function pickCase(item, button) {
      selection = item;
      for (const candidate of cases.children) candidate.setAttribute('aria-pressed', String(candidate === button));
      viewport?.clear();
      stats.replaceChildren();
      title.textContent = item.name;
      poster.src = assetRoot + item.thumb;
      poster.hidden = false;
      loadButton.hidden = ready;
      loadButton.textContent = 'Load 3D model';
      loadModel();
    }

    function browse(group, filter) {
      for (const candidate of filters.children) candidate.setAttribute('aria-pressed', String(candidate === filter));
      cases.replaceChildren(...group.cases.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'case-card';
        const img = document.createElement('img');
        img.src = assetRoot + item.thumb;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        button.append(img, item.name);
        button.addEventListener('click', () => pickCase(item, button));
        return button;
      }));
      cases.scrollTo(0, 0);
      pickCase(group.cases[0], cases.firstElementChild);
    }

    for (const group of groups) {
      const filter = document.createElement('button');
      filter.type = 'button';
      filter.textContent = group.label;
      filter.addEventListener('click', () => browse(group, filter));
      filters.append(filter);
    }
    filters.hidden = groups.length < 2;
    for (const input of modes) {
      input.name = section.dataset.gallery + '-mode';
      input.addEventListener('change', () => {
        mode = input.value;
        viewport?.setMode(mode);
      });
    }
    rotate.addEventListener('click', () => {
      const enabled = rotate.getAttribute('aria-pressed') !== 'true';
      rotate.setAttribute('aria-pressed', String(enabled));
      viewport?.setRotation(enabled);
    });
    select('[data-reset]').addEventListener('click', () => viewport?.resetView());

    function activate() {
      ready = true;
      loadButton.hidden = true;
      loadModel();
    }
    loadButton.addEventListener('click', activate);
    browse(groups[0], filters.firstElementChild);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      if (!ready) activate();
    }, { rootMargin: '120px' });
    observer.observe(canvas);
  }

  (async () => {
    const sections = [...document.querySelectorAll('[data-gallery]')];
    try {
      const response = await fetch(assetRoot + 'cases.json?v=20261121-categories');
      if (!response.ok) throw new Error('Gallery manifest unavailable');
      const groups = await response.json();
      for (const section of sections) mountGallery(section, groups[section.dataset.gallery]);
    } catch (error) {
      for (const section of sections) section.textContent = 'The 3D gallery is temporarily unavailable.';
      console.error(error);
    }
  })();
})();
